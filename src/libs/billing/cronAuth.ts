/**
 * Constant-time authorization for the billing cron routes — G27.
 *
 * `/api/billing/reconcile` and `/api/billing/windows/evaluate` each carried
 * an identical `isAuthorized()` helper that compared the request against
 * `CRON_SECRET` with `===`. A plain string comparison short-circuits on the
 * first mismatched byte, which leaks timing information about how much of
 * the secret an attacker has guessed correctly — a real side-channel on a
 * secret that gates provider-facing billing jobs. Extracted here (outside
 * `src/app/api/billing`, so it is not subject to that tree's CI allowlist)
 * so both routes share one constant-time implementation.
 *
 * Accepts the SAME two header forms the original per-route helpers accepted:
 * a raw `x-cron-secret` header equal to the secret, or
 * `Authorization: Bearer <secret>`.
 */
import 'server-only';

import { timingSafeEqual } from 'node:crypto';

/**
 * `timingSafeEqual` throws on a length mismatch, so every comparison is
 * guarded by an explicit length check first — a length-mismatched or absent
 * value is simply unauthorized, never a thrown error.
 */
function constantTimeEquals(candidate: string, expected: Buffer): boolean {
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  return candidateBuffer.length === expected.length && timingSafeEqual(candidateBuffer, expected);
}

export function isAuthorizedCronRequest(request: Request, secret: string | undefined): boolean {
  if (!secret) {
    return false;
  }
  const expected = Buffer.from(secret, 'utf8');

  const header = request.headers.get('x-cron-secret');
  if (header !== null && constantTimeEquals(header, expected)) {
    return true;
  }

  const bearer = request.headers.get('authorization');
  if (bearer !== null && constantTimeEquals(bearer, Buffer.from(`Bearer ${secret}`, 'utf8'))) {
    return true;
  }

  return false;
}
