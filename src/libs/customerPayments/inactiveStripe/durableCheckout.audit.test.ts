import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { prepareCustomerPaymentQuoteForToken } from '../server/prepareQuoteForToken';
import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import { buildInactiveStripeCheckoutOperation } from './checkoutContract';
import { createClosedCheckoutFixtureTransport } from './closedCheckoutTransport';
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
    throw new Error('AUDIT_NETWORK_FORBIDDEN');
  });
  vi.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('AUDIT_NETWORK_FORBIDDEN');
  });
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('AUDIT_NETWORK_FORBIDDEN');
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

async function consumedFixture(leaseMs = 10000, responseOverrides: Record<string, unknown> = {}) {
  const f = await createDurableCheckoutFixture(database as never);
  const repository = createDurableCheckoutRepository(database as never);
  const response = closedCheckoutSession(f.operation, responseOverrides);
  const transport = createClosedCheckoutFixtureTransport([{ kind: 'create', operationId: f.operation.material.operationId, outcome: 'response', response }]);
  await repository.reserve(f.operation);
  const claimed = await repository.claimCreate(f.operation, { workerId: randomUUID(), leaseMs });
  const intent = await repository.recordDispatchIntent(f.operation, claimed.lease!);
  const consumed = await repository.consume(f.operation, intent.lease!, transport);
  return { ...f, repository, response, consumed, outcome: await consumed.outcome! };
}

// Produce a second authoritative appointment under the same account without
// bypassing prepared-quote identity checks or altering immutable fixture rows.
async function siblingFixture(f: Pick<Awaited<ReturnType<typeof createDurableCheckoutFixture>>, 'appointmentId' | 'itemId' | 'tokenId' | 'operation'>) {
  const [appointment] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId));
  const [service] = await database.select().from(schema.appointmentServicesSchema).where(eq(schema.appointmentServicesSchema.id, f.itemId));
  const [capability] = await database.select().from(schema.appointmentAccessTokenSchema).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
  const appointmentId = `audit_appt_${randomUUID()}`;
  await database.insert(schema.appointmentSchema).values({ ...appointment!, id: appointmentId, startTime: new Date(appointment!.startTime.getTime() + 7200000), endTime: new Date(appointment!.endTime.getTime() + 7200000) });
  await database.insert(schema.appointmentServicesSchema).values({ ...service!, id: randomUUID(), appointmentId });
  // Token authentication is exercised by preparing from a new private token.
  const token = Buffer.from(randomUUID() + randomUUID()).toString('base64url');
  await database.insert(schema.appointmentAccessTokenSchema).values({ ...capability!, id: randomUUID(), appointmentId, tokenHash: createHash('sha256').update(token).digest('hex') });
  const quote = await prepareCustomerPaymentQuoteForToken(database as never, token, { requestId: randomUUID(), tipCents: 2000 });
  const operation = buildInactiveStripeCheckoutOperation({ ...f.operation.material, operationId: randomUUID(), requestId: randomUUID(), appointmentId, quoteId: quote.id, contextHash: quote.fingerprint, createdAt: quote.createdAt.getTime(), quoteExpiresAt: quote.expiresAt.getTime(), sessionExpiresAt: Math.ceil(quote.expiresAt.getTime() / 1000) * 1000 + 1800000 }, f.operation.binding);
  return { operation };
}

async function ownedObjects(operationId: string) {
  return (await client.query<{ object_id: string }>('SELECT object_id FROM customer_payment_closed_checkout_object WHERE operation_id=$1 ORDER BY object_id', [operationId])).rows.map(row => row.object_id);
}

