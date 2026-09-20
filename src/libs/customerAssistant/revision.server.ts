import 'server-only';

import { createHash } from 'node:crypto';

import { redis } from '@/core/redis/redisClient';

import type { CustomerConversation } from './conversation.server';

export const CUSTOMER_REVISION_TTL_SECONDS = 2 * 60 * 60 + 60;

type Revision = Pick<CustomerConversation, 'salonId' | 'sessionId' | 'turnIndex'>;

export function customerConversationDigest(conversation: string): string {
  return createHash('sha256').update(conversation).digest('base64url');
}

export function customerRevisionKey(state: Pick<Revision, 'salonId' | 'sessionId'>): string {
  const scope = (process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development').replace(/[^\w-]/g, '_').slice(0, 64) || 'development';
  const identity = createHash('sha256').update(JSON.stringify([state.salonId, state.sessionId])).digest('base64url');
  return `luster:customer-booking-assistant:v1:{customer-booking-assistant}:${scope}:revision:${identity}`;
}

async function evaluate(script: string, state: Revision, conversation: string): Promise<boolean> {
  if (!redis) {
    return false;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      redis.eval(script, 1, customerRevisionKey(state), String(state.turnIndex), customerConversationDigest(conversation), String(CUSTOMER_REVISION_TTL_SECONDS)),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1_000);
        timer.unref?.();
      }),
    ]);
    return result === 1 || result === '1';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const COMPLETE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'inflight') ~= tostring(tonumber(ARGV[1]) - 1) then return 0 end
redis.call('HSET', KEYS[1], 'completed', ARGV[1], 'digest', ARGV[2])
redis.call('HDEL', KEYS[1], 'inflight')
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

const CURRENT_SCRIPT = `
if redis.call('HEXISTS', KEYS[1], 'inflight') == 1 then return 0 end
if redis.call('HGET', KEYS[1], 'completed') ~= ARGV[1] then return 0 end
if redis.call('HGET', KEYS[1], 'digest') ~= ARGV[2] then return 0 end
return 1
`;

/** A reservation becomes actionable only after its exact signed result is committed. */
export async function completeCustomerRevision(state: Revision, conversation: string): Promise<boolean> {
  return evaluate(COMPLETE_SCRIPT, state, conversation);
}

/** The final acceptance linearization point, also used to reject obsolete cached replies. */
export async function isCurrentCustomerRevision(state: Revision, conversation: string): Promise<boolean> {
  return evaluate(CURRENT_SCRIPT, state, conversation);
}
