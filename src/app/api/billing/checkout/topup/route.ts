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
 */
import * as Sentry from '@sentry/nextjs';
import { and, eq, isNull } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/libs/adminAuth';
import { beginCheckoutAttempt, deriveTopupPurchaseId, markAttemptCheckoutCreated } from '@/libs/billing/checkoutAttempts';
import { resolveTopupAudienceForLegacyPlan } from '@/libs/billing/legacyPlanAdapter';
import { BillingCatalogError, resolveStripePriceIdForTopup } from '@/libs/billing/stripePriceMap';
import { getTopupOffer } from '@/libs/billing/topupOffers';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { stripe } from '@/libs/stripe';
import { billingCheckoutAttemptSchema, salonSchema, smsTopupPurchaseSchema } from '@/models/Schema';

// Provider expiry precedes the durable reservation expiry by five minutes.
const CHECKOUT_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

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
    if (!Env.STRIPE_BILLING_WEBHOOK_SECRET?.trim()) {
      return errorJson(503, 'TOPUPS_UNAVAILABLE', 'SMS credit top-ups are not ready for checkout.');
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

    // Fail closed before any reservation if the configured Stripe price is
    // not the exact fixed, one-time CAD offer for this environment.
    const price = await stripe.prices.retrieve(stripePriceId);
    if (!price.active || price.type !== 'one_time' || price.recurring !== null
      || price.currency !== 'cad' || price.unit_amount !== offer.priceCents
      || price.billing_scheme !== 'per_unit' || price.custom_unit_amount != null
      || price.transform_quantity != null || price.livemode !== (Env.BILLING_PLAN_ENV === 'prod')) {
      return errorJson(503, 'PRICE_UNCONFIGURED', 'The configured top-up price is not ready for checkout.');
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
        return { kind: 'conflict' as const };
      }
      const [attemptRow] = await tx
        .select()
        .from(billingCheckoutAttemptSchema)
        .where(and(eq(billingCheckoutAttemptSchema.id, attempt.attemptId), eq(billingCheckoutAttemptSchema.salonId, salonId)))
        .limit(1);
      if (!attemptRow || attemptRow.topupOfferKey !== offer.key) {
        return { kind: 'conflict' as const };
      }
      const purchaseId = deriveTopupPurchaseId(attempt.attemptId);
      // Exactly one snapshot per attempt. A retry never creates a purchase
      // or calls Stripe before the original creator has bound its session.
      if (!attempt.reused) {
        await tx.insert(smsTopupPurchaseSchema).values({
          id: purchaseId,
          salonId,
          topupOfferKey: offer.key,
          credits: offer.credits,
          amountCents: offer.priceCents,
          currency: 'cad',
          status: 'checkout_created',
        });
      }
      return {
        kind: 'reserved' as const,
        attemptId: attempt.attemptId,
        stripeIdempotencyKey: attempt.stripeIdempotencyKey,
        reused: attempt.reused,
        existingSessionId: attemptRow?.stripeCheckoutSessionId ?? null,
        purchaseId,
        expiresAt: attemptRow.expiresAt,
      };
    });
    if (reservation.kind === 'conflict') {
      return errorJson(409, 'CHECKOUT_IN_PROGRESS', 'Another checkout is already in progress for this salon.');
    }
    if (reservation.reused) {
      if (reservation.existingSessionId === null) {
        return errorJson(409, 'CHECKOUT_IN_PROGRESS', 'Checkout is being confirmed. Please retry later.');
      }
      const existing = await stripe.checkout.sessions.retrieve(reservation.existingSessionId);
      return NextResponse.json({ data: { sessionId: existing.id, url: existing.url, reused: true } });
    }

    const metadata = {
      purpose: 'sms_topup',
      billingEnv: Env.BILLING_PLAN_ENV,
      salonId,
      topupOfferKey: offer.key,
      purchaseId: reservation.purchaseId,
      attemptId: reservation.attemptId,
    };
    const baseUrl = Env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          ...(salon.stripeCustomerId
            ? { customer: salon.stripeCustomerId }
            : { customer_email: salon.stripeCustomerEmail ?? salon.ownerEmail ?? undefined }),
          line_items: [{ price: stripePriceId, quantity: 1 }],
          success_url: `${baseUrl}/admin?topup=success`,
          cancel_url: `${baseUrl}/admin?topup=cancelled`,
          expires_at: Math.floor((reservation.expiresAt.getTime() - CHECKOUT_EXPIRY_BUFFER_MS) / 1000),
          metadata,
          payment_intent_data: { metadata },
        },
        { idempotencyKey: reservation.stripeIdempotencyKey },
      );
    } catch (error) {
      // A timeout/connection failure can occur after Stripe creates the
      // session. Keep the reservation until its fixed expiry; only verified
      // webhook evidence may bind and fulfill an uncertain remote outcome.
      Sentry.captureException(error, { tags: { endpoint: 'billing/checkout-topup' } });
      return errorJson(502, 'CHECKOUT_CREATE_FAILED', 'Checkout could not be confirmed. Please retry later.');
    }

    await db.transaction(async (tx) => {
      await markAttemptCheckoutCreated(tx, {
        attemptId: reservation.attemptId,
        stripeCheckoutSessionId: session.id,
      });
      await tx.update(smsTopupPurchaseSchema)
        .set({ stripeCheckoutSessionId: session.id })
        .where(and(
          eq(smsTopupPurchaseSchema.id, reservation.purchaseId),
          eq(smsTopupPurchaseSchema.salonId, salonId),
          isNull(smsTopupPurchaseSchema.stripeCheckoutSessionId),
        ));
    });
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
