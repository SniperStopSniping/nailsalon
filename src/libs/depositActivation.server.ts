import 'server-only';

import { type ReadinessDecision, refreshAccountReadiness } from '@/libs/stripeConnect/readiness';

/** Shared by manual settings and exact approved setup publication; never draft edits. */
export async function prepareDepositActivation(salonId: string): Promise<
  | { ok: true; readiness: Extract<ReadinessDecision, { chargeReady: true }> }
  | { ok: false; status: number; body: { error: string; message: string; details?: unknown } }
> {
  let readiness: ReadinessDecision;
  try {
    readiness = await refreshAccountReadiness(salonId);
  } catch {
    return { ok: false, status: 503, body: { error: 'DEPOSIT_ENABLE_RETRY', message: 'Could not confirm the payment account right now. Try again.' } };
  }
  if (!readiness.binding || readiness.binding.revokedAt !== null || readiness.status === 'not_connected' || readiness.status === 'revoked') {
    return { ok: false, status: 409, body: { error: 'STRIPE_ACCOUNT_NOT_CONNECTED', message: 'Connect a payment account before switching deposits on.' } };
  }
  if (!readiness.chargeReady) {
    return { ok: false, status: 409, body: { error: 'STRIPE_ACCOUNT_NOT_CHARGE_READY', message: 'The payment account cannot accept charges yet.', details: { disabledReason: readiness.binding.disabledReason, requirements: readiness.binding.requirements } } };
  }
  return { ok: true, readiness };
}
