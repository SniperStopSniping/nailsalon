/**
 * Stripe Billing Portal Session
 *
 * Creates a Stripe Billing Portal session for managing subscriptions.
 * Allows customers to:
 * - Update payment method
 * - Cancel subscription
 * - View invoices
 *
 * POST /api/billing/portal
 * Body: { salonId, returnUrl? }
 *
 * P5b (G41, D18, D9): this is a LIVE route used by legacy-flow customers —
 * behaviour for them must not change. The new billing domain writes
 * `billing_subscription.stripe_customer_id` (never the legacy
 * `salon.stripeCustomerId` column, which stays owned by the legacy
 * `/api/webhooks/stripe` route per contract §5), so a new-track subscriber
 * used to hit NO_BILLING_ACCOUNT here even with a live subscription (G41).
 * Customer resolution now prefers the salon's LIVE `billing_subscription`
 * row (status NOT IN ('canceled','incomplete_expired'), most recently
 * updated among ties — the same live-row preference the usage route encodes,
 * `src/app/api/admin/salon/communications/usage/route.ts`), falling back to
 * the legacy salon column when no live row exists, and finally to the most
 * recently updated `billing_subscription` row of ANY status — so a canceled
 * new-track subscriber who never had a legacy Stripe customer still keeps
 * portal access instead of hitting NO_BILLING_ACCOUNT. No dark switch (D9):
 * this route stays available for legacy-flow customers regardless of
 * `BILLING_*` state.
 */
import * as Sentry from '@sentry/nextjs';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { stripe } from '@/libs/stripe';
import { billingSubscriptionSchema, salonSchema } from '@/models/Schema';

// =============================================================================
// POST - Create Billing Portal Session
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // 0. Rate limit check
    const ip = getClientIp(request);
    const rateLimit = checkEndpointRateLimit('billing/portal', ip, 'BILLING');
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfterMs);
    }

    // 1. Parse request body
    const body = await request.json();
    const { salonId, returnUrl } = body as {
      salonId?: string;
      returnUrl?: string;
    };

    if (!salonId) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'salonId is required' } },
        { status: 400 },
      );
    }

    // 2. Require admin access for this salon
    const authResult = await requireAdmin(salonId);
    if (!authResult.ok) {
      return authResult.response;
    }

    // 3. Load salon (existence check + legacy compatibility projection)
    const [salon] = await db
      .select({
        id: salonSchema.id,
        stripeCustomerId: salonSchema.stripeCustomerId,
      })
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
        { status: 404 },
      );
    }

    // 4. Resolve the Stripe customer (G41): prefer the salon's LIVE
    //    `billing_subscription` row (status NOT IN
    //    ('canceled','incomplete_expired') — the same live-row preference
    //    the usage route encodes, `communications/usage/route.ts`), most
    //    recently updated among ties; falling back to the legacy
    //    `salon.stripeCustomerId` projection when no live row exists. A
    //    canceled/incomplete_expired billing_subscription row (e.g. an
    //    abandoned new-track attempt) never shadows a still-present legacy
    //    customer id — only a genuinely live new-track subscription's
    //    customer should be trusted over the legacy compatibility column.
    const [subscription] = await db
      .select({ stripeCustomerId: billingSubscriptionSchema.stripeCustomerId })
      .from(billingSubscriptionSchema)
      .where(and(
        eq(billingSubscriptionSchema.salonId, salonId),
        sql`${billingSubscriptionSchema.status} not in ('canceled', 'incomplete_expired')`,
      ))
      .orderBy(desc(billingSubscriptionSchema.updatedAt))
      .limit(1);

    let stripeCustomerId: string | null = subscription?.stripeCustomerId ?? salon.stripeCustomerId ?? null;

    // 5. Last resort: neither a live row nor the legacy column resolved a
    //    customer — fall back to the most recently updated
    //    `billing_subscription` row of ANY status (e.g. a canceled new-track
    //    subscriber who never had a legacy Stripe customer id). Only reached
    //    when steps 4's live-row and legacy lookups both came up empty.
    if (!stripeCustomerId) {
      const [anyStatusSubscription] = await db
        .select({ stripeCustomerId: billingSubscriptionSchema.stripeCustomerId })
        .from(billingSubscriptionSchema)
        .where(eq(billingSubscriptionSchema.salonId, salonId))
        .orderBy(desc(billingSubscriptionSchema.updatedAt))
        .limit(1);
      stripeCustomerId = anyStatusSubscription?.stripeCustomerId ?? null;
    }

    // 6. Require existing Stripe customer
    if (!stripeCustomerId) {
      return NextResponse.json(
        {
          error: {
            code: 'NO_BILLING_ACCOUNT',
            message: 'No billing account found. Please subscribe to a plan first.',
          },
        },
        { status: 400 },
      );
    }

    // 7. Build return URL
    const baseUrl = Env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const defaultReturnUrl = `${baseUrl}/admin?tab=billing`;

    // 8. Create Billing Portal Session
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl || defaultReturnUrl,
    });

    // 9. Return portal URL
    return NextResponse.json({
      url: session.url,
    });
  } catch (error) {
    // G26: never pass a raw error message back to the client — capture to
    // Sentry (server-side, no secrets) and return a fixed message instead.
    Sentry.captureException(error, {
      tags: { endpoint: 'billing/portal' },
    });

    return NextResponse.json(
      { error: { code: 'PORTAL_ERROR', message: 'The billing portal is temporarily unavailable.' } },
      { status: 500 },
    );
  }
}
