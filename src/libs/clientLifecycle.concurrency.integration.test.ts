/**
 * Genuine PostgreSQL coverage for stale client references racing a merge.
 *
 * PGlite uses one connection, so it cannot prove the row-lock barrier in
 * resolve_merged_salon_client_reference(). This opt-in suite uses independent
 * PostgreSQL sessions and refuses anything except an explicitly local database
 * whose name signals that it is disposable.
 *
 * Example:
 *   docker run -d --name luster-client-merge-pg \
 *     -e POSTGRES_PASSWORD=qa -e POSTGRES_USER=qa -e POSTGRES_DB=luster_qa \
 *     -p 55432:5432 postgres:16
 *   CONCURRENCY_TEST_DATABASE_URL=postgres://qa:qa@127.0.0.1:55432/luster_qa \
 *     npx vitest run src/libs/clientLifecycle.concurrency.integration.test.ts
 *
 * Recreate the throwaway database after changing an already-applied migration;
 * Drizzle intentionally does not reapply journaled migrations.
 */
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { mergeSalonClients } from './clientLifecycle';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
const THROWAWAY_DATABASE_NAME = /(?:^|[_-])(?:test|tests|qa|throwaway|temp|tmp)(?:[_-]|$)/i;

function isExplicitLocalThrowawayDatabase(rawUrl: string): boolean {
  if (!rawUrl) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));

    return (
      (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:')
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
      && parsed.port.length > 0
      && THROWAWAY_DATABASE_NAME.test(databaseName)
      && !rawUrl.includes('neon.tech')
    );
  } catch {
    return false;
  }
}

const IS_LOCAL_THROWAWAY = isExplicitLocalThrowawayDatabase(RAW_URL);
const suite = IS_LOCAL_THROWAWAY ? describe : describe.skip;

const SALON_ID = 'salon_client_merge_concurrency';
const PRIMARY_ID = 'client_merge_concurrency_primary';
const DUPLICATE_ID = 'client_merge_concurrency_duplicate';
const ACTOR_ID = 'client_merge_concurrency_admin';
const HISTORIC_PHONE = '4165550102';
const PRIMARY_PHONE = '4165550101';
const SERVICE_APPLICATION_NAME = 'client-merge-concurrency-service';

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

function session(applicationName: string): pg.Client {
  return new pg.Client({
    connectionString: RAW_URL,
    application_name: applicationName,
  });
}

