/**
 * A1-4 — spend controls, verified.
 *
 * `budget.server.test.ts` pins the mapping of the script's RETURN CODES. This
 * file is the other half: it EXECUTES the reservation script against a scripted
 * Redis and drives real turns through it, so the claim "the assistant cannot
 * spend more than the documented caps" rests on observed behaviour rather than
 * on reading the Lua.
 *
 * ============================ WHAT THIS PROVES =============================
 * The fake Redis below does not re-implement the reservation. It INTERPRETS the
 * exact script text `budget.server.ts` passes to `eval`, statement by
 * statement, and refuses to run any statement form it does not recognise. So:
 *   - reordering the script (INCR before the checks) changes the observed
 *     behaviour and fails these tests;
 *   - swapping an ARGV index (day limit read as the month limit) fails them;
 *   - rewriting the script into a form this interpreter does not know fails
 *     loudly instead of silently passing.
 * Everything below is therefore a statement about the code under test.
 *
 * ========================== WHAT THIS CANNOT PROVE =========================
 * Honest limits, because a mock cannot stand in for a server:
 *   1. ATOMICITY. Real Redis runs the whole script as one indivisible unit;
 *      this interpreter runs it inside one JavaScript task, which LOOKS atomic
 *      for the same structural reason and proves nothing about a real server
 *      under concurrency. The check-all-then-increment ORDER is proved here;
 *      that two concurrent turns cannot both take the last unit is NOT — that
 *      needs a real single-node Redis (and the script's use of three keys in
 *      one EVAL makes Redis Cluster out of scope, which is also unproven here).
 *   2. TTL / expiry. `EXPIRE` calls are recorded and asserted, but no clock
 *      runs: that a day counter actually disappears after 48 h is unproven.
 *      The UTC-window behaviour is proved through the KEY NAMES instead, which
 *      is what actually rolls the window over.
 *   3. Provider-side spend. A refused reservation is proved to cost zero
 *      PROVIDER CALLS; it cannot prove what OpenAI bills for a call that was
 *      made and then abandoned (docs §6 records that limitation separately).
 *   4. The caps themselves are a product decision (A-3), not a safety proof:
 *      30 turns/day at Luna prices is a budget, not a ceiling on harm.
 *   5. WHOSE allowance it is. The keys these tests exercise carry only the
 *      SALON id (`buildBudgetKeys`), so "30 turns a day" is per salon, not per
 *      owner: two owners of one salon share one allowance and can exhaust each
 *      other's, and nothing here (or anywhere) enforces a per-person cap. The
 *      tests pin the key SHAPE; they cannot tell you that shape is the one the
 *      product wants.
 *   6. The TIMEOUT path. `reserveTurn` races the `eval` against a 1 s deadline
 *      and answers `redis_unavailable` when the deadline wins — but the script
 *      is not cancelled, so a slow-but-successful server may have ALREADY
 *      incremented all three counters. That is a unit burned with no turn
 *      taken: the owner is told the assistant is unavailable and their daily
 *      allowance is one lower. These tests resolve instantly and so never
 *      reach that window; only a real slow server would.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const dbHolder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return dbHolder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  CLERK_SECRET_KEY: 'sk_test_budget',
  NODE_ENV: 'test' as string,
  OWNER_ASSISTANT_ENABLED: 'true' as string | undefined,
  OWNER_ASSISTANT_SALON_ALLOWLIST: 'isla-nail-studio' as string | undefined,
  OWNER_ASSISTANT_TOOLS: 'list_services' as string | undefined,
  OWNER_ASSISTANT_MODEL: 'gpt-5.6-luna' as string | undefined,
  OWNER_ASSISTANT_JSON_MODE: undefined as string | undefined,
  OWNER_ASSISTANT_REASONING_EFFORT: undefined as string | undefined,
  OPENAI_API_KEY_OWNER: 'sk-owner-test' as string | undefined,
  OWNER_ASSISTANT_SIGNING_SECRET: 'budget-verification-secret' as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// ---------------------------------------------------------------------------
// A Redis that runs the real script
// ---------------------------------------------------------------------------

type ScriptedRedis = {
  counters: Map<string, number>;
  /** Every EXPIRE the script issued, in order: [key, seconds]. */
  expires: Array<[string, number]>;
  /** Ordered trace of what the turn loop did; see the ordering test. */
  events: string[];
  /** Every EVAL, as the module sent it. */
  calls: Array<{ script: string; keys: string[]; argv: string[] }>;
  eval: (script: string, keyCount: number, ...rest: string[]) => Promise<number>;
};

