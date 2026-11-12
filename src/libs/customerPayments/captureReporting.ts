import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import type { CustomerPaymentCapture } from '@/models/customerPaymentSchema';
import type { AppointmentPayment } from '@/models/Schema';

import { isCustomerPaymentTender } from './provenance';

export const CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED = 'CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED';

function fail(): never {
  throw new Error(CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED);
}
function cents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SUPPORTED_MINOR_UNIT_AMOUNT) {
    fail();
  }
  return value;
}
function timestamp(value: Date): number {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime())) {
    fail();
  }
  return value.getTime();
}

/** Immutable gross cash events, distinct from current booking credit or service revenue. */
export function projectCustomerPaymentCaptureReport(input: {
  salonId: string;
  currency: 'CAD' | 'USD';
  start: Date;
  end: Date;
  captures: readonly CustomerPaymentCapture[];
  markers: readonly AppointmentPayment[];
}) {
  const start = timestamp(input.start);
  const end = timestamp(input.end);
  if (!input.salonId.trim() || end <= start || !['CAD', 'USD'].includes(input.currency)) {
    fail();
  }
  const ids = new Set<string>();
  const intents = new Set<string>();
  const markerIds = new Set(input.markers.map(row => row.id));
  if (markerIds.size !== input.markers.length || input.markers.length !== input.captures.length
    || input.markers.some(row => !isCustomerPaymentTender(row))) {
    fail();
  }
  let collectedCents = 0;
  let heldForReviewCents = 0;
  let unknownCurrencyEventCount = 0;
  let excludedForeignCurrencyEventCount = 0;
  for (const capture of input.captures) {
    const marker = input.markers.find(row => row.id === capture.tenderId);
    const eventTime = timestamp(capture.capturedAt);
    const identity = `${capture.stripeAccountId}:${capture.mode}:${capture.paymentIntentId}`;
    if (ids.has(capture.id) || intents.has(identity) || capture.salonId !== input.salonId
      || capture.mode !== 'test' || capture.source !== 'synthetic_test'
      || capture.tenderId !== `cpay_${capture.id}` || eventTime < start || eventTime >= end
      || !marker || marker.salonId !== capture.salonId || marker.appointmentId !== capture.appointmentId
      || marker.reference !== `customer_payment_capture:${capture.id}`
      || marker.method !== 'online' || marker.recordedByType !== 'system'
      || marker.amountCents !== capture.amountCents || timestamp(marker.recordedAt) !== eventTime
      || !['posted', 'held_review'].includes(capture.state)
      || (capture.state === 'posted' ? marker.voidedAt !== null : marker.voidedAt === null)) {
      fail();
    }
    ids.add(capture.id);
    intents.add(identity);
    const gross = cents(capture.amountCents);
    if (gross === 0 || cents(capture.applicationFeeCents) > gross) {
      fail();
    }
    const currency = capture.currency.toUpperCase();
    if (capture.state === 'posted' && (currency !== 'CAD'
      || cents(capture.principalCents) + cents(capture.tipCents) !== gross
      || capture.applicationFeeCents !== cents(capture.quotedApplicationFeeCents)
      || capture.reviewReason !== null)) {
      fail();
    }
    if (currency !== 'CAD' && currency !== 'USD') {
      unknownCurrencyEventCount++;
      continue;
    }
    if (currency !== input.currency) {
      excludedForeignCurrencyEventCount++;
      continue;
    }
    collectedCents += gross;
    if (!Number.isSafeInteger(collectedCents)) {
      fail();
    }
    if (capture.state === 'held_review') {
      heldForReviewCents += gross;
      if (!Number.isSafeInteger(heldForReviewCents)) {
        fail();
      }
    }
  }
  return { collectedCents, heldForReviewCents, captureCount: input.captures.length, unknownCurrencyEventCount, excludedForeignCurrencyEventCount };
}
