import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, type DisposableDatabaseTarget, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { buildInactiveStripeCheckoutOperation } from './checkoutContract';
import { createClosedCheckoutFixtureTransport, inspectClosedCheckoutFixtureTransport } from './closedCheckoutTransport';
import { createDurableCheckoutDispatcher } from './durableCheckoutDispatcher';
import { createDurableCheckoutRepository } from './durableCheckoutRepository';
import { closedCheckoutSession, createDurableCheckoutFixture } from './durableCheckoutTestSupport';

vi.mock('server-only', () => ({}));
const rawUrl = process.env.CUSTOMER_PAYMENT_PROVIDER_TEST_DATABASE_URL ?? '';
let target: DisposableDatabaseTarget | null = null;
if (rawUrl) {
  target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl });
} else if (process.env.CUSTOMER_PAYMENT_PROVIDER_PG_REQUIRED === 'true') {
  throw new Error('Closed checkout PostgreSQL target required but absent');
}
const suite = target ? describe.sequential : describe.skip;
const clients: pg.PoolClient[] = [];
const databases: NodePgDatabase<typeof schema>[] = [];
let pool: pg.Pool | undefined;
const worker = () => ({ workerId: randomUUID(), leaseMs: 60000 });
const repo = (index = 0) => createDurableCheckoutRepository(databases[index]!);
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function code(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}
suite('closed checkout fencing — attested PostgreSQL', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Target missing');
    }
    const expected = resolveDisposableDatabaseServerExpectation(target);
    pool = new pg.Pool({ connectionString: target.connectionString, max: 4, connectionTimeoutMillis: 5000 });
    for (let i = 0; i < 4; i += 1) {
      const client = await pool.connect();
      clients.push(client);
      await attestDisposableDatabaseSession(client, target, expected);
      await client.query('SET statement_timeout=\'15s\'; SET lock_timeout=\'8s\'; SET idle_in_transaction_session_timeout=\'20s\'');
      databases.push(drizzle(client, { schema }));
    }
    await migrate(databases[0]!, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('VERCEL', '');
  }, 120000);

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    clients.forEach(client => client.release());
    await pool?.end();
    vi.unstubAllEnvs();
  });

  it('admits one reservation transaction and exact-replays after a competing connection is refused', async () => {
    const f = await createDurableCheckoutFixture(databases[0]!);
    const entered = barrier();
    const release = barrier();
    const wrapped = { select: databases[0]!.select.bind(databases[0]), transaction: (callback: Parameters<typeof databases[0]['transaction']>[0], options: Parameters<typeof databases[0]['transaction']>[1]) => databases[0]!.transaction(async (tx) => {
      const result = await callback(tx);
      entered.release();
      await release.promise;
      return result;
    }, options) };
    const first = createDurableCheckoutRepository(wrapped as never).reserve(f.operation);
    await entered.promise;
    const second = await Promise.allSettled([repo(1).reserve(f.operation)]);
    release.release();
    const reserved = await first;

    expect(second[0]!.status).toBe('rejected');

    if (second[0]!.status === 'rejected') {
      expect(code(second[0]!.reason)).toBe('55P03');
    }

    expect(await repo(1).reserve(f.operation)).toEqual(reserved);
  });

  it('rejects independent request identity collision and persists both the hold and audit', async () => {
    const f = await createDurableCheckoutFixture(databases[0]!);
    await repo().reserve(f.operation);
    const conflicting = buildInactiveStripeCheckoutOperation({ ...f.operation.material, operationId: randomUUID(), appointmentId: 'other_unbound_appointment' }, f.operation.binding);

    await expect(repo(1).reserve(conflicting)).rejects.toThrow('DURABLE_IDENTITY_CONFLICT_RETAINED');
    expect(await repo(2).inspect(f.operation)).toMatchObject({ state: 'review', reason: 'identity_conflict' });
  });

  it('serializes simultaneous dispatchers on distinct backend connections into at most one create', async () => {
    const f = await createDurableCheckoutFixture(databases[0]!);
    const wire = createClosedCheckoutFixtureTransport([{ kind: 'create', operationId: f.operation.material.operationId, outcome: 'response', response: closedCheckoutSession(f.operation) }]);
    const results = await Promise.allSettled([createDurableCheckoutDispatcher(repo(), wire).create(f.operation), createDurableCheckoutDispatcher(repo(1), wire).create(f.operation)]);

    expect(results.some(value => value.status === 'fulfilled')).toBe(true);
    expect(inspectClosedCheckoutFixtureTransport(wire).calls).toHaveLength(1);
    expect(await repo(2).inspect(f.operation)).toMatchObject({ state: 'session_observed' });
  });

  it('uses server clock rather than skewed Date.now for quote and lease dispatch gates', async () => {
    const f = await createDurableCheckoutFixture(databases[0]!);
    const wire = createClosedCheckoutFixtureTransport([{ kind: 'create', operationId: f.operation.material.operationId, outcome: 'response', response: closedCheckoutSession(f.operation) }]);
    vi.spyOn(Date, 'now').mockReturnValue(f.operation.material.quoteExpiresAt + 86400000);

    expect(await createDurableCheckoutDispatcher(repo(), wire).create(f.operation)).toMatchObject({ state: 'session_observed' });
    expect(inspectClosedCheckoutFixtureTransport(wire).calls).toHaveLength(1);
  });

  it('never grants create after committed intent expires on another connection', async () => {
    const f = await createDurableCheckoutFixture(databases[0]!);
    await repo().reserve(f.operation);
    const claimed = await repo().claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 1000 });
    await repo().recordDispatchIntent(f.operation, claimed.lease!);
    await clients[2]!.query('SELECT pg_sleep(1.1)');

    await expect(repo(1).claimCreate(f.operation, worker())).rejects.toThrow('DURABLE_RECONCILIATION_REQUIRED');
    expect((await repo(1).claimReconcile(f.operation, worker())).result).toMatchObject({ state: 'uncertain', reason: 'no_bound_session' });
  });

  it('atomically reclaims only a pre-intent lease while fencing the stale backend', async () => {
    const f = await createDurableCheckoutFixture(databases[0]!);
    await repo().reserve(f.operation);
    const stale = await repo().claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 50 });
    await clients[2]!.query('SELECT pg_sleep(0.08)');
    const replacement = await repo(1).claimCreate(f.operation, worker());

    await expect(repo().recordDispatchIntent(f.operation, stale.lease!)).rejects.toThrow('DURABLE_LEASE_FENCED');
    expect((await repo(1).recordDispatchIntent(f.operation, replacement.lease!)).result).toMatchObject({ state: 'dispatch_intent' });
  });
});
