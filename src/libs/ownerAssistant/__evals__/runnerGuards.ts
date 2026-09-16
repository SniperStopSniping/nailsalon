/**
 * Refusal conditions for the real-model eval runner (A1-4, deliverable F).
 *
 * PURE so it can be unit-tested without running the runner: the script is a
 * thin shell that calls `checkRealModelRunnerPreconditions` and exits before
 * importing anything that can reach a network, a database or a key.
 *
 * The discipline is the repo's own, not a new one:
 *   - fresh, explicit intent through a dated confirmation variable, exactly
 *     like `requireProductionDatabaseCommandConfirmation` (the value must equal
 *     TODAY's local date, so yesterday's export cannot authorise today's run);
 *   - the database target is validated with `requireDisposableDatabaseTarget`,
 *     the same static guard the CI mutation commands use — which is what makes
 *     a Neon, hosted, remote or production-like target refusable by name rather
 *     than by hope. Absent is better still: no `DATABASE_URL` means `@/libs/DB`
 *     builds an in-memory PGlite and nothing durable exists at all;
 *   - CI may never run it, because a real-model run spends real money against a
 *     real provider.
 */
import {
  DisposableDatabaseTargetError,
  requireDisposableDatabaseTarget,
} from '@/libs/disposableDatabaseTarget';

export const EVAL_CONFIRMATION_ENV = 'OWNER_ASSISTANT_EVAL_CONFIRM';
export const EVAL_API_KEY_ENV = 'OPENAI_API_KEY_OWNER';
export const EVAL_MODEL_ENV = 'OWNER_ASSISTANT_MODEL';

/**
 * Optional rehearsal seam: a LOOPBACK base URL for the provider adapter, so an
 * operator can exercise this whole runner — fixture, loop, tools, report — with
 * a local stub before spending anything. Anything that is not loopback is a
 * refusal (`BASE_URL_MUST_BE_LOOPBACK`), so this can never send the key
 * somewhere else; a genuine run simply leaves it unset.
 */
export const EVAL_BASE_URL_ENV = 'OWNER_ASSISTANT_EVAL_BASE_URL';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function resolveEvalBaseUrl(environment: EvalRunnerEnvironment): string | undefined {
  const raw = environment[EVAL_BASE_URL_ENV]?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return LOOPBACK_HOSTS.has(host) ? raw : undefined;
  } catch {
    return undefined;
  }
}

export type EvalRunnerRefusalCode =
  | 'CI_FORBIDDEN'
  | 'CONFIRMATION_REQUIRED'
  | 'PRODUCTION_ENVIRONMENT_FORBIDDEN'
  | 'MODEL_REQUIRED'
  | 'API_KEY_REQUIRED'
  | 'TOOLS_REQUIRED'
  | 'GUARDED_DATABASE_URL_FORBIDDEN'
  | 'DATABASE_TARGET_FORBIDDEN'
  | 'BASE_URL_MUST_BE_LOOPBACK';

export type EvalRunnerRefusal = {
  code: EvalRunnerRefusalCode;
  message: string;
};

export type EvalRunnerEnvironment = Readonly<Record<string, string | undefined>>;

export type EvalRunnerPreconditionOptions = {
  /** Today's local date, YYYY-MM-DD. Injected so the check is testable. */
  today: string;
  /** `--model` from the command line, if the operator passed one. */
  modelArgument?: string;
};