async function waitForLockWait(
  observer: pg.Client,
  applicationName: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const waiting = await observer.query<{ waiting: boolean }>(
      `select exists (
        select 1
        from pg_stat_activity
        where application_name = $1
          and state = 'active'
          and wait_event_type = 'Lock'
      ) as waiting`,
      [applicationName],
    );

    if (waiting.rows[0]?.waiting === true) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for PostgreSQL session ${applicationName} to block on a lock.`);
}

async function expectStillPending<T>(promise: Promise<T>): Promise<void> {
  const outcome = await Promise.race([
    promise.then(
      () => 'settled',
      () => 'settled',
    ),
    new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 75)),
  ]);

  expect(outcome).toBe('pending');
}

async function seedClients(): Promise<void> {
  await pool.query(
    `delete from audit_log
     where actor_id = $1
       or entity_id = any($2::text[])`,
    [ACTOR_ID, [PRIMARY_ID, DUPLICATE_ID]],
  );
  await pool.query('delete from salon where id = $1', [SALON_ID]);

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Client Merge Concurrency Salon',
    slug: 'client-merge-concurrency-salon',
  });
  await db.insert(schema.salonClientSchema).values([
    {
      id: PRIMARY_ID,
      salonId: SALON_ID,
      phone: PRIMARY_PHONE,
      fullName: 'Primary Racer',
    },
    {
      id: DUPLICATE_ID,
      salonId: SALON_ID,
      phone: HISTORIC_PHONE,
      fullName: 'Duplicate Racer',
    },
  ]);
}

async function loadClients() {
  const clients = await db
    .select()
    .from(schema.salonClientSchema)
    .where(eq(schema.salonClientSchema.salonId, SALON_ID));

  return {
    primary: clients.find(client => client.id === PRIMARY_ID)!,
    duplicate: clients.find(client => client.id === DUPLICATE_ID)!,
  };
}

async function loadAppointment(appointmentId: string) {
  const [appointment] = await db
    .select()
    .from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, appointmentId));

  return appointment;
}

suite('client merge stale-reference trigger — genuine concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({
      connectionString: RAW_URL,
      application_name: SERVICE_APPLICATION_NAME,
      max: 5,
    });
    db = drizzle(pool, { schema });
    holder.db = db;

    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 60_000);

  beforeEach(async () => {
    await seedClients();
  });

  afterAll(async () => {
    if (!pool) {
      return;
    }

    await pool.query(
      `delete from audit_log
       where actor_id = $1
         or entity_id = any($2::text[])`,
      [ACTOR_ID, [PRIMARY_ID, DUPLICATE_ID]],
    );
    await pool.query('delete from salon where id = $1', [SALON_ID]);
    await pool.end();
  });

  it('preserves the v1.33 full phone conflict target after migration 0061', async () => {
    const result = await pool.query<{ id: string }>(
      `insert into salon_client (id, salon_id, phone, full_name)
       values ('v133_conflict_probe', $1, $2, 'Compatibility Probe')
       on conflict (salon_id, phone)
       do update set updated_at = now()
       returning id`,
      [SALON_ID, PRIMARY_PHONE],
    );

    expect(result.rows).toEqual([{ id: PRIMARY_ID }]);
  });

  it('relinks an insert that locks the duplicate before the real merge starts', async () => {
    const appointmentId = 'appointment_insert_before_merge';
    const writer = session('client-merge-concurrency-writer-first');
    const observer = session('client-merge-concurrency-observer-first');
    let writerInTransaction = false;
    let mergePromise: ReturnType<typeof mergeSalonClients> | null = null;

    await Promise.all([writer.connect(), observer.connect()]);

    try {
      const { primary, duplicate } = await loadClients();

      await writer.query('begin');
      writerInTransaction = true;
      await writer.query(
        `insert into appointment (
          id, salon_id, salon_client_id, client_phone, client_name,
          start_time, end_time, status, total_price, total_duration_minutes
        ) values (
          $1, $2, $3, $4, 'Historic Snapshot',
          '2099-10-01T15:00:00.000Z', '2099-10-01T16:00:00.000Z',
          'confirmed', 6500, 60
        )`,
        [appointmentId, SALON_ID, DUPLICATE_ID, HISTORIC_PHONE],
      );

      mergePromise = mergeSalonClients({
        salonId: SALON_ID,
        primaryClientId: PRIMARY_ID,
        duplicateClientId: DUPLICATE_ID,
        expectedPrimaryUpdatedAt: primary.updatedAt,
        expectedDuplicateUpdatedAt: duplicate.updatedAt,
        actor: { id: ACTOR_ID, role: 'owner' },
      });

      await waitForLockWait(observer, SERVICE_APPLICATION_NAME);
      await expectStillPending(mergePromise);

      await writer.query('commit');
      writerInTransaction = false;

      const mergeResult = await mergePromise;

      expect(mergeResult.idempotent).toBe(false);

      const appointment = await loadAppointment(appointmentId);

      expect(appointment).toMatchObject({
        salonClientId: PRIMARY_ID,
        clientPhone: HISTORIC_PHONE,
      });
    } finally {
      if (writerInTransaction) {
        await writer.query('rollback');
      }
      await mergePromise?.catch(() => undefined);
      await Promise.all([writer.end(), observer.end()]);
    }
  }, 15_000);

  it('resolves a stale insert after a source merge update commits first', async () => {
    const appointmentId = 'appointment_merge_before_insert';
    const merger = session('client-merge-concurrency-merger-first');
    const writerApplicationName = 'client-merge-concurrency-writer-second';
    const writer = session(writerApplicationName);
    const observer = session('client-merge-concurrency-observer-second');
    let mergerInTransaction = false;
    let insertPromise: Promise<pg.QueryResult> | null = null;

    await Promise.all([merger.connect(), writer.connect(), observer.connect()]);

    try {
      await merger.query('begin');
      mergerInTransaction = true;
      await merger.query(
        `select id
         from salon
         where id = $1
         for update`,
        [SALON_ID],
      );
      await merger.query(
        `select id
         from salon_client
         where salon_id = $1
           and id = any($2::text[])
         order by id
         for update`,
        [SALON_ID, [PRIMARY_ID, DUPLICATE_ID]],
      );
      await merger.query(
        `update salon_client
         set merged_into_client_id = $1,
             merged_at = now(),
             merged_by = $2,
             archived_at = now(),
             archived_by = $2,
             updated_at = now()
         where salon_id = $3
           and id = $4`,
        [PRIMARY_ID, ACTOR_ID, SALON_ID, DUPLICATE_ID],
      );

      insertPromise = writer.query(
        `insert into appointment (
          id, salon_id, salon_client_id, client_phone, client_name,
          start_time, end_time, status, total_price, total_duration_minutes
        ) values (
          $1, $2, $3, $4, 'Historic Snapshot',
          '2099-10-02T15:00:00.000Z', '2099-10-02T16:00:00.000Z',
          'confirmed', 6500, 60
        )`,
        [appointmentId, SALON_ID, DUPLICATE_ID, HISTORIC_PHONE],
      );

      await waitForLockWait(observer, writerApplicationName);
      await expectStillPending(insertPromise);

      await merger.query('commit');
      mergerInTransaction = false;
      await insertPromise;

      const appointment = await loadAppointment(appointmentId);

      expect(appointment).toMatchObject({
        salonClientId: PRIMARY_ID,
        clientPhone: HISTORIC_PHONE,
      });
    } finally {
      if (mergerInTransaction) {
        await merger.query('rollback');
      }
      await insertPromise?.catch(() => undefined);
      await Promise.all([merger.end(), writer.end(), observer.end()]);
    }
  }, 15_000);

  it('serializes opposing merge attempts without a deadlock or split history', async () => {
    const appointmentId = 'appointment_opposing_merge';
    await db.insert(schema.appointmentSchema).values({
      id: appointmentId,
      salonId: SALON_ID,
      salonClientId: DUPLICATE_ID,
      clientPhone: HISTORIC_PHONE,
      clientName: 'Opposing Merge Snapshot',
      startTime: new Date('2099-10-03T15:00:00.000Z'),
      endTime: new Date('2099-10-03T16:00:00.000Z'),
      status: 'confirmed',
      totalPrice: 6500,
      totalDurationMinutes: 60,
    });
    const { primary, duplicate } = await loadClients();

    const opposingMerges = Promise.allSettled([
      mergeSalonClients({
        salonId: SALON_ID,
        primaryClientId: primary.id,
        duplicateClientId: duplicate.id,
        expectedPrimaryUpdatedAt: primary.updatedAt,
        expectedDuplicateUpdatedAt: duplicate.updatedAt,
        actor: { id: ACTOR_ID, role: 'owner' },
      }),
      mergeSalonClients({
        salonId: SALON_ID,
        primaryClientId: duplicate.id,
        duplicateClientId: primary.id,
        expectedPrimaryUpdatedAt: duplicate.updatedAt,
        expectedDuplicateUpdatedAt: primary.updatedAt,
        actor: { id: ACTOR_ID, role: 'owner' },
      }),
    ]);

    let deadlockTimer: ReturnType<typeof setTimeout> | undefined;
    const deadlockTimeout = new Promise<never>((_, reject) => {
      deadlockTimer = setTimeout(
        () => reject(new Error('Opposing merge attempts deadlocked.')),
        5_000,
      );
    });
    const results = await Promise.race([opposingMerges, deadlockTimeout])
      .finally(() => clearTimeout(deadlockTimer));

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);

    const clients = Object.values(await loadClients());
    const survivor = clients.find(client => client.mergedIntoClientId === null);
    const source = clients.find(client => client.mergedIntoClientId !== null);

    expect(survivor).toBeDefined();
    expect(source).toMatchObject({
      archivedAt: expect.any(Date),
      mergedIntoClientId: survivor!.id,
    });
    expect(await loadAppointment(appointmentId)).toMatchObject({
      salonClientId: survivor!.id,
      clientPhone: HISTORIC_PHONE,
    });
  }, 15_000);

  it('rejects a stale operational update after the source merge commits', async () => {
    const merger = session('client-merge-concurrency-profile-merger');
    const writerApplicationName = 'client-merge-concurrency-profile-writer';
    const writer = session(writerApplicationName);
    const observer = session('client-merge-concurrency-profile-observer');
    let mergerInTransaction = false;
    let updatePromise: Promise<pg.QueryResult> | null = null;

    await Promise.all([merger.connect(), writer.connect(), observer.connect()]);

    try {
      await merger.query('begin');
      mergerInTransaction = true;
      await merger.query(
        `select id
         from salon
         where id = $1
         for update`,
        [SALON_ID],
      );
      await merger.query(
        `select id
         from salon_client
         where salon_id = $1
           and id = any($2::text[])
         order by id
         for update`,
        [SALON_ID, [PRIMARY_ID, DUPLICATE_ID]],
      );
      await merger.query(
        `update salon_client
         set merged_into_client_id = $1,
             merged_at = now(),
             merged_by = $2,
             archived_at = now(),
             archived_by = $2,
             loyalty_points = 0,
             updated_at = now()
         where salon_id = $3
           and id = $4`,
        [PRIMARY_ID, ACTOR_ID, SALON_ID, DUPLICATE_ID],
      );

      updatePromise = writer.query(
        `update salon_client
         set loyalty_points = 999,
             has_google_review = true,
             google_review_marked_at = now(),
             google_review_marked_by = $1,
             updated_at = now()
         where salon_id = $2
           and id = $3`,
        [ACTOR_ID, SALON_ID, DUPLICATE_ID],
      );
      const updateOutcome = updatePromise.then(
        result => ({ status: 'fulfilled' as const, result }),
        error => ({ status: 'rejected' as const, error }),
      );

      await waitForLockWait(observer, writerApplicationName);
      await expectStillPending(updatePromise);

      await merger.query('commit');
      mergerInTransaction = false;

      const outcome = await updateOutcome;

      expect(outcome).toMatchObject({
        status: 'rejected',
        error: { code: '55000' },
      });

      const { duplicate } = await loadClients();

      expect(duplicate).toMatchObject({
        mergedIntoClientId: PRIMARY_ID,
        loyaltyPoints: 0,
        hasGoogleReview: false,
        googleReviewMarkedAt: null,
        googleReviewMarkedBy: null,
      });
    } finally {
      if (mergerInTransaction) {
        await merger.query('rollback');
      }
      await updatePromise?.catch(() => undefined);
      await Promise.all([merger.end(), writer.end(), observer.end()]);
    }
  }, 15_000);
});
