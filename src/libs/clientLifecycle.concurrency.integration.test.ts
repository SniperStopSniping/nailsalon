import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type LifecycleSqlHandle,
  lockTerminalSalonClientsWithHandle,
  resolveTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
} from './clientLifecycleStabilization';
import { purgeSalonGroups, type PurgeTx } from './salonPurge';

vi.mock('server-only', () => ({}));

const { Client, Pool } = pg;
const databaseUrl = process.env.CONCURRENCY_TEST_DATABASE_URL;
if (databaseUrl) {
  const hostname = new URL(databaseUrl).hostname;
  const isLoopback = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1';
  if (
    !isLoopback
    || process.env.CLIENT_LIFECYCLE_DISPOSABLE_DATABASE_CONFIRMED !== 'true'
  ) {
    throw new Error(
      'Lifecycle concurrency tests require an explicitly confirmed loopback disposable database.',
    );
  }
}
const describePostgres = databaseUrl ? describe : describe.skip;

async function resetDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('drop schema if exists drizzle cascade');
  await pool.query('drop schema if exists public cascade');
  await pool.query('create schema public');
}

async function migrationFolderThrough0061(): Promise<string> {
  const source = path.join(process.cwd(), 'migrations');
  const destination = await fs.mkdtemp(
    path.join(os.tmpdir(), 'client-lifecycle-concurrency-'),
  );
  await fs.mkdir(path.join(destination, 'meta'));
  const journal = JSON.parse(
    await fs.readFile(path.join(source, 'meta', '_journal.json'), 'utf8'),
  ) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const selectedEntries = journal.entries.filter(entry => entry.idx <= 61);
  await fs.writeFile(
    path.join(destination, 'meta', '_journal.json'),
    `${JSON.stringify({ ...journal, entries: selectedEntries }, null, 2)}\n`,
  );
  await Promise.all(selectedEntries.map(async (entry) => {
    await fs.copyFile(
      path.join(source, `${entry.tag}.sql`),
      path.join(destination, `${entry.tag}.sql`),
    );
  }));
  return destination;
}

async function applyMigrations(
  pool: pg.Pool,
  migrationsFolder: string,
): Promise<void> {
  await migrate(drizzle(pool), {
    migrationsFolder,
  });
}

async function seedLifecycle(pool: pg.Pool): Promise<void> {
  await pool.query(`
    insert into salon (id, name, slug, theme_key)
    values
      ('lifecycle-salon-a', 'Lifecycle A', 'lifecycle-a', 'minimal'),
      ('lifecycle-salon-b', 'Lifecycle B', 'lifecycle-b', 'minimal')
  `);
  await pool.query(`
    insert into technician (id, salon_id, name)
    values ('lifecycle-tech', 'lifecycle-salon-a', 'Lifecycle Tech')
  `);
  await pool.query(`
    insert into salon_client (
      id, salon_id, phone, full_name, created_at, updated_at
    )
    values
      (
        'lifecycle-primary',
        'lifecycle-salon-a',
        '4165550101',
        'Primary Fixture',
        now(),
        now()
      ),
      (
        'lifecycle-middle',
        'lifecycle-salon-a',
        '4165550102',
        'Middle Fixture',
        now(),
        now()
      ),
      (
        'lifecycle-source',
        'lifecycle-salon-a',
        '4165550103',
        'Source Fixture',
        now(),
        now()
      ),
      (
        'lifecycle-lock-a',
        'lifecycle-salon-a',
        '4165550104',
        'Lock A',
        now(),
        now()
      ),
      (
        'lifecycle-lock-b',
        'lifecycle-salon-a',
        '4165550105',
        'Lock B',
        now(),
        now()
      ),
      (
        'lifecycle-archived',
        'lifecycle-salon-a',
        '4165550106',
        'Archived Fixture',
        now(),
        now()
      ),
      (
        'lifecycle-foreign',
        'lifecycle-salon-b',
        '4165550201',
        'Foreign Fixture',
        now(),
        now()
      )
  `);
  await pool.query(`
    update salon_client
    set preferred_technician_id = 'lifecycle-tech'
    where salon_id = 'lifecycle-salon-a'
  `);
  await pool.query(`
    update salon_client
    set archived_at = now(),
        archived_by = 'test'
    where id = 'lifecycle-archived'
  `);
  await pool.query(`
    update salon_client
    set
      archived_at = now(),
      archived_by = 'test',
      merged_into_client_id = 'lifecycle-primary',
      merged_at = now(),
      merged_by = 'test'
    where id = 'lifecycle-middle'
  `);
  await pool.query(`
    update salon_client
    set
      archived_at = now(),
      archived_by = 'test',
      merged_into_client_id = 'lifecycle-middle',
      merged_at = now(),
      merged_by = 'test'
    where id = 'lifecycle-source'
  `);
}

