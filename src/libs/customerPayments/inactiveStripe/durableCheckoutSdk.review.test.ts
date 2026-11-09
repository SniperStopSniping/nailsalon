/** Independent adversarial review. All SDK traffic is closed in-memory HTTP. */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { prepareCustomerPaymentQuoteForToken } from '../server/prepareQuoteForToken';
import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import type { ClosedCheckoutSdkStep, ClosedSdkCheckoutAuthorization } from './closedCheckoutSdkTransport';
import { createClosedCheckoutSdkExecution, createClosedCheckoutSdkTransport, inspectClosedCheckoutSdkTransport } from './closedCheckoutSdkTransport';
import { createDurableCheckoutRepository, createDurableSdkCheckoutRepository } from './durableCheckoutRepository';
import { createDurableCheckoutSdkBridge } from './durableCheckoutSdkBridge';
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
    throw new Error('SDK_REVIEW_NETWORK_FORBIDDEN');
  });
  vi.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('SDK_REVIEW_NETWORK_FORBIDDEN');
  });
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('SDK_REVIEW_NETWORK_FORBIDDEN');
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

function script(operation: InactiveStripeCheckoutOperation): ClosedCheckoutSdkStep[] {
  const binding = operation.binding;
  return [
    { method: 'GET', path: '/v1/account', response: { id: binding.platformAccountId, object: 'account' } },
    { method: 'GET', path: '/v1/balance', response: { object: 'balance', livemode: false } },
    { method: 'GET', path: `/v1/accounts/${binding.connectedAccountId}`, response: {
      id: binding.connectedAccountId,
      object: 'account',
      country: 'CA',
      default_currency: 'cad',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { card_payments: 'active' },
      controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' },
      requirements: { disabled_reason: null, currently_due: [], past_due: [], pending_verification: [], errors: null },
    } },
    { method: 'GET', path: '/v1/balance', account: binding.connectedAccountId, response: { object: 'balance', livemode: false } },
    { method: 'POST', path: '/v1/checkout/sessions', account: binding.connectedAccountId, response: closedCheckoutSession(operation) },
  ];
}

function request(f: Awaited<ReturnType<typeof createDurableCheckoutFixture>>) {
  return { token: f.token, salonId: f.salonId, appointmentId: f.appointmentId, quoteId: f.quote.id, operationId: f.operation.material.operationId, requestId: f.operation.material.requestId, platformAccountId: f.operation.binding.platformAccountId };
}
async function reserved() {
  const fixture = await createDurableCheckoutFixture(database as never);
  const repository = createDurableSdkCheckoutRepository(database as never);
  const input = request(fixture);
  const { operation } = await repository.reserveAuthenticated(input);
  return { ...fixture, input, operation, repository };
}
async function ready(f: Awaited<ReturnType<typeof reserved>>) {
  const claim = await f.repository.claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 60000 });
  const transport = createClosedCheckoutSdkTransport(script(f.operation));
  const execution = createClosedCheckoutSdkExecution(transport, f.operation, 'create', null);
  await execution.preflight();
  const intent = await f.repository.recordDispatchIntent(f.operation, claim.lease!);
  return { transport, execution, intent };
}

