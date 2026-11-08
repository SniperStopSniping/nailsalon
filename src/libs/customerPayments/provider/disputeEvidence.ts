import { createHash } from 'node:crypto';

import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';

import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';
import type { OfflineSignatureVerifier, ProviderFixtureConfig, VerifiedProviderReceipt } from './evidence';
import { assertVerifiedProviderReceipt, verifyOfflineProviderReceipt } from './evidence';

/** Signed expanded facts only; neither lifecycle status nor event name creates a transaction. */
export type DisputeBalanceTransactionEvidence = Readonly<{
  id: string;
  sourceId: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: 'cad';
  created: number;
  /** Availability date only; not occurrence chronology or monetary identity. */
  availableOn: number;
  status: 'pending' | 'available';
  type: 'adjustment';
  reportingCategory: 'dispute' | 'dispute_reversal';
}>;
function money(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_SUPPORTED_MINOR_UNIT_AMOUNT ? value : null;
}

export type VerifiedDisputeEvidence = Readonly<{
  version: 1;
  projectionVersion: 1;
  source: 'offline_signed_fixture_dispute';
  payloadDigest: string;
  eventId: string | null;
  eventType: string | null;
  receiptIdentity: string;
  endpointId: string;
  platformId: string;
  accountScope: 'platform' | 'connected';
  expectedAccountId: string | null;
  accountId: string | null;
  mode: 'test' | 'live' | 'unknown';
  apiVersion: string | null;
  receivedAt: string;
  disputeId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  status: 'warning_needs_response' | 'warning_under_review' | 'warning_closed' | 'needs_response' | 'under_review' | 'won' | 'lost' | null;
  amountCents: number | null;
  currency: string | null;
  eventCreated: number | null;
  objectCreated: number | null;
  balanceTransactions: readonly DisputeBalanceTransactionEvidence[];
  /** Discovery edges only, including invalid money. Never financial authority. */
  transactionReferences: readonly Readonly<{ id: string | null; sourceId: string | null }>[];
  transactionReferenceCoverage: 'complete' | 'incomplete' | 'overflow';
  /** Structural test evidence only, not operation matching or settlement authority. */
  classification: 'correlatable' | 'review';
  reviewReasons: readonly string[];
}>;