const GET_LINE = /^local (\w+) = tonumber\(redis\.call\('GET', KEYS\[(\d+)\]\) or '0'\)$/;
const CHECK_LINE = /^if (\w+) >= tonumber\(ARGV\[(\d+)\]\) then return (\d+) end$/;
const INCR_LINE = /^if redis\.call\('INCR', KEYS\[(\d+)\]\) == 1 then redis\.call\('EXPIRE', KEYS\[(\d+)\], ARGV\[(\d+)\]\) end$/;
const RETURN_LINE = /^return (\d+)$/;

/**
 * Executes the four statement forms `RESERVE_SCRIPT` is built from, in the
 * order they appear, against an in-memory counter map. An unrecognised
 * statement THROWS: a script this interpreter cannot execute must fail the
 * suite, never quietly pass it.
 */
function createScriptedRedis(): ScriptedRedis {
  const counters = new Map<string, number>();
  const expires: Array<[string, number]> = [];
  const events: string[] = [];
  const calls: Array<{ script: string; keys: string[]; argv: string[] }> = [];

  const evaluate = (script: string, keyCount: number, ...rest: string[]): number => {
    const keys = rest.slice(0, keyCount);
    const argv = rest.slice(keyCount);
    const locals = new Map<string, number>();
    const keyAt = (index: string) => {
      const key = keys[Number(index) - 1];
      if (key === undefined) {
        throw new Error(`script referenced KEYS[${index}] but only ${keys.length} keys were passed`);
      }
      return key;
    };
    const argAt = (index: string) => {
      const value = argv[Number(index) - 1];
      if (value === undefined) {
        throw new Error(`script referenced ARGV[${index}] but only ${argv.length} arguments were passed`);
      }
      return Number(value);
    };

    for (const raw of script.split('\n')) {
      const line = raw.trim();
      if (line.length === 0) {
        continue;
      }

      const get = GET_LINE.exec(line);
      if (get) {
        locals.set(get[1]!, counters.get(keyAt(get[2]!)) ?? 0);
        continue;
      }

      const check = CHECK_LINE.exec(line);
      if (check) {
        const current = locals.get(check[1]!);
        if (current === undefined) {
          throw new Error(`script compared undefined local ${check[1]}`);
        }
        if (current >= argAt(check[2]!)) {
          return Number(check[3]);
        }
        continue;
      }

      const incr = INCR_LINE.exec(line);
      if (incr) {
        const key = keyAt(incr[1]!);
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        if (next === 1) {
          expires.push([keyAt(incr[2]!), argAt(incr[3]!)]);
        }
        continue;
      }

      const returned = RETURN_LINE.exec(line);
      if (returned) {
        return Number(returned[1]);
      }

      throw new Error(`the reservation script changed shape; this interpreter cannot execute: ${line}`);
    }

    throw new Error('the reservation script fell through without returning');
  };

  return {
    counters,
    expires,
    events,
    calls,
    eval: (script, keyCount, ...rest) => {
      events.push('reserve');
      calls.push({ script, keys: rest.slice(0, keyCount), argv: rest.slice(keyCount) });
      return Promise.resolve(evaluate(script, keyCount, ...rest));
    },
  };
}

const redisHolder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/core/redis/redisClient', () => ({
  get redis() {
    return redisHolder.client;
  },
}));

const { buildBudgetKeys, reserveTurn } = await import('./budget.server');
const { runOwnerAssistantTurn } = await import('./turn.server');
const { OWNER_ASSISTANT_LIMITS } = await import('./contracts');
const { createScriptedProvider, fakeAnswer, fakeToolCalls } = await import('@/libs/ai/providerFake');

