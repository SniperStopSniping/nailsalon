/**
 * Stripe-hosted onboarding `refresh_url`.
 *
 * GET /api/integrations/stripe-connect/refresh?s=<signed state>
 *
 * Stripe sends the owner here when a hosted link expires mid-flow. Account Links
 * are single-use and minutes-lived, and an `account_update` link is unavailable
 * for full-dashboard accounts, so every resume re-mints an `account_onboarding`
 * link.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/libs/adminAuth';
import { verifyOAuthState } from '@/libs/lusterSecurity';
import { getCanonicalAppOrigin } from '@/libs/publicUrl';
import { getSalonById } from '@/libs/queries';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { createOnboardingLink, getLiveBinding } from '@/libs/stripeConnect/binding';
import type { ConnectRedirectStatus } from '@/libs/stripeConnect/readiness';

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
  // FIRST. Every GET here is one outbound `accountLinks.create`, and both Stripe
  // and a browser can loop this URL.
  const ip = getClientIp(request);
  const rateLimit = checkEndpointRateLimit('stripe-connect/refresh', ip, 'BILLING');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfterMs);
  }

  const state = new URL(request.url).searchParams.get('s');
  if (!state) {
    return adminRedirect('link_expired');
  }

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

  // Auth failures redirect. They never return a JSON 404 — the human at this URL
  // came from Stripe's hosted flow and needs somewhere to land.
  const auth = await requireAdmin(salonId);
  if (!auth.ok) {
    return adminRedirect('forbidden');
  }

  const salon = await getSalonById(salonId);
  const binding = await getLiveBinding(salonId);
  if (!binding) {
    return adminRedirect('error', salon?.slug);
  }

  try {
    const url = await createOnboardingLink(binding, { id: salonId });
    return NextResponse.redirect(url, 302);
  } catch {
    return adminRedirect('error', salon?.slug);
  }
}
