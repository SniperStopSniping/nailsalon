import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { apiPathNeedsClerkContext } from './libs/clerkApiContext';
import { getCanonicalAppOrigin } from './libs/publicUrl';
import {
  ACTIVE_SALON_COOKIE,
  getSalonSlugFromHostname,
  getSalonSlugFromPathname,
  isTenantSubdomainSlugEnabled,
  normalizeSalonSlug,
} from './libs/tenantSlug';
import { AllLocales, AppConfig } from './utils/AppConfig';

const intlMiddleware = createMiddleware({
  locales: AllLocales,
  localePrefix: AppConfig.localePrefix,
  defaultLocale: AppConfig.defaultLocale,
});

const isProtectedRoute = createRouteMatcher([
  '/onboarding(.*)',
  '/:locale/onboarding(.*)',
  // Super-admin pages use the database-backed HttpOnly session and enforce it
  // in their server components. Clerk protects owner onboarding only.
  // API routes are handled separately - no auth for booking flow
]);

const isPublicClerkRoute = createRouteMatcher([
  '/join(.*)',
  '/:locale/join(.*)',
]);

const isPublicOnboardingV1Route = createRouteMatcher([
  '/onboarding-v1(.*)',
  '/:locale/onboarding-v1(.*)',
]);

const isOwnerBookingPagePreviewRoute = createRouteMatcher([
  '/admin/booking-page/preview/(.*)',
  '/:locale/admin/booking-page/preview/(.*)',
]);

const isOwnerAdminPageRoute = createRouteMatcher([
  '/admin(.*)',
  '/:locale/admin(.*)',
]);

