import { createHash } from 'node:crypto';

import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';

import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';

type Facts = Readonly<Record<string, string | number | boolean | null>>;
export type ProviderFixtureConfig = {
  endpointId: string;
  platformId: string;
  accountScope: 'platform' | 'connected';
  expectedAccountId: string | null;
  apiVersion: string;
  livemode: false;
  /** Explicit offline fixture relationship expectation, never metadata-derived. */
  expectedObject?: { id: string; type: string; amountCents?: number; currency?: string; paymentIntentId?: string; chargeId?: string; applicationFeeId?: string; connectedAccountId?: string };
};
export type OfflineSignatureVerifier = (input: {
  rawBody: Uint8Array;
  signature: string;
  endpointId: string;
  platformId: string;
}) => boolean | Promise<boolean>;
export type VerifiedProviderReceipt = Readonly<{
  version: 1;
  source: 'offline_signed_fixture';
  endpointId: string;
  platformId: string;
  accountScope: 'platform' | 'connected';
  expectedAccountId: string | null;
  accountId: string | null;
  mode: 'test' | 'live' | 'unknown';
  eventId: string | null;
  receiptIdentity: string;
  eventType: string | null;
  apiVersion: string | null;
  objectId: string | null;
  payloadDigest: string;
  normalizedFacts: Facts;
  classification: 'accepted' | 'review';
  reviewReasons: readonly string[];
  receivedAt: string;
}>;

