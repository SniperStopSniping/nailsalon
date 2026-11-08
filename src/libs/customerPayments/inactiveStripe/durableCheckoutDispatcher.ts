import 'server-only';

import { randomUUID } from 'node:crypto';

import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import { requireInactiveStripeCheckoutRuntime } from './checkoutContract';
import type { ClosedCheckoutFixtureTransport } from './closedCheckoutTransport';
import { assertClosedCheckoutFixtureTransport } from './closedCheckoutTransport';
import type { DurableCheckoutLease, DurableCheckoutRepository } from './durableCheckoutRepository';

/** Closed fixture orchestration only. An actual SDK bridge is deliberately unimplemented. */
export function createDurableCheckoutDispatcher(repository: DurableCheckoutRepository, transport: ClosedCheckoutFixtureTransport, options: { workerId?: string; leaseMs?: number } = {}) {
  requireInactiveStripeCheckoutRuntime();
  assertClosedCheckoutFixtureTransport(transport);
  const worker = { workerId: options.workerId ?? randomUUID(), leaseMs: options.leaseMs ?? 60000 };
  async function consume(operation: InactiveStripeCheckoutOperation, claim: DurableCheckoutLease) {
    const consumed = await repository.consume(operation, claim, transport);
    if (!consumed.outcome || !consumed.lease) {
      return consumed.result;
    }
    const outcome = await consumed.outcome;
    requireInactiveStripeCheckoutRuntime();
    return repository.recordOutcome(operation, consumed.lease, outcome);
  }
  return Object.freeze({
    async create(operation: InactiveStripeCheckoutOperation) {
      requireInactiveStripeCheckoutRuntime();
      await repository.reserve(operation);
      const claimed = await repository.claimCreate(operation, worker);
      if (!claimed.lease) {
        return claimed.result;
      }
      const intent = await repository.recordDispatchIntent(operation, claimed.lease);
      return intent.lease ? consume(operation, intent.lease) : intent.result;
    },
    async reconcile(operation: InactiveStripeCheckoutOperation) {
      requireInactiveStripeCheckoutRuntime();
      const claimed = await repository.claimReconcile(operation, worker);
      return claimed.lease ? consume(operation, claimed.lease) : claimed.result;
    },
  });
}
