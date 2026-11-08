/** Independent commit-boundary tests. Only a closed script and disposable PGlite. */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { createClosedCheckoutFixtureTransport, inspectClosedCheckoutFixtureTransport } from './closedCheckoutTransport';
import { createDurableCheckoutDispatcher } from './durableCheckoutDispatcher';
import { createDurableCheckoutRepository } from './durableCheckoutRepository';
import { closedCheckoutSession, createDurableCheckoutFixture } from './durableCheckoutTestSupport';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.spyOn(http, 'request').mockImplementation(() => {
    throw new Error('REVIEW_REAL_HTTP_FORBIDDEN');
  });
  vi.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('REVIEW_REAL_HTTPS_FORBIDDEN');
  });
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('REVIEW_REAL_FETCH_FORBIDDEN');
  }));
});

afterEach(() => {
  expect(http.request).not.toHaveBeenCalled();
  expect(https.request).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(async () => client?.close());

async function prepared() {
  const f = await createDurableCheckoutFixture(database as never);
  const repository = createDurableCheckoutRepository(database as never);
  await repository.reserve(f.operation);
  const claim = await repository.claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 60000 });
  const intent = await repository.recordDispatchIntent(f.operation, claim.lease!);
  const step = { kind: 'create' as const, operationId: f.operation.material.operationId, outcome: 'response' as const, response: closedCheckoutSession(f.operation) };
  // A second matching response makes an accidental second consumption observable.
  const transport = createClosedCheckoutFixtureTransport([step, step]);
  return { ...f, repository, intent, transport };
}

