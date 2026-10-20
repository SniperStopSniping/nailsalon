import { createHmac } from 'node:crypto';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  disableNetworkNoShowPlatformInTx,
  eraseNetworkNoShowSubjectInTx,
  readNetworkNoShowRisk,
  reconcileNetworkNoShows,
  recordNetworkNoShowInTx,
  registerNetworkBookingInTx,
  suppressNetworkNoShowSubjectInTx,
} from '@/libs/networkNoShow.server';
import { requestNoShowReviewInTx } from '@/libs/networkNoShowReview.server';
import { auditNoShowReportInTx } from '@/libs/noShowReporting.server';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const databaseUrl = process.env.CONCURRENCY_TEST_DATABASE_URL;
if (databaseUrl && (!['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  || process.env.NETWORK_NO_SHOW_DISPOSABLE_DATABASE_CONFIRMED !== 'true')) {
  throw new Error('Network no-show concurrency tests require a confirmed disposable loopback database.');
}
const suite = databaseUrl ? describe : describe.skip;
let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = new Date('2030-06-15T16:00:00.000Z');

let completedTests = 0;

function postgresCase(name: string, run: () => Promise<void>) {
  it(name, async () => {
    await run();
    completedTests += 1;
  });
}

async function expectWrappedQueryCancellation(operation: Promise<unknown>) {
  const rejection = await operation.then(() => undefined, error => error);
  let current = rejection;
  let cancelled = false;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { cause?: unknown; code?: unknown };
    if (candidate.code === '57014') {
      cancelled = true;
      break;
    }
    current = candidate.cause;
  }

  expect(cancelled).toBe(true);
}

async function waitForDatabaseLock(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { rows } = await pool.query<{ wait_event_type: string | null }>(
      'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
      [pid],
    );
    if (rows[0]?.wait_event_type === 'Lock') {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected reconciliation to block on the source appointment lock');
}

suite('network no-show PostgreSQL serialization', () => {
  beforeAll(async () => {
    process.env.NETWORK_NO_SHOW_ENABLED = 'true';
    process.env.NETWORK_NO_SHOW_HMAC_KEY = 'test-network-no-show-hmac-key-at-least-32-chars';
    pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    db = drizzle(pool, { schema });
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 120_000);

  beforeEach(async () => {
    const pairHmac = createHmac('sha256', process.env.NETWORK_NO_SHOW_HMAC_KEY!).update('4165551000\u0000x@example.com').digest('base64url');
    await pool.query(`TRUNCATE network_no_show_platform_control, network_no_show_subject CASCADE; TRUNCATE salon CASCADE;
      INSERT INTO salon(id,name,slug) VALUES ('a','A','a'),('b','B','b');
      INSERT INTO network_no_show_platform_control(id,enabled_at,prospective_after) VALUES (1,'2030-01-01','2030-01-01');
      INSERT INTO network_no_show_subject(id,pair_hmac) VALUES ('subject','${pairHmac}');
      INSERT INTO appointment(id,salon_id,client_phone,client_email,start_time,end_time,status,total_price,total_duration_minutes,created_at) VALUES ('appt','a','4165551000','x@example.com','2030-06-15 14:00Z','2030-06-15 15:00Z','no_show',5000,60,'2030-06-01');
      INSERT INTO appointment(id,salon_id,client_phone,client_email,start_time,end_time,status,total_price,total_duration_minutes,created_at) VALUES ('booking-b','b','4165551000','x@example.com','2030-06-20 14:00Z','2030-06-20 15:00Z','confirmed',5000,60,'2030-06-01');
      INSERT INTO network_no_show_booking_binding(id,salon_id,appointment_id,subject_id,state,booking_channel,created_at) VALUES ('binding','a','appt','subject','eligible','guest','2030-06-01');
      INSERT INTO network_no_show_event(id,salon_id,appointment_id,subject_id,occurred_at,expires_at,marked_by,marked_by_role,marked_at) VALUES ('event','a','appt','subject','2030-06-15 15:00Z','2031-06-15 15:00Z','owner','owner','2030-06-15 16:00Z');`);
  });

  afterAll(async () => pool?.end());

  postgresCase('serializes a locked risk decision before source correction', async () => {
    const reader = await pool.connect();
    const writer = await pool.connect();
    try {
      await reader.query('BEGIN');
      const readerDb = drizzle(reader, { schema });
      await readNetworkNoShowRisk({ salonId: 'b', phone: '4165551000', email: 'x@example.com', handle: readerDb });
      await writer.query('BEGIN');
      await writer.query('SET LOCAL statement_timeout=\'300ms\'');

      await expect(writer.query('UPDATE appointment SET status=\'completed\' WHERE id=\'appt\'')).rejects.toMatchObject({ code: '57014' });

      await reader.query('COMMIT');
      await writer.query('ROLLBACK');
      await writer.query('BEGIN');
      await writer.query('UPDATE appointment SET status=\'completed\' WHERE id=\'appt\'');
      await writer.query('COMMIT');

      expect((await pool.query('SELECT state FROM network_no_show_event WHERE id=\'event\'')).rows[0].state).toBe('revoked');
    } finally {
      await reader.query('ROLLBACK');
      await writer.query('ROLLBACK');
      reader.release();
      writer.release();
    }
  });

  postgresCase('erasure wins after immediate early publication releases its subject lock', async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      await first.query('DELETE FROM network_no_show_event WHERE id=\'event\'');
      await first.query('UPDATE appointment SET end_time=\'2030-06-15 17:00Z\' WHERE id=\'appt\'');

      await expect(recordNetworkNoShowInTx(drizzle(first, { schema }), { salonId: 'a', appointmentId: 'appt', actorId: 'owner', actorRole: 'owner', now })).resolves.toBe(true);

      await second.query('BEGIN');
      await second.query('SET LOCAL statement_timeout=\'300ms\'');

      await expectWrappedQueryCancellation(eraseNetworkNoShowSubjectInTx(drizzle(second, { schema }), { subjectId: 'subject', operatorId: 'op', now }));

      await first.query('COMMIT');
      await second.query('ROLLBACK');
      await db.transaction(tx => eraseNetworkNoShowSubjectInTx(tx, { subjectId: 'subject', operatorId: 'op', now }));

      expect((await pool.query('SELECT count(*)::int AS count FROM network_no_show_event WHERE subject_id=\'subject\'')).rows[0].count).toBe(0);
    } finally {
      await first.query('ROLLBACK');
      await second.query('ROLLBACK');
      first.release();
      second.release();
    }
  });

  postgresCase('blocks publication during disable and preserves the original eligible cohort on re-enable', async () => {
    const publisher = await pool.connect();
    const disabler = await pool.connect();
    try {
      await publisher.query('BEGIN');
      await publisher.query('DELETE FROM network_no_show_event WHERE id=\'event\'');
      await recordNetworkNoShowInTx(drizzle(publisher, { schema }), { salonId: 'a', appointmentId: 'appt', actorId: 'owner', actorRole: 'owner', now });

      await disabler.query('BEGIN');
      await disabler.query('SET LOCAL statement_timeout=\'300ms\'');

      await expectWrappedQueryCancellation(disableNetworkNoShowPlatformInTx(drizzle(disabler, { schema }), { operatorId: 'op', now }));

      await disabler.query('ROLLBACK');
      await publisher.query('COMMIT');

      await db.transaction(tx => disableNetworkNoShowPlatformInTx(tx, { operatorId: 'op', now }));
      await pool.query('UPDATE network_no_show_platform_control SET enabled_at=\'2030-07-01\' WHERE id=1');
      await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: 'a', appointmentId: 'appt', actorId: 'owner', actorRole: 'owner', now }));

      expect((await pool.query('SELECT count(*)::int AS count FROM network_no_show_event WHERE salon_id=\'a\' AND state=\'active\'')).rows[0].count).toBe(1);
    } finally {
      await publisher.query('ROLLBACK');
      await disabler.query('ROLLBACK');
      publisher.release();
      disabler.release();
    }
  });

  postgresCase('orders risk read, disable, and same-booking registration through participation first', async () => {
    const booking = await pool.connect();
    const disabler = await pool.connect();
    try {
      await booking.query('BEGIN');
      const bookingDb = drizzle(booking, { schema });
      await readNetworkNoShowRisk({ salonId: 'b', phone: '4165551000', email: 'x@example.com', handle: bookingDb });
      await disabler.query('BEGIN');
      await disabler.query('SET LOCAL statement_timeout=\'300ms\'');

      await expectWrappedQueryCancellation(disableNetworkNoShowPlatformInTx(drizzle(disabler, { schema }), { operatorId: 'op', now }));

      await disabler.query('ROLLBACK');
      await registerNetworkBookingInTx(bookingDb, {
        salonId: 'b',
        appointmentId: 'booking-b',
        phone: '4165551000',
        email: 'x@example.com',
        actorRole: 'guest',
        now,
      });
      await booking.query('COMMIT');

      expect((await pool.query('SELECT state FROM network_no_show_booking_binding WHERE salon_id=\'b\' AND appointment_id=\'booking-b\'')).rows[0].state).toBe('eligible');
    } finally {
      await booking.query('ROLLBACK');
      await disabler.query('ROLLBACK');
      booking.release();
      disabler.release();
    }
  });

  postgresCase('does not let disable lock bindings ahead of an in-flight subject suppression', async () => {
    const suppressor = await pool.connect();
    const disabler = await pool.connect();
    try {
      await suppressor.query('BEGIN');
      await suppressor.query('SELECT id FROM network_no_show_subject WHERE id=\'subject\' FOR UPDATE');
      await disabler.query('BEGIN');
      const pendingDisable = disableNetworkNoShowPlatformInTx(drizzle(disabler, { schema }), { operatorId: 'op', now });
      await suppressor.query('SET LOCAL statement_timeout=\'300ms\'');
      await suppressNetworkNoShowSubjectInTx(drizzle(suppressor, { schema }), {
        subjectId: 'subject',
        operatorId: 'op',
        now,
        reason: 'identity_conflict',
      });
      await suppressor.query('COMMIT');
      await pendingDisable;
      await disabler.query('COMMIT');

      expect((await pool.query('SELECT state FROM network_no_show_booking_binding WHERE id=\'binding\'')).rows[0].state).toBe('suppressed');
    } finally {
      await suppressor.query('ROLLBACK');
      await disabler.query('ROLLBACK');
      suppressor.release();
      disabler.release();
    }
  });

  postgresCase('does not publish a pending early no-show when its source correction wins the appointment lock', async () => {
    const correction = await pool.connect();
    const reconciler = await pool.connect();
    const reconcilerPid = (await reconciler.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    let correctionOpen = false;
    let reconciliation: Promise<{ scanned: number; recorded: number }> | null = null;
    try {
      await pool.query('DELETE FROM network_no_show_event WHERE id=\'event\'');
      await pool.query('UPDATE appointment SET end_time=\'2030-06-15 17:00Z\' WHERE id=\'appt\'');
      // Existing pending audit from before immediate publication shipped.
      await pool.query(`INSERT INTO network_no_show_audit(id,salon_id,actor_id,actor_role,action,created_at)
        VALUES ('pending-early','a','owner-early','admin','pending_no_show:appt','2030-06-15 16:00Z')`);

      await correction.query('BEGIN');
      correctionOpen = true;
      await correction.query('UPDATE appointment SET status=\'cancelled\', cancel_reason=\'admin_correction\' WHERE id=\'appt\'');
      await correction.query(`INSERT INTO network_no_show_audit(id,salon_id,actor_id,actor_role,action)
        VALUES ('early-correction','a','operator','operator','source_corrected:no_show_to_cancelled:appt')`);

      reconciliation = reconcileNetworkNoShows({
        handle: drizzle(reconciler, { schema }),
        limit: 1,
        now: new Date('2030-06-15T16:30:00.000Z'),
      });
      await waitForDatabaseLock(reconcilerPid);
      await correction.query('COMMIT');
      correctionOpen = false;

      await expect(reconciliation).resolves.toEqual({ scanned: 1, recorded: 0 });

      reconciliation = null;

      expect((await pool.query('SELECT count(*)::int AS count FROM network_no_show_event WHERE salon_id=\'a\' AND state=\'active\'')).rows[0].count).toBe(0);
    } finally {
      if (correctionOpen) {
        await correction.query('ROLLBACK');
      }
      if (reconciliation) {
        await reconciliation.catch(() => undefined);
      }
      correction.release();
      reconciler.release();
    }
  });

  postgresCase('publishes concurrent early marks exactly once before the scheduled start', async () => {
    await pool.query('DELETE FROM network_no_show_event WHERE id=\'event\'');
    const markedAt = new Date('2030-06-15T13:00:00.000Z');
    await db.transaction(tx => auditNoShowReportInTx(tx, { salonId: 'a', appointmentId: 'appt', previousStatus: 'confirmed', actorId: 'owner-one', actorRole: 'admin', report: { reason: 'confirmed_nonattendance' }, now: markedAt }));
    const results = await Promise.all(['owner-one', 'owner-two'].map(actorId => db.transaction(tx => recordNetworkNoShowInTx(tx, {
      salonId: 'a',
      appointmentId: 'appt',
      actorId,
      actorRole: 'admin',
      now: markedAt,
    }))));

    expect(results.sort()).toEqual([false, true]);

    const events = await pool.query('SELECT marked_at, state FROM network_no_show_event WHERE salon_id=\'a\' AND appointment_id=\'appt\'');

    expect(events.rows).toEqual([{ marked_at: markedAt, state: 'active' }]);
    await expect(readNetworkNoShowRisk({ salonId: 'b', phone: '4165551000', email: 'x@example.com', handle: db, now: markedAt })).resolves.toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });
  });

  afterAll(() => {
    expect(completedTests).toBe(8);

    process.stdout.write(`NETWORK_NO_SHOW_POSTGRES_TESTS_EXECUTED=${completedTests} NETWORK_NO_SHOW_POSTGRES_TESTS_SKIPPED=0\n`);
  });

  postgresCase('a committed customer review fences a waiting duplicate publisher', async () => {
    const reviewer = await pool.connect();
    const publisher = await pool.connect();
    try {
      // This suite reuses only the disposable database created above.
      await pool.query('UPDATE appointment SET status=\'no_show\' WHERE id=\'appt\'');
      await pool.query('UPDATE network_no_show_event SET state=\'active\', suppression_reason=null WHERE id=\'event\'');
      await pool.query('DELETE FROM appointment_audit_log WHERE appointment_id=\'appt\'');
      await reviewer.query('BEGIN');
      await reviewer.query('SELECT id FROM appointment WHERE salon_id=\'a\' AND id=\'appt\' FOR UPDATE');
      await requestNoShowReviewInTx(drizzle(reviewer, { schema }), { salonId: 'a', appointmentId: 'appt', reason: 'Customer disputes the recorded nonattendance.', now });
      await publisher.query('BEGIN');
      const publisherPid = (await publisher.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
      const pending = recordNetworkNoShowInTx(drizzle(publisher, { schema }), { salonId: 'a', appointmentId: 'appt', actorId: 'stale-owner', actorRole: 'admin', now });
      await waitForDatabaseLock(publisherPid);
      await reviewer.query('COMMIT');

      expect(await pending).toBe(false);

      await publisher.query('COMMIT');

      expect((await pool.query('SELECT state, suppression_reason FROM network_no_show_event WHERE id=\'event\'')).rows[0]).toEqual({ state: 'suppressed', suppression_reason: 'customer_review' });
      expect(await readNetworkNoShowRisk({ salonId: 'b', phone: '4165551000', email: 'x@example.com', handle: db, now })).toMatchObject({ activeNoShowCount: 0 });
    } finally {
      await reviewer.query('ROLLBACK');
      await publisher.query('ROLLBACK');
      reviewer.release();
      publisher.release();
    }
  });
});
