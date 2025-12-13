/**
 * Stripe Checkout Session Creation
 *
 * Creates a Stripe Checkout session for subscription upgrades.
 * Requires admin auth for the salon.
 *
 * POST /api/billing/checkout
 * Body: { salonId, priceId, successUrl?, cancelUrl? }
 */
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { stripe } from '@/libs/stripe';
import { salonSchema } from '@/models/Schema';
import { PricingPlanList } from '@/utils/AppConfig';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get the correct price ID based on BILLING_PLAN_ENV
 */
function getPriceIdForEnv(plan: (typeof PricingPlanList)[string]): string {
  switch (Env.BILLING_PLAN_ENV) {
    case 'prod':
      return plan.prodPriceId;
    case 'test':
      return plan.testPriceId;
    case 'dev':
    default:
      return plan.devPriceId;
  }
}

/**
 * Validate that the provided priceId matches a valid plan for the current env
 */
function isValidPriceId(priceId: string): boolean {
  return Object.values(PricingPlanList).some((plan) => {
    const envPriceId = getPriceIdForEnv(plan);
    return envPriceId === priceId && priceId !== '';
  });
}

// =============================================================================
// POST - Create Checkout Session
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // 0. Rate limit check
    const ip = getClientIp(request);
    const rateLimit = checkEndpointRateLimit('billing/checkout', ip, 'BILLING');
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfterMs);
    }

    // 1. Parse request body
    const body = await request.json();
    const { salonId, priceId, successUrl, cancelUrl } = body as {
      salonId?: string;
      priceId?: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    if (!salonId || !priceId) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'salonId and priceId are required' } },
        { status: 400 },
      );
    }

    // 2. Require admin access for this salon
    const authResult = await requireAdmin(salonId);
    if (!authResult.ok) {
      return authResult.response;
    }

    // 3. Validate priceId matches a plan for current env
    if (!isValidPriceId(priceId)) {
      return NextResponse.json(
        { error: { code: 'INVALID_PRICE', message: 'Invalid price ID for current environment' } },
        { status: 400 },
      );
    }

    // 4. Load salon
    const [salon] = await db
      .select({
        id: salonSchema.id,
        name: salonSchema.name,
        slug: salonSchema.slug,
        stripeCustomerId: salonSchema.stripeCustomerId,
        stripeCustomerEmail: salonSchema.stripeCustomerEmail,
        ownerEmail: salonSchema.ownerEmail,
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

    // 5. Create or reuse Stripe Customer
    let stripeCustomerId = salon.stripeCustomerId;

    if (!stripeCustomerId) {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: salon.stripeCustomerEmail || salon.ownerEmail || undefined,
        name: salon.name,
        metadata: {
          salonId: salon.id,
          salonSlug: salon.slug,
        },
      });

      stripeCustomerId = customer.id;

      // Store customer ID for future use
      await db
        .update(salonSchema)
        .set({
          stripeCustomerId: customer.id,
          stripeCustomerEmail: customer.email || undefined,
          updatedAt: new Date(),
        })
        .where(eq(salonSchema.id, salonId));
    }

    // 6. Build success/cancel URLs
    const baseUrl = Env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const defaultSuccessUrl = `${baseUrl}/admin?billing=success`;
    const defaultCancelUrl = `${baseUrl}/admin?billing=cancelled`;

    // 7. Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl || defaultSuccessUrl,
      cancel_url: cancelUrl || defaultCancelUrl,
      // CRITICAL: Set metadata on session AND subscription
      metadata: {
        salonId: salon.id,
      },
      subscription_data: {
        metadata: {
          salonId: salon.id,
        },
      },
      // Allow promo codes
      allow_promotion_codes: true,
    });

    // 8. Return session URL
    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('[Billing Checkout] Error:', error);

    // Capture to Sentry with context (no secrets)
    Sentry.captureException(error, {
      tags: { endpoint: 'billing/checkout' },
    });

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'CHECKOUT_ERROR', message } },
      { status: 500 },
    );
  }
}
