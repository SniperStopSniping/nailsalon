import 'server-only';

import { db } from '@/libs/DB';

import { createWorkspaceStripeProvider } from '../liveProvider/workspaceStripe';
import type { PaymentWorkspaceScope } from './workspaceContract';
import { reconcileWorkspacePayment } from './workspaceDispatcher';
import { createPaymentWorkspaceRepository } from './workspaceRepository';

/** Provider reads only. Neither absence nor timeout releases uncertain money. */
export async function recoverWorkspacePayment(scope: PaymentWorkspaceScope, operationId: string) {
  const repository = createPaymentWorkspaceRepository(db);
  const claim = await repository.claimReconciliation(scope, operationId);
  if (['succeeded', 'failed', 'canceled'].includes(claim.operation.state)) {
    return { complete: true };
  }
  if (claim.operation.dispatchUntil !== null && claim.operation.dispatchUntil > Date.now()) {
    return { complete: false };
  }
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!claim.operation.providerObjectId) {
    const observation = await createWorkspaceStripeProvider(key).discover(claim);
    if (!observation) {
      return { complete: false };
    }
    await repository.recordProviderObservation(observation);
    // Independent settlement runs on the next bounded invocation. Discovery
    // plus the complete verification chain must not exhaust the worker budget.
    return { complete: false };
  }
  const result = await reconcileWorkspacePayment(repository, scope, operationId, key);
  return { complete: result.state.operations.some(op => op.id === operationId && ['succeeded', 'failed', 'canceled'].includes(op.state)) };
}
