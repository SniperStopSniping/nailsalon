/**
 * SMS top-up Checkout — Gate C3 (contract §9, completion authorization §9.2).
 *
 * Client sends {salonId, topupOfferKey} and NOTHING else: the server
 * resolves the audience from the salon's legacy plan family, the credits,
 * the price, the currency and the env-scoped Stripe mapping. The browser
 * never selects an amount, a credit count or a Price ID.
 *
 * Ordering mirrors the subscription checkout: BILLING_TOPUPS_ENABLED gates
 * before ANY durable write or provider call; catalogue + audience validation
 * and PRICE_UNCONFIGURED resolution precede TX1; the durable attempt and the
 * precreated sms_topup_purchase row commit BEFORE Stripe; the session is
 * created under the attempt-derived idempotency key. Fulfillment happens
 * exclusively in the stripe-billing webhook on verified payment evidence —
 * the success page is never authoritative.
 *
 * P3b: the resolved Stripe Price is re-verified live (active, one-time, cad,
 * the offer's own amount) BEFORE TX1 — a stale or misconfigured price map
 * entry fails the request with nothing written rather than silently
 * collecting the wrong amount. The session also carries `payment_intent_data`
 * metadata (so a refund/dispute event's PaymentIntent alone still identifies
 * the purchase) and an `expires_at` derived from the PERSISTED attempt's
 * `expiresAt` — the attempt TTL stays the single source of truth for how
 * long a checkout may sit unresolved; only Stripe's own [30min, 24h] session
 * bound is enforced here as a clamp, never a second TTL.
 */
import * as Sentry from '@sentry/nextjs';
import { and, eq, inArray } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/libs/adminAuth';
import { logAuditEventTx } from '@/libs/auditLog';
import { beginCheckoutAttempt, markAttemptCheckoutCreated } from '@/libs/billing/checkoutAttempts';
import { resolveTopupAudienceForLegacyPlan } from '@/libs/billing/legacyPlanAdapter';
import { BillingCatalogError, resolveStripePriceIdForTopup } from '@/libs/billing/stripePriceMap';
import { applyTopupSessionExpired } from '@/libs/billing/topupFulfillment';
import { getTopupOffer } from '@/libs/billing/topupOffers';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { stripe } from '@/libs/stripe';
import { billingCheckoutAttemptSchema, salonSchema, smsTopupPurchaseSchema } from '@/models/Schema';

// Stripe's own hard bound on Checkout Session `expires_at`: it must be
// between 30 minutes and 24 hours from the moment Stripe processes the
// create request. The checkout ATTEMPT's own `expiresAt` (§8.5,
// CHECKOUT_ATTEMPT_TTL_MS = 1h) is the real source of truth for how long an
// unresolved top-up stays reservable; this is only a clamp so a request that
// races close to the attempt's TTL (or, in principle, a future longer TTL)
// can never hand Stripe an out-of-range value.
const STRIPE_SESSION_EXPIRES_AT_MIN_SECONDS = 30 * 60;
const STRIPE_SESSION_EXPIRES_AT_MAX_SECONDS = 24 * 60 * 60;

function clampStripeSessionExpiresAt(attemptExpiresAt: Date, now: Date): number {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const attemptSeconds = Math.floor(attemptExpiresAt.getTime() / 1000);
  const minSeconds = nowSeconds + STRIPE_SESSION_EXPIRES_AT_MIN_SECONDS;
  const maxSeconds = nowSeconds + STRIPE_SESSION_EXPIRES_AT_MAX_SECONDS;
  return Math.min(Math.max(attemptSeconds, minSeconds), maxSeconds);
}