/** Local date in YYYY-MM-DD — mirrors `productionDatabaseCommandGuard.ts`. */
export function currentLocalDate(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function isCiEnvironment(environment: EvalRunnerEnvironment): boolean {
  return environment.CI === 'true'
    || environment.CI === '1'
    || environment.GITHUB_ACTIONS === 'true'
    || environment.GITHUB_ACTIONS === '1';
}

function checkDatabaseTarget(environment: EvalRunnerEnvironment): EvalRunnerRefusal[] {
  const refusals: EvalRunnerRefusal[] = [];

  if (environment.LUSTER_GUARDED_DATABASE_URL) {
    refusals.push({
      code: 'GUARDED_DATABASE_URL_FORBIDDEN',
      message: 'Owner assistant eval rejected: LUSTER_GUARDED_DATABASE_URL must not be set — the runner never borrows a guarded target.',
    });
  }

  const url = environment.DATABASE_URL?.trim();
  if (!url) {
    // The preferred shape: `@/libs/DB` builds an in-memory PGlite, migrates it
    // and forgets it when the process exits.
    return refusals;
  }

  try {
    requireDisposableDatabaseTarget(environment);
  } catch (error) {
    refusals.push({
      code: 'DATABASE_TARGET_FORBIDDEN',
      message: error instanceof DisposableDatabaseTargetError
        ? `Owner assistant eval rejected: ${error.message} Unset DATABASE_URL to use in-memory PGlite instead.`
        : 'Owner assistant eval rejected: the database target could not be attested as disposable. Unset DATABASE_URL to use in-memory PGlite instead.',
    });
  }

  return refusals;
}

/**
 * Every reason this run must not happen, in one pass, so an operator fixes
 * them all at once instead of one per attempt. An empty array is the only
 * thing that lets the runner proceed.
 */
export function checkRealModelRunnerPreconditions(
  environment: EvalRunnerEnvironment,
  options: EvalRunnerPreconditionOptions,
): EvalRunnerRefusal[] {
  const refusals: EvalRunnerRefusal[] = [];

  if (isCiEnvironment(environment)) {
    refusals.push({
      code: 'CI_FORBIDDEN',
      message: 'Owner assistant eval rejected: real-model runs are forbidden in CI.',
    });
  }

  if (environment[EVAL_CONFIRMATION_ENV] !== options.today) {
    refusals.push({
      code: 'CONFIRMATION_REQUIRED',
      message: `Owner assistant eval rejected: ${EVAL_CONFIRMATION_ENV} must exactly match today's local date (YYYY-MM-DD).`,
    });
  }

  if (environment.APP_ENV === 'production' || environment.NODE_ENV === 'production') {
    refusals.push({
      code: 'PRODUCTION_ENVIRONMENT_FORBIDDEN',
      message: 'Owner assistant eval rejected: the application environment must not be Production.',
    });
  }

  const model = (options.modelArgument ?? environment[EVAL_MODEL_ENV] ?? '').trim();
  if (model === '') {
    refusals.push({
      code: 'MODEL_REQUIRED',
      message: `Owner assistant eval rejected: a model id is required — pass --model or set ${EVAL_MODEL_ENV}. The runner never falls back to a default it was not told to spend money on.`,
    });
  }

  if (!environment[EVAL_API_KEY_ENV]?.trim()) {
    refusals.push({
      code: 'API_KEY_REQUIRED',
      message: `Owner assistant eval rejected: ${EVAL_API_KEY_ENV} is required, and it must be a NON-PRODUCTION key with its own provider-side budget.`,
    });
  }

  if (!environment.OWNER_ASSISTANT_TOOLS?.trim()) {
    refusals.push({
      code: 'TOOLS_REQUIRED',
      message: 'Owner assistant eval rejected: OWNER_ASSISTANT_TOOLS is unset, so no tool would run and every case would be meaningless.',
    });
  }

  refusals.push(...checkDatabaseTarget(environment));

  const baseUrl = environment[EVAL_BASE_URL_ENV]?.trim();
  if (baseUrl !== undefined && baseUrl !== '' && resolveEvalBaseUrl(environment) === undefined) {
    refusals.push({
      code: 'BASE_URL_MUST_BE_LOOPBACK',
      message: `Owner assistant eval rejected: ${EVAL_BASE_URL_ENV} may only point at loopback. It exists to REHEARSE the runner against a local stub, never to send a key somewhere else.`,
    });
  }

  return refusals;
}

/** Resolved model id, after the precondition check has passed. */
export function resolveEvalModel(
  environment: EvalRunnerEnvironment,
  modelArgument?: string,
): string {
  return (modelArgument ?? environment[EVAL_MODEL_ENV] ?? '').trim();
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------
//
// Parsed here rather than in the script because the runner has TWO stages that
// must agree on the arguments: the `scripts/owner-assistant-eval.ts` entry
// point, which refuses, and the Vitest-hosted stage that does the work. One
// parser, one contract, unit-tested.

export const EVAL_RUNNER_OUTPUT_DEFAULT = 'eval-reports';

export type EvalRunnerOptions = {
  outputDirectory: string;
  model?: string;
  caseIds: string[];
  help: boolean;
};

export const EVAL_RUNNER_USAGE = [
  'Usage: tsx scripts/owner-assistant-eval.ts [--out <dir>] [--model <id>] [--case <id>]...',
  '',
  'Runs the Owner Assistant eval cases against a LIVE model. Read that file\'s',
  'header first: it spends real money and refuses to run without an explicit',
  'same-day confirmation, a non-production key and a disposable database.',
].join('\n');

/** Returns null for anything malformed; the caller prints the usage. */
export function parseEvalRunnerArguments(argv: readonly string[]): EvalRunnerOptions | null {
  const options: EvalRunnerOptions = {
    outputDirectory: EVAL_RUNNER_OUTPUT_DEFAULT,
    caseIds: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument !== '--out' && argument !== '--model' && argument !== '--case') {
      return null;
    }
    if (!value || value.startsWith('--')) {
      return null;
    }
    index++;
    if (argument === '--out') {
      options.outputDirectory = value;
    } else if (argument === '--model') {
      options.model = value;
    } else {
      options.caseIds.push(value);
    }
  }

  return options;
}
