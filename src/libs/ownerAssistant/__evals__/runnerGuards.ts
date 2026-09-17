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

import { OWNER_ASSISTANT_MODEL_PRICES_MICROS_PER_MILLION } from '../contracts';

export const EVAL_CONFIRMATION_ENV = 'OWNER_ASSISTANT_EVAL_CONFIRM';
export const EVAL_API_KEY_ENV = 'OPENAI_API_KEY_OWNER';
export const EVAL_MODEL_ENV = 'OWNER_ASSISTANT_MODEL';

/**
 * Client-side hard ceiling on the whole run's provider spend (Owner
 * authorisation, 2026-09-16: US$3.00). This is IN ADDITION to whatever
 * provider-side budget the non-production key carries — see
 * `shouldStopForSpend` below for the enforcement itself, which lives at the
 * turn boundary inside the work stage (`realModelRun.ts`), not here. This
 * file only resolves and validates the configured number.
 */
export const EVAL_MAX_SPEND_ENV = 'OWNER_ASSISTANT_EVAL_MAX_SPEND_USD';
/** Owner-authorised default ceiling, in whole US dollars. */
export const EVAL_MAX_SPEND_USD_DEFAULT = 3.00;
/** Above this, the value is almost certainly a mistake (a misplaced decimal, a cents figure typed as dollars, …) and is refused rather than trusted. */
export const EVAL_MAX_SPEND_USD_CEILING = 25;

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
  | 'BASE_URL_MUST_BE_LOOPBACK'
  | 'MAX_SPEND_INVALID'
  | 'MODEL_PRICE_UNKNOWN';

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
  /** `--max-spend-usd` from the command line, if the operator passed one. */
  maxSpendArgument?: string;
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

// ---------------------------------------------------------------------------
// Spend ceiling — configuration and validation. Enforcement (the pure
// stop/continue decision made at each turn boundary) is `shouldStopForSpend`,
// below `resolveEvalModel`, next to the rest of the run-time contract the
// work stage consumes.
// ---------------------------------------------------------------------------

/**
 * The raw configured value, as a string, before it is validated: `--max-spend-usd`
 * wins over `OWNER_ASSISTANT_EVAL_MAX_SPEND_USD`, which wins over the
 * Owner-authorised default. Exposed so a caller (the entry point, forwarding
 * intent to the work stage's environment; a test, checking precedence) can see
 * exactly what will be parsed without duplicating the precedence rule.
 */
export function resolveEvalMaxSpendUsdRaw(
  environment: EvalRunnerEnvironment,
  maxSpendArgument?: string,
): string {
  const raw = maxSpendArgument ?? environment[EVAL_MAX_SPEND_ENV];
  return raw === undefined || raw.trim() === '' ? String(EVAL_MAX_SPEND_USD_DEFAULT) : raw.trim();
}

/**
 * Parses and validates a max-spend value. `undefined` means invalid — the
 * caller turns that into a refusal rather than a fallback, because a typo
 * here must never silently produce "no ceiling" or "a bigger ceiling than the
 * Owner authorised".
 */
export function parseEvalMaxSpendUsd(raw: string): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > EVAL_MAX_SPEND_USD_CEILING) {
    return undefined;
  }
  return value;
}

/** Whole US cents — the unit the ceiling is configured in (requirement: no fractional-cent drift). */
export function usdToWholeCents(usd: number): number {
  return Math.round(usd * 100);
}

/** 1 US cent = 10,000 of the "USD micros" unit `costMicros` / `formatMicros` already use (1,000,000 micros = $1). */
export function centsToMicros(cents: number): number {
  return cents * 10_000;
}

/**
 * The configured ceiling, resolved to whole cents. Only meaningful once
 * `checkRealModelRunnerPreconditions` has returned no `MAX_SPEND_INVALID`
 * refusal for the same inputs — a caller that reaches this before checking
 * preconditions gets the Owner-authorised default rather than `NaN`, because
 * by construction nothing downstream may run on an unvalidated number.
 */
