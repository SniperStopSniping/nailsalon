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
