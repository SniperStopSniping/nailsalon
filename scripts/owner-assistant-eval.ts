/**
 * Owner Assistant — REAL-MODEL eval runner (A1-4, deliverable F). ENTRY POINT.
 *
 * ============================================================================
 * THIS SCRIPT SPENDS REAL MONEY AGAINST A REAL PROVIDER. It is an operator
 * action, run by hand. NOTHING in CI invokes it and no npm script wraps it.
 * ============================================================================
 *
 * What it does: seeds the synthetic "Eval Studio" fixture into a disposable
 * in-memory database, then sends every non-security eval case's owner turns
 * through the REAL turn loop to the configured model, and writes a JSON record
 * plus a markdown summary. It is the only evidence that exists for conversation
 * quality and grounding — the CI suite proves the harness and the loop, never
 * the model (see `src/libs/ownerAssistant/__evals__/evals.test.ts`).
 *
 * ---------------------------------------------------------------------------
 * REFUSAL CONDITIONS (checked HERE before the work stage is spawned, and then
 * AGAIN inside it; the logic is in `__evals__/runnerGuards.ts` and is unit-
 * tested in `evals.test.ts`)
 * ---------------------------------------------------------------------------
 *  1. CI                — refused outright. A real-model run costs money.
 *  2. Confirmation      — OWNER_ASSISTANT_EVAL_CONFIRM must exactly equal
 *                         today's LOCAL date (YYYY-MM-DD): the same fresh-intent
 *                         discipline `requireProductionDatabaseCommandConfirmation`
 *                         imposes, so yesterday's export cannot authorise today's
 *                         run.
 *  3. Environment       — APP_ENV / NODE_ENV must not be production.
 *  4. Model             — an explicit --model or OWNER_ASSISTANT_MODEL. There is
 *                         no default: the runner never spends money on a model
 *                         nobody named.
 *  5. Key               — OPENAI_API_KEY_OWNER must be set, and it MUST be a
 *                         NON-PRODUCTION key with its own provider-side budget.
 *                         The script cannot verify that; you must.
 *  6. Tools             — OWNER_ASSISTANT_TOOLS must be set, or no tool would
 *                         run and every case would be meaningless.
 *  7. Database          — DATABASE_URL must be ABSENT (the run then uses an
 *                         in-memory PGlite it migrates and throws away) or must
 *                         pass `requireDisposableDatabaseTarget`, which refuses
 *                         Neon, every hosted provider, every remote host and
 *                         every production-like name outright. The work stage
 *                         additionally DELETES DATABASE_URL before loading
 *                         anything, so a real database is unreachable by
 *                         construction. LUSTER_GUARDED_DATABASE_URL must be
 *                         unset.
 *
 * ---------------------------------------------------------------------------
 * WHY THE WORK STAGE RUNS UNDER VITEST
 * ---------------------------------------------------------------------------
 * The turn loop cannot be loaded by `tsx` at all in this repo: `@/libs/DB` uses
 * TOP-LEVEL AWAIT, and a `.ts` file here is CommonJS (package.json declares no
 * `"type": "module"`), which esbuild cannot emit top-level await into — and
 * every module in the graph imports `server-only`, which throws outside the
 * `react-server` condition. Vitest's transform pipeline handles both, and its
 * PGlite bootstrap is the very one the CI eval suite already proves. So this
 * entry does the refusing, and then runs the work stage
 * (`__evals__/realModelRun.ts`, which CI never collects because it is not a
 * `*.test.ts`) through `__evals__/realModel.vitest.config.mts`.
 *
 * ---------------------------------------------------------------------------
 * HOW AN OPERATOR RUNS IT
 * ---------------------------------------------------------------------------
 *   OWNER_ASSISTANT_EVAL_CONFIRM=$(date +%F) \
 *   OWNER_ASSISTANT_MODEL=gpt-5.6-luna \
 *   OWNER_ASSISTANT_TOOLS=get_salon_overview,list_services,find_destination,diagnose_day_availability,get_setup_readiness \
 *   OPENAI_API_KEY_OWNER=<NON-PRODUCTION key with its own provider budget> \
 *   npx tsx scripts/owner-assistant-eval.ts --out ./eval-reports
 *
 * Flags:
 *   --out <dir>   where to write the report (default ./eval-reports, gitignored)
 *   --model <id>  model id, overriding OWNER_ASSISTANT_MODEL
 *   --case <id>   run only these cases (repeatable: --case C1 --case G3)
 *   --help
 *
 * No Redis and no dotenv file are needed: the work stage stubs the budget
 * reservation (it is proved exhaustively in CI, and an eval must not consume a
 * pilot salon's real daily allowance) and supplies its own placeholder values
 * for the unrelated variables `Env.ts` requires.
 *
 * ---------------------------------------------------------------------------
 * REHEARSING WITHOUT SPENDING ANYTHING
 * ---------------------------------------------------------------------------
 * Set OWNER_ASSISTANT_EVAL_BASE_URL to a LOOPBACK HTTP stub of the Responses
 * API and the whole pipeline — fixture, loop, tools, scoring, report — runs
 * against it. Any non-loopback value is a refusal, so the variable can never be
 * used to send the key somewhere else. Leave it unset for a genuine run.
 *
 * REPORT OUTPUT IS NEVER COMMITTED. ./eval-reports is gitignored.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkRealModelRunnerPreconditions,
  currentLocalDate,
  EVAL_RUNNER_USAGE,
  parseEvalRunnerArguments,
  resolveEvalModel,
} from '../src/libs/ownerAssistant/__evals__/runnerGuards';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE_CONFIG = path.join(
  REPOSITORY_ROOT,
  'src',
  'libs',
  'ownerAssistant',
  '__evals__',
  'realModel.vitest.config.mts',
);

function fail(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function main(argv: readonly string[]): void {
  const options = parseEvalRunnerArguments(argv);
  if (!options) {
    fail(EVAL_RUNNER_USAGE);
    return;
  }
  if (options.help) {
    process.stdout.write(`${EVAL_RUNNER_USAGE}\n`);
    return;
  }

  const refusals = checkRealModelRunnerPreconditions(process.env, {
    today: currentLocalDate(),
    modelArgument: options.model,
  });

  if (refusals.length > 0) {
    for (const refusal of refusals) {
      process.stderr.write(`[${refusal.code}] ${refusal.message}\n`);
    }
    fail('Owner assistant eval did not run.');
    return;
  }

  const executable = path.join(
    REPOSITORY_ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
  );

  const result = spawnSync(executable, ['run', '--config', STAGE_CONFIG], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      // The stage re-checks every refusal, so it must see the same intent.
      OWNER_ASSISTANT_MODEL: resolveEvalModel(process.env, options.model),
      OWNER_ASSISTANT_EVAL_OUT: options.outputDirectory,
      OWNER_ASSISTANT_EVAL_CASES: options.caseIds.join(','),
    },
    stdio: 'inherit',
  });

  if (result.error || result.status === null) {
    fail('Owner assistant eval could not start its run stage safely.');
    return;
  }

  process.exitCode = result.status;
}

main(process.argv.slice(2));
