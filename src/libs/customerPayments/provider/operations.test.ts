import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoundDispatchObservation, BoundReconciliationObservation, OperationIdentity, OperationIdentityInput, OperationState } from './operations';
import { applyOperationCommand, beginOperationDispatch, claimOperation, createOfflineOperationTransport, createOperation, createOperationIdentity, expireOperationLease, isOfflineOperationTransport, observeOperationDispatch, OPERATION_RETENTION_MS, reconcileOperation, validateOperationIdentity, validateOperationState } from './operations';

const now = 1_700_000_000_000;
function identity(kind: OperationIdentityInput['kind'] = 'checkout_create'): OperationIdentity {
  const base = { id: randomUUID(), salonId: 'salon', appointmentId: 'appointment', quoteId: 'quote', requestId: randomUUID(), contextHash: 'a'.repeat(64), platformId: 'acct_platform', mode: 'test' as const, apiVersion: '2024-06-20' as const, provenance: 'offline_fixture' as const };
  if (kind === 'application_fee_refund') {
    return createOperationIdentity({ ...base, kind, accountScope: 'platform', accountId: null, targetId: 'fee_original', parameters: { amount: 25 } });
  }
  if (kind === 'customer_refund') {
    return createOperationIdentity({ ...base, kind, accountScope: 'connected', accountId: 'acct_connected', targetId: 'pi_original', parameters: { payment_intent: 'pi_original', amount: 3000 } });
  }
  return createOperationIdentity({ ...base, kind, accountScope: 'connected', accountId: 'acct_connected', targetId: null, parameters: { mode: 'payment', payment_method_types: ['card'], client_reference_id: 'quote', success_url: 'http://127.0.0.1/return', cancel_url: 'http://127.0.0.1/cancel', line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: 12000, product_data: { name: 'Appointment payment and optional tip' } } }], payment_intent_data: { application_fee_amount: 100 } } });
}
function claim(state: OperationState, at = now, purpose: 'dispatch' | 'reconcile' = 'dispatch') {
  return claimOperation(state, { expectedVersion: state.version, leaseToken: randomUUID(), leaseDurationMs: 10000, now: at, purpose });
}
function fence(state: OperationState, at = state.updatedAt) {
  return { expectedVersion: state.version, leaseToken: state.leaseToken!, now: at };
}
function dispatch(id = identity()) {
  const claimed = claim(createOperation(id, now));
  return beginOperationDispatch(claimed, fence(claimed));
}
function transport(id: OperationIdentity, absent = true) {
  return createOfflineOperationTransport([{ identity: id, dispatch: { type: 'uncertain' }, reconciliation: absent ? { type: 'authoritatively_absent' } : { type: 'unresolved' } }]);
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
});

afterEach(() => vi.unstubAllEnvs());

describe('immutable offline operation identity', () => {
  it('hashes exact canonical parameters, freezes nested data and retains a stable key', () => {
    const original = identity();

    expect(validateOperationIdentity(JSON.parse(JSON.stringify(original)))).toEqual(original);
    expect(Object.isFrozen(original.parameters)).toBe(true);
    expect(() => validateOperationIdentity({ ...original, parameterHash: 'b'.repeat(64) })).toThrow();
    expect(() => validateOperationIdentity({ ...original, contextHash: 'b'.repeat(64) })).toThrow();
    expect(() => validateOperationIdentity({ ...original, idempotencyKey: 'changed' })).toThrow();
  });

  it('binds checkout client reference to the immutable quote, not appointment', () => {
    const { parameterHash: _hash, idempotencyKey: _key, ...input } = identity();
    if (input.kind !== 'checkout_create') {
      throw new Error('fixture kind');
    }

    expect(() => createOperationIdentity({ ...input, parameters: { ...input.parameters, client_reference_id: input.appointmentId } })).toThrow('QUOTE_REFERENCE_MISMATCH');
    expect(createOperationIdentity(input).parameters).toMatchObject({ client_reference_id: input.quoteId });
  });

  it('separates fee/platform and customer/account identities even for equal amounts', () => {
    const customer = identity('customer_refund');
    const fee = identity('application_fee_refund');

    expect(customer.accountScope).toBe('connected');
    expect(fee.accountId).toBeNull();
    expect(customer.idempotencyKey).not.toBe(fee.idempotencyKey);

    const { parameterHash: _hash, idempotencyKey: _key, ...input } = customer;

    expect(() => createOperationIdentity({ ...input, targetId: 'pi_wrong' } as OperationIdentityInput)).toThrow('TARGET_MISMATCH');
    expect(() => createOperationIdentity({ ...input, accountId: 'acct_platform' } as OperationIdentityInput)).toThrow('SCOPE_MISMATCH');
    expect(() => createOperationIdentity({ ...input, parameters: { ...input.parameters, metadata: { paid: true } } } as unknown as OperationIdentityInput)).toThrow();
  });

  it('rejects live mode, unsupported versions, arbitrary fields and unsafe bounds', () => {
    const { parameterHash: _hash, idempotencyKey: _key, ...input } = identity('customer_refund');
    for (const patch of [{ mode: 'live' }, { apiVersion: 'future' }, { arbitrary: true }, { parameters: { payment_intent: 'pi_original', amount: -1 } }, { parameters: { payment_intent: 'pi_original', amount: 50000001 } }]) {
      expect(() => createOperationIdentity({ ...input, ...patch } as OperationIdentityInput)).toThrow();
    }
  });
});