const SALON = { id: 'salon_budget', slug: 'isla-nail-studio', name: 'Isla Nail Studio' };
const ADMIN = { id: 'admin_1', clerkUserId: 'user_clerk_1' };
const ANSWER = { message: 'Two services.', links: [], followUps: [], needsClarification: false };

let redis: ScriptedRedis;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  dbHolder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON.id,
    name: SALON.name,
    slug: SALON.slug,
    settings: { booking: { currency: 'CAD', timezone: 'America/Toronto' } },
  });
  await db.insert(schema.serviceSchema).values({
    id: 'svc_budget',
    salonId: SALON.id,
    name: 'Gel manicure',
    price: 6500,
    durationMinutes: 60,
    category: 'manicure',
    isActive: true,
  });
});

beforeEach(() => {
  dbHolder.db = db;
  redis = createScriptedRedis();
  redisHolder.client = redis;
  envHolder.NODE_ENV = 'test';
  envHolder.OPENAI_API_KEY_OWNER = 'sk-owner-test';
  envHolder.OWNER_ASSISTANT_SIGNING_SECRET = 'budget-verification-secret';
  envHolder.OWNER_ASSISTANT_TOOLS = 'list_services';
});

const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 8, day, hour));

/** Reserve `count` turns for one salon at one instant; returns the outcomes. */
async function reserveMany(salonId: string, now: Date, count: number) {
  const outcomes = [];
  for (let index = 0; index < count; index += 1) {
    outcomes.push(await reserveTurn({ salonId, now }));
  }
  return outcomes;
}

function runTurn(provider: ReturnType<typeof createScriptedProvider>) {
  return runOwnerAssistantTurn({
    salon: SALON,
    admin: ADMIN,
    message: 'what services do I offer?',
    provider,
    database: db,
  });
}

// ---------------------------------------------------------------------------

describe('(1) the caps that are enforced are the caps in OWNER_ASSISTANT_LIMITS', () => {
  it('pins the documented pilot values so a widening is never silent', () => {
    // Decision A-3, 2026-09-16. Changing any of these is a spend decision and
    // must be made deliberately, in review, not as a side effect.
    expect(OWNER_ASSISTANT_LIMITS.turnsPerDay).toBe(30);
    expect(OWNER_ASSISTANT_LIMITS.turnsPerMonth).toBe(300);
    expect(OWNER_ASSISTANT_LIMITS.globalTurnsPerDay).toBe(2000);
    expect(OWNER_ASSISTANT_LIMITS.modelCallsPerTurn).toBe(3);
    expect(OWNER_ASSISTANT_LIMITS.toolCallsPerTurn).toBe(5);
    expect(OWNER_ASSISTANT_LIMITS.maxOutputTokens).toBe(1200);
  });

  it('hands the script those three numbers, against the three scoped keys', async () => {
    await reserveTurn({ salonId: SALON.id, now: at(16) });

    const call = redis.calls[0]!;

    expect(call.keys).toEqual([...buildBudgetKeys(SALON.id, at(16))]);
    expect(call.argv.slice(0, 3)).toEqual([
      String(OWNER_ASSISTANT_LIMITS.turnsPerDay),
      String(OWNER_ASSISTANT_LIMITS.turnsPerMonth),
      String(OWNER_ASSISTANT_LIMITS.globalTurnsPerDay),
    ]);
    // Not just passed — read: the interpreter incremented exactly those keys.
    expect([...redis.counters.keys()].sort()).toEqual([...buildBudgetKeys(SALON.id, at(16))].sort());
  });

  it('refuses the turn after exactly `turnsPerDay`, counting from the constant', async () => {
    const outcomes = await reserveMany(SALON.id, at(16), OWNER_ASSISTANT_LIMITS.turnsPerDay + 1);

    expect(outcomes.slice(0, OWNER_ASSISTANT_LIMITS.turnsPerDay).every(outcome => outcome.ok)).toBe(true);
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: 'budget_exhausted', scope: 'day' });
  });

  it('sets each window\'s TTL once and never extends it with traffic', async () => {
    await reserveMany(SALON.id, at(16), 5);

    const [dayKey, monthKey, globalKey] = buildBudgetKeys(SALON.id, at(16));

    // Exactly three EXPIREs for five turns: the first write of each window.
    expect(redis.expires).toEqual([
      [dayKey, 2 * 24 * 60 * 60],
      [monthKey, 35 * 24 * 60 * 60],
      [globalKey, 2 * 24 * 60 * 60],
    ]);
  });
});

