/**
 * Begin or resume Stripe-hosted Connect onboarding for one salon.
 *
 * POST /api/integrations/stripe-connect/onboard
 * Body: { salonId }
 * → { url } — the client navigates to Stripe.
 *
 * BIND-1: no request-shaped account-id surface exists here. The
 * `stripe_account_id` we persist can only ever come from this server's own
 * `stripe.accounts.create` return value, in this same request.
 */
import * as Sentry from '@sentry/nextjs';
import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { type DepositsReadinessSqlHandle, isDepositsSchemaReady } from '@/libs/depositsSchema';
import { Env } from '@/libs/Env';
import { resolveRuntimeEnvironment } from '@/libs/environmentIsolation';
import { getCanonicalAppOrigin } from '@/libs/publicUrl';
import { getSalonById } from '@/libs/queries';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import {
  createOnboardingLink,
  ensureConnectedAccount,
  getSalonBindings,
} from '@/libs/stripeConnect/binding';
import {
  expectedLivemode,
  StripeConnectUnavailableError,
} from '@/libs/stripeConnect/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Temporary pilot allowlist. This is ONE OF EXACTLY TWO read sites in D2 — the
 * other is the Payments card in `IntegrationsModal.tsx`. They are not redundant:
 * the card gate is a VISIBILITY control and this one is the EXPOSURE control, and
 * an unrendered card does not make this endpoint unreachable. A later PR replaces
 * both reads with a real per-salon entitlement and deletes the env var.
 */
function isPilotSalon(salonId: string): boolean {
  const raw = Env.LUSTER_DEPOSITS_PILOT_SALON_IDS ?? '';
  return raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .includes(salonId);
}