describe('fenced dispatch and uncertainty', () => {
  it('never reclaims a dispatched operation for sending; crash becomes uncertain', () => {
    const state = dispatch();

    expect(() => claim(state, now + 10001)).toThrow('RECONCILIATION_REQUIRED');

    const uncertain = expireOperationLease(state, { expectedVersion: state.version, now: now + 10000 });

    expect(uncertain.state).toBe('uncertain');
    expect(() => claim(uncertain, now + 10001)).toThrow('RECONCILIATION_REQUIRED');
    expect(() => beginOperationDispatch(state, { ...fence(state), now: now + 10000 })).toThrow('LEASE_LOST');
  });

  it('reclaims only pre-dispatch leases and fences old tokens/versions', () => {
    const old = claim(createOperation(identity(), now));
    const newer = claim(old, now + 10000);

    expect(() => beginOperationDispatch(newer, { ...fence(old), now: now + 10000 })).toThrow('STALE_VERSION');
    expect(() => beginOperationDispatch(newer, { ...fence(newer), leaseToken: old.leaseToken! })).toThrow('LEASE_LOST');
    expect(validateOperationState(newer)).toBe(newer);
    expect(() => validateOperationState({ ...newer, state: 'succeeded' })).toThrow('INVALID_STATE');
  });

  it('rejects fabricated evidence, copied brands and cross-operation observations', async () => {
    const state = dispatch();

    expect(() => observeOperationDispatch(state, { ...fence(state), observation: { type: 'uncertain' } as BoundDispatchObservation })).toThrow('UNTRUSTED_OBSERVATION');

    const fake = transport(state.identity);

    expect(isOfflineOperationTransport(fake)).toBe(true);
    expect(isOfflineOperationTransport({ ...fake })).toBe(false);

    const observed = await fake.execute(state, now);

    expect(() => observeOperationDispatch(state, { ...fence(state), observation: { ...observed } })).toThrow('UNTRUSTED_OBSERVATION');

    const other = dispatch();

    expect(() => observeOperationDispatch(other, { ...fence(other), observation: observed })).toThrow('UNTRUSTED_OBSERVATION');
    expect(observeOperationDispatch(state, { ...fence(state), observation: observed }).state).toBe('uncertain');
  });

  it('requeues only after fresh authoritative reconciliation within original retention', async () => {
    const state = dispatch();
    const fake = transport(state.identity);
    const uncertain = observeOperationDispatch(state, { ...fence(state), observation: await fake.execute(state, now) });
    const leased = claim(uncertain, now + 1, 'reconcile');

    expect(() => reconcileOperation(leased, { ...fence(leased), observation: { type: 'authoritatively_absent' } as BoundReconciliationObservation })).toThrow('UNTRUSTED_OBSERVATION');

    const oldObservation = await fake.reconcile(leased, now + 1);
    const differentFence = { ...leased, version: leased.version + 1, leaseToken: randomUUID() };

    expect(() => reconcileOperation(differentFence, { ...fence(differentFence), observation: oldObservation })).toThrow('UNTRUSTED_OBSERVATION');

    const next = reconcileOperation(leased, { ...fence(leased), observation: await fake.reconcile(leased, now + 1) });

    expect(next.state).toBe('queued');

    const nextClaim = claim(next, now + 2);
    const again = beginOperationDispatch(nextClaim, fence(nextClaim));

    expect(again.identity.idempotencyKey).toBe(state.identity.idempotencyKey);
    expect(again.idempotencyExpiresAt).toBe(state.idempotencyExpiresAt);
  });

  it('retention expiry or unresolved reconciliation is review, not a fresh key', async () => {
    const state = dispatch();
    const expired = expireOperationLease(state, { expectedVersion: state.version, now: now + OPERATION_RETENTION_MS });
    for (const absent of [true, false]) {
      const fake = transport(state.identity, absent);
      const leased = claim(expired, now + OPERATION_RETENTION_MS, 'reconcile');
      const result = reconcileOperation(leased, { ...fence(leased), observation: await fake.reconcile(leased, leased.updatedAt) });

      expect(result.state).toBe('review');
      expect(result.identity.idempotencyKey).toBe(state.identity.idempotencyKey);
      expect(() => claim(result, result.updatedAt + 1)).toThrow();
    }
  });

  it('succeeds with an operation object only, never payment-settled facts', async () => {
    for (const [kind, objectId] of [['checkout_create', 'cs_fixture'], ['customer_refund', 're_fixture'], ['application_fee_refund', 'fr_fixture']] as const) {
      const state = dispatch(identity(kind));
      const fake = createOfflineOperationTransport([{ identity: state.identity, dispatch: { type: 'accepted', objectId }, reconciliation: { type: 'exists', objectId } }]);
      const done = applyOperationCommand(state, fence(state), { type: 'observe_dispatch', observation: await fake.execute(state, now) });

      expect(done.state).toBe('succeeded');
      expect(done.result).toEqual({ provenance: 'offline_fixture', objectId });
      expect(() => claim(done, now + 1)).toThrow();
    }
  });

  it('accepts test Session results and rejects live, malformed, or secret-shaped results', async () => {
    for (const objectId of ['cs_test_fixture', 'cs_fixture']) {
      const state = dispatch(identity('checkout_create'));
      const fake = createOfflineOperationTransport([{ identity: state.identity, dispatch: { type: 'accepted', objectId }, reconciliation: { type: 'exists', objectId } }]);
      const done = applyOperationCommand(state, fence(state), { type: 'observe_dispatch', observation: await fake.execute(state, now) });

      expect(done.result).toEqual({ provenance: 'offline_fixture', objectId });
    }
    for (const objectId of ['cs_live_fixture', 'cs_test_', 'cs_test_bad_id', 'cs_test_fixture_secret_value', 'cs_live_', 'cs__fixture']) {
      const state = dispatch(identity('checkout_create'));
      const fake = createOfflineOperationTransport([{ identity: state.identity, dispatch: { type: 'accepted', objectId }, reconciliation: { type: 'exists', objectId } }]);

      await expect(fake.execute(state, now).then(observation => applyOperationCommand(state, fence(state), { type: 'observe_dispatch', observation }))).rejects.toThrow();
    }
  });

  it('accepts authoritative existence after retention but never sends again', async () => {
    const state = dispatch(identity('customer_refund'));
    const uncertain = expireOperationLease(state, { expectedVersion: state.version, now: now + OPERATION_RETENTION_MS });
    const leased = claim(uncertain, uncertain.updatedAt, 'reconcile');
    const fake = createOfflineOperationTransport([{ identity: state.identity, dispatch: { type: 'uncertain' }, reconciliation: { type: 'exists', objectId: 're_found' } }]);
    const result = reconcileOperation(leased, { ...fence(leased), observation: await fake.reconcile(leased, leased.updatedAt) });

    expect(result.state).toBe('succeeded');
    expect(result.result).toEqual({ provenance: 'offline_fixture', objectId: 're_found' });
    expect(() => claim(result, result.updatedAt + 1)).toThrow();
  });

  it('treats definitive no-execution rejection as terminal, not timeout failure', async () => {
    const state = dispatch();
    const fake = createOfflineOperationTransport([{ identity: state.identity, dispatch: { type: 'rejected_without_execution', code: 'invalid_request' }, reconciliation: { type: 'unresolved' } }]);
    const result = observeOperationDispatch(state, { ...fence(state), observation: await fake.execute(state, now) });

    expect(result.state).toBe('failed');
    expect(result.result).toEqual({ provenance: 'offline_fixture', rejectionCode: 'invalid_request' });
    expect(() => claim(result, now + 1)).toThrow();
  });

  it('refuses oversized/zero leases, fabricated command fields and wrong result kind', async () => {
    const queued = createOperation(identity(), now);
    for (const leaseDurationMs of [0, 999, 300001]) {
      expect(() => claimOperation(queued, { expectedVersion: 0, leaseToken: randomUUID(), leaseDurationMs, now, purpose: 'dispatch' })).toThrow();
    }
    const state = dispatch();
    const fake = createOfflineOperationTransport([{ identity: state.identity, dispatch: { type: 'accepted', objectId: 're_wrong' }, reconciliation: { type: 'unresolved' } }]);
    const observed = await fake.execute(state, now);

    expect(() => observeOperationDispatch(state, { ...fence(state), observation: observed })).toThrow('RESULT_KIND_MISMATCH');
    expect(() => applyOperationCommand(state, fence(state), { type: 'expire', override: true } as never)).toThrow('INVALID_COMMAND');
    expect(() => createOfflineOperationTransport([{ identity: state.identity, dispatch: { type: 'accepted', objectId: 'cs_fixture', paid: true } as never, reconciliation: { type: 'unresolved' } }])).toThrow();
  });

  it('factory and previously created transports fail closed outside the fixture gate', async () => {
    const state = dispatch();
    const fake = transport(state.identity);
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => createOfflineOperationTransport([])).toThrow();
    await expect(fake.execute(state, now)).rejects.toThrow('FIXTURE_DISABLED');
  });
});
