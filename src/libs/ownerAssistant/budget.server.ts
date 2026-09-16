import 'server-only';

import { redis } from '@/core/redis/redisClient';

import { OWNER_ASSISTANT_LIMITS } from './contracts';

/**
 * Per-turn budget reservation (docs/OWNER_ASSISTANT_CHAT.md §4 step 6).
 *
 * Three counters — salon/day, salon/month, all-salons/day — are checked
 * TOGETHER and incremented only if all three have room, in one Lua script, so
 * two concurrent turns can never both squeeze past the last unit and a
 * rejected turn never consumes a unit of the other scopes.
 *
 * This module never throws at the route: Redis being absent, slow or angry is
 * an availability answer (`redis_unavailable`), not a 500.
 */

const KEY_PREFIX = 'luster:owner-assistant:v1:';
const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;
const MONTH_TTL_SECONDS = 35 * 24 * 60 * 60;
const EVAL_TIMEOUT_MS = 1_000;

export type BudgetReservation =
  | { ok: true }
  | { ok: false; reason: 'budget_exhausted'; scope: 'day' | 'month' | 'global' }
  | { ok: false; reason: 'redis_unavailable' };

/**
 * Check all three counters, then increment all three. Returns 0 on success or
 * the index (1..3) of the first exhausted scope. TTLs are set on the first
 * write of a window; an existing TTL is left alone so a window cannot be
 * extended indefinitely by traffic.
 */
const RESERVE_SCRIPT = `
local dayCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local monthCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local globalCount = tonumber(redis.call('GET', KEYS[3]) or '0')
if dayCount >= tonumber(ARGV[1]) then return 1 end
if monthCount >= tonumber(ARGV[2]) then return 2 end
if globalCount >= tonumber(ARGV[3]) then return 3 end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[4]) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], ARGV[5]) end
if redis.call('INCR', KEYS[3]) == 1 then redis.call('EXPIRE', KEYS[3], ARGV[4]) end
return 0
`;

/** UTC date keys — the limits are defined per UTC day/month, not per salon tz. */
function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function utcMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function buildBudgetKeys(salonId: string, now: Date): [string, string, string] {
  return [
    `${KEY_PREFIX}salon:${salonId}:day:${utcDayKey(now)}`,
    `${KEY_PREFIX}salon:${salonId}:month:${utcMonthKey(now)}`,
    `${KEY_PREFIX}global:day:${utcDayKey(now)}`,
  ];
}

const SCOPE_BY_INDEX: Record<number, 'day' | 'month' | 'global'> = {
  1: 'day',
  2: 'month',
  3: 'global',
};

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function reserveTurn(args: { salonId: string; now?: Date }): Promise<BudgetReservation> {
  if (!redis) {
    return { ok: false, reason: 'redis_unavailable' };
  }

  const keys = buildBudgetKeys(args.salonId, args.now ?? new Date());

  let outcome: unknown;
  try {
    const raced = await withTimeout(
      redis.eval(
        RESERVE_SCRIPT,
        keys.length,
        ...keys,
        String(OWNER_ASSISTANT_LIMITS.turnsPerDay),
        String(OWNER_ASSISTANT_LIMITS.turnsPerMonth),
        String(OWNER_ASSISTANT_LIMITS.globalTurnsPerDay),
        String(DAY_TTL_SECONDS),
        String(MONTH_TTL_SECONDS),
      ) as Promise<unknown>,
      EVAL_TIMEOUT_MS,
    );

    if (raced === 'timeout') {
      return { ok: false, reason: 'redis_unavailable' };
    }
    outcome = raced;
  } catch {
    // A connection refusal, a script error or a cluster redirect are all the
    // same answer to the owner: the assistant cannot take a turn right now.
    return { ok: false, reason: 'redis_unavailable' };
  }

  const code = Number(outcome);
  if (!Number.isFinite(code)) {
    return { ok: false, reason: 'redis_unavailable' };
  }
  if (code === 0) {
    return { ok: true };
  }

  const scope = SCOPE_BY_INDEX[code];
  if (!scope) {
    return { ok: false, reason: 'redis_unavailable' };
  }

  return { ok: false, reason: 'budget_exhausted', scope };
}
