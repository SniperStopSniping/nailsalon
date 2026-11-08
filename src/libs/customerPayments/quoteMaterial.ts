import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import type { Appointment, AppointmentAddOn, AppointmentDeposit, AppointmentPayment, AppointmentService, SalonStripeAccount } from '@/models/Schema';

import { calculatePaymentSnapshot } from './money';
import type { CustomerPaymentDraftResponse } from './settings';
import { customerPaymentDraftResponse } from './settings';

export type CustomerPaymentQuoteMaterialInput = {
  appointment: Appointment;
  salon: { id: string; status: string | null; publicationStatus: string; deletedAt: Date | null };
  capability: { tokenId: string; salonId: string; appointmentId: string; expiresAt: Date; revokedAt: Date | null };
  binding: SalonStripeAccount;
  policy: CustomerPaymentDraftResponse;
  services: AppointmentService[];
  addOns: AppointmentAddOn[];
  payments: AppointmentPayment[];
  deposits: AppointmentDeposit[];
  tipCents: number;
  existingExpiresAt?: Date;
  now: Date;
};

function timestamp(value: Date): number {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime())) {
    throw new TypeError('CUSTOMER_PAYMENT_QUOTE_INVALID_TIMESTAMP');
  }
  return value.getTime();
}

function cents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SUPPORTED_MINOR_UNIT_AMOUNT) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_INVALID_MONEY');
  }
  return value;
}

/** Detached, JSON-only whitelist context; rejects undefined/non-finite material. */
function jsonValue(value: unknown): unknown {
  if (value instanceof Date) {
    return new Date(timestamp(value)).toISOString();
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(jsonValue);
  }
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, jsonValue(child)]));
  }
  throw new Error('CUSTOMER_PAYMENT_QUOTE_INVALID_CONTEXT');
}

function pick<T extends object>(source: T, keys: readonly (keyof T)[]): Record<string, unknown> {
  return Object.fromEntries(keys.map(key => [key, jsonValue(source[key])]));
}

