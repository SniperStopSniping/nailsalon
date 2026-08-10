/**
 * Stripe-hosted onboarding `return_url`.
 *
 * GET /api/integrations/stripe-connect/return?s=<signed state>
 *
 * READY-1: arrival here is evidence of NOTHING. Readiness is never marked from
 * a redirect — it is only ever written by a sync from a fresh
 * `accounts.retrieve`.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/libs/adminAuth';
import { verifyOAuthState } from '@/libs/lusterSecurity';
import { getCanonicalAppOrigin } from '@/libs/publicUrl';
import { getSalonById } from '@/libs/queries';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import {
  type ConnectRedirectStatus,
  deriveConnectStatus,
  expectedLivemode,
  refreshAccountReadiness,
} from '@/libs/stripeConnect/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function adminRedirect(status: ConnectRedirectStatus, slug?: string): NextResponse {
  const base = getCanonicalAppOrigin();
  const url = new URL('/en/admin', base);
  if (slug) {
    url.searchParams.set('salon', slug);
    url.searchParams.set('app', 'integrations');
  }
  url.searchParams.set('stripe', status);
  return NextResponse.redirect(url, 302);
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = checkEndpointRateLimit('stripe-connect/return', ip, 'BILLING');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfterMs);
  }

  const state = new URL(request.url).searchParams.get('s');
  if (!state) {
    return adminRedirect('link_expired');
  }

  // `verifyOAuthState` THROWS on a tampered, mis-signed or expired state. It must
  // become the documented redirect, never an unhandled 500.
  let salonId: string;
  try {
    const payload = verifyOAuthState<{ provider?: string; salonId?: string }>(state);
    if (payload.provider !== 'stripe_connect' || !payload.salonId) {
      return adminRedirect('link_expired');
    }
    salonId = payload.salonId;
  } catch {
    return adminRedirect('link_expired');
  }

  // The state names a salon; it carries no privilege by itself.
  const auth = await requireAdmin(salonId);
  if (!auth.ok) {
    return adminRedirect('forbidden');
  }

  // Resolve the slug FROM THE ID, now. That is what makes the round trip
  // rename-proof: a slug renamed mid-onboarding would otherwise 404 the return.
  const salon = await getSalonById(salonId);
  if (!salon) {
    return adminRedirect('error');
  }

  let status: ConnectRedirectStatus;
  try {
    const decision = await refreshAccountReadiness(salonId);
    status = decision.binding
      ? deriveConnectStatus(decision.binding, expectedLivemode())
      : decision.status;
  } catch {
    // Tolerated: the owner is back from Stripe either way, and the next explicit
    // refresh will re-ask. `sync_failed` has no ConnectStatus member, which is
    // exactly why the redirect vocabulary is its own closed list.
    status = 'sync_failed';
  }

  return adminRedirect(status, salon.slug);
}
