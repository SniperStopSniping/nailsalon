import 'server-only';

import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import { CompletionCatalogReferenceError, resolveFinalItems } from '@/libs/appointmentFinalItems.server';
import { CheckoutMoneyRangeError, computeCheckoutTotals, type ResolvedTaxConfig } from '@/libs/checkoutTotals';
import { buildFinalTaxSnapshot } from '@/libs/taxConfig';
import { appointmentAuditLogSchema, appointmentFinalItemSchema, appointmentSchema } from '@/models/Schema';

import { adjustmentPermissions, netWorkspaceDepositCredit, resolveAdjustmentBalance } from '../adjustments';
import { completedBillChangeSchema, type CompletedBillView } from '../completedBillContract';
import { customerPaymentFingerprint } from './preparationRepository';
import type { PaymentWorkspaceActor, PaymentWorkspaceState } from './workspaceContract';
import { PaymentWorkspaceError, workspaceFailure } from './workspaceContract';
import { prepareWorkspaceInvoice, readWorkspaceInvoice } from './workspaceInvoice';
import { readWorkspaceBinding } from './workspacePolicyRepository';
import type { createPaymentWorkspaceRepository } from './workspaceRepository';
import { workspaceRuntime } from './workspaceRuntime';

type Repository = ReturnType<typeof createPaymentWorkspaceRepository>;
type Appointment = typeof appointmentSchema.$inferSelect;

function frozenTaxConfig(appointment: Appointment): ResolvedTaxConfig {
  if (appointment.status !== 'completed' || !appointment.completedAt || !appointment.finalTaxSnapshot) {
    return workspaceFailure('PAYMENT_WORKSPACE_COMPLETED_INVOICE_REQUIRED');
  }
  const config = appointment.finalTaxSnapshot.configuration;
  return {
    enabled: config.enabled,
    name: config.label,
    rateBps: config.rateBps,
    pricesIncludeTax: config.mode === 'included',
    taxServicesByDefault: config.taxServicesByDefault,
    taxAddOnsByDefault: config.taxAddOnsByDefault,
    taxCustomByDefault: config.taxCustomByDefault,
    forfeitureTaxEstimationEnabled: config.forfeitureTaxEstimationEnabled,
    configurationSource: config.configurationSource,
    configurationEffectiveFrom: config.configurationEffectiveFrom,
    configurationEffectiveDate: config.configurationEffectiveDate,
    configurationTimeZone: config.configurationTimeZone,
    jurisdiction: config.jurisdiction,
    country: config.country,
    region: config.region,
  };
}

function balanceOf(state: PaymentWorkspaceState) {
  return resolveAdjustmentBalance({ revision: state.revision, bill: state.bill, payments: state.payments, refunds: state.refunds, requests: state.requests });
}

function refundablePrincipal(state: Pick<PaymentWorkspaceState, 'payments' | 'refunds'>) {
  const online = state.payments.filter(payment => payment.kind === 'online' && payment.state === 'confirmed');
  return online.reduce((sum, payment) => sum + payment.principalCents, 0)
    - state.refunds.filter(refund => refund.state === 'succeeded' && online.some(payment => payment.id === refund.paymentId)).reduce((sum, refund) => sum + refund.principalCents, 0);
}

export async function readCompletedBill(repository: Repository, actor: PaymentWorkspaceActor): Promise<CompletedBillView> {
  if (!adjustmentPermissions({ ...actor, hasAppointmentAccess: true }).canAdjustBill) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACTION_FORBIDDEN');
  }
  const result = await repository.inspect(actor, async (tx, appointment, state) => {
    const material = await readWorkspaceInvoice(tx, appointment);
    const taxConfig = frozenTaxConfig(appointment);
    if (!state && !await readWorkspaceBinding(tx, appointment.salonId, workspaceRuntime())) {
      return workspaceFailure('PAYMENT_WORKSPACE_ACTIVATION_REQUIRED');
    }
    const payments = state?.payments ?? material.initialPayments ?? workspaceFailure('PAYMENT_WORKSPACE_VERIFIED_IMPORT_REQUIRED');
    const balance = resolveAdjustmentBalance({ revision: state?.revision ?? 0, bill: material.bill, payments, refunds: state?.refunds ?? [], requests: state?.requests ?? [] });
    const items = await tx.select().from(appointmentFinalItemSchema).where(eq(appointmentFinalItemSchema.appointmentId, appointment.id)).orderBy(asc(appointmentFinalItemSchema.sortOrder), asc(appointmentFinalItemSchema.id));
    return {
      revision: state?.revision ?? 0,
      invoiceHash: material.billSourceHash,
      items: items.map(item => ({ kind: item.kind as 'service' | 'addon' | 'custom', catalogServiceId: item.catalogServiceId, catalogAddOnId: item.catalogAddOnId, name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents, durationMinutes: item.durationMinutes, taxable: item.taxable })),
      discountCents: material.invoice.discountCents,
      discountReason: appointment.finalDiscountReason ?? '',
      tipCents: material.bill.tipCents,
      taxExempt: appointment.taxExempt ?? false,
      taxConfig,
      paidCents: balance.netPaidCents,
      depositCreditCents: netWorkspaceDepositCredit(payments, state?.refunds ?? []),
      refundableOnlinePrincipalCents: refundablePrincipal({ payments, refunds: state?.refunds ?? [] }),
      canEdit: !material.collectionHold && (!state || state.billSourceHash === material.billSourceHash) && balance.blockedReasons.length === 0
        && !state?.operations.some(op => ['awaiting_approval', 'prepared', 'dispatching', 'open', 'pending', 'uncertain', 'review'].includes(op.state)),
    };
  });
  return result.context;
}