const verified = new WeakSet<object>();
/** In-memory authority only. Deserialization/casts cannot create verified receipts. */
export function assertVerifiedProviderReceipt(value: unknown): asserts value is VerifiedProviderReceipt {
  if (typeof value !== 'object' || value === null || !verified.has(value)) {
    throw new Error('CUSTOMER_PAYMENT_PROVIDER_RECEIPT_UNVERIFIED');
  }
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function identifier(value: unknown, prefix?: string): string | null {
  return typeof value === 'string' && value.length <= 255
    && /^\w+$/.test(value) && !value.includes('_secret_') && (!prefix || (value.startsWith(prefix) && /^[A-Z0-9]+$/i.test(value.slice(prefix.length))))
    ? value
    : null;
}
function relationship(value: unknown, prefix: string): string | null {
  // Expanded objects are intentionally unsupported at this narrow boundary.
  return identifier(value, prefix);
}
function money(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SUPPORTED_MINOR_UNIT_AMOUNT ? value : null;
}
const supported: Record<string, { object: string; prefix: string; amount: string; scope: 'platform' | 'connected' }> = {
  'payment_intent.succeeded': { object: 'payment_intent', prefix: 'pi_', amount: 'amount_received', scope: 'connected' },
  'charge.succeeded': { object: 'charge', prefix: 'ch_', amount: 'amount_captured', scope: 'connected' },
  'refund.created': { object: 'refund', prefix: 're_', amount: 'amount', scope: 'connected' },
  'refund.updated': { object: 'refund', prefix: 're_', amount: 'amount', scope: 'connected' },
  'application_fee.created': { object: 'application_fee', prefix: 'fee_', amount: 'amount', scope: 'platform' },
  'application_fee.refund.updated': { object: 'fee_refund', prefix: 'fr_', amount: 'amount', scope: 'platform' },
};

/**
 * Offline signed fixture boundary ONLY. A true verifier result proves solely the
 * injected fixture check. This receipt never proves a real payment, authorizes
 * settlement, or upgrades synthetic_test evidence. No provider/client is imported.
 * Authenticated unsupported/malformed facts are retained as review receipts.
 */
export async function verifyOfflineProviderReceipt(
  input: { rawBody: Uint8Array; signature: string; receivedAt: Date },
  config: ProviderFixtureConfig,
  verifier: OfflineSignatureVerifier,
): Promise<VerifiedProviderReceipt> {
  requireCustomerPaymentProviderFixtureEnabled();
  if (!(input.rawBody instanceof Uint8Array) || input.rawBody.byteLength === 0 || input.rawBody.byteLength > 1024 * 1024
    || typeof input.signature !== 'string' || input.signature.length === 0 || input.signature.length > 8192
    || !(input.receivedAt instanceof Date) || !Number.isSafeInteger(input.receivedAt.getTime())
    || !identifier(config.endpointId) || !identifier(config.platformId, 'acct_') || config.livemode !== false
    || !['platform', 'connected'].includes(config.accountScope)
    || (config.accountScope === 'platform' ? config.expectedAccountId !== null : !identifier(config.expectedAccountId, 'acct_'))
    || typeof config.apiVersion !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:\.[a-z]+)?$/.test(config.apiVersion)
    || typeof verifier !== 'function') {
    throw new Error('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_CONFIG_INVALID');
  }
  // Snapshot config and bytes before awaiting untrusted/asynchronous verifier work.
  const fixed = { ...config, expectedObject: config.expectedObject ? { ...config.expectedObject } : undefined };
  const raw = Uint8Array.from(input.rawBody);
  const receivedAt = input.receivedAt.toISOString();
  let authenticated = false;
  try {
    authenticated = await verifier({ rawBody: Uint8Array.from(raw), signature: input.signature, endpointId: fixed.endpointId, platformId: fixed.platformId }) === true;
  } catch {
    // Never leak signature/secret-bearing verifier exception text.
  }
  if (!authenticated) {
    throw new Error('CUSTOMER_PAYMENT_PROVIDER_SIGNATURE_INVALID');
  }
  requireCustomerPaymentProviderFixtureEnabled();
  const payloadDigest = createHash('sha256').update(raw).digest('hex');
  const reasons = new Set<string>();
  let event: Record<string, unknown> | null = null;
  try {
    event = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
  } catch {
    reasons.add('MALFORMED_AUTHENTICATED_PAYLOAD');
  }
  if (!event || event.object !== 'event') {
    reasons.add('INVALID_EVENT_ENVELOPE');
  }
  const eventId = identifier(event?.id, 'evt_');
  const eventType = typeof event?.type === 'string' && /^[a-z_]+(?:\.[a-z_]+)+$/.test(event.type) && event.type.length <= 120 ? event.type : null;
  const apiVersion = typeof event?.api_version === 'string' && /^\d{4}-\d{2}-\d{2}(?:\.[a-z]+)?$/.test(event.api_version) ? event.api_version : null;
  const mode = event?.livemode === false ? 'test' : event?.livemode === true ? 'live' : 'unknown';
  const accountId = identifier(event?.account, 'acct_');
  const entity = object(object(event?.data)?.object);
  const spec = eventType ? supported[eventType] : undefined;
  const objectType = identifier(entity?.object);
  const objectId = identifier(entity?.id, spec?.prefix);
  const actualObjectMode = typeof entity?.livemode === 'boolean' ? entity.livemode : null;
  if (!eventId || !eventType || !objectId || !objectType) {
    reasons.add('INVALID_OBJECT_IDENTITY');
  }
  if (apiVersion !== fixed.apiVersion) {
    reasons.add('API_VERSION_MISMATCH');
  }
  if (mode !== 'test' || actualObjectMode === true) {
    reasons.add('MODE_MISMATCH');
  }
  if (event?.account !== undefined && accountId === null) {
    reasons.add('INVALID_ACCOUNT_IDENTITY');
  }
  if (accountId !== fixed.expectedAccountId) {
    reasons.add('ACCOUNT_SCOPE_MISMATCH');
  }
  if (!spec || spec.object !== objectType || spec.scope !== fixed.accountScope) {
    reasons.add('UNSUPPORTED_EVENT_OR_OBJECT');
  }
  // Timestamps are seconds, not monetary cents; valid contemporary epoch values
  // exceed the currency limit, so validate them independently.
  const created = typeof event?.created === 'number' && Number.isSafeInteger(event.created) && event.created >= 0 ? event.created : null;
  if (created === null || created > Math.floor(Date.parse(receivedAt) / 1000)) {
    reasons.add('INVALID_EVENT_TIME');
  }
  const amountCents = spec ? money(entity?.[spec.amount]) : null;
  const currency = typeof entity?.currency === 'string' && /^[a-z]{3}$/.test(entity.currency) ? entity.currency : null;
  const status = typeof entity?.status === 'string' && /^[a-z_]{1,40}$/.test(entity.status) ? entity.status : null;
  const facts: Record<string, string | number | boolean | null> = {
    objectType,
    objectLivemode: actualObjectMode,
    created,
    amountCents,
    currency,
    status,
    objectAmountCents: money(entity?.amount),
    amountReceivedCents: money(entity?.amount_received),
    amountCapturedCents: money(entity?.amount_captured),
    amountRefundedCents: money(entity?.amount_refunded),
    paid: typeof entity?.paid === 'boolean' ? entity.paid : null,
    captured: typeof entity?.captured === 'boolean' ? entity.captured : null,
    paymentIntentId: relationship(entity?.payment_intent, 'pi_'),
    chargeId: relationship(entity?.charge ?? entity?.latest_charge, 'ch_'),
    applicationFeeId: relationship(entity?.fee ?? entity?.application_fee, 'fee_'),
    connectedAccountId: relationship(entity?.account, 'acct_'),
  };
  if (!amountCents || !currency) {
    reasons.add('INVALID_MONEY_FACTS');
  }
  if ((objectType === 'payment_intent' || objectType === 'refund') && status !== 'succeeded') {
    reasons.add('UNSUPPORTED_OBJECT_STATE');
  }
  if (objectType === 'charge' && (entity?.paid !== true || entity?.captured !== true)) {
    reasons.add('UNSUPPORTED_OBJECT_STATE');
  }
  if (['payment_intent', 'charge', 'application_fee'].includes(objectType ?? '') && actualObjectMode === null) {
    reasons.add('MISSING_OBJECT_MODE');
  }
  if (((objectType === 'payment_intent' || objectType === 'refund' || objectType === 'application_fee') && !facts.chargeId)
    || (objectType === 'charge' && !facts.paymentIntentId)
    || (objectType === 'fee_refund' && !facts.applicationFeeId)
    || (objectType === 'application_fee' && !facts.connectedAccountId)) {
    reasons.add('MISSING_RELATIONSHIP');
  }
  if (!fixed.expectedObject) {
    reasons.add('UNMATCHED_OBJECT');
  } else {
    if (fixed.expectedObject.id !== objectId || fixed.expectedObject.type !== objectType) {
      reasons.add('OBJECT_IDENTITY_MISMATCH');
    }
    if (money(fixed.expectedObject.amountCents) === null || !fixed.expectedObject.currency
      || !/^[a-z]{3}$/.test(fixed.expectedObject.currency)) {
      reasons.add('INSUFFICIENT_MONEY_EXPECTATION');
    } else if (fixed.expectedObject.amountCents !== amountCents || fixed.expectedObject.currency !== currency) {
      reasons.add('MONEY_IDENTITY_MISMATCH');
    }
    const requiredRelationships = objectType === 'charge'
      ? ['paymentIntentId'] as const
      : objectType === 'fee_refund'
        ? ['applicationFeeId'] as const
        : objectType === 'application_fee'
          ? ['chargeId', 'connectedAccountId'] as const
          : ['chargeId'] as const;
    for (const key of requiredRelationships) {
      if (!fixed.expectedObject[key]) {
        reasons.add('INSUFFICIENT_RELATIONSHIP_EXPECTATION');
      }
    }
    for (const key of ['paymentIntentId', 'chargeId', 'applicationFeeId', 'connectedAccountId'] as const) {
      if (fixed.expectedObject[key] !== undefined && fixed.expectedObject[key] !== facts[key]) {
        reasons.add('RELATIONSHIP_MISMATCH');
      }
    }
  }
  const receipt: VerifiedProviderReceipt = Object.freeze({
    version: 1,
    source: 'offline_signed_fixture',
    endpointId: fixed.endpointId,
    platformId: fixed.platformId,
    accountScope: fixed.accountScope,
    expectedAccountId: fixed.expectedAccountId,
    accountId,
    mode,
    eventId,
    receiptIdentity: eventId ?? `digest:${payloadDigest}`,
    eventType,
    apiVersion,
    objectId,
    payloadDigest,
    normalizedFacts: Object.freeze(facts),
    classification: reasons.size === 0 ? 'accepted' : 'review',
    reviewReasons: Object.freeze([...reasons].sort()),
    receivedAt,
  });
  verified.add(receipt);
  return receipt;
}
