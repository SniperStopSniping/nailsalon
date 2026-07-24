import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';

const { Client } = pg;
const rawUrl = process.env.MIGRATION_BENCHMARK_DATABASE_URL ?? '';
const migrationTag = '0061_client_edit_merge_archive';
const migrationCreatedAt = 1784950000006;

function assertDisposableLocalDatabase(rawDatabaseUrl: string): void {
  const parsed = new URL(rawDatabaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const localHost = parsed.hostname === '127.0.0.1'
    || parsed.hostname === 'localhost';
  const disposableName
    = /(?:^|[_-])(?:benchmark|test|qa|throwaway|temp|tmp)(?:[_-]|$)/i
      .test(databaseName);

  if (
    !localHost
    || !parsed.port
    || !disposableName
    || rawDatabaseUrl.includes('neon.tech')
  ) {
    throw new Error(
      'Migration benchmark requires an explicit local disposable PostgreSQL database.',
    );
  }
}

assertDisposableLocalDatabase(rawUrl);

type LockRow = {
  relation_name: string | null;
  mode: string;
};

type ActivityRow = {
  state: string | null;
  wait_event_type: string | null;
};

async function isPending(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => false,
      () => false,
    ),
    new Promise<true>(resolve => setTimeout(() => resolve(true), 75)),
  ]);
}

