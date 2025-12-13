import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { AllLocales, AppConfig } from './utils/AppConfig';

const intlMiddleware = createMiddleware({
  locales: AllLocales,
  localePrefix: AppConfig.localePrefix,
  defaultLocale: AppConfig.defaultLocale,
});

const isProtectedRoute = createRouteMatcher([
  '/onboarding(.*)',
  '/:locale/onboarding(.*)',
  // super-admin routes are protected, but NOT super-admin-login
  '/super-admin',
  '/super-admin/(.*)',
  '/:locale/super-admin',
  '/:locale/super-admin/(.*)',
  // API routes are handled separately - no auth for booking flow
]);

export default function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  // ==========================================================================
  // BLOCK DEV/DEMO ROUTES IN PRODUCTION
  // ==========================================================================
  // Route groups like (dev) don't appear in URLs, so we block actual paths.
  // Return 404 (not 403) to avoid leaking that these routes exist.
  // ==========================================================================
  const devPaths = ['/canvas-demo'];
  const isDevRoute = devPaths.some(path =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (isDevRoute && process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }

  // ==========================================================================
  // DEV ONLY: Bypass Clerk for super-admin when dev role cookie is set
  // ==========================================================================
  // Check both NODE_ENV and NEXT_PUBLIC_DEV_MODE for dev mode detection
  const isDevMode = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEV_MODE === 'true';
  const devRole = request.cookies.get('__dev_role_override')?.value;
  const p = request.nextUrl.pathname;

  if (isDevMode && devRole === 'super_admin') {
    // Bypass for super-admin API routes
    if (p.startsWith('/api/super-admin')) {
      return NextResponse.next();
    }

    // Bypass for super-admin pages - skip Clerk auth entirely
    // But NOT for super-admin-login (that's a public login page)
    const isSuperAdminPage
      = (p === '/super-admin' || p.startsWith('/super-admin/'))
      || /^\/[a-z]{2}\/super-admin(\/|$)/.test(p);
    const isSuperAdminLogin
      = p.includes('super-admin-login');

    if (isSuperAdminPage && !isSuperAdminLogin) {
      return NextResponse.next();
    }
  }

  // Super-admin API routes need Clerk auth
  if (request.nextUrl.pathname.startsWith('/api/super-admin')) {
    return clerkMiddleware()(request, event);
  }

  // Admin API routes need Clerk auth - run clerkMiddleware to set up auth context
  // but don't block - the route handlers will check auth themselves
  if (request.nextUrl.pathname.startsWith('/api/admin')
    || request.nextUrl.pathname.startsWith('/api/salon/services')) {
    return clerkMiddleware(async () => {
      // Just set up auth context, don't protect - route handlers check ownership
      return NextResponse.next();
    })(request, event);
  }

  // Skip middleware entirely for other API routes (booking flow, etc.)
  if (request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Redirect /sign-in and /sign-up to admin-login (phone OTP system)
  if (
    request.nextUrl.pathname.includes('/sign-in')
    || request.nextUrl.pathname.includes('/sign-up')
  ) {
    const locale = request.nextUrl.pathname.match(/^\/([a-z]{2})\//)?.at(1) ?? 'en';
    return NextResponse.redirect(new URL(`/${locale}/admin-login`, request.url));
  }

  if (isProtectedRoute(request)) {
    return clerkMiddleware(async (auth, req) => {
      const locale
        = req.nextUrl.pathname.match(/^\/([a-z]{2})\//)?.at(1) ?? 'en';

      // Determine correct login URL based on route
      // Super admin routes → super-admin-login, others → admin-login
      const isSuperAdminRoute
        = req.nextUrl.pathname.startsWith('/super-admin')
        || /^\/[a-z]{2}\/super-admin(\/|$)/.test(req.nextUrl.pathname);
      const loginPath = isSuperAdminRoute ? 'super-admin-login' : 'admin-login';
      const loginUrl = new URL(`/${locale}/${loginPath}`, req.url);

      await auth.protect({
        // `unauthenticatedUrl` is needed to avoid error: "Unable to find `next-intl` locale because the middleware didn't run on this request"
        unauthenticatedUrl: loginUrl.toString(),
      });

      return intlMiddleware(req);
    })(request, event);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next|monitoring).*)', '/', '/(api|trpc)(.*)'], // Also exclude tunnelRoute used in Sentry from the matcher
};
