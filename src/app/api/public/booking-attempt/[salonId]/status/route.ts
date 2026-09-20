import { getBookingIdempotencyKey } from '@/core/redis/keys';
import { isRedisAvailable, redis } from '@/core/redis/redisClient';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson } from '@/libs/customerAssistant/http.server';
import {
  publicBookingRecoveryRequestSchema,
  readPublicBookingRecoveryReceipt,
} from '@/libs/publicBookingRecovery.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Reads the original creation receipt only. It never replays creation, checks
 * current appointment state, or calls a provider, so an unresolved response is
 * deliberately not evidence that the original booking did not happen.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ salonId: string }> },
): Promise<Response> {
  if (!isCustomerSameOrigin(request)) {
    return new Response(null, { status: 403, headers: CUSTOMER_NO_STORE });
  }

  const body = publicBookingRecoveryRequestSchema.safeParse(await readCustomerJson(request));
  if (!body.success) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }

  const { salonId } = await context.params;
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
