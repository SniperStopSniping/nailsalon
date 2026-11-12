import 'server-only';

import { and, eq, gte, inArray, lt } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import type { AppointmentPayment } from '@/models/Schema';

import { CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED, projectCustomerPaymentCaptureReport } from '../captureReporting';
import { projectOfflineFixtureCaptureReport } from '../fixtureCaptureReporting';
import { isCustomerPaymentLedgerTestEnabled } from '../ledgerTestGate';
import { readOfflineFixtureCaptureEvidence } from './fixtureApplicationReader';

/** Caller supplies all reserved markers in range; no new table read for legacy data. */
export async function readCustomerPaymentCaptureReport(database: Pick<typeof db, 'select'>, input: {
  salonId: string;
  currency: 'CAD' | 'USD';
  start: Date;
  end: Date;
  markers: AppointmentPayment[];
}) {
  if (input.markers.length === 0) {
    return projectCustomerPaymentCaptureReport({ ...input, captures: [] });
  }
  if (!isCustomerPaymentLedgerTestEnabled()) {
    throw new Error(CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED);
  }
  const { customerPaymentCaptureSchema } = await import('@/models/customerPaymentSchema');
  const captures = await database.select().from(customerPaymentCaptureSchema).where(and(
    eq(customerPaymentCaptureSchema.salonId, input.salonId),
    inArray(customerPaymentCaptureSchema.tenderId, input.markers.map(row => row.id)),
    gte(customerPaymentCaptureSchema.capturedAt, input.start),
    lt(customerPaymentCaptureSchema.capturedAt, input.end),
  ));
  const fixtureCaptures = captures.filter(capture => capture.source === 'offline_fixture_test');
  if (fixtureCaptures.length === 0) {
    return projectCustomerPaymentCaptureReport({ ...input, captures });
  }
  const fixtureIds = new Set(fixtureCaptures.map(capture => capture.tenderId));
  const evidence = await readOfflineFixtureCaptureEvidence(database, fixtureCaptures);
  const legacy = projectCustomerPaymentCaptureReport({ ...input, captures: captures.filter(capture => capture.source !== 'offline_fixture_test'), markers: input.markers.filter(marker => !fixtureIds.has(marker.id)) });
  const fixture = projectOfflineFixtureCaptureReport({ ...input, captures: fixtureCaptures, markers: input.markers.filter(marker => fixtureIds.has(marker.id)), evidence });
  const result = {
    collectedCents: legacy.collectedCents + fixture.collectedCents,
    heldForReviewCents: legacy.heldForReviewCents + fixture.heldForReviewCents,
    captureCount: legacy.captureCount + fixture.captureCount,
    unknownCurrencyEventCount: legacy.unknownCurrencyEventCount + fixture.unknownCurrencyEventCount,
    excludedForeignCurrencyEventCount: legacy.excludedForeignCurrencyEventCount + fixture.excludedForeignCurrencyEventCount,
  };
  if (Object.values(result).some(value => !Number.isSafeInteger(value))) {
    throw new Error(CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED);
  }
  return result;
}
