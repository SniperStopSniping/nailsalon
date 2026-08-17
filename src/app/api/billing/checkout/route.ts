/**
 * Server-authoritative subscription Checkout — Gate C2.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §8.5,
 * §12, §3.4, §7.3.
 *
 * POST /api/billing/checkout
 * Body: { salonId, billingOfferKey, promotionKey? } — domain identifiers
 * ONLY. This route replaced a legacy handler that accepted a client-supplied
 * Stripe `priceId` and client redirect URLs; the browser now never selects a
 * Price ID, an amount, a discount, a renewal price or a redirect target. The
 * server resolves plan, cadence, price, environment-scoped Stripe mapping,
 * promotion eligibility, founding math and disclosure.
 *
 * Ordering is load-bearing:
 *   1. BILLING_SUBSCRIPTIONS_ENABLED gate — before parsing, before any
 *      attempt or claim slot is consumed, before any Stripe call (§12).
 *   2. Catalogue + promotion validation, and Stripe ID resolution — a
 *      placeholder mapping throws PRICE_UNCONFIGURED here, so a dark or
 *      misconfigured environment can never reach the provider.
 *   3. TX1: durable checkout attempt (serialization + ACTIVE_SUBSCRIPTION_
 *      EXISTS) and, for founding checkouts, the promotion claim — RESERVED
 *      BEFORE the Stripe session exists (§7.3), committed so a crash between
 *      here and Stripe leaves durable evidence, never a phantom session.
 *   4. Stripe session create under the attempt-derived idempotency key —
 *      a browser double-click or retry replays the SAME key and cannot mint
 *      a second session; an attempt that already carries a session returns
 *      it instead of calling create again.
 *   5. TX2: session id recorded on attempt + claim.
 *
 * The Checkout Session expires BEFORE the promotion claim TTL (55 min vs
 * 60 min): a session that can outlive its claim could complete after the
 * claim expired and another business took the last cap slot — the cap would
 * be breached by a customer we already let pay.
 */
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/libs/adminAuth';
import { getBillingOffer } from '@/libs/billing/billingOffers';
import { resolveOrCreateBusinessIdentity } from '@/libs/billing/businessIdentity';
import {
  beginCheckoutAttempt,
  failAttempt,
  markAttemptCheckoutCreated,
} from '@/libs/billing/checkoutAttempts';
import { getPlanDefinition } from '@/libs/billing/planDefinitions';
import {
  releasePromotionClaim,
  reservePromotionClaim,
} from '@/libs/billing/promotionClaims';
import {
  computeFoundingFirstTermCents,
  getPromotion,
  isOfferEligibleForPromotion,
  isPromotionWindowOpen,
} from '@/libs/billing/promotions';
import {
  BillingCatalogError,
  resolveStripeCouponIdForPromotion,
  resolveStripePriceIdForOffer,
} from '@/libs/billing/stripePriceMap';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { stripe } from '@/libs/stripe';
import { billingCheckoutAttemptSchema, billingPromotionClaimSchema, salonSchema } from '@/models/Schema';

/** Session lifetime — strictly inside the 60-minute promotion-claim TTL. */
const CHECKOUT_SESSION_TTL_MS = 55 * 60 * 1000;

const requestSchema = z
  .object({
    salonId: z.string().min(1),
    billingOfferKey: z.string().min(1),
    promotionKey: z.string().min(1).optional(),
  })
  .strict();

