import 'server-only';

import type { AdjustmentRefund } from '../adjustments';
import { customerPaymentFingerprint } from './preparationRepository';
import type { PaymentWorkspaceState } from './workspaceContract';
import { workspaceFailure } from './workspaceContract';
import type { readWorkspaceInvoice } from './workspaceInvoice';

/** Caller holds the appointment and deposit locks; no provider write occurs. */
export function reconcileWorkspaceDepositFacts(state: PaymentWorkspaceState, material: Pick<Awaited<ReturnType<typeof readWorkspaceInvoice>>, 'legacyTenderHash' | 'billSourceHash' | 'invoice' | 'collectionHold' | 'depositCredit' | 'depositRows'>, observedAt: number) {
  if (!state.invoice || !state.legacyTenderHash || state.legacyTenderHash !== material.legacyTenderHash
    || customerPaymentFingerprint(state.invoice) !== customerPaymentFingerprint(material.invoice)
    || material.collectionHold) {
    return workspaceFailure('PAYMENT_WORKSPACE_LEDGER_RECONCILIATION_REQUIRED');
  }
  const scope = { salonId: state.bill.salonId, appointmentId: state.bill.appointmentId };
  const credit = material.depositCredit;
  const collectedIds = new Set([...credit.creditedDepositIds, ...credit.refundedDepositIds, ...credit.forfeitedDepositIds]);
  const canonical = material.depositRows.filter(row => collectedIds.has(row.id));
  for (const old of state.payments.filter(payment => payment.kind === 'deposit')) {
    const current = canonical.find(row => row.id === old.id);
    if (!current || current.amountCents !== old.principalCents || current.stripePaymentIntentId !== old.movementId || old.tipCents !== 0 || old.state !== 'confirmed') {
      return workspaceFailure('PAYMENT_WORKSPACE_DEPOSIT_IDENTITY_CHANGED');
    }
  }
  for (const deposit of canonical) {
    if (state.payments.some(payment => payment.id === deposit.id && payment.kind !== 'deposit')) {
      return workspaceFailure('PAYMENT_WORKSPACE_DEPOSIT_IDENTITY_CHANGED');
    }
    if (!state.payments.some(payment => payment.id === deposit.id)) {
      state.payments.push({ ...scope, id: deposit.id, movementId: deposit.stripePaymentIntentId!, kind: 'deposit', state: 'confirmed', principalCents: deposit.amountCents, tipCents: 0 });
    }
    const kind = credit.refundedDepositIds.includes(deposit.id) ? 'deposit_refund' : credit.forfeitedDepositIds.includes(deposit.id) ? 'deposit_forfeit' : null;
    const oldRefunds = state.refunds.filter(refund => refund.paymentId === deposit.id);
    if (oldRefunds.length > 1 || oldRefunds.some(refund => !['deposit_refund', 'deposit_forfeit'].includes(refund.kind ?? '')
      || refund.state !== 'succeeded' || refund.principalCents !== deposit.amountCents || refund.tipCents !== 0)
      || (oldRefunds.length > 0 && !kind) || (oldRefunds[0]?.kind === 'deposit_refund' && kind !== 'deposit_refund')) {
      return workspaceFailure('PAYMENT_WORKSPACE_DEPOSIT_IDENTITY_CHANGED');
    }
    if (kind) {
      const adjustment: AdjustmentRefund = { ...scope, id: `deposit_credit_${deposit.id}`, paymentId: deposit.id, principalCents: deposit.amountCents, tipCents: 0, state: 'succeeded', kind };
      if (oldRefunds[0]) {
        // A later full refund of forfeited money still removes this credit only
        // once. The prior forfeiture remains in immutable workspace history.
        state.refunds[state.refunds.indexOf(oldRefunds[0])] = adjustment;
      } else {
        state.refunds.push(adjustment);
      }
    }
    const evidenceHash = customerPaymentFingerprint({ ...deposit, refundedAt: deposit.refundedAt?.toISOString() ?? null, refundStatusChangedAt: deposit.refundStatusChangedAt?.toISOString() ?? null, refundRequestedAt: deposit.refundRequestedAt?.toISOString() ?? null, forfeitedAt: deposit.forfeitedAt?.toISOString() ?? null, createdAt: deposit.createdAt.toISOString() });
    if (!state.depositCreditHistory.some(item => item.depositId === deposit.id && item.evidenceHash === evidenceHash)) {
      state.depositCreditHistory.push({ depositId: deposit.id, disposition: kind === 'deposit_refund' ? 'refunded' : kind === 'deposit_forfeit' ? 'forfeited' : 'credited', amountCents: deposit.amountCents, evidenceHash, observedAt });
    }
  }
  state.billSourceHash = material.billSourceHash;
  return state;
}
