import { describe, expect, it } from 'vitest';

import { resolveAppointmentPaymentLedger, resolveAppointmentPaymentLedgerForReconciliation } from '@/libs/appointmentPaymentLedger';

import { calculatePaymentSnapshot } from './money';
import type { OfflineFixtureCaptureEvidence } from './provenance';
import { customerPaymentCompletionTip, customerPaymentTenderSummary, customerPaymentTipFloor, hasVerifiedCustomerPaymentTender, isCustomerPaymentTender, verifyCustomerPaymentTender, verifyOfflineFixtureCaptureTender } from './provenance';
import { providerCorrelationFingerprint } from './provider/correlation';

const id = '00000000-0000-4000-8000-000000000001';
const capture = { id, salonId: 's', appointmentId: 'a', amountCents: 12000, tipCents: 2000, state: 'posted' as const, mode: 'test' as const, synthetic: true as const };
const row = { id: `cpay_${id}`, reference: `customer_payment_capture:${id}`, salonId: 's', appointmentId: 'a', amountCents: 12000, method: 'online', recordedByType: 'system', voidedAt: null };
const ledger = { cachedAmountPaidCents: 12000, expectedSalonId: 's', appointmentStatus: 'confirmed', paymentStatus: 'pending' };

describe('reserved customer-payment tender provenance', () => {
  it('detects either prefix independently and never treats markers as manual tender', () => {
    expect(isCustomerPaymentTender({ id: 'cpay_broken' })).toBe(true);
    expect(isCustomerPaymentTender({ reference: 'customer_payment_capture:broken' })).toBe(true);
    expect(isCustomerPaymentTender({ id: 'ordinary', reference: 'bank transfer' })).toBe(false);
    expect(resolveAppointmentPaymentLedger({ ...ledger, paymentRows: [row] }).ok).toBe(false);
    expect(resolveAppointmentPaymentLedger({ ...ledger, cachedAmountPaidCents: 0, paymentRows: [{ ...row, voidedAt: new Date() }] }).ok).toBe(false);
  });

  it('credits only verified posted gross tender exactly once', () => {
    const verified = verifyCustomerPaymentTender(row, capture, []);

    expect(hasVerifiedCustomerPaymentTender(verified)).toBe(true);
    expect(resolveAppointmentPaymentLedger({ ...ledger, paymentRows: [verified] })).toMatchObject({ ok: true, ledgerPaymentsCents: 12000 });
    expect(JSON.stringify(verified)).not.toContain('tipCents');
    expect(hasVerifiedCustomerPaymentTender(JSON.parse(JSON.stringify(verified)))).toBe(false);
  });

  it.each([
    { state: 'held_review' },
    { mode: 'live' },
    { synthetic: false },
    { salonId: 'foreign' },
    { appointmentId: 'foreign' },
    { amountCents: 12001 },
    { tipCents: 12001 },
    { tipCents: -1 },
  ])('rejects invalid capture %j', (patch) => {
    expect(() => verifyCustomerPaymentTender(row, { ...capture, ...patch } as never, [])).toThrow('PROVENANCE_RECONCILIATION');
  });

  it.each([{ reference: 'manual' }, { id: 'manual' }, { method: 'cash' }, { recordedByType: 'admin' }, { voidedAt: new Date() }])('rejects changed source %j', (patch) => {
    expect(() => verifyCustomerPaymentTender({ ...row, ...patch }, capture, [])).toThrow('PROVENANCE_RECONCILIATION');
    expect(hasVerifiedCustomerPaymentTender({ ...verifyCustomerPaymentTender(row, capture, []), ...patch })).toBe(false);
  });

  it('preserves omitted tip, rejects explicit reduction, and permits a higher tip', () => {
    const rows = [verifyCustomerPaymentTender(row, capture, [])];

    expect(customerPaymentTipFloor(rows)).toBe(2000);
    expect(customerPaymentCompletionTip(rows, undefined, 2000)).toBe(2000);
    expect(customerPaymentCompletionTip(rows, undefined, 2500)).toBe(2500);
    expect(customerPaymentCompletionTip(rows, 3000, 2000)).toBe(3000);
    expect(() => customerPaymentCompletionTip(rows, 0, 2000)).toThrow('PREPAID_TIP_REQUIRED');
    expect(() => customerPaymentCompletionTip([row], undefined, 2000)).toThrow('PROVENANCE_RECONCILIATION');
  });

  it('leaves legacy zero-tip default and ordinary tender behavior unchanged', () => {
    const ordinary = { amountCents: 1000, voidedAt: null };

    expect(customerPaymentCompletionTip([ordinary], undefined, 2000)).toBe(0);
    expect(resolveAppointmentPaymentLedger({ ...ledger, cachedAmountPaidCents: 1000, paymentRows: [ordinary], expectedSalonId: undefined }).ok).toBe(true);
  });
});

