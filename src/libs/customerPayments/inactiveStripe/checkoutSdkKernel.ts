import 'server-only';

import Stripe from 'stripe';
import { z } from 'zod';

import type { InactiveStripeCheckoutBinding, InactiveStripeCheckoutOperation } from './checkoutContract';
import { checkoutAdapterError, INACTIVE_STRIPE_API_VERSION, requireInactiveStripeCheckoutRuntime, stripeAccountIdSchema } from './checkoutContract';

const accountSchema = z.object({ id: stripeAccountIdSchema, object: z.literal('account') });
const connectedAccountScopeSchema = accountSchema.extend({
  country: z.literal('CA'),
  default_currency: z.literal('cad'),
  controller: z.object({
    stripe_dashboard: z.object({ type: z.literal('full') }),
    fees: z.object({ payer: z.literal('account') }),
    losses: z.object({ payments: z.literal('stripe') }),
    requirement_collection: z.literal('stripe'),
  }),
});
const connectedAccountCreationSchema = connectedAccountScopeSchema.extend({
  charges_enabled: z.literal(true),
  payouts_enabled: z.literal(true),
  details_submitted: z.literal(true),
  capabilities: z.object({ card_payments: z.literal('active') }),
  requirements: z.object({
    disabled_reason: z.null(),
    currently_due: z.array(z.unknown()).length(0),
    past_due: z.array(z.unknown()).length(0),
    pending_verification: z.array(z.unknown()).length(0),
    errors: z.array(z.unknown()).length(0).nullable(),
  }),
});
// Stripe Account has no livemode property. Balance and payment objects do.
const balanceSchema = z.object({ object: z.literal('balance'), livemode: z.literal(false) });

/** Shared SDK request/response contract only. The caller owns send authorization. */
export function createInactiveStripeCheckoutSdkKernel(binding: InactiveStripeCheckoutBinding, testSecretKey: string, httpClient: Stripe.HttpClient) {
  requireInactiveStripeCheckoutRuntime();
  if (!httpClient || typeof httpClient.makeRequest !== 'function' || typeof httpClient.getClientName !== 'function') {
    return checkoutAdapterError('SDK_HTTP_CLIENT_REQUIRED');
  }
  const client = new Stripe(testSecretKey, {
    apiVersion: INACTIVE_STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    timeout: 10000,
    telemetry: false,
    httpClient,
  });
  const options = (connected = false): Stripe.RequestOptions => ({
    apiVersion: INACTIVE_STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    ...(connected ? { stripeAccount: binding.connectedAccountId } : {}),
  });
  function responseScope(response: { lastResponse?: Stripe.Response<unknown>['lastResponse'] }, connected: boolean, idempotencyKey?: string) {
    const context = response.lastResponse;
    if (!context || context.statusCode !== 200
      || (context.apiVersion !== undefined && context.apiVersion !== INACTIVE_STRIPE_API_VERSION)
      || (context.stripeAccount !== undefined && context.stripeAccount !== (connected ? binding.connectedAccountId : binding.platformAccountId))
      || (idempotencyKey !== undefined && context.idempotencyKey !== undefined && context.idempotencyKey !== idempotencyKey)) {
      checkoutAdapterError('RESPONSE_SCOPE_MISMATCH');
    }
  }
  async function preflight(purpose: 'create' | 'reconcile'): Promise<void> {
    requireInactiveStripeCheckoutRuntime();
    const platform = await client.accounts.retrieve({}, options());
    requireInactiveStripeCheckoutRuntime();
    responseScope(platform, false);
    if (!accountSchema.safeParse(platform).success || platform.id !== binding.platformAccountId) {
      checkoutAdapterError('PLATFORM_MISMATCH');
    }
    const platformBalance = await client.balance.retrieve({}, options());
    requireInactiveStripeCheckoutRuntime();
    responseScope(platformBalance, false);
    if (!balanceSchema.safeParse(platformBalance).success) {
      checkoutAdapterError('PLATFORM_MODE_MISMATCH');
    }
    const connected = await client.accounts.retrieve(binding.connectedAccountId, {}, options());
    requireInactiveStripeCheckoutRuntime();
    responseScope(connected, false);
    if (!connectedAccountScopeSchema.safeParse(connected).success || connected.id !== binding.connectedAccountId) {
      checkoutAdapterError('CONNECTED_ACCOUNT_SCOPE_MISMATCH');
    }
    // Existing money must remain inspectable if readiness changes after checkout creation.
    // This does not relax provider authorization, account/controller scope or actual test mode.
    if (purpose === 'create' && !connectedAccountCreationSchema.safeParse(connected).success) {
      checkoutAdapterError('CONNECTED_ACCOUNT_NOT_READY');
    }
    const connectedBalance = await client.balance.retrieve({}, options(true));
    requireInactiveStripeCheckoutRuntime();
    responseScope(connectedBalance, true);
    if (!balanceSchema.safeParse(connectedBalance).success) {
      checkoutAdapterError('CONNECTED_MODE_MISMATCH');
    }
  }
  return Object.freeze({
    preflight,
    responseScope,
    create: (operation: InactiveStripeCheckoutOperation) => client.checkout.sessions.create(structuredClone(operation.params), { ...options(true), idempotencyKey: operation.idempotencyKey }),
    retrieve: (sessionId: string) => client.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] }, options(true)),
  });
}
