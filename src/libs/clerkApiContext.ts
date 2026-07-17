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
 */
const CLERK_CONTEXT_API_PREFIXES = [
  '/api/admin',
  '/api/salon/services',
  '/api/onboarding',
  '/api/integrations',
  '/api/appointments',
] as const;

export function apiPathNeedsClerkContext(pathname: string): boolean {
  return CLERK_CONTEXT_API_PREFIXES.some(prefix => pathname.startsWith(prefix));
}