async function waitForLockWait(
  observer: pg.Client,
  applicationName: string,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const result = await observer.query<{ waiting: boolean }>(
      `select exists (
         select 1
         from pg_stat_activity
         where application_name = $1
           and wait_event_type = 'Lock'
       ) as waiting`,
      [applicationName],
    );
    if (result.rows[0]?.waiting) {
      return;
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for deterministic PostgreSQL lock state.');
}

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createBarrier(participants: number): () => Promise<void> {
  const released = createDeferred();
  let arrivals = 0;

  return async () => {
    arrivals += 1;
    if (arrivals === participants) {
      released.resolve();
    }
    await released.promise;
  };
}

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }
  return candidate.cause === error
    ? null
    : databaseErrorCode(candidate.cause);
}

const retryWithoutDelay = {
  sleep: async () => {},
  random: () => 0,
};

describePostgres.sequential('client lifecycle PostgreSQL concurrency', () => {
  let pool: pg.Pool;
  let through0061Folder: string | undefined;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      application_name: 'client-lifecycle-concurrency-suite',
    });
    through0061Folder = await migrationFolderThrough0061();
    await resetDatabase(pool);
    await applyMigrations(pool, through0061Folder);
    await seedLifecycle(pool);
    await applyMigrations(pool, path.join(process.cwd(), 'migrations'));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (through0061Folder) {
      await fs.rm(through0061Folder, { recursive: true, force: true });
    }
  });

  it('resolves a three-client chain and keeps merge creation disabled', async () => {
    await expect(resolveTerminalSalonClientWithHandle(
      drizzle(pool) as LifecycleSqlHandle,
      {
        salonId: 'lifecycle-salon-a',
        clientId: 'lifecycle-source',
      },
    )).resolves.toMatchObject({
      id: 'lifecycle-primary',
      lineagePath: [
        'lifecycle-source',
        'lifecycle-middle',
        'lifecycle-primary',
      ],
    });

    await expect(pool.query(`
      update salon_client
      set merged_into_client_id = 'lifecycle-lock-a'
      where id = 'lifecycle-lock-b'
    `)).rejects.toMatchObject({ code: '55000' });
    await expect(pool.query(`
      update salon_client
      set notes = 'old writer remains compatible'
      where id = 'lifecycle-source'
    `)).resolves.toBeDefined();
    await expect(pool.query(`
      update salon_client
      set archived_at = null
      where id = 'lifecycle-source'
    `)).rejects.toMatchObject({ code: '55000' });
  });

  it('terminalizes every same-salon child trigger and rejects foreign clients', async () => {
    await pool.query(`
      insert into appointment (
        id,
        salon_id,
        salon_client_id,
        client_phone,
        client_name,
        start_time,
        end_time,
        status,
        total_price,
        total_duration_minutes
      )
      values (
        'lifecycle-appointment',
        'lifecycle-salon-a',
        'lifecycle-source',
        'historic-snapshot',
        'Historical Snapshot',
        '2027-01-01T15:00:00Z',
        '2027-01-01T16:00:00Z',
        'confirmed',
        7500,
        60
      )
    `);
    await pool.query(`
      insert into review (
        id,
        salon_id,
        appointment_id,
        salon_client_id,
        rating
      )
      values (
        'lifecycle-review',
        'lifecycle-salon-a',
        'lifecycle-appointment',
        'lifecycle-source',
        5
      )
    `);
    await pool.query(`
      insert into client_communication (
        id, salon_id, salon_client_id, kind, status
      )
      values (
        'lifecycle-communication',
        'lifecycle-salon-a',
        'lifecycle-source',
        'promo_6w',
        'dismissed'
      )
    `);
    await pool.query(`
      insert into retention_campaign (
        id,
        salon_id,
        salon_client_id,
        communication_id,
        token_hash,
        stage,
        promotion_snapshot,
        expires_at
      )
      values (
        'lifecycle-campaign',
        'lifecycle-salon-a',
        'lifecycle-source',
        'lifecycle-communication',
        'lifecycle-token-hash',
        'promo_6w',
        '{}'::jsonb,
        '2027-02-01T00:00:00Z'
      )
    `);
    await pool.query(`
      insert into fraud_signal (
        id,
        salon_id,
        salon_client_id,
        appointment_id,
        type,
        severity,
        reason
      )
      values (
        'lifecycle-fraud',
        'lifecycle-salon-a',
        'lifecycle-source',
        'lifecycle-appointment',
        'HIGH_APPOINTMENT_FREQUENCY',
        'MEDIUM',
        'Synthetic lifecycle trigger fixture'
      )
    `);
    await pool.query(`
      insert into salon_client_note (
        id, salon_id, salon_client_id, body, created_by
      )
      values (
        'lifecycle-note',
        'lifecycle-salon-a',
        'lifecycle-source',
        'Synthetic note',
        'test'
      )
    `);
    await pool.query(`
      insert into salon_client_contact_alias (
        salon_id, salon_client_id, kind, normalized_value
      )
      values (
        'lifecycle-salon-a',
        'lifecycle-source',
        'phone',
        '4165550199'
      )
    `);

    for (const table of [
      'appointment',
      'review',
      'client_communication',
      'retention_campaign',
      'fraud_signal',
      'salon_client_note',
      'salon_client_contact_alias',
    ]) {
      const result = await pool.query<{ count: string }>(
        `select count(*)::text as count
         from ${table}
         where salon_id = 'lifecycle-salon-a'
           and salon_client_id = 'lifecycle-primary'`,
      );

      expect(Number(result.rows[0]?.count ?? 0)).toBeGreaterThan(0);
    }
    const snapshot = await pool.query<{ client_phone: string }>(
      `select client_phone
       from appointment
       where id = 'lifecycle-appointment'`,
    );

    expect(snapshot.rows[0]?.client_phone).toBe('historic-snapshot');

    await pool.query(`
      insert into appointment (
        id,
        salon_id,
        salon_client_id,
        client_phone,
        start_time,
        end_time,
        status,
        total_price,
        total_duration_minutes
      )
      values (
        'archived-client-appointment',
        'lifecycle-salon-a',
        'lifecycle-archived',
        'historic-archived-snapshot',
        '2027-01-02T15:00:00Z',
        '2027-01-02T16:00:00Z',
        'confirmed',
        7500,
        60
      )
    `);
    const archivedReference = await pool.query<{ salon_client_id: string }>(
      `select salon_client_id
       from appointment
       where id = 'archived-client-appointment'`,
    );

    expect(archivedReference.rows[0]?.salon_client_id).toBe(
      'lifecycle-archived',
    );

    const foreignStatements = [
      `insert into appointment (
         id, salon_id, salon_client_id, client_phone, start_time, end_time,
         status, total_price, total_duration_minutes
       ) values (
         'foreign-appointment', 'lifecycle-salon-a', 'lifecycle-foreign',
         'snapshot', '2027-03-01T15:00:00Z', '2027-03-01T16:00:00Z',
         'confirmed', 1000, 60
       )`,
      `insert into client_communication (
         id, salon_id, salon_client_id, kind, status
       ) values (
         'foreign-communication', 'lifecycle-salon-a', 'lifecycle-foreign',
         'rebook', 'dismissed'
       )`,
      `insert into retention_campaign (
         id, salon_id, salon_client_id, token_hash, stage,
         promotion_snapshot, expires_at
       ) values (
         'foreign-campaign', 'lifecycle-salon-a', 'lifecycle-foreign',
         'foreign-token-hash', 'promo_6w', '{}'::jsonb,
         '2027-03-01T00:00:00Z'
       )`,
      `insert into salon_client_note (
         id, salon_id, salon_client_id, body, created_by
       ) values (
         'foreign-note', 'lifecycle-salon-a', 'lifecycle-foreign',
         'Synthetic note', 'test'
       )`,
      `insert into salon_client_contact_alias (
         salon_id, salon_client_id, kind, normalized_value
       ) values (
         'lifecycle-salon-a', 'lifecycle-foreign', 'phone', '4165550299'
       )`,
    ];
    for (const statement of foreignStatements) {
      await expect(pool.query(statement)).rejects.toMatchObject({
        code: '23514',
      });
    }

    await pool.query(`
      insert into appointment (
        id,
        salon_id,
        salon_client_id,
        client_phone,
        start_time,
        end_time,
        status,
        total_price,
        total_duration_minutes
      )
      values (
        'foreign-dependent-appointment',
        'lifecycle-salon-a',
        'lifecycle-primary',
        'snapshot',
        '2027-04-01T15:00:00Z',
        '2027-04-01T16:00:00Z',
        'confirmed',
        1000,
        60
      )
    `);

    await expect(pool.query(`
      insert into review (
        id, salon_id, appointment_id, salon_client_id, rating
      )
      values (
        'foreign-review',
        'lifecycle-salon-a',
        'foreign-dependent-appointment',
        'lifecycle-foreign',
        5
      )
    `)).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`
      insert into fraud_signal (
        id, salon_id, salon_client_id, appointment_id, type, reason
      )
      values (
        'foreign-fraud',
        'lifecycle-salon-a',
        'lifecycle-foreign',
        'foreign-dependent-appointment',
        'HIGH_APPOINTMENT_FREQUENCY',
        'Synthetic lifecycle trigger fixture'
      )
    `)).rejects.toMatchObject({ code: '23514' });
  });

  it('serializes opposing client lock requests in deterministic ID order', async () => {
    const first = new Client({
      connectionString: databaseUrl,
      application_name: 'client-lifecycle-lock-first',
    });
    const second = new Client({
      connectionString: databaseUrl,
      application_name: 'client-lifecycle-lock-second',
    });
    const observer = new Client({
      connectionString: databaseUrl,
      application_name: 'client-lifecycle-lock-observer',
    });
    await Promise.all([first.connect(), second.connect(), observer.connect()]);

    try {
      await Promise.all([first.query('begin'), second.query('begin')]);
      await lockTerminalSalonClientsWithHandle(
        drizzle(first) as LifecycleSqlHandle,
        {
          salonId: 'lifecycle-salon-a',
          clientIds: ['lifecycle-lock-b', 'lifecycle-lock-a'],
        },
      );
      const secondLock = lockTerminalSalonClientsWithHandle(
        drizzle(second) as LifecycleSqlHandle,
        {
          salonId: 'lifecycle-salon-a',
          clientIds: ['lifecycle-lock-a', 'lifecycle-lock-b'],
        },
      );
      await waitForLockWait(observer, 'client-lifecycle-lock-second');
      await first.query('commit');

      await expect(secondLock).resolves.toHaveLength(2);

      await second.query('commit');
    } finally {
      await Promise.all([
        first.query('rollback').catch(() => undefined),
        second.query('rollback').catch(() => undefined),
      ]);
      await Promise.all([first.end(), second.end(), observer.end()]);
    }
  });

  it('serializes points redemption with cancellation without a lost or duplicate refund', async () => {
    const observer = new Client({
      connectionString: databaseUrl,
      application_name: 'client-lifecycle-reward-cancel-observer',
    });
    await observer.connect();

    const seedAppointment = async (appointmentId: string) => {
      await pool.query(
        `delete from appointment where id = $1`,
        [appointmentId],
      );
      await pool.query(
        `update salon_client
         set loyalty_points = 1000
         where salon_id = 'lifecycle-salon-a'
           and id = 'lifecycle-primary'`,
      );
      await pool.query(
        `insert into appointment (
           id,
           salon_id,
           salon_client_id,
           client_phone,
           client_name,
           start_time,
           end_time,
           status,
           total_price,
           total_duration_minutes,
           notes
         )
         values (
           $1,
           'lifecycle-salon-a',
           'lifecycle-primary',
           'historic-reward-phone',
           'Historical Snapshot',
           '2027-05-01T15:00:00Z',
           '2027-05-01T16:00:00Z',
           'confirmed',
           5000,
           60,
           null
         )`,
        [appointmentId],
      );
    };

    const beginClient = async (applicationName: string) => {
      const client = new Client({
        connectionString: databaseUrl,
        application_name: applicationName,
      });
      await client.connect();
      await client.query('begin');
      await client.query(`set local statement_timeout = '5s'`);
      return client;
    };

    try {
      // Redemption takes the terminal-client lock first. Cancellation waits,
      // then reads the committed redemption marker under the appointment lock
      // and restores the points exactly once.
      const redemptionFirstId = 'lifecycle-reward-cancel-redemption-first';
      await seedAppointment(redemptionFirstId);
      const redemption = await beginClient(
        'client-lifecycle-redemption-first',
      );
      const cancellation = await beginClient(
        'client-lifecycle-cancel-second',
      );

      try {
        await redemption.query(
          `select id
           from salon_client
           where salon_id = 'lifecycle-salon-a'
             and id = 'lifecycle-primary'
           for update`,
        );
        const cancellationClientLock = cancellation.query(
          `select id
           from salon_client
           where salon_id = 'lifecycle-salon-a'
             and id = 'lifecycle-primary'
           for update`,
        );
        await waitForLockWait(observer, 'client-lifecycle-cancel-second');

        const lockedForRedemption = await redemption.query<{
          status: string;
        }>(
          `select status
           from appointment
           where salon_id = 'lifecycle-salon-a'
             and id = $1
           for update`,
          [redemptionFirstId],
        );

        expect(lockedForRedemption.rows[0]?.status).toBe('confirmed');

        await redemption.query(
          `update appointment
           set
             total_price = total_price - 200,
             notes = '[Points redeemed: Test - 1,000 pts for $2.00 off]'
           where salon_id = 'lifecycle-salon-a'
             and id = $1
             and status in ('pending', 'confirmed')`,
          [redemptionFirstId],
        );
        await redemption.query(
          `update salon_client
           set loyalty_points = loyalty_points - 1000
           where salon_id = 'lifecycle-salon-a'
             and id = 'lifecycle-primary'`,
        );
        await redemption.query('commit');

        await cancellationClientLock;
        const lockedForCancellation = await cancellation.query<{
          notes: string | null;
          status: string;
        }>(
          `select status, notes
           from appointment
           where salon_id = 'lifecycle-salon-a'
             and id = $1
           for update`,
          [redemptionFirstId],
        );
        const cancellationTransition = await cancellation.query(
          `update appointment
           set status = 'cancelled', cancel_reason = 'client_request'
           where salon_id = 'lifecycle-salon-a'
             and id = $1
             and status in ('pending', 'confirmed', 'in_progress')
           returning id`,
          [redemptionFirstId],
        );
        if (
          cancellationTransition.rowCount === 1
          && lockedForCancellation.rows[0]?.notes?.includes('1,000 pts')
        ) {
          await cancellation.query(
            `update salon_client
             set loyalty_points = loyalty_points + 1000
             where salon_id = 'lifecycle-salon-a'
               and id = 'lifecycle-primary'`,
          );
        }
        await cancellation.query('commit');

        const retryCancellation = await pool.connect();
        try {
          await retryCancellation.query('begin');
          await retryCancellation.query(
            `select id
             from salon_client
             where salon_id = 'lifecycle-salon-a'
               and id = 'lifecycle-primary'
             for update`,
          );
          await retryCancellation.query(
            `select id
             from appointment
             where salon_id = 'lifecycle-salon-a'
               and id = $1
             for update`,
            [redemptionFirstId],
          );
          const retry = await retryCancellation.query(
            `update appointment
             set status = 'cancelled', cancel_reason = 'client_request'
             where salon_id = 'lifecycle-salon-a'
               and id = $1
               and status in ('pending', 'confirmed', 'in_progress')
             returning id`,
            [redemptionFirstId],
          );

          expect(retry.rowCount).toBe(0);

          await retryCancellation.query('commit');
        } catch (error) {
          await retryCancellation.query('rollback');
          throw error;
        } finally {
          retryCancellation.release();
        }

        const redemptionFirstResult = await pool.query<{
          client_phone: string;
          loyalty_points: number;
          notes: string | null;
          status: string;
          total_price: number;
        }>(
          `select
             appointment.client_phone,
             appointment.notes,
             appointment.status,
             appointment.total_price,
             salon_client.loyalty_points
           from appointment
           inner join salon_client
             on salon_client.id = appointment.salon_client_id
            and salon_client.salon_id = appointment.salon_id
           where appointment.id = $1`,
          [redemptionFirstId],
        );

        expect(redemptionFirstResult.rows[0]).toEqual({
          client_phone: 'historic-reward-phone',
          loyalty_points: 1000,
          notes: '[Points redeemed: Test - 1,000 pts for $2.00 off]',
          status: 'cancelled',
          total_price: 4800,
        });
      } finally {
        await Promise.all([
          redemption.query('rollback').catch(() => undefined),
          cancellation.query('rollback').catch(() => undefined),
        ]);
        await Promise.all([redemption.end(), cancellation.end()]);
      }

      // Cancellation takes the terminal lock first. Redemption waits, sees the
      // terminal appointment state under lock, and commits no economic change.
      const cancellationFirstId = 'lifecycle-reward-cancel-cancellation-first';
      await seedAppointment(cancellationFirstId);
      const cancellationFirst = await beginClient(
        'client-lifecycle-cancel-first',
      );
      const redemptionSecond = await beginClient(
        'client-lifecycle-redemption-second',
      );

      try {
        await cancellationFirst.query(
          `select id
           from salon_client
           where salon_id = 'lifecycle-salon-a'
             and id = 'lifecycle-primary'
           for update`,
        );
        const redemptionClientLock = redemptionSecond.query(
          `select id
           from salon_client
           where salon_id = 'lifecycle-salon-a'
             and id = 'lifecycle-primary'
           for update`,
        );
        await waitForLockWait(observer, 'client-lifecycle-redemption-second');

        await cancellationFirst.query(
          `select id
           from appointment
           where salon_id = 'lifecycle-salon-a'
             and id = $1
           for update`,
          [cancellationFirstId],
        );
        await cancellationFirst.query(
          `update appointment
           set status = 'cancelled', cancel_reason = 'client_request'
           where salon_id = 'lifecycle-salon-a'
             and id = $1
             and status in ('pending', 'confirmed', 'in_progress')`,
          [cancellationFirstId],
        );
        await cancellationFirst.query('commit');

        await redemptionClientLock;
        const redemptionStatus = await redemptionSecond.query<{
          status: string;
        }>(
          `select status
           from appointment
           where salon_id = 'lifecycle-salon-a'
             and id = $1
           for update`,
          [cancellationFirstId],
        );

        expect(redemptionStatus.rows[0]?.status).toBe('cancelled');

        await redemptionSecond.query('commit');

        const cancellationFirstResult = await pool.query<{
          client_phone: string;
          loyalty_points: number;
          notes: string | null;
          status: string;
          total_price: number;
        }>(
          `select
             appointment.client_phone,
             appointment.notes,
             appointment.status,
             appointment.total_price,
             salon_client.loyalty_points
           from appointment
           inner join salon_client
             on salon_client.id = appointment.salon_client_id
            and salon_client.salon_id = appointment.salon_id
           where appointment.id = $1`,
          [cancellationFirstId],
        );

        expect(cancellationFirstResult.rows[0]).toEqual({
          client_phone: 'historic-reward-phone',
          loyalty_points: 1000,
          notes: null,
          status: 'cancelled',
          total_price: 5000,
        });
      } finally {
        await Promise.all([
          cancellationFirst.query('rollback').catch(() => undefined),
          redemptionSecond.query('rollback').catch(() => undefined),
        ]);
        await Promise.all([cancellationFirst.end(), redemptionSecond.end()]);
      }
    } finally {
      await observer.end();
      await pool.query(
        `delete from appointment
         where id in (
           'lifecycle-reward-cancel-redemption-first',
           'lifecycle-reward-cancel-cancellation-first'
         )`,
      );
    }
  }, 20_000);

  it('recovers one real opposing-row deadlock and commits each idempotent operation once', async () => {
    await pool.query(`
      drop table if exists client_lifecycle_deadlock_commit;
      create table client_lifecycle_deadlock_commit (
        operation_id text primary key,
        committed_at timestamp with time zone not null default now()
      )
    `);

    const firstLocksReady = createBarrier(2);
    const attempts = new Map<string, number>();
    const retryableErrors: string[] = [];

    const runOperation = (
      operationId: string,
      firstClientId: string,
      secondClientId: string,
    ) => withClientLifecycleTransactionRetry(async (attempt) => {
      attempts.set(operationId, attempt);
      const client = await pool.connect();

      try {
        await client.query('begin');
        await client.query(`set local statement_timeout = '5s'`);

        if (attempt === 1) {
          await client.query(
            `select id
             from salon_client
             where salon_id = 'lifecycle-salon-a'
               and id = $1
             for update`,
            [firstClientId],
          );
          await firstLocksReady();
          await client.query(
            `select id
             from salon_client
             where salon_id = 'lifecycle-salon-a'
               and id = $1
             for update`,
            [secondClientId],
          );
        } else {
          await client.query(
            `select id
             from salon_client
             where salon_id = 'lifecycle-salon-a'
               and id = any($1::text[])
             order by id
             for update`,
            [[firstClientId, secondClientId].sort()],
          );
        }

        await client.query(
          `insert into client_lifecycle_deadlock_commit (operation_id)
           values ($1)
           on conflict (operation_id) do nothing`,
          [operationId],
        );
        await client.query('commit');
      } catch (error) {
        const code = databaseErrorCode(error);
        if (code) {
          retryableErrors.push(code);
        }
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }, retryWithoutDelay);

    try {
      await Promise.all([
        runOperation(
          'deadlock-operation-a',
          'lifecycle-lock-a',
          'lifecycle-lock-b',
        ),
        runOperation(
          'deadlock-operation-b',
          'lifecycle-lock-b',
          'lifecycle-lock-a',
        ),
      ]);

      const committed = await pool.query<{
        operation_id: string;
        commit_count: string;
      }>(
        `select operation_id, count(*)::text as commit_count
         from client_lifecycle_deadlock_commit
         group by operation_id
         order by operation_id`,
      );

      expect(retryableErrors.filter(code => code === '40P01')).toHaveLength(1);
      expect([...attempts.values()].sort()).toEqual([1, 2]);
      expect(committed.rows).toEqual([
        { operation_id: 'deadlock-operation-a', commit_count: '1' },
        { operation_id: 'deadlock-operation-b', commit_count: '1' },
      ]);
    } finally {
      await pool.query('drop table if exists client_lifecycle_deadlock_commit');
    }
  }, 15_000);

  it('recovers a real serializable conflict and applies each operation exactly once', async () => {
    await pool.query(`
      drop table if exists client_lifecycle_serializable_operation;
      drop table if exists client_lifecycle_serializable_counter;
      create table client_lifecycle_serializable_counter (
        id text primary key,
        value integer not null
      );
      create table client_lifecycle_serializable_operation (
        operation_id text primary key
      );
      insert into client_lifecycle_serializable_counter (id, value)
      values ('shared', 0)
    `);

    const firstReadsReady = createBarrier(2);
    const attempts = new Map<string, number>();
    const retryableErrors: string[] = [];

    const runOperation = (operationId: string) =>
      withClientLifecycleTransactionRetry(async (attempt) => {
        attempts.set(operationId, attempt);
        const client = await pool.connect();

        try {
          await client.query('begin isolation level serializable');
          await client.query(`set local statement_timeout = '5s'`);
          const snapshot = await client.query<{ value: number }>(
            `select value
             from client_lifecycle_serializable_counter
             where id = 'shared'`,
          );
          if (attempt === 1) {
            await firstReadsReady();
          }

          const inserted = await client.query(
            `insert into client_lifecycle_serializable_operation (operation_id)
             values ($1)
             on conflict (operation_id) do nothing
             returning operation_id`,
            [operationId],
          );
          if (inserted.rowCount === 1) {
            await client.query(
              `update client_lifecycle_serializable_counter
               set value = $1
               where id = 'shared'`,
              [(snapshot.rows[0]?.value ?? 0) + 1],
            );
          }
          await client.query('commit');
        } catch (error) {
          const code = databaseErrorCode(error);
          if (code) {
            retryableErrors.push(code);
          }
          await client.query('rollback').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }, retryWithoutDelay);

    try {
      await Promise.all([
        runOperation('serializable-operation-a'),
        runOperation('serializable-operation-b'),
      ]);

      const counter = await pool.query<{ value: number }>(
        `select value
         from client_lifecycle_serializable_counter
         where id = 'shared'`,
      );
      const operations = await pool.query<{ count: string }>(
        `select count(*)::text as count
         from client_lifecycle_serializable_operation`,
      );

      expect(retryableErrors.filter(code => code === '40001')).toHaveLength(1);
      expect([...attempts.values()].sort()).toEqual([1, 2]);
      expect(counter.rows[0]?.value).toBe(2);
      expect(operations.rows[0]?.count).toBe('2');
    } finally {
      await pool.query(`
        drop table if exists client_lifecycle_serializable_operation;
        drop table if exists client_lifecycle_serializable_counter
      `);
    }
  }, 15_000);

  it('exhausts exactly three attempts when PostgreSQL returns 40001 every time', async () => {
    await pool.query(`
      drop table if exists client_lifecycle_retry_exhaustion;
      create table client_lifecycle_retry_exhaustion (
        id text primary key,
        value integer not null
      );
      insert into client_lifecycle_retry_exhaustion (id, value)
      values ('shared', 0)
    `);

    const observedErrors: string[] = [];
    const attempts: number[] = [];

    try {
      await expect(withClientLifecycleTransactionRetry(async (attempt) => {
        attempts.push(attempt);
        const client = await pool.connect();

        try {
          await client.query('begin isolation level serializable');
          await client.query(`set local statement_timeout = '5s'`);
          const snapshot = await client.query<{ value: number }>(
            `select value
             from client_lifecycle_retry_exhaustion
             where id = 'shared'`,
          );

          const readerReady = createDeferred();
          const conflictingWriter = (async () => {
            await readerReady.promise;
            await pool.query(
              `update client_lifecycle_retry_exhaustion
               set value = value + 1
               where id = 'shared'`,
            );
          })();
          readerReady.resolve();
          await conflictingWriter;

          await client.query(
            `update client_lifecycle_retry_exhaustion
             set value = $1
             where id = 'shared'`,
            [(snapshot.rows[0]?.value ?? 0) + 1],
          );
          await client.query('commit');
        } catch (error) {
          const code = databaseErrorCode(error);
          if (code) {
            observedErrors.push(code);
          }
          await client.query('rollback').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }, retryWithoutDelay)).rejects.toMatchObject({ code: '40001' });

      const counter = await pool.query<{ value: number }>(
        `select value
         from client_lifecycle_retry_exhaustion
         where id = 'shared'`,
      );

      expect(attempts).toEqual([1, 2, 3]);
      expect(observedErrors).toEqual(['40001', '40001', '40001']);
      expect(counter.rows[0]?.value).toBe(3);
    } finally {
      await pool.query('drop table if exists client_lifecycle_retry_exhaustion');
    }
  }, 15_000);

  it('keeps the actual v1.33 staff reset compatible with merged sources', async () => {
    const database = drizzle(pool);

    await database.transaction(async (tx) => {
      await purgeSalonGroups(
        tx as unknown as PurgeTx,
        'lifecycle-salon-a',
        ['staff'],
      );
    });

    const source = await pool.query<{
      merged_into_client_id: string | null;
      preferred_technician_id: string | null;
    }>(
      `select merged_into_client_id, preferred_technician_id
       from salon_client
       where salon_id = 'lifecycle-salon-a'
         and id = 'lifecycle-source'`,
    );

    expect(source.rows[0]).toEqual({
      merged_into_client_id: 'lifecycle-middle',
      preferred_technician_id: null,
    });
  });
});