describe('the harness itself', () => {
  it('refuses to execute a script it does not understand, instead of passing quietly', () => {
    // The guarantee the file header makes: a rewritten script fails the suite.
    // Verified by mutation while this was written — moving one INCR above the
    // checks fails 8 of these tests, and swapping ARGV[1]/ARGV[2] fails 6.
    expect(() => redis.eval('redis.call(\'SET\', KEYS[1], 0)', 1, 'k'))
      .toThrow(/the reservation script changed shape/);
  });

  it('models GET on a missing key as zero, the way the script assumes', async () => {
    expect(redis.counters.size).toBe(0);

    await expect(reserveTurn({ salonId: 'salon_new', now: at(16) })).resolves.toEqual({ ok: true });
    expect(redis.counters.get(buildBudgetKeys('salon_new', at(16))[0])).toBe(1);
  });
});

describe('(2) the reservation happens before any provider call', () => {
  it('reserves first, then calls the model', async () => {
    const provider = createScriptedProvider(() => {
      redis.events.push('provider');
      return fakeAnswer(ANSWER);
    });

    const result = await runTurn(provider);

    expect(result.kind).toBe('answer');
    expect(redis.events).toEqual(['reserve', 'provider']);
  });

  it('costs no provider call at all once the day is spent', async () => {
    await reserveMany(SALON.id, new Date(), OWNER_ASSISTANT_LIMITS.turnsPerDay);

    const provider = createScriptedProvider(fakeAnswer(ANSWER));
    const result = await runTurn(provider);

    expect(result.kind === 'unavailable' && result.reason).toBe('budget_exhausted');
    expect(provider.requests).toHaveLength(0);
  });

  it('costs no provider call when Redis itself cannot answer', async () => {
    // Fail closed: no reservation, no spend. (`redis_unavailable`, not a 500.)
    redisHolder.client = { eval: () => Promise.reject(new Error('connection refused')) };

    const provider = createScriptedProvider(fakeAnswer(ANSWER));
    const result = await runTurn(provider);

    expect(result.kind === 'unavailable' && result.reason).toBe('redis_unavailable');
    expect(provider.requests).toHaveLength(0);
  });

  it('costs no provider call and no reservation when the key is missing', async () => {
    envHolder.OPENAI_API_KEY_OWNER = undefined;

    const provider = createScriptedProvider(fakeAnswer(ANSWER));
    const result = await runTurn(provider);

    expect(result.kind === 'unavailable' && result.reason).toBe('not_configured');
    expect(provider.requests).toHaveLength(0);
    expect(redis.events).toEqual([]);
  });
});

