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
 *
 * Owner authorization 2026-09-16 (Y1 / OP-1): the Portal is where a payment
 * method is replaced and a subscription is cancelled, so it resolves through
 * `requireAdminOwner` — a collaborator gets `403 OWNER_REQUIRED`.
 *
 * X5 (final handoff §6): the `return_url` origin comes from
 * `resolveBillingAppOrigin()` (`src/libs/billing/billingAppOrigin.ts`), never
 * from an inline `|| 'http://localhost:3000'` fallback. A caller-supplied
 * `returnUrl` is accepted only when it is BOTH same-origin with it and an
 * `http(s)` URL, and is rebuilt from its path rather than forwarded as-is.
 */
import * as Sentry from '@sentry/nextjs';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { requireAdminOwner } from '@/libs/adminAuth';
import { resolveBillingAppOrigin } from '@/libs/billing/billingAppOrigin';
import { db } from '@/libs/DB';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { stripe } from '@/libs/stripe';
import { billingSubscriptionSchema, salonSchema } from '@/models/Schema';

/**
 * X5: honour a caller-supplied `returnUrl` ONLY when it lands on this
 * deployment's own origin.
 *
 * TWO independent tests, both required — the origin comparison alone is not
 * enough. The candidate is resolved against `appOrigin`, so a relative path
 * (`/admin?tab=settings`) is accepted and returned absolute, since Stripe
 * requires an absolute `return_url`.
 *
 *   1. Same origin. An absolute foreign origin, a protocol-relative
 *      `//evil.example/x` and anything unparseable fail here.
 *   2. An `http(s)` protocol. This is NOT redundant with the first test:
 *      `blob:https://app.test/x` reports OUR origin and passes test 1. Do not
 *      remove it.
 *
 * The accepted value is REBUILT as origin + `pathname` + `search` + `hash`
 * rather than returned as-is, so credentials in an otherwise same-origin
 * `https://user:pass@app.test/x` cannot survive into the link Stripe renders.
 * For `http(s)` URLs the WHATWG parser guarantees `pathname` starts with `/`
 * and carries no raw `?` or `#`, so the reconstruction is exact.
 *
 * Anything rejected returns `null`, which the caller replaces with the
 * default return URL.
 */
function resolveSameOriginReturnUrl(candidate: unknown, appOrigin: string): string | null {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    return null;
  }

  try {
    const parsed = new URL(candidate, appOrigin);
    if (parsed.origin !== appOrigin) {
      return null;
    }

    // Same origin is necessary but not sufficient. `blob:https://app/xyz`
    // reports OUR origin and would reach Stripe as an unusable `return_url`,
    // and `https://user:pass@app/x` is same-origin while carrying credentials
    // into the link Stripe renders. Require a real http(s) navigation and
    // rebuild from the path so neither can survive.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return `${appOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

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

    // 2. Require OWNER access for this salon (Y1 / OP-1): the Portal manages
    //    the payment method and can cancel the subscription — a collaborator
    //    is refused `403 OWNER_REQUIRED` before any DB read or Stripe call.
    const authResult = await requireAdminOwner(salonId);
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

    // 7. Build the return URL. X5: the origin is resolved HERE — a pure
    //    environment read, taken BEFORE the Stripe call (this route makes no
    //    durable write of its own), so an unconfigured hosted deployment
    //    fails with no portal session created rather than returning a
    //    customer to `http://localhost:3000` after they changed their card.
    //    The throw is masked by this handler's outer catch as the route's
    //    existing 500 `PORTAL_ERROR`, with the cause captured to Sentry — no
    //    new public error vocabulary.
    const baseUrl = resolveBillingAppOrigin();
    const defaultReturnUrl = `${baseUrl}/admin?tab=billing`;

    // 8. Create Billing Portal Session. `returnUrl` is caller-supplied and
    //    was previously handed to Stripe unvalidated — an open-redirect
    //    surface: anyone who could reach this endpoint could have Stripe
    //    bounce the owner to a foreign origin from inside a trusted billing
    //    flow. A foreign or unparseable value now falls back to the default
    //    SILENTLY and deliberately: a management link that quietly returns
    //    the owner to their own dashboard is safer than a 400 that strands
    //    them outside the Portal, and the only thing lost is a return
    //    destination the caller was never entitled to choose.
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: resolveSameOriginReturnUrl(returnUrl, baseUrl) ?? defaultReturnUrl,
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
