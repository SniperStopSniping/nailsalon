import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import type { CustomerPaymentFixtureMovement, CustomerPaymentFixtureReconciliation } from '@/models/customerPaymentFixtureMovementSchema';
import type { CustomerPaymentCapture } from '@/models/customerPaymentSchema';
import type { AppointmentPayment } from '@/models/Schema';

import type { OfflineFixtureCaptureEvidence } from './provenance';
import { verifyOfflineFixtureCaptureTender } from './provenance';

export const CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_RECONCILIATION_REQUIRED = 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_RECONCILIATION_REQUIRED';
function fail(): never {
  throw new Error(CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_RECONCILIATION_REQUIRED);
}
function time(value: Date): number {
  return value instanceof Date && Number.isSafeInteger(value.getTime()) ? value.getTime() : fail();
}
function amount(value: number): number {
  return Number.isSafeInteger(value) && Math.abs(value) <= MAX_SUPPORTED_MINOR_UNIT_AMOUNT ? value : fail();
}
function total(value: number): number {
  return Number.isSafeInteger(value) ? value : fail();
}
function text(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
function hash(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function object(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length > 0;
}
/** JSON tuples retain null platform scope and cannot collide on separators. */
export function fixtureMovementBusinessKey(row: CustomerPaymentFixtureMovement): string {
  return JSON.stringify([row.platformId, row.accountScope, row.accountId, row.mode, row.kind.startsWith('dispute_') ? 'dispute' : row.kind, row.movementId]);
}

/** Canonical provider key preimage; a dispute transaction cannot change kind. */
export function fixtureMovementKeyFacts(row: CustomerPaymentFixtureMovement): Record<string, unknown> {
  const scope = { platformId: row.platformId, accountScope: row.accountScope, accountId: row.accountId, mode: row.mode };
  return row.kind.startsWith('dispute_')
    ? { ...scope, balanceTransactionId: row.movementId }
    : { ...scope, kind: row.kind, movementId: row.movementId };
}

/** Hash this exact object only on the trusted server boundary. */
export function fixtureMovementFingerprintFacts(row: CustomerPaymentFixtureMovement): Record<string, unknown> {
  return {
    applicationId: row.applicationId,
    kind: row.kind,
    movementKeyHash: row.movementKeyHash,
    operationId: row.operationId,
    chargeId: row.chargeId,
    paymentIntentId: row.paymentIntentId,
    applicationFeeId: row.applicationFeeId,
    disputeId: row.disputeId,
    amountCents: row.amountCents,
    feeCents: row.feeCents,
    netCents: row.netCents,
    currency: row.currency,
    objectCreatedAt: new Date(time(row.objectCreatedAt)).toISOString(),
    occurredAt: new Date(time(row.occurredAt)).toISOString(),
  };
}

/**
 * All parent movements and reconciliation snapshots are required, including those
 * outside the requested period. Trusted server readers recompute evidence hashes;
 * this shared projector validates immutable bindings without importing crypto.
 */
export function projectOfflineFixtureMovementReport(input: {
  salonId: string;
  currency: 'CAD' | 'USD';
  start: Date;
  end: Date;
  captures: readonly CustomerPaymentCapture[];
  markers: readonly AppointmentPayment[];
  evidence: readonly OfflineFixtureCaptureEvidence[];
  movements: readonly CustomerPaymentFixtureMovement[];
  reconciliations: readonly CustomerPaymentFixtureReconciliation[];
}) {
  const start = time(input.start);
  const end = time(input.end);
  if (!text(input.salonId) || start >= end || !['CAD', 'USD'].includes(input.currency)) {
    fail();
  }
  const captures = new Map(input.captures.map(row => [row.id, row]));
  const markers = new Map(input.markers.map(row => [row.id, row]));
  const evidence = new Map(input.evidence.map(row => [row.application.id, row]));
  const reconciliations = new Map(input.reconciliations.map(row => [row.id, row]));
  if (captures.size !== input.captures.length || markers.size !== input.markers.length
    || evidence.size !== input.evidence.length || reconciliations.size !== input.reconciliations.length
    || captures.size !== markers.size || captures.size !== evidence.size) {
    fail();
  }
  const boundCaptures = new Set<string>();
  const charges = new Set<string>();
  const intents = new Set<string>();
  for (const proof of evidence.values()) {
    const a = proof.application;
    const capture = captures.get(a.captureId);
    const marker = markers.get(a.tenderId);
    const charge = JSON.stringify([a.platformId, a.accountId, a.mode, a.chargeId]);
    const intent = JSON.stringify([a.platformId, a.accountId, a.mode, a.paymentIntentId]);
    if (!capture || !marker || capture.salonId !== input.salonId || boundCaptures.has(capture.id) || charges.has(charge) || intents.has(intent)) {
      fail();
    }
    try {
      verifyOfflineFixtureCaptureTender(marker, capture, proof);
    } catch {
      fail();
    }
    boundCaptures.add(capture.id);
    charges.add(charge);
    intents.add(intent);
  }
  const batchRevisions = new Set<string>();
  for (const batch of reconciliations.values()) {
    const proof = evidence.get(batch.applicationId);
    const revisionKey = JSON.stringify([batch.applicationId, batch.platformRevision]);
    if (!proof || !text(batch.id) || batchRevisions.has(revisionKey)
      || !Number.isSafeInteger(batch.platformRevision) || batch.platformRevision < proof.application.platformRevision
      || batch.platformRevision > proof.currentPlatformRevision || time(batch.createdAt) < time(proof.application.createdAt)
      || !hash(batch.sourceRevision) || !hash(batch.ownershipRevision) || !object(batch.sourceEvidence)
      || !object(batch.ownershipEvidence) || !Array.isArray(batch.movementEvidence)) {
      fail();
    }
    batchRevisions.add(revisionKey);
  }
  let refundedCents = 0;
  let feeRefundedCents = 0;
  let disputeWithdrawnCents = 0;
  let disputeReinstatedCents = 0;
  let disputeFeeCents = 0;
  let disputeNetCents = 0;
  let excludedForeignCurrencyEventCount = 0;
  const ids = new Set<string>();
  const keys = new Set<string>();
  const feeBindings = new Map<string, string>();
  const disputes = new Map<string, CustomerPaymentFixtureMovement[]>();
  const captureTotals = new Map<string, { refund: number; fee: number }>();
  for (const row of input.movements) {
    const proof = evidence.get(row.applicationId);
    const capture = captures.get(row.captureId);
    const batch = reconciliations.get(row.reconciliationId);
    const key = fixtureMovementBusinessKey(row);
    if (!proof || !capture || !batch || batch.applicationId !== row.applicationId
      || ![row.id, row.movementId, row.operationId].every(text) || ids.has(row.id) || keys.has(key)
      || !hash(row.movementKeyHash) || !hash(row.fingerprint) || !object(row.evidence)
      || row.captureId !== proof.application.captureId || row.salonId !== input.salonId
      || row.salonId !== capture.salonId || row.appointmentId !== capture.appointmentId
      || row.platformId !== proof.application.platformId || row.chargeId !== proof.application.chargeId
      || row.paymentIntentId !== proof.application.paymentIntentId || row.source !== 'offline_fixture_test' || row.mode !== 'test' || row.currency !== 'cad'
      || row.allocation !== 'unallocated' || row.bookingCredit !== 'none'
      || time(row.objectCreatedAt) < time(capture.capturedAt) || time(row.occurredAt) < time(row.objectCreatedAt)
      || time(row.recordedAt) < time(row.occurredAt) || time(row.recordedAt) !== time(batch.createdAt)
      || time(row.occurredAt) % 1000 !== 0 || time(row.objectCreatedAt) % 1000 !== 0) {
      fail();
    }
    ids.add(row.id);
    keys.add(key);
    const totals = captureTotals.get(capture.id) ?? { refund: 0, fee: 0 };
    const value = amount(row.amountCents);
    if (row.kind === 'customer_refund' || row.kind === 'application_fee_refund') {
      if (value <= 0 || row.feeCents !== null || row.netCents !== null || row.disputeId !== null) {
        fail();
      }
      if (row.kind === 'customer_refund') {
        if (row.accountScope !== 'connected' || row.accountId !== proof.application.accountId || row.applicationFeeId !== null) {
          fail();
        }
        totals.refund = total(totals.refund + value);
      } else {
        if (row.accountScope !== 'platform' || row.accountId !== null || !text(row.applicationFeeId)) {
          fail();
        }
        const fee = feeBindings.get(capture.id);
        if (fee !== undefined && fee !== row.applicationFeeId) {
          fail();
        }
        feeBindings.set(capture.id, row.applicationFeeId!);
        totals.fee = total(totals.fee + value);
      }
      if (totals.refund > capture.amountCents || totals.fee > capture.applicationFeeCents) {
        fail();
      }
      captureTotals.set(capture.id, totals);
    } else if (row.kind === 'dispute_withdrawal' || row.kind === 'dispute_reinstatement') {
      if (row.accountScope !== 'connected' || row.accountId !== proof.application.accountId || !text(row.disputeId)
        || row.operationId !== proof.application.operationId
        || row.applicationFeeId !== null || row.feeCents === null || row.netCents === null
        || amount(row.netCents) !== value - amount(row.feeCents)
        || (row.kind === 'dispute_withdrawal' ? value >= 0 : value <= 0)
        || Math.abs(value) > capture.amountCents) {
        fail();
      }
      const disputeKey = JSON.stringify([row.platformId, row.accountScope, row.accountId, row.mode, row.disputeId]);
      const group = disputes.get(disputeKey) ?? [];
      group.push(row);
      disputes.set(disputeKey, group);
    } else {
      fail();
    }
    if (time(row.occurredAt) < start || time(row.occurredAt) >= end) {
      continue;
    }
    if (input.currency !== 'CAD') {
      excludedForeignCurrencyEventCount++;
      continue;
    }
    if (row.kind === 'customer_refund') {
      refundedCents = total(refundedCents + value);
    } else if (row.kind === 'application_fee_refund') {
      feeRefundedCents = total(feeRefundedCents + value);
    } else {
      disputeWithdrawnCents = total(disputeWithdrawnCents + (row.kind === 'dispute_withdrawal' ? -value : 0));
      disputeReinstatedCents = total(disputeReinstatedCents + (row.kind === 'dispute_reinstatement' ? value : 0));
      disputeFeeCents = total(disputeFeeCents + row.feeCents!);
      disputeNetCents = total(disputeNetCents + row.netCents!);
    }
  }
  for (const group of disputes.values()) {
    const first = group[0]!;
    let withdrawn = 0;
    let reinstated = 0;
    // Withdrawals sort before reinstatements at an identical observed second.
    const chronological = [...group].sort((a, b) => time(a.occurredAt) - time(b.occurredAt)
      || (a.kind === b.kind ? 0 : a.kind === 'dispute_withdrawal' ? -1 : 1));
    for (const row of chronological) {
      if (row.applicationId !== first.applicationId || time(row.objectCreatedAt) !== time(first.objectCreatedAt)) {
        fail();
      }
      withdrawn = total(withdrawn + (row.kind === 'dispute_withdrawal' ? -row.amountCents : 0));
      reinstated = total(reinstated + (row.kind === 'dispute_reinstatement' ? row.amountCents : 0));
      if (reinstated > withdrawn || withdrawn > captures.get(row.captureId)!.amountCents) {
        fail();
      }
    }
  }
  // Each immutable batch names its entire ledger as of that material revision.
  // Later batches can add rows but cannot silently remove or rewrite prior cash.
  for (const batch of reconciliations.values()) {
    const expected = input.movements.filter((row) => {
      const original = reconciliations.get(row.reconciliationId)!;
      return row.applicationId === batch.applicationId && original.platformRevision <= batch.platformRevision;
    }).sort((a, b) => a.movementKeyHash.localeCompare(b.movementKeyHash));
    if (expected.length !== batch.movementEvidence.length) {
      fail();
    }
    batch.movementEvidence.forEach((entry, index) => {
      const row = expected[index]!;
      if (!object(entry) || Object.keys(entry).sort().join(',') !== 'fingerprint,id,movementKeyHash'
        || entry.id !== row.id || entry.movementKeyHash !== row.movementKeyHash || entry.fingerprint !== row.fingerprint
        || time(row.recordedAt) > time(batch.createdAt)) {
        fail();
      }
    });
  }
  let movementReconciliationRequired = false;
  for (const proof of evidence.values()) {
    const rows = input.movements.filter(row => row.applicationId === proof.application.id);
    const current = input.reconciliations.find(row => row.applicationId === proof.application.id && row.platformRevision === proof.currentPlatformRevision);
    if (!current && !(rows.length === 0 && proof.currentPlatformRevision === proof.application.platformRevision)) {
      movementReconciliationRequired = true;
    }
  }
  return { refundedCents, unallocatedRefundCents: refundedCents, feeRefundedCents, disputeWithdrawnCents, disputeReinstatedCents, disputeFeeCents, disputeNetCents, movementReconciliationRequired, excludedForeignCurrencyEventCount };
}