export async function POST(request: NextRequest) {
  // 1. Rate limit before anything else — every call here is a potential
  //    outbound account create.
  const ip = getClientIp(request);
  const rateLimit = checkEndpointRateLimit('stripe-connect/onboard', ip, 'BILLING');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfterMs);
  }

  let salonId: string | undefined;
  try {
    const body = await request.json() as { salonId?: string };
    salonId = body?.salonId;
  } catch {
    return errorResponse('INVALID_INPUT', 'salonId is required', 400);
  }

  if (!salonId) {
    return errorResponse('INVALID_INPUT', 'salonId is required', 400);
  }

  // 2. Server-authoritative tenancy. Every action below is bound to this id.
  const auth = await requireAdmin(salonId);
  if (!auth.ok) {
    return auth.response;
  }
  const actor = {
    actorId: auth.admin.id,
    viaSuperAdminWithoutMembership: Boolean(auth.admin.isSuperAdmin)
      && !auth.admin.salons.some(membership => membership.salonId === salonId),
  };

  // 3. Schema preflight FIRST among the config checks: the exposure gate below
  //    reads `salon_stripe_account`, which does not exist before 0065 is applied.
  //    Without this ordering that read would surface as an unhandled 500 instead
  //    of a typed refusal.
  if (!await isDepositsSchemaReady(db as DepositsReadinessSqlHandle)) {
    return errorResponse(
      'DEPOSITS_SCHEMA_NOT_PROVISIONED',
      'Deposits are not available yet.',
      503,
    );
  }

  // 4. Salon existence/active check, BEFORE any provider call. `requireAdmin`
  //    performs no salon lookup and super-admins short-circuit membership, so
  //    without this a privileged caller creates a real Stripe account and only
  //    then hits an unhandled foreign-key violation.
  const salon = await getSalonById(salonId);
  if (!salon) {
    return errorResponse('SALON_NOT_FOUND', 'Salon not found', 404);
  }

  // 5. Exposure gate. Refused with the SAME shape as step 4 on purpose, so the
  //    endpoint does not confirm to a prober which salons are in the pilot.
  //    The second clause is load-bearing: it keeps the gate from stranding a
  //    salon that was removed from the allowlist mid-onboarding — an
  //    already-bound salon can always resume, revoke and re-bind.
  const bindings = await getSalonBindings(salonId);
  if (!isPilotSalon(salonId) && bindings.length === 0) {
    return errorResponse('SALON_NOT_FOUND', 'Salon not found', 404);
  }

  // 6. Remaining config preflight, all before `accounts.create`.
  if (!Env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    // A binding created while the Connect endpoint is dead has no lifecycle
    // signal at all: `account.application.deauthorized` is one-shot and is
    // dropped after Stripe's 3-day retry window.
    return errorResponse(
      'STRIPE_CONNECT_NOT_CONFIGURED',
      'Payments setup is not available yet.',
      503,
    );
  }
  if (!Env.OAUTH_STATE_SECRET) {
    return errorResponse(
      'STRIPE_CONNECT_NOT_CONFIGURED',
      'Payments setup is not available yet.',
      503,
    );
  }

  let livemode: boolean;
  try {
    livemode = expectedLivemode();
  } catch {
    return errorResponse(
      'STRIPE_CONNECT_NOT_CONFIGURED',
      'Payments setup is not available yet.',
      503,
    );
  }

  // Live mode requires HTTPS refresh/return URLs. Without this pre-check
  // `accounts.create` succeeds, the binding is written, and `accountLinks.create`
  // is then rejected forever — each retry minting another orphan account.
  let origin: string;
  try {
    origin = getCanonicalAppOrigin();
  } catch {
    return errorResponse(
      'STRIPE_CONNECT_MISCONFIGURED_ORIGIN',
      'Payments setup is misconfigured.',
      500,
    );
  }
  if (livemode && new URL(origin).protocol !== 'https:') {
    Sentry.captureMessage('stripe_connect_misconfigured_origin', {
      level: 'error',
      tags: { integration: 'stripe-connect' },
    });
    return errorResponse(
      'STRIPE_CONNECT_MISCONFIGURED_ORIGIN',
      'Payments setup is misconfigured.',
      500,
    );
  }

  // 7. Bind, then mint the hosted link.
  const result = await ensureConnectedAccount({
    salonId,
    runtimeEnvironment: resolveRuntimeEnvironment(),
    actor,
  });

  if (!result.ok) {
    switch (result.code) {
      case 'CONNECT_CREATE_REPLAYED':
        return errorResponse(
          'CONNECT_CREATE_REPLAYED',
          'Payments setup could not be completed. Please try again.',
          409,
        );
      case 'CONNECT_CREATE_IN_PROGRESS':
        return errorResponse(
          'CONNECT_CREATE_IN_PROGRESS',
          'Payments setup is already in progress. Please try again shortly.',
          409,
        );
      case 'CONNECT_CREATE_PARAMS_CHANGED':
        return errorResponse(
          'CONNECT_CREATE_PARAMS_CHANGED',
          'Payments setup could not be completed.',
          409,
        );
      case 'STRIPE_UNAVAILABLE':
        // Sanitized, no DB write, retry-safe via the idempotency key.
        return errorResponse(
          'STRIPE_UNAVAILABLE',
          'Payments provider is unavailable. Please try again shortly.',
          502,
        );
      default:
        return errorResponse(
          'CONNECT_SETUP_FAILED',
          'Payments setup could not be completed.',
          500,
        );
    }
  }

  try {
    const url = await createOnboardingLink(result.binding, salon);
    // The link itself is single-use and minutes-lived: returned, never stored,
    // never logged.
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof StripeConnectUnavailableError) {
      return errorResponse(
        'STRIPE_UNAVAILABLE',
        'Payments provider is unavailable. Please try again shortly.',
        502,
      );
    }
    Sentry.captureException(error, {
      tags: { integration: 'stripe-connect', stage: 'accountLinks.create' },
    });
    return errorResponse(
      'CONNECT_SETUP_FAILED',
      'Payments setup could not be completed.',
      500,
    );
  }
}
