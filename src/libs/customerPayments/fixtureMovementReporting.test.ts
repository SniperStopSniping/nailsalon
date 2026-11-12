import { describe, expect, it } from 'vitest';

import type { CustomerPaymentFixtureMovement, CustomerPaymentFixtureReconciliation } from '@/models/customerPaymentFixtureMovementSchema';

import { fixtureMovementFingerprintFacts, projectOfflineFixtureMovementReport } from './fixtureMovementReporting';
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
function fixture() {
  const f = fixtureEvidence();
  f.evidence.currentPlatformRevision = 11;
  const row: CustomerPaymentFixtureMovement = {
    id: 'movement1',
    reconciliationId: 'batch1',
    applicationId: f.evidence.application.id,
    captureId: f.capture.id,
    salonId: 's',
    appointmentId: 'a',
    platformId: 'acct_platform',
    accountScope: 'connected',
    accountId: 'acct_salon',
    source: 'offline_fixture_test',
    mode: 'test',
    kind: 'customer_refund',
    allocation: 'unallocated',
    bookingCredit: 'none',
    movementId: 're_fixture',
    movementKeyHash: '1'.repeat(64),
    operationId: 'operation_refund',
    chargeId: 'ch_fixture',
    paymentIntentId: 'pi_fixture',
    applicationFeeId: null,
    disputeId: null,
    amountCents: 3000,
    feeCents: null,
    netCents: null,
    currency: 'cad',
    objectCreatedAt: new Date('2026-11-09T12:00:00Z'),
    occurredAt: new Date('2026-11-09T12:00:01Z'),
    recordedAt: new Date('2026-11-09T12:00:02Z'),
    fingerprint: '2'.repeat(64),
    evidence: { fixture: true },
  };
  const batch: CustomerPaymentFixtureReconciliation = {
    id: 'batch1',
    applicationId: row.applicationId,
    platformRevision: 11,
    sourceRevision: '3'.repeat(64),
    sourceEvidence: { fixture: true },
    ownershipRevision: '4'.repeat(64),
    ownershipEvidence: { fixture: true },
    movementEvidence: [{ id: row.id, movementKeyHash: row.movementKeyHash, fingerprint: row.fingerprint }],
    createdAt: row.recordedAt,
  };
  const input = {
    salonId: 's',
    currency: 'CAD' as 'CAD' | 'USD',
    start: new Date('2026-11-09T00:00:00Z'),
    end: new Date('2026-11-10T00:00:00Z'),
    captures: [f.capture],
    markers: [f.marker],
    evidence: [f.evidence],
    movements: [row],
    reconciliations: [batch],
  };
  return { ...f, row, batch, input };
}
function bind(f: ReturnType<typeof fixture>) {
  f.batch.movementEvidence = f.input.movements.map(row => ({ id: row.id, movementKeyHash: row.movementKeyHash, fingerprint: row.fingerprint })).sort((a, b) => a.movementKeyHash.localeCompare(b.movementKeyHash));
}

