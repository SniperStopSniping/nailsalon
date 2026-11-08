import type Stripe from 'stripe';

import type { CustomerPaymentQuoteInput } from './money';
import { calculatePaymentSnapshot } from './money';
import type { CustomerPaymentChoice, CustomerPaymentMode, CustomerPaymentsRuntime } from './policy';
import { assertCustomerPaymentsRuntime, resolvePaymentChoice } from './policy';

export type CustomerPaymentCheckoutInput = {
  runtime: CustomerPaymentsRuntime;
  policy: {
    mode: CustomerPaymentMode;
    choice: CustomerPaymentChoice;
    requiredDepositCents?: number;
  };
  quote: Omit<CustomerPaymentQuoteInput, 'collection' | 'depositCents'>;
  /** Must come from the salon's verified server-side Connect binding. */
  stripeAccountId: string;
  /** Persist with a unique payment attempt; reuse only for that exact attempt. */
  idempotencyKey: string;
  referenceId: string;
  successUrl: string;
  cancelUrl: string;
};

function assertReturnUrl(value: string): void {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || url.username || url.password) {
    throw new Error('INVALID_CHECKOUT_RETURN_URL');
  }
}

/**
 * Pure construction, never contacts Stripe. Runtime/configuration/quote/URLs must
 * come from authenticated server state. The future integration must validate the
 * actual Stripe client and account are test mode, persist this snapshot before
 * calling Stripe, and settle only via verified idempotent payment webhooks.
 */
export function buildCustomerPaymentCheckout(input: CustomerPaymentCheckoutInput) {
  assertCustomerPaymentsRuntime(input.runtime);
  const collection = resolvePaymentChoice(input.policy);
  const snapshot = calculatePaymentSnapshot({
    ...input.quote,
    collection,
    depositCents: collection === 'deposit' ? input.policy.requiredDepositCents : undefined,
  });
  if (collection === 'offline' || snapshot.chargeCents === 0) {
    throw new Error('NO_ONLINE_PAYMENT_DUE');
  }
  if (!/^acct_[A-Z0-9]+$/i.test(input.stripeAccountId)
    || !input.idempotencyKey.trim() || input.idempotencyKey.length > 255
    || !input.referenceId.trim() || input.referenceId.length > 200) {
    throw new Error('INVALID_CHECKOUT_IDENTITY');
  }
  assertReturnUrl(input.successUrl);
  assertReturnUrl(input.cancelUrl);
  const metadata = {
    customer_payment_reference: input.referenceId,
    customer_payment_snapshot_version: String(snapshot.version),
    customer_payment_collection: snapshot.collection,
  };
  // A direct connected-account charge: no transfer_data or processing fee
  // estimate. Card includes eligible Apple Pay through Stripe-hosted Checkout.
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    client_reference_id: input.referenceId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: snapshot.currency,
        unit_amount: snapshot.chargeCents,
        product_data: { name: collection === 'deposit' ? 'Appointment deposit and optional tip' : 'Appointment payment and optional tip' },
      },
    }],
    metadata,
    payment_intent_data: {
      ...(snapshot.applicationFeeCents > 0 ? { application_fee_amount: snapshot.applicationFeeCents } : {}),
      metadata,
    },
  };
  const requestOptions: Stripe.RequestOptions = {
    stripeAccount: input.stripeAccountId,
    idempotencyKey: input.idempotencyKey,
  };
  return { params, requestOptions, snapshot };
}