type ErrorBody = { error: { code: string; message: string } };

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json<ErrorBody>({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  try {
    // 1. Dark switch — the control boundary, ahead of everything else.
    if (Env.BILLING_SUBSCRIPTIONS_ENABLED !== 'true') {
      return errorJson(503, 'BILLING_DISABLED', 'Subscription billing is not enabled.');
    }

    const ip = getClientIp(request);
    const rateLimit = checkEndpointRateLimit('billing/checkout', ip, 'BILLING');
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfterMs);
    }

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorJson(400, 'INVALID_INPUT', 'salonId and billingOfferKey are required; Stripe identifiers and amounts are never accepted.');
    }
    const { salonId, billingOfferKey, promotionKey } = parsed.data;

    const authResult = await requireAdmin(salonId);
    if (!authResult.ok) {
      return authResult.response;
    }

    // 2. Catalogue validation — all of it before any durable write.
    const offer = getBillingOffer(billingOfferKey);
    if (offer === null || !offer.activeForNewSubscriptions) {
      return errorJson(400, 'UNKNOWN_OFFER', 'The requested billing offer is not available.');
    }
    const plan = getPlanDefinition(offer.planDefinitionKey);
    if (plan === null || !plan.active) {
      return errorJson(400, 'UNKNOWN_OFFER', 'The requested billing offer is not available.');
    }

    const now = new Date();
    const promotion = promotionKey !== undefined ? getPromotion(promotionKey) : null;
    if (promotionKey !== undefined) {
      if (promotion === null) {
        return errorJson(400, 'PROMOTION_UNKNOWN', 'The requested promotion does not exist.');
      }
      if (!isOfferEligibleForPromotion(promotion, offer.key)) {
        return errorJson(400, 'PROMOTION_NOT_ELIGIBLE', 'This promotion does not apply to the requested offer.');
      }
      if (!isPromotionWindowOpen(promotion, now)) {
        return errorJson(400, 'PROMOTION_CLOSED', 'This promotion is not currently open.');
      }
    }

    // 3. Environment-scoped Stripe mappings. Placeholder ids throw here —
    //    before any attempt, claim or provider call (§12).
    let stripePriceId: string;
    let stripeCouponId: string | null = null;
    try {
      stripePriceId = resolveStripePriceIdForOffer(offer.key);
      if (promotion !== null) {
        stripeCouponId = resolveStripeCouponIdForPromotion(promotion.key);
      }
    } catch (error) {
      if (error instanceof BillingCatalogError) {
        return errorJson(503, 'PRICE_UNCONFIGURED', 'Billing prices are not configured in this environment.');
      }
      throw error;
    }

    const [salon] = await db
      .select({
        id: salonSchema.id,
        slug: salonSchema.slug,
        ownerEmail: salonSchema.ownerEmail,
        // Read-only compatibility projection: reused when present so one
        // salon does not accrete Stripe customers, but this route never
        // writes legacy salon columns (§5 — the legacy webhook owns them).
        stripeCustomerId: salonSchema.stripeCustomerId,
        stripeCustomerEmail: salonSchema.stripeCustomerEmail,
      })
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);
    if (!salon) {
      return errorJson(404, 'SALON_NOT_FOUND', 'Salon not found.');
    }

    // 4. TX1 — durable attempt + claim-before-Checkout.
    const clerkUserId = authResult.admin.clerkUserId ?? null;
    const reservation = await db.transaction(async (tx) => {
      const attempt = await beginCheckoutAttempt(tx, {
        salonId,
        purpose: 'plan_subscription',
        billingOfferKey: offer.key,
        promotionKey: promotion?.key ?? null,
        now,
      });
      if (!attempt.ok) {
        return { kind: 'conflict' as const, reason: attempt.reason };
      }
      let claimId: string | null = null;
      if (promotion !== null) {
        const identity = await resolveOrCreateBusinessIdentity(tx, {
          clerkUserId,
          salonId,
          stripeCustomerId: salon.stripeCustomerId ?? null,
        });
        const claim = await reservePromotionClaim(tx, {
          promotionKey: promotion.key,
          businessIdentityId: identity.businessIdentityId,
          salonId,
          checkoutAttemptId: attempt.attemptId,
          now,
        });
        if (!claim.ok) {
          // The attempt row must not linger as a live slot for a checkout
          // that will never happen.
          await failAttempt(tx, { attemptId: attempt.attemptId });
          return { kind: 'promotion_refused' as const, reason: claim.reason };
        }
        claimId = claim.claimId;
      }
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
        claimId,
      };
    });

    if (reservation.kind === 'conflict') {
      return errorJson(409, 'ACTIVE_SUBSCRIPTION_EXISTS', 'This salon already has a live subscription. Manage it in the Billing Portal.');
    }
    if (reservation.kind === 'promotion_refused') {
      const message = reservation.reason === 'REDEMPTION_CAP_REACHED'
        ? 'This promotion has reached its redemption limit.'
        : 'This promotion has already been claimed for this business.';
      return errorJson(409, reservation.reason, message);
    }

    // 5. A still-active attempt that already owns a session returns it —
    //    browser retry and double-click land here, never on a second create.
    if (reservation.reused && reservation.existingSessionId !== null) {
      const existing = await stripe.checkout.sessions.retrieve(reservation.existingSessionId);
      return NextResponse.json({
        data: {
          sessionId: existing.id,
          url: existing.url,
          reused: true,
          disclosure: buildDisclosure(offer, plan, promotion),
        },
      });
    }

    // 6. Provider call under the attempt-derived idempotency key.
    const baseUrl = Env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          // Reuse the known customer; otherwise let Checkout create one —
          // this route never pre-creates provider objects.
          ...(salon.stripeCustomerId
            ? { customer: salon.stripeCustomerId }
            : { customer_email: salon.stripeCustomerEmail ?? salon.ownerEmail ?? undefined }),
          line_items: [{ price: stripePriceId, quantity: 1 }],
          ...(stripeCouponId !== null
            ? { discounts: [{ coupon: stripeCouponId }] }
            : {}),
          // Success URLs are never authoritative (§8.5): fulfillment happens
          // exclusively in the stripe-billing webhook.
          success_url: `${baseUrl}/admin?billing=success`,
          cancel_url: `${baseUrl}/admin?billing=cancelled`,
          expires_at: Math.floor((now.getTime() + CHECKOUT_SESSION_TTL_MS) / 1000),
          metadata: buildMetadata(salonId, offer.key, plan.key, promotion?.key, reservation.attemptId),
          subscription_data: {
            metadata: buildMetadata(salonId, offer.key, plan.key, promotion?.key, reservation.attemptId),
          },
        },
        { idempotencyKey: reservation.stripeIdempotencyKey },
      );
    } catch (error) {
      // The durable evidence must not stay live for a session that was never
      // created: fail the attempt, release the claim (§7.3 rule 4).
      await db.transaction(async (tx) => {
        await failAttempt(tx, { attemptId: reservation.attemptId });
        if (reservation.claimId !== null) {
          await releasePromotionClaim(tx, { claimId: reservation.claimId, now: new Date() });
        }
      });
      Sentry.captureException(error, { tags: { endpoint: 'billing/checkout' } });
      return errorJson(502, 'CHECKOUT_CREATE_FAILED', 'The payment provider rejected the checkout request.');
    }

    // 7. TX2 — record the session on attempt and claim.
    await db.transaction(async (tx) => {
      await markAttemptCheckoutCreated(tx, {
        attemptId: reservation.attemptId,
        stripeCheckoutSessionId: session.id,
      });
      if (reservation.claimId !== null) {
        await tx
          .update(billingPromotionClaimSchema)
          .set({ stripeCheckoutSessionId: session.id })
          .where(eq(billingPromotionClaimSchema.id, reservation.claimId));
      }
    });

    return NextResponse.json({
      data: {
        sessionId: session.id,
        url: session.url,
        reused: false,
        disclosure: buildDisclosure(offer, plan, promotion),
      },
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { endpoint: 'billing/checkout' } });
    return errorJson(500, 'CHECKOUT_ERROR', 'Checkout could not be started.');
  }
}

