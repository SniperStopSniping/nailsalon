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
  applySubscriptionRefundVoid,
  projectSubscriptionSnapshot,
  type StripeSubscriptionSnapshot,
} from '@/libs/billing/billingSubscriptionProjection';
import { BILLING_WEBHOOK_HANDLED_TYPES } from '@/libs/billing/billingWebhookEvents';
import { loadInvoiceLines, subscriptionLinePeriods } from '@/libs/billing/invoiceLinePeriods';
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

// P8c: the literal list now lives in billingWebhookEvents.ts (shared with
// the readiness harness and its CLI) — this route's behaviour is unchanged,
// it just no longer owns the only copy.
const HANDLED_TYPES = new Set<string>(BILLING_WEBHOOK_HANDLED_TYPES);

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
    if (claim.reason === 'in_flight') {
      // P3b: a DIFFERENT delivery currently owns this event id, still within
      // its processing lease — this is a live concurrent delivery, not a
      // terminal replay. 503 so Stripe redelivers later instead of getting
      // an ack for work nobody actually finished; Retry-After points past
      // the lease so the redelivery has a real chance of landing after the
      // in-flight owner resolves it (or its lease lapses and it reclaims).
      const retryAfterSeconds = Math.max(
        5,
        Math.ceil((claim.leaseExpiresAt.getTime() - Date.now()) / 1000),
      );
      return Response.json(
        { error: { code: 'BILLING_EVENT_PENDING' } },
        { status: 503, headers: { 'Retry-After': String(retryAfterSeconds) } },
      );
    }
    // Terminal replay (or a failed_retryable row not yet past its own
    // backoff): acknowledged, never reprocessed.
    return Response.json({ received: true, deduplicated: true });
  }
  if (!HANDLED_TYPES.has(event.type)) {
    const { written } = await resolveBillingEvent(event.id, claim.attempts, 'ignored_unhandled');
    reportIfCasLost(written, event);
    return Response.json({ received: true, ignored: 'unhandled_type' });
  }

  try {
    const outcome = await handleEvent(event);
    const { written } = await resolveBillingEvent(event.id, claim.attempts, outcome.status, outcome.detail);
    reportIfCasLost(written, event);
    return Response.json({ received: true, outcome: outcome.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HANDLER_FAILED';
    const { poisoned, written } = await failBillingEvent({
      eventId: event.id,
      attempts: claim.attempts,
      error: message,
    });
    if (!written) {
      // P3b lost CAS: another worker reclaimed this event id (our lease
      // lapsed while this delivery was still mid-flight) and has already
      // written — or will write — its own terminal outcome. That outcome
      // stands untouched; acknowledge so Stripe does not keep retrying a
      // slot this delivery no longer owns.
      reportIfCasLost(false, event);
      return Response.json({ received: true, outcome: 'cas_lost' });
    }
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

/** P3b: a lost CAS on a terminal write means another worker reclaimed this event id after our lease lapsed. Alert once so an unexpectedly slow handler (the only way this can happen) gets noticed, without failing the request — the newer owner's outcome already stands. */
function reportIfCasLost(written: boolean, event: Stripe.Event): void {
  if (written) {
    return;
  }
  Sentry.captureMessage('billing.event_cas_lost', {
    level: 'warning',
    extra: { eventId: event.id, eventType: event.type },
  });
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
  /** The charge this refund belongs to — the identity §8.3's authoritative re-fetch needs. */
  chargeId: string | null;
  refundId: string;
  /** Every refund identity the event carries — informational evidence only, never an idempotency key (R-2: the INVOICE is the key). */
  refundIds: string[];
  /** refund.updated only: the refund's own lifecycle status, recorded in the void reason so an operator can see WHY evidence was retracted. */
  refundStatus: string | null;
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
      chargeId: typeof charge.id === 'string' && charge.id.length > 0 ? charge.id : null,
      refundId: charge.refunds?.data?.[0]?.id ?? event.id,
      // The charge's refund list may be absent (expansion-dependent) — an
      // empty list is fine, because nothing keys on these ids.
      refundIds: charge.refunds?.data?.map(refund => refund.id) ?? [],
      refundStatus: null,
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
      chargeId: null,
      refundId: refund.id,
      refundIds: [refund.id],
      refundStatus: refund.status ?? null,
      chargeAmount: null,
      cumulativeRefundedCents: null,
      invoiceId: null,
    };
  }
  // refund.updated's body is the Refund, which carries neither the charge's
  // cumulative amount_refunded nor its invoice link — so this retrieve is
  // BOTH the enrichment and §8.3's authoritative re-fetch. The subscription
  // branch must not fetch the same charge a second time.
  const charge = await stripe.charges.retrieve(chargeId);
  return {
    paymentIntentId: refundPaymentIntentId
      ?? (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null),
    chargeId,
    refundId: refund.id,
    refundIds: [refund.id],
    refundStatus: refund.status ?? null,
    chargeAmount: charge.amount ?? null,
    cumulativeRefundedCents: charge.amount_refunded ?? null,
    invoiceId: typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id ?? null,
  };
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
  if (row === undefined && await isLocallyOwnedSubscription(subscriptionId)) {
    throw new Error('SUBSCRIPTION_NOT_PROJECTED');
  }
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
      cumulativeRefundedCents: context.cumulativeRefundedCents ?? -1,
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
      // §8.3: ambiguity resolves by AUTHORITATIVE re-fetch, never by event
      // ordering. A `charge.refunded` body is the charge AS IT WAS when the
      // event was created, and Stripe guarantees no delivery order — so a
      // partial `re_1` delivered AFTER a full `re_2` carries a body saying
      // `amount_refunded: 4000` for a charge that is fully refunded, and
      // deciding from it would void correct evidence with nothing to rewrite
      // it. (The mirror image writes full-refund evidence for a charge that
      // is no longer fully refunded.) refund.updated already retrieved the
      // charge in resolveRefundContext — re-fetching there would be a second
      // call for the same fact.
      const fresh = event.type === 'charge.refunded' && context.chargeId !== null
        // Deliberately unguarded: a retrieve failure must become
        // failed_retryable (Stripe redelivers) — never a hold, and never a
        // decision made from the stale body.
        ? await stripe.charges.retrieve(context.chargeId)
        : null;
      // "Known" = Stripe gave us BOTH sides of the arithmetic. Without both,
      // the magnitude of this refund is not a fact and nothing is decided
      // from it (G01) — the event is held for a human exactly as before.
      const amount = fresh !== null ? fresh.amount ?? null : context.chargeAmount;
      const cumulative = fresh !== null ? fresh.amount_refunded ?? null : context.cumulativeRefundedCents;
      const known = amount !== null && cumulative !== null;
      const fullRefund = known && cumulative! >= amount!;

      if (known && !fullRefund) {
        // R-2 / Owner decision O2: the charge's CUMULATIVE refund has dropped
        // below its amount, so it is no longer fully refunded and the §6.7
        // exclusion recorded for its invoice must stop applying. Keyed on the
        // INVOICE, never on a refund id: a failed `re_1` after a successful
        // `re_2` is the same invoice-level fact either way.
        const outcome = await applySubscriptionRefundVoid({
          stripeSubscriptionId: local.stripeSubscriptionId,
          invoiceId: local.invoice.id,
          reason: `refund_reversed:${context.refundStatus ?? event.type}`,
          eventId: event.id,
          observedAmountRefunded: cumulative!,
          observedAmount: amount!,
        });
        if (outcome.voided) {
          Sentry.captureMessage('billing.subscription_refund_voided', {
            level: 'warning',
            extra: {
              eventId: event.id,
              stripeSubscriptionId: local.stripeSubscriptionId,
              invoiceId: local.invoice.id,
              observedAmountRefunded: cumulative,
              observedAmount: amount,
              reapplied: outcome.reapplied,
            },
          });
          return { status: 'processed', detail: 'REFUND_EVIDENCE_VOIDED' };
        }
        // Nothing live to void: this is an ordinary partial refund, and
        // §6.7's "MAY suspend" stays a human call.
        Sentry.captureMessage('billing.charge_event_held', {
          level: 'warning',
          extra: { eventId: event.id, eventType: event.type },
        });
        return { status: 'held_anomaly', detail: 'SUBSCRIPTION_CHARGE_PARTIAL_REFUND' };
      }

      if (fullRefund) {
        // R-1/R-6: coverage is derived from the invoice's NON-PRORATION
        // subscription lines, paged when truncated. Unusable coverage holds
        // the event with ZERO writes — the old code wrote a null-bound row
        // that permanently poisoned every later evidence read.
        const lines = await loadInvoiceLines(local.invoice);
        const coverage = subscriptionLinePeriods(lines, local.stripeSubscriptionId);
        if (coverage.kind !== 'ok') {
          const detail = coverage.kind === 'no_subscription_lines'
            ? 'SUBSCRIPTION_REFUND_PRORATION_ONLY'
            : 'SUBSCRIPTION_REFUND_COVERAGE_UNKNOWN';
          Sentry.captureMessage('billing.event_held_anomaly', {
            level: 'warning',
            extra: { eventId: event.id, eventType: event.type, detail },
          });
          return { status: 'held_anomaly', detail };
        }
        const result = await applySubscriptionFullRefund({
          stripeSubscriptionId: local.stripeSubscriptionId,
          refundIds: context.refundIds,
          refundedPeriodStart: coverage.start,
          refundedPeriodEnd: coverage.end,
          invoiceId: local.invoice.id,
          eventCreated: created,
          eventId: event.id,
          observedAmountRefunded: cumulative ?? undefined,
          observedAmount: amount ?? undefined,
        });
        if (!result.applied) {
          // Defence in depth: the writer rejects unusable coverage too.
          const detail = result.anomaly ?? 'SUBSCRIPTION_NOT_PROJECTED';
          Sentry.captureMessage('billing.event_held_anomaly', {
            level: 'warning',
            extra: { eventId: event.id, eventType: event.type, detail },
          });
          return { status: 'held_anomaly', detail };
        }
        if (result.lowered) {
          Sentry.captureMessage('billing.subscription_refunded', {
            level: 'warning',
            extra: { eventId: event.id, stripeSubscriptionId: local.stripeSubscriptionId },
          });
        }
        return { status: 'processed' };
      }

      // Amounts unknown (a refund.updated whose charge retrieve gave nulls):
      // unchanged behaviour — held for a human, nothing inferred.
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
      // R-6: paid coverage is the span of this invoice's NON-PRORATION
      // subscription lines (§8.4), paged when the embedded page is
      // truncated. A renewal's proration line for the PREVIOUS cycle must
      // never drag `paidPeriodStart` back into a refunded window.
      const lines = await loadInvoiceLines(invoice);
      const coverage = subscriptionLinePeriods(lines, subscriptionId);
      if (coverage.kind !== 'ok') {
        const detail = coverage.kind === 'unknown'
          ? 'INVOICE_WITHOUT_LINE_PERIODS'
          : 'INVOICE_WITHOUT_SUBSCRIPTION_LINES';
        Sentry.captureMessage('billing.event_held_anomaly', {
          level: 'warning',
          extra: { eventId: event.id, eventType: event.type, detail },
        });
        return { status: 'held_anomaly', detail };
      }
      const result = await applyInvoicePaymentSucceeded({
        invoiceId: invoice.id,
        paidPeriodStart: coverage.start,
        stripeSubscriptionId: subscriptionId,
        paidPeriodEnd: coverage.end,
        eventCreated: created,
        eventId: event.id,
      });
      if (!result.applied) {
        if (result.anomaly !== 'SUBSCRIPTION_NOT_PROJECTED') {
          Sentry.captureMessage('billing.event_held_anomaly', {
            level: 'warning',
            extra: { eventId: event.id, eventType: event.type, detail: result.anomaly },
          });
          return { status: 'held_anomaly', detail: result.anomaly };
        }
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
