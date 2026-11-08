import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { buildInactiveStripeCheckoutOperation } from './checkoutContract';
import { createClosedCheckoutFixtureTransport, inspectClosedCheckoutFixtureTransport } from './closedCheckoutTransport';
import { createDurableCheckoutDispatcher } from './durableCheckoutDispatcher';
import { createDurableCheckoutRepository } from './durableCheckoutRepository';
import { closedCheckoutSession, createDurableCheckoutFixture } from './durableCheckoutTestSupport';

vi.mock('server-only', () => ({}));
let directory: string;
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
const worker = () => ({ workerId: randomUUID(), leaseMs: 60000 });
async function reopen() {
  client = new PGlite(path.join(directory, 'db'));
  database = drizzle(client, { schema });
  await client.waitReady;
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'luster-closed-checkout-'));
  await reopen();
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.spyOn(http, 'request').mockImplementation(() => {
    throw new Error('NETWORK_FORBIDDEN');
  });
  vi.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('NETWORK_FORBIDDEN');
  });
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('NETWORK_FORBIDDEN');
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await client?.close();
  await rm(directory, { recursive: true, force: true });
});

const repository = () => createDurableCheckoutRepository(database as never);
async function fixture() {
  const f = await createDurableCheckoutFixture(database as never);
  const transport = createClosedCheckoutFixtureTransport([{ kind: 'create', operationId: f.operation.material.operationId, outcome: 'response', response: closedCheckoutSession(f.operation) }]);
  return { ...f, transport, repository: repository(), dispatcher: createDurableCheckoutDispatcher(repository(), transport) };
}

