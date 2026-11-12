import 'server-only';

import { randomUUID } from 'node:crypto';

import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import { requireInactiveStripeCheckoutRuntime } from './checkoutContract';
import type { ClosedCheckoutSdkTransport } from './closedCheckoutSdkTransport';
import { assertClosedCheckoutSdkTransport, createClosedCheckoutSdkExecution } from './closedCheckoutSdkTransport';
import type { createDurableSdkCheckoutRepository } from './durableCheckoutRepository';

type Repository = ReturnType<typeof createDurableSdkCheckoutRepository>;
/** Unregistered CLOSED HTTP SDK diagnostic. No provider provenance or settlement. */
export function createDurableCheckoutSdkBridge(repository: Repository, transport: ClosedCheckoutSdkTransport, options: { workerId?: string; leaseMs?: number } = {}) {
  requireInactiveStripeCheckoutRuntime();
  assertClosedCheckoutSdkTransport(transport);
  const worker = Object.freeze({ workerId: options.workerId ?? randomUUID(), leaseMs: options.leaseMs ?? 60000 });
  async function reconcileOperation(operation: InactiveStripeCheckoutOperation) {
    const claimed = await repository.claimReconcile(operation, worker);
    if (!claimed.lease) {
      return claimed.result;
    }
    const execution = createClosedCheckoutSdkExecution(transport, operation, 'retrieve', claimed.result.session?.sessionId ?? null);
    await execution.preflight();
    const observed = await execution.execute(claimed.lease, () => repository.consumeSdkPermit(operation, claimed.lease!));
    return observed.lease && observed.outcome
      ? repository.recordSdkOutcome(operation, observed.lease, observed.outcome)
      : observed.result;
  }
  return Object.freeze({
    async create(input: Parameters<Repository['reserveAuthenticated']>[0]) {
      requireInactiveStripeCheckoutRuntime();
      const { operation } = await repository.reserveAuthenticated(input);
      const claimed = await repository.claimCreate(operation, worker);
      if (!claimed.lease) {
        return claimed.result;
      }
      const execution = createClosedCheckoutSdkExecution(transport, operation, 'create', null);
      await execution.preflight();
      const intent = await repository.recordDispatchIntent(operation, claimed.lease);
      if (!intent.lease) {
        return intent.result;
      }
      const observed = await execution.execute(intent.lease, () => repository.consumeSdkPermit(operation, intent.lease!));
      return observed.lease && observed.outcome
        ? repository.recordSdkOutcome(operation, observed.lease, observed.outcome)
        : observed.result;
    },
    // Customer entry continues to require the current bearer capability.
    async reconcile(input: Parameters<Repository['resumeAuthenticated']>[0]) {
      requireInactiveStripeCheckoutRuntime();
      const { operation } = await repository.resumeAuthenticated(input);
      return reconcileOperation(operation);
    },
    // Internal recovery only, never an application route: the repository requires
    // an already consumed SDK operation and its exact previously bound Session.
    // This cannot reserve/create, clear review, release funds or restore bearer access.
    async reconcileReserved(input: Parameters<Repository['restoreForReconciliation']>[0]) {
      requireInactiveStripeCheckoutRuntime();
      const { operation } = await repository.restoreForReconciliation(input);
      return reconcileOperation(operation);
    },
  });
}