const requestSchema = z
  .object({
    salonId: z.string().min(1),
    topupOfferKey: z.string().min(1),
  })
  .strict();

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  try {
    if (Env.BILLING_TOPUPS_ENABLED !== 'true') {
      return errorJson(503, 'TOPUPS_DISABLED', 'SMS credit top-ups are not enabled.');
    }
    const ip = getClientIp(request);
    const rateLimit = checkEndpointRateLimit('billing/checkout-topup', ip, 'BILLING');
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfterMs);
    }
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorJson(400, 'INVALID_INPUT', 'salonId and topupOfferKey are required; amounts and Stripe identifiers are never accepted.');
    }
    const { salonId, topupOfferKey } = parsed.data;
    const authResult = await requireAdmin(salonId);
    if (!authResult.ok) {
      return authResult.response;
    }
    const clerkUserId = authResult.admin.clerkUserId ?? null;

    const [salon] = await db
      .select({
        id: salonSchema.id,
        plan: salonSchema.plan,
        ownerEmail: salonSchema.ownerEmail,
        stripeCustomerId: salonSchema.stripeCustomerId,
        stripeCustomerEmail: salonSchema.stripeCustomerEmail,
      })
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);
    if (!salon) {
      return errorJson(404, 'SALON_NOT_FOUND', 'Salon not found.');
    }

    // Audience is resolved SERVER-SIDE from the legacy plan family (§9.1):
    // a free-plan salon cannot buy paid-audience pricing or vice versa.
    const offer = getTopupOffer(topupOfferKey);
    if (offer === null || !offer.active) {
      return errorJson(400, 'UNKNOWN_OFFER', 'The requested top-up offer is not available.');
    }
    const audience = resolveTopupAudienceForLegacyPlan(salon.plan ?? null);
    if (offer.audience !== audience) {
      return errorJson(400, 'OFFER_AUDIENCE_MISMATCH', 'This top-up offer does not apply to your plan.');
    }

    let stripePriceId: string;
    try {
      stripePriceId = resolveStripePriceIdForTopup(offer.key);
    } catch (error) {
      if (error instanceof BillingCatalogError) {
        return errorJson(503, 'PRICE_UNCONFIGURED', 'Top-up prices are not configured in this environment.');
      }
      throw error;
    }

    // P3b: verify the resolved price LIVE, before any durable write — a
    // stale env-mapped price id (rotated/archived in Stripe, or simply
    // pointing at the wrong amount) must never silently create an attempt or
    // purchase row for the wrong number of cents.
    let verifiedPrice: Awaited<ReturnType<typeof stripe.prices.retrieve>>;
    try {
      verifiedPrice = await stripe.prices.retrieve(stripePriceId);
    } catch (error) {
      Sentry.captureException(error, { tags: { endpoint: 'billing/checkout-topup' }, extra: { stripePriceId } });
      return errorJson(503, 'PRICE_UNVERIFIED', 'The top-up price could not be verified.');
    }
    if (
      verifiedPrice.active !== true
      || verifiedPrice.type !== 'one_time'
      || verifiedPrice.currency !== 'cad'
      || verifiedPrice.unit_amount !== offer.priceCents
    ) {
      Sentry.captureMessage('billing.topup_price_mismatch', {
        level: 'error',
        tags: { endpoint: 'billing/checkout-topup' },
        extra: { stripePriceId, offerKey: offer.key },
      });
      return errorJson(503, 'PRICE_MISMATCH', 'The configured top-up price no longer matches the offer.');
    }

    const now = new Date();
    const reservation = await db.transaction(async (tx) => {
      const attempt = await beginCheckoutAttempt(tx, {
        salonId,
        purpose: 'sms_topup',
        topupOfferKey: offer.key,
        now,
      });
      if (!attempt.ok) {
        return { kind: 'conflict' as const, reason: attempt.reason };
      }
      const [attemptRow] = await tx.select().from(billingCheckoutAttemptSchema)
        .where(and(
          eq(billingCheckoutAttemptSchema.id, attempt.attemptId),
          eq(billingCheckoutAttemptSchema.salonId, salonId),
        )).limit(1);
      if (attempt.reused) {
        return { kind: 'existing' as const, attempt: attemptRow! };
      }
      // Only the creator of the durable attempt creates a purchase or calls Stripe.
      const purchaseId = `stp_${crypto.randomUUID()}`;
      await tx.insert(smsTopupPurchaseSchema).values({
        id: purchaseId,
        salonId,
        topupOfferKey: offer.key,
        credits: offer.credits,
        amountCents: offer.priceCents,
        currency: 'cad',
        status: 'checkout_created',
      });
      return {
        kind: 'reserved' as const,
        attemptId: attempt.attemptId,
        stripeIdempotencyKey: attempt.stripeIdempotencyKey,
        reused: attempt.reused,
        existingSessionId: attemptRow?.stripeCheckoutSessionId ?? null,
        purchaseId,
        // §8.5 CHECKOUT_ATTEMPT_TTL_MS — the single source of truth the
        // Stripe session's own `expires_at` is clamped against below.
        expiresAt: attemptRow!.expiresAt,
      };
    });
    const pending = () => errorJson(409, 'CHECKOUT_PENDING_RECONCILIATION', 'Your checkout is pending verification. Another checkout cannot be started yet.');
    if (reservation.kind === 'conflict') {
      if (reservation.reason === 'CHECKOUT_PENDING_RECONCILIATION') {
        Sentry.captureMessage('Multiple unresolved top-up attempts', {
          level: 'error',
          tags: { endpoint: 'billing/checkout-topup' },
          extra: { salonId },
        });
        return pending();
      }
      return errorJson(409, 'CHECKOUT_IN_PROGRESS', 'Another checkout is already in progress for this salon.');
    }
    if (reservation.kind === 'existing') {
      const attempt = reservation.attempt;
      if (!attempt.stripeCheckoutSessionId) {
        return pending();
      }
      try {
        const existing = await stripe.checkout.sessions.retrieve(attempt.stripeCheckoutSessionId);
        if (existing.id !== attempt.stripeCheckoutSessionId || existing.mode !== 'payment'
          || existing.metadata?.purpose !== 'sms_topup' || existing.metadata.salonId !== salonId
          || existing.metadata.topupOfferKey !== attempt.topupOfferKey
          || existing.metadata.attemptId !== attempt.id) {
          return pending();
        }
        const [purchase] = await db.select().from(smsTopupPurchaseSchema)
          .where(and(
            eq(smsTopupPurchaseSchema.salonId, salonId),
            eq(smsTopupPurchaseSchema.stripeCheckoutSessionId, existing.id),
          ));
        if (!purchase || existing.metadata.purchaseId !== purchase.id || purchase.topupOfferKey !== attempt.topupOfferKey) {
          return pending();
        }
        if (existing.status === 'expired') {
          await applyTopupSessionExpired(existing.id);
          return errorJson(409, 'CHECKOUT_IN_PROGRESS', 'The previous checkout expired. Retry to start a new checkout.');
        }
        if (existing.status !== 'open' || !existing.url) {
          return pending();
        }
        // Recheck after remote I/O: a webhook may have resolved this attempt.
        const reusable = await db.transaction(async (tx) => {
          await tx.select({ id: salonSchema.id }).from(salonSchema)
            .where(eq(salonSchema.id, salonId)).for('no key update');
          const [current] = await tx.select().from(billingCheckoutAttemptSchema)
            .where(and(
              eq(billingCheckoutAttemptSchema.id, attempt.id),
              eq(billingCheckoutAttemptSchema.salonId, salonId),
              inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
            ));
          const [currentPurchase] = await tx.select().from(smsTopupPurchaseSchema)
            .where(and(
              eq(smsTopupPurchaseSchema.id, purchase.id),
              eq(smsTopupPurchaseSchema.salonId, salonId),
            ));
          return current?.stripeCheckoutSessionId === existing.id
            && currentPurchase?.status === 'checkout_created' && !currentPurchase.grantLedgerId;
        });
        return reusable
          ? NextResponse.json({ data: { sessionId: existing.id, url: existing.url, reused: true } })
          : pending();
      } catch (error) {
        Sentry.captureException(error, { tags: { endpoint: 'billing/checkout-topup' } });
        return pending();
      }
    }

    const baseUrl = Env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          // G14 automatic-tax architecture (§3.7): the flag stays unset in
          // every environment, so `enabled` is structurally false — this is
          // the architecture, not live tax collection.
          automatic_tax: { enabled: Env.BILLING_TAX_COLLECTION_ENABLED === 'true' },
          billing_address_collection: 'required',
          // D8: card-only for v1 — delayed-notification methods (still
          // reachable via checkout.session.async_payment_succeeded/failed,
          // handled by the webhook) are deliberately excluded for now.
          payment_method_types: ['card'],
          // `customer_update` is only valid alongside an existing `customer`
          // id (Stripe rejects it otherwise).
          ...(salon.stripeCustomerId
            ? { customer: salon.stripeCustomerId, customer_update: { address: 'auto' } }
            : { customer_email: salon.stripeCustomerEmail ?? salon.ownerEmail ?? undefined }),
          line_items: [{ price: stripePriceId, quantity: 1 }],
          success_url: `${baseUrl}/admin?topup=success`,
          cancel_url: `${baseUrl}/admin?topup=cancelled`,
          // P3b: derived from the PERSISTED attempt's own expiresAt (clamped
          // into Stripe's required [30min, 24h] session window) rather than
          // a second, independent TTL constant.
          expires_at: clampStripeSessionExpiresAt(reservation.expiresAt, now),
          metadata: {
            purpose: 'sms_topup',
            salonId,
            topupOfferKey: offer.key,
            purchaseId: reservation.purchaseId,
            attemptId: reservation.attemptId,
          },
          // P3b: a refund/dispute event only ever carries the PaymentIntent
          // (never the Checkout Session id) — this metadata lets a future
          // reconciliation path identify the purchase directly off the
          // PaymentIntent without relying solely on the payment_intent_id
          // backfill applyTopupSessionCompleted performs today.
          payment_intent_data: {
            metadata: {
              purpose: 'sms_topup',
              salonId,
              purchaseId: reservation.purchaseId,
              attemptId: reservation.attemptId,
            },
          },
        },
        { idempotencyKey: reservation.stripeIdempotencyKey },
      );
    } catch (error) {
      // Even a provider error may follow remote creation. Preserve creating
      // indefinitely; a fresh idempotency key could open a second checkout.
      Sentry.captureException(error, { tags: { endpoint: 'billing/checkout-topup' }, extra: { attemptId: reservation.attemptId } });
      return pending();
    }

    try {
      await db.transaction(async (tx) => {
        const result = await markAttemptCheckoutCreated(tx, {
          attemptId: reservation.attemptId,
          stripeCheckoutSessionId: session.id,
        });
        if (!result.updated) {
          throw new Error('TOPUP_SESSION_BINDING_CONFLICT');
        }
        const updated = await tx.update(smsTopupPurchaseSchema)
          .set({ stripeCheckoutSessionId: session.id })
          .where(and(
            eq(smsTopupPurchaseSchema.id, reservation.purchaseId),
            eq(smsTopupPurchaseSchema.salonId, salonId),
          )).returning();
        if (updated.length !== 1) {
          throw new Error('TOPUP_PURCHASE_BINDING_MISSING');
        }
        // Contracted route-level event (§8.5) — inside the SAME transaction,
        // so the row commits or rolls back with the session binding above.
        await logAuditEventTx(tx, {
          salonId,
          actorType: 'admin',
          actorId: clerkUserId,
          action: 'checkout_session_created',
          entityType: 'billing_checkout_attempt',
          entityId: reservation.attemptId,
          metadata: {
            purpose: 'sms_topup',
            topupOfferKey: offer.key,
            attemptId: reservation.attemptId,
            purchaseId: reservation.purchaseId,
          },
        });
      });
    } catch (error) {
      Sentry.captureException(error, { tags: { endpoint: 'billing/checkout-topup' }, extra: { attemptId: reservation.attemptId, sessionId: session.id } });
      return pending();
    }
    return NextResponse.json({
      data: {
        sessionId: session.id,
        url: session.url,
        reused: false,
        offer: { key: offer.key, credits: offer.credits, priceCents: offer.priceCents, currency: 'cad' },
      },
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { endpoint: 'billing/checkout-topup' } });
    return errorJson(500, 'CHECKOUT_ERROR', 'Top-up checkout could not be started.');
  }
}
