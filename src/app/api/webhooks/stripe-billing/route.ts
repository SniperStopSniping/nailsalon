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
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

import {
  claimBillingEvent,
  failBillingEvent,
  recordBillingEventPriceId,
  recordIgnoredBillingEvent,
  resolveBillingEvent,
} from '@/libs/billing/billingStripeEvents';
import {
  applyCheckoutSessionCompleted,
  applyCheckoutSessionExpired,
  applyInvoicePaymentFailed,
  applyInvoicePaymentSucceeded,
  applySubscriptionFullRefund,
  projectSubscriptionSnapshot,
  type StripeSubscriptionSnapshot,
} from '@/libs/billing/billingSubscriptionProjection';
import {
  applyTopupChargeRefunded,
  applyTopupDisputeCreated,
  applyTopupSessionCompleted,
  applyTopupSessionExpired,
  buildTopupVerifiedEvidence,
  isTopupEvidenceMismatchReason,
  type TopupVerifiedEvidence,
} from '@/libs/billing/topupFulfillment';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { stripe } from '@/libs/stripe';
import { billingSubscriptionSchema, smsTopupPurchaseSchema } from '@/models/Schema';

const HANDLED_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'charge.refunded',
  'refund.updated',
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
    // G02: free to read off the event body — no Stripe call needed. Items
    // always carry a fully-populated `price` object, never a bare id string.
    priceId: subscription.items?.data?.[0]?.price?.id ?? null,
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

  const expectLive = Env.BILLING_PLAN_ENV === 'prod';
  const object = event.data.object as unknown as Record<string, unknown>;
  const extracted = {
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
    // G02: free for subscription events (already in the event body); a
    // top-up checkout session's price id needs a Stripe call to learn (line
    // items are never in the event body), so it is backfilled post-claim via
    // recordBillingEventPriceId once handleEvent has retrieved the session.
    priceId: event.type.startsWith('customer.subscription')
      ? (((object.items as { data?: Array<{ price?: { id?: string } }> } | undefined)
          ?.data?.[0]?.price?.id) ?? null)
      : null,
    rawPayload: JSON.parse(JSON.stringify(event)) as Record<string, unknown>,
  };

  // Livemode gate (§8.2 order: signature → livemode → claim): a live event
  // reaching a non-prod deployment (or vice versa) is recorded DIRECTLY in
  // its terminal status — never processed, never retried, and never
  // claimed. No `processing` row is ever written for it, and a replayed
  // delivery of the same mismatched event is a no-op (ON CONFLICT DO
  // NOTHING inside recordIgnoredBillingEvent).
  if (event.livemode !== expectLive) {
    await recordIgnoredBillingEvent(extracted, 'ignored_livemode_mismatch');
    return Response.json({ received: true, ignored: 'livemode_mismatch' });
  }

  const claim = await claimBillingEvent(extracted);
  if (!claim.claimed) {
    // Replay or concurrent delivery: acknowledged, never reprocessed.
    return Response.json({ received: true, deduplicated: true });
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

/**
 * Shared by checkout.session.completed and .async_payment_succeeded for
 * purpose='sms_topup' (G05): verify evidence only when about to fulfil
 * (payment_status='paid'), backfill price_id on the already-claimed event
 * row, and classify a verification mismatch as held_anomaly rather than a
 * plain unfulfilled wait.
 */
async function handleTopupCheckoutPaymentEvent(
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
): Promise<{ status: 'processed' | 'held_anomaly'; detail?: string }> {
  const paymentStatus = session.payment_status ?? 'unpaid';
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  let verifiedEvidence: TopupVerifiedEvidence | null = null;
  if (paymentStatus === 'paid') {
    verifiedEvidence = await buildTopupVerifiedEvidence(session.id);
    await recordBillingEventPriceId(event.id, verifiedEvidence.priceId);
  }

  const result = await applyTopupSessionCompleted({
    sessionId: session.id,
    paymentStatus,
    paymentIntentId,
    verifiedEvidence,
  });
  if (!result.fulfilled && result.reason === 'PURCHASE_NOT_FOUND') {
    // The precreated row should always exist — retryable, redelivery gives a
    // racing checkout TX2 time to record the session id.
    throw new Error('TOPUP_PURCHASE_NOT_FOUND');
  }
  if (!result.fulfilled && isTopupEvidenceMismatchReason(result.reason)) {
    Sentry.captureMessage('billing.event_held_anomaly', {
      level: 'warning',
      extra: { eventId: event.id, eventType: event.type, detail: result.reason },
    });
    return { status: 'held_anomaly', detail: result.reason };
  }
  return { status: 'processed' };
}

/** checkout.session.completed / .async_payment_succeeded for purpose='plan_subscription'. */
async function handleSubscriptionCheckoutPaymentEvent(
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
  created: Date,
): Promise<{ status: 'processed' | 'held_anomaly'; detail?: string }> {
  await applyCheckoutSessionCompleted({
    sessionId: session.id,
    paymentStatus: session.payment_status ?? 'unpaid',
  });
  // The subscription object itself normally arrives via customer.subscription.*;
  // when it is already expanded on the session, project it now so the row
  // exists before the invoice event lands.
  if (typeof session.subscription === 'object' && session.subscription !== null) {
    const outcome = await projectSubscriptionSnapshot({
      snapshot: toSnapshot(session.subscription as Stripe.Subscription),
      eventCreated: created,
      eventId: event.id,
    });
    if (!outcome.applied) {
      Sentry.captureMessage('billing.event_held_anomaly', {
        level: 'warning',
        extra: { eventId: event.id, eventType: event.type, detail: outcome.anomaly },
      });
      return { status: 'held_anomaly', detail: outcome.anomaly };
    }
  }
  return { status: 'processed' };
}

type RefundContext = {
  paymentIntentId: string | null;
  refundId: string;
  chargeAmount: number | null;
  cumulativeRefundedCents: number | null;
  invoiceId: string | null;
};

/**
 * charge.refunded's event body IS the charge — every field is already
 * present, no Stripe call needed. refund.updated's body is the Refund
 * object, which carries neither the charge's CUMULATIVE amount_refunded nor
 * its invoice link, so this event type makes exactly one stripe.charges.retrieve
 * to fetch both (G01: never guess a refund's cumulative magnitude from a
 * single refund's own `amount`).
 */
async function resolveRefundContext(event: Stripe.Event): Promise<RefundContext> {
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    return {
      paymentIntentId: typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null,
      refundId: charge.refunds?.data?.[0]?.id ?? event.id,
      chargeAmount: charge.amount ?? null,
      cumulativeRefundedCents: charge.amount_refunded ?? null,
      invoiceId: typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id ?? null,
    };
  }
  const refund = event.data.object as Stripe.Refund;
  const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id ?? null;
  const refundPaymentIntentId = typeof refund.payment_intent === 'string'
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
  if (chargeId === null) {
    return {
      paymentIntentId: refundPaymentIntentId,
      refundId: refund.id,
      chargeAmount: null,
      cumulativeRefundedCents: null,
      invoiceId: null,
    };
  }
  const charge = await stripe.charges.retrieve(chargeId);
  return {
    paymentIntentId: refundPaymentIntentId
      ?? (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null),
    refundId: refund.id,
    chargeAmount: charge.amount ?? null,
    cumulativeRefundedCents: charge.amount_refunded ?? null,
    invoiceId: typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id ?? null,
  };
}

