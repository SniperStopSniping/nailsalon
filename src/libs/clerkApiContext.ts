/**
 * API path prefixes whose route handlers authenticate owners through
 * Clerk-backed guards (getAdminSession → Clerk auth()). The middleware must
 * wrap these requests in clerkMiddleware — context only, never protect() —
 * or Clerk's auth() throws inside the handler and the owner silently
 * resolves to "no admin session".
 *
 * /api/appointments is on this list because its action routes (manage,
 * cancel, complete, transition, resend-confirmation) and the create route's
 * admin paths (walk-ins, Google-event conversion) all call
 * requireAdmin/requireActiveAdminSalon. Guest booking requests through the
 * same prefix are unaffected: they simply carry an empty auth context.
 *
 * This list has silently drifted twice — first for /api/appointments (fixed in
 * 4c0b941), then for the whole /api/salon subtree beyond services, which left
 * Clerk-authenticated owners with an empty Add-ons tab and unusable page
 * themes, staff time-off and billing portal. Prefixes are therefore kept
 * SUBTREE-wide (trailing slash) rather than route-by-route, and
 * clerkApiContext.coverage.test.ts fails CI when a route calling an admin
 * guard is not matched here.
 */
const CLERK_CONTEXT_API_PREFIXES = [
  '/api/admin',
  // Whole subtree: services, add-ons, page-appearance are all owner-guarded.
  // Trailing slash so a future /api/salons is not swallowed by accident.
  '/api/salon/',
  '/api/onboarding',
  '/api/integrations',
  '/api/appointments',
  // checkout + portal both call requireAdmin.
  '/api/billing/',
  // Admin-only despite living under /api/staff: the owner UI manages a
  // technician's time off here. The staff portal uses /api/staff/time-off-requests.
  '/api/staff/time-off',
  // requireStaffOrAdminSalonAccess falls back to the admin session.
  '/api/staff/client/',
] as const;

export function apiPathNeedsClerkContext(pathname: string): boolean {
  return CLERK_CONTEXT_API_PREFIXES.some(prefix => pathname.startsWith(prefix));
}