describe('immutable refund provenance', () => {
  const base = { id: 'refund-row', refundId: 're_1', captureId: id, salonId: 's', appointmentId: 'a', state: 'applied' as const };

  it.each([
    { principalCents: 10000, tipCents: 2000 },
    { principalCents: 3000, tipCents: 500 },
    { principalCents: 0, tipCents: 1000 },
  ])('keeps gross immutable and blocks collection after %j', (allocation) => {
    const amountCents = allocation.principalCents + allocation.tipCents;
    const refunds = [{ ...base, ...allocation, amountCents }];
    const verified = verifyCustomerPaymentTender(row, capture, refunds);
    const net = 12000 - amountCents;

    expect(verified.amountCents).toBe(12000);
    expect(customerPaymentTenderSummary(verified)).toMatchObject({ grossCents: 12000, netCents: net, refundedCents: amountCents, collectionHold: true });
    expect(resolveAppointmentPaymentLedger({ ...ledger, cachedAmountPaidCents: net, paymentRows: [verified] }).ok).toBe(false);
    expect(resolveAppointmentPaymentLedgerForReconciliation({ ...ledger, cachedAmountPaidCents: net, paymentRows: [verified] })).toMatchObject({ ok: true, collectionHold: true, ledgerPaymentsCents: net });
    expect(() => customerPaymentCompletionTip([verified], undefined, 2000)).toThrow('REFUND_RECONCILIATION');
    expect(customerPaymentTenderSummary(verifyCustomerPaymentTender(row, capture, refunds))).toEqual(customerPaymentTenderSummary(verified));
    expect(() => verifyCustomerPaymentTender(row, capture, [...refunds, ...refunds])).toThrow('REFUND_RECONCILIATION');
  });

  it('holds review evidence without crediting an unproven refund allocation', () => {
    const verified = verifyCustomerPaymentTender(row, capture, [{ ...base, state: 'held_review', amountCents: 90000, principalCents: 0, tipCents: 0 }]);

    expect(customerPaymentTenderSummary(verified)).toMatchObject({ netCents: 12000, refundedCents: 0, collectionHold: true });
    expect(resolveAppointmentPaymentLedger({ ...ledger, paymentRows: [verified] }).ok).toBe(false);
  });

  it('rejects missing, foreign, oversized and inconsistent receipt evidence', () => {
    expect(() => verifyCustomerPaymentTender(row, capture, undefined as never)).toThrow('REFUND_EVIDENCE_REQUIRED');

    for (const patch of [{ salonId: 'foreign' }, { captureId: 'foreign' }, { amountCents: 1 }, { principalCents: 12000, amountCents: 12000 }, { tipCents: 2001, amountCents: 2001, principalCents: 0 }]) {
      expect(() => verifyCustomerPaymentTender(row, capture, [{ ...base, principalCents: 1000, tipCents: 0, amountCents: 1000, ...patch }])).toThrow('REFUND_RECONCILIATION');
    }
  });
});

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

