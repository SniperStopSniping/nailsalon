import path from 'node:path';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import * as depositsTransactionModule from './depositsTransaction';
import type { ShadowProvider } from './shadowObserver';
import type { Observation } from './shadowProjection';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/core/redis/redisClient', () => ({ redis: null, isRedisAvailable: async () => false }));
const { claimShadowWork, enrollShadowDeposit } = await import('./shadowStore');
const { observeShadowClaim } = await import('./shadowObserver');
const url = process.env.CONCURRENCY_TEST_DATABASE_URL;
const required = process.env.D6_R1_CONCURRENCY_REQUIRED === 'true';
if (!url && required) {
  throw new Error('D6 R1 concurrency required: disposable target missing');
}
const target = url ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: url }) : null;
const suite = target ? describe.sequential : describe.skip;
let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let serial = 0;
const BASE = 'd6r1';
const DEADLINE_TEST_COUNT = 6;
let executed = 0;
let baselineSettings: { statement_timeout: string; idle_in_transaction_session_timeout: string };
async function seed(salon = BASE, account = `acct_${salon}`) {
  serial += 1;
  const suffix = `${salon}_${serial}`;
  await db.insert(schema.salonSchema).values({ id: salon, slug: salon, name: salon }).onConflictDoNothing();
  await db.insert(schema.technicianSchema).values({ id: `tech_${salon}`, salonId: salon, name: 'Synthetic' }).onConflictDoNothing();
  await db.insert(schema.salonStripeAccountSchema).values({ id: `ssa_${salon}`, salonId: salon, stripeAccountId: account, livemode: false }).onConflictDoNothing();
  const start = new Date(Date.UTC(2099, 0, serial, 12));
  await db.insert(schema.appointmentSchema).values({ id: `appt_${suffix}`, salonId: salon, technicianId: `tech_${salon}`, clientPhone: '4165550100', clientName: 'Synthetic', startTime: start, endTime: new Date(start.getTime() + 3600000), status: 'confirmed', totalPrice: 6500, totalDurationMinutes: 60 });
  await db.insert(schema.appointmentDepositSchema).values({ id: `dep_${suffix}`, salonId: salon, appointmentId: `appt_${suffix}`, amountCents: 2500, currency: 'cad', status: 'paid', stripeAccountId: account, stripePaymentIntentId: `pi_${suffix}` });

  expect(await enrollShadowDeposit(salon, `dep_${suffix}`, false)).toBe(true);

  return { salon, suffix, id: `dep_${suffix}`, pi: `pi_${suffix}`, charge: `ch_${suffix}`, account };
}
function observation(d: Awaited<ReturnType<typeof seed>>, overrides: Partial<Observation> = {}): Observation {
  return { account: d.account, livemode: false, collection: { id: d.charge, paymentIntentId: d.pi, amount: 2500, currency: 'cad', paid: true, captured: true, amountCaptured: 2500, disputed: false, amountRefunded: 0 }, refunds: [], disputes: [], pagesComplete: true, disputePagesComplete: true, requestIds: ['req_scripted'], ...overrides };
}
async function state(id: string) {
  return (await db.execute(sql`SELECT * FROM deposit_shadow_state WHERE deposit_id=${id}`)).rows[0]!;
}
function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
async function waitFor(check: () => boolean, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }
    await sleep(25);
  }
  return check();
}
async function settings(client: pg.PoolClient) {
  const { rows } = await client.query('SELECT current_setting(\'statement_timeout\') AS statement_timeout, current_setting(\'idle_in_transaction_session_timeout\') AS idle_in_transaction_session_timeout');
  return rows[0] as { statement_timeout: string; idle_in_transaction_session_timeout: string };
}
function provider(o: Observation): ShadowProvider {
  return {
    collection: async (_pi, ctx) => {
      expect(depositsTransactionModule.isInsideDepositsTransaction()).toBe(false);
      expect(ctx.account).toBe(o.account);
      expect(ctx.livemode).toBe(o.livemode);

      return { fact: o.collection, requestId: 'req_collection' };
    },
    refunds: async () => ({ data: o.refunds, hasMore: false, requestId: 'req_refunds' }),
    refund: async (id) => {
      const r = o.refunds.find(r => r.id === id);
      if (!r) {
        throw new Error('scripted_missing_refund');
      }
      return r;
    },
    disputes: async () => ({ data: o.disputes, hasMore: false, requestId: 'req_disputes' }),
  };
}
suite('D6 R1 inactive PostgreSQL acceptance', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Missing disposable target');
    }
    pool = new pg.Pool({ connectionString: target.connectionString, max: 2, connectionTimeoutMillis: 15000 });
    const client = await pool.connect();
    try {
      await attestDisposableDatabaseSession(client, target, resolveDisposableDatabaseServerExpectation(target));
    } finally {
      client.release();
    }
    const settingsClient = await pool.connect();
    try {
      baselineSettings = await settings(settingsClient);
    } finally {
      settingsClient.release();
    }
    db = drizzle(pool, { schema });
    holder.db = db;
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 120000);

  beforeEach(async () => {
    executed += 1;
    vi.clearAllMocks();
    await db.execute(sql`TRUNCATE deposit_shadow_receipt,deposit_shadow_object,deposit_shadow_observation,
      deposit_shadow_attempt,deposit_shadow_command,deposit_shadow_state CASCADE`);
    // Only this suite's synthetic fixtures;
    // Existing named suites have independent fixtures.
    await db.execute(sql`DELETE FROM appointment_deposit WHERE salon_id LIKE 'd6r1%'`);
    await db.execute(sql`DELETE FROM appointment WHERE salon_id LIKE 'd6r1%'`);
    await db.execute(sql`DELETE FROM salon WHERE id LIKE 'd6r1%'`);
    await db.execute(sql`DELETE FROM stripe_webhook_event WHERE event_id LIKE 'evt_%'`);
  });

  afterAll(async () => {
    expect(executed).toBe(DEADLINE_TEST_COUNT);

    process.stdout.write(`D6_R1_DEADLINE_POSTGRES_TESTS_EXECUTED=${executed} D6_R1_DEADLINE_POSTGRES_TESTS_SKIPPED=0\n`);
    await pool?.end();
  });

  it('FINAL REVIEW paused finalizer releases its global binding lock before the matching lease deadline', async () => {
    const d = await seed('d6r1_global_pause');
    const unrelated = await seed('d6r1_global_unrelated');
    await db.execute(sql`UPDATE deposit_shadow_state SET next_due_at=now()+interval '1 hour' WHERE deposit_id=${unrelated.id}`);
    const [claim] = await claimShadowWork(1, Date.now() + 1400);

    expect(claim).toBeDefined();

    const { PgDialect } = await import('drizzle-orm/pg-core');
    const dialect = new PgDialect();
    let entered!: () => void;
    const atShare = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const real = depositsTransactionModule.depositsTransaction;
    const spy = vi.spyOn(depositsTransactionModule, 'depositsTransaction').mockImplementation(async (database, work) => real(database, async tx => work(new Proxy(tx, {
      get(target, property) {
        if (property !== 'execute') {
          return Reflect.get(target, property);
        }
        return async (query: any) => {
          const result = await target.execute(query);
          if (dialect.sqlToQuery(query).sql.includes('LOCK TABLE salon_stripe_account IN SHARE MODE')) {
            entered();
            await paused;
          }
          return result;
        };
      },
    }))));
    let writerSettledAt: number | null = null;
    const running = observeShadowClaim(claim!, provider(observation(d))).then(result => ({ result }), error => ({ error }));
    try {
      await atShare;
      const writer = db.execute(sql`UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause='revoked_local' WHERE salon_id=${unrelated.salon}`).then(() => {
        writerSettledAt = Date.now();
      });

      expect(await waitFor(() => writerSettledAt !== null, claim!.deadline)).toBe(true);
      expect(writerSettledAt).not.toBeNull();
      expect(writerSettledAt!).toBeLessThanOrEqual(claim!.deadline);
      expect(pool.waitingCount).toBe(0);

      const capacity = await Promise.all([pool.connect(), pool.connect()]);
      capacity.forEach(client => client.release());
      process.stdout.write(`D6_R1_N1_IDLE_LOCK=${JSON.stringify({ claimDeadline: claim!.deadline, writerSettledAt, beforeResume: true })}\n`);

      resume();
      await writer;
      const outcome = await running;

      expect(outcome).toMatchObject({ result: expect.stringMatching(/^(?:stale|incomplete)$/) });

      await sleep(Math.max(0, claim!.deadline - Date.now() + 25));
      const [fresh] = await claimShadowWork(1, Date.now() + 5000);

      expect(fresh).toMatchObject({ deposit_id: d.id, fence: expect.any(Number) });
      expect(fresh!.fence).toBeGreaterThan(claim!.fence);
      expect(await observeShadowClaim(fresh!, provider(observation(d)))).toBe('accepted');
      expect((await state(d.id)).certificate).toMatchObject({ financialAuthority: false });
    } finally {
      resume();
      await running;
      spy.mockRestore();
    }
  }, 10000);

  it('FINAL REVIEW active SQL followed by an idle finalizer gap releases the binding lock', async () => {
    const d = await seed('d6r1_active_then_idle');
    const unrelated = await seed('d6r1_active_then_idle_other');
    await db.execute(sql`UPDATE deposit_shadow_state SET next_due_at=now()+interval '1 hour' WHERE deposit_id=${unrelated.id}`);
    const [claim] = await claimShadowWork(1, Date.now() + 2700);

    expect(claim).toBeDefined();

    const { PgDialect } = await import('drizzle-orm/pg-core');
    const dialect = new PgDialect();
    let entered!: () => void;
    const atShare = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const real = depositsTransactionModule.depositsTransaction;
    const spy = vi.spyOn(depositsTransactionModule, 'depositsTransaction').mockImplementation(async (database, work) => real(database, async tx => work(new Proxy(tx, {
      get(target, property) {
        if (property !== 'execute') {
          return Reflect.get(target, property);
        }
        return async (query: any) => {
          if (dialect.sqlToQuery(query).sql.includes('LOCK TABLE salon_stripe_account IN SHARE MODE')) {
            await target.execute(sql`SELECT pg_sleep(0.2)`);
          }
          const result = await target.execute(query);
          if (dialect.sqlToQuery(query).sql.includes('LOCK TABLE salon_stripe_account IN SHARE MODE')) {
            entered();
            await paused;
          }
          return result;
        };
      },
    }))));
    let writerSettledAt: number | null = null;
    const running = observeShadowClaim(claim!, provider(observation(d))).then(result => ({ result }), error => ({ error }));
    try {
      await atShare;
      const writer = db.execute(sql`UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause='revoked_local' WHERE salon_id=${unrelated.salon}`).then(() => {
        writerSettledAt = Date.now();
      });

      expect(await waitFor(() => writerSettledAt !== null, claim!.deadline)).toBe(true);
      expect(writerSettledAt).not.toBeNull();
      expect(writerSettledAt!).toBeLessThanOrEqual(claim!.deadline);

      process.stdout.write(`D6_R1_N1_ACTIVE_IDLE=${JSON.stringify({ claimDeadline: claim!.deadline, writerSettledAt, beforeResume: true })}\n`);

      resume();
      await writer;

      expect(await running).toMatchObject({ result: expect.stringMatching(/^(?:stale|incomplete)$/) });
    } finally {
      resume();
      await running;
      spy.mockRestore();
    }
  }, 10000);

  it.each(['deposit_shadow_object', 'appointment_deposit', 'deposit_shadow_receipt'])('FINAL REVIEW known-refund %s read obeys its worker deadline and returns pool capacity', async (table) => {
    const a = await seed(`d6r1_known_${table}_a`);
    const b = await seed(`d6r1_known_${table}_b`);
    const deadline = Date.now() + 2700;
    const claims = await claimShadowWork(2, deadline);

    expect(claims).toHaveLength(2);

    const blocker = new pg.Client({ connectionString: target!.connectionString });
    const monitor = new pg.Client({ connectionString: target!.connectionString });
    await blocker.connect();
    await monitor.connect();
    await blocker.query('BEGIN');
    await blocker.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    const settled: boolean[] = [];
    const queryMarker = {
      deposit_shadow_object: 'SELECT object_id FROM deposit_shadow_object',
      appointment_deposit: 'SELECT stripe_refund_id,prior_refund_ids FROM appointment_deposit',
      deposit_shadow_receipt: 'SELECT projection->>\'objectId\' AS object_id',
    }[table]!;
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const dialect = new PgDialect();
    const knownReadTimings: Array<{ startedAt: number; endedAt: number }> = [];
    const real = depositsTransactionModule.depositsTransaction;
    const spy = vi.spyOn(depositsTransactionModule, 'depositsTransaction').mockImplementation(async (database, work) => real(database, async tx => work(new Proxy(tx, {
      get(target, property) {
        if (property !== 'execute') {
          return Reflect.get(target, property);
        }
        return async (query: any) => {
          if (!dialect.sqlToQuery(query).sql.includes(queryMarker)) {
            return target.execute(query);
          }
          const timing = { startedAt: Date.now(), endedAt: 0 };
          knownReadTimings.push(timing);
          try {
            return await target.execute(query);
          } finally {
            timing.endedAt = Date.now();
          }
        };
      },
    }))));
    const running = claims.map((claim, index) => observeShadowClaim(claim, provider(observation(claim.deposit_id === a.id ? a : b))).then((result) => {
      settled[index] = true;
      return { result };
    }, (error) => {
      settled[index] = true;
      return { error };
    }));
    try {
      const readDeadline = claims[0]!.deadline - 1500;
      let observedTarget = false;
      while (Date.now() < readDeadline && !observedTarget) {
        const activity = await monitor.query('SELECT query,wait_event_type FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state=\'active\'');
        observedTarget = activity.rows.some(row => String(row.query).includes(queryMarker) && row.wait_event_type === 'Lock');
        if (!observedTarget) {
          await sleep(25);
        }
      }

      process.stdout.write(`D6_R1_N2_TARGET_PROBE=${JSON.stringify({ table, observedTarget, knownReadTimings })}\n`);

      expect(observedTarget).toBe(true);

      await sleep(Math.max(0, readDeadline - Date.now() + 75));

      const initialReadTimings = knownReadTimings.slice(0, 2);

      expect(initialReadTimings).toHaveLength(2);
      expect(initialReadTimings.every(timing => timing.endedAt > 0 && timing.endedAt <= readDeadline)).toBe(true);

      process.stdout.write(`D6_R1_N2_READ_BOUNDARY=${JSON.stringify({ table, readDeadline, workerDeadline: deadline, initialReadTimings, knownReadTimings, observedTarget, waiting: pool.waitingCount })}\n`);

      await sleep(Math.max(0, deadline - Date.now() + 75));
      const active = await monitor.query('SELECT query FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state=\'active\'');
      const outcomes = await Promise.all(running);

      expect(settled.filter(Boolean)).toHaveLength(2);
      expect(pool.waitingCount).toBe(0);
      expect(active.rows).toHaveLength(0);
      expect(outcomes).toEqual([
        { result: expect.stringMatching(/^(?:stale|incomplete)$/) },
        { result: expect.stringMatching(/^(?:stale|incomplete)$/) },
      ]);

      await blocker.query('ROLLBACK');
      await Promise.all(running);
      const [fresh] = await claimShadowWork(1, Date.now() + 5000);

      expect(fresh).toBeDefined();
      expect(await observeShadowClaim(fresh!, provider(observation(fresh!.deposit_id === a.id ? a : b)))).toBe('accepted');

      const clients = await Promise.all([pool.connect(), pool.connect()]);
      try {
        await expect(Promise.all(clients.map(settings))).resolves.toEqual([baselineSettings, baselineSettings]);
      } finally {
        clients.forEach(client => client.release());
      }
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      await Promise.all(running);
      await blocker.end();
      await monitor.end();
      spy.mockRestore();
    }
  }, 10000);

  it('FINAL REVIEW pause outside a transaction permits fence reclaim and rejects the old observation', async () => {
    const d = await seed('d6r1_pause_reclaim');
    const [old] = await claimShadowWork(1, Date.now() + 1200);

    expect(old).toBeDefined();

    await sleep(1350);
    const [fresh] = await claimShadowWork(1, Date.now() + 10000);

    expect(fresh).toBeDefined();
    expect(fresh!.fence).toBeGreaterThan(old!.fence);
    expect(await observeShadowClaim(fresh!, provider(observation(d)))).toBe('accepted');

    const before = await state(d.id);

    expect(await observeShadowClaim(old!, provider(observation(d)))).toBe('stale');
    expect((await state(d.id)).certificate).toEqual(before.certificate);
  });
});
