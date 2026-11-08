import { createHash } from 'node:crypto';

import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';

import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';
import type { OfflineSignatureVerifier, ProviderFixtureConfig, VerifiedProviderReceipt } from './evidence';
import { assertVerifiedProviderReceipt, verifyOfflineProviderReceipt } from './evidence';

export type VerifiedRefundEvidence = Readonly<{
  version: 1;
  projectionVersion: 1;
  source: 'offline_signed_fixture_refund';
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
  kind: 'customer_refund' | 'application_fee_refund' | null;
  movementId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  applicationFeeId: string | null;
  status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled' | null;
  outcome: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled' | 'fee_return_observed' | null;
  amountCents: number | null;
  currency: string | null;
  eventCreated: number | null;
  objectCreated: number | null;
  /** Structural test evidence only, not operation matching or settlement authority. */
  classification: 'correlatable' | 'review';
  reviewReasons: readonly string[];
}>;

const verified = new WeakMap<object, VerifiedProviderReceipt>();
export function assertVerifiedRefundEvidence(value: unknown, receipt?: VerifiedProviderReceipt): asserts value is VerifiedRefundEvidence {
  const original = typeof value === 'object' && value !== null ? verified.get(value) : undefined;
  if (!original || (receipt !== undefined && original !== receipt)) {
    throw new Error('CUSTOMER_PAYMENT_REFUND_EVIDENCE_UNVERIFIED');
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
export async function verifyOfflineRefundReceipt(
  input: { rawBody: Uint8Array;signature: string;receivedAt: Date },
  config: ProviderFixtureConfig,
  verifier: OfflineSignatureVerifier,
): Promise<{ receipt: VerifiedProviderReceipt;refund: VerifiedRefundEvidence }> {
  requireCustomerPaymentProviderFixtureEnabled();
  if (!(input.rawBody instanceof Uint8Array) || input.rawBody.byteLength === 0 || input.rawBody.byteLength > 1024 * 1024
    || !(input.receivedAt instanceof Date) || !Number.isSafeInteger(input.receivedAt.getTime())) {
    throw new Error('CUSTOMER_PAYMENT_REFUND_FIXTURE_INPUT_INVALID');
  }
  const raw = Uint8Array.from(input.rawBody);
  const fixedConfig = { ...config, expectedObject: config.expectedObject ? { ...config.expectedObject } : undefined };
  const fixedInput = { rawBody: raw, signature: input.signature, receivedAt: new Date(input.receivedAt.getTime()) };
  const receipt = await verifyOfflineProviderReceipt(fixedInput, fixedConfig, verifier);
  requireCustomerPaymentProviderFixtureEnabled();
  assertVerifiedProviderReceipt(receipt);
  if (receipt.payloadDigest !== createHash('sha256').update(raw).digest('hex')) {
    throw new Error('CUSTOMER_PAYMENT_REFUND_DIGEST_MISMATCH');
  }
  const reasons = new Set<string>();
  let event: Record<string, unknown> | null = null;
  try {
    event = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
  } catch {
    reasons.add('MALFORMED_AUTHENTICATED_PAYLOAD');
  }
  const entity = record(record(event?.data)?.object);
  const kind = entity?.object === 'refund' ? 'customer_refund' : entity?.object === 'fee_refund' ? 'application_fee_refund' : null;
  const movementId = id(entity?.id, kind === 'customer_refund' ? /^re_[A-Za-z0-9]+$/ : /^fr_[A-Za-z0-9]+$/);
  const paymentIntentId = id(entity?.payment_intent, /^pi_[A-Za-z0-9]+$/);
  const chargeId = id(entity?.charge, /^ch_[A-Za-z0-9]+$/);
  const applicationFeeId = id(entity?.fee, /^fee_[A-Za-z0-9]+$/);
  const status = kind === 'customer_refund' ? choice(entity?.status, ['pending', 'requires_action', 'succeeded', 'failed', 'canceled']) : null;
  const outcome = kind === 'application_fee_refund' ? 'fee_return_observed' : status;
  const amountCents = typeof entity?.amount === 'number' && Number.isSafeInteger(entity.amount)
    && entity.amount > 0 && entity.amount <= MAX_SUPPORTED_MINOR_UNIT_AMOUNT
    ? entity.amount
    : null;
  const currency = id(entity?.currency, /^[a-z]{3}$/, 3);
  const eventCreated = seconds(event?.created);
  const objectCreated = seconds(entity?.created);
  if (event?.object !== 'event' || !receipt.eventId || !movementId || !kind
    || (kind === 'customer_refund' ? !['refund.created', 'refund.updated', 'refund.failed'].includes(receipt.eventType ?? '') : receipt.eventType !== 'application_fee.refund.updated')) {
    reasons.add('REFUND_IDENTITY_MISMATCH');
  }
  if (receipt.mode !== 'test' || (entity?.livemode !== undefined && entity.livemode !== false)) {
    reasons.add('REFUND_MODE_MISMATCH');
  }
  if (kind === 'customer_refund'
    ? receipt.accountScope !== 'connected' || !receipt.accountId || receipt.accountId !== receipt.expectedAccountId || receipt.accountId === receipt.platformId
    : receipt.accountScope !== 'platform' || receipt.accountId !== null || receipt.expectedAccountId !== null) {
    reasons.add('REFUND_ACCOUNT_SCOPE_MISMATCH');
  }
  if (receipt.apiVersion !== fixedConfig.apiVersion || !receipt.apiVersion || receipt.apiVersion.length > 32) {
    reasons.add('REFUND_API_VERSION_MISMATCH');
  }
  if (kind === 'customer_refund' ? !status || (receipt.eventType === 'refund.failed' && status !== 'failed') : entity?.status !== undefined) {
    reasons.add('REFUND_STATE_REVIEW_REQUIRED');
  }
  if (kind === 'customer_refund' ? !chargeId || !paymentIntentId : !applicationFeeId) {
    reasons.add('REFUND_RELATIONSHIP_MISSING');
  }
  if ((entity?.charge !== undefined && !chargeId) || (entity?.payment_intent !== undefined && !paymentIntentId)
    || (entity?.fee !== undefined && !applicationFeeId)) {
    reasons.add('REFUND_RELATIONSHIP_MALFORMED');
  }
  if (amountCents === null || currency !== 'cad') {
    reasons.add('REFUND_MONEY_REVIEW_REQUIRED');
  }
  if (eventCreated === null || objectCreated === null || objectCreated > eventCreated || eventCreated > Math.floor(Date.parse(receipt.receivedAt) / 1000)) {
    reasons.add('REFUND_TIME_REVIEW_REQUIRED');
  }
  const expected = fixedConfig.expectedObject;
  if (expected && (expected.id !== movementId || expected.type !== entity?.object
    || (expected.chargeId !== undefined && expected.chargeId !== chargeId)
    || (expected.paymentIntentId !== undefined && expected.paymentIntentId !== paymentIntentId)
    || (expected.applicationFeeId !== undefined && expected.applicationFeeId !== applicationFeeId)
    || (expected.amountCents !== undefined && expected.amountCents !== amountCents)
    || (expected.currency !== undefined && expected.currency !== currency))) {
    reasons.add('REFUND_EXPECTATION_MISMATCH');
  }
  const refund: VerifiedRefundEvidence = Object.freeze({
    version: 1,
    projectionVersion: 1,
    source: 'offline_signed_fixture_refund',
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
    kind,
    movementId,
    paymentIntentId,
    chargeId,
    applicationFeeId,
    status,
    outcome,
    amountCents,
    currency,
    eventCreated,
    objectCreated,
    classification: reasons.size === 0 ? 'correlatable' : 'review',
    reviewReasons: Object.freeze([...reasons].sort()),
  });
  verified.set(refund, receipt);
  return { receipt, refund };
}

/** Persistence requires this exact pair, never two independently deserialized shapes. */
export function assertVerifiedOfflineRefundProjection(refund: unknown, receipt: VerifiedProviderReceipt): asserts refund is VerifiedRefundEvidence {
  assertVerifiedProviderReceipt(receipt);
  assertVerifiedRefundEvidence(refund, receipt);
}