const verified = new WeakMap<object, VerifiedProviderReceipt>();
export function assertVerifiedDisputeEvidence(value: unknown, receipt?: VerifiedProviderReceipt): asserts value is VerifiedDisputeEvidence {
  const original = typeof value === 'object' && value !== null ? verified.get(value) : undefined;
  if (!original || (receipt !== undefined && original !== receipt)) {
    throw new Error('CUSTOMER_PAYMENT_DISPUTE_EVIDENCE_UNVERIFIED');
  }
  assertVerifiedProviderReceipt(original);
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function id(value: unknown, expression: RegExp, max = 255): string | null {
  return typeof value === 'string' && value.length <= max && !value.includes('_secret_') && expression.test(value) ? value : null;
}
function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 253402300799 ? value : null;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T | null {
  return typeof value === 'string' && choices.includes(value as T) ? value as T : null;
}

/**
 * Supplemental offline proof. Preserve the original receipt byte-for-byte in its
 * existing normalization;
original review classifications remain unchanged.
 * No raw payload, metadata, URLs, PII or secrets enter this projection. A separate
 * correlation step must bind operation and complete parent payment evidence.
 */
export async function verifyOfflineDisputeReceipt(
  input: { rawBody: Uint8Array;signature: string;receivedAt: Date },
  config: ProviderFixtureConfig,
  verifier: OfflineSignatureVerifier,
): Promise<{ receipt: VerifiedProviderReceipt;dispute: VerifiedDisputeEvidence }> {
  requireCustomerPaymentProviderFixtureEnabled();
  if (!(input.rawBody instanceof Uint8Array) || input.rawBody.byteLength === 0 || input.rawBody.byteLength > 1024 * 1024
    || !(input.receivedAt instanceof Date) || !Number.isSafeInteger(input.receivedAt.getTime())) {
    throw new Error('CUSTOMER_PAYMENT_DISPUTE_FIXTURE_INPUT_INVALID');
  }
  const raw = Uint8Array.from(input.rawBody);
  const fixedConfig = { ...config, expectedObject: config.expectedObject ? { ...config.expectedObject } : undefined };
  const fixedInput = { rawBody: raw, signature: input.signature, receivedAt: new Date(input.receivedAt.getTime()) };
  const receipt = await verifyOfflineProviderReceipt(fixedInput, fixedConfig, verifier);
  requireCustomerPaymentProviderFixtureEnabled();
  assertVerifiedProviderReceipt(receipt);
  if (receipt.payloadDigest !== createHash('sha256').update(raw).digest('hex')) {
    throw new Error('CUSTOMER_PAYMENT_DISPUTE_DIGEST_MISMATCH');
  }
  const reasons = new Set<string>();
  let event: Record<string, unknown> | null = null;
  try {
    event = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
  } catch {
    reasons.add('MALFORMED_AUTHENTICATED_PAYLOAD');
  }
  const entity = record(record(event?.data)?.object);
  const disputeId = id(entity?.id, /^dp_[A-Za-z0-9]+$/);
  const chargeId = id(entity?.charge, /^ch_[A-Za-z0-9]+$/);
  const paymentIntentId = id(entity?.payment_intent, /^pi_[A-Za-z0-9]+$/);
  const status = choice(entity?.status, ['warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost']);
  const amountCents = money(entity?.amount);
  const currency = id(entity?.currency, /^[a-z]{3}$/, 3);
  const eventCreated = seconds(event?.created);
  const objectCreated = seconds(entity?.created);
  if (event?.object !== 'event' || !receipt.eventId || !disputeId || entity?.object !== 'dispute'
    || !['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated'].includes(receipt.eventType ?? '')) {
    reasons.add('DISPUTE_IDENTITY_MISMATCH');
  }
  if (receipt.mode !== 'test' || entity?.livemode !== false) {
    reasons.add('DISPUTE_MODE_MISMATCH');
  }
  if (receipt.accountScope !== 'connected' || !receipt.accountId || receipt.accountId !== receipt.expectedAccountId || receipt.accountId === receipt.platformId) {
    reasons.add('DISPUTE_ACCOUNT_SCOPE_MISMATCH');
  }
  if (receipt.apiVersion !== fixedConfig.apiVersion || receipt.apiVersion !== '2024-06-20') {
    reasons.add('DISPUTE_API_VERSION_MISMATCH');
  }
  if (!status || (receipt.eventType === 'charge.dispute.closed' && !['lost', 'warning_closed', 'won'].includes(status))) {
    reasons.add('DISPUTE_STATE_REVIEW_REQUIRED');
  }
  if (!chargeId || !paymentIntentId) {
    reasons.add('DISPUTE_RELATIONSHIP_MISSING');
  }
  if (amountCents === null || amountCents <= 0 || currency !== 'cad') {
    reasons.add('DISPUTE_MONEY_REVIEW_REQUIRED');
  }
  if (eventCreated === null || objectCreated === null || objectCreated > eventCreated || eventCreated > Math.floor(Date.parse(receipt.receivedAt) / 1000)) {
    reasons.add('DISPUTE_TIME_REVIEW_REQUIRED');
  }
  const transactionReferences: Readonly<{ id: string | null; sourceId: string | null }>[] = [];
  let transactionReferenceCoverage: 'complete' | 'incomplete' | 'overflow' = 'complete';
  const rawTransactions = entity?.balance_transactions;
  if (!Array.isArray(rawTransactions)) {
    transactionReferenceCoverage = 'incomplete';
  } else {
    if (rawTransactions.length > 256) {
      transactionReferenceCoverage = 'overflow';
    }
    for (const rawTransaction of rawTransactions.slice(0, 256)) {
      const value = record(rawTransaction);
      const transactionId = id(typeof rawTransaction === 'string' ? rawTransaction : value?.id, /^txn_[A-Za-z0-9]+$/);
      const sourceId = id(value?.source, /^dp_[A-Za-z0-9]+$/);
      transactionReferences.push(Object.freeze({ id: transactionId, sourceId }));
      if ((!transactionId || !sourceId) && transactionReferenceCoverage !== 'overflow') {
        transactionReferenceCoverage = 'incomplete';
      }
    }
  }
  if (transactionReferenceCoverage !== 'complete') {
    reasons.add('DISPUTE_TRANSACTION_REFERENCE_COVERAGE_INCOMPLETE');
  }
  const balanceTransactions: DisputeBalanceTransactionEvidence[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(entity?.balance_transactions) || entity.balance_transactions.length > 2) {
    reasons.add('DISPUTE_BALANCE_DETAILS_UNSUPPORTED');
  } else {
    for (const rawBalance of entity.balance_transactions) {
      const value = record(rawBalance);
      const transactionId = id(value?.id, /^txn_[A-Za-z0-9]+$/);
      const sourceId = id(value?.source, /^dp_[A-Za-z0-9]+$/);
      const amount = money(value?.amount);
      const fee = money(value?.fee);
      const net = money(value?.net);
      const created = seconds(value?.created);
      const availableOn = seconds(value?.available_on);
      const balanceStatus = choice(value?.status, ['pending', 'available']);
      const reportingCategory = choice(value?.reporting_category, ['dispute', 'dispute_reversal']);
      if (value?.object !== 'balance_transaction' || !transactionId || !sourceId || sourceId !== disputeId || seen.has(transactionId)
        || amount === null || amount === 0 || fee === null || net === null || net !== amount - fee
        || value.currency !== 'cad' || value.exchange_rate !== null || value.type !== 'adjustment' || !reportingCategory || !balanceStatus
        || (reportingCategory === 'dispute' ? amount >= 0 : amount <= 0)
        || created === null || availableOn === null || objectCreated === null || eventCreated === null || created < objectCreated || created > eventCreated) {
        reasons.add('DISPUTE_BALANCE_DETAILS_UNSUPPORTED');
        continue;
      }
      seen.add(transactionId);
      balanceTransactions.push(Object.freeze({ id: transactionId, sourceId, amountCents: amount, feeCents: fee, netCents: net, currency: 'cad', created, availableOn, status: balanceStatus, type: 'adjustment', reportingCategory }));
    }
  }
  const expected = fixedConfig.expectedObject;
  if (expected && (expected.id !== disputeId || expected.type !== 'dispute'
    || (expected.chargeId !== undefined && expected.chargeId !== chargeId)
    || (expected.paymentIntentId !== undefined && expected.paymentIntentId !== paymentIntentId)
    || (expected.amountCents !== undefined && expected.amountCents !== amountCents)
    || (expected.currency !== undefined && expected.currency !== currency))) {
    reasons.add('DISPUTE_EXPECTATION_MISMATCH');
  }
  const dispute: VerifiedDisputeEvidence = Object.freeze({
    version: 1,
    projectionVersion: 1,
    source: 'offline_signed_fixture_dispute',
    payloadDigest: receipt.payloadDigest,
    eventId: receipt.eventId,
    eventType: receipt.eventType,
    receiptIdentity: receipt.receiptIdentity,
    endpointId: receipt.endpointId,
    platformId: receipt.platformId,
    accountScope: receipt.accountScope,
    expectedAccountId: receipt.expectedAccountId,
    accountId: receipt.accountId,
    mode: receipt.mode,
    apiVersion: receipt.apiVersion,
    receivedAt: receipt.receivedAt,
    disputeId,
    paymentIntentId,
    chargeId,
    status,
    amountCents,
    currency,
    eventCreated,
    objectCreated,
    balanceTransactions: Object.freeze(balanceTransactions),
    transactionReferences: Object.freeze(transactionReferences),
    transactionReferenceCoverage,
    classification: reasons.size === 0 ? 'correlatable' : 'review',
    reviewReasons: Object.freeze([...reasons].sort()),
  });
  verified.set(dispute, receipt);
  return { receipt, dispute };
}

/** Persistence requires this exact pair, never two independently deserialized shapes. */
export function assertVerifiedOfflineDisputeProjection(dispute: unknown, receipt: VerifiedProviderReceipt): asserts dispute is VerifiedDisputeEvidence {
  assertVerifiedProviderReceipt(receipt);
  assertVerifiedDisputeEvidence(dispute, receipt);
}
