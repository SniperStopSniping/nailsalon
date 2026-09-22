import { getBookingIdempotencyKey } from '@/core/redis/keys';
import { isRedisAvailable, redis } from '@/core/redis/redisClient';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson } from '@/libs/customerAssistant/http.server';
import { publicBookingAttemptStatusRequestSchema, readPublicBookingAttemptStatus } from '@/libs/publicBookingAttempt.server';
import { checkPublicBookingAttemptRateLimit } from '@/libs/publicBookingAttemptRateLimit';
import {
  publicBookingRecoveryRequestSchema,
  readPublicBookingRecoveryReceipt,
} from '@/libs/publicBookingRecovery.server';
import { getClientIp } from '@/libs/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Resolves proof-bound v2 attempts from durable database authority; legacy v1
 * attempts retain receipt-only recovery. This never replays creation or calls a
 * provider. An unresolved response is never evidence that creation failed.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ salonId: string }> },
): Promise<Response> {
  if (!isCustomerSameOrigin(request)) {
    return new Response(null, { status: 403, headers: CUSTOMER_NO_STORE });
  }

  const rawBody = await readCustomerJson(request);
  const durableBody = publicBookingAttemptStatusRequestSchema.safeParse(rawBody);
  const body = publicBookingRecoveryRequestSchema.safeParse(rawBody);
  if (!durableBody.success && !body.success) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }

  const { salonId } = await context.params;
  try {
    if (!await checkPublicBookingAttemptRateLimit(getClientIp(request), salonId)) {
      return Response.json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' } }, { status: 429, headers: CUSTOMER_NO_STORE });
    }
  } catch {
    return Response.json({ error: { code: 'BOOKING_ATTEMPT_RATE_LIMIT_UNAVAILABLE', message: 'Booking recovery is temporarily unavailable. Please try again.' } }, { status: 503, headers: CUSTOMER_NO_STORE });
  }
  if (durableBody.success && durableBody.data.version === 2) {
    try {
      return Response.json(await readPublicBookingAttemptStatus({ salonId, ...durableBody.data }), { headers: CUSTOMER_NO_STORE });
    } catch {
      return Response.json({ kind: 'unknown' }, { headers: CUSTOMER_NO_STORE });
    }
  }
  if (!body.success) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }
  try {
    if (!redis || !await isRedisAvailable()) {
      return Response.json({ kind: 'unresolved' }, { headers: CUSTOMER_NO_STORE });
    }
    const cacheKey = getBookingIdempotencyKey(salonId, body.data.attemptId);
    const response = readPublicBookingRecoveryReceipt(await redis.get(cacheKey), body.data.recoveryKey);
    return Response.json(
      response ? { kind: 'resolved', response } : { kind: 'unresolved' },
      { headers: CUSTOMER_NO_STORE },
    );
  } catch {
    // Redis failures are ambiguous, never proof that creation failed.
    return Response.json({ kind: 'unresolved' }, { headers: CUSTOMER_NO_STORE });
  }
}
