import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

/**
 * H2 — end-to-end proof against the REAL `src/libs/DB.ts` wiring (not just
 * the isolated `runtimeDatabasePoolRecovery` primitive). `pg`'s `Pool` is
 * mocked so this runs with no real network I/O and no real Postgres, but
 * every other line — bootstrap, classification, attestation, the cooldown —
 * is the production code.
 *
 * This reproduces the incident directly: a Neon `53000` quota error at
 * module load must NOT poison the module (import still succeeds), the first
 * request after that must fail safely, a LATER request after the provider
 * recovers must succeed WITHOUT re-importing the module (no process
 * restart, no redeploy), and a genuinely wrong database must keep failing
 * forever, cooldown or not.
 *
 * It also pins the regression a first attempt at this fix introduced and an
 * adversarial review caught: `db` must stay a GENUINE Drizzle handle at all
 * times. A lazy Proxy standing in for `db` while unavailable breaks every
 * chained query builder in this codebase (`db.select().from().where()`
 * returns a `Promise`, not a builder, once wrapped) — `db.select` alone
 * being callable is not enough. See "chained query builder calls" below.
 */

const harness = vi.hoisted(() => ({
  /**
   * Controls the live-attestation marker query specifically (what
   * `verifyRuntimeDatabaseConnection` sees when pg-pool's `verify` hook
   * runs for a new physical connection).
   */
  markerRespond: (() => {
    throw new Error('harness.markerRespond not configured for this test');
  }) as (queryText: string) => Promise<unknown>,
  /**
   * Controls what a REAL application query gets back once attestation has
   * already passed for that connection — decoupled from the marker query so
   * tests can assert on actual returned data, not just "did not throw".
   */
  queryRespond: (async () => ({ rows: [] })) as (queryText: string) => Promise<unknown>,
  poolInstances: [] as Array<{ ended: boolean }>,
}));

type VerifyFn = (
  client: { query: (text: string) => Promise<unknown> },
  callback: (error?: Error) => void,
) => void;

