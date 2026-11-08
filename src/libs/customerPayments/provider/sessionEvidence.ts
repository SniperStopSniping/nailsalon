import { createHash } from 'node:crypto';

import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';

import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';
import type { OfflineSignatureVerifier, ProviderFixtureConfig, VerifiedProviderReceipt } from './evidence';
import { assertVerifiedProviderReceipt, verifyOfflineProviderReceipt } from './evidence';

export type VerifiedCheckoutSessionEvidence = Readonly<{
  version: 1;
  projectionVersion: 1;
  source: 'offline_signed_fixture_session';
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
  sessionId: string | null;
  paymentIntentId: string | null;
  sessionMode: 'payment' | 'setup' | 'subscription' | null;
  status: 'open' | 'complete' | 'expired' | null;
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required' | null;
  amountTotalCents: number | null;
  currency: string | null;
  clientReferenceId: string | null;
  /**
 Bounded Unix seconds;
these are not local processing timestamps.
   */
  eventCreated: number | null;
  sessionCreated: number | null;
  expiresAt: number | null;
  /** Structural test evidence only, not operation matching or settlement authority. */
  classification: 'correlatable' | 'review';
  reviewReasons: readonly string[];
}>;

const verified = new WeakMap<object, VerifiedProviderReceipt>();
export function assertVerifiedCheckoutSessionEvidence(value: unknown, receipt?: VerifiedProviderReceipt): asserts value is VerifiedCheckoutSessionEvidence {
  const original = typeof value === 'object' && value !== null ? verified.get(value) : undefined;
  if (!original || (receipt !== undefined && original !== receipt)) {
    throw new Error('CUSTOMER_PAYMENT_SESSION_EVIDENCE_UNVERIFIED');
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
unsupported Checkout Session receipts remain review.
 * No raw payload, metadata, URLs, PII or secrets enter this projection. A separate
 * correlation step must bind operation, frozen quote and payment-intent evidence.
 */
export async function verifyOfflineCheckoutSessionReceipt(
  input: { rawBody: Uint8Array;signature: string;receivedAt: Date },
  config: ProviderFixtureConfig,
  verifier: OfflineSignatureVerifier,
): Promise<{ receipt: VerifiedProviderReceipt;session: VerifiedCheckoutSessionEvidence }> {
  requireCustomerPaymentProviderFixtureEnabled();
  if (!(input.rawBody instanceof Uint8Array) || input.rawBody.byteLength === 0 || input.rawBody.byteLength > 1024 * 1024
    || !(input.receivedAt instanceof Date) || !Number.isSafeInteger(input.receivedAt.getTime())) {
    throw new Error('CUSTOMER_PAYMENT_SESSION_FIXTURE_INPUT_INVALID');
  }
  const raw = Uint8Array.from(input.rawBody);
  const fixedConfig = { ...config, expectedObject: config.expectedObject ? { ...config.expectedObject } : undefined };
  const fixedInput = { rawBody: raw, signature: input.signature, receivedAt: new Date(input.receivedAt.getTime()) };
  const receipt = await verifyOfflineProviderReceipt(fixedInput, fixedConfig, verifier);
  requireCustomerPaymentProviderFixtureEnabled();
  assertVerifiedProviderReceipt(receipt);
  if (receipt.payloadDigest !== createHash('sha256').update(raw).digest('hex')) {
    throw new Error('CUSTOMER_PAYMENT_SESSION_DIGEST_MISMATCH');
  }
  const reasons = new Set<string>();
  let event: Record<string, unknown> | null = null;
  try {
    event = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
  } catch {
    reasons.add('MALFORMED_AUTHENTICATED_PAYLOAD');
  }
  const entity = record(record(event?.data)?.object);
  const sessionId = id(entity?.id, /^cs_(?:test|live)_[A-Za-z0-9]+$/);
  const paymentIntentId = id(entity?.payment_intent, /^pi_[A-Za-z0-9]+$/);
  const sessionMode = choice(entity?.mode, ['payment', 'setup', 'subscription']);
  const status = choice(entity?.status, ['open', 'complete', 'expired']);
  const paymentStatus = choice(entity?.payment_status, ['paid', 'unpaid', 'no_payment_required']);
  const amountTotalCents = typeof entity?.amount_total === 'number' && Number.isSafeInteger(entity.amount_total)
    && entity.amount_total > 0 && entity.amount_total <= MAX_SUPPORTED_MINOR_UNIT_AMOUNT
    ? entity.amount_total
    : null;
  const currency = id(entity?.currency, /^[a-z]{3}$/, 3);
  const clientReferenceId = id(entity?.client_reference_id, /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i, 36);
  const eventCreated = seconds(event?.created);
  const sessionCreated = seconds(entity?.created);
  const expiresAt = seconds(entity?.expires_at);
  if (event?.object !== 'event' || !receipt.eventId || !['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(receipt.eventType ?? '')
    || entity?.object !== 'checkout.session' || !sessionId) {
    reasons.add('SESSION_IDENTITY_MISMATCH');
  }
  if (receipt.mode !== 'test' || entity?.livemode !== false || !sessionId?.startsWith('cs_test_')) {
    reasons.add('SESSION_MODE_MISMATCH');
  }
  if (receipt.accountScope !== 'connected' || !receipt.accountId || receipt.accountId !== receipt.expectedAccountId
    || receipt.accountId === receipt.platformId) {
    reasons.add('SESSION_ACCOUNT_SCOPE_MISMATCH');
  }
  if (receipt.apiVersion !== fixedConfig.apiVersion || !receipt.apiVersion || receipt.apiVersion.length > 32) {
    reasons.add('SESSION_API_VERSION_MISMATCH');
  }
  if (sessionMode !== 'payment' || !status || !paymentStatus
    || (receipt.eventType === 'checkout.session.expired' ? status !== 'expired' || paymentStatus !== 'unpaid' : status !== 'complete')
    || (receipt.eventType === 'checkout.session.async_payment_succeeded' && paymentStatus !== 'paid')
    || (receipt.eventType === 'checkout.session.async_payment_failed' && paymentStatus !== 'unpaid')) {
    reasons.add('SESSION_STATE_REVIEW_REQUIRED');
  }
  if (!paymentIntentId || !clientReferenceId) {
    reasons.add('SESSION_RELATIONSHIP_MISSING');
  }
  if (amountTotalCents === null || currency !== 'cad') {
    reasons.add('SESSION_MONEY_REVIEW_REQUIRED');
  }
  if (eventCreated === null || sessionCreated === null || expiresAt === null
    || eventCreated > Math.floor(Date.parse(receipt.receivedAt) / 1000) || sessionCreated > eventCreated
    || expiresAt < sessionCreated || expiresAt > sessionCreated + 86400) {
    reasons.add('SESSION_TIME_REVIEW_REQUIRED');
  }
  const expected = fixedConfig.expectedObject;
  if (expected && (expected.id !== sessionId || expected.type !== 'checkout.session'
    || (expected.paymentIntentId !== undefined && expected.paymentIntentId !== paymentIntentId)
    || (expected.amountCents !== undefined && expected.amountCents !== amountTotalCents)
    || (expected.currency !== undefined && expected.currency !== currency))) {
    reasons.add('SESSION_EXPECTATION_MISMATCH');
  }
  const session: VerifiedCheckoutSessionEvidence = Object.freeze({
    version: 1,
    projectionVersion: 1,
    source: 'offline_signed_fixture_session',
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
    sessionId,
    paymentIntentId,
    sessionMode,
    status,
    paymentStatus,
    amountTotalCents,
    currency,
    clientReferenceId,
    eventCreated,
    sessionCreated,
    expiresAt,
    classification: reasons.size === 0 ? 'correlatable' : 'review',
    reviewReasons: Object.freeze([...reasons].sort()),
  });
  verified.set(session, receipt);
  return { receipt, session };
}

/** Persistence requires this exact pair, never two independently deserialized shapes. */
export function assertVerifiedOfflineSessionProjection(session: unknown, receipt: VerifiedProviderReceipt): asserts session is VerifiedCheckoutSessionEvidence {
  assertVerifiedProviderReceipt(receipt);
  assertVerifiedCheckoutSessionEvidence(session, receipt);
}
