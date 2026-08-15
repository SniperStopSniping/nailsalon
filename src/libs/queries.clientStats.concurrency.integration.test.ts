/**
 * Genuine-PostgreSQL proof that client-stat refreshes serialize the complete
 * aggregate -> overwrite cycle on the stable client row. PGlite has only one
 * physical session and cannot discriminate this ordering mutant.
 */
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attestDisposableDatabaseSession,
  type DisposableDatabaseTarget,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
const REQUIRED = process.env.D6_CONCURRENCY_REQUIRED === 'true';

let disposableTarget: DisposableDatabaseTarget | null = null;
if (RAW_URL) {
  disposableTarget = requireDisposableDatabaseTarget({
    ...process.env,
    DATABASE_URL: RAW_URL,
  });
} else if (REQUIRED) {
  throw new Error(
    'D6.1 PostgreSQL client-stat concurrency is required, but CONCURRENCY_TEST_DATABASE_URL is absent.',
  );
}

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const { updateSalonClientStats } = await import('./queries');

const SALON_ID = 'salon_d6_1_client_stats_concurrency';
const CLIENT_ID = 'client_d6_1_client_stats_concurrency';
const APPOINTMENT_ID = 'appt_d6_1_client_stats_concurrency';
const PHONE = '4165550198';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
type TestTransaction = Parameters<Parameters<TestDb['transaction']>[0]>[0];
type Deferred = { promise: Promise<void>; resolve: () => void };

let pool: pg.Pool;
let db: TestDb;
let executedTests = 0;

function createDeferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  const withRows = result as { rows?: unknown } | null;
  return Array.isArray(withRows?.rows) ? withRows.rows as T[] : [];
}