function sorted<T extends { id: string }>(rows: T[]): T[] {
  if (rows.some(row => !row.id.trim()) || new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_DUPLICATE_SOURCE');
  }
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Pure material builder, not a runtime/access gate or payment instruction.
 * Caller must gate BEFORE reads and lock/revalidate every tenant-scoped source.
 * Cached Connect flags are pinned for staleness, NEVER provider authorization.
 */
export function buildCustomerPaymentQuoteMaterial(input: CustomerPaymentQuoteMaterialInput) {
  const { appointment: a, salon, capability, binding } = input;
  const now = timestamp(input.now);
  const start = timestamp(a.startTime);
  const end = timestamp(a.endTime);
  const capabilityExpiry = timestamp(capability.expiresAt);
  if (!a.id.trim() || !a.salonId.trim() || salon.id !== a.salonId
    || capability.appointmentId !== a.id || capability.salonId !== a.salonId
    || !capability.tokenId.trim() || capability.revokedAt !== null || capabilityExpiry <= now) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_ACCESS_INVALID');
  }
  if (salon.status !== 'active' || salon.publicationStatus !== 'published' || salon.deletedAt !== null) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_SALON_UNAVAILABLE');
  }
  if (a.status !== 'confirmed' || a.deletedAt !== null || a.completedAt !== null || a.finalTaxSnapshot !== null
    || a.finalPriceCents !== null || a.startedAt !== null || a.lockedAt !== null
    || a.depositHoldExpiresAt !== null || start <= now || end <= start) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_APPOINTMENT_INELIGIBLE');
  }
  if (a.tipCents !== 0 || (a.amountPaidCents !== null && a.amountPaidCents !== 0)
    || a.paymentStatus !== 'pending' || input.payments.length !== 0 || input.deposits.length !== 0) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_EXISTING_MONEY_UNSUPPORTED');
  }
  if (input.policy.testOnly !== true || input.policy.collectionEnabled !== false) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_POLICY_UNSUPPORTED');
  }
  const policy = customerPaymentDraftResponse(input.policy.revision, input.policy.settings);
  if (!policy.settings.enabled || policy.revision <= 0) {
    throw new Error('CUSTOMER_PAYMENT_DRAFT_DISABLED');
  }
  if (!binding.id.trim() || binding.salonId !== a.salonId || binding.livemode !== false
    || binding.revokedAt !== null || binding.revocationCause !== null || !/^acct_[a-z0-9]+$/i.test(binding.stripeAccountId)
    || binding.chargesEnabled !== true || binding.disabledReason !== null) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_BINDING_UNAVAILABLE');
  }
  const services = sorted(input.services);
  const addOns = sorted(input.addOns);
  if (!services.length) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_ITEMS_REQUIRED');
  }
  let serviceTotal = 0;
  for (const row of services) {
    if (row.appointmentId !== a.id || !row.serviceId.trim()
      || row.priceDisplayTextSnapshot?.trim()
      || (row.variantKindSnapshot !== null && row.variantKindSnapshot !== 'fixed')
      || (row.priceCentsSnapshot !== null && row.priceCentsSnapshot !== row.priceAtBooking)) {
      throw new Error('CUSTOMER_PAYMENT_QUOTE_SERVICE_UNSUPPORTED');
    }
    serviceTotal = cents(serviceTotal + cents(row.priceAtBooking));
  }
  let addOnTotal = 0;
  for (const row of addOns) {
    if (row.appointmentId !== a.id || !row.appointmentServiceId
      || !services.some(service => service.id === row.appointmentServiceId)
      || !['fixed', 'per_unit'].includes(row.pricingTypeSnapshot) || row.priceModeSnapshot !== 'catalog_priced'
      || row.priceDisplayTextSnapshot?.trim() || !Number.isSafeInteger(row.quantitySnapshot) || row.quantitySnapshot < 1
      || (row.pricingTypeSnapshot === 'fixed' && row.quantitySnapshot !== 1)) {
      throw new Error('CUSTOMER_PAYMENT_QUOTE_ADDON_UNSUPPORTED');
    }
    if (cents(row.lineTotalCentsSnapshot) !== cents(cents(row.unitPriceCentsSnapshot) * row.quantitySnapshot)) {
      throw new Error('CUSTOMER_PAYMENT_QUOTE_ITEM_TOTAL_MISMATCH');
    }
    addOnTotal = cents(addOnTotal + row.lineTotalCentsSnapshot);
  }
  const itemTotal = cents(serviceTotal + addOnTotal);
  const discount = cents(a.discountAmountCents ?? 0);
  if (discount > itemTotal || cents(a.totalPrice) !== itemTotal - discount
    || (a.subtotalBeforeDiscountCents !== null && a.subtotalBeforeDiscountCents !== itemTotal)
    || (a.basePriceCents !== null && a.basePriceCents !== serviceTotal)
    || (a.addOnsPriceCents !== null && a.addOnsPriceCents !== addOnTotal)) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_ITEM_TOTAL_MISMATCH');
  }
  const tax = validateAppointmentTaxSnapshotChain(a);
  if (!tax.ok || a.invoiceCurrency !== 'CAD' || tax.invoiceCurrency !== 'CAD' || tax.active.snapshot === null
    || tax.active.snapshot.kind !== 'booking_estimate') {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_FROZEN_TAX_REQUIRED');
  }
  cents(input.tipCents);
  // The active tax snapshot is ALREADY post-discount and net of inclusive tax.
  const snapshot = calculatePaymentSnapshot({ currency: 'cad', collection: 'full', servicesCents: tax.active.snapshot.serviceSubtotalCents, discountCents: 0, taxCents: tax.active.snapshot.taxAmountCents, tipCents: input.tipCents, feePolicy: { payer: policy.settings.feePayer, feeCents: policy.settings.platformFeeCents, taxTreatment: 'not_collected_in_test_mode', refundPolicy: 'proportional' } });
  cents(snapshot.chargeCents);
  if (snapshot.chargeCents === 0 || snapshot.serviceTotalCents === 0) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_NOTHING_DUE');
  }
  const ceiling = Math.min(now + 5 * 60 * 1000, capabilityExpiry, start);
  const expiry = input.existingExpiresAt === undefined ? ceiling : timestamp(input.existingExpiresAt);
  if (expiry <= now || expiry > ceiling) {
    throw new Error('CUSTOMER_PAYMENT_QUOTE_STALE');
  }
  const context: Record<string, unknown> = {
    version: 1,
    appointment: pick(a, ['id', 'salonId', 'status', 'deletedAt', 'startTime', 'endTime', 'startedAt', 'completedAt', 'lockedAt', 'depositHoldExpiresAt', 'totalPrice', 'basePriceCents', 'addOnsPriceCents', 'subtotalBeforeDiscountCents', 'discountAmountCents', 'discountType', 'discountLabel', 'discountPercent', 'discountAppliedAt', 'finalPriceCents', 'finalSubtotalCents', 'finalDiscountCents', 'finalDiscountReason', 'tipCents', 'paymentStatus', 'amountPaidCents', 'invoiceCurrency', 'taxableSubtotalCents', 'taxAmountCents', 'taxExempt', 'taxExemptReason', 'bookingTaxSnapshot', 'rescheduleTaxSnapshot', 'finalTaxSnapshot', 'updatedAt']),
    salon: pick(salon, ['id', 'status', 'publicationStatus', 'deletedAt']),
    capability: pick(capability, ['tokenId', 'expiresAt']),
    binding: pick(binding, ['id', 'salonId', 'stripeAccountId', 'livemode', 'chargesEnabled', 'payoutsEnabled', 'detailsSubmitted', 'requirementsDue', 'disabledReason', 'connectedAt', 'revokedAt', 'revocationCause', 'lastSyncedAt', 'createdAt', 'updatedAt']),
    policy: jsonValue({ revision: policy.revision, settings: policy.settings }),
    services: services.map(row => pick(row, ['id', 'appointmentId', 'serviceId', 'priceAtBooking', 'durationAtBooking', 'variantKindSnapshot', 'variantLabelSnapshot', 'priceCentsSnapshot', 'durationMinutesSnapshot', 'priceDisplayTextSnapshot', 'resolvedIntroPriceLabelSnapshot'])),
    addOns: addOns.map(row => pick(row, ['id', 'appointmentId', 'appointmentServiceId', 'addOnId', 'quantitySnapshot', 'pricingTypeSnapshot', 'priceModeSnapshot', 'unitPriceCentsSnapshot', 'durationMinutesSnapshot', 'lineTotalCentsSnapshot', 'lineDurationMinutesSnapshot', 'priceDisplayTextSnapshot', 'createdAt'])),
    // Strict absence, not an inferred zero credit. Any future history rejects.
    payments: [],
    deposits: [],
    choice: 'online',
    tipCents: input.tipCents,
  };
  return { snapshot, stripeAccountId: binding.stripeAccountId, expiresAt: new Date(expiry), context };
}
