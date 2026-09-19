import 'server-only';

import { createHash } from 'node:crypto';

import { redis } from '@/core/redis/redisClient';

import { CUSTOMER_CONVERSATION_MAX_TURNS } from './conversation.server';

const KEY_PREFIX = 'luster:customer-booking-assistant:v1';
const CLUSTER_HASH_TAG = '{customer-booking-assistant}';
// Consumed tokens remain replay-protected beyond the full absolute conversation lifetime.
const SESSION_TTL_SECONDS = 2 * 60 * 60 + 60;
const MINUTE_TTL_SECONDS = 2 * 60;
const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;
const MONTH_TTL_SECONDS = 35 * 24 * 60 * 60;
const EVAL_TIMEOUT_MS = 1_000;
export const CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD = 20_000;

export type CustomerAssistantReservation =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'conversation_used' | 'stale_conversation' | 'session_limit' | 'unavailable' };

export type CustomerAssistantTurnInput = {
  salonId: string;
  sessionId: string;
  turnIndex: number;
  clientIp: string;
  now?: Date;
};

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function deploymentScope(): string {
  const raw = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return raw.replace(/[^\w-]/g, '_').slice(0, 64) || 'development';
}

function day(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function month(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** Exported for tests and operational inspection; no key contains a raw IP. */
export function buildCustomerAssistantBudgetKeys(input: CustomerAssistantTurnInput): string[] {
  const now = input.now ?? new Date();
  const prefix = `${KEY_PREFIX}:${CLUSTER_HASH_TAG}:${deploymentScope()}`;
  const session = hashIdentifier(input.sessionId);
  const ip = hashIdentifier(input.clientIp.trim());
  const currentDay = day(now);
  return [
    `${prefix}:replay:${session}:${input.turnIndex}`,
    `${prefix}:session:${session}`,
    `${prefix}:ip:${ip}:minute:${currentDay}:${now.getUTCHours()}:${now.getUTCMinutes()}`,
    `${prefix}:ip:${ip}:day:${currentDay}`,
    `${prefix}:salon:${input.salonId}:day:${currentDay}`,
    `${prefix}:salon:${input.salonId}:month:${month(now)}`,
    `${prefix}:global:day:${currentDay}`,
    `${prefix}:spend:global:day:${currentDay}`,
  ];
}

// Lua return codes: 0 success, 1 replay/session; 2 any shared traffic budget.
const RESERVE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end
local sessionCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local ipMinuteCount = tonumber(redis.call('GET', KEYS[3]) or '0')
local ipDayCount = tonumber(redis.call('GET', KEYS[4]) or '0')
local salonDayCount = tonumber(redis.call('GET', KEYS[5]) or '0')
local salonMonthCount = tonumber(redis.call('GET', KEYS[6]) or '0')
local globalDayCount = tonumber(redis.call('GET', KEYS[7]) or '0')
if sessionCount >= tonumber(ARGV[1]) then return 3 end
if ipMinuteCount >= tonumber(ARGV[2]) then return 2 end
if ipDayCount >= tonumber(ARGV[3]) then return 2 end
if salonDayCount >= tonumber(ARGV[4]) then return 2 end
if salonMonthCount >= tonumber(ARGV[5]) then return 2 end
if globalDayCount >= tonumber(ARGV[6]) then return 2 end
if not redis.call('SET', KEYS[1], '1', 'EX', ARGV[7], 'NX') then return 1 end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], ARGV[7]) end
if redis.call('INCR', KEYS[3]) == 1 then redis.call('EXPIRE', KEYS[3], ARGV[8]) end
if redis.call('INCR', KEYS[4]) == 1 then redis.call('EXPIRE', KEYS[4], ARGV[9]) end
if redis.call('INCR', KEYS[5]) == 1 then redis.call('EXPIRE', KEYS[5], ARGV[9]) end
if redis.call('INCR', KEYS[6]) == 1 then redis.call('EXPIRE', KEYS[6], ARGV[10]) end
if redis.call('INCR', KEYS[7]) == 1 then redis.call('EXPIRE', KEYS[7], ARGV[9]) end
if redis.call('INCRBY', KEYS[8], ARGV[11]) == tonumber(ARGV[11]) then redis.call('EXPIRE', KEYS[8], ARGV[9]) end
return 0
`;

async function settleWithinOneSecond<T>(work: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), EVAL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function reserveCustomerAssistantTurn(
  input: CustomerAssistantTurnInput,
): Promise<CustomerAssistantReservation> {
  if (!redis || !input.salonId || !input.sessionId || !input.clientIp.trim()
    || !Number.isInteger(input.turnIndex) || input.turnIndex < 0) {
    return { ok: false, reason: 'unavailable' };
  }
  if (input.turnIndex >= CUSTOMER_CONVERSATION_MAX_TURNS) {
    return { ok: false, reason: 'session_limit' };
  }

  try {
    const keys = buildCustomerAssistantBudgetKeys(input);
    const result = await settleWithinOneSecond(redis.eval(
      RESERVE_SCRIPT,
      keys.length,
      ...keys,
      String(CUSTOMER_CONVERSATION_MAX_TURNS),
      '6',
      '60',
      '100',
      '1500',
      '1000',
      String(SESSION_TTL_SECONDS),
      String(MINUTE_TTL_SECONDS),
      String(DAY_TTL_SECONDS),
      String(MONTH_TTL_SECONDS),
      String(CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD),
    ) as Promise<unknown>);
    const code = typeof result === 'number'
      ? result
      : typeof result === 'string' && /^[0-3]$/.test(result)
        ? Number(result)
        : Number.NaN;
    if (code === 0) {
      return { ok: true };
    }
    if (code === 1) {
      return { ok: false, reason: 'stale_conversation' };
    }
    if (code === 3) {
      return { ok: false, reason: 'session_limit' };
    }
    if (code === 2) {
      return { ok: false, reason: 'rate_limited' };
    }
  } catch {
    // Customer traffic must not reach the provider if the reservation authority is unhealthy.
  }
  return { ok: false, reason: 'unavailable' };
}
