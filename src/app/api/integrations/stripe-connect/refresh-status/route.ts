/**
 * Explicit "check my payment setup again" action.
 *
 * POST /api/integrations/stripe-connect/refresh-status
 * Body: { salonId }
 *
 * This is the ONLY owner-facing surface that performs a provider call. The
 * Payments card is fed from the cached binding row, so opening the Integrations
 * modal never talks to Stripe.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { type DepositsReadinessSqlHandle, isDepositsSchemaReady } from '@/libs/depositsSchema';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import {
  deriveConnectStatus,
  expectedLivemode,
  getAccountReadinessForDisplay,
  refreshAccountReadiness,
} from '@/libs/stripeConnect/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = checkEndpointRateLimit('stripe-connect/refresh-status', ip, 'BILLING');
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

  const auth = await requireAdmin(salonId);
  if (!auth.ok) {
    return auth.response;
  }

  if (!await isDepositsSchemaReady(db as DepositsReadinessSqlHandle)) {
    return errorResponse(
      'DEPOSITS_SCHEMA_NOT_PROVISIONED',
      'Deposits are not available yet.',
      503,
    );
  }

  let expected: boolean;
  try {
    expected = expectedLivemode();
  } catch {
    return errorResponse(
      'STRIPE_CONNECT_NOT_CONFIGURED',
      'Payments setup is not available yet.',
      503,
    );
  }

  try {
    const decision = await refreshAccountReadiness(salonId);
    const binding = decision.binding;
    return NextResponse.json({
      // The DISPLAY status, which may refine `charge_ready` into
      // `action_needed_soon`. `chargeReady` below is the separate money answer
      // and is deliberately not narrowed by that refinement.
      status: binding ? deriveConnectStatus(binding, expected) : decision.status,
      chargeReady: decision.chargeReady,
      payoutsPending: decision.chargeReady ? decision.payoutsPending : null,
      requirements: binding?.requirements ?? null,
      disabledReason: binding?.disabledReason ?? null,
      lastSyncedAt: binding?.lastSyncedAt ?? null,
      stale: false,
    });
  } catch {
    // Fail SOFT here, not closed: this endpoint gates nothing. It reports what we
    // last knew and says plainly that it is unconfirmed.
    const fallback = await getAccountReadinessForDisplay(salonId);
    const binding = fallback.decision.binding;
    return NextResponse.json({
      status: binding
        ? deriveConnectStatus(binding, expected)
        : fallback.decision.status,
      chargeReady: fallback.decision.chargeReady,
      payoutsPending: fallback.decision.chargeReady
        ? fallback.decision.payoutsPending
        : null,
      requirements: binding?.requirements ?? null,
      disabledReason: binding?.disabledReason ?? null,
      lastSyncedAt: fallback.lastSyncedAt,
      stale: true,
    });
  }
}
