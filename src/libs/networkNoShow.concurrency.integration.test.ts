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
  recordNetworkNoShowInTx,
  registerNetworkBookingInTx,
  suppressNetworkNoShowSubjectInTx,
} from '@/libs/networkNoShow.server';
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

  it('serializes a locked risk decision before source correction', async () => {
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

  it('erasure wins after an in-flight record transaction releases its subject lock', async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      await first.query('DELETE FROM network_no_show_event WHERE id=\'event\'');
      await recordNetworkNoShowInTx(drizzle(first, { schema }), { salonId: 'a', appointmentId: 'appt', actorId: 'owner', actorRole: 'owner', now });
      await second.query('BEGIN');
      await second.query('SET LOCAL statement_timeout=\'300ms\'');

      await expect(eraseNetworkNoShowSubjectInTx(drizzle(second, { schema }), { subjectId: 'subject', operatorId: 'op', now })).rejects.toMatchObject({ code: '57014' });

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

  it('blocks publication during disable and preserves the original eligible cohort on re-enable', async () => {
    const publisher = await pool.connect();
    const disabler = await pool.connect();
    try {
      await publisher.query('BEGIN');
      await publisher.query('DELETE FROM network_no_show_event WHERE id=\'event\'');
      await recordNetworkNoShowInTx(drizzle(publisher, { schema }), { salonId: 'a', appointmentId: 'appt', actorId: 'owner', actorRole: 'owner', now });

      await disabler.query('BEGIN');
      await disabler.query('SET LOCAL statement_timeout=\'300ms\'');

      await expect(disableNetworkNoShowPlatformInTx(drizzle(disabler, { schema }), { operatorId: 'op', now })).rejects.toMatchObject({ code: '57014' });

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

  it('orders risk read, disable, and same-booking registration through participation first', async () => {
    const booking = await pool.connect();
    const disabler = await pool.connect();
    try {
      await booking.query('BEGIN');
      const bookingDb = drizzle(booking, { schema });
      await readNetworkNoShowRisk({ salonId: 'b', phone: '4165551000', email: 'x@example.com', handle: bookingDb });
      await disabler.query('BEGIN');
      await disabler.query('SET LOCAL statement_timeout=\'300ms\'');

      await expect(disableNetworkNoShowPlatformInTx(drizzle(disabler, { schema }), { operatorId: 'op', now })).rejects.toMatchObject({ code: '57014' });

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

  it('does not let disable lock bindings ahead of an in-flight subject suppression', async () => {
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

  afterAll(() => process.stdout.write('NETWORK_NO_SHOW_POSTGRES_TESTS_EXECUTED=5 NETWORK_NO_SHOW_POSTGRES_TESTS_SKIPPED=0\n'));
});
