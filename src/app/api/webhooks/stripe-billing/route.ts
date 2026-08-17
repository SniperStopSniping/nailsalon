/**
 * Stripe BILLING webhook — Gate C2 (contract §8).
 *
 * The third and final Stripe endpoint, deliberately parallel to its
 * siblings: the legacy /api/webhooks/stripe keeps its compatibility
 * projection byte-identical, /api/webhooks/stripe-connect owns deposits,
 * and THIS route owns billing_subscription, billing_credit_window,
 * billing_checkout_attempt, billing_promotion_claim and (with C3) top-up
 * state — the §8.6 reconciliation job is what keeps three endpoints from
 * becoming three billing systems.
 *
 * Pipeline: dedicated-secret signature verification → livemode gate against
 * BILLING_PLAN_ENV → billing_stripe_event claim (replay exits 200; a
 * failed_retryable row past backoff reclaims) → type-specific handler →
 * terminal status. Handler errors mark failed_retryable with backoff and
 * return 500 so Stripe retries; the 8th attempt poisons, alerts, and
 * returns 200. Financial effects live in billingSubscriptionProjection and
 * are idempotent on OBJECT identities, never on event ordering (§8.3).
 *
 * DARK: STRIPE_BILLING_WEBHOOK_SECRET is unset in every environment, so
 * this route fails closed at step one. No webhook endpoint is registered
 * with Stripe in this gate.
 */
import * as Sentry from '@sentry/nextjs';
import type Stripe from 'stripe';

import {
  claimBillingEvent,
  failBillingEvent,
  resolveBillingEvent,
} from '@/libs/billing/billingStripeEvents';
import {
  applyCheckoutSessionCompleted,
  applyCheckoutSessionExpired,
  applyInvoicePaymentFailed,
  applyInvoicePaymentSucceeded,
  projectSubscriptionSnapshot,
  type StripeSubscriptionSnapshot,
} from '@/libs/billing/billingSubscriptionProjection';
import {
  applyTopupChargeRefunded,
  applyTopupDisputeCreated,
  applyTopupSessionCompleted,
  applyTopupSessionExpired,
} from '@/libs/billing/topupFulfillment';
import { Env } from '@/libs/Env';
import { stripe } from '@/libs/stripe';

const HANDLED_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
]);

function toSnapshot(subscription: Stripe.Subscription): StripeSubscriptionSnapshot {
  return {
    id: subscription.id,
    customerId: typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    metadata: (subscription.metadata ?? {}) as Record<string, string | undefined>,
  };
}

