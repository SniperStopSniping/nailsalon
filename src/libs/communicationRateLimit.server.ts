/**
 * Shared-sender outbound rate limits — Redis-backed, multi-instance,
 * degrade CLOSED.
 *
 * Contract: provider sends must never proceed unenforced — a Redis outage
 * DEFERS the send (the dispatcher re-queues), it never opens the gate.
 * (Short-link READS deliberately use the opposite posture in their route.)
 */

import 'server-only';

import { createHash } from 'node:crypto';

import { redis } from '@/core/redis/redisClient';

export const SHARED_SEND_RATE_LIMITS = {
  salonHourly: { limit: 60, windowSeconds: 3600 },
  salonDaily: { limit: 500, windowSeconds: 86400 },
  /** Recipient-only key ON PURPOSE: three salons must not send one client 18 texts a day. */
  recipientDaily: { limit: 6, windowSeconds: 86400 },
} as const;

function hashKey(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24);
}

export type SharedSendRateResult =
  | { allowed: true }
  | { allowed: false; reason: 'SALON_HOURLY' | 'SALON_DAILY' | 'RECIPIENT_DAILY' | 'LIMITER_UNAVAILABLE' };

async function bumpWindow(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (redis === null) {
    // No Redis in this environment: degrade CLOSED (the caller defers).
    throw new Error('LIMITER_UNAVAILABLE');
  }
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= limit;
}

export async function checkSharedSendRateLimits(input: {
  salonId: string;
  recipient: string;
}): Promise<SharedSendRateResult> {
  try {
    const salonHash = hashKey(input.salonId);
    const recipientHash = hashKey(input.recipient);
    const checks: Array<[key: string, limit: number, window: number, reason: 'SALON_HOURLY' | 'SALON_DAILY' | 'RECIPIENT_DAILY']> = [
      [`smsrl:sh:${salonHash}`, SHARED_SEND_RATE_LIMITS.salonHourly.limit, SHARED_SEND_RATE_LIMITS.salonHourly.windowSeconds, 'SALON_HOURLY'],
      [`smsrl:sd:${salonHash}`, SHARED_SEND_RATE_LIMITS.salonDaily.limit, SHARED_SEND_RATE_LIMITS.salonDaily.windowSeconds, 'SALON_DAILY'],
      [`smsrl:rd:${recipientHash}`, SHARED_SEND_RATE_LIMITS.recipientDaily.limit, SHARED_SEND_RATE_LIMITS.recipientDaily.windowSeconds, 'RECIPIENT_DAILY'],
    ];
    for (const [key, limit, windowSeconds, reason] of checks) {
      const ok = await bumpWindow(key, limit, windowSeconds);
      if (!ok) {
        return { allowed: false, reason };
      }
    }
    return { allowed: true };
  } catch {
    // Degrade CLOSED: a limiter outage defers the send.
    return { allowed: false, reason: 'LIMITER_UNAVAILABLE' };
  }
}
