import 'server-only';

import { createWorkspaceStripeProvider } from '../liveProvider/workspaceStripe';
import type { PaymentWorkspaceActor, PaymentWorkspaceScope } from './workspaceContract';
import type { createPaymentWorkspaceRepository } from './workspaceRepository';

/**
 * Awaited request/job orchestration: no fire-and-forget work on a serverless
 * response. The database reservation outlives a process crash or lost response.
 */
export async function dispatchWorkspacePayment(
  repository: ReturnType<typeof createPaymentWorkspaceRepository>,
  scope: PaymentWorkspaceScope,
  operationId: string,
  secretKey: string,
) {
  const claim = await repository.claimDispatch(scope, operationId);
  try {
    const observation = await createWorkspaceStripeProvider(secretKey).dispatch(claim);
    const result = await repository.recordProviderObservation(observation);
    const operation = result.state.operations.find(item => item.id === operationId)!;
    return { ...result, checkoutUrl: operation.state === 'open' ? observation.checkoutUrl : null };
  } catch (error) {
    try {
      await repository.recordUncertain(scope, operationId, claim.dispatchToken);
    } catch {
      // A later worker may already own the operation, or the DB is unavailable.
      // Neither outcome releases the originally committed reservation.
    }
    throw error;
  }
}

export async function reconcileWorkspacePayment(
  repository: ReturnType<typeof createPaymentWorkspaceRepository>,
  scope: PaymentWorkspaceScope,
  operationId: string,
  secretKey: string,
) {
  const claim = await repository.claimReconciliation(scope, operationId);
  const outcome = await createWorkspaceStripeProvider(secretKey).reconcile(claim);
  const result = await repository.applyVerifiedOutcome(outcome);
  return { ...result, checkoutUrl: outcome.status === 'open' ? outcome.checkoutUrl : null };
}

export async function cancelWorkspacePayment(
  repository: ReturnType<typeof createPaymentWorkspaceRepository>,
  actor: PaymentWorkspaceActor,
  expectedRevision: number,
  operationId: string,
  secretKey: string,
) {
  const claim = await repository.claimCancellation(actor, expectedRevision, operationId);
  try {
    await createWorkspaceStripeProvider(secretKey).expire(claim);
  } catch {
    // A payment can win the race with expiration. Retrieve the original
    // session either way; never interpret an error as a released reservation.
  }
  return reconcileWorkspacePayment(repository, claim.scope, operationId, secretKey);
}
