import 'server-only';

import { asc, eq } from 'drizzle-orm';

import { resolveAppointmentPaymentLedgerForReconciliation } from '@/libs/appointmentPaymentLedger';
import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import { resolveDepositCredit } from '@/libs/depositCredit';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
import type { Appointment } from '@/models/Schema';
import { appointmentAddOnSchema, appointmentFinalItemSchema, appointmentPaymentSchema, appointmentServicesSchema } from '@/models/Schema';

import type { AdjustmentPayment } from '../adjustments';
import { isCustomerPaymentTender } from '../provenance';
import type { CustomerPaymentTransaction } from './preparationRepository';
import { customerPaymentFingerprint } from './preparationRepository';
import { enrichCustomerPaymentProvenance } from './provenanceReader';
import { assertCustomerPaymentReservationMutable } from './reservationGuard';
import { workspaceFailure } from './workspaceContract';

export type WorkspaceInvoiceItem = {
  id: string;
  kind: 'service' | 'addon' | 'custom';
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

function cents(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SUPPORTED_MINOR_UNIT_AMOUNT) {
    return workspaceFailure('PAYMENT_WORKSPACE_INVOICE_MONEY_INVALID');
  }
  return value;
}

function item(value: WorkspaceInvoiceItem) {
  if (!value.id || !value.name.trim() || !Number.isSafeInteger(value.quantity) || value.quantity < 1
    || cents(value.unitPriceCents) * value.quantity !== cents(value.lineTotalCents)) {
    return workspaceFailure('PAYMENT_WORKSPACE_INVOICE_ITEMS_INVALID');
  }
  return value;
}

/** JSON-safe financial evidence only. No client identity, notes or payment URLs. */
function evidence(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(evidence);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, evidence(child)]));
  }
  return value;
}

/**
 * Internal invoice adapter. Caller holds the tenant appointment FOR UPDATE lock.
 * Reads the same frozen tax chain, canonical tender and deposit resolver as
 * checkout. Neither browser totals nor mutable catalog prices become money.
 */
