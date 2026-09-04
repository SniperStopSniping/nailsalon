import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CLIENT_LIFECYCLE_MIGRATION_SHA256,
  getClientLifecycleSchemaReadiness,
  isClientLifecycleCapabilityReady,
} from './clientLifecycleSchemaCore';

const { Client, Pool } = pg;
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
      'Lifecycle migration tests require an explicitly confirmed loopback disposable database.',
    );
  }
}
const describePostgres = databaseUrl ? describe : describe.skip;

// Chain-replay tests measure real-Postgres migration replays. On shared CI
// runners the 5s vitest default is marginal for them: main run 32031268736
// (2026-08-17) timed five of them out at exactly 5000ms while the same tests
// pass locally in 0.8-2.6s and pass on CI on faster runners (the suite flaked
// at this boundary before Gate B, when the replayed chain was identical -
// these tests replay THROUGH 0062 via migrationFolderThrough, so Gate B did
// not lengthen their workload). Assertions are unchanged; only the budget is
// sized to the workload, matching the 60-120s budgets the slower siblings in
// this file have always carried.
const MIGRATION_REPLAY_TIMEOUT_MS = 60_000;

type Journal = {
  dialect?: string;
  version?: string;
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

async function resetDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('drop schema if exists drizzle cascade');
  await pool.query('drop schema if exists public cascade');
  await pool.query('create schema public');
}

