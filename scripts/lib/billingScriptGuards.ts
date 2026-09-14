/**
 * Pure argument parsing + guard decisions for the read-only P8a operator
 * script `scripts/billing-integrity-check.ts`.
 *
 * `scripts/grant-starter-credits.ts` (the CLI this module ALSO used to
 * guard) was deleted: it was structurally unrunnable for a real
 * (non---help) invocation under plain tsx (the live `creditGrants.ts` it
 * had to reuse has a module-scope `@/libs/DB` import, and `DB.ts` has
 * top-level `await`, which tsx/esbuild cannot compile to CJS under this
 * repository's CommonJS-default `package.json`). That operator path is now
 * `src/app/api/super-admin/billing/starter-grant/route.ts`, which runs
 * inside the Next.js server process and has no such limitation. Its guard
 * is `requireSuperAdmin()` + rate limiting + a typed confirmation, not this
 * module's CI/non-Production/date-confirmation layering — see that route's
 * own header comment.
 *
 * Deliberately dependency-light: this module imports only the two
 * synchronous guard primitives it needs
 * (`../../src/libs/nonProductionDatabaseGuard`,
 * `../../src/libs/productionDatabaseCommandGuard`) — NEITHER pulls in
 * `@/libs/Env`, so every function here, including `--help` handling, runs
 * safely with no environment configured at all. Every function is pure
 * (no I/O, no DB connection, no process.exit) so the dry-run/apply-style
 * refusal DECISIONS are unit-testable without a database — plan §5 P8a,
 * item 6 ("CLI guard logic ... factor into a pure function").
 *
 * What this module intentionally does NOT do: verify the live
 * `luster_environment` marker (that needs a real connection) or attest a
 * Production target (`rejectNonProductionMarkerForProduction`, also
 * connection-bound). `billing-integrity-check.ts` performs those AFTER
 * this module's decision says a connection attempt is allowed.
 */

import {
  NonProductionDatabaseGuardError,
  requireNonProductionDatabaseTarget,
} from '../../src/libs/nonProductionDatabaseGuard';
import {
  ProductionDatabaseCommandGuardError,
  requireProductionDatabaseCommandConfirmation,
} from '../../src/libs/productionDatabaseCommandGuard';

export class UsageError extends Error {}

// -----------------------------------------------------------------------
// Host-classification helpers
// -----------------------------------------------------------------------

export type ScriptEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Host-only classification (no connection): a target "looks non-production"
 * when its hostname is on the approved non-Production allowlist
 * (`requireNonProductionDatabaseTarget` — loopback, or an operator-approved
 * `LUSTER_NONPROD_DB_HOSTS` entry). Anything else — including a real
 * Production Neon host, or simply an unlisted host — is treated as
 * "production-looking" and requires the Production confirmation layer.
 * A malformed/missing URL is refused outright, in every mode.
 */
export type TargetClassification =
  | { kind: 'non-production' }
  | { kind: 'production-looking' }
  | { kind: 'invalid'; reason: string };

export function classifyDatabaseTarget(
  environment: ScriptEnvironment,
): TargetClassification {
  try {
    requireNonProductionDatabaseTarget(environment);
    return { kind: 'non-production' };
  } catch (error) {
    if (!(error instanceof NonProductionDatabaseGuardError)) {
      return { kind: 'invalid', reason: 'the database target could not be resolved safely' };
    }
    if (error.code === 'HOST_NOT_ALLOWED' || error.code === 'HOSTED_PROVIDER_NOT_ALLOWLISTED') {
      // A syntactically valid PostgreSQL URL whose host simply is not on the
      // non-Production allowlist — this is the "production-looking" case,
      // not a malformed-input case.
      return { kind: 'production-looking' };
    }
    return { kind: 'invalid', reason: error.message };
  }
}

function effectiveEnvironment(
  environment: ScriptEnvironment,
  databaseUrlOverride: string | null,
): ScriptEnvironment {
  if (databaseUrlOverride === null) {
    return environment;
  }
  return { ...environment, DATABASE_URL: databaseUrlOverride };
}

export type GuardDecision =
  | { allowed: true; targetKind: 'non-production' | 'production' }
  | { allowed: false; reason: string };

function readFlagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return null;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} requires a value.`);
  }
  return value;
}

// -----------------------------------------------------------------------
// billing-integrity-check.ts
// -----------------------------------------------------------------------

export type IntegrityCheckArgs = {
  help: boolean;
  allowProduction: boolean;
  reportSentry: boolean;
  databaseUrl: string | null;
};

export const BILLING_INTEGRITY_CHECK_USAGE = `Usage: npx tsx scripts/billing-integrity-check.ts [--allow-production] [--report-sentry] [--database-url <url>]

  --allow-production      Permit a production-looking target. Still read-only; still requires
                           LUSTER_PRODUCTION_CONFIRM set to today's local date (YYYY-MM-DD).
  --report-sentry         Emit one Sentry.captureMessage('billing.integrity_violation', ...)
                           per distinct violation CODE found (never per row).
  --database-url <url>    Optional override for DATABASE_URL.
  -h, --help              Print this message and exit without connecting to any database.

Read-only. Safe to run anywhere, including CI. Exits 3 when violations are found, 0 otherwise.`;

export function parseIntegrityCheckArgs(argv: readonly string[]): IntegrityCheckArgs {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true, allowProduction: false, reportSentry: false, databaseUrl: null };
  }

  return {
    help: false,
    allowProduction: argv.includes('--allow-production'),
    reportSentry: argv.includes('--report-sentry'),
    databaseUrl: readFlagValue(argv, '--database-url'),
  };
}

/**
 * Read-only, so CI is explicitly NOT refused here (plan §5 P8a: "runnable
 * locally/CI"). Non-production is the default target; a production-looking
 * target additionally requires `--allow-production` AND the same
 * `LUSTER_PRODUCTION_CONFIRM` date confirmation `scripts/database-command.ts`
 * uses — reading Production data is still gated by fresh, explicit intent,
 * never by connection reachability alone.
 */
export function decideIntegrityCheckGuard(
  options: { allowProduction: boolean; databaseUrl: string | null },
  environment: ScriptEnvironment,
): GuardDecision {
  const classification = classifyDatabaseTarget(
    effectiveEnvironment(environment, options.databaseUrl),
  );

  if (classification.kind === 'invalid') {
    return { allowed: false, reason: `database target rejected: ${classification.reason}` };
  }

  if (classification.kind === 'non-production') {
    return { allowed: true, targetKind: 'non-production' };
  }

  // production-looking
  if (!options.allowProduction) {
    return {
      allowed: false,
      reason: 'refused: the database target is not on the approved non-Production allowlist. '
        + 'Pass --allow-production to read a production-looking target.',
    };
  }

  try {
    requireProductionDatabaseCommandConfirmation(environment);
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof ProductionDatabaseCommandGuardError
        ? error.message
        : '--allow-production refused: Production confirmation could not be verified safely.',
    };
  }

  return { allowed: true, targetKind: 'production' };
}