export async function reviseCompletedBill(repository: Repository, actor: PaymentWorkspaceActor, value: unknown) {
  if (!adjustmentPermissions({ ...actor, hasAppointmentAccess: true }).canAdjustBill) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACTION_FORBIDDEN');
  }
  const input = completedBillChangeSchema.parse(value);
  if (!await repository.read(actor)) {
    try {
      await repository.initialize(actor, input.initializationId, async (tx, appointment) => {
        frozenTaxConfig(appointment);
        const prepared = await prepareWorkspaceInvoice(tx, appointment);
        if (input.expectedRevision !== 0 || prepared.billSourceHash !== input.expectedInvoiceHash
          || !await readWorkspaceBinding(tx, appointment.salonId, workspaceRuntime())) {
          return workspaceFailure('PAYMENT_WORKSPACE_BILL_CHANGED');
        }
        return prepared;
      });
    } catch (error) {
      if (!(error instanceof PaymentWorkspaceError) || error.code !== 'PAYMENT_WORKSPACE_ALREADY_EXISTS') {
        throw error;
      }
    }
  }
  return repository.reviseBill(actor, {
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    reason: input.reason,
    changeFingerprint: customerPaymentFingerprint(input),
  }, async (tx, appointment, state) => {
    const before = await readWorkspaceInvoice(tx, appointment);
    const taxConfig = frozenTaxConfig(appointment);
    if (before.collectionHold || before.billSourceHash !== state.billSourceHash || before.billSourceHash !== input.expectedInvoiceHash || balanceOf(state).blockedReasons.length) {
      return workspaceFailure('PAYMENT_WORKSPACE_BILL_CHANGED');
    }
    let items: NonNullable<Awaited<ReturnType<typeof resolveFinalItems>>>;
    let totals: ReturnType<typeof computeCheckoutTotals>;
    try {
      items = (await resolveFinalItems(tx, appointment, { finalItems: input.finalItems, skipPhotoValidation: false }, taxConfig))!;
      totals = computeCheckoutTotals({ items, discountCents: input.discountCents, taxConfig, taxExempt: appointment.taxExempt ?? false, tipCents: before.bill.tipCents });
    } catch (error) {
      if (error instanceof CompletionCatalogReferenceError || error instanceof CheckoutMoneyRangeError) {
        return workspaceFailure('PAYMENT_WORKSPACE_INVALID_REQUEST');
      }
      throw error;
    }
    const principal = totals.finalPriceCents + totals.taxAmountCents;
    const paid = balanceOf(state);
    const depositCredit = netWorkspaceDepositCredit(state.payments, state.refunds);
    if (input.discountCents > totals.finalSubtotalCents || input.expectedTotalDueCents !== totals.totalDueCents
      || depositCredit > principal || Math.max(0, paid.netPaidCents - totals.totalDueCents) > refundablePrincipal(state)) {
      return workspaceFailure('PAYMENT_WORKSPACE_REVISION_REVIEW_REQUIRED');
    }
    const originalItems = await tx.select().from(appointmentFinalItemSchema).where(eq(appointmentFinalItemSchema.appointmentId, appointment.id));
    const snapshot = buildFinalTaxSnapshot({ taxConfig, totals, currency: 'CAD', capturedAt: appointment.completedAt!, taxExempt: appointment.taxExempt ?? false, taxExemptReason: appointment.taxExemptReason });
    await tx.update(appointmentSchema).set({
      finalSubtotalCents: totals.finalSubtotalCents,
      finalDiscountCents: totals.finalDiscountCents,
      finalDiscountReason: input.discountReason || null,
      finalPriceCents: totals.finalPriceCents,
      taxableSubtotalCents: totals.taxableSubtotalCents,
      taxAmountCents: totals.taxAmountCents,
      finalTaxSnapshot: snapshot,
      paymentStatus: paid.netPaidCents >= totals.totalDueCents ? 'paid' : paid.netPaidCents > 0 ? 'partially_paid' : 'pending',
    }).where(eq(appointmentSchema.id, appointment.id));
    await tx.delete(appointmentFinalItemSchema).where(eq(appointmentFinalItemSchema.appointmentId, appointment.id));
    await tx.insert(appointmentFinalItemSchema).values(items.map((item, index) => ({ ...item, id: `fitem_${randomUUID()}`, appointmentId: appointment.id, salonId: appointment.salonId, sortOrder: index })));
    const [updated] = await tx.select().from(appointmentSchema).where(eq(appointmentSchema.id, appointment.id));
    const after = await readWorkspaceInvoice(tx, updated!);
    if (after.collectionHold || before.depositFingerprint !== after.depositFingerprint || customerPaymentFingerprint(before.tenderFacts) !== customerPaymentFingerprint(after.tenderFacts) || before.ledgerCents !== after.ledgerCents) {
      return workspaceFailure('PAYMENT_WORKSPACE_LEDGER_RECONCILIATION_REQUIRED');
    }
    await tx.insert(appointmentAuditLogSchema).values(buildAppointmentAuditRow({
      appointmentId: appointment.id,
      salonId: appointment.salonId,
      action: 'items_changed',
      performedBy: actor.id,
      performedByRole: actor.role === 'staff' ? 'staff' : 'admin',
      reason: input.reason,
      previousValue: { items: originalItems, invoice: before.invoice, discountReason: appointment.finalDiscountReason, paymentStatus: appointment.paymentStatus },
      newValue: { items, invoice: after.invoice, discountReason: input.discountReason, paymentStatus: updated!.paymentStatus, requestId: input.requestId },
    }));
    return { bill: after.bill, billSourceHash: after.billSourceHash, legacyTenderHash: after.legacyTenderHash, invoice: after.invoice };
  });
}