describe('(3) the per-salon day and month caps', () => {
  it('refuses the 31st turn of a UTC day', async () => {
    const outcomes = await reserveMany(SALON.id, at(16), 31);

    expect(outcomes.filter(outcome => outcome.ok)).toHaveLength(30);
    expect(outcomes[30]).toEqual({ ok: false, reason: 'budget_exhausted', scope: 'day' });
  });

  it('rolls the day window over at the UTC boundary, not at a salon\'s local midnight', async () => {
    // 23:59 UTC on the 16th exhausts the 16th…
    await reserveMany(SALON.id, at(16, 23), OWNER_ASSISTANT_LIMITS.turnsPerDay);

    await expect(reserveTurn({ salonId: SALON.id, now: at(16, 23) }))
      .resolves.toMatchObject({ ok: false, scope: 'day' });
    // …and 00:00 UTC on the 17th is a new day, even though the salon
    // (America/Toronto) is still on the evening of the 16th.
    await expect(reserveTurn({ salonId: SALON.id, now: at(17, 0) })).resolves.toEqual({ ok: true });
  });

  it('refuses the 301st turn of a UTC month', async () => {
    // Ten turns a day for thirty days: well under the daily cap every day, so
    // the only thing that can refuse the 301st is the MONTH counter.
    for (let day = 1; day <= 30; day += 1) {
      const outcomes = await reserveMany(SALON.id, at(day), 10);

      expect(outcomes.every(outcome => outcome.ok)).toBe(true);
    }

    await expect(reserveTurn({ salonId: SALON.id, now: at(30) }))
      .resolves.toEqual({ ok: false, reason: 'budget_exhausted', scope: 'month' });
  });

  it('rolls the month window over at the UTC month boundary', async () => {
    for (let day = 1; day <= 30; day += 1) {
      await reserveMany(SALON.id, at(day), 10);
    }

    await expect(reserveTurn({ salonId: SALON.id, now: new Date(Date.UTC(2026, 9, 1, 12)) }))
      .resolves.toEqual({ ok: true });
  });

  it('never lets one salon spend another salon\'s allowance', async () => {
    await reserveMany('salon_a', at(16), OWNER_ASSISTANT_LIMITS.turnsPerDay);

    await expect(reserveTurn({ salonId: 'salon_a', now: at(16) })).resolves.toMatchObject({ ok: false });
    await expect(reserveTurn({ salonId: 'salon_b', now: at(16) })).resolves.toEqual({ ok: true });
  });
});

describe('(4) the global day cap', () => {
  it('refuses beyond 2000 turns a day across all salons', async () => {
    // 100 salons × 20 turns: every salon stays far under 30/day and 300/month,
    // so the only counter that can be reached is the global one.
    for (let salon = 0; salon < 100; salon += 1) {
      await reserveMany(`salon_${salon}`, at(16), 20);
    }

    expect(redis.counters.get(buildBudgetKeys('salon_0', at(16))[2])).toBe(OWNER_ASSISTANT_LIMITS.globalTurnsPerDay);

    await expect(reserveTurn({ salonId: 'salon_fresh', now: at(16) }))
      .resolves.toEqual({ ok: false, reason: 'budget_exhausted', scope: 'global' });
  });

  it('is shared by every salon and rolls over per UTC day', async () => {
    for (let salon = 0; salon < 100; salon += 1) {
      await reserveMany(`salon_${salon}`, at(16), 20);
    }

    await expect(reserveTurn({ salonId: 'salon_0', now: at(16) }))
      .resolves.toMatchObject({ ok: false, scope: 'global' });
    await expect(reserveTurn({ salonId: 'salon_0', now: at(17) })).resolves.toEqual({ ok: true });
  });
});

describe('(5) a refused reservation increments nothing', () => {
  it('leaves all three counters untouched when the DAY cap refuses', async () => {
    await reserveMany(SALON.id, at(16), OWNER_ASSISTANT_LIMITS.turnsPerDay);

    const before = new Map(redis.counters);
    const expiresBefore = redis.expires.length;

    await expect(reserveTurn({ salonId: SALON.id, now: at(16) })).resolves.toMatchObject({ ok: false });

    expect([...redis.counters.entries()]).toEqual([...before.entries()]);
    expect(redis.expires).toHaveLength(expiresBefore);
  });

  it('leaves the day and global counters untouched when the MONTH cap refuses', async () => {
    for (let day = 1; day <= 30; day += 1) {
      await reserveMany(SALON.id, at(day), 10);
    }

    const [dayKey, monthKey, globalKey] = buildBudgetKeys(SALON.id, at(30));
    const before = [redis.counters.get(dayKey), redis.counters.get(monthKey), redis.counters.get(globalKey)];

    await expect(reserveTurn({ salonId: SALON.id, now: at(30) })).resolves.toMatchObject({ scope: 'month' });

    expect([redis.counters.get(dayKey), redis.counters.get(monthKey), redis.counters.get(globalKey)])
      .toEqual(before);
  });

  it('leaves the per-salon counters untouched when the GLOBAL cap refuses', async () => {
    for (let salon = 0; salon < 100; salon += 1) {
      await reserveMany(`salon_${salon}`, at(16), 20);
    }

    const [dayKey, monthKey] = buildBudgetKeys('salon_fresh', at(16));

    await expect(reserveTurn({ salonId: 'salon_fresh', now: at(16) })).resolves.toMatchObject({ scope: 'global' });

    // A salon refused by somebody else's spending must not have burned a unit
    // of its own day or month allowance.
    expect(redis.counters.has(dayKey)).toBe(false);
    expect(redis.counters.has(monthKey)).toBe(false);
  });

  it('checks every scope before incrementing any of them', async () => {
    // The structural twin of the three tests above: every check precedes every
    // INCR in the script the module actually sends. Asserted on the script text
    // because the behavioural proof above cannot distinguish "checked first"
    // from "incremented and rolled back".
    let captured = '';
    redisHolder.client = {
      eval: (script: string) => {
        captured = script;
        return Promise.resolve(0);
      },
    };

    await reserveTurn({ salonId: SALON.id, now: at(16) });

    expect(captured.indexOf('INCR')).toBeGreaterThan(captured.lastIndexOf('return 1'));
    expect(captured.indexOf('INCR')).toBeGreaterThan(captured.lastIndexOf('return 2'));
    expect(captured.indexOf('INCR')).toBeGreaterThan(captured.lastIndexOf('return 3'));
  });
});

