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
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/libs/adminAuth';
import { beginCheckoutAttempt, failAttempt, markAttemptCheckoutCreated } from '@/libs/billing/checkoutAttempts';
import { resolveTopupAudienceForLegacyPlan } from '@/libs/billing/legacyPlanAdapter';
import { BillingCatalogError, resolveStripePriceIdForTopup } from '@/libs/billing/stripePriceMap';
import { getTopupOffer } from '@/libs/billing/topupOffers';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { stripe } from '@/libs/stripe';
import { billingCheckoutAttemptSchema, salonSchema, smsTopupPurchaseSchema } from '@/models/Schema';

const CHECKOUT_SESSION_TTL_MS = 55 * 60 * 1000;

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
      // Precreate the durable purchase record (§9.2): the webhook fulfills
      // against THIS row on verified payment evidence, snapshotting the
      // offer, credits and price at purchase time.
      const purchaseId = `stp_${crypto.randomUUID()}`;
      await tx.insert(smsTopupPurchaseSchema).values({
        id: purchaseId,
        salonId,
        topupOfferKey: offer.key,
        credits: offer.credits,
        amountCents: offer.priceCents,
        currency: 'cad',
        status: 'checkout_created',
      }).onConflictDoNothing();
      const [attemptRow] = await tx
        .select({ stripeCheckoutSessionId: billingCheckoutAttemptSchema.stripeCheckoutSessionId })
        .from(billingCheckoutAttemptSchema)
        .where(eq(billingCheckoutAttemptSchema.id, attempt.attemptId))
        .limit(1);
      return {
        kind: 'reserved' as const,
        attemptId: attempt.attemptId,
        stripeIdempotencyKey: attempt.stripeIdempotencyKey,
        reused: attempt.reused,
        existingSessionId: attemptRow?.stripeCheckoutSessionId ?? null,
        purchaseId,
      };
    });
    if (reservation.kind === 'conflict') {
      return errorJson(409, 'CHECKOUT_IN_PROGRESS', 'Another checkout is already in progress for this salon.');
    }
    if (reservation.reused && reservation.existingSessionId !== null) {
      const existing = await stripe.checkout.sessions.retrieve(reservation.existingSessionId);
      return NextResponse.json({ data: { sessionId: existing.id, url: existing.url, reused: true } });
    }

    const baseUrl = Env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          ...(salon.stripeCustomerId
            ? { customer: salon.stripeCustomerId }
            : { customer_email: salon.stripeCustomerEmail ?? salon.ownerEmail ?? undefined }),
          line_items: [{ price: stripePriceId, quantity: 1 }],
          success_url: `${baseUrl}/admin?topup=success`,
          cancel_url: `${baseUrl}/admin?topup=cancelled`,
          expires_at: Math.floor((now.getTime() + CHECKOUT_SESSION_TTL_MS) / 1000),
          metadata: {
            purpose: 'sms_topup',
            salonId,
            topupOfferKey: offer.key,
            purchaseId: reservation.purchaseId,
            attemptId: reservation.attemptId,
          },
        },
        { idempotencyKey: reservation.stripeIdempotencyKey },
      );
    } catch (error) {
      await db.transaction(async (tx) => {
        await failAttempt(tx, { attemptId: reservation.attemptId });
        await tx.update(smsTopupPurchaseSchema)
          .set({ status: 'canceled' })
          .where(eq(smsTopupPurchaseSchema.id, reservation.purchaseId));
      });
      Sentry.captureException(error, { tags: { endpoint: 'billing/checkout-topup' } });
      return errorJson(502, 'CHECKOUT_CREATE_FAILED', 'The payment provider rejected the checkout request.');
    }

    await db.transaction(async (tx) => {
      await markAttemptCheckoutCreated(tx, {
        attemptId: reservation.attemptId,
        stripeCheckoutSessionId: session.id,
      });
      await tx.update(smsTopupPurchaseSchema)
        .set({ stripeCheckoutSessionId: session.id })
        .where(eq(smsTopupPurchaseSchema.id, reservation.purchaseId));
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
