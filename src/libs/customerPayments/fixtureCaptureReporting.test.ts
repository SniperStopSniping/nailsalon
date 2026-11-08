import { describe, expect, it, vi } from 'vitest';

import { projectCustomerPaymentCaptureReport } from './captureReporting';
import { projectOfflineFixtureCaptureReport } from './fixtureCaptureReporting';
import { calculatePaymentSnapshot } from './money';
import type { OfflineFixtureCaptureEvidence } from './provenance';
import { providerCorrelationFingerprint } from './provider/correlation';

function fixtureEvidence() {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const at = new Date('2026-11-08T12:00:03Z');
  const written = new Date('2026-11-08T12:00:04Z');
  const snapshot = calculatePaymentSnapshot({ currency: 'cad', servicesCents: 10000, discountCents: 0, taxCents: 0, tipCents: 2000, collection: 'full' });
  const quote = { id: uuid(2), salonId: 's', appointmentId: 'a', stripeAccountId: 'acct_salon', mode: 'test', fingerprint: 'a'.repeat(64), snapshot, createdAt: new Date('2026-11-08T12:00:00Z'), expiresAt: new Date('2026-11-08T12:05:00Z') };
  const capture = { id: uuid(1), salonId: 's', appointmentId: 'a', quoteId: quote.id, stripeAccountId: 'acct_salon', mode: 'test' as const, source: 'offline_fixture_test' as const, paymentIntentId: 'pi_fixture', tenderId: `cpay_${uuid(1)}`, currency: 'cad', amountCents: 12000, principalCents: 10000, tipCents: 2000, applicationFeeCents: 100, quotedApplicationFeeCents: 100, state: 'posted' as const, reviewReason: null, capturedAt: at, recordedAt: written, fingerprint: 'b'.repeat(64) };
  const marker = { id: capture.tenderId, salonId: 's', appointmentId: 'a', reference: `customer_payment_capture:${capture.id}`, amountCents: 12000, method: 'online', recordedByType: 'system', recordedAt: at, createdAt: written, voidedAt: null, note: null, idempotencyKey: null, recordedById: null, recordedByName: null, voidedBy: null };
  const application = { id: uuid(3), operationId: uuid(4), quoteId: quote.id, captureId: capture.id, tenderId: capture.tenderId, salonId: 's', appointmentId: 'a', platformId: 'acct_platform', accountId: 'acct_salon', mode: 'test' as const, source: 'offline_fixture_test' as const, chargeId: 'ch_fixture', paymentIntentId: capture.paymentIntentId, candidateId: uuid(5), correlationId: uuid(6), sourceEvidence: { fixture: true }, sourceRevision: providerCorrelationFingerprint({ fixture: true }), ownershipEvidence: [{ operationId: uuid(4), fingerprint: 'd'.repeat(64) }], ownershipRevision: providerCorrelationFingerprint([{ operationId: uuid(4), fingerprint: 'd'.repeat(64) }]), platformRevision: 10, captureFingerprint: capture.fingerprint, quoteFingerprint: quote.fingerprint, successInboxId: uuid(7), successReceiptFingerprint: 'e'.repeat(64), successEventAt: at, currency: 'cad' as const, amountCents: 12000, principalCents: 10000, tipCents: 2000, applicationFeeCents: 100, createdAt: written };
  const evidence: OfflineFixtureCaptureEvidence = { application, quote, currentPlatformRevision: 10, holds: [] };
  const hold = { id: uuid(8), applicationId: application.id, platformId: application.platformId, platformRevision: 11, sourceTable: 'customer_payment_provider_inbox', sourceId: uuid(9), reason: 'material_source_change', createdAt: new Date('2026-11-08T12:01:00Z') };
  return { capture, marker, evidence, hold };
}
function reportInput() {
  const f = fixtureEvidence();
  return { ...f, input: { salonId: 's', currency: 'CAD' as const, start: new Date('2026-11-08T12:00:00Z'), end: new Date('2026-11-08T13:00:00Z'), captures: [f.capture], markers: [f.marker], evidence: [f.evidence] } };
}

describe('separate offline fixture gross reporting', () => {
  it('preserves gross while held and when application writer flag is off', () => {
    const { input, evidence, hold } = reportInput();
    vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'false');
    try {
      expect(projectOfflineFixtureCaptureReport(input)).toEqual({ collectedCents: 12000, heldForReviewCents: 0, captureCount: 1, unknownCurrencyEventCount: 0, excludedForeignCurrencyEventCount: 0 });

      evidence.currentPlatformRevision = 11;
      evidence.holds = [hold];

      expect(projectOfflineFixtureCaptureReport(input)).toMatchObject({ collectedCents: 12000, heldForReviewCents: 12000 });
      expect(() => projectCustomerPaymentCaptureReport(input)).toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('requires exact source evidence and excludes CAD when explicitly reporting USD', () => {
    const { input } = reportInput();

    expect(projectOfflineFixtureCaptureReport({ ...input, currency: 'USD' })).toMatchObject({ collectedCents: 0, heldForReviewCents: 0, excludedForeignCurrencyEventCount: 1 });
    expect(() => projectOfflineFixtureCaptureReport({ ...input, evidence: [] })).toThrow();
    expect(() => projectOfflineFixtureCaptureReport({ ...input, captures: [{ ...input.captures[0]!, source: 'synthetic_test' }] })).toThrow();
  });

  it('rejects duplicate cash, foreign tenant, invalid range and mismatched tender', () => {
    const { input } = reportInput();

    expect(() => projectOfflineFixtureCaptureReport({ ...input, captures: [...input.captures, ...input.captures], markers: [...input.markers, ...input.markers], evidence: [...input.evidence, ...input.evidence] })).toThrow();
    expect(() => projectOfflineFixtureCaptureReport({ ...input, salonId: 'foreign' })).toThrow();
    expect(() => projectOfflineFixtureCaptureReport({ ...input, end: input.start })).toThrow();
    expect(() => projectOfflineFixtureCaptureReport({ ...input, markers: [{ ...input.markers[0]!, amountCents: 1 }] })).toThrow();
    expect(() => projectOfflineFixtureCaptureReport({ ...input, end: input.captures[0]!.capturedAt })).toThrow();
  });
});