describe('independent durable closed checkout audit', () => {
  it('detaches mutable operation and lease inputs before waiting for database work', async () => {
    const f = await createDurableCheckoutFixture(database as never);
    const repository = createDurableCheckoutRepository(database as never);
    await repository.reserve(f.operation);
    const claimed = await repository.claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 10000 });
    const mutable = structuredClone(f.operation);
    const mutableClaim = { ...claimed.lease! };
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wrapped = {
      select: database.select.bind(database),
      transaction: async (callback: Parameters<typeof database.transaction>[0], options: Parameters<typeof database.transaction>[1]) => {
        await ready;
        return database.transaction(callback, options);
      },
    };
    const pending = createDurableCheckoutRepository(wrapped as never).recordDispatchIntent(mutable, mutableClaim);
    const changed = buildInactiveStripeCheckoutOperation({ ...f.operation.material, successUrl: 'https://closed.invalid/after-wait' }, f.operation.binding);
    Object.assign(mutable, structuredClone(changed));
    mutableClaim.token = randomUUID();
    mutableClaim.version += 100;
    release();

    expect(await pending).toMatchObject({ result: { identityHash: f.operation.identityHash, state: 'dispatch_intent' } });
    expect(await repository.inspect(f.operation)).toMatchObject({ identityHash: f.operation.identityHash, state: 'dispatch_intent' });
  });

  it('does not let a caller rewrite a privately branded fixture response', async () => {
    const f = await consumedFixture();

    expect(Object.isFrozen(f.outcome)).toBe(true);

    if (!f.outcome.ok) {
      throw new Error('AUDIT_EXPECTED_RESPONSE');
    }

    expect(Object.isFrozen(f.outcome.response)).toBe(true);
    expect(() => {
      (f.outcome as { response: unknown }).response = closedCheckoutSession(f.operation, { id: 'cs_test_forged' });
    }).toThrow();

    await f.repository.recordOutcome(f.operation, f.consumed.lease!, f.outcome);

    expect(await ownedObjects(f.operation.material.operationId)).toEqual([f.response.id]);
  });

  it('replays an exact recorded observation without creating a false stale-evidence hold', async () => {
    const f = await consumedFixture();
    const recorded = await f.repository.recordOutcome(f.operation, f.consumed.lease!, f.outcome);
    const restarted = createDurableCheckoutRepository(database as never);

    expect(await restarted.recordOutcome(f.operation, f.consumed.lease!, f.outcome)).toEqual(recorded);
    expect(await restarted.inspect(f.operation)).toMatchObject({ state: 'session_observed', reason: 'session_response' });

    const rows = (await client.query('SELECT * FROM customer_payment_closed_checkout_observation WHERE operation_id=$1', [f.operation.material.operationId])).rows;

    expect(rows).toHaveLength(1);
  });

  it('fails closed if rejected-evidence retention is silently suppressed', async () => {
    const f = await consumedFixture(10000, { amount_total: 1, diagnostic: 'never-save-private-value' });
    await client.exec(`CREATE FUNCTION audit_suppress_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER audit_suppress_observation BEFORE INSERT ON customer_payment_closed_checkout_observation FOR EACH ROW EXECUTE FUNCTION audit_suppress_observation();`);
    try {
      await expect(f.repository.recordOutcome(f.operation, f.consumed.lease!, f.outcome)).rejects.toThrow('DURABLE_OBSERVATION_WRITE_FAILED');
      expect(await f.repository.inspect(f.operation)).toMatchObject({ state: 'dispatch_intent' });
    } finally {
      await client.exec('DROP TRIGGER audit_suppress_observation ON customer_payment_closed_checkout_observation; DROP FUNCTION audit_suppress_observation();');
    }
    await f.repository.recordOutcome(f.operation, f.consumed.lease!, f.outcome);

    expect(await f.repository.inspect(f.operation)).toMatchObject({ state: 'review' });

    const retained = (await client.query('SELECT * FROM customer_payment_closed_checkout_observation WHERE operation_id=$1', [f.operation.material.operationId])).rows;

    expect(retained).toHaveLength(1);
    expect(JSON.stringify(retained)).not.toContain('never-save-private-value');
  });

  it('keeps all persisted fixture evidence redacted and observations immutable', async () => {
    const f = await consumedFixture();
    await f.repository.recordOutcome(f.operation, f.consumed.lease!, f.outcome);
    for (const [table, key] of [['operation', 'id'], ['state', 'operation_id'], ['object', 'operation_id'], ['audit', 'operation_id'], ['observation', 'operation_id'], ['conflict', 'operation_id']]) {
      const rows = (await client.query(`SELECT * FROM customer_payment_closed_checkout_${table} WHERE ${key}=$1`, [f.operation.material.operationId])).rows;

      expect(JSON.stringify(rows)).not.toMatch(/private-url|private@example|success_url|cancel_url|sk_test|clientPhone|tokenHash|Private fixture name/);
    }

    await expect(client.query('UPDATE customer_payment_closed_checkout_observation SET late=true WHERE operation_id=$1', [f.operation.material.operationId])).rejects.toThrow('CLOSED_CHECKOUT_IMMUTABLE');
    await expect(client.query('DELETE FROM customer_payment_closed_checkout_observation WHERE operation_id=$1', [f.operation.material.operationId])).rejects.toThrow('CLOSED_CHECKOUT_IMMUTABLE');
  });

  it('retains a late successful create identity without granting an expired lease success', async () => {
    const f = await consumedFixture(1000);
    await new Promise(resolve => setTimeout(resolve, 1100));

    await f.repository.recordOutcome(f.operation, f.consumed.lease!, f.outcome);

    expect(await ownedObjects(f.operation.material.operationId)).toContain(f.response.id);

    const state = await f.repository.inspect(f.operation);

    expect(state.state).not.toBe('session_observed');
    expect(state.providerOriginVerified).toBe(false);
    expect(state.financialPostingAllowed).toBe(false);
    await expect(f.repository.claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 1000 })).resolves.toMatchObject({ lease: null });
  });

  it('retains late evidence after an identity conflict without clearing sticky review', async () => {
    const f = await consumedFixture();
    const changed = buildInactiveStripeCheckoutOperation({ ...f.operation.material, successUrl: 'https://closed.invalid/changed' }, f.operation.binding);

    await expect(f.repository.reserve(changed)).rejects.toThrow('IDENTITY_CONFLICT');

    await f.repository.recordOutcome(f.operation, f.consumed.lease!, f.outcome);
    await f.repository.recordOutcome(f.operation, f.consumed.lease!, f.outcome);

    expect(await ownedObjects(f.operation.material.operationId)).toContain(f.response.id);
    expect(await f.repository.inspect(f.operation)).toMatchObject({ state: 'review', session: null, reason: 'identity_conflict' });
  });

  it('retains failed charge history, accepts its later captured charge and rejects captured identity replacement', async () => {
    const f = await createDurableCheckoutFixture(database as never);
    const repository = createDurableCheckoutRepository(database as never);
    const intent = (operation: InactiveStripeCheckoutOperation, chargeId: string, paid: boolean) => ({
      id: 'pi_auditChargeHistory',
      object: 'payment_intent',
      livemode: false,
      amount: operation.snapshot.chargeCents,
      amount_received: paid ? operation.snapshot.chargeCents : 0,
      currency: 'cad',
      application_fee_amount: operation.snapshot.applicationFeeCents,
      capture_method: 'automatic',
      payment_method_types: ['card'],
      status: paid ? 'succeeded' : 'requires_payment_method',
      transfer_data: null,
      on_behalf_of: null,
      latest_charge: {
        id: chargeId,
        object: 'charge',
        livemode: false,
        payment_intent: 'pi_auditChargeHistory',
        amount: operation.snapshot.chargeCents,
        amount_captured: paid ? operation.snapshot.chargeCents : 0,
        amount_refunded: 0,
        currency: 'cad',
        paid,
        captured: paid,
        refunded: false,
        status: paid ? 'succeeded' : 'failed',
        application_fee_amount: operation.snapshot.applicationFeeCents,
        application_fee: paid && operation.snapshot.applicationFeeCents > 0 ? 'fee_auditHistory' : null,
        transfer_data: null,
        on_behalf_of: null,
      },
    });
    const sessionId = closedCheckoutSession(f.operation).id;
    const transport = createClosedCheckoutFixtureTransport([
      { kind: 'create', operationId: f.operation.material.operationId, outcome: 'response', response: closedCheckoutSession(f.operation, { payment_intent: intent(f.operation, 'ch_auditFailed', false) }) },
      ...['ch_auditCaptured', 'ch_auditReplacement'].map(chargeId => ({ kind: 'retrieve' as const, operationId: f.operation.material.operationId, sessionId, outcome: 'response' as const, response: closedCheckoutSession(f.operation, { status: 'complete', payment_status: 'paid', payment_intent: intent(f.operation, chargeId, true) }) })),
    ]);
    const dispatcher = createDurableCheckoutDispatcher(repository, transport);

    expect(await dispatcher.create(f.operation)).toMatchObject({ state: 'session_observed', session: { chargeId: 'ch_auditFailed', feeCheck: 'intent_amount_matches' } });
    expect(await dispatcher.reconcile(f.operation)).toMatchObject({ state: 'session_observed', session: { chargeId: 'ch_auditCaptured', feeCheck: 'captured_charge_amount_matches' } });
    expect(await dispatcher.reconcile(f.operation)).toMatchObject({ state: 'review', session: { chargeId: 'ch_auditCaptured', feeCheck: 'captured_charge_amount_matches' } });
    expect(await ownedObjects(f.operation.material.operationId)).toEqual(expect.arrayContaining(['ch_auditFailed', 'ch_auditCaptured', 'ch_auditReplacement', 'pi_auditChargeHistory', sessionId]));
  });

  it('retains newly seen intent ownership even when the same observation conflicts on session ownership', async () => {
    const first = await consumedFixture();
    await first.repository.recordOutcome(first.operation, first.consumed.lease!, first.outcome);
    const second = await siblingFixture(first);
    const repository = createDurableCheckoutRepository(database as never);
    const response = closedCheckoutSession(second.operation, { id: first.response.id, payment_intent: 'pi_auditNewIdentity' });
    const transport = createClosedCheckoutFixtureTransport([{ kind: 'create', operationId: second.operation.material.operationId, outcome: 'response', response }]);
    await repository.reserve(second.operation);
    const claimed = await repository.claimCreate(second.operation, { workerId: randomUUID(), leaseMs: 10000 });
    const intent = await repository.recordDispatchIntent(second.operation, claimed.lease!);
    const consumed = await repository.consume(second.operation, intent.lease!, transport);

    await repository.recordOutcome(second.operation, consumed.lease!, await consumed.outcome!);

    expect(await repository.inspect(second.operation)).toMatchObject({ state: 'review' });
    expect(await first.repository.inspect(first.operation)).toMatchObject({ state: 'review' });
    expect(await ownedObjects(first.operation.material.operationId)).toContain(first.response.id);
    expect(await ownedObjects(second.operation.material.operationId)).toContain('pi_auditNewIdentity');
  });
});