export function resolveEvalMaxSpendCents(
  environment: EvalRunnerEnvironment,
  maxSpendArgument?: string,
): number {
  const raw = resolveEvalMaxSpendUsdRaw(environment, maxSpendArgument);
  const parsed = parseEvalMaxSpendUsd(raw);
  return usdToWholeCents(parsed ?? EVAL_MAX_SPEND_USD_DEFAULT);
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

  const maxSpendRaw = resolveEvalMaxSpendUsdRaw(environment, options.maxSpendArgument);
  if (parseEvalMaxSpendUsd(maxSpendRaw) === undefined) {
    refusals.push({
      code: 'MAX_SPEND_INVALID',
      message: `Owner assistant eval rejected: ${EVAL_MAX_SPEND_ENV} (or --max-spend-usd) must be a positive number of US dollars, at most $${EVAL_MAX_SPEND_USD_CEILING}. Got "${maxSpendRaw}".`,
    });
  }

  // Only meaningful once a model is actually configured — MODEL_REQUIRED
  // above already covers the empty case, and this must not double-report it.
  if (model !== '' && !OWNER_ASSISTANT_MODEL_PRICES_MICROS_PER_MILLION[model]) {
    refusals.push({
      code: 'MODEL_PRICE_UNKNOWN',
      message: `Owner assistant eval rejected: model "${model}" has no entry in OWNER_ASSISTANT_MODEL_PRICES_MICROS_PER_MILLION (contracts.ts) — the same price table \`report.ts\` falls back to marking a turn "unpriced" for. Without a price, the ${EVAL_MAX_SPEND_ENV} ceiling cannot be enforced, and this runner never spends money it cannot bound. Add the model's price first, or configure a priced model.`,
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

export type SpendStopCheck = {
  /** Real cost the run has already accumulated, from the price table, in "USD micros" (1,000,000 = $1). */
  spentMicros: number;
  /** The configured ceiling, in the same unit (see `centsToMicros`). */
  ceilingMicros: number;
  /**
   * A conservative estimate of the NEXT turn's cost — the maximum per-turn
   * cost observed so far, or `EVAL_WORST_CASE_TURN_COST_MICROS` before any
   * turn has completed (see `harness.ts`, next to the price table's use) —
   * or `0` when this is being asked AFTER a turn's real cost is already
   * folded into `spentMicros`, which reduces the rule to "has the run already
   * reached or exceeded the ceiling".
   */
  estimatedNextMicros: number;
};

/**
 * The one pure spend-ceiling decision, used at BOTH enforcement points the
 * work stage has:
 *   - BEFORE dispatching a turn, with a non-zero conservative estimate, so a
 *     turn that would plausibly tip the run over the ceiling is never sent;
 *   - AFTER a turn completes, with `estimatedNextMicros: 0`, so a turn whose
 *     REAL cost reached or exceeded the ceiling stops the run even if nothing
 *     more was about to be sent.
 * `>=`, not `>`: this is a hard ceiling the Owner authorised, not a target to
 * approach — spend that would exactly meet it does not proceed either.
 */
export function shouldStopForSpend(check: SpendStopCheck): boolean {
  return check.spentMicros + check.estimatedNextMicros >= check.ceilingMicros;
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
  /** Raw `--max-spend-usd` value, if the operator passed one; unparsed — `checkRealModelRunnerPreconditions` validates it. */
  maxSpendUsd?: string;
};

export const EVAL_RUNNER_USAGE = [
  'Usage: tsx scripts/owner-assistant-eval.ts [--out <dir>] [--model <id>] [--case <id>]... [--max-spend-usd <amount>]',
  '',
  'Runs the Owner Assistant eval cases against a LIVE model. Read that file\'s',
  'header first: it spends real money and refuses to run without an explicit',
  'same-day confirmation, a non-production key and a disposable database.',
  '',
  `The run also enforces a client-side spend ceiling (--max-spend-usd or`,
  `${EVAL_MAX_SPEND_ENV}, default $${EVAL_MAX_SPEND_USD_DEFAULT.toFixed(2)}, max $${EVAL_MAX_SPEND_USD_CEILING}):`,
  'it stops BEFORE sending any turn whose conservative cost estimate would',
  'meet or exceed the ceiling. It is a local estimate, not a provider control.',
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
    if (
      argument !== '--out'
      && argument !== '--model'
      && argument !== '--case'
      && argument !== '--max-spend-usd'
    ) {
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
    } else if (argument === '--case') {
      options.caseIds.push(value);
    } else {
      options.maxSpendUsd = value;
    }
  }

  return options;
}