vi.mock('pg', async () => {
  // drizzle-orm's own `drizzle(client, config)` factory
  // (node_modules/drizzle-orm/node-postgres/driver.cjs) decides whether its
  // first argument IS an existing Pool/Client — vs. a plain config object it
  // should build a NEW real Pool from — by checking `params[0] instanceof
  // EventEmitter`, not `instanceof Pool` and not duck-typing. A fake Pool
  // that doesn't extend EventEmitter gets silently treated as a config
  // object, and drizzle constructs a SECOND, entirely real Pool with
  // default (127.0.0.1:5432) settings underneath — which is exactly the
  // phantom ECONNREFUSED that misled the first draft of this test.
  const { EventEmitter } = await import('node:events');

  class FakePool extends EventEmitter {
    ended = false;
    private readonly verify: VerifyFn;

    constructor(config: { verify: VerifyFn }) {
      super();
      this.verify = config.verify;
      harness.poolInstances.push(this);
    }

    async query(text: string): Promise<unknown> {
      // Our fake never keeps an idle client around, so — like a real
      // pg-pool asked for a client with none idle — every call here
      // simulates opening a brand-new physical connection, which is
      // exactly when the real `verify` hook runs.
      const fakeClient = { query: async (q: string) => harness.markerRespond(q) };
      await new Promise<void>((resolve, reject) => {
        this.verify(fakeClient, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      // Attestation passed for this connection — now actually answer the
      // real query, decoupled from the marker check above.
      return harness.queryRespond(text);
    }

    async end() {
      this.ended = true;
    }

    async connect() {
      throw new Error('FakePool.connect() is not used by this suite.');
    }
  }

  return { Pool: FakePool };
});

function quotaExceededOnce(): Promise<never> {
  return Promise.reject(Object.assign(new Error('exceeded the compute time quota'), { code: '53000' }));
}

/** No marker table — the normal, valid state for a real Production database. */
function validProductionMarker(): Promise<never> {
  return Promise.reject(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
}

/** A marker row proving this is actually a Development database. */
function wrongDatabaseMarker(): Promise<{ rows: Array<Record<string, unknown>> }> {
  return Promise.resolve({ rows: [{ environment: 'development' }] });
}

const originalEnvironment = { ...process.env };

function setProductionEnv() {
  process.env = {
    ...originalEnvironment,
    APP_ENV: 'production',
    DATABASE_URL: 'postgresql://database.example.test/luster_production',
    NODE_ENV: 'production',
    VERCEL: '1',
    VERCEL_ENV: 'production',
  };
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  delete process.env.VITEST;
}

type GlobalWithDb = typeof globalThis & {
  pgPool?: unknown;
  pgDrizzle?: unknown;
  pgTargetFingerprint?: unknown;
};

/**
 * DB.ts deliberately caches the pool on `globalThis` — that is the whole
 * point (dev/HMR reuse). `vi.resetModules()` clears the MODULE registry, not
 * `globalThis`, so each test must clear these globals itself or the
 * previous test's cached pool would leak into the next one.
 */
function resetGlobalDatabaseState() {
  const globals = globalThis as GlobalWithDb;
  delete globals.pgPool;
  delete globals.pgDrizzle;
  delete globals.pgTargetFingerprint;
}

describe('DB.ts runtime pool recovery (mocked pg, real DB.ts + guard wiring)', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
    harness.poolInstances = [];
    harness.queryRespond = async () => ({ rows: [] });
    resetGlobalDatabaseState();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('a provider failure at module load does not poison the module — import succeeds, and the first request still fails safely', async () => {
    setProductionEnv();
    harness.markerRespond = quotaExceededOnce;

    const { db } = await import('./DB');

    // The import itself must resolve (this is the whole point: the OLD code
    // threw here, poisoning the module for the rest of the process).
    expect(db).toBeDefined();

    await expect(db.execute(sql`SELECT 1`)).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
    // Exactly one Pool, constructed once at module load, and it is NEVER
    // disposed — it stays live so the next connection this SAME pool opens
    // (not a new pool) can retry once the cooldown elapses. Disposing a
    // whole pool on one failed connection was the old, wrong design.
    expect(harness.poolInstances).toHaveLength(1);
    expect(harness.poolInstances[0]?.ended).toBe(false);
  });

  it('recovers without a process restart: once the provider recovers and the cooldown elapses, a caller\'s query actually resolves with real data', async () => {
    vi.useFakeTimers();
    setProductionEnv();
    harness.markerRespond = quotaExceededOnce;

    const { db } = await import('./DB');

    await expect(db.execute(sql`SELECT 1`)).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(harness.poolInstances).toHaveLength(1);

    // Provider recovers, and enough time passes to clear the bounded cooldown.
    harness.markerRespond = validProductionMarker;
    // `db.select(...)` runs with Drizzle's `rowMode: "array"` — rows come
    // back as positional value arrays, not `{column: value}` objects.
    harness.queryRespond = async () => ({ rows: [['salon_nail-salon-no5']] });
    await vi.advanceTimersByTimeAsync(6000);

    // Same `db` binding, same process, same underlying Pool object — no
    // re-import, no new pool. The query must actually resolve with the
    // recovered data, not merely "not throw" — this is the exact assertion
    // an earlier draft of this test swallowed with `.catch(() => undefined)`,
    // which is why it did not catch the chain-breaking proxy bug.
    const result = await db
      .select({ id: schema.salonSchema.id })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.slug, 'nail-salon-no5'));

    expect(result).toEqual([{ id: 'salon_nail-salon-no5' }]);
    // Still exactly one Pool for the whole test — recovery reused the SAME
    // live pool via pg-pool's own per-connection retry; nothing was
    // recreated or disposed.
    expect(harness.poolInstances).toHaveLength(1);
    expect(harness.poolInstances[0]?.ended).toBe(false);
  });

  it('chained query builder calls work end-to-end on a healthy connection — regression test for the Proxy that broke db.select().from().where()', async () => {
    setProductionEnv();
    harness.markerRespond = validProductionMarker;
    // `db.select(...)` runs with Drizzle's `rowMode: "array"` — rows come
    // back as positional value arrays, not `{column: value}` objects.
    harness.queryRespond = async () => ({
      rows: [['salon_nail-salon-no5'], ['salon_other']],
    });

    const { db } = await import('./DB');

    // The specific shape that broke: .select() must return a real,
    // synchronously chainable builder — NOT a Promise — so .from()/.where()
    // exist on it. Calling them must not throw
    // "TypeError: db.select(...).from is not a function".
    const builder = db.select({ id: schema.salonSchema.id }).from(schema.salonSchema);

    expect(typeof builder.where).toBe('function');

    const result = await builder.where(eq(schema.salonSchema.themeKey, 'nail-salon-no5'));

    expect(result).toEqual([{ id: 'salon_nail-salon-no5' }, { id: 'salon_other' }]);
  });

  it('a connection storm does not happen: many concurrent requests during an outage share the cached failure, no extra dial-outs', async () => {
    setProductionEnv();
    harness.markerRespond = quotaExceededOnce;

    // The module's own top-level bootstrap already ran (and failed) by the
    // time this import resolves — that is the ONE real attempt.
    const { db } = await import('./DB');

    expect(harness.poolInstances).toHaveLength(1);

    // A burst of concurrent requests arriving while still within the bounded
    // cooldown must all be rejected from the cached failure, with the
    // underlying marker query never actually re-run for any of them.
    const markerRespondSpy = vi.fn(quotaExceededOnce);
    harness.markerRespond = markerRespondSpy;

    const attempts = Array.from(
      { length: 20 },
      () => db.execute(sql`SELECT 1`).catch((error: unknown) => error),
    );
    const outcomes = await Promise.all(attempts);

    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    }

    expect(markerRespondSpy).not.toHaveBeenCalled();
    // Still exactly one Pool for the entire test.
    expect(harness.poolInstances).toHaveLength(1);
  });

  it('wrong database stays rejected after the retry interval — a cooldown never turns a rejected identity into an accepted one', async () => {
    vi.useFakeTimers();
    setProductionEnv();
    harness.markerRespond = wrongDatabaseMarker;

    const { db } = await import('./DB');

    await expect(db.execute(sql`SELECT 1`)).rejects.toMatchObject({
      code: 'DATABASE_ATTESTATION_REJECTED',
    });

    // Advance past several cooldown windows. The connection string never
    // changes without a redeploy, so the SAME wrong database is discovered
    // on every bounded retry — never accepted.
    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(6000);

      await expect(db.execute(sql`SELECT 1`)).rejects.toMatchObject({
        code: 'DATABASE_ATTESTATION_REJECTED',
      });
    }

    // Never disposed, never recreated — the SAME live pool keeps
    // re-attempting attestation and keeps failing it, forever.
    expect(harness.poolInstances).toHaveLength(1);
    expect(harness.poolInstances[0]?.ended).toBe(false);
  });

  it('healthy boot keeps the existing fast path: the module-load bootstrap succeeds and its pool is never disposed', async () => {
    setProductionEnv();
    harness.markerRespond = validProductionMarker;

    const { db, usesRuntimePostgres } = await import('./DB');

    expect(db).toBeDefined();
    expect(usesRuntimePostgres).toBe(true);
    expect(harness.poolInstances).toHaveLength(1);
    expect(harness.poolInstances[0]?.ended).toBe(false);
  });
});
