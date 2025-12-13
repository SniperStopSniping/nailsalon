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

    // 3. Load salon
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

    // 4. Require existing Stripe customer
    if (!salon.stripeCustomerId) {
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

    // 5. Build return URL
    const baseUrl = Env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const defaultReturnUrl = `${baseUrl}/admin?tab=billing`;

    // 6. Create Billing Portal Session
    const session = await stripe.billingPortal.sessions.create({
      customer: salon.stripeCustomerId,
      return_url: returnUrl || defaultReturnUrl,
    });

    // 7. Return portal URL
    return NextResponse.json({
      url: session.url,
    });
  } catch (error) {
    console.error('[Billing Portal] Error:', error);

    // Capture to Sentry with context (no secrets)
    Sentry.captureException(error, {
      tags: { endpoint: 'billing/portal' },
    });

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'PORTAL_ERROR', message } },
      { status: 500 },
    );
  }
}
