import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const databaseUrl = process.env.CLIENT_LIFECYCLE_TEST_DATABASE_URL;
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
      'Client-directory lifecycle tests require an explicitly confirmed loopback disposable database.',
    );
  }
}
const describePostgres = databaseUrl ? describe : describe.skip;

type QueriesModule = typeof import('./queries');
type MigrationJournal = {
  entries: Array<{ idx: number; tag: string }>;
};

async function resetDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('drop schema if exists drizzle cascade');
  await pool.query('drop schema if exists public cascade');
  await pool.query('create schema public');
}

async function migrationFolderThrough0061(): Promise<string> {
  const source = path.join(process.cwd(), 'migrations');
  const destination = await fs.mkdtemp(
    path.join(os.tmpdir(), 'client-directory-lifecycle-'),
  );
  await fs.mkdir(path.join(destination, 'meta'));
  const journal = JSON.parse(
    await fs.readFile(path.join(source, 'meta', '_journal.json'), 'utf8'),
  ) as MigrationJournal;
  const entries = journal.entries.filter(entry => entry.idx <= 61);
  await fs.writeFile(
    path.join(destination, 'meta', '_journal.json'),
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
  );
  await Promise.all(entries.map(entry =>
    fs.copyFile(
      path.join(source, `${entry.tag}.sql`),
      path.join(destination, `${entry.tag}.sql`),
    )));
  return destination;
}