async function migrationFolderThrough(
  maximumIndex: number,
  replacement0062?: string,
): Promise<string> {
  const source = path.join(process.cwd(), 'migrations');
  const destination = await fs.mkdtemp(
    path.join(os.tmpdir(), 'client-lifecycle-migrations-'),
  );
  await fs.mkdir(path.join(destination, 'meta'));
  const journal = JSON.parse(
    await fs.readFile(path.join(source, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
  const selected = journal.entries.filter(entry => entry.idx <= maximumIndex);
  await fs.writeFile(
    path.join(destination, 'meta', '_journal.json'),
    `${JSON.stringify({ ...journal, entries: selected }, null, 2)}\n`,
  );
  await Promise.all(
    selected.map(async (entry) => {
      const sqlText = entry.idx === 62 && replacement0062 != null
        ? replacement0062
        : await fs.readFile(path.join(source, `${entry.tag}.sql`), 'utf8');
      await fs.writeFile(
        path.join(destination, `${entry.tag}.sql`),
        sqlText,
      );
    }),
  );
  return destination;
}

async function appliedMigrationRows(pool: pg.Pool): Promise<Array<{
  hash: string;
  created_at: string;
}>> {
  const result = await pool.query<{ hash: string; created_at: string }>(
    `select hash, created_at::text
     from drizzle.__drizzle_migrations
     order by created_at`,
  );
  return result.rows;
}

function runProtectedLifecycleMigration(): ReturnType<typeof spawnSync> {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnSync(
    executable,
    ['tsx', 'scripts/migrate-client-lifecycle.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
}

type AsyncCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runProtectedLifecycleMigrationAsync(): Promise<AsyncCommandResult> {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(
    executable,
    ['tsx', 'scripts/migrate-client-lifecycle.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => stdout += String(chunk));
  child.stderr.on('data', chunk => stderr += String(chunk));

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

async function waitForMigrationCoordinatorWaiters(
  pool: pg.Pool,
  expectedCount: number,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const result = await pool.query<{ waiting_count: string }>(
      `select count(*)::text as waiting_count
       from pg_stat_activity
       where application_name = 'client-lifecycle-migration-coordinator-1'
         and wait_event_type = 'Lock'`,
    );
    if (Number(result.rows[0]?.waiting_count ?? 0) >= expectedCount) {
      return;
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error(
    'Timed out waiting for protected migration coordinator locks.',
  );
}

function runLifecycleRehearsal(
  confirmed = true,
  overrides: {
    databaseUrl?: string;
    expectedHost?: string;
    disposableConfirmed?: boolean;
  } = {},
): ReturnType<typeof spawnSync> {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const rehearsalDatabaseUrl = overrides.databaseUrl ?? databaseUrl;
  return spawnSync(
    executable,
    ['tsx', 'scripts/rehearse-client-lifecycle.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: rehearsalDatabaseUrl,
        CLIENT_LIFECYCLE_REHEARSAL_CONFIRMED: confirmed ? 'true' : 'false',
        CLIENT_LIFECYCLE_DISPOSABLE_DATABASE_CONFIRMED:
          overrides.disposableConfirmed === false ? 'false' : 'true',
        CLIENT_LIFECYCLE_REHEARSAL_EXPECTED_HOST:
          overrides.expectedHost ?? new URL(rehearsalDatabaseUrl!).hostname,
      },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
}

function runLifecyclePreflight(
  overrides: {
    databaseUrl?: string;
    expectedHost?: string;
    confirmed?: boolean;
  } = {},
): ReturnType<typeof spawnSync> {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const preflightDatabaseUrl = overrides.databaseUrl ?? databaseUrl;
  return spawnSync(
    executable,
    [
      'tsx',
      'scripts/rehearse-client-lifecycle.ts',
      '--preflight-only',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: preflightDatabaseUrl,
        CLIENT_LIFECYCLE_PREFLIGHT_CONFIRMED:
          overrides.confirmed === false ? 'false' : 'true',
        CLIENT_LIFECYCLE_REHEARSAL_EXPECTED_HOST:
          overrides.expectedHost
          ?? new URL(preflightDatabaseUrl!).hostname,
      },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
}

describePostgres.sequential('client lifecycle migration chain', () => {
  let pool: pg.Pool;
  const temporaryFolders: string[] = [];

  beforeAll(async () => {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      application_name: 'client-lifecycle-migration-test',
    });
  });

  afterAll(async () => {
    await pool?.end();
    await Promise.all(
      temporaryFolders.map(folder =>
        fs.rm(folder, { recursive: true, force: true })),
    );
  });

  it('applies the fresh chain through exact 0061 and atomic 0062 once', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(fullFolder);

    await migrate(database, { migrationsFolder: fullFolder });
    const firstRows = await appliedMigrationRows(pool);
    const migration0061 = firstRows.find(
      row => Number(row.created_at) === 1784950000006,
    );

    expect(migration0061?.hash).toBe(
      'ec2ea523735b0a45b964ed78f6f56327c9019678c29e6e994f161a8b2a4f7731',
    );
    expect(firstRows.at(-1)?.created_at).toBe('1784950000007');
    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);

    await migrate(database, { migrationsFolder: fullFolder });

    expect(await appliedMigrationRows(pool)).toEqual(firstRows);
  }, MIGRATION_REPLAY_TIMEOUT_MS);

  it('upgrades populated 0060 through exact 0061 and 0062', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0060 = await migrationFolderThrough(60);
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(through0060, fullFolder);
    await migrate(database, { migrationsFolder: through0060 });

    await pool.query(`
      insert into salon (id, name, slug, theme_key)
      values ('migration-salon', 'Migration Salon', 'migration-salon', 'minimal')
    `);
    await pool.query(`
      insert into salon_client (
        id,
        salon_id,
        phone,
        full_name,
        created_at,
        updated_at
      )
      values (
        'migration-client',
        'migration-salon',
        '4165550100',
        'Migration Fixture',
        now(),
        now()
      )
    `);

    await migrate(database, { migrationsFolder: fullFolder });

    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);

    const preserved = await pool.query<{ count: string }>(
      `select count(*)::text as count
       from salon_client
       where id = 'migration-client'`,
    );

    expect(preserved.rows[0]?.count).toBe('1');
  }, MIGRATION_REPLAY_TIMEOUT_MS);

  it('applies only 0062 over populated exact 0061 and keeps old writes compatible', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(through0061, fullFolder);
    await migrate(database, { migrationsFolder: through0061 });

    await pool.query(`
      insert into salon (id, name, slug, theme_key)
      values ('compat-salon', 'Compatibility Salon', 'compat-salon', 'minimal')
    `);
    await pool.query(`
      insert into salon_client (
        id, salon_id, phone, full_name, created_at, updated_at
      )
      values
        (
          'compat-primary',
          'compat-salon',
          '4165550111',
          'Primary Fixture',
          now(),
          now()
        ),
        (
          'compat-source',
          'compat-salon',
          '4165550222',
          'Source Fixture',
          now(),
          now()
        )
    `);
    await pool.query(`
      update salon_client
      set
        archived_at = now(),
        archived_by = 'migration-test',
        merged_into_client_id = 'compat-primary',
        merged_at = now(),
        merged_by = 'migration-test'
      where id = 'compat-source'
    `);

    const rowsBefore = await appliedMigrationRows(pool);
    await migrate(database, { migrationsFolder: fullFolder });
    const rowsAfter = await appliedMigrationRows(pool);

    expect(rowsAfter).toHaveLength(rowsBefore.length + 1);
    expect(rowsAfter.at(-1)?.created_at).toBe('1784950000007');

    await expect(pool.query(`
      update salon_client
      set preferred_technician_id = null,
          notes = 'old writer compatibility'
      where id = 'compat-source'
    `)).resolves.toBeDefined();
    await expect(pool.query(`
      update salon_client
      set merged_into_client_id = null
      where id = 'compat-source'
    `)).rejects.toMatchObject({ code: '55000' });
    await expect(pool.query(`
      update salon_client
      set merged_into_client_id = 'compat-source'
      where id = 'compat-primary'
    `)).rejects.toMatchObject({ code: '23514' });
  }, MIGRATION_REPLAY_TIMEOUT_MS);

  it('rolls back a failure before readiness and then applies a clean retry', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    const failing0062 = await migrationFolderThrough(
      62,
      `create table app_schema_capability (
         capability text primary key,
         version integer not null,
         state text not null,
         merge_writes_enabled boolean not null
       );
       insert into app_schema_capability
       values ('client_lifecycle', 2, 'ready', false);
       do $$ begin raise exception 'forced migration failure'; end $$;`,
    );
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(through0061, failing0062, fullFolder);
    await migrate(database, { migrationsFolder: through0061 });

    await expect(
      migrate(database, { migrationsFolder: failing0062 }),
    ).rejects.toThrow('forced migration failure');

    const rolledBack = await pool.query<{ table_name: string | null }>(
      `select to_regclass('public.app_schema_capability')::text as table_name`,
    );

    expect(rolledBack.rows[0]?.table_name).toBeNull();
    expect((await appliedMigrationRows(pool)).at(-1)?.created_at).toBe(
      '1784950000006',
    );

    await migrate(database, { migrationsFolder: fullFolder });

    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);
  });

  it('rejects a preexisting incomplete capability table before publishing readiness', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(through0061, fullFolder);
    await migrate(database, { migrationsFolder: through0061 });

    await pool.query(`
      create table app_schema_capability (
        capability text not null,
        version integer not null,
        state text not null,
        merge_writes_enabled boolean default false not null,
        installed_at timestamp with time zone default now() not null
      )
    `);

    await expect(
      migrate(database, { migrationsFolder: fullFolder }),
    ).rejects.toThrow('client lifecycle capability constraints are unavailable');

    expect((await appliedMigrationRows(pool)).at(-1)?.created_at).toBe(
      '1784950000006',
    );

    const readyRows = await pool.query<{ count: string }>(`
      select count(*)::text as count
      from app_schema_capability
      where capability = 'client_lifecycle'
        and state = 'ready'
    `);

    expect(readyRows.rows[0]?.count).toBe('0');

    await pool.query('drop table app_schema_capability');
    await migrate(database, { migrationsFolder: fullFolder });

    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);
  }, MIGRATION_REPLAY_TIMEOUT_MS);

  it('rejects a same-named index with the wrong definition before readiness', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(through0061, fullFolder);
    await migrate(database, { migrationsFolder: through0061 });

    await pool.query(`
      drop index salon_client_contact_alias_unique;
      create unique index salon_client_contact_alias_unique
        on salon_client_contact_alias (
          salon_id,
          normalized_value,
          kind
        )
    `);

    await expect(
      migrate(database, { migrationsFolder: fullFolder }),
    ).rejects.toThrow('required client lifecycle indexes are missing');
    expect((await appliedMigrationRows(pool)).at(-1)?.created_at).toBe(
      '1784950000006',
    );

    const capability = await pool.query<{ table_name: string | null }>(
      `select to_regclass('public.app_schema_capability')::text as table_name`,
    );

    expect(capability.rows[0]?.table_name).toBeNull();

    await pool.query(`
      drop index salon_client_contact_alias_unique;
      create unique index salon_client_contact_alias_unique
        on salon_client_contact_alias (
          salon_id,
          kind,
          normalized_value
        )
    `);
    await migrate(database, { migrationsFolder: fullFolder });

    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);
  });

  it('rejects a same-named index owned by the wrong public table', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(through0061, fullFolder);
    await migrate(database, { migrationsFolder: through0061 });

    await pool.query(`
      drop index salon_client_contact_alias_unique;
      create table lifecycle_alias_index_decoy (
        salon_id text not null,
        kind text not null,
        normalized_value text not null
      );
      create unique index salon_client_contact_alias_unique
        on lifecycle_alias_index_decoy (
          salon_id,
          kind,
          normalized_value
        )
    `);

    await expect(
      migrate(database, { migrationsFolder: fullFolder }),
    ).rejects.toThrow('required client lifecycle indexes are missing');
    expect((await appliedMigrationRows(pool)).at(-1)?.created_at).toBe(
      '1784950000006',
    );

    const capability = await pool.query<{ table_name: string | null }>(
      `select to_regclass('public.app_schema_capability')::text as table_name`,
    );

    expect(capability.rows[0]?.table_name).toBeNull();

    await pool.query(`
      drop index salon_client_contact_alias_unique;
      drop table lifecycle_alias_index_decoy;
      create unique index salon_client_contact_alias_unique
        on salon_client_contact_alias (
          salon_id,
          kind,
          normalized_value
        )
    `);
    await migrate(database, { migrationsFolder: fullFolder });

    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);

    await pool.query(`
      drop index salon_client_contact_alias_unique;
      create table lifecycle_alias_index_decoy (
        salon_id text not null,
        kind text not null,
        normalized_value text not null
      );
      create unique index salon_client_contact_alias_unique
        on lifecycle_alias_index_decoy (
          salon_id,
          kind,
          normalized_value
        )
    `);

    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(false);

    await pool.query(`
      drop index salon_client_contact_alias_unique;
      drop table lifecycle_alias_index_decoy;
      create unique index salon_client_contact_alias_unique
        on salon_client_contact_alias (
          salon_id,
          kind,
          normalized_value
        )
    `);

    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);
  });

  it('rejects a lifecycle trigger attached to a foreign-schema function', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(through0061, fullFolder);
    await migrate(database, { migrationsFolder: through0061 });

    await pool.query(`
      create schema lifecycle_decoy;
      create function lifecycle_decoy.resolve_merged_salon_client_reference()
      returns trigger
      language plpgsql
      as $$
      begin
        return new;
      end;
      $$;
      drop trigger appointment_resolve_merged_client on appointment;
      create trigger appointment_resolve_merged_client
        before insert or update of salon_id, salon_client_id
        on appointment
        for each row
        execute function lifecycle_decoy.resolve_merged_salon_client_reference()
    `);

    await expect(
      migrate(database, { migrationsFolder: fullFolder }),
    ).rejects.toThrow('required client lifecycle triggers are unavailable');
    expect((await appliedMigrationRows(pool)).at(-1)?.created_at).toBe(
      '1784950000006',
    );

    const capability = await pool.query<{ table_name: string | null }>(
      `select to_regclass('public.app_schema_capability')::text as table_name`,
    );

    expect(capability.rows[0]?.table_name).toBeNull();

    await pool.query(`
      drop trigger appointment_resolve_merged_client on appointment;
      create trigger appointment_resolve_merged_client
        before insert or update of salon_id, salon_client_id
        on appointment
        for each row
        execute function public.resolve_merged_salon_client_reference();
      drop schema lifecycle_decoy cascade
    `);
    await migrate(database, { migrationsFolder: fullFolder });

    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);

    await pool.query(`
      create schema lifecycle_decoy;
      create function lifecycle_decoy.resolve_merged_salon_client_reference()
      returns trigger
      language plpgsql
      as $$
      begin
        return new;
      end;
      $$;
      drop trigger appointment_resolve_merged_client on appointment;
      create trigger appointment_resolve_merged_client
        before insert or update of salon_id, salon_client_id
        on appointment
        for each row
        execute function lifecycle_decoy.resolve_merged_salon_client_reference()
    `);

    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(false);

    await pool.query(`
      drop trigger appointment_resolve_merged_client on appointment;
      create trigger appointment_resolve_merged_client
        before insert or update of salon_id, salon_client_id
        on appointment
        for each row
        execute function public.resolve_merged_salon_client_reference();
      drop schema lifecycle_decoy cascade
    `);

    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);
  });

  it('rejects a lifecycle trigger with a predicate before publishing readiness', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(through0061, fullFolder);
    await migrate(database, { migrationsFolder: through0061 });

    await pool.query(`
      drop trigger appointment_resolve_merged_client on appointment;
      create trigger appointment_resolve_merged_client
        before insert or update of salon_id, salon_client_id
        on appointment
        for each row
        when (false)
        execute function public.resolve_merged_salon_client_reference()
    `);

    await expect(
      migrate(database, { migrationsFolder: fullFolder }),
    ).rejects.toThrow('required client lifecycle triggers are unavailable');
    expect((await appliedMigrationRows(pool)).at(-1)?.created_at).toBe(
      '1784950000006',
    );
    expect(
      await pool.query(
        `select to_regclass('public.app_schema_capability') is null as missing`,
      ),
    ).toMatchObject({ rows: [{ missing: true }] });
  });

  it('rejects a lifecycle trigger with the wrong update-of set before publishing readiness', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(through0061, fullFolder);
    await migrate(database, { migrationsFolder: through0061 });

    await pool.query(`
      drop trigger appointment_resolve_merged_client on appointment;
      create trigger appointment_resolve_merged_client
        before insert or update of salon_client_id
        on appointment
        for each row
        execute function public.resolve_merged_salon_client_reference()
    `);

    await expect(
      migrate(database, { migrationsFolder: fullFolder }),
    ).rejects.toThrow('required client lifecycle triggers are unavailable');
    expect((await appliedMigrationRows(pool)).at(-1)?.created_at).toBe(
      '1784950000006',
    );
    expect(
      await pool.query(
        `select to_regclass('public.app_schema_capability') is null as missing`,
      ),
    ).toMatchObject({ rows: [{ missing: true }] });
  }, MIGRATION_REPLAY_TIMEOUT_MS);

  it('serializes 0062 with a pooled-safe transaction lock, then applies and no-ops', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    temporaryFolders.push(through0061);
    await migrate(database, { migrationsFolder: through0061 });

    const lockClient = new Client({
      connectionString: databaseUrl,
      application_name: 'client-lifecycle-wrapper-lock-test',
    });
    await lockClient.connect();
    try {
      await lockClient.query('begin');
      await lockClient.query(
        `select pg_advisory_xact_lock(
           hashtextextended('client-lifecycle-stabilization-migration', 0)
         )`,
      );
      const blocked = runProtectedLifecycleMigration();

      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain('canceling statement due to lock timeout');
      expect((await appliedMigrationRows(pool)).at(-1)?.created_at).toBe(
        '1784950000006',
      );
    } finally {
      await lockClient.query('rollback');
      await lockClient.end();
    }

    const applied = runProtectedLifecycleMigration();

    expect(applied.status).toBe(0);
    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);

    const rowsAfterApply = await appliedMigrationRows(pool);

    const noOp = runProtectedLifecycleMigration();

    expect(noOp.status).toBe(0);
    expect(await appliedMigrationRows(pool)).toEqual(rowsAfterApply);
  }, 120_000);

  it('serializes journal observation before two protected runners publish 0062', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    temporaryFolders.push(through0061);
    await migrate(database, { migrationsFolder: through0061 });

    const barrier = new Client({
      connectionString: databaseUrl,
      application_name: 'client-lifecycle-runner-coordination-barrier',
    });
    let barrierTransactionOpen = false;
    let firstMigration: Promise<AsyncCommandResult> | undefined;
    let secondMigration: Promise<AsyncCommandResult> | undefined;
    await barrier.connect();
    try {
      await barrier.query('begin');
      barrierTransactionOpen = true;
      await barrier.query(`
        select pg_advisory_xact_lock(
          hashtextextended(
            'client-lifecycle-stabilization-migration-runner',
            0
          )
        )
      `);

      firstMigration = runProtectedLifecycleMigrationAsync();
      secondMigration = runProtectedLifecycleMigrationAsync();
      await waitForMigrationCoordinatorWaiters(pool, 2);

      await barrier.query('commit');
      barrierTransactionOpen = false;

      const [first, second] = await Promise.all([
        firstMigration,
        secondMigration,
      ]);

      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(first.stderr).toBe('');
      expect(second.stderr).toBe('');

      const migration0062Rows = (await appliedMigrationRows(pool)).filter(
        row => row.created_at === '1784950000007',
      );

      expect(migration0062Rows).toHaveLength(1);

      const capability = await pool.query<{ count: string }>(
        `select count(*)::text as count
         from app_schema_capability
         where capability = 'client_lifecycle'
           and version = 2
           and state = 'ready'
           and merge_writes_enabled = false`,
      );

      expect(Number(capability.rows[0]?.count ?? 0)).toBe(1);
      expect(
        (await getClientLifecycleSchemaReadiness(database)).ready,
      ).toBe(true);

      const rowsAfterConcurrentApply = await appliedMigrationRows(pool);
      const noOp = runProtectedLifecycleMigration();

      expect(noOp.status).toBe(0);
      expect(await appliedMigrationRows(pool)).toEqual(
        rowsAfterConcurrentApply,
      );
    } finally {
      if (barrierTransactionOpen) {
        await barrier.query('rollback').catch(() => undefined);
      }
      await barrier.end();
      await Promise.allSettled(
        [firstMigration, secondMigration].filter(
          (migration): migration is Promise<AsyncCommandResult> =>
            migration != null,
        ),
      );
    }
  }, 120_000);

  it('keeps the repository 0061 file byte-identical to Production evidence', async () => {
    const migration = await fs.readFile(
      path.join(
        process.cwd(),
        'migrations',
        '0061_client_edit_merge_archive.sql',
      ),
    );

    expect(migration).toHaveLength(9316);
    expect(crypto.createHash('sha256').update(migration).digest('hex')).toBe(
      'ec2ea523735b0a45b964ed78f6f56327c9019678c29e6e994f161a8b2a4f7731',
    );
  });

  it('authenticates exact repository and database 0062 bytes', async () => {
    const migration = await fs.readFile(
      path.join(
        process.cwd(),
        'migrations',
        '0062_client_lifecycle_stabilization.sql',
      ),
    );

    expect(crypto.createHash('sha256').update(migration).digest('hex')).toBe(
      CLIENT_LIFECYCLE_MIGRATION_SHA256,
    );

    await resetDatabase(pool);
    const database = drizzle(pool);
    const fullFolder = await migrationFolderThrough(62);
    temporaryFolders.push(fullFolder);
    await migrate(database, { migrationsFolder: fullFolder });

    const applied0062 = (await appliedMigrationRows(pool)).filter(
      row => row.created_at === '1784950000007',
    );

    expect(applied0062).toEqual([{
      created_at: '1784950000007',
      hash: CLIENT_LIFECYCLE_MIGRATION_SHA256,
    }]);
    await expect(
      isClientLifecycleCapabilityReady(database),
    ).resolves.toBe(true);

    await pool.query(
      `update drizzle.__drizzle_migrations
       set hash = repeat('0', 64)
       where created_at = 1784950000007`,
    );

    const readiness = await getClientLifecycleSchemaReadiness(database);

    expect(readiness.ready).toBe(false);
    expect(readiness.categories.migration).toBe(false);
    await expect(
      isClientLifecycleCapabilityReady(database),
    ).resolves.toBe(false);

    const protectedMigration = runProtectedLifecycleMigration();

    expect(protectedMigration.status).toBe(1);
    expect(protectedMigration.stderr).toContain(
      'Database stabilization capability is not ready.',
    );
  }, 120_000);

  it('rehearses exact 0061 through ready 0062 with aggregate-only output', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    temporaryFolders.push(through0061);
    await migrate(database, { migrationsFolder: through0061 });

    await pool.query(`
      insert into salon (id, name, slug, theme_key)
      values (
        'rehearsal-salon',
        'Rehearsal fixture',
        'rehearsal-fixture',
        'minimal'
      )
    `);
    await pool.query(`
      insert into salon_client (
        id, salon_id, phone, full_name, created_at, updated_at
      )
      values
        (
          'rehearsal-primary',
          'rehearsal-salon',
          '4165550131',
          'Primary fixture',
          now(),
          now()
        ),
        (
          'rehearsal-source',
          'rehearsal-salon',
          '4165550132',
          'Source fixture',
          now(),
          now()
        )
    `);
    await pool.query(`
      update salon_client
      set
        archived_at = now(),
        archived_by = 'migration-test',
        merged_into_client_id = 'rehearsal-primary',
        merged_at = now(),
        merged_by = 'migration-test'
      where id = 'rehearsal-source'
    `);

    const rehearsal = runLifecycleRehearsal();
    const stdout = String(rehearsal.stdout);

    expect(rehearsal.status).toBe(0);
    expect(rehearsal.stderr).toBe('');
    expect(stdout).not.toContain(String(databaseUrl));
    expect(stdout).not.toContain('4165550131');
    expect(stdout).not.toContain('rehearsal-primary');

    const output = JSON.parse(stdout) as {
      status: string;
      preflight: {
        exact0061Applied: boolean;
        rowsPreventing0062: number;
        mergedSources: { rows: number };
      };
      migration: {
        attempts: number;
        commandTotalMillisecondsIncludingInducedWait: number;
      };
      readiness: { milliseconds: number };
      noOp: { attempts: number; milliseconds: number };
      measurements: {
        inducedCoordinationWaitMilliseconds: number;
        transactionAdvisoryLockHoldMilliseconds: number;
        postBarrierMigrationCompletionMilliseconds: number;
        lockObservation: {
          samples: number;
          longestObservedLock: {
            lockType: 'advisory' | 'relation';
            table: string | null;
            mode: string;
            observedMilliseconds: number;
          } | null;
          longestObservedExistingTableLock: {
            lockType: 'relation';
            table: string;
            mode: string;
            observedMilliseconds: number;
          } | null;
        };
        writesAfterBarrierRelease: {
          probeLaunchedBeforeMigrationCompleted: boolean;
          appointmentMilliseconds: number;
          paymentMilliseconds: number;
        };
        post0062: {
          appointmentWriteMilliseconds: number;
          paymentWriteMilliseconds: number;
          terminalResolutionTriggerOverheadMilliseconds: number;
        };
      };
    };

    expect(output.status).toBe('ok');
    expect(output.preflight).toMatchObject({
      exact0061Applied: true,
      rowsPreventing0062: 0,
      mergedSources: { rows: 1 },
    });
    expect(output.migration.attempts).toBeGreaterThanOrEqual(1);
    expect(
      output.migration.commandTotalMillisecondsIncludingInducedWait,
    ).toBeGreaterThanOrEqual(0);
    expect(output.readiness.milliseconds).toBeGreaterThanOrEqual(0);
    expect(output.noOp.attempts).toBe(1);
    expect(output.noOp.milliseconds).toBeGreaterThanOrEqual(0);
    expect(output.measurements.inducedCoordinationWaitMilliseconds)
      .toBeGreaterThanOrEqual(0);
    expect(output.measurements.transactionAdvisoryLockHoldMilliseconds)
      .toBeGreaterThanOrEqual(0);
    expect(output.measurements.postBarrierMigrationCompletionMilliseconds)
      .toBeGreaterThanOrEqual(0);
    expect(output.measurements.lockObservation.samples)
      .toBeGreaterThanOrEqual(1);

    const longestObservedLock
      = output.measurements.lockObservation.longestObservedLock;
    if (longestObservedLock) {
      expect(longestObservedLock.observedMilliseconds)
        .toBeGreaterThanOrEqual(0);
    }

    expect(
      output.measurements.writesAfterBarrierRelease
        .probeLaunchedBeforeMigrationCompleted,
    ).toBe(true);
    expect(
      output.measurements
        .writesAfterBarrierRelease
        .appointmentMilliseconds,
    )
      .toBeGreaterThanOrEqual(0);
    expect(
      output.measurements
        .writesAfterBarrierRelease
        .paymentMilliseconds,
    )
      .toBeGreaterThanOrEqual(0);
    expect(output.measurements.post0062.appointmentWriteMilliseconds)
      .toBeGreaterThanOrEqual(0);
    expect(output.measurements.post0062.paymentWriteMilliseconds)
      .toBeGreaterThanOrEqual(0);
    expect(
      output.measurements
        .post0062
        .terminalResolutionTriggerOverheadMilliseconds,
    )
      .toBeGreaterThanOrEqual(0);
    expect(
      (await getClientLifecycleSchemaReadiness(database)).ready,
    ).toBe(true);
  }, 120_000);

  it('runs an independent count-only preflight without changing data or migration state', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    temporaryFolders.push(through0061);
    await migrate(database, { migrationsFolder: through0061 });

    await pool.query(`
      insert into salon (id, name, slug, theme_key)
      values (
        'preflight-salon',
        'Preflight fixture',
        'preflight-fixture',
        'minimal'
      )
    `);
    await pool.query(`
      insert into salon_client (
        id, salon_id, phone, full_name, created_at, updated_at
      )
      values (
        'preflight-client',
        'preflight-salon',
        '4165550133',
        'Preflight fixture',
        now(),
        now()
      )
    `);

    const beforeJournal = await appliedMigrationRows(pool);
    const beforeClients = await pool.query<{ count: string }>(
      'select count(*)::text as count from salon_client',
    );
    const preflight = runLifecyclePreflight();

    expect(preflight.status).toBe(0);
    expect(preflight.stderr).toBe('');
    expect(String(preflight.stdout)).not.toContain(String(databaseUrl));
    expect(String(preflight.stdout)).not.toContain('4165550133');
    expect(String(preflight.stdout)).not.toContain('preflight-client');
    expect(JSON.parse(String(preflight.stdout))).toMatchObject({
      status: 'ok',
      stage: 'preflight',
      preflight: {
        exact0061Applied: true,
        rowsPreventing0062: 0,
      },
    });
    expect(await appliedMigrationRows(pool)).toEqual(beforeJournal);

    const afterClients = await pool.query<{ count: string }>(
      'select count(*)::text as count from salon_client',
    );

    expect(afterClients.rows).toEqual(beforeClients.rows);
    expect(
      await pool.query<{ table_name: string | null }>(
        `select to_regclass('public.app_schema_capability')::text
           as table_name`,
      ),
    ).toMatchObject({ rows: [{ table_name: null }] });
  }, 120_000);

  it('blocks rehearsal before 0062 when active contact data is incompatible', async () => {
    await resetDatabase(pool);
    const database = drizzle(pool);
    const through0061 = await migrationFolderThrough(61);
    temporaryFolders.push(through0061);
    await migrate(database, { migrationsFolder: through0061 });

    await pool.query(`
      insert into salon (id, name, slug, theme_key)
      values (
        'blocked-rehearsal-salon',
        'Blocked rehearsal fixture',
        'blocked-rehearsal-fixture',
        'minimal'
      )
    `);
    await pool.query(`
      insert into salon_client (
        id, salon_id, phone, full_name, created_at, updated_at
      )
      values (
        'blocked-rehearsal-client',
        'blocked-rehearsal-salon',
        'invalid-active-phone',
        'Blocked fixture',
        now(),
        now()
      )
    `);

    const preflight = runLifecyclePreflight();
    const preflightOutput = JSON.parse(String(preflight.stdout)) as {
      status: string;
      stage: string;
      preflight: {
        rowsPreventing0062: number;
        contacts: { invalidActivePhoneRows: number };
      };
    };

    expect(preflight.status).toBe(1);
    expect(preflight.stderr).toBe('');
    expect(preflightOutput).toMatchObject({
      status: 'blocked',
      stage: 'preflight',
      preflight: {
        contacts: { invalidActivePhoneRows: 1 },
      },
    });
    expect(preflightOutput.preflight.rowsPreventing0062)
      .toBeGreaterThanOrEqual(1);

    const rehearsal = runLifecycleRehearsal();
    const stdout = String(rehearsal.stdout);

    expect(rehearsal.status).toBe(1);
    expect(rehearsal.stderr).toBe('');
    expect(stdout).not.toContain(String(databaseUrl));
    expect(stdout).not.toContain('invalid-active-phone');
    expect(stdout).not.toContain('blocked-rehearsal-client');

    const output = JSON.parse(stdout) as {
      status: string;
      stage: string;
      preflight: {
        rowsPreventing0062: number;
        contacts: { invalidActivePhoneRows: number };
      };
    };

    expect(output).toMatchObject({
      status: 'blocked',
      stage: 'preflight',
      preflight: {
        contacts: { invalidActivePhoneRows: 1 },
      },
    });
    expect(output.preflight.rowsPreventing0062).toBeGreaterThanOrEqual(1);
    expect((await appliedMigrationRows(pool)).at(-1)?.created_at).toBe(
      '1784950000006',
    );
  }, MIGRATION_REPLAY_TIMEOUT_MS);

  it('refuses to connect without explicit rehearsal confirmation', () => {
    const rehearsal = runLifecycleRehearsal(false);

    expect(rehearsal.status).toBe(1);
    expect(rehearsal.stdout).toBe('');
    expect(JSON.parse(String(rehearsal.stderr))).toEqual({
      status: 'failed',
      stage: 'configuration',
    });

    const preflight = runLifecyclePreflight({ confirmed: false });

    expect(preflight.status).toBe(1);
    expect(preflight.stdout).toBe('');
    expect(JSON.parse(String(preflight.stderr))).toEqual({
      status: 'failed',
      stage: 'configuration',
    });
  });

  it('refuses a mismatched endpoint, missing disposable attestation, or cleartext remote URL', () => {
    const mismatchedHost = runLifecycleRehearsal(true, {
      expectedHost: 'different-temporary-endpoint.invalid',
    });
    const missingDisposableAttestation = runLifecycleRehearsal(true, {
      disposableConfirmed: false,
    });
    const cleartextRemote = runLifecycleRehearsal(true, {
      databaseUrl: 'postgresql://rehearsal.invalid/rehearsal',
      expectedHost: 'rehearsal.invalid',
    });

    for (const rehearsal of [
      mismatchedHost,
      missingDisposableAttestation,
      cleartextRemote,
    ]) {
      expect(rehearsal.status).toBe(1);
      expect(rehearsal.stdout).toBe('');
      expect(JSON.parse(String(rehearsal.stderr))).toEqual({
        status: 'failed',
        stage: 'configuration',
      });
    }
  });

  it('uses a transaction-scoped rehearsal barrier that cannot leak across pooled sessions', async () => {
    const rehearsalSource = await fs.readFile(
      path.join(process.cwd(), 'scripts/rehearse-client-lifecycle.ts'),
      'utf8',
    );

    expect(rehearsalSource).toContain('pg_advisory_xact_lock(');
    expect(rehearsalSource).not.toMatch(/\bpg_advisory_lock\s*\(/);
    expect(rehearsalSource).not.toMatch(/\bpg_advisory_unlock\s*\(/);
  });
});