describe('independent durable SDK boundary review', () => {
  it('rejects a fabricated permit even when the real intent claim is otherwise exact', async () => {
    const f = await reserved();
    const { transport, execution, intent } = await ready(f);
    const forged: ClosedSdkCheckoutAuthorization = {
      result: intent.result,
      lease: { ...intent.lease!, version: intent.lease!.version + 1 },
      permit: { databaseNow: Date.now(), sampleStarted: performance.now(), leaseUntil: Date.now() + 60000, quoteExpiresAt: f.operation.material.quoteExpiresAt, sessionId: null },
    };

    await expect(execution.execute(intent.lease!, async () => forged)).rejects.toThrow('SDK_PERMIT_NOT_CONFIRMED');
    expect(inspectClosedCheckoutSdkTransport(transport).calls.filter(call => call.method === 'POST')).toHaveLength(0);
    expect((await f.repository.inspect(f.operation)).createConsumedAt).toBeNull();
  });

  it('does not reuse a genuine committed one-use permit in a second SDK execution', async () => {
    const f = await reserved();
    const { execution, intent } = await ready(f);
    let authorization!: ClosedSdkCheckoutAuthorization;
    const first = await execution.execute(intent.lease!, async () => {
      authorization = await f.repository.consumeSdkPermit(f.operation, intent.lease!);
      return authorization;
    });

    expect(first.outcome).not.toBeNull();

    const replayTransport = createClosedCheckoutSdkTransport(script(f.operation));
    const replay = createClosedCheckoutSdkExecution(replayTransport, f.operation, 'create', null);
    await replay.preflight();

    await expect(replay.execute(intent.lease!, async () => authorization)).rejects.toThrow('SDK_PERMIT_NOT_CONFIRMED');
    expect(inspectClosedCheckoutSdkTransport(replayTransport).calls.filter(call => call.method === 'POST')).toHaveLength(0);
    expect((await f.repository.inspect(f.operation)).createConsumedAt).not.toBeNull();
  });

  it.each(['operationId', 'requestId'] as const)('does not let a valid foreign bearer review-hold an existing %s owner', async (key) => {
    const owner = await reserved();
    const contender = await createDurableCheckoutFixture(database as never);
    const before = await owner.repository.inspect(owner.operation);
    const input = { ...request(contender), [key]: owner.input[key] };

    await expect(owner.repository.reserveAuthenticated(input)).rejects.toThrow('IDENTITY_SCOPE_MISMATCH');
    expect(await owner.repository.inspect(owner.operation)).toEqual(before);
    expect((await client.query('SELECT * FROM customer_payment_closed_checkout_conflict WHERE operation_id=$1', [owner.operation.material.operationId])).rows).toHaveLength(0);
    await expect(createDurableCheckoutRepository(database as never).reserve(owner.operation)).rejects.toThrow('EXECUTION_KIND_MISMATCH');
    expect(await owner.repository.inspect(owner.operation)).toEqual(before);
  });

  it('keeps valid response evidence after create authority expires without treating clock passage as source revocation', async () => {
    const fixture = await createDurableCheckoutFixture(database as never);
    await database.update(schema.appointmentAccessTokenSchema).set({ expiresAt: new Date(Date.now() + 1800) }).where(eq(schema.appointmentAccessTokenSchema.id, fixture.tokenId));
    const quote = await prepareCustomerPaymentQuoteForToken(database as never, fixture.token, { requestId: randomUUID(), tipCents: 2000 });
    const repository = createDurableSdkCheckoutRepository(database as never);
    const input = { ...request(fixture), quoteId: quote.id };
    const { operation } = await repository.reserveAuthenticated(input);
    const f = { ...fixture, quote, input, repository, operation };
    const { execution, intent } = await ready(f);
    const observed = await execution.execute(intent.lease!, () => repository.consumeSdkPermit(operation, intent.lease!));
    await new Promise(resolve => setTimeout(resolve, Math.max(0, operation.material.quoteExpiresAt - Date.now()) + 30));

    const result = await repository.recordSdkOutcome(operation, observed.lease!, observed.outcome!);

    expect(result).toMatchObject({ state: 'session_observed', reason: 'session_response', providerOriginVerified: false, financialPostingAllowed: false });
    expect(result.session?.sessionId).toBe(closedCheckoutSession(operation).id);
  });

  it('retains late evidence and the reservation when a source changes after permit commit but before the closed POST', async () => {
    const f = await reserved();
    const { execution, intent, transport } = await ready(f);
    const observed = await execution.execute(intent.lease!, async () => {
      const authorization = await f.repository.consumeSdkPermit(f.operation, intent.lease!);
      await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
      return authorization;
    });
    const result = await f.repository.recordSdkOutcome(f.operation, observed.lease!, observed.outcome!);

    expect(inspectClosedCheckoutSdkTransport(transport).calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(result).toMatchObject({ state: 'review', reason: 'source_context_changed', providerOriginVerified: false, financialPostingAllowed: false });
    expect(result.session?.sessionId).toBe(closedCheckoutSession(f.operation).id);
    await expect(database.update(schema.appointmentSchema).set({ totalPrice: 1 }).where(eq(schema.appointmentSchema.id, f.appointmentId))).rejects.toThrow();
    expect(await f.repository.claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 60000 })).toMatchObject({ lease: null, result: { state: 'review' } });
  });

  it.each(['revoked', 'pruned'] as const)('restores only the bound read after repository restart and a %s capability', async (change) => {
    const f = await reserved();
    const identity = { operationId: f.operation.material.operationId, salonId: f.salonId, appointmentId: f.appointmentId };

    await expect(f.repository.restoreForReconciliation(identity)).rejects.toThrow('EXACT_SESSION_REQUIRED');

    const { execution, intent } = await ready(f);
    const observed = await execution.execute(intent.lease!, () => f.repository.consumeSdkPermit(f.operation, intent.lease!));
    if (change === 'pruned') {
      await database.delete(schema.appointmentAccessTokenSchema).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    } else {
      await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    }
    const late = await f.repository.recordSdkOutcome(f.operation, observed.lease!, observed.outcome!);

    expect(late.state).toBe('review');

    const restarted = createDurableSdkCheckoutRepository(database as never);

    await expect(restarted.resumeAuthenticated({ ...identity, token: f.token })).rejects.toThrow('SDK_ACCESS_REQUIRED');
    await expect(restarted.restoreForReconciliation({ ...identity, salonId: 'foreign_salon' })).rejects.toThrow();

    const restored = await restarted.restoreForReconciliation(identity);

    expect(restored.operation.identityHash).toBe(f.operation.identityHash);
    expect(restored.operation.parameterHash).toBe(f.operation.parameterHash);

    const sessionId = late.session!.sessionId;
    const readTransport = createClosedCheckoutSdkTransport([
      ...script(restored.operation).slice(0, 4),
      { method: 'GET', path: `/v1/checkout/sessions/${sessionId}?expand[0]=payment_intent.latest_charge`, account: restored.operation.binding.connectedAccountId, response: closedCheckoutSession(restored.operation) },
    ]);

    const result = await createDurableCheckoutSdkBridge(restarted, readTransport).reconcileReserved(identity);

    expect(result).toMatchObject({ state: 'review', session: { sessionId }, providerOriginVerified: false, financialPostingAllowed: false });
    expect(inspectClosedCheckoutSdkTransport(readTransport).calls).toHaveLength(5);
    expect(inspectClosedCheckoutSdkTransport(readTransport).calls.every(call => call.method === 'GET')).toBe(true);
    expect((await restarted.claimCreate(restored.operation, { workerId: randomUUID(), leaseMs: 60000 })).lease).toBeNull();
    await expect(database.delete(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId))).rejects.toThrow();
  });
});
