/**
 * Short appointment-management link — GET /a/{token}.
 *
 * A Route Handler (never a page): emits no HTML carrying the token,
 * redirects same-origin to the canonical long manage path derived SOLELY
 * from the resolved capability (never from a query param, header or the
 * salon's custom domain — a tenant-supplied host would receive the
 * capability token cross-origin).
 *
 * Response properties (contract §9 short-link):
 * - 302 (never 301: a cached capability redirect is a capability leak);
 * - Cache-Control: no-store, Referrer-Policy: no-referrer, X-Robots-Tag;
 * - identical opaque response for expired, revoked and unknown tokens
 *   (no enumeration oracle);
 * - rate-limited per IP; read path degrades OPEN on limiter trouble (a
 *   limiter outage must not break every customer's link — the CLOSED
 *   posture is for sends, not reads).
 *
 * INERT IN GATE B: nothing mints these links in production yet.
 */
import { db } from '@/libs/DB';
import { checkEndpointRateLimit, getClientIp } from '@/libs/rateLimit';
import { resolveShortManageToken } from '@/libs/shortManageLink';
import { AppConfig } from '@/utils/AppConfig';

const OPAQUE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

function invalidLinkResponse(): Response {
  return new Response('This link is no longer valid.', {
    status: 404,
    headers: { ...OPAQUE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const ip = getClientIp(request);
  const rateLimit = checkEndpointRateLimit('short-link/resolve', ip, 'GENERAL');
  if (!rateLimit.allowed) {
    // Same opaque shape — a limited caller learns nothing about validity.
    return invalidLinkResponse();
  }

  const { token } = await context.params;
  const resolution = await resolveShortManageToken(db, token);
  if (!resolution.ok) {
    return invalidLinkResponse();
  }

  const target = `/${AppConfig.defaultLocale}/${encodeURIComponent(resolution.salonSlug)}/manage/${encodeURIComponent(token)}`;
  return new Response(null, {
    status: 302,
    headers: { ...OPAQUE_HEADERS, Location: target },
  });
}