describe('durable closed checkout fencing', () => {
  it('persists exact replay without another create and retains only redacted synthetic evidence', async () => {
    const f = await fixture();
    const first = await f.dispatcher.create(f.operation);
    const replay = await createDurableCheckoutDispatcher(repository(), f.transport).create(structuredClone(f.operation));

    expect(replay).toEqual(first);
    expect(first).toMatchObject({ state: 'session_observed', source: 'closed_test_fixture', providerOriginVerified: false, financialPostingAllowed: false });
    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(1);

    const rows = await client.query('SELECT to_jsonb(o) AS operation, to_jsonb(s) AS state FROM customer_payment_closed_checkout_operation o JOIN customer_payment_closed_checkout_state s ON o.id=s.operation_id WHERE o.id=$1', [f.operation.material.operationId]);
    const durable = JSON.stringify(rows.rows);

    expect(durable).not.toMatch(/private-url|private@example|success_url|cancel_url|sk_test|clientPhone|tokenHash/);
    expect((await client.query('SELECT count(*)::int AS n FROM customer_payment_closed_checkout_audit WHERE operation_id=$1', [f.operation.material.operationId])).rows[0]).toEqual({ n: 5 });
    expect((await client.query('SELECT id FROM appointment_payment WHERE appointment_id=$1', [f.appointmentId])).rows).toEqual([]);
    expect((await client.query('SELECT id FROM appointment_deposit WHERE appointment_id=$1', [f.appointmentId])).rows).toEqual([]);
  });

  it.each(['operation', 'request', 'appointment'] as const)('holds immutable %s collision across repository reconstruction', async (kind) => {
    const f = await fixture();
    await f.repository.reserve(f.operation);
    const material = { ...f.operation.material };
    if (kind === 'operation') {
      material.requestId = randomUUID();
    } else if (kind === 'request') {
      material.operationId = randomUUID();
      material.appointmentId = 'unbound_other_appointment';
    } else {
      material.operationId = randomUUID();
      material.requestId = randomUUID();
    }
    const changed = buildInactiveStripeCheckoutOperation(material, f.operation.binding);

    await expect(repository().reserve(changed)).rejects.toThrow('DURABLE_IDENTITY_CONFLICT_RETAINED');
    expect(await repository().inspect(f.operation)).toMatchObject({ state: 'review', reason: 'identity_conflict' });
    expect(await f.dispatcher.create(f.operation)).toMatchObject({ state: 'review' });
    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(0);
    expect((await client.query('SELECT count(*)::int AS n FROM customer_payment_closed_checkout_conflict WHERE operation_id=$1', [f.operation.material.operationId])).rows[0]).toEqual({ n: 1 });
  });

  it('allows only one simultaneous create across independent repository instances', async () => {
    const f = await fixture();
    const other = createDurableCheckoutDispatcher(repository(), f.transport);
    const results = await Promise.allSettled([f.dispatcher.create(f.operation), other.create(f.operation)]);

    expect(results.some(value => value.status === 'fulfilled')).toBe(true);
    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(1);
    expect(await repository().inspect(f.operation)).toMatchObject({ state: 'session_observed' });
  });

  it('reclaims a pre-intent expired lease but fences the previous worker', async () => {
    const f = await fixture();
    await f.repository.reserve(f.operation);
    const old = await f.repository.claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 30 });
    await new Promise(resolve => setTimeout(resolve, 50));
    const replacement = await repository().claimCreate(f.operation, worker());

    await expect(f.repository.recordDispatchIntent(f.operation, old.lease!)).rejects.toThrow('DURABLE_LEASE_FENCED');
    expect((await repository().recordDispatchIntent(f.operation, replacement.lease!)).result.state).toBe('dispatch_intent');
    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(0);
  });

  it('keeps post-intent crash uncertainty across an actual child process and persistent store restart', async () => {
    const f = await fixture();
    await f.repository.reserve(f.operation);
    const claimed = await f.repository.claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 1000 });
    await f.repository.recordDispatchIntent(f.operation, claimed.lease!);
    await new Promise(resolve => setTimeout(resolve, 1050));
    const operationPath = path.join(directory, 'fixture-operation.json');
    await writeFile(operationPath, JSON.stringify(f.operation));
    await client.close();
    try {
      const script = `
        import fs from 'node:fs';
        import { PGlite } from '@electric-sql/pglite';
        import { drizzle } from 'drizzle-orm/pglite';
        import repositoryModule from './src/libs/customerPayments/inactiveStripe/durableCheckoutRepository.ts';
        const { createDurableCheckoutRepository } = repositoryModule;
        const client = new PGlite(${JSON.stringify(path.join(directory, 'db'))});
        const operation = JSON.parse(fs.readFileSync(${JSON.stringify(operationPath)}, 'utf8'));
        const repository = createDurableCheckoutRepository(drizzle(client));
        let blocked = false;
        try { await repository.claimCreate(operation, {workerId: ${JSON.stringify(randomUUID())}, leaseMs:60000}); }
        catch (error) { blocked = error.message.includes('DURABLE_RECONCILIATION_REQUIRED'); }
        const state = await repository.claimReconcile(operation, {workerId: ${JSON.stringify(randomUUID())}, leaseMs:60000});
        process.stdout.write(JSON.stringify({blocked, state:state.result.state, reason:state.result.reason}));
        await client.close();
      `;
      const output = execFileSync('/usr/local/bin/node', ['--import', 'tsx', '--conditions=react-server', '--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'development', VERCEL_ENV: '', VERCEL: '' }, timeout: 30000, encoding: 'utf8' });

      expect(JSON.parse(output)).toEqual({ blocked: true, state: 'uncertain', reason: 'no_bound_session' });
    } finally {
      await reopen();
    }

    await expect(repository().claimCreate(f.operation, worker())).rejects.toThrow('DURABLE_RECONCILIATION_REQUIRED');
    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(0);
  }, 40000);

  it('timeout and no-bound-session reconciliation never grant another create', async () => {
    const f = await fixture();
    const transport = createClosedCheckoutFixtureTransport([{ kind: 'create', operationId: f.operation.material.operationId, outcome: 'timeout' }]);
    const dispatcher = createDurableCheckoutDispatcher(repository(), transport);

    expect(await dispatcher.create(f.operation)).toMatchObject({ state: 'uncertain', reason: 'create_outcome_unknown' });
    expect(await createDurableCheckoutDispatcher(repository(), transport).reconcile(f.operation)).toMatchObject({ state: 'uncertain', reason: 'no_bound_session' });
    await expect(dispatcher.create(f.operation)).rejects.toThrow('DURABLE_RECONCILIATION_REQUIRED');
    expect(inspectClosedCheckoutFixtureTransport(transport).calls).toHaveLength(1);
  });

  it('exact-ID 404 preserves last observation and cannot reopen creation', async () => {
    const f = await fixture();
    await f.dispatcher.create(f.operation);
    const read = createClosedCheckoutFixtureTransport([{ kind: 'retrieve', operationId: f.operation.material.operationId, sessionId: closedCheckoutSession(f.operation).id, outcome: 'not_found' }]);
    const reconciler = createDurableCheckoutDispatcher(repository(), read);
    const result = await reconciler.reconcile(f.operation);

    expect(result).toMatchObject({ state: 'uncertain', reason: 'retrieval_unresolved', session: { sessionId: closedCheckoutSession(f.operation).id } });
    await expect(reconciler.create(f.operation)).rejects.toThrow('DURABLE_RECONCILIATION_REQUIRED');
    expect(inspectClosedCheckoutFixtureTransport(read).calls).toHaveLength(1);
  });

  it.each(['before_intent', 'after_intent'] as const)('rechecks current appointment context %s and consumes nothing after a change', async (when) => {
    const f = await fixture();
    await f.repository.reserve(f.operation);
    const claimed = await f.repository.claimCreate(f.operation, worker());
    const intent = when === 'after_intent' ? await f.repository.recordDispatchIntent(f.operation, claimed.lease!) : claimed;
    await database.update(schema.appointmentSchema).set({ startTime: new Date(Date.now() + 90000000) }).where(eq(schema.appointmentSchema.id, f.appointmentId));
    const result = when === 'after_intent'
      ? await f.repository.consume(f.operation, intent.lease!, f.transport)
      : await f.repository.recordDispatchIntent(f.operation, intent.lease!);

    expect(result.result).toMatchObject({ state: 'review', reason: 'source_context_changed' });
    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(0);
  });

  it('rejects foreign transports, callback barriers and forged outcomes', async () => {
    const f = await fixture();

    expect(() => createDurableCheckoutDispatcher(repository(), { kind: 'closed_checkout_fixture' })).toThrow('CLOSED_FIXTURE_TRANSPORT_REQUIRED');
    expect(() => createClosedCheckoutFixtureTransport([{ kind: 'create', operationId: f.operation.material.operationId, outcome: 'response', waitFor: { then() {
      throw new Error('MUST_NOT_RUN');
    } } } as never])).toThrow('INVALID_CLOSED_FIXTURE_SCRIPT');
    await expect(f.repository.recordOutcome(f.operation, { operationId: f.operation.material.operationId, version: 0, token: randomUUID(), activity: 'create' }, { ok: true, response: closedCheckoutSession(f.operation) })).rejects.toThrow('DURABLE_CLOSED_OUTCOME_REQUIRED');
  });

  it.each(['NODE_ENV', 'APP_ENV', 'VERCEL_ENV'] as const)('rechecks %s runtime before persisted intent or transport consumption', async (env) => {
    const f = await fixture();
    await f.repository.reserve(f.operation);
    vi.stubEnv(env, 'production');

    await expect(f.dispatcher.create(f.operation)).rejects.toThrow('RUNTIME_DISABLED');
    expect(() => inspectClosedCheckoutFixtureTransport(f.transport)).toThrow('RUNTIME_DISABLED');
  });
});
