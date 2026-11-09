import 'server-only';

import { createHash } from 'node:crypto';

import Stripe from 'stripe';
import { z } from 'zod';

const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
const identifier = z.string().regex(/^\w+$/).max(255);
const envelope = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9]+$/).max(200),
  object: z.literal('event'),
  account,
  api_version: z.string().max(80),
  livemode: z.boolean(),
  type: z.string().max(100),
  created: z.number().int().nonnegative(),
  data: z.object({ object: z.object({ id: identifier, object: z.string().max(100) }).passthrough() }),
});

export type StripeCustomerPaymentSigningBinding = {
  /** Supplied by trusted endpoint configuration, never request data. */
  endpointId: string;
  platformAccountId: string;
  livemode: boolean;
  apiVersion: '2024-06-20';
  signingSecret: string;
};

type Receipt = Readonly<{
  source: 'stripe_signature_verified';
  endpointId: string;
  platformAccountId: string;
  accountId: string;
  livemode: boolean;
  eventId: string;
  eventType: string;
  occurredAt: number;
  receivedAt: number;
  payloadDigest: string;
  objectId: string;
  objectType: string;
  apiVersion: string;
  disposition: 'candidate' | 'review';
  reviewReason: 'API_VERSION_MISMATCH' | 'UNSUPPORTED_OBJECT' | null;
  facts: Readonly<Record<string, string | number | boolean | null>>;
  /** Signature validity alone never grants settlement or refund authority. */
  financialPostingAllowed: false;
}>;

const receipts = new WeakSet<object>();

export class StripeCustomerPaymentReceiptError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'StripeCustomerPaymentReceiptError';
  }
}

function reject(code: string): never {
  throw new StripeCustomerPaymentReceiptError(code);
}

/**
 * Real Stripe signature protocol boundary. This is deliberately independent of
 * collection enablement: stopping new requests must not discard existing money.
 * Persist the receipt before any consumer acknowledges it. The journal must bind
 * the Session/Intent/Charge and saved operation before financial projection.
 */
export function verifyStripeCustomerPaymentReceipt(
  rawBody: Uint8Array,
  signature: string,
  binding: StripeCustomerPaymentSigningBinding,
  receivedAt = Date.now(),
): Receipt {
  if (!/^we_[A-Za-z0-9]+$/.test(binding.endpointId)
    || !account.safeParse(binding.platformAccountId).success
    || typeof binding.livemode !== 'boolean'
    || binding.apiVersion !== '2024-06-20'
    || !/^whsec_[A-Za-z0-9]{16,}$/.test(binding.signingSecret)
    || !Number.isSafeInteger(receivedAt) || receivedAt < 0) {
    return reject('STRIPE_RECEIPT_INVALID_CONFIGURATION');
  }
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength === 0 || rawBody.byteLength > 512 * 1024
    || typeof signature !== 'string' || signature.length > 8192) {
    return reject('STRIPE_RECEIPT_INVALID_INPUT');
  }
  // The pinned SDK accepts future timestamps; additionally bound both directions.
  const timestamps = signature.split(',').filter(value => value.startsWith('t='));
  const timestamp = timestamps.length === 1 && /^t=(?:0|[1-9]\d{0,12})$/.test(timestamps[0]!)
    ? Number(timestamps[0]!.slice(2))
    : Number.NaN;
  const age = Math.floor(receivedAt / 1000) - timestamp;
  if (!Number.isSafeInteger(timestamp) || age > 300 || age < -5) {
    return reject('STRIPE_RECEIPT_SIGNATURE_INVALID');
  }
  let event: unknown;
  try {
    // Reject non-UTF-8 before the SDK converts bytes to a string for verification.
    new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    event = Stripe.webhooks.constructEvent(Buffer.from(rawBody), signature, binding.signingSecret, 300, undefined, receivedAt);
  } catch {
    return reject('STRIPE_RECEIPT_SIGNATURE_INVALID');
  }
  const parsed = envelope.safeParse(event);
  if (!parsed.success) {
    return reject('STRIPE_RECEIPT_ENVELOPE_INVALID');
  }
  const value = parsed.data;
  if (value.livemode !== binding.livemode || value.account === binding.platformAccountId) {
    return reject('STRIPE_RECEIPT_SCOPE_MISMATCH');
  }
  const object = value.data.object;
  const supported: Record<string, string> = {
    'checkout.session.completed': 'checkout.session',
    'checkout.session.expired': 'checkout.session',
    'checkout.session.async_payment_succeeded': 'checkout.session',
    'checkout.session.async_payment_failed': 'checkout.session',
    'payment_intent.succeeded': 'payment_intent',
    'payment_intent.payment_failed': 'payment_intent',
    'charge.succeeded': 'charge',
    'charge.refunded': 'charge',
    'refund.created': 'refund',
    'refund.updated': 'refund',
    'refund.failed': 'refund',
  };
  const reviewReason = value.api_version !== binding.apiVersion
    ? 'API_VERSION_MISMATCH' as const
    : supported[value.type] !== object.object ? 'UNSUPPORTED_OBJECT' as const : null;
  // Retain only money/correlation facts. Never retain customer/card/address data,
  // arbitrary metadata, checkout URLs, signatures or signing secrets.
  const facts: Record<string, string | number | boolean | null> = {};
  for (const key of ['amount', 'amount_total', 'amount_subtotal', 'amount_received', 'amount_captured', 'amount_refunded', 'application_fee_amount', 'created', 'expires_at']) {
    const field = object[key];
    if (field === null || (typeof field === 'number' && Number.isSafeInteger(field) && field >= 0)) {
      facts[key] = field;
    }
  }
  for (const key of ['currency', 'status', 'payment_status', 'capture_method', 'mode']) {
    const field = object[key];
    if (typeof field === 'string' && /^[a-z_]{1,80}$/.test(field)) {
      facts[key] = field;
    }
  }
  for (const key of ['livemode', 'paid', 'captured', 'refunded']) {
    if (typeof object[key] === 'boolean') {
      facts[key] = object[key];
    }
  }
  for (const key of ['payment_intent', 'latest_charge', 'charge', 'application_fee']) {
    const field = object[key];
    const id = typeof field === 'object' && field !== null && 'id' in field ? field.id : field;
    if (id === null || (typeof id === 'string' && /^(?:pi|ch|fee)_[A-Za-z0-9]+$/.test(id))) {
      facts[key] = id;
    }
  }
  const result: Receipt = Object.freeze({
    source: 'stripe_signature_verified',
    endpointId: binding.endpointId,
    platformAccountId: binding.platformAccountId,
    accountId: value.account,
    livemode: value.livemode,
    eventId: value.id,
    eventType: value.type,
    occurredAt: value.created * 1000,
    receivedAt,
    payloadDigest: createHash('sha256').update(rawBody).digest('hex'),
    objectId: object.id,
    objectType: object.object,
    apiVersion: value.api_version,
    disposition: reviewReason === null ? 'candidate' : 'review',
    reviewReason,
    facts: Object.freeze(facts),
    financialPostingAllowed: false,
  });
  receipts.add(result);
  return result;
}

/** Ingress must receive the actual verified value, not JSON claiming provenance. */
export function assertVerifiedStripeCustomerPaymentReceipt(value: unknown): asserts value is Receipt {
  if (typeof value !== 'object' || value === null || !receipts.has(value)) {
    reject('STRIPE_RECEIPT_PROVENANCE_REQUIRED');
  }
}
