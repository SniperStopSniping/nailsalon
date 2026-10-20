/**
 * Origin checks shared by the middleware boundary and sensitive route guards.
 * This module is intentionally dependency-free so it can run in Next's edge
 * middleware as well as in route handlers.
 */

const AUTH_SESSION_COOKIE_NAMES = new Set([
  'n5_admin_session',
  'staff_session',
  'client_session',
  'sa_impersonate',
  '__dev_role_override',
]);

/** Exact endpoints authenticated by provider signatures or machine secrets. */
const MACHINE_AUTH_API_PATHS = new Set([
  '/api/autopost/process',
  '/api/billing/readiness',
  '/api/billing/reconcile',
  '/api/billing/windows/evaluate',
  '/api/communications/dispatch',
  '/api/deposits/holds/reap',
  '/api/deposits/reconcile',
  '/api/integrations/outbox/process',
  '/api/integrations/twilio/deauthorize',
  '/api/integrations/twilio/inbound',
  '/api/integrations/twilio/status',
  '/api/network-no-show/reconcile',
  '/api/reminders/process',
  '/api/service-images/pending/cleanup',
  '/api/voice/maintenance',
  '/api/voice/twilio/dial-ended',
  '/api/voice/twilio/inbound',
  '/api/voice/twilio/status',
  '/api/webhooks/stripe',
  '/api/webhooks/stripe-billing',
  '/api/webhooks/stripe-connect',
]);

/** Cookie-issuing or cookie-changing routes which must be checked before a session exists. */
const SESSION_ESTABLISHING_API_PATHS = new Set([
  '/api/admin/auth/logout',
  '/api/admin/auth/password-login',
  '/api/admin/auth/send-otp',
  '/api/admin/auth/set-active-salon',
  '/api/admin/auth/verify-otp',
  '/api/auth/logout',
  '/api/auth/send-otp',
  '/api/auth/verify-otp',
  '/api/dev/role',
  '/api/staff/logout',
  '/api/staff/send-otp',
  '/api/staff/verify-otp',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type CookieLike = { name: string; value: string };

function hasSupportedAuthSessionCookie(cookies: readonly CookieLike[]): boolean {
  return cookies.some(({ name, value }) => Boolean(value.trim()) && (
    AUTH_SESSION_COOKIE_NAMES.has(name)
    || name === '__session'
    || /^__session_[\w-]+$/u.test(name)
  ));
}

/**
 * Resolve API paths for the browser-origin policy even when a URL layer has
 * encoded path separators or path characters. Only the literal canonical path
 * is eligible for machine-route exemptions; aliases are treated as browser
 * mutations when an application session cookie is present.
 */
function decodedApiPathForOriginPolicy(pathname: string): string | null {
  let candidate = pathname;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidate = candidate.replace(/\/{2,}/gu, '/');

    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) {
        return candidate.startsWith('/api/') ? candidate : null;
      }
      candidate = decoded;
    } catch {
      // Decode valid triplets even when another escape is malformed. If the
      // resulting path is an API alias, fail closed; any other malformed
      // encoded root segment is also treated as an API candidate below.
      const partiallyDecoded = candidate.replace(/%([\da-f]{2})/giu, (_match, hex: string) => (
        String.fromCharCode(Number.parseInt(hex, 16))
      )).replace(/\/{2,}/gu, '/');
      if (partiallyDecoded.startsWith('/api/')) {
        return partiallyDecoded;
      }
      return /^\/%/u.test(pathname) ? '/api/__malformed_path__' : null;
    }
  }

  const normalized = candidate.replace(/\/{2,}/gu, '/');
  return normalized.startsWith('/api/') ? normalized : null;
}

/**
 * Require a canonical serialized HTTP(S) origin and compare it to the origin
 * of the actual request URL. No Host or forwarded header is consulted.
 */
export function hasExactRequestOrigin(request: Pick<Request, 'headers' | 'url'>): boolean {
  const rawOrigin = request.headers.get('origin');
  if (!rawOrigin || rawOrigin === 'null') {
    return false;
  }

  try {
    const supplied = new URL(rawOrigin);
    const target = new URL(request.url);
    const isHttpOrigin = supplied.protocol === 'http:' || supplied.protocol === 'https:';
    const isHttpTarget = target.protocol === 'http:' || target.protocol === 'https:';
    return isHttpOrigin
      && isHttpTarget
      && supplied.username === ''
      && supplied.password === ''
      && supplied.origin === rawOrigin
      && supplied.origin === target.origin;
  } catch {
    return false;
  }
}

/**
 * Shared API middleware policy: protect unsafe requests carrying an
 * application auth cookie, plus the explicit session-establishing endpoints
 * that can run before one exists. Provider-signed and machine-secret routes
 * remain governed by their own authentication contract.
 */
export function shouldRequireApiRequestOrigin(input: {
  pathname: string;
  method: string;
  cookies: readonly CookieLike[];
}): boolean {
  const decodedApiPath = decodedApiPathForOriginPolicy(input.pathname);
  if (!decodedApiPath || SAFE_METHODS.has(input.method.toUpperCase())) {
    return false;
  }

  // Keep machine exemptions byte-exact. Encoded aliases must not inherit an
  // exemption intended for a provider-signed or machine-secret endpoint.
  if (decodedApiPath === input.pathname && MACHINE_AUTH_API_PATHS.has(input.pathname)) {
    return false;
  }

  if (SESSION_ESTABLISHING_API_PATHS.has(decodedApiPath)) {
    return true;
  }

  return hasSupportedAuthSessionCookie(input.cookies);
}