export async function readWorkspaceInvoice(tx: CustomerPaymentTransaction, appointment: Appointment) {
  await assertCustomerPaymentReservationMutable(tx, appointment.salonId, appointment.id);
  if (appointment.deletedAt !== null || !['confirmed', 'in_progress', 'completed'].includes(appointment.status ?? '')
    || appointment.paymentStatus === 'comp' || appointment.depositHoldExpiresAt !== null) {
    return workspaceFailure('PAYMENT_WORKSPACE_APPOINTMENT_INELIGIBLE');
  }
  const scope = { salonId: appointment.salonId, appointmentId: appointment.id };
  const chain = validateAppointmentTaxSnapshotChain(appointment);
  if (!chain.ok || chain.invoiceCurrency !== 'CAD' || !chain.active.snapshot) {
    return workspaceFailure('PAYMENT_WORKSPACE_FROZEN_INVOICE_REQUIRED');
  }
  const taxSnapshot = chain.active.snapshot;
  const isFinal = chain.active.source === 'final';
  let items: WorkspaceInvoiceItem[];
  if (isFinal) {
    const rows = await tx.select().from(appointmentFinalItemSchema).where(eq(appointmentFinalItemSchema.appointmentId, appointment.id)).orderBy(asc(appointmentFinalItemSchema.sortOrder), asc(appointmentFinalItemSchema.id));
    if (rows.some(row => row.salonId !== appointment.salonId || !['service', 'addon', 'custom'].includes(row.kind))) {
      return workspaceFailure('PAYMENT_WORKSPACE_INVOICE_SCOPE_INVALID');
    }
    items = rows.map(row => item({ id: row.id, kind: row.kind as WorkspaceInvoiceItem['kind'], name: row.name, quantity: row.quantity, unitPriceCents: row.unitPriceCents, lineTotalCents: row.lineTotalCents }));
  } else {
    const services = await tx.select().from(appointmentServicesSchema).where(eq(appointmentServicesSchema.appointmentId, appointment.id)).orderBy(asc(appointmentServicesSchema.id));
    const addOns = await tx.select().from(appointmentAddOnSchema).where(eq(appointmentAddOnSchema.appointmentId, appointment.id)).orderBy(asc(appointmentAddOnSchema.id));
    if (!services.length || services.some(row => row.priceDisplayTextSnapshot?.trim()
      || (row.variantKindSnapshot !== null && row.variantKindSnapshot !== 'fixed')
      || (row.priceCentsSnapshot !== null && row.priceCentsSnapshot !== row.priceAtBooking))
      || addOns.some(row => !services.some(service => service.id === row.appointmentServiceId)
        || !['fixed', 'per_unit'].includes(row.pricingTypeSnapshot) || row.priceModeSnapshot !== 'catalog_priced'
        || row.priceDisplayTextSnapshot?.trim() || (row.pricingTypeSnapshot === 'fixed' && row.quantitySnapshot !== 1))) {
      return workspaceFailure('PAYMENT_WORKSPACE_INVOICE_ITEMS_INVALID');
    }
    items = [
      ...services.map(row => item({ id: row.id, kind: 'service', name: row.nameSnapshot ?? 'Service', quantity: 1, unitPriceCents: row.priceAtBooking, lineTotalCents: row.priceAtBooking })),
      ...addOns.map(row => item({ id: row.id, kind: 'addon', name: row.nameSnapshot, quantity: row.quantitySnapshot, unitPriceCents: row.unitPriceCentsSnapshot, lineTotalCents: row.lineTotalCentsSnapshot })),
    ];
  }
  const subtotalCents = cents(items.reduce((sum, row) => sum + row.lineTotalCents, 0));
  const discountCents = cents((isFinal ? appointment.finalDiscountCents : appointment.discountAmountCents) ?? 0);
  const displayedTotal = taxSnapshot.configuration.mode === 'included' ? taxSnapshot.invoiceTotalCents : taxSnapshot.serviceSubtotalCents;
  if (!items.length || discountCents > subtotalCents || subtotalCents - discountCents !== displayedTotal
    || (isFinal && appointment.finalSubtotalCents !== subtotalCents)
    || (!isFinal && appointment.subtotalBeforeDiscountCents !== null && appointment.subtotalBeforeDiscountCents !== subtotalCents)) {
    return workspaceFailure('PAYMENT_WORKSPACE_INVOICE_TOTAL_MISMATCH');
  }
  const bill = { ...scope, revision: 0, serviceCents: cents(taxSnapshot.serviceSubtotalCents), taxCents: cents(taxSnapshot.taxAmountCents), tipCents: cents(appointment.tipCents ?? 0) };
  const deposits = await loadAppointmentDepositCreditRows({ ...scope, database: tx, forUpdate: true, appointmentLockHeld: true });
  const credit = resolveDepositCredit({ deposits, invoiceCurrency: 'CAD' });
  if (!credit.ok) {
    return workspaceFailure(credit.code);
  }
  // Read all rows for this appointment; an anomalous tenant must not disappear
  // from the balance merely because a narrower predicate hides it.
  const rawPayments = await tx.select().from(appointmentPaymentSchema).where(eq(appointmentPaymentSchema.appointmentId, appointment.id)).orderBy(asc(appointmentPaymentSchema.recordedAt), asc(appointmentPaymentSchema.id));
  const payments = await enrichCustomerPaymentProvenance(tx, rawPayments);
  const ledger = resolveAppointmentPaymentLedgerForReconciliation({ cachedAmountPaidCents: appointment.amountPaidCents, paymentRows: payments, expectedSalonId: appointment.salonId, appointmentStatus: appointment.status, paymentStatus: appointment.paymentStatus });
  if (!ledger.ok || ledger.legacyPaidAssumed || ledger.appointmentPaymentsCents === null) {
    return workspaceFailure('PAYMENT_WORKSPACE_LEDGER_RECONCILIATION_REQUIRED');
  }
  const invoice = { currency: 'CAD' as const, items, subtotalCents, discountCents, taxSnapshot, tipCents: bill.tipCents };
  // A live capture/refund updates the ledger but does not change the invoice.
  // Legacy tender/deposit changes do invalidate the initial allocations.
  const legacyPayments = rawPayments.filter(row => !isCustomerPaymentTender(row));
  const billSourceHash = customerPaymentFingerprint(evidence({ invoice, legacyPayments: legacyPayments.map(row => ({ id: row.id, salonId: row.salonId, amountCents: row.amountCents, method: row.method, voidedAt: row.voidedAt })), deposits }));
  let initialPayments: AdjustmentPayment[] | null = null;
  if (!rawPayments.some(isCustomerPaymentTender)) {
    const principal = cents(bill.serviceCents + bill.taxCents);
    if (credit.eligibleCreditCents > principal || cents(credit.eligibleCreditCents + ledger.appointmentPaymentsCents) > cents(principal + bill.tipCents)) {
      return workspaceFailure('PAYMENT_WORKSPACE_EXISTING_OVERPAYMENT_REVIEW_REQUIRED');
    }
    initialPayments = deposits.filter(row => credit.creditedDepositIds.includes(row.id)).map(row => ({ ...scope, id: row.id, movementId: row.stripePaymentIntentId!, kind: 'deposit', principalCents: row.amountCents, tipCents: 0, state: 'confirmed' }));
    let principalRemaining = principal - credit.eligibleCreditCents;
    for (const row of legacyPayments.filter(row => row.voidedAt === null)) {
      const principalCents = Math.min(principalRemaining, row.amountCents);
      principalRemaining -= principalCents;
      initialPayments.push({ ...scope, id: row.id, movementId: row.id, kind: 'manual', principalCents, tipCents: row.amountCents - principalCents, state: 'confirmed' });
    }
  }
  // Internal reconciliation facts. The browser projection must never spread
  // this object: these identify canonical money, not customer-facing labels.
  const tenderFacts = legacyPayments.map(row => ({ id: row.id, amountCents: row.amountCents, method: row.method, voided: row.voidedAt !== null, actorType: row.recordedByType, actorId: row.recordedById }));
  const depositFingerprint = customerPaymentFingerprint(evidence(deposits));
  return { bill, billSourceHash, invoice, initialPayments, collectionHold: ledger.collectionHold, tenderFacts, depositFingerprint, ledgerCents: ledger.appointmentPaymentsCents };
}

export async function prepareWorkspaceInvoice(tx: CustomerPaymentTransaction, appointment: Appointment) {
  const material = await readWorkspaceInvoice(tx, appointment);
  if (!material.initialPayments || material.collectionHold) {
    return workspaceFailure('PAYMENT_WORKSPACE_VERIFIED_IMPORT_REQUIRED');
  }
  return { bill: material.bill, billSourceHash: material.billSourceHash, invoice: material.invoice, payments: material.initialPayments };
}
