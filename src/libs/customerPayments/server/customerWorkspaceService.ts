import 'server-only';

import { and, eq } from 'drizzle-orm';

import { customerPaymentWorkspacePolicyAuditSchema, customerPaymentWorkspacePolicySchema } from '@/models/customerPaymentWorkspaceSchema';

import { netWorkspaceDepositCredit, resolveAdjustmentBalance } from '../adjustments';
import { customerWorkspaceViewSchema } from '../customerWorkspaceView';
import type { PaymentWorkspaceActor } from './workspaceContract';
import { PaymentWorkspaceError, workspaceFailure } from './workspaceContract';
import { readWorkspaceInvoice } from './workspaceInvoice';
import { readWorkspaceBinding } from './workspacePolicyRepository';
import type { createPaymentWorkspaceRepository } from './workspaceRepository';
import { workspaceRuntime } from './workspaceRuntime';

/** The private booking capability sees only its own balance and policy. */
export async function readCustomerWorkspaceView(repository: ReturnType<typeof createPaymentWorkspaceRepository>, actor: PaymentWorkspaceActor) {
  if (actor.role !== 'customer') {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  const result = await repository.inspect(actor, async (tx, appointment, state) => {
    let [policy] = await tx.select().from(customerPaymentWorkspacePolicySchema).where(eq(customerPaymentWorkspacePolicySchema.salonId, actor.salonId)).limit(1);
    if (!state && !policy?.enabled) {
      return null;
    }
    let material: Awaited<ReturnType<typeof readWorkspaceInvoice>> | null = null;
    let binding: Awaited<ReturnType<typeof readWorkspaceBinding>> = null;
    try {
      material = await readWorkspaceInvoice(tx, appointment);
      binding = await readWorkspaceBinding(tx, actor.salonId, workspaceRuntime());
      // readWorkspaceBinding acquires salon before policy, matching owner saves.
      [policy] = await tx.select().from(customerPaymentWorkspacePolicySchema).where(eq(customerPaymentWorkspacePolicySchema.salonId, actor.salonId)).limit(1);
    } catch (error) {
      if (!state || !(error instanceof PaymentWorkspaceError)) {
        throw error;
      }
    }
    const bill = state?.bill ?? material?.bill;
    const payments = state?.payments ?? material?.initialPayments;
    const invoiceHash = state?.billSourceHash ?? material?.billSourceHash;
    if (!bill || !payments || !invoiceHash) {
      return workspaceFailure('PAYMENT_WORKSPACE_VERIFIED_IMPORT_REQUIRED');
    }
    const balance = resolveAdjustmentBalance({ revision: state?.revision ?? 0, bill, payments, refunds: state?.refunds ?? [], requests: state?.requests ?? [] });
    const active = state?.operations.find(item => !['succeeded', 'failed', 'canceled'].includes(item.state));
    const needsReview = !material || !!material.collectionHold || invoiceHash !== material.billSourceHash || (!!balance.blockedReasons.length && !active) || active?.kind === 'refund';
    let shownPolicy = { revision: policy?.revision ?? 0, cancellationPolicy: policy?.cancellationPolicy ?? '' };
    if (active?.kind === 'payment' && active.binding.policyRevision) {
      const [original] = await tx.select().from(customerPaymentWorkspacePolicyAuditSchema).where(and(eq(customerPaymentWorkspacePolicyAuditSchema.salonId, actor.salonId), eq(customerPaymentWorkspacePolicyAuditSchema.revision, active.binding.policyRevision))).limit(1);
      shownPolicy = { revision: original?.revision ?? 0, cancellationPolicy: typeof original?.snapshot.cancellation_policy === 'string' ? original.snapshot.cancellation_policy : '' };
    }
    return customerWorkspaceViewSchema.parse({
      initialized: state !== null,
      revision: state?.revision ?? 0,
      invoiceHash,
      canPay: !!binding && !needsReview && balance.canReservePayment,
      needsReview: needsReview || active?.state === 'review',
      policy: shownPolicy,
      totalCents: balance.totalCents,
      paidCents: balance.netPaidCents,
      balanceCents: balance.balanceDueCents,
      overpaidCents: balance.overpaidCents,
      depositCreditCents: netWorkspaceDepositCredit(payments, state?.refunds ?? []),
      activePayment: active?.kind === 'payment' ? { id: active.id, state: active.state, canResume: active.requestedBy === actor.id && active.customerAcceptance?.accessTokenId === actor.accessToken?.id && active.binding.policyRevision === binding?.policyRevision && !needsReview } : null,
    });
  });
  return result.context;
}