describe('distinct offline fixture application proof', () => {
  it('mints canonical gross/tip proof without synthetic rebranding', () => {
    const { marker, capture, evidence } = fixtureEvidence();
    const proven = verifyOfflineFixtureCaptureTender(marker, capture, evidence);

    expect(hasVerifiedCustomerPaymentTender(proven)).toBe(true);
    expect(customerPaymentTenderSummary(proven)).toMatchObject({ grossCents: 12000, netCents: 12000, grossTipCents: 2000, collectionHold: false });
    expect(resolveAppointmentPaymentLedger({ ...ledger, paymentRows: [proven] })).toMatchObject({ ok: true, ledgerPaymentsCents: 12000 });
    expect(customerPaymentCompletionTip([proven], undefined, 2000)).toBe(2000);
    expect(() => verifyCustomerPaymentTender(marker, { ...capture, synthetic: true }, [])).toThrow();
    expect(hasVerifiedCustomerPaymentTender(JSON.parse(JSON.stringify(proven)))).toBe(false);
    expect(hasVerifiedCustomerPaymentTender({ ...proven, recordedAt: new Date(0) })).toBe(false);
  });

  it.each([false, true])('retains gross and blocks ordinary action on durable hold/stale revision, explicitHold=%s', (explicitHold) => {
    const { marker, capture, evidence, hold } = fixtureEvidence();
    evidence.currentPlatformRevision = 11;
    evidence.holds = explicitHold ? [hold] : [];
    const proven = verifyOfflineFixtureCaptureTender(marker, capture, evidence);

    expect(customerPaymentTenderSummary(proven)).toMatchObject({ grossCents: 12000, netCents: 12000, refundedCents: 0, collectionHold: true });
    expect(resolveAppointmentPaymentLedger({ ...ledger, paymentRows: [proven] }).ok).toBe(false);
    expect(resolveAppointmentPaymentLedgerForReconciliation({ ...ledger, paymentRows: [proven] })).toMatchObject({ ok: true, collectionHold: true, ledgerPaymentsCents: 12000 });
    expect(() => customerPaymentCompletionTip([proven], undefined, 2000)).toThrow();
  });

  it.each(['captureId', 'quoteId', 'salonId', 'appointmentId', 'accountId', 'paymentIntentId', 'tenderId', 'captureFingerprint', 'quoteFingerprint', 'mode', 'source'])('rejects mismatched application %s', (field) => {
    const { marker, capture, evidence } = fixtureEvidence();

    expect(() => verifyOfflineFixtureCaptureTender(marker, capture, { ...evidence, application: { ...evidence.application, [field]: 'foreign' } })).toThrow();
  });

  it.each(['amountCents', 'principalCents', 'tipCents', 'applicationFeeCents'])('rejects mismatched application amount %s', (field) => {
    const { marker, capture, evidence } = fixtureEvidence();

    expect(() => verifyOfflineFixtureCaptureTender(marker, capture, { ...evidence, application: { ...evidence.application, [field]: 1 } })).toThrow();
  });

  it('rejects absent/foreign holds, revision rollback, inconsistent snapshot, and changed occurrence time', () => {
    const { marker, capture, evidence, hold } = fixtureEvidence();
    for (const patch of [{ holds: undefined }, { currentPlatformRevision: 9 }, { currentPlatformRevision: 11, holds: [{ ...hold, applicationId: 'other' }] }, { currentPlatformRevision: 11, holds: [hold, hold] }]) {
      expect(() => verifyOfflineFixtureCaptureTender(marker, capture, { ...evidence, ...patch } as never)).toThrow();
    }

    expect(() => verifyOfflineFixtureCaptureTender(marker, capture, { ...evidence, quote: { ...evidence.quote, snapshot: { ...evidence.quote.snapshot, taxCents: 10 } } })).toThrow();
    expect(() => verifyOfflineFixtureCaptureTender(marker, { ...capture, capturedAt: new Date(0) }, evidence)).toThrow();
  });
});

it('requires structured source and exact single-owner evidence at the trusted-reader boundary', () => {
  const { marker, capture, evidence } = fixtureEvidence();
  for (const patch of [
    { sourceEvidence: null },
    { sourceEvidence: [] },
    { sourceEvidence: {} },
    { ownershipEvidence: [] },
    { ownershipEvidence: [{ operationId: 'foreign', fingerprint: 'a'.repeat(64) }] },
    { ownershipEvidence: [{ operationId: evidence.application.operationId, fingerprint: 'invalid' }] },
    { sourceRevision: 'invalid' },
    { ownershipRevision: 'invalid' },
  ]) {
    expect(() => verifyOfflineFixtureCaptureTender(marker, capture, { ...evidence, application: { ...evidence.application, ...patch } } as never)).toThrow();
  }

  expect(providerCorrelationFingerprint(evidence.application.sourceEvidence)).toBe(evidence.application.sourceRevision);
  expect(providerCorrelationFingerprint(evidence.application.ownershipEvidence)).toBe(evidence.application.ownershipRevision);
});
