import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { runClientLifecycleMigrationWithRetry } from '@/libs/clientLifecycleMigrationRetry';

const { Client } = pg;

const EXPECTED_0061_HASH
  = 'ec2ea523735b0a45b964ed78f6f56327c9019678c29e6e994f161a8b2a4f7731';
const EXPECTED_0061_CREATED_AT = 1784950000006;
const EXPECTED_0061_TAG = '0061_client_edit_merge_archive';
const EXPECTED_0061_OBJECT_COUNT = 19;
const EXPECTED_0062_CREATED_AT = 1784950000007;
const EXPECTED_0062_TAG = '0062_client_lifecycle_stabilization';

type MigrationJournal = {
  entries?: Array<{
    idx?: number;
    version?: string;
    when?: number;
    tag?: string;
    breakpoints?: boolean;
  }>;
};

type QueryHandle = Pick<pg.Client, 'query'>;

async function verifyRepositoryHistory(): Promise<void> {
  const migrationsDirectory = path.join(process.cwd(), 'migrations');
  const [migration0061Sql, migration0062Sql, journalJson] = await Promise.all([
    fs.readFile(
      path.join(migrationsDirectory, `${EXPECTED_0061_TAG}.sql`),
      'utf8',
    ),
    fs.readFile(
      path.join(migrationsDirectory, `${EXPECTED_0062_TAG}.sql`),
      'utf8',
    ),
    fs.readFile(path.join(migrationsDirectory, 'meta', '_journal.json'), 'utf8'),
  ]);

  const migration0061Hash = crypto
    .createHash('sha256')
    .update(migration0061Sql)
    .digest('hex');
  if (migration0061Hash !== EXPECTED_0061_HASH) {
    throw new Error('Repository migration 0061 does not match Production history.');
  }
  if (!migration0062Sql.trim()) {
    throw new Error('Repository migration 0062 is empty.');
  }

  const journal = JSON.parse(journalJson) as MigrationJournal;
  const entry0061 = journal.entries?.find(candidate => candidate.idx === 61);
  if (
    entry0061?.version !== '7'
    || entry0061.when !== EXPECTED_0061_CREATED_AT
    || entry0061.tag !== EXPECTED_0061_TAG
    || entry0061.breakpoints !== true
  ) {
    throw new Error('Repository migration journal does not match Production 0061.');
  }

  const entry0062 = journal.entries?.find(candidate => candidate.idx === 62);
  if (
    entry0062?.version !== '7'
    || entry0062.when !== EXPECTED_0062_CREATED_AT
    || entry0062.tag !== EXPECTED_0062_TAG
    || entry0062.breakpoints !== true
  ) {
    throw new Error('Repository migration journal does not match stabilization 0062.');
  }
}

async function lifecycle0061ObjectCount(handle: QueryHandle): Promise<number> {
  const result = await handle.query<{ count: string }>(`
    with objects as (
      select 'table:' || table_name as object_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'salon_client_contact_alias',
          'salon_client_note'
        )

      union all

      select 'trigger:' || triggers.tgname
      from pg_trigger as triggers
      inner join pg_class as relations on relations.oid = triggers.tgrelid
      inner join pg_namespace as namespaces
        on namespaces.oid = relations.relnamespace
      where namespaces.nspname = 'public'
        and not triggers.tgisinternal
        and triggers.tgname in (
          'salon_client_enforce_merge_transition',
          'salon_client_prevent_merged_source_update',
          'appointment_resolve_merged_client',
          'review_resolve_merged_client',
          'client_communication_resolve_merged_client',
          'retention_campaign_resolve_merged_client',
          'fraud_signal_resolve_merged_client',
          'salon_client_note_resolve_merged_client',
          'salon_client_alias_resolve_merged_client'
        )

      union all

      select 'index:' || indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'salon_client_salon_id_id_idx',
          'salon_client_lifecycle_idx',
          'salon_client_merged_into_idx',
          'salon_client_contact_alias_unique',
          'salon_client_contact_alias_client_idx',
          'salon_client_note_client_created_idx',
          'salon_client_note_source_idx'
        )

      union all

      select 'constraint:' || constraints.conname
      from pg_constraint as constraints
      inner join pg_namespace as namespaces
        on namespaces.oid = constraints.connamespace
      where namespaces.nspname = 'public'
        and constraints.conname = 'salon_client_merged_into_client_id_fkey'
        and constraints.convalidated
    )
    select count(*)::text as count
    from objects
  `);
  return Number(result.rows[0]?.count ?? 0);
}