export default async function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  const requestedHost = request.headers.get('host') ?? request.nextUrl.hostname;
  const candidateHostnameSalonSlug = getSalonSlugFromHostname(requestedHost);
  const hostnameSalonSlug = candidateHostnameSalonSlug
    && isTenantSubdomainSlugEnabled(candidateHostnameSalonSlug)
    ? candidateHostnameSalonSlug
    : null;
  const pathnameSalonSlug = getSalonSlugFromPathname(
    request.nextUrl.pathname,
    AllLocales,
  );
  const requestedSalonSlug = hostnameSalonSlug ?? pathnameSalonSlug ?? normalizeSalonSlug(
    request.nextUrl.searchParams.get('salonSlug'),
  );
  const finalizeResponse = (response: NextResponse) => {
    if (requestedSalonSlug) {
      const proto = request.headers.get('x-forwarded-proto');
      const secure = proto
        ? proto === 'https'
        : request.nextUrl.protocol === 'https:';

      response.cookies.set(ACTIVE_SALON_COOKIE, requestedSalonSlug, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
        secure,
      });
    }

    return response;
  };

  // ==========================================================================
  // DEV ONLY: Bypass Clerk for super-admin when dev role cookie is set
  // ==========================================================================
  // Check both NODE_ENV and NEXT_PUBLIC_DEV_MODE for dev mode detection
  const isDevMode = process.env.NODE_ENV !== 'production';
  const devRole = request.cookies.get('__dev_role_override')?.value;
  const p = request.nextUrl.pathname;
  const authorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const clerkOptions = authorizedParties.length > 0 ? { authorizedParties } : undefined;

  // Wildcard tenant hosts share the same deployment. Public paths are rewritten
  // to the existing locale/slug route tree; APIs and owner/admin routes keep
  // their canonical paths.
  if (hostnameSalonSlug && !p.startsWith('/api')) {
    const rawSegments = p.split('/').filter(Boolean);
    const hasLocale = rawSegments[0] && AllLocales.includes(rawSegments[0]);
    const locale = hasLocale ? rawSegments.shift()! : AppConfig.defaultLocale;
    const firstPublicSegment = rawSegments[0];
    const isOwnerPath = firstPublicSegment === 'admin'
      || firstPublicSegment === 'super-admin'
      || firstPublicSegment === 'onboarding'
      || firstPublicSegment === 'onboarding-v1'
      || firstPublicSegment === 'owner-sign-in'
      || firstPublicSegment === 'owner-sign-up'
      || firstPublicSegment === 'owner'
      || firstPublicSegment === 'join';

    if (isOwnerPath) {
      const canonicalUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, getCanonicalAppOrigin());
      return finalizeResponse(NextResponse.redirect(canonicalUrl));
    }

    if (!isOwnerPath && rawSegments[0] !== hostnameSalonSlug) {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = `/${locale}/${hostnameSalonSlug}${rawSegments.length ? `/${rawSegments.join('/')}` : ''}`;
      return finalizeResponse(NextResponse.rewrite(rewriteUrl));
    }
  }

  if (p === '/owner') {
    return finalizeResponse(
      NextResponse.redirect(new URL(`/${AppConfig.defaultLocale}/owner-sign-in`, request.url)),
    );
  }

  // Host-relative customer management links (`https://<salon-domain>/manage/<token>`)
  // carry no locale or slug — the token identifies the salon. The locale
  // middleware would rewrite this to `/<locale>/manage/<token>`, which matches
  // the tenant tree as slug="manage" and 404s, so the root /manage/[...path]
  // route never runs. Let it through untouched; that route resolves the salon
  // from the token and continues to the canonical path itself.
  //
  // Deliberately scoped to the top-level path only: `/en/<slug>/manage/<token>`
  // still goes through the normal locale handling below.
  if (p === '/manage' || p.startsWith('/manage/')) {
    return finalizeResponse(NextResponse.next());
  }

  // Short appointment-management links (/a/<token>) need the identical
  // carve-out: next-intl's as-needed locale prefix would rewrite this to
  // /<locale>/a/<token>, matching the tenant tree as slug="a" and 404ing
  // before the route handler ever runs.
  if (p === '/a' || p.startsWith('/a/')) {
    return finalizeResponse(NextResponse.next());
  }

  if (isDevMode && devRole === 'super_admin') {
    // Bypass for super-admin API routes
    if (p.startsWith('/api/super-admin')) {
      return finalizeResponse(NextResponse.next());
    }

    // Bypass for super-admin pages - skip Clerk auth entirely
    // But NOT for super-admin-login (that's a public login page)
    const isSuperAdminPage
      = (p === '/super-admin' || p.startsWith('/super-admin/'))
      || /^\/[a-z]{2}\/super-admin(?:\/|$)/.test(p);
    const isSuperAdminLogin
      = p.includes('super-admin-login');

    if (isSuperAdminPage && !isSuperAdminLogin) {
      return finalizeResponse(NextResponse.next());
    }
  }

  // Super-admin API routes need Clerk auth
  if (request.nextUrl.pathname.startsWith('/api/super-admin')) {
    const response = await clerkMiddleware(clerkOptions)(request, event);
    return finalizeResponse((response as NextResponse | undefined) ?? NextResponse.next());
  }

  // Routes whose handlers authenticate owners via Clerk-backed guards need
  // clerkMiddleware to set up auth context — but never block here; the route
  // handlers check auth themselves. This includes /api/appointments: without
  // Clerk context, owners could load the admin dashboard yet not manage
  // appointments or convert Google events (auth() throws → admin resolves
  // to null on exactly those routes).
  if (apiPathNeedsClerkContext(request.nextUrl.pathname)) {
    const response = await clerkMiddleware(async () => {
      // Just set up auth context, don't protect - route handlers check ownership
      return NextResponse.next();
    }, clerkOptions)(request, event);
    return finalizeResponse((response as NextResponse | undefined) ?? NextResponse.next());
  }

  // Skip middleware entirely for other API routes (booking flow, etc.)
  if (request.nextUrl.pathname.startsWith('/api')) {
    return finalizeResponse(NextResponse.next());
  }

  // The private full-page/embedded booking-page preview resolves Clerk owners
  // through getAdminSession() on the server. Establish Clerk request context
  // only when the request actually carries the Clerk session cookie that
  // getAdminSession() consumes. Requests using the repository's signed legacy
  // super-admin impersonation path must not be diverted into Clerk's dev-browser
  // handshake, while anonymous requests need no Clerk context at all. Every
  // path still reaches the same salon-specific server authorization gate;
  // absence, expiry, forgery, or a wrong-salon session returns 404 before DRAFT
  // content renders.
  if (isOwnerBookingPagePreviewRoute(request)) {
    const response = request.cookies.get('__session')?.value
      ? await clerkMiddleware(
        async (_auth, req) => intlMiddleware(req),
        clerkOptions,
      )(request, event)
      : intlMiddleware(request);
    const finalized = finalizeResponse(
      (response as NextResponse | undefined) ?? NextResponse.next(),
    );
    finalized.headers.set('Cache-Control', 'private, no-store, max-age=0');
    finalized.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return finalized;
  }

  // Owner Workspace pages resolve Clerk-backed owners through
  // getAdminSession(). Establish Clerk request context only when the request
  // actually carries Clerk's session cookie. Anonymous and repository legacy
  // session/impersonation paths continue through the existing server guards
  // without a Clerk handshake.
  if (isOwnerAdminPageRoute(request)) {
    const response = request.cookies.get('__session')?.value
      ? await clerkMiddleware(
        async (_auth, req) => intlMiddleware(req),
        clerkOptions,
      )(request, event)
      : intlMiddleware(request);
    return finalizeResponse((response as NextResponse | undefined) ?? NextResponse.next());
  }

  // Invitation pages are public, but their server component calls Clerk auth()
  // to continue already-signed-in owners into onboarding.
  if (isPublicClerkRoute(request)) {
    const response = await clerkMiddleware(async (_auth, req) => intlMiddleware(req), clerkOptions)(
      request,
      event,
    );
    return finalizeResponse((response as NextResponse | undefined) ?? NextResponse.next());
  }

  // Onboarding V1 intentionally shows the completed customer-site value
  // before account creation. Anonymous requests deliberately avoid Clerk's
  // development-browser handshake: on a plain local/LAN HTTP origin that
  // handshake cannot retain its cross-site cookie and loops before the public
  // onboarding page can render. Once Clerk has established a real `__session`
  // cookie, preserve server auth context so an existing owner can resume and
  // save immediately. The claim APIs establish their own Clerk context and
  // remain the authenticated persistence boundary.
  if (isPublicOnboardingV1Route(request)) {
    const response = request.cookies.get('__session')?.value
      ? await clerkMiddleware(
        async (_auth, req) => intlMiddleware(req),
        clerkOptions,
      )(request, event)
      : intlMiddleware(request);
    return finalizeResponse((response as NextResponse | undefined) ?? NextResponse.next());
  }

  // Generic auth routes now lead to Clerk owner email/password authentication.
  if (
    /\/(?:sign-in|sign-up)(?:\/|$)/.test(request.nextUrl.pathname)
  ) {
    const locale = request.nextUrl.pathname.match(/^\/([a-z]{2})\//)?.at(1) ?? 'en';
    return finalizeResponse(
      NextResponse.redirect(new URL(`/${locale}/owner-sign-in`, request.url)),
    );
  }

  if (isProtectedRoute(request)) {
    const response = await clerkMiddleware(async (auth, req) => {
      const locale
        = req.nextUrl.pathname.match(/^\/([a-z]{2})\//)?.at(1) ?? 'en';

      const loginUrl = new URL(`/${locale}/owner-sign-in`, req.url);

      await auth.protect({
        // `unauthenticatedUrl` is needed to avoid error: "Unable to find `next-intl` locale because the middleware didn't run on this request"
        unauthenticatedUrl: loginUrl.toString(),
      });

      return intlMiddleware(req);
    }, clerkOptions)(request, event);
    return finalizeResponse((response as NextResponse | undefined) ?? NextResponse.next());
  }

  return finalizeResponse(intlMiddleware(request));
}

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next|monitoring).*)', '/', '/(api|trpc)(.*)'], // Also exclude tunnelRoute used in Sentry from the matcher
};