async function main(): Promise<void> {
  const migrationSql = await fs.readFile(
    path.join(process.cwd(), 'migrations', `${migrationTag}.sql`),
    'utf8',
  );
  const statements = migrationSql
    .split('--> statement-breakpoint')
    .map(statement => statement.trim())
    .filter(Boolean);
  const migration = new Client({
    connectionString: rawUrl,
    application_name: 'client-lifecycle-migration-benchmark',
  });
  const observer = new Client({
    connectionString: rawUrl,
    application_name: 'client-lifecycle-migration-observer',
  });
  const appointmentWriter = new Client({
    connectionString: rawUrl,
    application_name: 'client-lifecycle-appointment-writer',
  });
  const paymentWriter = new Client({
    connectionString: rawUrl,
    application_name: 'client-lifecycle-payment-writer',
  });

  await Promise.all([
    migration.connect(),
    observer.connect(),
    appointmentWriter.connect(),
    paymentWriter.connect(),
  ]);

  let appointmentWrite: Promise<pg.QueryResult> | null = null;
  let paymentWrite: Promise<pg.QueryResult> | null = null;
  let appointmentWriteStartedAt = 0;
  let paymentWriteStartedAt = 0;
  let appointmentWriteFinishedAt = 0;
  let paymentWriteFinishedAt = 0;
  let appointmentBlocked = false;
  let paymentBlocked = false;

  try {
    const backend = await migration.query<{ pid: number }>(
      'select pg_backend_pid() as pid',
    );
    const migrationBackendPid = backend.rows[0]!.pid;
    const before = await migration.query<{ exists: boolean }>(
      `select exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'salon_client'
           and column_name = 'merged_into_client_id'
       ) as exists`,
    );
    if (before.rows[0]?.exists) {
      throw new Error('Benchmark database already contains migration 0061.');
    }

    const statementDurations: Array<{
      statement: number;
      milliseconds: number;
    }> = [];
    const firstLockSeenAt = new Map<string, number>();
    const migrationStartedAt = performance.now();
    await migration.query('begin');

    for (const [index, statement] of statements.entries()) {
      const statementStartedAt = performance.now();
      await migration.query(statement);
      statementDurations.push({
        statement: index + 1,
        milliseconds: Number(
          (performance.now() - statementStartedAt).toFixed(2),
        ),
      });

      const lockRows = await observer.query<LockRow>(
        `select
           relation::regclass::text as relation_name,
           mode
         from pg_locks
         where pid = $1
           and granted
           and relation is not null`,
        [migrationBackendPid],
      );
      const observedAt = performance.now();
      for (const lock of lockRows.rows) {
        const key = `${lock.relation_name ?? 'unknown'}:${lock.mode}`;
        if (!firstLockSeenAt.has(key)) {
          firstLockSeenAt.set(key, observedAt);
        }
      }

      if (
        statement.includes(
          'CREATE TRIGGER "appointment_resolve_merged_client"',
        )
      ) {
        appointmentWriteStartedAt = performance.now();
        appointmentWrite = appointmentWriter.query(
          `insert into appointment (
             id, salon_id, salon_client_id, client_phone, client_name,
             start_time, end_time, status, total_price, total_duration_minutes
           ) values (
             'benchmark_migration_racing_appointment',
             'benchmark_salon',
             'benchmark_client_1',
             '4160000001',
             'Historical Snapshot',
             '2027-02-01T15:00:00.000Z',
             '2027-02-01T16:00:00.000Z',
             'confirmed',
             7500,
             60
           )`,
        ).finally(() => {
          appointmentWriteFinishedAt = performance.now();
        });
        paymentWriteStartedAt = performance.now();
        paymentWrite = paymentWriter.query(
          `insert into appointment_payment (
             id, appointment_id, salon_id, amount_cents, method,
             recorded_by_type
           ) values (
             'benchmark_migration_racing_payment',
             'benchmark_appointment_2',
             'benchmark_salon',
             100,
             'credit',
             'admin'
           )`,
        ).finally(() => {
          paymentWriteFinishedAt = performance.now();
        });
        appointmentBlocked = await isPending(appointmentWrite);
        paymentBlocked = await isPending(paymentWrite);

        const activity = await observer.query<ActivityRow>(
          `select state, wait_event_type
           from pg_stat_activity
           where application_name = 'client-lifecycle-appointment-writer'`,
        );
        appointmentBlocked = appointmentBlocked
        && activity.rows[0]?.state === 'active'
        && activity.rows[0]?.wait_event_type === 'Lock';
      }
    }

    await migration.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at)
       values ($1, $2)`,
      [
        crypto.createHash('sha256').update(migrationSql).digest('hex'),
        migrationCreatedAt,
      ],
    );
    await migration.query('commit');
    const migrationFinishedAt = performance.now();
    await Promise.all([appointmentWrite, paymentWrite]);

    const longestStatement = [...statementDurations]
      .sort((left, right) => right.milliseconds - left.milliseconds)[0]!;
    const longestLock = [...firstLockSeenAt.entries()]
      .map(([lock, firstSeenAt]) => ({
        lock,
        heldMilliseconds: Number(
          (migrationFinishedAt - firstSeenAt).toFixed(2),
        ),
      }))
      .sort((left, right) => right.heldMilliseconds - left.heldMilliseconds)[0]
      ?? null;

    // Structured stdout is the benchmark artifact consumed by release review.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      migrationMilliseconds: Number(
        (migrationFinishedAt - migrationStartedAt).toFixed(2),
      ),
      statementCount: statements.length,
      longestStatement,
      longestLock,
      appointmentWrite: {
        blocked: appointmentBlocked,
        milliseconds: Number(
          (appointmentWriteFinishedAt - appointmentWriteStartedAt).toFixed(2),
        ),
      },
      paymentWrite: {
        blocked: paymentBlocked,
        milliseconds: Number(
          (paymentWriteFinishedAt - paymentWriteStartedAt).toFixed(2),
        ),
      },
    }, null, 2));
  } catch (error) {
    await migration.query('rollback').catch(() => undefined);
    await Promise.all([
      appointmentWrite?.catch(() => undefined),
      paymentWrite?.catch(() => undefined),
    ]);
    throw error;
  } finally {
    await Promise.all([
      migration.end(),
      observer.end(),
      appointmentWriter.end(),
      paymentWriter.end(),
    ]);
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Migration benchmark failed.',
  );
  process.exitCode = 1;
});