describe('(6) the per-turn model-call and tool-call ceilings', () => {
  it('never makes more than modelCallsPerTurn provider calls, however the model behaves', async () => {
    // A model that only ever asks for more tools: the loop must stop itself.
    const provider = createScriptedProvider(
      ...Array.from({ length: 10 }, (_, index) =>
        fakeToolCalls([{ callId: `c${index}`, name: 'list_services', argumentsJson: '{"includeInactive":false}' }])),
    );

    const result = await runTurn(provider);

    expect(provider.requests).toHaveLength(OWNER_ASSISTANT_LIMITS.modelCallsPerTurn);
    expect(result.kind).toBe('unavailable');
  });

  it('executes at most toolCallsPerTurn tools, and tells the model why it stopped', async () => {
    const many = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        callId: `${prefix}${index}`,
        name: 'list_services',
        argumentsJson: '{"includeInactive":false}',
      }));

    // Four tools on the first round, four more on the second: eight requested,
    // five allowed.
    const provider = createScriptedProvider(
      fakeToolCalls(many('a', 4)),
      fakeToolCalls(many('b', 4)),
      fakeAnswer(ANSWER),
    );

    const result = await runTurn(provider);

    expect(result.kind === 'answer' && result.usage.toolCalls).toBe(OWNER_ASSISTANT_LIMITS.toolCallsPerTurn);

    const refusals = provider.requests
      .at(-1)!
      .input.filter(item => JSON.stringify(item).includes('tool_budget_exhausted'));

    // Every refused call still gets an output, so the model learns it was
    // capped instead of silently re-requesting (which would cost another call).
    expect(refusals).toHaveLength(3);
  });

  it('bounds the output tokens of every model call', async () => {
    const provider = createScriptedProvider(
      fakeToolCalls([{ callId: 'c1', name: 'list_services', argumentsJson: '{"includeInactive":false}' }]),
      fakeAnswer(ANSWER),
    );

    await runTurn(provider);

    expect(provider.requests).toHaveLength(2);

    for (const request of provider.requests) {
      expect(request.maxOutputTokens).toBe(OWNER_ASSISTANT_LIMITS.maxOutputTokens);
    }
  });

  it('spends exactly one budget unit per turn, whatever the turn costs inside', async () => {
    const provider = createScriptedProvider(
      fakeToolCalls([{ callId: 'c1', name: 'list_services', argumentsJson: '{"includeInactive":false}' }]),
      fakeAnswer(ANSWER),
    );

    await runTurn(provider);

    // Two model calls and one tool call, but one reservation: the budget counts
    // TURNS, which is what the owner-facing limit promises.
    expect(provider.requests).toHaveLength(2);
    expect(redis.events.filter(event => event === 'reserve')).toHaveLength(1);
  });
});
