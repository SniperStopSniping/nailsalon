import 'server-only';

import { adjustmentPermissions, resolveAdjustmentBalance } from '../adjustments';
import type { PaymentWorkspaceView } from '../workspaceView';
import type { PaymentWorkspaceActor } from './workspaceContract';
import { PaymentWorkspaceError, workspaceFailure } from './workspaceContract';
import { readWorkspaceInvoice } from './workspaceInvoice';
import { readWorkspaceBinding } from './workspacePolicyRepository';
import type { createPaymentWorkspaceRepository, WorkspaceBindingReader } from './workspaceRepository';
import { workspaceRuntime } from './workspaceRuntime';

export const readCurrentWorkspaceBinding: WorkspaceBindingReader = async (tx, appointment) => {
  const invoice = await readWorkspaceInvoice(tx, appointment);
  const binding = await readWorkspaceBinding(tx, appointment.salonId, workspaceRuntime());
  return { binding, billSourceHash: invoice.billSourceHash };
};

export async function readPaymentWorkspaceView(repository: ReturnType<typeof createPaymentWorkspaceRepository>, actor: PaymentWorkspaceActor): Promise<PaymentWorkspaceView> {
  const result = await repository.inspect(actor, async (tx, appointment, state) => {
    try {
      return { material: await readWorkspaceInvoice(tx, appointment), binding: await readWorkspaceBinding(tx, appointment.salonId, workspaceRuntime()) };
    } catch (error) {
      // A canceled appointment or changed invoice must not erase its retained
      // payment history. Display the saved revision as held; never collect from it.
      if (state?.invoice && error instanceof PaymentWorkspaceError) {
        return { material: null, binding: null };
      }
      throw error;
    }
  });
  const material = result.context.material;
  const state = result.state;
  const invoice = state?.invoice ?? material?.invoice;
  const payments = state?.payments ?? material?.initialPayments;
  const bill = state?.bill ?? material?.bill;
  if (!payments || !invoice || !bill) {
    return workspaceFailure('PAYMENT_WORKSPACE_VERIFIED_IMPORT_REQUIRED');
  }
  const sourceChanged = !!state && material?.billSourceHash !== state.billSourceHash;
  const permissions = adjustmentPermissions({ ...actor, hasAppointmentAccess: true });
  const projected = resolveAdjustmentBalance({ revision: state?.revision ?? 0, bill, payments, refunds: state?.refunds ?? [], requests: state?.requests ?? [] });
  const reviewRequired = sourceChanged || material?.collectionHold || state?.operations.some(item => item.state === 'review');
  const balance = reviewRequired
    ? { ...projected, canReservePayment: false, canReserveRefund: false, blockedReasons: [...new Set([...projected.blockedReasons, 'PAYMENT_UNDER_REVIEW'])] }
    : projected;
  return {
    initialized: state !== null,
    sourceChanged,
    onlinePaymentsAvailable: result.context.binding !== null && !sourceChanged,
    balance,
    permissions,
    invoice: { items: invoice.items.map(({ id, name, quantity, lineTotalCents }) => ({ id, name, quantity, lineTotalCents })), subtotalCents: invoice.subtotalCents, discountCents: invoice.discountCents, taxCents: invoice.taxSnapshot.taxAmountCents, tipCents: invoice.tipCents },
    payments: payments.map(payment => ({ id: payment.id, kind: payment.kind, amountCents: payment.principalCents + payment.tipCents, state: payment.state, voided: state?.refunds.some(refund => refund.paymentId === payment.id && refund.kind === 'manual_void' && refund.state === 'succeeded') ?? false })),
    operations: (state?.operations ?? []).map(({ id, kind, state: status, principalCents, tipCents, reason, createdAt }) => ({ id, kind, state: status, principalCents, tipCents, reason, createdAt })),
  };
}
