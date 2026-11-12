import type { CustomerPaymentCapture } from '@/models/customerPaymentSchema';
import type { AppointmentPayment } from '@/models/Schema';

import type { OfflineFixtureCaptureEvidence } from './provenance';
import { customerPaymentTenderSummary, verifyOfflineFixtureCaptureTender } from './provenance';

/** Gross offline fixture cash only. Holds never erase historical cash or imply refunds. */
export function projectOfflineFixtureCaptureReport(input: {
  salonId: string;
  currency: 'CAD' | 'USD';
  start: Date;
  end: Date;
  captures: readonly CustomerPaymentCapture[];
  markers: readonly AppointmentPayment[];
  evidence: readonly OfflineFixtureCaptureEvidence[];
}) {
  const fail = (): never => {
    throw new Error('CUSTOMER_PAYMENT_FIXTURE_REPORTING_RECONCILIATION_REQUIRED');
  };
  const timestamp = (date: Date) => date instanceof Date && Number.isSafeInteger(date.getTime()) ? date.getTime() : fail();
  const start = timestamp(input.start);
  const end = timestamp(input.end);
  if (!input.salonId.trim() || !['CAD', 'USD'].includes(input.currency) || end <= start
    || input.captures.length !== input.markers.length || input.captures.length !== input.evidence.length) {
    fail();
  }
  const captureIds = new Set<string>();
  const applicationIds = new Set<string>();
  const chargeKeys = new Set<string>();
  const intentKeys = new Set<string>();
  if (new Set(input.markers.map(row => row.id)).size !== input.markers.length) {
    fail();
  }
  let collectedCents = 0;
  let heldForReviewCents = 0;
  let excludedForeignCurrencyEventCount = 0;
  for (const capture of input.captures) {
    const marker = input.markers.find(row => row.id === capture.tenderId);
    const matches = input.evidence.filter(e => e.application.captureId === capture.id);
    if (!marker || matches.length !== 1 || captureIds.has(capture.id) || capture.salonId !== input.salonId
      || timestamp(capture.capturedAt) < start || timestamp(capture.capturedAt) >= end) {
      fail();
    }
    const evidence = matches[0]!;
    const a = evidence.application;
    const chargeKey = `${a.platformId}:${a.accountId}:${a.mode}:${a.chargeId}`;
    const intentKey = `${a.platformId}:${a.accountId}:${a.mode}:${a.paymentIntentId}`;
    if (applicationIds.has(a.id) || chargeKeys.has(chargeKey) || intentKeys.has(intentKey)) {
      fail();
    }
    let summary;
    try {
      summary = customerPaymentTenderSummary(verifyOfflineFixtureCaptureTender(marker!, capture, evidence));
    } catch {
      return fail();
    }
    captureIds.add(capture.id);
    applicationIds.add(a.id);
    chargeKeys.add(chargeKey);
    intentKeys.add(intentKey);
    if (input.currency !== 'CAD') {
      excludedForeignCurrencyEventCount++;
      continue;
    }
    collectedCents += summary.grossCents;
    heldForReviewCents += summary.collectionHold ? summary.grossCents : 0;
    if (!Number.isSafeInteger(collectedCents) || !Number.isSafeInteger(heldForReviewCents)) {
      fail();
    }
  }
  return { collectedCents, heldForReviewCents, captureCount: input.captures.length, unknownCurrencyEventCount: 0, excludedForeignCurrencyEventCount };
}