async function verifyDatabase0061(handle: QueryHandle): Promise<void> {
  const ledger = await handle.query<{ exists: boolean }>(
    `select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  );
  const objectCount = await lifecycle0061ObjectCount(handle);
  if (ledger.rows[0]?.exists !== true) {
    if (objectCount !== 0) {
      throw new Error(
        'Lifecycle schema objects exist without a journaled migration.',
      );
    }
    return;
  }

  const migration = await handle.query<{ hash: string; created_at: string }>(
    `select hash, created_at
     from drizzle.__drizzle_migrations
     where created_at = $1
     limit 2`,
    [EXPECTED_0061_CREATED_AT],
  );
  if (migration.rowCount === 0) {
    if (objectCount !== 0) {
      throw new Error(
        'Lifecycle schema objects exist without the exact journaled 0061 migration.',
      );
    }
    return;
  }

  if (
    migration.rowCount !== 1
    || migration.rows[0]?.hash !== EXPECTED_0061_HASH
    || Number(migration.rows[0]?.created_at) !== EXPECTED_0061_CREATED_AT
  ) {
    throw new Error('Database migration 0061 does not match Production history.');
  }
  if (objectCount !== EXPECTED_0061_OBJECT_COUNT) {
    throw new Error('Database migration 0061 schema objects are incomplete.');
  }
}

async function verifyDatabase0062Ready(handle: QueryHandle): Promise<void> {
  const result = await handle.query<{
    migration_rows: string;
    ready_capability_rows: string;
  }>(
    `select
       (
         select count(*)::text
         from drizzle.__drizzle_migrations
         where created_at = $1
       ) as migration_rows,
       (
         select count(*)::text
         from app_schema_capability
         where capability = 'client_lifecycle'
           and version = 2
           and state = 'ready'
           and merge_writes_enabled = false
       ) as ready_capability_rows`,
    [EXPECTED_0062_CREATED_AT],
  );
  if (
    Number(result.rows[0]?.migration_rows ?? 0) !== 1
    || Number(result.rows[0]?.ready_capability_rows ?? 0) !== 1
  ) {
    throw new Error('Database stabilization capability is not ready.');
  }
}

async function runMigrationAttempt(
  databaseUrl: string,
  attempt: number,
): Promise<void> {
  const coordinator = new Client({
    connectionString: databaseUrl,
    application_name: `client-lifecycle-migration-coordinator-${attempt}`,
    connectionTimeoutMillis: 15_000,
  });
  const worker = new Client({
    connectionString: databaseUrl,
    application_name: `client-lifecycle-migration-${attempt}`,
    connectionTimeoutMillis: 15_000,
  });
  let coordinatorTransactionOpen = false;

  try {
    await coordinator.connect();
    await coordinator.query('begin');
    coordinatorTransactionOpen = true;
    await coordinator.query(`set local lock_timeout = '5s'`);
    await coordinator.query(`set local statement_timeout = '60s'`);
    await coordinator.query(`
      select pg_advisory_xact_lock(
        hashtextextended(
          'client-lifecycle-stabilization-migration-runner',
          0
        )
      )
    `);

    // Drizzle reads its journal before opening the migration transaction.
    // Hold a separate transaction-scoped coordinator lock first so concurrent
    // protected runners cannot both snapshot 0061 and publish duplicate 0062
    // journal rows. The worker remains separate because Drizzle owns its own
    // atomic migration transaction.
    await worker.connect();
    await worker.query(`set lock_timeout = '5s'`);
    await worker.query(`set statement_timeout = '60s'`);

    await verifyDatabase0061(worker);
    await migrate(drizzle(worker), {
      migrationsFolder: path.join(process.cwd(), 'migrations'),
    });
    await verifyDatabase0061(worker);
    await verifyDatabase0062Ready(worker);

    await coordinator.query('commit');
    coordinatorTransactionOpen = false;
  } catch (error) {
    if (coordinatorTransactionOpen) {
      await coordinator.query('rollback').catch(() => undefined);
      coordinatorTransactionOpen = false;
    }
    throw error;
  } finally {
    if (coordinatorTransactionOpen) {
      await coordinator.query('rollback').catch(() => undefined);
    }
    await Promise.all([
      worker.end().catch(() => undefined),
      coordinator.end().catch(() => undefined),
    ]);
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  await verifyRepositoryHistory();
  const startedAt = performance.now();
  let attempts = 0;
  await runClientLifecycleMigrationWithRetry(async (attempt) => {
    attempts = attempt;
    await runMigrationAttempt(databaseUrl, attempt);
  });

  // Aggregate operational output only; never echo connection information.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    status: 'ok',
    attempts,
    milliseconds: Number((performance.now() - startedAt).toFixed(2)),
  }));
}

void main().catch((error: unknown) => {
  // Do not print nested database details that may contain SQL or identifiers.

  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
});