async function waitForSecondRefreshOrdering(input: {
  firstPid: number;
  secondSettled: () => boolean;
}): Promise<'blocked' | 'settled'> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const blocked = await pool.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM pg_stat_activity AS activity
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND $1 = ANY(pg_blocking_pids(activity.pid))
    `, [input.firstPid]);
    if ((blocked.rows[0]?.count ?? 0) >= 1) {
      return 'blocked';
    }
    if (input.secondSettled()) {
      return 'settled';
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('The second client-stat refresh neither blocked nor settled.');
}

function withBlockedSalonClientUpdate(
  transaction: TestTransaction,
  reached: Deferred,
  release: Deferred,
): TestTransaction {
  type UpdateWhere = {
    where: (condition: unknown) => PromiseLike<unknown>;
  };
  type UpdateSet = {
    set: (values: Record<string, unknown>) => UpdateWhere;
  };
  const originalUpdate = transaction.update.bind(transaction) as unknown as (
    table: unknown,
  ) => UpdateSet;

  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property === 'update') {
        return (table: unknown) => {
          const update = originalUpdate(table);
          if (table !== schema.salonClientSchema) {
            return update;
          }
          return {
            set(values: Record<string, unknown>) {
              const setQuery = update.set(values);
              return {
                where(condition: unknown) {
                  return (async () => {
                    reached.resolve();
                    await release.promise;
                    return setQuery.where(condition);
                  })();
                },
              };
            },
          };
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function'
        ? value.bind(target)
        : value;
    },
  });
}

const suite = disposableTarget ? describe.sequential : describe.skip;

suite('updateSalonClientStats — genuine PostgreSQL serialization', () => {
  beforeAll(async () => {
    if (!disposableTarget) {
      throw new Error('Disposable target unexpectedly absent inside active D6.1 suite.');
    }
    pool = new pg.Pool({ connectionString: disposableTarget.connectionString, max: 8 });
    const attestationClient = await pool.connect();
    try {
      await attestDisposableDatabaseSession(
        attestationClient,
        disposableTarget,
        resolveDisposableDatabaseServerExpectation(disposableTarget),
      );
    } finally {
      attestationClient.release();
    }
    db = drizzle(pool, { schema });
    holder.db = db;
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 120_000);

  beforeEach(async () => {
    holder.db = db;
    await pool.query('TRUNCATE TABLE salon RESTART IDENTITY CASCADE');
    await db.insert(schema.salonSchema).values({
      id: SALON_ID,
      name: 'D6.1 Client Stats Concurrency Salon',
      slug: 'd6-1-client-stats-concurrency',
    });
    await db.insert(schema.salonClientSchema).values({
      id: CLIENT_ID,
      salonId: SALON_ID,
      phone: PHONE,
      fullName: 'D6.1 Stats Client',
      loyaltyPoints: 0,
      totalSpent: 0,
    });
    const startTime = new Date('2099-12-01T15:00:00.000Z');
    await db.insert(schema.appointmentSchema).values({
      id: APPOINTMENT_ID,
      salonId: SALON_ID,
      salonClientId: CLIENT_ID,
      clientPhone: PHONE,
      clientName: 'D6.1 Stats Client',
      startTime,
      endTime: new Date(startTime.getTime() + 60 * 60_000),
      totalDurationMinutes: 60,
      status: 'completed',
      paymentStatus: 'paid',
      totalPrice: 5000,
      finalPriceCents: 5000,
      completedAt: new Date('2099-12-01T16:00:00.000Z'),
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }

    expect(executedTests).toBe(1);

    process.stdout.write(
      `D6_1_CLIENT_STATS_POSTGRES_TESTS_EXECUTED=${executedTests} D6_1_CLIENT_STATS_POSTGRES_TESTS_SKIPPED=0\n`,
    );
  });

  it('prevents an older aggregate from overwriting a refresh triggered by newer money state', async () => {
    const firstUpdateReached = createDeferred();
    const releaseFirstUpdate = createDeferred();
    const secondTransactionStarted = createDeferred();
    let transactionOrdinal = 0;
    let firstPid: number | null = null;

    const instrumentedDb = {
      transaction: <T>(work: (transaction: TestTransaction) => Promise<T>) => db.transaction(
        async (transaction) => {
          transactionOrdinal += 1;
          if (transactionOrdinal === 1) {
            const pidResult = await transaction.execute<{ pid: number }>(
              sql`SELECT pg_backend_pid()::int AS pid`,
            );
            firstPid = resultRows<{ pid: number }>(pidResult)[0]?.pid ?? null;
            return work(withBlockedSalonClientUpdate(
              transaction,
              firstUpdateReached,
              releaseFirstUpdate,
            ));
          }
          secondTransactionStarted.resolve();
          return work(transaction);
        },
      ),
    };

    holder.db = instrumentedDb;
    let firstRefresh: Promise<void> | null = null;
    let secondRefresh: Promise<void> | null = null;
    let secondSettled = false;
    try {
      firstRefresh = updateSalonClientStats(SALON_ID, PHONE);
      await firstUpdateReached.promise;

      expect(firstPid).not.toBeNull();

      // The first refresh has already read 5000 cents and is paused immediately
      // before its overwrite. This later financial transition makes spend zero.
      await db.update(schema.appointmentSchema).set({ paymentStatus: 'pending' })
        .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

      secondRefresh = updateSalonClientStats(SALON_ID, PHONE).finally(() => {
        secondSettled = true;
      });
      await secondTransactionStarted.promise;

      // With the early FOR UPDATE, the newer refresh must queue before reading
      // its aggregate. Removing that lock lets it finish first, after which the
      // paused stale 5000-cent write wins and this mutant fails.
      await expect(waitForSecondRefreshOrdering({
        firstPid: firstPid!,
        secondSettled: () => secondSettled,
      })).resolves.toBe('blocked');
    } finally {
      releaseFirstUpdate.resolve();
      await Promise.allSettled([
        ...(firstRefresh ? [firstRefresh] : []),
        ...(secondRefresh ? [secondRefresh] : []),
      ]);
      holder.db = db;
    }

    const [client] = await db.select().from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, CLIENT_ID));

    expect(client).toMatchObject({
      totalVisits: 1,
      totalSpent: 0,
      loyaltyPoints: 0,
    });

    executedTests += 1;
  }, 30_000);
});