export async function POST(request: Request): Promise<Response> {
  const secret = Env.STRIPE_BILLING_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed: no secret means this endpoint is not provisioned (§12).
    return Response.json({ error: { code: 'WEBHOOK_NOT_CONFIGURED' } }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? '', secret);
  } catch {
    // Invalid signature mutates NOTHING (§19) — not even an event row.
    return Response.json({ error: { code: 'INVALID_SIGNATURE' } }, { status: 400 });
  }

  // Livemode gate (§8.2): a live event reaching a non-prod deployment (or
  // vice versa) is recorded and ignored — never processed, never retried.
  const expectLive = Env.BILLING_PLAN_ENV === 'prod';
  const object = event.data.object as unknown as Record<string, unknown>;
  const claim = await claimBillingEvent({
    eventId: event.id,
    eventType: event.type,
    livemode: event.livemode,
    apiCreatedAt: new Date(event.created * 1000),
    subscriptionId: typeof object.subscription === 'string'
      ? object.subscription
      : (event.type.startsWith('customer.subscription') ? String(object.id ?? '') || null : null),
    invoiceId: event.type.startsWith('invoice') ? String(object.id ?? '') || null : null,
    checkoutSessionId: event.type.startsWith('checkout.session') ? String(object.id ?? '') || null : null,
    paymentIntentId: typeof object.payment_intent === 'string' ? object.payment_intent : null,
    rawPayload: JSON.parse(JSON.stringify(event)) as Record<string, unknown>,
  });
  if (!claim.claimed) {
    // Replay or concurrent delivery: acknowledged, never reprocessed.
    return Response.json({ received: true, deduplicated: true });
  }
  if (event.livemode !== expectLive) {
    await resolveBillingEvent(event.id, 'ignored_livemode_mismatch');
    return Response.json({ received: true, ignored: 'livemode_mismatch' });
  }
  if (!HANDLED_TYPES.has(event.type)) {
    await resolveBillingEvent(event.id, 'ignored_unhandled');
    return Response.json({ received: true, ignored: 'unhandled_type' });
  }

  try {
    const outcome = await handleEvent(event);
    await resolveBillingEvent(event.id, outcome.status, outcome.detail);
    return Response.json({ received: true, outcome: outcome.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HANDLER_FAILED';
    const { poisoned } = await failBillingEvent({
      eventId: event.id,
      attempts: claim.attempts,
      error: message,
    });
    if (poisoned) {
      Sentry.captureException(error, {
        tags: { endpoint: 'webhooks/stripe-billing', eventType: event.type },
        extra: { eventId: event.id, poisoned: true },
      });
      // 200: Stripe must stop retrying a poison pill; a human owns it now.
      return Response.json({ received: true, poisoned: true });
    }
    return Response.json({ error: { code: 'HANDLER_RETRYABLE', message } }, { status: 500 });
  }
}

async function handleEvent(event: Stripe.Event): Promise<{
  status: 'processed' | 'held_anomaly' | 'ignored_foreign';
  detail?: string;
}> {
  const created = new Date(event.created * 1000);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const purpose = session.metadata?.purpose;
      if (purpose === 'sms_topup') {
        const result = await applyTopupSessionCompleted({
          sessionId: session.id,
          paymentStatus: session.payment_status ?? 'unpaid',
          paymentIntentId: typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
        });
        if (!result.fulfilled && result.reason === 'PURCHASE_NOT_FOUND') {
          // The precreated row should always exist — retryable, redelivery
          // gives a racing checkout TX2 time to record the session id.
          throw new Error('TOPUP_PURCHASE_NOT_FOUND');
        }
        return { status: 'processed' };
      }
      if (purpose !== 'plan_subscription') {
        return { status: 'ignored_foreign' };
      }
      await applyCheckoutSessionCompleted({
        sessionId: session.id,
        paymentStatus: session.payment_status ?? 'unpaid',
      });
      // The subscription object itself arrives via customer.subscription.*;
      // when it is already expanded on the session, project it now so the
      // row exists before the invoice event lands.
      if (typeof session.subscription === 'object' && session.subscription !== null) {
        await projectSubscriptionSnapshot({
          snapshot: toSnapshot(session.subscription as Stripe.Subscription),
          eventCreated: created,
          eventId: event.id,
        });
      }
      return { status: 'processed' };
    }
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      await applyCheckoutSessionExpired({ sessionId: session.id });
      await applyTopupSessionExpired(session.id);
      return { status: 'processed' };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      let subscription = event.data.object as Stripe.Subscription;
      if (subscription.metadata?.purpose !== 'plan_subscription') {
        return { status: 'ignored_foreign' };
      }
      // §8.3: ambiguity resolves by AUTHORITATIVE re-fetch, never event-id
      // ordering. A deleted subscription cannot be re-fetched meaningfully;
      // its terminal body is authoritative.
      if (event.type === 'customer.subscription.updated') {
        try {
          subscription = await stripe.subscriptions.retrieve(subscription.id);
        } catch {
          // Fall back to the event body; the strict-< fence still protects.
        }
      }
      const outcome = await projectSubscriptionSnapshot({
        snapshot: toSnapshot(subscription),
        eventCreated: created,
        eventId: event.id,
      });
      if (!outcome.applied) {
        return { status: 'held_anomaly', detail: outcome.anomaly };
      }
      return { status: 'processed' };
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id ?? null;
      if (subscriptionId === null) {
        return { status: 'ignored_foreign' };
      }
      // Paid-through extends to the LATEST line-item period end (§8.4).
      const periodEnds = (invoice.lines?.data ?? [])
        .map(line => line.period?.end ?? 0)
        .filter(end => end > 0);
      if (periodEnds.length === 0) {
        return { status: 'held_anomaly', detail: 'INVOICE_WITHOUT_LINE_PERIODS' };
      }
      const result = await applyInvoicePaymentSucceeded({
        stripeSubscriptionId: subscriptionId,
        paidPeriodEnd: new Date(Math.max(...periodEnds) * 1000),
        eventCreated: created,
        eventId: event.id,
      });
      if (!result.applied) {
        // The subscription event may simply not have landed yet — retryable,
        // Stripe's redelivery gives the projection time to appear.
        throw new Error(result.anomaly ?? 'SUBSCRIPTION_NOT_PROJECTED');
      }
      return { status: 'processed' };
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id ?? null;
      if (subscriptionId === null) {
        return { status: 'ignored_foreign' };
      }
      await applyInvoicePaymentFailed({
        stripeSubscriptionId: subscriptionId,
        eventCreated: created,
        eventId: event.id,
      });
      return { status: 'processed' };
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null;
      if (paymentIntentId !== null) {
        const latestRefundId = charge.refunds?.data?.[0]?.id ?? event.id;
        const outcome = await applyTopupChargeRefunded({
          paymentIntentId,
          refundId: latestRefundId,
          cumulativeRefundedCents: charge.amount_refunded ?? 0,
        });
        if (outcome !== null) {
          return outcome.anomaly !== null
            ? { status: 'held_anomaly', detail: outcome.anomaly }
            : { status: 'processed' };
        }
      }
      // Not a top-up: a SUBSCRIPTION-charge refund has no automated v1
      // behavior (§6.7 — "MAY suspend" is an operator decision).
      Sentry.captureMessage('billing.charge_event_held', {
        level: 'warning',
        extra: { eventId: event.id, eventType: event.type },
      });
      return { status: 'held_anomaly', detail: 'CHARGE_EVENT_HELD_FOR_REVIEW' };
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id ?? null;
      if (paymentIntentId !== null) {
        const outcome = await applyTopupDisputeCreated({
          paymentIntentId,
          disputeId: dispute.id,
        });
        if (outcome !== null) {
          return { status: 'processed' };
        }
      }
      Sentry.captureMessage('billing.charge_event_held', {
        level: 'warning',
        extra: { eventId: event.id, eventType: event.type },
      });
      return { status: 'held_anomaly', detail: 'CHARGE_EVENT_HELD_FOR_REVIEW' };
    }
    case 'charge.dispute.closed': {
      // Win/loss handling is a manual operator flow in v1: the reversal
      // already happened at creation; closure is evidence for the human.
      Sentry.captureMessage('billing.dispute_closed', {
        level: 'warning',
        extra: { eventId: event.id },
      });
      return { status: 'held_anomaly', detail: 'DISPUTE_CLOSED_FOR_REVIEW' };
    }
    default:
      return { status: 'ignored_foreign' };
  }
}

export const dynamic = 'force-dynamic';
