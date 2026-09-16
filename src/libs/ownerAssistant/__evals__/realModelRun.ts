/**
 * Owner Assistant — REAL-MODEL eval run, work stage (A1-4, deliverable F).
 *
 * ============================================================================
 * THIS FILE CALLS A LIVE MODEL AND SPENDS REAL MONEY.
 * ============================================================================
 *
 * It is NOT a test file and CI never collects it: the repo's `vitest.config.mts`
 * includes `src/**‍/*.test.{js,jsx,ts,tsx}`, and this file is `realModelRun.ts`.
 * It is executed only by `scripts/owner-assistant-eval.ts`, through
 * `realModel.vitest.config.mts`.
 *
 * Belt AND braces: if some future change to the include patterns ever swept it
 * up anyway, the precondition check below still refuses — CI is a refusal
 * condition, and so is a missing same-day confirmation — so the whole file
 * skips instead of calling a provider. Read `scripts/owner-assistant-eval.ts`
 * for the operator instructions and the full refusal list.
 *
 * WHAT IS REAL HERE, AND WHAT IS NOT
 *  - REAL: the whole turn loop (`runOwnerAssistantTurn`), every tool, the
 *    prompt, the registry link filtering, the conversation window, the ledger,
 *    the OpenAI Responses adapter, and the model's own answers.
 *  - STUBBED: `@/libs/DB` is an in-memory PGlite seeded with the synthetic
 *    "Eval Studio" fixture (a real migrated schema, no production data);
 *    `@/core/redis/redisClient` always grants the per-turn budget unit, because
 *    the budget is proved exhaustively in CI and an eval run must not consume a
 *    pilot salon's real daily allowance; `@/libs/googleCalendar` returns no busy
 *    windows, so the ONLY network this process opens is the model provider's.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import type { RunOwnerAssistantTurnArgs } from '../turn.server';
import type { EvalCaseRecord } from './harness';

vi.mock('server-only', () => ({}));

const { holder, GoogleCalendarAvailabilityError } = vi.hoisted(() => {
  class GoogleCalendarAvailabilityError extends Error {
    reconnectRequired: boolean;

    constructor(reconnectRequired = false) {
      super('Google Calendar availability is unavailable');
      this.name = 'GoogleCalendarAvailabilityError';
      this.reconnectRequired = reconnectRequired;
    }
  }

  return { GoogleCalendarAvailabilityError, holder: { db: null as unknown } };
});

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/googleCalendar', () => ({
  GoogleCalendarAvailabilityError,
  getGoogleCalendarBusyWindows: vi.fn(async () => []),
  isBusyWindowConflict: () => false,
}));

// Always grants. See the header: the budget is a CI concern, and a real-model
// run must not spend a pilot salon's daily allowance.
vi.mock('@/core/redis/redisClient', () => ({
  redis: { eval: async () => 0 },
  isRedisAvailable: async () => true,
}));

const { createOpenAiResponsesProvider } = await import('@/libs/ai/openaiResponses.server');
const { mechanismCases, realModelCases } = await import('./cases');
const {
  EVAL_ADMIN,
  EVAL_NOW,
  EVAL_SALON,
  EVAL_WEST_SALON,
  seedEvalFixtures,
} = await import('./fixtures.server');
const { aggregate, runEvalCase } = await import('./harness');
const {
  checkRealModelRunnerPreconditions,
  currentLocalDate,
  EVAL_API_KEY_ENV,
  EVAL_RUNNER_OUTPUT_DEFAULT,
  resolveEvalBaseUrl,
  resolveEvalModel,
} = await import('./runnerGuards');
const { writeEvalReport } = await import('./report');

const refusals = checkRealModelRunnerPreconditions(process.env, { today: currentLocalDate() });
const model = resolveEvalModel(process.env);
const baseUrl = resolveEvalBaseUrl(process.env);
const outputDirectory = process.env.OWNER_ASSISTANT_EVAL_OUT?.trim() || EVAL_RUNNER_OUTPUT_DEFAULT;
const selectedIds = (process.env.OWNER_ASSISTANT_EVAL_CASES ?? '')
  .split(',')
  .map(entry => entry.trim())
  .filter(entry => entry.length > 0);

const selected = realModelCases().filter(
  evalCase => selectedIds.length === 0 || selectedIds.includes(evalCase.id),
);

const records: EvalCaseRecord[] = [];
let client: PGlite;

describe.skipIf(refusals.length > 0)('owner assistant — real model run', () => {
  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    holder.db = db;

    await seedEvalFixtures(db);
  }, 180_000);

  afterAll(async () => {
    if (records.length > 0) {
      const summary = aggregate(records);
      const written = writeEvalReport({
        outputDirectory,
        model,
        records,
        summary,
        fixtureSlug: EVAL_SALON.slug,
        frozenNow: EVAL_NOW.toISOString(),
        skipped: mechanismCases().map(evalCase => ({
          id: evalCase.id,
          group: evalCase.group,
          title: evalCase.title,
          reason: evalCase.group === 'security'
            ? 'security cases are never sent to a live provider'
            : 'the premise is an injected provider or infrastructure fault a live provider cannot be asked to produce',
        })),
      });

      process.stdout.write(`\nWrote ${written.jsonPath}\nWrote ${written.markdownPath}\n`);
    }

    await client?.close();
  });

  for (const evalCase of selected) {
    it(`${evalCase.id} — ${evalCase.title}`, async () => {
      const record = await runEvalCase({
        evalCase,
        salon: evalCase.salon === 'west' ? EVAL_WEST_SALON : EVAL_SALON,
        admin: EVAL_ADMIN,
        provider: createOpenAiResponsesProvider({
          apiKey: process.env[EVAL_API_KEY_ENV] ?? '',
          // Unset for a genuine run; a LOOPBACK stub when rehearsing.
          ...(baseUrl ? { baseUrl } : {}),
        }),
        model,
        now: EVAL_NOW,
        database: holder.db as RunOwnerAssistantTurnArgs['database'],
        // The MODEL wrote these answers, so both the text expectations and the
        // grounding verdict are real evidence here — the opposite of CI.
        checks: { checkAnswerText: true, scoreGrounding: true },
      });

      records.push(record);

      expect(record.failures, `${record.caseId} failed`).toEqual([]);
    });
  }
});

/**
 * ALWAYS runs — that is the whole point of it.
 *
 * This block used to be `describe.runIf(refusals.length > 0)` around a test
 * asserting that refusals EXIST, which meant the two ways of reaching this file
 * both reported green: with the preconditions met the block was skipped, and
 * with a refusal it passed by asserting the refusal. Invoking the work stage
 * directly under a refusal therefore exited 0 having called nothing and having
 * scored nothing — a run that looks like a pass.
 *
 * Now a refusal FAILS here, loudly and with every reason printed. The entry
 * point (`scripts/owner-assistant-eval.ts`) still refuses first and exits 1
 * without ever spawning this stage; this is the second line of defence for
 * someone who runs the config by hand.
 */
describe('owner assistant — real model run (preconditions)', () => {
  it('refuses loudly rather than reporting a green run that never happened', () => {
    for (const refusal of refusals) {
      process.stderr.write(`[${refusal.code}] ${refusal.message}\n`);
    }

    expect(
      refusals.map(refusal => `[${refusal.code}] ${refusal.message}`),
      'the work stage was invoked but its preconditions are not met: nothing ran, nothing was scored',
    ).toEqual([]);
  });
});
