import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';
import type { ProviderJournal } from '../server/providerJournal';
import type { OfflineOperationTransport, OperationState } from './operations';
import { isOfflineOperationTransport } from './operations';

type Journal = Pick<ProviderJournal, 'getOperation' | 'claimOperation' | 'advanceOperation' | 'databaseNow'>;
type Worker = { workerId: string; leaseMs: number };
export type FixtureOperationOutcome =
  | { outcome: 'recorded' | 'unchanged' | 'reconciliation_required'; operation: OperationState }
  | { outcome: 'uncertain'; operationId: string; reason: 'TRANSPORT_INTERRUPTED' | 'RESULT_NOT_RECORDED' };

function gate(transport: OfflineOperationTransport) {
  requireCustomerPaymentProviderFixtureEnabled();
  if (!isOfflineOperationTransport(transport)) {
    throw new Error('CUSTOMER_PAYMENT_PROVIDER_OFFLINE_TRANSPORT_REQUIRED');
  }
}

function terminal(state: OperationState) {
  return ['succeeded', 'failed', 'review'].includes(state.state);
}

async function load(journal: Journal, operationId: string) {
  const state = await journal.getOperation(operationId);
  if (!state) {
    throw new Error('CUSTOMER_PAYMENT_PROVIDER_OPERATION_NOT_FOUND');
  }
  return state;
}

/**
 * No route or automatic worker invokes this seam. Both the journal and transport
 * are offline fixtures. Saving dispatching happens before the closed response-map
 * transport, outside every DB transaction. Interrupted saves never cause a resend.
 */
export async function dispatchProviderFixture(
  journal: Journal,
  transport: OfflineOperationTransport,
  operationId: string,
  worker: Worker,
): Promise<FixtureOperationOutcome> {
  gate(transport);
  const original = await load(journal, operationId);
  if (terminal(original)) {
    return { outcome: 'unchanged', operation: original };
  }
  if (original.state === 'dispatching' || original.state === 'uncertain') {
    return { outcome: 'reconciliation_required', operation: original };
  }
  const claimed = await journal.claimOperation(operationId, { ...worker, purpose: 'dispatch' });
  if (terminal(claimed)) {
    return { outcome: 'unchanged', operation: claimed };
  }
  const dispatching = await journal.advanceOperation(operationId, {
    expectedVersion: claimed.version,
    leaseToken: claimed.leaseToken!,
    command: { type: 'begin_dispatch' },
  });
  const now = await journal.databaseNow();
  gate(transport);
  if (dispatching.leaseUntil === null || now >= dispatching.leaseUntil) {
    return { outcome: 'reconciliation_required', operation: dispatching };
  }
  let observation;
  try {
    observation = await transport.execute(dispatching, now);
  } catch {
    // Unknown transport failures may have happened after dispatch. Preserve the
    // persisted dispatching state; recovery must expire its lease and reconcile.
    return { outcome: 'uncertain', operationId, reason: 'TRANSPORT_INTERRUPTED' };
  }
  try {
    const saved = await journal.advanceOperation(operationId, {
      expectedVersion: dispatching.version,
      leaseToken: dispatching.leaseToken!,
      command: { type: 'observe_dispatch', observation },
    });
    return { outcome: 'recorded', operation: saved };
  } catch {
    // The DB may have committed even when its response was lost. A future read,
    // never another send, determines whether reconciliation is still needed.
    return { outcome: 'uncertain', operationId, reason: 'RESULT_NOT_RECORDED' };
  }
}

/** A separate explicit recovery step. It never dispatches the operation again. */
export async function reconcileProviderFixture(
  journal: Journal,
  transport: OfflineOperationTransport,
  operationId: string,
  worker: Worker,
): Promise<FixtureOperationOutcome> {
  gate(transport);
  let state = await load(journal, operationId);
  if (terminal(state) || state.state === 'queued' || state.state === 'claimed') {
    return { outcome: 'unchanged', operation: state };
  }
  const now = await journal.databaseNow();
  if (state.leaseUntil !== null) {
    if (now < state.leaseUntil) {
      return { outcome: 'reconciliation_required', operation: state };
    }
    state = await journal.advanceOperation(operationId, {
      expectedVersion: state.version,
      leaseToken: state.leaseToken!,
      command: { type: 'expire' },
    });
  }
  const claimed = await journal.claimOperation(operationId, { ...worker, purpose: 'reconcile' });
  const observedAt = await journal.databaseNow();
  gate(transport);
  if (claimed.leaseUntil === null || observedAt >= claimed.leaseUntil) {
    return { outcome: 'reconciliation_required', operation: claimed };
  }
  let observation;
  try {
    observation = await transport.reconcile(claimed, observedAt);
  } catch {
    return { outcome: 'uncertain', operationId, reason: 'TRANSPORT_INTERRUPTED' };
  }
  try {
    const saved = await journal.advanceOperation(operationId, {
      expectedVersion: claimed.version,
      leaseToken: claimed.leaseToken!,
      command: { type: 'reconcile', observation },
    });
    return { outcome: 'recorded', operation: saved };
  } catch {
    return { outcome: 'uncertain', operationId, reason: 'RESULT_NOT_RECORDED' };
  }
}