/** G10: the earliest subscription line's period start — the floor a refund leaves uncovered. */
function earliestSubscriptionLinePeriodStart(invoice: Stripe.Invoice): Date | null {
  const starts = (invoice.lines?.data ?? [])
    .map(line => line.period?.start ?? 0)
    .filter(start => start > 0);
  if (starts.length === 0) {
    return null;
  }
  return new Date(Math.min(...starts) * 1000);
}

/** G42: does this charge's invoice belong to a LOCAL billing_subscription? Fetches the invoice (never guesses); null when it does not, or nothing local matches. */
async function resolveLocalSubscriptionByInvoiceId(
  invoiceId: string,
): Promise<{ stripeSubscriptionId: string; invoice: Stripe.Invoice } | null> {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id ?? null;
  if (subscriptionId === null) {
    return null;
  }
  const [row] = await db
    .select({ stripeSubscriptionId: billingSubscriptionSchema.stripeSubscriptionId })
    .from(billingSubscriptionSchema)
    .where(eq(billingSubscriptionSchema.stripeSubscriptionId, subscriptionId))
    .limit(1);
  return row === undefined ? null : { stripeSubscriptionId: subscriptionId, invoice };
}

/** G42, dispute path: charge → invoice → local subscription, one Stripe call. */
async function resolveLocalSubscriptionForCharge(
  chargeId: string | null,
): Promise<{ stripeSubscriptionId: string; invoice: Stripe.Invoice } | null> {
  if (chargeId === null) {
    return null;
  }
  const charge = await stripe.charges.retrieve(chargeId);
  const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id ?? null;
  return invoiceId === null ? null : resolveLocalSubscriptionByInvoiceId(invoiceId);
}