describe('immutable offline fixture movement projection', () => {
  it('reports unallocated customer refunds with the original capture outside the period', () => {
    const { input } = fixture();

    expect(projectOfflineFixtureMovementReport(input)).toEqual({ refundedCents: 3000, unallocatedRefundCents: 3000, feeRefundedCents: 0, disputeWithdrawnCents: 0, disputeReinstatedCents: 0, disputeFeeCents: 0, disputeNetCents: 0, movementReconciliationRequired: false, excludedForeignCurrencyEventCount: 0 });
    expect(projectOfflineFixtureMovementReport(input)).not.toHaveProperty('principalCents');
    expect(projectOfflineFixtureMovementReport(input)).not.toHaveProperty('tipCents');
    expect(projectOfflineFixtureMovementReport(input)).not.toHaveProperty('netCashCents');
  });

  it('preserves earlier cash when later material source makes completeness stale', () => {
    const { input, evidence } = fixture();
    evidence.currentPlatformRevision = 12;

    expect(projectOfflineFixtureMovementReport(input)).toMatchObject({ refundedCents: 3000, movementReconciliationRequired: true });
  });

  it('accepts initial unchanged capture with zero movements but not unproved changed evidence', () => {
    const { input, evidence } = fixture();
    input.movements = [];
    input.reconciliations = [];
    evidence.currentPlatformRevision = evidence.application.platformRevision;

    expect(projectOfflineFixtureMovementReport(input).movementReconciliationRequired).toBe(false);

    evidence.currentPlatformRevision++;

    expect(projectOfflineFixtureMovementReport(input).movementReconciliationRequired).toBe(true);
  });

  it('validates exact empty current reconciliation while preserving permanent holds', () => {
    const { input, batch, evidence, hold } = fixture();
    input.movements = [];
    batch.movementEvidence = [];
    evidence.holds = [hold];

    expect(projectOfflineFixtureMovementReport(input).movementReconciliationRequired).toBe(false);
    expect(evidence.holds).toHaveLength(1);
  });

  it('keeps independently observed fee returns and signed dispute flows separate', () => {
    const f = fixture();
    f.input.movements.push(
      { ...f.row, id: 'fee', kind: 'application_fee_refund', accountScope: 'platform', accountId: null, applicationFeeId: 'fee_fixture', movementId: 'fr_fixture', movementKeyHash: '5'.repeat(64), amountCents: 100 },
      { ...f.row, id: 'withdrawal', kind: 'dispute_withdrawal', operationId: f.evidence.application.operationId, disputeId: 'dp_fixture', movementId: 'txn_withdrawal', movementKeyHash: '6'.repeat(64), amountCents: -2000, feeCents: 150, netCents: -2150 },
      { ...f.row, id: 'reinstatement', kind: 'dispute_reinstatement', operationId: f.evidence.application.operationId, disputeId: 'dp_fixture', movementId: 'txn_reinstatement', movementKeyHash: '7'.repeat(64), amountCents: 2000, feeCents: -100, netCents: 2100 },
    );
    bind(f);

    expect(projectOfflineFixtureMovementReport(f.input)).toMatchObject({ refundedCents: 3000, feeRefundedCents: 100, disputeWithdrawnCents: 2000, disputeReinstatedCents: 2000, disputeFeeCents: 50, disputeNetCents: -50 });
  });

  it('filters dated totals without filtering immutable binding validation', () => {
    const { input, row } = fixture();
    input.start = new Date('2026-11-10T00:00:00Z');
    input.end = new Date('2026-11-11T00:00:00Z');

    expect(projectOfflineFixtureMovementReport(input).refundedCents).toBe(0);

    row.currency = 'usd' as 'cad';

    expect(() => projectOfflineFixtureMovementReport(input)).toThrow();
  });

  it('excludes CAD movements in explicit USD reporting', () => {
    const { input } = fixture();
    input.currency = 'USD';

    expect(projectOfflineFixtureMovementReport(input)).toMatchObject({ refundedCents: 0, unallocatedRefundCents: 0, excludedForeignCurrencyEventCount: 1 });
  });

  it.each([
    ['captureId', 'foreign'],
    ['applicationId', 'foreign'],
    ['reconciliationId', 'foreign'],
    ['salonId', 'foreign'],
    ['appointmentId', 'foreign'],
    ['platformId', 'foreign'],
    ['accountId', null],
    ['accountScope', 'platform'],
    ['paymentIntentId', 'pi_other'],
    ['chargeId', 'ch_other'],
    ['source', 'synthetic_test'],
    ['allocation', 'allocated'],
    ['allocation', null],
    ['allocation', undefined],
    ['bookingCredit', 'applied'],
    ['bookingCredit', null],
    ['bookingCredit', undefined],
    ['mode', 'live'],
    ['currency', 'usd'],
    ['amountCents', 0],
    ['amountCents', -1],
    ['amountCents', 12001],
    ['amountCents', Number.NaN],
    ['amountCents', Number.MAX_SAFE_INTEGER + 1],
    ['feeCents', 0],
    ['netCents', 0],
    ['applicationFeeId', 'fee_fake'],
    ['disputeId', 'dp_fake'],
    ['fingerprint', 'bad'],
    ['movementKeyHash', 'bad'],
    ['objectCreatedAt', new Date('2026-11-07T00:00:00Z')],
    ['occurredAt', new Date('invalid')],
    ['recordedAt', new Date('2026-11-08T00:00:00Z')],
  ])('rejects malformed or cross-owner movement %s=%s', (key, value) => {
    const { input, row } = fixture();
    Object.assign(row, { [key]: value });

    expect(() => projectOfflineFixtureMovementReport(input)).toThrow();
  });

  it('rejects duplicate IDs, business identities and null-scope fee identities', () => {
    const f = fixture();
    f.input.movements.push({ ...f.row, id: 'duplicate', movementKeyHash: '9'.repeat(64) });
    bind(f);

    expect(() => projectOfflineFixtureMovementReport(f.input)).toThrow();

    f.input.movements = f.input.movements.map(row => ({ ...row, kind: 'application_fee_refund', accountScope: 'platform', accountId: null, applicationFeeId: 'fee_fixture', amountCents: 10 }));

    expect(() => projectOfflineFixtureMovementReport(f.input)).toThrow();
  });

  it.each(['missing', 'extra', 'fingerprint', 'key', 'id', 'metadata'] as const)('rejects %s immutable snapshot binding', (change) => {
    const { input, batch } = fixture();
    const entry = batch.movementEvidence[0]!;
    if (change === 'missing') {
      batch.movementEvidence = [];
    } else if (change === 'extra') {
      batch.movementEvidence = [entry, entry];
    } else {
      Object.assign(entry, { [change === 'key' ? 'movementKeyHash' : change]: 'wrong' });
    }

    expect(() => projectOfflineFixtureMovementReport(input)).toThrow();
  });

  it('requires cumulative snapshots and accepts a later empty-addition reconciliation', () => {
    const { input, evidence, batch } = fixture();
    evidence.currentPlatformRevision = 12;
    const next = { ...batch, id: 'batch2', platformRevision: 12, createdAt: new Date('2026-11-10T00:00:00Z') };
    input.reconciliations.push(next);

    expect(projectOfflineFixtureMovementReport(input).movementReconciliationRequired).toBe(false);

    next.movementEvidence = [];

    expect(() => projectOfflineFixtureMovementReport(input)).toThrow();
  });

  it('fails closed for signed arithmetic and opposite-kind business replay', () => {
    const f = fixture();
    Object.assign(f.row, { kind: 'dispute_withdrawal', operationId: f.evidence.application.operationId, disputeId: 'dp_fixture', movementId: 'txn_fixture', amountCents: -2000, feeCents: 150, netCents: -2000 });

    expect(() => projectOfflineFixtureMovementReport(f.input)).toThrow();

    f.row.netCents = -2150;

    expect(projectOfflineFixtureMovementReport(f.input).disputeNetCents).toBe(-2150);

    f.input.movements.push({ ...f.row, id: 'replay', kind: 'dispute_reinstatement', movementKeyHash: '8'.repeat(64), amountCents: 2000, feeCents: -150, netCents: 2150 });
    bind(f);

    expect(() => projectOfflineFixtureMovementReport(f.input)).toThrow();
  });

  it('supports partial repeated dispute transactions but rejects reinstatement before withdrawal', () => {
    const f = fixture();
    Object.assign(f.row, { kind: 'dispute_withdrawal', operationId: f.evidence.application.operationId, disputeId: 'dp_fixture', movementId: 'txn_first', amountCents: -1000, feeCents: 150, netCents: -1150 });
    f.input.movements.push(
      { ...f.row, id: 'second', movementId: 'txn_second', movementKeyHash: '8'.repeat(64), amountCents: -500, feeCents: 0, netCents: -500 },
      { ...f.row, id: 'restore', kind: 'dispute_reinstatement', movementId: 'txn_restore', movementKeyHash: '9'.repeat(64), amountCents: 750, feeCents: 0, netCents: 750 },
    );
    bind(f);

    expect(projectOfflineFixtureMovementReport(f.input)).toMatchObject({ disputeWithdrawnCents: 1500, disputeReinstatedCents: 750, disputeNetCents: -900 });

    f.input.movements[2]!.occurredAt = f.row.objectCreatedAt;

    expect(() => projectOfflineFixtureMovementReport(f.input)).toThrow();
  });

  it('rejects foreign parent, duplicate parents and invalid reporting ranges', () => {
    const { input } = fixture();

    expect(() => projectOfflineFixtureMovementReport({ ...input, salonId: 'foreign' })).toThrow();
    expect(() => projectOfflineFixtureMovementReport({ ...input, captures: [...input.captures, ...input.captures] })).toThrow();
    expect(() => projectOfflineFixtureMovementReport({ ...input, end: input.start })).toThrow();
    expect(() => projectOfflineFixtureMovementReport({ ...input, start: new Date('invalid') })).toThrow();
    expect(() => projectOfflineFixtureMovementReport({ ...input, markers: [] })).toThrow();
  });

  it('exports deterministic fingerprint facts without importing server crypto', () => {
    const { row } = fixture();

    expect(fixtureMovementFingerprintFacts(row)).toMatchObject({ objectCreatedAt: row.objectCreatedAt.toISOString(), occurredAt: row.occurredAt.toISOString(), amountCents: 3000 });
    expect(fixtureMovementFingerprintFacts(row)).not.toHaveProperty('recordedAt');
  });
});