function buildMetadata(
  salonId: string,
  billingOfferKey: string,
  planDefinitionKey: string,
  promotionKey: string | undefined,
  attemptId: string,
) {
  return {
    purpose: 'plan_subscription',
    salonId,
    billingOfferKey,
    planDefinitionKey,
    ...(promotionKey !== undefined ? { promotionKey } : {}),
    attemptId,
  };
}

/**
 * Renewal + rate-protection disclosure (§3.9, §8.5). Three DISTINCT numbers,
 * never conflated: what the first term costs, what renewal costs, and how
 * long the founding base rate is protected.
 */
function buildDisclosure(
  offer: NonNullable<ReturnType<typeof getBillingOffer>>,
  plan: NonNullable<ReturnType<typeof getPlanDefinition>>,
  promotion: ReturnType<typeof getPromotion>,
) {
  return {
    billingOfferKey: offer.key,
    planDefinitionKey: plan.key,
    cadence: offer.cadence,
    currency: offer.currency,
    firstTermCents: promotion !== null ? computeFoundingFirstTermCents(offer) : offer.priceCents,
    renewalCents: offer.priceCents,
    ...(promotion !== null
      ? { promotionKey: promotion.key, rateProtectionMonths: promotion.rateProtectionMonths }
      : {}),
  };
}