async function topupPurchaseExistsForPaymentIntent(paymentIntentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: smsTopupPurchaseSchema.id })
    .from(smsTopupPurchaseSchema)
    .where(eq(smsTopupPurchaseSchema.stripePaymentIntentId, paymentIntentId))
    .limit(1);
  return row !== undefined;
}

/**
 * G42 ownership guard for invoice events: a MISSING local `billing_subscription`
 * row is ambiguous by itself — it is either a genuinely foreign (legacy-flow)
 * invoice, or OUR OWN brand-new subscription whose `customer.subscription.created`
 * webhook simply has not landed yet (§8.2's own redelivery race, exercised by
 * this route's other tests). The disambiguator is the Stripe subscription's
 * OWN metadata, which only this billing track ever stamps with
 * `purpose: 'plan_subscription'` at creation. A retrieval failure never
 * guesses "foreign" — it stays retryable so a transient Stripe hiccup can
 * never silently drop a legitimate invoice.
 */
async function isLocallyOwnedSubscription(stripeSubscriptionId: string): Promise<boolean> {
  try {
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    return subscription.metadata?.purpose === 'plan_subscription';
  } catch {
    return true;
  }
}

/**
 * G01/G10/G42: shared by charge.refunded and refund.updated. Tries the
 * top-up reversal first (cumulative-evidence arithmetic, at most once per
 * refund regardless of which of the two event types arrives first or
 * second); then a LOCAL subscription invoice (full refund ⇒ §6.7 future-grants
 * stop, partial ⇒ held for a human); anything matching neither is a foreign
 * platform event and is terminally ignored, never thrown or paged.
 */
