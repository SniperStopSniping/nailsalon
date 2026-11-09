import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
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
import type { ClosedCheckoutSdkStep } from './closedCheckoutSdkTransport';
import { createClosedCheckoutSdkExecution, createClosedCheckoutSdkTransport, inspectClosedCheckoutSdkTransport } from './closedCheckoutSdkTransport';
import { consumeCommittedSdkAuthorization, createDurableCheckoutRepository, createDurableSdkCheckoutRepository } from './durableCheckoutRepository';
import { createDurableCheckoutSdkBridge } from './durableCheckoutSdkBridge';
import { closedCheckoutSession, createDurableCheckoutFixture } from './durableCheckoutTestSupport';

vi.mock('server-only', () => ({}));
let directory: string;
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
const worker = () => ({ workerId: randomUUID(), leaseMs: 60000 });
const repository = () => createDurableSdkCheckoutRepository(database as never);
async function reopen() {
  client = new PGlite(path.join(directory, 'db'));
  database = drizzle(client, { schema });
  await client.waitReady;
}
async function fixture() {
  const f = await createDurableCheckoutFixture(database as never);
  const input = { token: f.token, salonId: f.salonId, appointmentId: f.appointmentId, quoteId: f.quote.id, operationId: f.operation.material.operationId, requestId: f.operation.material.requestId, platformAccountId: f.operation.binding.platformAccountId };
  const resume = { token: f.token, salonId: f.salonId, appointmentId: f.appointmentId, operationId: input.operationId };
  return { ...f, input, resume };
}
function script(operation: Awaited<ReturnType<typeof fixture>>['operation']): ClosedCheckoutSdkStep[] {
  return [
    { method: 'GET' as const, path: '/v1/account', response: { id: operation.binding.platformAccountId, object: 'account' } },
    { method: 'GET' as const, path: '/v1/balance', response: { object: 'balance', livemode: false } },
    { method: 'GET' as const, path: `/v1/accounts/${operation.binding.connectedAccountId}`, response: { id: operation.binding.connectedAccountId, object: 'account', country: 'CA', default_currency: 'cad', controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' }, charges_enabled: true, payouts_enabled: true, details_submitted: true, capabilities: { card_payments: 'active' }, requirements: { disabled_reason: null, currently_due: [], past_due: [], pending_verification: [], errors: [] } } },
    { method: 'GET' as const, path: '/v1/balance', account: operation.binding.connectedAccountId, response: { object: 'balance', livemode: false } },
    { method: 'POST' as const, path: '/v1/checkout/sessions', account: operation.binding.connectedAccountId, response: closedCheckoutSession(operation) },
  ];
}

function paymentIntent(operation: Awaited<ReturnType<typeof fixture>>['operation'], chargeId: string, captured: boolean) {
  const amount = operation.snapshot.chargeCents;
  const fee = operation.snapshot.applicationFeeCents;
  return {
    id: 'pi_payment',
    object: 'payment_intent',
    livemode: false,
    amount,
    amount_received: captured ? amount : 0,
    currency: 'cad',
    application_fee_amount: fee,
    capture_method: 'automatic',
    payment_method_types: ['card'],
    status: captured ? 'succeeded' : 'requires_payment_method',
    transfer_data: null,
    on_behalf_of: null,
    latest_charge: {
      id: chargeId,
      object: 'charge',
      livemode: false,
      payment_intent: 'pi_payment',
      amount,
      amount_captured: captured ? amount : 0,
      amount_refunded: 0,
      currency: 'cad',
      paid: captured,
      captured,
      refunded: false,
      status: captured ? 'succeeded' : 'failed',
      application_fee_amount: captured ? fee : null,
      application_fee: captured && fee > 0 ? 'fee_payment' : null,
      transfer_data: null,
      on_behalf_of: null,
    },
  };
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'luster-sdk-reservation-'));
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

describe('capability-authenticated immutable SDK reservation', () => {
  it('reconstructs exact parameters and identity without storing bearer, digest, private URL or arbitrary return URL', async () => {
    const f = await fixture();
    const saved = await repository().reserveAuthenticated(f.input);
    const replay = await repository().reserveAuthenticated(f.input);
    const resumed = await repository().resumeAuthenticated(f.resume);

    expect(saved.operation).toEqual(f.operation);
    expect(replay).toEqual(saved);
    expect(resumed.operation).toEqual(saved.operation);
    expect(saved.result).toMatchObject({ executionKind: 'sdk_closed_http_v1', source: 'closed_test_fixture', financialPostingAllowed: false, providerOriginVerified: false });

    const stored = JSON.stringify((await client.query('SELECT to_jsonb(o) AS operation FROM customer_payment_closed_checkout_operation o WHERE id=$1', [f.input.operationId])).rows);
    const [capability] = await database.select().from(schema.appointmentAccessTokenSchema).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));

    expect(stored).not.toContain(f.token);
    expect(stored).not.toContain(capability!.tokenHash);
    expect(stored).not.toContain('https://');
    expect(stored).not.toContain('clientPhone');
    await expect(repository().reserveAuthenticated({ ...f.input, successUrl: 'https://evil.invalid/private' } as never)).rejects.toThrow();
  });

  it.each(['wrong', 'revoked', 'expired'] as const)('requires exact current bearer before %s collision can affect the journal', async (kind) => {
    const f = await fixture();
    await repository().reserveAuthenticated(f.input);
    const altered = { ...f.input, requestId: randomUUID() };
    if (kind === 'wrong') {
      altered.token = 'x'.repeat(43);
    }
    if (kind === 'revoked') {
      await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    }
    if (kind === 'expired') {
      await database.update(schema.appointmentAccessTokenSchema).set({ expiresAt: new Date(0) }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    }

    await expect(repository().reserveAuthenticated(altered)).rejects.toThrow('SDK_ACCESS_REQUIRED');
    expect(await repository().inspect(f.operation)).toMatchObject({ state: 'prepared', version: 0 });
    expect((await client.query('SELECT * FROM customer_payment_closed_checkout_conflict WHERE operation_id=$1', [f.input.operationId])).rows).toEqual([]);
  });

  it('kind-fences all legacy operations without changing SDK reservation state', async () => {
    const f = await fixture();
    await repository().reserveAuthenticated(f.input);
    const legacy = createDurableCheckoutRepository(database as never);
    const claim = { operationId: f.input.operationId, version: 0, token: randomUUID(), activity: 'create' as const };

    await expect(legacy.reserve(f.operation)).rejects.toThrow('DURABLE_EXECUTION_KIND_MISMATCH');
    await expect(legacy.inspect(f.operation)).rejects.toThrow('DURABLE_EXECUTION_KIND_MISMATCH');
    await expect(legacy.claimCreate(f.operation, worker())).rejects.toThrow('DURABLE_EXECUTION_KIND_MISMATCH');
    await expect(legacy.claimReconcile(f.operation, worker())).rejects.toThrow('DURABLE_EXECUTION_KIND_MISMATCH');
    await expect(legacy.recordDispatchIntent(f.operation, claim)).rejects.toThrow('DURABLE_EXECUTION_KIND_MISMATCH');
    expect(await repository().inspect(f.operation)).toMatchObject({ state: 'prepared', version: 0 });

    const other = await fixture();
    await legacy.reserve(other.operation);

    await expect(repository().reserveAuthenticated(other.input)).rejects.toThrow('DURABLE_EXECUTION_KIND_MISMATCH');
    await expect(repository().inspect(other.operation)).rejects.toThrow('DURABLE_EXECUTION_KIND_MISMATCH');
    expect(await legacy.inspect(other.operation)).toMatchObject({ state: 'prepared', version: 0 });
  });

  it('allows harmless notes and binding refresh after strict admission, but detects security changes', async () => {
    const f = await fixture();
    await repository().reserveAuthenticated(f.input);
    await database.update(schema.appointmentSchema).set({ notes: 'Administrative note', clientName: 'Display correction', clientEmail: 'display@example.invalid', arrivedAt: new Date() }).where(eq(schema.appointmentSchema.id, f.appointmentId));
    await database.update(schema.salonStripeAccountSchema).set({ lastSyncedAt: new Date() }).where(eq(schema.salonStripeAccountSchema.id, f.bindingId));
    const claimed = await repository().claimCreate(f.operation, worker());
    const intent = await repository().recordDispatchIntent(f.operation, claimed.lease!);

    expect(intent.lease).not.toBeNull();

    await database.update(schema.appointmentAccessTokenSchema).set({ tokenHash: 'a'.repeat(64) }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    const consumed = await repository().consumeSdkPermit(f.operation, intent.lease!);

    expect(consumed).toMatchObject({ lease: null, permit: null, result: { state: 'review', reason: 'source_context_changed' } });
    expect((await client.query('SELECT create_consumed_at FROM customer_payment_closed_checkout_state WHERE operation_id=$1', [f.input.operationId])).rows[0]).toEqual({ create_consumed_at: null });
  });

  it('keeps strict full quote fingerprint at admission even for an earlier harmless edit', async () => {
    const f = await fixture();
    await database.update(schema.appointmentSchema).set({ notes: 'Changed before admission' }).where(eq(schema.appointmentSchema.id, f.appointmentId));

    await expect(repository().reserveAuthenticated(f.input)).rejects.toThrow('SDK_QUOTE_CONTEXT_STALE');
    expect((await client.query('SELECT id FROM customer_payment_closed_checkout_operation WHERE id=$1', [f.input.operationId])).rows).toEqual([]);
  });

  it('mints a private one-use authorization only after known commit and rejects copies or a different identity', async () => {
    const f = await fixture();
    await repository().reserveAuthenticated(f.input);
    const claimed = await repository().claimCreate(f.operation, worker());
    const intent = await repository().recordDispatchIntent(f.operation, claimed.lease!);
    const authorized = await repository().consumeSdkPermit(f.operation, intent.lease!);

    expect(() => consumeCommittedSdkAuthorization({ ...authorized }, f.operation, intent.lease!)).toThrow('SDK_COMMITTED_AUTHORIZATION_REQUIRED');

    const other = buildInactiveStripeCheckoutOperation({ ...f.operation.material, requestId: randomUUID() }, f.operation.binding);

    expect(() => consumeCommittedSdkAuthorization(authorized, other, intent.lease!)).toThrow('SDK_COMMITTED_AUTHORIZATION_REQUIRED');
    expect(consumeCommittedSdkAuthorization(authorized, f.operation, intent.lease!)).toBe(authorized);
    expect(() => consumeCommittedSdkAuthorization(authorized, f.operation, intent.lease!)).toThrow('SDK_COMMITTED_AUTHORIZATION_REQUIRED');
    await expect(repository().consumeSdkPermit(f.operation, intent.lease!)).rejects.toThrow('DURABLE_LEASE_FENCED');
  });

  it('uncertain consumption commit authorizes no send and cannot regain create permission', async () => {
    const f = await fixture();
    await repository().reserveAuthenticated(f.input);
    const claimed = await repository().claimCreate(f.operation, worker());
    const intent = await repository().recordDispatchIntent(f.operation, claimed.lease!);
    const uncertain = createDurableSdkCheckoutRepository({ select: database.select.bind(database), transaction: async (...args: Parameters<typeof database.transaction>) => {
      await database.transaction(...args);
      throw new Error('COMMIT_ACK_LOST');
    } } as never);

    await expect(uncertain.consumeSdkPermit(f.operation, intent.lease!)).rejects.toThrow('COMMIT_ACK_LOST');
    expect((await repository().inspect(f.operation)).createConsumedAt).not.toBeNull();
    await expect(repository().claimCreate(f.operation, worker())).rejects.toThrow('DURABLE_RECONCILIATION_REQUIRED');
    await expect(repository().consumeSdkPermit(f.operation, intent.lease!)).rejects.toThrow('DURABLE_LEASE_FENCED');
  });

  it('connects actual SDK POST to committed reservation without network, and persists only safe observations', async () => {
    const f = await fixture();
    const transport = createClosedCheckoutSdkTransport(script(f.operation));
    const result = await createDurableCheckoutSdkBridge(repository(), transport).create(f.input);

    expect(result).toMatchObject({ state: 'session_observed', executionKind: 'sdk_closed_http_v1', session: { sessionId: closedCheckoutSession(f.operation).id }, financialPostingAllowed: false, providerOriginVerified: false });
    expect(inspectClosedCheckoutSdkTransport(transport).calls.filter(call => call.method === 'POST')).toHaveLength(1);

    const data = JSON.stringify((await client.query('SELECT * FROM customer_payment_closed_checkout_observation WHERE operation_id=$1', [f.input.operationId])).rows);

    expect(data).not.toContain('private-url');
    expect(data).not.toContain('private@example.invalid');
    expect(await repository().resumeAuthenticated(f.resume)).toMatchObject({ operation: f.operation });
  });

  it.each(['revoked', 'expired'] as const)('restores only an exact bound Session for internal recovery after capability %s', async (kind) => {
    const f = await fixture();
    await createDurableCheckoutSdkBridge(repository(), createClosedCheckoutSdkTransport(script(f.operation))).create(f.input);
    await database.update(schema.appointmentAccessTokenSchema).set(kind === 'revoked' ? { revokedAt: new Date() } : { expiresAt: new Date(0) }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));

    await expect(repository().resumeAuthenticated(f.resume)).rejects.toThrow('SDK_ACCESS_REQUIRED');

    const steps = script(f.operation);
    steps[4] = { method: 'GET', path: `/v1/checkout/sessions/${closedCheckoutSession(f.operation).id}?expand[0]=payment_intent.latest_charge`, account: f.operation.binding.connectedAccountId, response: closedCheckoutSession(f.operation) } as never;
    const transport = createClosedCheckoutSdkTransport(steps);
    const result = await createDurableCheckoutSdkBridge(repository(), transport).reconcileReserved({ operationId: f.input.operationId, salonId: f.salonId, appointmentId: f.appointmentId });

    expect(result).toMatchObject({ state: 'review', session: { sessionId: closedCheckoutSession(f.operation).id }, financialPostingAllowed: false, providerOriginVerified: false });
    expect(inspectClosedCheckoutSdkTransport(transport).calls.every(call => call.method === 'GET')).toBe(true);
    await expect(repository().claimCreate(f.operation, worker())).resolves.toMatchObject({ lease: null, result: { state: 'review' } });

    const unbound = await fixture();
    await repository().reserveAuthenticated(unbound.input);

    await expect(repository().restoreForReconciliation({ operationId: unbound.input.operationId, salonId: unbound.salonId, appointmentId: unbound.appointmentId })).rejects.toThrow('DURABLE_EXACT_SESSION_REQUIRED');
  });

  it('retains a differing later Session as a conflict without replacing the exact bound Session', async () => {
    const f = await fixture();
    await createDurableCheckoutSdkBridge(repository(), createClosedCheckoutSdkTransport(script(f.operation))).create(f.input);
    await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    const steps = script(f.operation);
    const conflictingId = `cs_test_${randomUUID().replaceAll('-', '')}`;
    steps[4] = { method: 'GET', path: `/v1/checkout/sessions/${closedCheckoutSession(f.operation).id}?expand[0]=payment_intent.latest_charge`, account: f.operation.binding.connectedAccountId, response: closedCheckoutSession(f.operation, { id: conflictingId }) } as never;
    const result = await createDurableCheckoutSdkBridge(repository(), createClosedCheckoutSdkTransport(steps)).reconcileReserved({ operationId: f.input.operationId, salonId: f.salonId, appointmentId: f.appointmentId });

    expect(result).toMatchObject({ state: 'review', session: { sessionId: closedCheckoutSession(f.operation).id } });
    expect((await client.query('SELECT object_id FROM customer_payment_closed_checkout_conflict WHERE operation_id=$1', [f.input.operationId])).rows).toEqual([{ object_id: conflictingId }]);
    expect((await client.query<{ object_id: string }>('SELECT object_id FROM customer_payment_closed_checkout_object WHERE operation_id=$1 ORDER BY object_id', [f.input.operationId])).rows.map(row => row.object_id).sort()).toEqual([closedCheckoutSession(f.operation).id, conflictingId].sort());
  });

  it.each([false, true])('reconciles a changed charge after restart only when the previous charge was uncaptured (captured=%s)', async (captured) => {
    const f = await fixture();
    const firstCharge = captured ? 'ch_captured' : 'ch_declined';
    const initial = script(f.operation);
    initial[4] = { ...initial[4]!, response: closedCheckoutSession(f.operation, {
      status: captured ? 'complete' : 'open',
      payment_status: captured ? 'paid' : 'unpaid',
      payment_intent: paymentIntent(f.operation, firstCharge, captured),
    }) };
    const created = await createDurableCheckoutSdkBridge(repository(), createClosedCheckoutSdkTransport(initial)).create(f.input);

    expect(created).toMatchObject({ state: 'session_observed', session: { chargeId: firstCharge, paymentStatus: captured ? 'paid' : 'unpaid' } });

    await client.close();
    await reopen();
    const next = script(f.operation);
    next[4] = {
      method: 'GET',
      path: `/v1/checkout/sessions/${closedCheckoutSession(f.operation).id}?expand[0]=payment_intent.latest_charge`,
      account: f.operation.binding.connectedAccountId,
      response: closedCheckoutSession(f.operation, { status: 'complete', payment_status: 'paid', payment_intent: paymentIntent(f.operation, 'ch_success', true) }),
    } as never;
    const transport = createClosedCheckoutSdkTransport(next);
    const reconciled = await createDurableCheckoutSdkBridge(repository(), transport).reconcile(f.resume);

    expect(reconciled).toMatchObject({
      state: captured ? 'review' : 'session_observed',
      session: { chargeId: captured ? firstCharge : 'ch_success', feeCheck: 'captured_charge_amount_matches', paymentStatus: 'paid' },
      providerOriginVerified: false,
      financialPostingAllowed: false,
    });
    expect(inspectClosedCheckoutSdkTransport(transport).calls.every(call => call.method === 'GET')).toBe(true);

    const owned = (await client.query<{ object_id: string }>('SELECT object_id FROM customer_payment_closed_checkout_object WHERE operation_id=$1', [f.input.operationId])).rows.map(row => row.object_id);

    expect(owned).toEqual(expect.arrayContaining([firstCharge, 'ch_success']));
    expect((await client.query('SELECT object_id FROM customer_payment_closed_checkout_conflict WHERE operation_id=$1', [f.input.operationId])).rows)
      .toEqual(captured ? [{ object_id: 'ch_success' }] : []);
  });

  it('rejects structurally forged authorization at actual SDK POST', async () => {
    const f = await fixture();
    const transport = createClosedCheckoutSdkTransport(script(f.operation));
    const execution = createClosedCheckoutSdkExecution(transport, f.operation, 'create', null);
    await execution.preflight();
    const claim = { operationId: f.input.operationId, version: 1, token: randomUUID(), activity: 'create' as const };

    await expect(execution.execute(claim, async () => ({ result: {} as never, lease: { ...claim, version: 2 }, permit: { databaseNow: Date.now(), sampleStarted: performance.now(), quoteExpiresAt: f.operation.material.quoteExpiresAt, leaseUntil: Date.now() + 60000, sessionId: null } }))).rejects.toThrow();
    expect(inspectClosedCheckoutSdkTransport(transport).calls.filter(call => call.method === 'POST')).toHaveLength(0);
  });

  it.each(['reservation', 'intent', 'consumption'] as const)('reconstructs across process restart after %s commit, never reopens a latched create', async (phase) => {
    const f = await fixture();
    await repository().reserveAuthenticated(f.input);
    if (phase !== 'reservation') {
      const claimed = await repository().claimCreate(f.operation, { workerId: randomUUID(), leaseMs: 1000 });
      const intent = await repository().recordDispatchIntent(f.operation, claimed.lease!);
      if (phase === 'consumption') {
        await repository().consumeSdkPermit(f.operation, intent.lease!);
      }
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
    await client.close();
    try {
      const source = `
        import { PGlite } from '@electric-sql/pglite';
        import { drizzle } from 'drizzle-orm/pglite';
        import module from './src/libs/customerPayments/inactiveStripe/durableCheckoutRepository.ts';
        const client = new PGlite(${JSON.stringify(path.join(directory, 'db'))});
        const repo = module.createDurableSdkCheckoutRepository(drizzle(client));
        const resumed = await repo.resumeAuthenticated(${JSON.stringify(f.resume)});
        let blocked = false;
        try { await repo.claimCreate(resumed.operation, ${JSON.stringify(worker())}); }
        catch(error) { blocked = error.message.includes('DURABLE_RECONCILIATION_REQUIRED'); }
        process.stdout.write(JSON.stringify({ identityHash:resumed.operation.identityHash, parameterHash:resumed.operation.parameterHash, blocked, consumed:resumed.result.createConsumedAt !== null }));
        await client.close();`;
      const stdout = execFileSync('/usr/local/bin/node', ['--import', 'tsx', '--conditions=react-server', '--input-type=module', '-e', source], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'development', VERCEL_ENV: '', VERCEL: '' }, timeout: 30000, encoding: 'utf8' });

      expect(JSON.parse(stdout)).toEqual({ identityHash: f.operation.identityHash, parameterHash: f.operation.parameterHash, blocked: phase !== 'reservation', consumed: phase === 'consumption' });
    } finally {
      await reopen();
    }
  }, 40000);
});