async function seedValidDirectoryLifecycle(pool: pg.Pool): Promise<void> {
  await pool.query(`
    insert into salon (id, name, slug, theme_key)
    values
      ('directory-salon-a', 'Directory A', 'directory-a', 'minimal'),
      ('directory-salon-b', 'Directory B', 'directory-b', 'minimal')
  `);
  await pool.query(`
    insert into technician (id, salon_id, name, avatar_url)
    values (
      'directory-tech',
      'directory-salon-a',
      'Directory Technician',
      '/directory-tech.png'
    )
  `);
  await pool.query(`
    insert into salon_client (
      id,
      salon_id,
      phone,
      full_name,
      email,
      preferred_technician_id,
      total_visits,
      total_spent,
      last_visit_at,
      created_at,
      updated_at
    )
    values
      (
        'directory-primary',
        'directory-salon-a',
        '4165551000',
        'Zulu Primary',
        'current-primary@example.test',
        'directory-tech',
        5,
        5000,
        '2026-07-20T12:00:00Z',
        now(),
        now()
      ),
      (
        'directory-second',
        'directory-salon-a',
        '4165551001',
        'Alpha Active',
        'second@example.test',
        null,
        9,
        9000,
        '2026-07-21T12:00:00Z',
        now(),
        now()
      ),
      (
        'directory-middle',
        'directory-salon-a',
        '4165551002',
        'Historical Middle',
        'historical-middle@example.test',
        null,
        2,
        2000,
        '2026-07-18T12:00:00Z',
        now(),
        now()
      ),
      (
        'directory-source',
        'directory-salon-a',
        '4165551003',
        'Historical Source',
        'historical-source@example.test',
        null,
        1,
        1000,
        '2026-07-17T12:00:00Z',
        now(),
        now()
      ),
      (
        'directory-archived',
        'directory-salon-a',
        '4165551004',
        'Archived Standalone',
        'archived@example.test',
        null,
        4,
        4000,
        '2026-07-19T12:00:00Z',
        now(),
        now()
      ),
      (
        'directory-foreign-primary',
        'directory-salon-b',
        '6475552000',
        'Foreign Primary',
        'foreign-primary@example.test',
        null,
        3,
        3000,
        '2026-07-20T12:00:00Z',
        now(),
        now()
      )
  `);
  await pool.query(`
    insert into salon_client_contact_alias (
      salon_id,
      salon_client_id,
      kind,
      normalized_value
    )
    values
      (
        'directory-salon-a',
        'directory-middle',
        'phone',
        '4165551092'
      ),
      (
        'directory-salon-a',
        'directory-source',
        'email',
        'source-alias@example.test'
      ),
      (
        'directory-salon-b',
        'directory-foreign-primary',
        'phone',
        '6475552099'
      )
  `);
  await pool.query(`
    update salon_client
    set loyalty_points = case id
      when 'directory-primary' then 4321
      when 'directory-middle' then 2222
      when 'directory-source' then 7654
      else loyalty_points
    end
    where salon_id = 'directory-salon-a'
      and id in (
        'directory-primary',
        'directory-middle',
        'directory-source'
      )
  `);
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
      payment_status,
      total_price,
      final_price_cents,
      total_duration_minutes,
      completed_at
    )
    values
      (
        'directory-stat-primary',
        'directory-salon-a',
        'directory-primary',
        '4165551000',
        'Primary snapshot',
        '2026-08-01T14:00:00Z',
        '2026-08-01T15:00:00Z',
        'completed',
        'paid',
        1000,
        1100,
        60,
        '2026-08-01T15:00:00Z'
      ),
      (
        'directory-stat-middle',
        'directory-salon-a',
        'directory-middle',
        '4165551002',
        'Middle snapshot',
        '2026-08-02T14:00:00Z',
        '2026-08-02T15:00:00Z',
        'completed',
        'paid',
        2000,
        2200,
        60,
        '2026-08-02T15:00:00Z'
      ),
      (
        'directory-stat-source',
        'directory-salon-a',
        'directory-source',
        '4165551003',
        'Source snapshot',
        '2026-08-03T14:00:00Z',
        '2026-08-03T15:00:00Z',
        'completed',
        'paid',
        3000,
        3300,
        60,
        '2026-08-03T15:00:00Z'
      ),
      (
        'directory-stat-null-source',
        'directory-salon-a',
        null,
        '+14165551003',
        'Source phone snapshot',
        '2026-08-04T14:00:00Z',
        '2026-08-04T15:00:00Z',
        'completed',
        'paid',
        4000,
        4400,
        60,
        '2026-08-04T15:00:00Z'
      ),
      (
        'directory-stat-null-alias',
        'directory-salon-a',
        null,
        '14165551092',
        'Alias phone snapshot',
        '2026-08-05T14:00:00Z',
        '2026-08-05T15:00:00Z',
        'completed',
        'paid',
        5000,
        5500,
        60,
        '2026-08-05T15:00:00Z'
      ),
      (
        'directory-stat-primary-alias-phone',
        'directory-salon-a',
        'directory-primary',
        '4165551092',
        'Stable primary alias snapshot',
        '2026-08-06T14:00:00Z',
        '2026-08-06T15:00:00Z',
        'completed',
        'paid',
        6000,
        6600,
        60,
        '2026-08-06T15:00:00Z'
      ),
      (
        'directory-stat-source-no-show',
        'directory-salon-a',
        'directory-source',
        '4165551003',
        'Source no-show snapshot',
        '2026-08-07T14:00:00Z',
        '2026-08-07T15:00:00Z',
        'no_show',
        'pending',
        7000,
        null,
        60,
        null
      ),
      (
        'directory-stat-stable-collision',
        'directory-salon-a',
        'directory-second',
        '4165551003',
        'Other stable client snapshot',
        '2026-08-08T14:00:00Z',
        '2026-08-08T15:00:00Z',
        'completed',
        'paid',
        7000,
        7700,
        60,
        '2026-08-08T15:00:00Z'
      ),
      (
        'directory-stat-unrelated',
        'directory-salon-a',
        null,
        '4165551999',
        'Unrelated snapshot',
        '2026-08-09T14:00:00Z',
        '2026-08-09T15:00:00Z',
        'completed',
        'paid',
        8000,
        8800,
        60,
        '2026-08-09T15:00:00Z'
      ),
      (
        'directory-stat-foreign-stable',
        'directory-salon-b',
        'directory-foreign-primary',
        '4165551003',
        'Foreign stable snapshot',
        '2026-08-10T14:00:00Z',
        '2026-08-10T15:00:00Z',
        'completed',
        'paid',
        9000,
        9900,
        60,
        '2026-08-10T15:00:00Z'
      ),
      (
        'directory-stat-foreign-fallback',
        'directory-salon-b',
        null,
        '4165551003',
        'Foreign fallback snapshot',
        '2026-08-11T14:00:00Z',
        '2026-08-11T15:00:00Z',
        'completed',
        'paid',
        10000,
        11000,
        60,
        '2026-08-11T15:00:00Z'
      )
  `);
  await pool.query(`
    update salon_client
    set
      archived_at = now(),
      archived_by = 'directory-test',
      merged_into_client_id = 'directory-primary',
      merged_at = now(),
      merged_by = 'directory-test'
    where salon_id = 'directory-salon-a'
      and id = 'directory-middle'
  `);
  await pool.query(`
    update salon_client
    set
      archived_at = now(),
      archived_by = 'directory-test',
      merged_into_client_id = 'directory-middle',
      merged_at = now(),
      merged_by = 'directory-test'
    where salon_id = 'directory-salon-a'
      and id = 'directory-source'
  `);
  await pool.query(`
    update salon_client
    set
      archived_at = now(),
      archived_by = 'directory-test'
    where salon_id = 'directory-salon-a'
      and id = 'directory-archived'
  `);
}

async function seedInvalidDirectoryLifecycle(pool: pg.Pool): Promise<void> {
  const corruptClients = [
    ['directory-cycle-a', '4165551100', 'Cycle A'],
    ['directory-cycle-b', '4165551101', 'Cycle B'],
    ['directory-missing', '4165551102', 'Missing Target'],
    ['directory-cross-salon', '4165551103', 'Cross Salon'],
    ['directory-unarchived-source', '4165551104', 'Unarchived Source'],
  ];
  for (let depth = 1; depth <= 16; depth += 1) {
    corruptClients.push([
      `directory-depth-${String(depth).padStart(2, '0')}`,
      `41655512${String(depth).padStart(2, '0')}`,
      `Depth ${depth}`,
    ]);
  }

  for (const [id, phone, fullName] of corruptClients) {
    await pool.query(
      `insert into salon_client (
         id, salon_id, phone, full_name, created_at, updated_at
       )
       values ($1, 'directory-salon-a', $2, $3, now(), now())`,
      [id, phone, fullName],
    );
  }
  await pool.query(`
    insert into salon_client_contact_alias (
      salon_id,
      salon_client_id,
      kind,
      normalized_value
    )
    values
      (
        'directory-salon-a',
        'directory-cycle-a',
        'phone',
        '4165551190'
      ),
      (
        'directory-salon-a',
        'directory-missing',
        'phone',
        '4165551191'
      ),
      (
        'directory-salon-a',
        'directory-cross-salon',
        'phone',
        '4165551192'
      ),
      (
        'directory-salon-a',
        'directory-unarchived-source',
        'phone',
        '4165551193'
      ),
      (
        'directory-salon-a',
        'directory-depth-15',
        'phone',
        '4165551194'
      ),
      (
        'directory-salon-a',
        'directory-depth-16',
        'phone',
        '4165551195'
      )
  `);

  const client = await pool.connect();
  try {
    await client.query('set session_replication_role = replica');
    await client.query(`
      update salon_client
      set archived_at = now(), merged_into_client_id = 'directory-cycle-b'
      where id = 'directory-cycle-a'
    `);
    await client.query(`
      update salon_client
      set archived_at = now(), merged_into_client_id = 'directory-cycle-a'
      where id = 'directory-cycle-b'
    `);
    await client.query(`
      update salon_client
      set archived_at = now(), merged_into_client_id = 'directory-does-not-exist'
      where id = 'directory-missing'
    `);
    await client.query(`
      update salon_client
      set
        archived_at = now(),
        merged_into_client_id = 'directory-foreign-primary'
      where id = 'directory-cross-salon'
    `);
    await client.query(`
      update salon_client
      set merged_into_client_id = 'directory-primary'
      where id = 'directory-unarchived-source'
    `);
    for (let depth = 1; depth <= 16; depth += 1) {
      const target = depth === 1
        ? 'directory-primary'
        : `directory-depth-${String(depth - 1).padStart(2, '0')}`;
      await client.query(
        `update salon_client
         set archived_at = now(), merged_into_client_id = $1
         where id = $2`,
        [target, `directory-depth-${String(depth).padStart(2, '0')}`],
      );
    }
  } finally {
    await client.query('set session_replication_role = origin');
    client.release();
  }
}

describePostgres.sequential('getSalonClients lifecycle compatibility', () => {
  let pool: pg.Pool;
  let migrationsThrough0061: string;
  let getSalonClients: QueriesModule['getSalonClients'];
  let getSalonClientByPhone: QueriesModule['getSalonClientByPhone'];
  let updateSalonClientStats: QueriesModule['updateSalonClientStats'];

  beforeAll(async () => {
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 4,
      application_name: 'client-directory-lifecycle-test',
    });
    await resetDatabase(pool);
    const testDatabase = drizzle(pool, { schema });
    migrationsThrough0061 = await migrationFolderThrough0061();
    await migrate(testDatabase, { migrationsFolder: migrationsThrough0061 });
    await seedValidDirectoryLifecycle(pool);
    await migrate(testDatabase, {
      migrationsFolder: path.join(process.cwd(), 'migrations'),
    });
    await seedInvalidDirectoryLifecycle(pool);

    vi.resetModules();
    vi.doMock('@/libs/DB', () => ({ db: testDatabase }));
    const queries = await import('./queries');
    getSalonClients = queries.getSalonClients;
    getSalonClientByPhone = queries.getSalonClientByPhone;
    updateSalonClientStats = queries.updateSalonClientStats;
  }, 60_000);

  afterAll(async () => {
    vi.doUnmock('@/libs/DB');
    await resetDatabase(pool);
    await pool?.end();
    await fs.rm(migrationsThrough0061, { recursive: true, force: true });
  });

  it('returns and counts only active terminal profiles without changing pagination or shape', async () => {
    const firstPage = await getSalonClients('directory-salon-a', {
      sortBy: 'name',
      sortOrder: 'asc',
      page: 1,
      limit: 1,
    });
    const secondPage = await getSalonClients('directory-salon-a', {
      sortBy: 'name',
      sortOrder: 'asc',
      page: 2,
      limit: 1,
    });
    const byVisits = await getSalonClients('directory-salon-a', {
      sortBy: 'visits',
      sortOrder: 'desc',
    });

    expect(firstPage.total).toBe(2);
    expect(firstPage.clients.map(client => client.id)).toEqual([
      'directory-second',
    ]);
    expect(secondPage.total).toBe(2);
    expect(secondPage.clients).toEqual([
      expect.objectContaining({
        id: 'directory-primary',
        preferredTechnician: {
          id: 'directory-tech',
          name: 'Directory Technician',
          avatarUrl: '/directory-tech.png',
        },
      }),
    ]);
    expect(byVisits.clients.map(client => client.id)).toEqual([
      'directory-second',
      'directory-primary',
    ]);
  });

  it.each([
    ['source current phone', '4165551003'],
    ['formatted source current phone', '(416) 555-1003'],
    ['source current email', 'historical-source@example.test'],
    ['middle current phone', '4165551002'],
    ['middle phone alias', '4165551092'],
    ['formatted middle phone alias', '+1 (416) 555-1092'],
    ['source email alias', 'source-alias@example.test'],
    ['active current email', 'current-primary@example.test'],
  ])('finds the active terminal by %s', async (_label, search) => {
    const result = await getSalonClients('directory-salon-a', { search });

    expect(result.total).toBe(1);
    expect(result.clients.map(client => client.id)).toEqual([
      'directory-primary',
    ]);
  });

  it('keeps historical contact search private to the authorized salon', async () => {
    const salonA = await getSalonClients('directory-salon-a', {
      search: '6475552099',
    });
    const salonB = await getSalonClients('directory-salon-b', {
      search: '6475552099',
    });

    expect(salonA).toEqual({ clients: [], total: 0 });
    expect(salonB.total).toBe(1);
    expect(salonB.clients[0]?.id).toBe('directory-foreign-primary');
  });

  it.each([
    ['archived terminal', 'archived@example.test'],
    ['cycle', '4165551190'],
    ['missing target', '4165551191'],
    ['cross-salon edge', '4165551192'],
    ['unarchived source', '4165551193'],
    ['excessive depth', '4165551195'],
  ])('suppresses %s lifecycle state from search', async (_label, search) => {
    await expect(
      getSalonClients('directory-salon-a', { search }),
    ).resolves.toEqual({ clients: [], total: 0 });
  });

  it('includes the last contact inside the bounded lineage', async () => {
    const result = await getSalonClients('directory-salon-a', {
      search: '4165551194',
    });

    expect(result.total).toBe(1);
    expect(result.clients[0]?.id).toBe('directory-primary');
  });

  it('does not change phone authentication lookup semantics', async () => {
    const historicalSource = await getSalonClientByPhone(
      'directory-salon-a',
      '4165551003',
    );

    expect(historicalSource?.id).toBe('directory-source');
  });

  it('recalculates terminal caches once across stable lineage and null-id phone history', async () => {
    await updateSalonClientStats(
      'directory-salon-a',
      '(416) 555-1003',
    );

    const readClientCaches = async () => {
      const result = await pool.query<{
        id: string;
        total_visits: number;
        total_spent: number;
        no_show_count: number;
        last_visit_at: Date | null;
        loyalty_points: number;
      }>(`
        select
          id,
          total_visits,
          total_spent,
          no_show_count,
          last_visit_at,
          loyalty_points
        from salon_client
        where salon_id = 'directory-salon-a'
          and id in (
            'directory-primary',
            'directory-middle',
            'directory-source',
            'directory-second'
          )
        order by id
      `);
      return result.rows;
    };

    const firstCaches = await readClientCaches();

    expect(firstCaches).toEqual([
      expect.objectContaining({
        id: 'directory-middle',
        total_visits: 2,
        total_spent: 2000,
        loyalty_points: 2222,
      }),
      expect.objectContaining({
        id: 'directory-primary',
        total_visits: 6,
        total_spent: 23100,
        no_show_count: 1,
        loyalty_points: 4321,
      }),
      expect.objectContaining({
        id: 'directory-second',
        total_visits: 9,
        total_spent: 9000,
      }),
      expect.objectContaining({
        id: 'directory-source',
        total_visits: 1,
        total_spent: 1000,
        loyalty_points: 7654,
      }),
    ]);

    const primary = firstCaches.find(row => row.id === 'directory-primary');

    expect(primary?.last_visit_at?.toISOString()).toBe(
      '2026-08-06T14:00:00.000Z',
    );

    const snapshots = await pool.query<{
      id: string;
      salon_client_id: string | null;
      client_phone: string;
    }>(`
      select id, salon_client_id, client_phone
      from appointment
      where id in (
        'directory-stat-source',
        'directory-stat-null-source',
        'directory-stat-stable-collision'
      )
      order by id
    `);

    expect(snapshots.rows).toEqual([
      {
        id: 'directory-stat-null-source',
        salon_client_id: null,
        client_phone: '+14165551003',
      },
      {
        id: 'directory-stat-source',
        salon_client_id: 'directory-source',
        client_phone: '4165551003',
      },
      {
        id: 'directory-stat-stable-collision',
        salon_client_id: 'directory-second',
        client_phone: '4165551003',
      },
    ]);

    await updateSalonClientStats(
      'directory-salon-a',
      '+1 (416) 555-1092',
    );

    expect(await readClientCaches()).toEqual(firstCaches);

    await updateSalonClientStats('directory-salon-a', '4165551000');

    expect(await readClientCaches()).toEqual(firstCaches);
  });
});
