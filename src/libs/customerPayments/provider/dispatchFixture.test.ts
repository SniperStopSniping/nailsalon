import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchProviderFixture, reconcileProviderFixture } from './dispatchFixture';
import type { OfflineOperationTransport, OperationCommand } from './operations';
import { applyOperationCommand, claimOperation, createOfflineOperationTransport, createOperation, createOperationIdentity, OPERATION_RETENTION_MS } from './operations';

const initialTime = 1_700_000_000_000;
const worker = { workerId: 'fixture_worker', leaseMs: 1000 };
function fixture() {
  const identity = createOperationIdentity({ id: randomUUID(), salonId: 'salon', appointmentId: 'appointment', quoteId: randomUUID(), requestId: randomUUID(), contextHash: 'a'.repeat(64), platformId: 'acct_platform', mode: 'test', apiVersion: '2024-06-20', provenance: 'offline_fixture', kind: 'customer_refund', accountScope: 'connected', accountId: 'acct_connected', targetId: 'pi_original', parameters: { payment_intent: 'pi_original', amount: 3000 } });
  let state = createOperation(identity, initialTime);
  let now = initialTime;
  let failSave: 'before' | 'after' | null = null;
  const log: string[] = [];
  const journal = {
    getOperation: vi.fn(async (_id: string) => state),
    databaseNow: vi.fn(async () => now),
    claimOperation: vi.fn(async (_id: string, input: typeof worker & { purpose: 'dispatch' | 'reconcile' }) => {
      log.push(`claim:${input.purpose}`);
      state = claimOperation(state, { expectedVersion: state.version, leaseToken: randomUUID(), leaseDurationMs: input.leaseMs, purpose: input.purpose, now });
      return state;
    }),
    advanceOperation: vi.fn(async (_id: string, input: { expectedVersion: number; leaseToken: string; command: OperationCommand }) => {
      log.push(input.command.type);
      const failure = failSave;
      if (input.command.type === 'observe_dispatch') {
        failSave = null;
        if (failure === 'before') {
          throw new Error('lost before commit');
        }
      }
      state = applyOperationCommand(state, { ...input, now }, input.command);
      if (input.command.type === 'observe_dispatch' && failure === 'after') {
        throw new Error('lost after commit');
      }
      return state;
    }),
  };
  return { identity, journal, log, state: () => state, tick: (ms: number) => {
    now += ms;
  }, loseSave: (when: 'before' | 'after') => {
    failSave = when;
  } };
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

describe('inert operation orchestration', () => {
  it('refuses disabled gates and forged transports before any journal access', async () => {
    const f = fixture();
    const transport = createOfflineOperationTransport([]);
    vi.stubEnv('NODE_ENV', 'production');

    await expect(dispatchProviderFixture(f.journal, transport, f.identity.id, worker)).rejects.toThrow('FIXTURE_DISABLED');
    await expect(reconcileProviderFixture(f.journal, transport, f.identity.id, worker)).rejects.toThrow('FIXTURE_DISABLED');

    vi.stubEnv('NODE_ENV', 'test');
    const forged = { ...transport, execute: vi.fn() } as OfflineOperationTransport;

    await expect(dispatchProviderFixture(f.journal, forged, f.identity.id, worker)).rejects.toThrow('OFFLINE_TRANSPORT_REQUIRED');
    expect(f.journal.getOperation).not.toHaveBeenCalled();
    expect(forged.execute).not.toHaveBeenCalled();
  });

  it('persists dispatch intent before observing a fake result and makes repeats inert', async () => {
    const f = fixture();
    const transport = createOfflineOperationTransport([{ identity: f.identity, dispatch: { type: 'accepted', objectId: 're_fixture' }, reconciliation: { type: 'exists', objectId: 're_fixture' } }]);
    const result = await dispatchProviderFixture(f.journal, transport, f.identity.id, worker);

    expect(result.outcome).toBe('recorded');
    expect(f.state().state).toBe('succeeded');
    expect(f.state().result).toEqual({ provenance: 'offline_fixture', objectId: 're_fixture' });
    expect(f.log).toEqual(['claim:dispatch', 'begin_dispatch', 'observe_dispatch']);
    expect((await dispatchProviderFixture(f.journal, transport, f.identity.id, worker)).outcome).toBe('unchanged');
    expect(f.log).toHaveLength(3);
  });

  it('does not resend when the result write failed before commit, then reconciles the original identity', async () => {
    const f = fixture();
    const transport = createOfflineOperationTransport([{ identity: f.identity, dispatch: { type: 'accepted', objectId: 're_fixture' }, reconciliation: { type: 'exists', objectId: 're_fixture' } }]);
    f.loseSave('before');

    expect(await dispatchProviderFixture(f.journal, transport, f.identity.id, worker)).toEqual({ outcome: 'uncertain', operationId: f.identity.id, reason: 'RESULT_NOT_RECORDED' });
    expect(f.state().state).toBe('dispatching');
    expect((await dispatchProviderFixture(f.journal, transport, f.identity.id, worker)).outcome).toBe('reconciliation_required');
    expect((await reconcileProviderFixture(f.journal, transport, f.identity.id, worker)).outcome).toBe('reconciliation_required');

    f.tick(1000);
    const reconciled = await reconcileProviderFixture(f.journal, transport, f.identity.id, worker);

    expect(reconciled.outcome).toBe('recorded');
    expect(f.state().state).toBe('succeeded');
    expect(f.state().identity).toEqual(f.identity);
    expect(f.log.filter(item => item === 'begin_dispatch')).toHaveLength(1);
    expect(f.log.slice(-3)).toEqual(['expire', 'claim:reconcile', 'reconcile']);
  });

  it('reads an already committed result after a lost response instead of reconciling or resending', async () => {
    const f = fixture();
    const transport = createOfflineOperationTransport([{ identity: f.identity, dispatch: { type: 'accepted', objectId: 're_fixture' }, reconciliation: { type: 'exists', objectId: 're_fixture' } }]);
    f.loseSave('after');

    expect((await dispatchProviderFixture(f.journal, transport, f.identity.id, worker)).outcome).toBe('uncertain');
    expect((await reconcileProviderFixture(f.journal, transport, f.identity.id, worker)).outcome).toBe('unchanged');
    expect((await dispatchProviderFixture(f.journal, transport, f.identity.id, worker)).outcome).toBe('unchanged');
    expect(f.log).toHaveLength(3);
  });

  it('requires an explicit reconciliation step before a retry and never resets the key or retention window', async () => {
    const f = fixture();
    const transport = createOfflineOperationTransport([{ identity: f.identity, dispatch: { type: 'uncertain' }, reconciliation: { type: 'authoritatively_absent' } }]);
    await dispatchProviderFixture(f.journal, transport, f.identity.id, worker);
    const firstExpiry = f.state().idempotencyExpiresAt;

    expect((await dispatchProviderFixture(f.journal, transport, f.identity.id, worker)).outcome).toBe('reconciliation_required');

    await reconcileProviderFixture(f.journal, transport, f.identity.id, worker);

    expect(f.state().state).toBe('queued');
    expect(f.log.filter(item => item === 'begin_dispatch')).toHaveLength(1);

    f.tick(100);
    await dispatchProviderFixture(f.journal, transport, f.identity.id, worker);

    expect(f.state().identity.idempotencyKey).toBe(f.identity.idempotencyKey);
    expect(f.state().idempotencyExpiresAt).toBe(firstExpiry);
  });

  it('keeps an expired absent outcome under review instead of generating another operation', async () => {
    const f = fixture();
    const transport = createOfflineOperationTransport([{ identity: f.identity, dispatch: { type: 'uncertain' }, reconciliation: { type: 'authoritatively_absent' } }]);
    await dispatchProviderFixture(f.journal, transport, f.identity.id, worker);
    f.tick(OPERATION_RETENTION_MS);
    await reconcileProviderFixture(f.journal, transport, f.identity.id, worker);

    expect(f.state().state).toBe('review');
    expect((await dispatchProviderFixture(f.journal, transport, f.identity.id, worker)).outcome).toBe('unchanged');
    expect(f.log.filter(item => item === 'begin_dispatch')).toHaveLength(1);
  });

  it('keeps an unexpected closed-transport failure uncertain without inventing a result', async () => {
    const f = fixture();
    const missingFixture = createOfflineOperationTransport([]);

    expect(await dispatchProviderFixture(f.journal, missingFixture, f.identity.id, worker)).toEqual({ outcome: 'uncertain', operationId: f.identity.id, reason: 'TRANSPORT_INTERRUPTED' });
    expect(f.state().state).toBe('dispatching');
    expect(f.state().result).toBeNull();
    expect((await dispatchProviderFixture(f.journal, missingFixture, f.identity.id, worker)).outcome).toBe('reconciliation_required');
  });

  it('does not invoke the fake transport when the lease expires before dispatch resumes', async () => {
    const f = fixture();
    const transport = createOfflineOperationTransport([]);
    f.journal.databaseNow.mockImplementation(async () => initialTime + 1000);

    expect((await dispatchProviderFixture(f.journal, transport, f.identity.id, worker)).outcome).toBe('reconciliation_required');
    expect(f.state().state).toBe('dispatching');
    expect(f.log).toEqual(['claim:dispatch', 'begin_dispatch']);
  });
});