describe('independent durable checkout commit boundaries', () => {
  it('keeps the create latch committed if a transaction aborts after the fake was consumed', async () => {
    const f = await prepared();
    let fail = true;
    const wrapped = {
      select: database.select.bind(database),
      transaction: (callback: Parameters<typeof database.transaction>[0], options: Parameters<typeof database.transaction>[1]) => database.transaction(async (tx) => {
        const value = await callback(tx);
        if (fail && inspectClosedCheckoutFixtureTransport(f.transport).calls.length > 0) {
          fail = false;
          throw new Error('REVIEW_ABORT_AFTER_CLOSED_CONSUMPTION');
        }
        return value;
      }, options),
    };
    const repository = createDurableCheckoutRepository(wrapped as never);

    await expect(repository.consume(f.operation, f.intent.lease!, f.transport)).rejects.toThrow('REVIEW_ABORT_AFTER_CLOSED_CONSUMPTION');

    const restarted = createDurableCheckoutRepository(database as never);

    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(1);
    expect((await restarted.inspect(f.operation)).createConsumedAt).not.toBeNull();
    await expect(restarted.consume(f.operation, f.intent.lease!, f.transport)).rejects.toThrow();
    await expect(createDurableCheckoutDispatcher(restarted, f.transport).create(f.operation)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(1);
  });

  it('never retries a committed consumption latch when the commit acknowledgment is lost', async () => {
    const f = await prepared();
    let loseAcknowledgment = true;
    const wrapped = {
      select: database.select.bind(database),
      transaction: async (callback: Parameters<typeof database.transaction>[0], options: Parameters<typeof database.transaction>[1]) => {
        const value = await database.transaction(callback, options);
        if (loseAcknowledgment) {
          loseAcknowledgment = false;
          throw new Error('REVIEW_COMMIT_ACKNOWLEDGMENT_LOST');
        }
        return value;
      },
    };
    const repository = createDurableCheckoutRepository(wrapped as never);

    await expect(repository.consume(f.operation, f.intent.lease!, f.transport)).rejects.toThrow('REVIEW_COMMIT_ACKNOWLEDGMENT_LOST');

    const restarted = createDurableCheckoutRepository(database as never);
    const beforeRetry = inspectClosedCheckoutFixtureTransport(f.transport).calls.length;

    expect((await restarted.inspect(f.operation)).createConsumedAt).not.toBeNull();
    expect(beforeRetry).toBeLessThanOrEqual(1);
    await expect(restarted.consume(f.operation, f.intent.lease!, f.transport)).rejects.toThrow();
    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(beforeRetry);
  });

  it('treats lost dispatch-intent commit acknowledgment as uncertainty before any fake call', async () => {
    const f = await createDurableCheckoutFixture(database as never);
    const repository = createDurableCheckoutRepository(database as never);
    await repository.reserve(f.operation);
    const claim = await repository.claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 60000 });
    const wrapped = {
      select: database.select.bind(database),
      transaction: async (callback: Parameters<typeof database.transaction>[0], options: Parameters<typeof database.transaction>[1]) => {
        await database.transaction(callback, options);
        throw new Error('REVIEW_INTENT_COMMIT_ACKNOWLEDGMENT_LOST');
      },
    };
    const transport = createClosedCheckoutFixtureTransport([{ kind: 'create', operationId: f.operation.material.operationId, outcome: 'response', response: closedCheckoutSession(f.operation) }]);

    await expect(createDurableCheckoutRepository(wrapped as never).recordDispatchIntent(f.operation, claim.lease!)).rejects.toThrow('REVIEW_INTENT_COMMIT_ACKNOWLEDGMENT_LOST');

    const restarted = createDurableCheckoutRepository(database as never);
    const state = await restarted.inspect(f.operation);

    expect(state.dispatchIntentAt).not.toBeNull();
    expect(state.createConsumedAt).toBeNull();
    await expect(createDurableCheckoutDispatcher(restarted, transport).create(f.operation)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(inspectClosedCheckoutFixtureTransport(transport).calls).toHaveLength(0);
  });

  it('rejects a raw SQL response after its retrieval lease expires', async () => {
    const f = await prepared();
    const consumed = await f.repository.consume(f.operation, f.intent.lease!, f.transport);
    await f.repository.recordOutcome(f.operation, consumed.lease!, await consumed.outcome!);
    const claim = await f.repository.claimReconcile(f.operation, { workerId: randomUUID(), leaseMs: 100 });
    await new Promise(resolve => setTimeout(resolve, 130));
    const before = await f.repository.inspect(f.operation);

    expect(claim.lease).not.toBeNull();
    await expect(client.query(`UPDATE customer_payment_closed_checkout_state
      SET version=version+1,state='session_observed',reason='session_response',
      session=jsonb_set(session,'{status}','"expired"'::jsonb),
      worker_id=NULL,lease_token=NULL,lease_until=NULL,activity=NULL
      WHERE operation_id=$1`, [f.operation.material.operationId])).rejects.toThrow('CLOSED_CHECKOUT_RESPONSE_FENCED');
    expect(await f.repository.inspect(f.operation)).toEqual(before);
  });

  it('does not consume a fake when a trigger suppresses the consumed-state write', async () => {
    const f = await prepared();
    const before = await f.repository.inspect(f.operation);
    await client.exec(`CREATE FUNCTION review_suppress_consumed_state() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.reason='create_consumed' THEN RETURN NULL; END IF; RETURN NEW; END $$;
      CREATE TRIGGER review_suppress_consumed_state BEFORE UPDATE ON customer_payment_closed_checkout_state
      FOR EACH ROW EXECUTE FUNCTION review_suppress_consumed_state();`);
    try {
      await expect(f.repository.consume(f.operation, f.intent.lease!, f.transport)).rejects.toThrow('DURABLE_STATE_WRITE_FAILED');
    } finally {
      await client.exec('DROP TRIGGER review_suppress_consumed_state ON customer_payment_closed_checkout_state; DROP FUNCTION review_suppress_consumed_state();');
    }

    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(0);
    expect(await f.repository.inspect(f.operation)).toEqual(before);
  });

  it('does not consume a fake when a trigger suppresses the required durable audit', async () => {
    const f = await prepared();
    const before = await f.repository.inspect(f.operation);
    await client.exec(`CREATE FUNCTION review_suppress_consumed_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NULL; END $$;
      CREATE TRIGGER review_suppress_consumed_audit BEFORE INSERT ON customer_payment_closed_checkout_audit
      FOR EACH ROW EXECUTE FUNCTION review_suppress_consumed_audit();`);
    try {
      await expect(f.repository.consume(f.operation, f.intent.lease!, f.transport)).rejects.toThrow();
    } finally {
      await client.exec('DROP TRIGGER review_suppress_consumed_audit ON customer_payment_closed_checkout_audit; DROP FUNCTION review_suppress_consumed_audit();');
    }

    expect(inspectClosedCheckoutFixtureTransport(f.transport).calls).toHaveLength(0);
    expect(await f.repository.inspect(f.operation)).toEqual(before);
  });
});