async function handleRefundEvent(event: Stripe.Event, created: Date): Promise<{
  status: 'processed' | 'held_anomaly' | 'ignored_foreign';
  detail?: string;
}> {
  const context = await resolveRefundContext(event);

  if (context.paymentIntentId !== null) {
    const outcome = await applyTopupChargeRefunded({
      paymentIntentId: context.paymentIntentId,
      refundId: context.refundId,
      cumulativeRefundedCents: context.cumulativeRefundedCents ?? 0,
    });
    if (outcome !== null) {
      if (outcome.anomaly !== null) {
        Sentry.captureMessage('billing.event_held_anomaly', {
          level: 'warning',
          extra: { eventId: event.id, eventType: event.type, detail: outcome.anomaly },
        });
        return { status: 'held_anomaly', detail: outcome.anomaly };
      }
      return { status: 'processed' };
    }
  }

  if (context.invoiceId !== null) {
    const local = await resolveLocalSubscriptionByInvoiceId(context.invoiceId);
    if (local !== null) {
      const isFullRefund = context.chargeAmount !== null
        && context.cumulativeRefundedCents !== null
        && context.cumulativeRefundedCents >= context.chargeAmount;
      if (isFullRefund) {
        const refundedPeriodStart = earliestSubscriptionLinePeriodStart(local.invoice);
        if (refundedPeriodStart !== null) {
          const result = await applySubscriptionFullRefund({
            stripeSubscriptionId: local.stripeSubscriptionId,
            refundId: context.refundId,
            refundedPeriodStart,
            eventCreated: created,
            eventId: event.id,
          });
          if (result.lowered) {
            Sentry.captureMessage('billing.subscription_refunded', {
              level: 'warning',
              extra: { eventId: event.id, stripeSubscriptionId: local.stripeSubscriptionId },
            });
          }
          return { status: 'processed' };
        }
      }
      // Partial subscription refund: §6.7's "MAY suspend" stays a human call.
      Sentry.captureMessage('billing.charge_event_held', {
        level: 'warning',
        extra: { eventId: event.id, eventType: event.type },
      });
      return { status: 'held_anomaly', detail: 'SUBSCRIPTION_CHARGE_PARTIAL_REFUND' };
    }
  }

  // G42: neither a top-up nor a local subscription invoice — a foreign
  // platform event (legacy/deposit flow) must never throw, retry, or page.
  return { status: 'ignored_foreign', detail: 'FOREIGN_CHARGE' };
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
        return handleTopupCheckoutPaymentEvent(session, event);
      }
      if (purpose !== 'plan_subscription') {
        return { status: 'ignored_foreign' };
      }
      return handleSubscriptionCheckoutPaymentEvent(session, event, created);
    }
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session;
      const purpose = session.metadata?.purpose;
      if (purpose === 'sms_topup') {
        return handleTopupCheckoutPaymentEvent(session, event);
      }
      if (purpose !== 'plan_subscription') {
        return { status: 'ignored_foreign' };
      }
      return handleSubscriptionCheckoutPaymentEvent(session, event, created);
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const purpose = session.metadata?.purpose;
      if (purpose === 'sms_topup') {
        await applyTopupSessionExpired(session.id);
      } else if (purpose === 'plan_subscription') {
        await applyCheckoutSessionExpired({ sessionId: session.id });
      } else {
        return { status: 'ignored_foreign' };
      }
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
        Sentry.captureMessage('billing.event_held_anomaly', {
          level: 'warning',
          extra: { eventId: event.id, eventType: event.type, detail: outcome.anomaly },
        });
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
        return { status: 'ignored_foreign', detail: 'FOREIGN_INVOICE' };
      }
      // Paid-through extends to the LATEST line-item period end (§8.4).
      const periodEnds = (invoice.lines?.data ?? [])
        .map(line => line.period?.end ?? 0)
        .filter(end => end > 0);
      if (periodEnds.length === 0) {
        Sentry.captureMessage('billing.event_held_anomaly', {
          level: 'warning',
          extra: { eventId: event.id, eventType: event.type, detail: 'INVOICE_WITHOUT_LINE_PERIODS' },
        });
        return { status: 'held_anomaly', detail: 'INVOICE_WITHOUT_LINE_PERIODS' };
      }
      const result = await applyInvoicePaymentSucceeded({
        stripeSubscriptionId: subscriptionId,
        paidPeriodEnd: new Date(Math.max(...periodEnds) * 1000),
        eventCreated: created,
        eventId: event.id,
      });
      if (!result.applied) {
        // G42: a missing local projection is ambiguous by itself — it is
        // either a genuinely foreign (legacy-flow) invoice, or OUR OWN
        // brand-new subscription whose customer.subscription.created has not
        // landed yet. Only the latter stays retryable.
        if (result.anomaly === 'SUBSCRIPTION_NOT_PROJECTED' && !(await isLocallyOwnedSubscription(subscriptionId))) {
          return { status: 'ignored_foreign', detail: 'FOREIGN_INVOICE' };
        }
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
        return { status: 'ignored_foreign', detail: 'FOREIGN_INVOICE' };
      }
      const result = await applyInvoicePaymentFailed({
        stripeSubscriptionId: subscriptionId,
        eventCreated: created,
        eventId: event.id,
      });
      // G42: no local row to mark past_due — a foreign (legacy-flow)
      // invoice. Unlike payment_succeeded this path never threw, so there is
      // no retry race to protect; the missing row IS the whole answer.
      if (!result.applied) {
        return { status: 'ignored_foreign', detail: 'FOREIGN_INVOICE' };
      }
      return { status: 'processed' };
    }
    case 'charge.refunded':
    case 'refund.updated':
      return handleRefundEvent(event, created);
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
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null;
      const local = await resolveLocalSubscriptionForCharge(chargeId);
      if (local === null) {
        // G42: neither a top-up nor a local subscription charge — foreign.
        return { status: 'ignored_foreign', detail: 'FOREIGN_CHARGE' };
      }
      Sentry.captureMessage('billing.charge_event_held', {
        level: 'warning',
        extra: { eventId: event.id, eventType: event.type },
      });
      return { status: 'held_anomaly', detail: 'CHARGE_EVENT_HELD_FOR_REVIEW' };
    }
    case 'charge.dispute.closed': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id ?? null;
      const isTopup = paymentIntentId !== null && await topupPurchaseExistsForPaymentIntent(paymentIntentId);
      if (!isTopup) {
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null;
        const local = await resolveLocalSubscriptionForCharge(chargeId);
        if (local === null) {
          // G42: neither a top-up nor a local subscription charge — foreign.
          return { status: 'ignored_foreign', detail: 'FOREIGN_CHARGE' };
        }
      }
      // Win/loss handling is a manual operator flow in v1: any reversal
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
