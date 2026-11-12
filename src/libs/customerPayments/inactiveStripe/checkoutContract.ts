import { createHash } from 'node:crypto';

import type Stripe from 'stripe';
import { z } from 'zod';

import type { CustomerPaymentQuoteInput } from '../money';
import { calculatePaymentSnapshot } from '../money';

export const INACTIVE_STRIPE_API_VERSION = '2024-06-20';
export const INACTIVE_STRIPE_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;

export function checkoutAdapterError(code: string): never {
  throw new Error(`INACTIVE_STRIPE_CHECKOUT_${code}`);
}

/** An explicit test runtime is mandatory. This is not a production feature flag. */
export function requireInactiveStripeCheckoutRuntime(): void {
  if (process.env.NODE_ENV !== 'test'
    || !['', 'development', 'preview', 'test'].includes(process.env.APP_ENV ?? '')
    || !['', 'development', 'preview'].includes(process.env.VERCEL_ENV ?? '')
    || (process.env.VERCEL === '1' && !process.env.VERCEL_ENV)) {
    checkoutAdapterError('RUNTIME_DISABLED');
  }
}

const identifier = z.string().min(1).max(200).regex(/^[\w-]+$/).refine(value => value.trim() === value);
export const stripeAccountIdSchema = z.string().max(200).regex(/^acct_[A-Za-z0-9]+$/).refine(value => value.trim() === value);
const cents = z.number().int().min(0).max(50_000_000);
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
const returnUrl = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash
    && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
});
export const checkoutBindingSchema = z.object({
  platformAccountId: stripeAccountIdSchema,
  connectedAccountId: stripeAccountIdSchema,
  mode: z.literal('test'),
  returnOrigin: returnUrl.refine(value => new URL(value).origin === value),
}).strict().refine(value => value.platformAccountId !== value.connectedAccountId);
export type InactiveStripeCheckoutBinding = z.infer<typeof checkoutBindingSchema>;

const inputSchema = z.object({
  operationId: z.string().uuid(),
  requestId: z.string().uuid(),
  salonId: identifier,
  appointmentId: identifier,
  quoteId: z.string().uuid(),
  contextHash: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  createdAt: timestamp,
  quoteExpiresAt: timestamp,
  /** Separate provider Session lifetime, never an extension of quote/booking authority. */
  sessionExpiresAt: timestamp,
  successUrl: returnUrl,
  cancelUrl: returnUrl,
  quote: z.object({
    currency: z.literal('cad'),
    servicesCents: cents,
    discountCents: cents,
    taxCents: cents,
    tipCents: cents,
    collection: z.enum(['full', 'deposit']),
    depositCents: cents.optional(),
    // Explicit experimental policy. It does not approve commercial fee terms.
    feePolicy: z.object({
      payer: z.literal('salon'),
      feeCents: cents.max(10000),
      taxTreatment: z.literal('not_collected_in_test_mode'),
      refundPolicy: z.literal('proportional').optional(),
    }).strict(),
  }).strict(),
}).strict();
export type InactiveStripeCheckoutInput = z.infer<typeof inputSchema>;

export function freezeCheckoutValue<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeCheckoutValue);
    Object.freeze(value);
  }
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/** Pure construction only. The caller must independently supply authoritative quote material. */
export function buildInactiveStripeCheckoutOperation(input: InactiveStripeCheckoutInput, binding: InactiveStripeCheckoutBinding) {
  const checked = inputSchema.safeParse(input);
  const scope = checkoutBindingSchema.safeParse(binding);
  if (!checked.success || !scope.success) {
    return checkoutAdapterError('INVALID_OPERATION');
  }
  const material = checked.data;
  if (material.quoteExpiresAt <= material.createdAt || material.quoteExpiresAt > material.createdAt + 5 * 60 * 1000
    || material.sessionExpiresAt % 1000 !== 0
    || material.sessionExpiresAt < material.quoteExpiresAt + 30 * 60 * 1000
    || material.sessionExpiresAt > material.createdAt + 24 * 60 * 60 * 1000
    || new URL(material.successUrl).origin !== scope.data.returnOrigin
    || new URL(material.cancelUrl).origin !== scope.data.returnOrigin) {
    return checkoutAdapterError('INVALID_QUOTE_CONTEXT');
  }
  const snapshot = calculatePaymentSnapshot(material.quote satisfies CustomerPaymentQuoteInput);
  if (snapshot.chargeCents <= 0 || snapshot.chargeCents > 50_000_000 || snapshot.serviceTotalCents <= 0) {
    return checkoutAdapterError('INVALID_AMOUNT');
  }
  const params = {
    mode: 'payment',
    payment_method_types: ['card'],
    client_reference_id: material.quoteId,
    success_url: material.successUrl,
    cancel_url: material.cancelUrl,
    expires_at: material.sessionExpiresAt / 1000,
    // All tax and optional tip are already frozen in the authoritative snapshot.
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    line_items: [{ quantity: 1, price_data: {
      currency: snapshot.currency,
      unit_amount: snapshot.chargeCents,
      product_data: { name: snapshot.collection === 'deposit' ? 'Appointment deposit and optional tip' : 'Appointment payment and optional tip' },
    } }],
    payment_intent_data: { ...(snapshot.applicationFeeCents > 0 ? { application_fee_amount: snapshot.applicationFeeCents } : {}), capture_method: 'automatic' },
    expand: ['payment_intent.latest_charge'],
  } satisfies Stripe.Checkout.SessionCreateParams;
  const parameterHash = digest(params);
  const identityHash = digest({ version: 1, binding: scope.data, material, snapshot, parameterHash });
  return freezeCheckoutValue({
    kind: 'unregistered_stripe_test_checkout' as const,
    financialPostingAllowed: false as const,
    binding: scope.data,
    material,
    snapshot,
    params,
    parameterHash,
    identityHash,
    idempotencyKey: `cpay_stripe_test_${identityHash}`,
  });
}
export type InactiveStripeCheckoutOperation = ReturnType<typeof buildInactiveStripeCheckoutOperation>;

export function assertInactiveStripeCheckoutOperation(operation: InactiveStripeCheckoutOperation): void {
  const expected = buildInactiveStripeCheckoutOperation(operation.material, operation.binding);
  if (canonical(operation) !== canonical(expected)) {
    checkoutAdapterError('IMMUTABLE_IDENTITY_MISMATCH');
  }
}
