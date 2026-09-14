/**
 * P8a operator script — G12 (plan §5 P8a; contract §19): read-only billing
 * ledger/reservation/checkout-attempt integrity report.
 *
 * Read-only. Safe to run anywhere, including CI, with no billing switches,
 * Stripe keys, or Clerk keys configured — `src/libs/billing/integrityCheck.ts`
 * imports only pure balance arithmetic and the schema, never
 * `@/libs/Env`/`@/libs/DB`/the live mutation modules. This script never
 * writes to the database and never calls Stripe. (It still imports
 * `server-only` transitively, same as every module under `src/libs/billing`;
 * see `./lib/reExecWithServerOnlyCondition.ts` for why and how that is
 * handled for a plain `npx tsx` invocation.)
 *
 * Target resolution defaults to non-Production (hostname allowlist + live
 * marker check), but a production-looking target is reachable with
 * `--allow-production` alone (still read-only) once
 * LUSTER_PRODUCTION_CONFIRM === today's local date
 * (`requireProductionDatabaseCommandConfirmation`) and the live marker
 * attests it really is Production (`rejectNonProductionMarkerForProduction`)
 * — the same date-confirmation layer `scripts/database-command.ts` uses for
 * its production migrate command.
 *
 * Exit codes: 0 = clean, 3 = violations found, 2 = refused by a guard,
 * 1 = error.
 */

import 'dotenv/config';

/* eslint-disable no-console -- Operator script prints a JSON integrity report. */
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import {
  NonProductionDatabaseGuardError,
  rejectNonProductionMarkerForProduction,
  requireExactNonProductionDatabaseEnvironment,
} from '../src/libs/nonProductionDatabaseGuard';
import { ProductionDatabaseCommandGuardError } from '../src/libs/productionDatabaseCommandGuard';
import * as schema from '../src/models/Schema';
import {
  BILLING_INTEGRITY_CHECK_USAGE,
  decideIntegrityCheckGuard,
  parseIntegrityCheckArgs,
  UsageError,
} from './lib/billingScriptGuards';
import { ensureServerOnlyConditionOrReExec } from './lib/reExecWithServerOnlyCondition';

const THIS_SCRIPT_PATH = fileURLToPath(import.meta.url);

function fail(message: string, exitCode: 1 | 2): never {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

async function verifyNonProductionMarker(client: Client): Promise<'development' | 'preview'> {
  try {
    return await requireExactNonProductionDatabaseEnvironment(client, 'development');
  } catch (error) {
    if (!(error instanceof NonProductionDatabaseGuardError) || error.code !== 'MARKER_ENVIRONMENT_MISMATCH') {
      throw error;
    }
  }
  return requireExactNonProductionDatabaseEnvironment(client, 'preview');
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseIntegrityCheckArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof UsageError ? error.message : 'Invalid arguments.';
    process.stderr.write(`${message}\n\n${BILLING_INTEGRITY_CHECK_USAGE}\n`);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(`${BILLING_INTEGRITY_CHECK_USAGE}\n`);
    return;
  }

  const decision = decideIntegrityCheckGuard(
    { allowProduction: args.allowProduction, databaseUrl: args.databaseUrl },
    process.env,
  );
  if (!decision.allowed) {
    fail(`Refused: ${decision.reason}`, 2);
  }

  // Past every refusal path — about to connect and touch
  // `src/libs/billing/integrityCheck.ts`, which is `server-only`-marked
  // like the rest of that directory. Re-execs itself (once) with the
  // `react-server` condition that needs under plain tsx.
  ensureServerOnlyConditionOrReExec(THIS_SCRIPT_PATH);

  const connectionString = args.databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    fail('Refused: DATABASE_URL is required (set it, or pass --database-url).', 2);
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch {
    fail('Could not connect to the database target.', 1);
  }

  let exitCode = 0;
  try {
    if (decision.targetKind === 'non-production') {
      await verifyNonProductionMarker(client);
    } else {
      await rejectNonProductionMarkerForProduction(client);
    }

    const { runBillingIntegrityCheck } = await import('../src/libs/billing/integrityCheck');

    const db = drizzle(client, { schema });
    const report = await runBillingIntegrityCheck(db, { now: new Date() });

    console.log(JSON.stringify({
      target: decision.targetKind,
      checkedAt: report.summary.checkedAt.toISOString(),
      violationCount: report.summary.violationCount,
      byCode: report.summary.byCode,
      salonAccountsChecked: report.summary.salonAccountsChecked,
      reservationsChecked: report.summary.reservationsChecked,
      heldTopupAttemptsExamined: report.summary.heldTopupAttemptsExamined,
      violations: report.violations,
    }, null, 2));

    if (args.reportSentry && report.summary.violationCount > 0) {
      const Sentry = await import('@sentry/nextjs');
      // One message per DISTINCT CODE, never per row (item 5: the
      // observability budget in §19 is about signal, not spam).
      for (const code of Object.keys(report.summary.byCode)) {
        Sentry.captureMessage('billing.integrity_violation', {
          level: 'warning',
          extra: { code, count: report.summary.byCode[code as keyof typeof report.summary.byCode] },
        });
      }
    }

    exitCode = report.summary.violationCount > 0 ? 3 : 0;
  } catch (error) {
    if (error instanceof NonProductionDatabaseGuardError || error instanceof ProductionDatabaseCommandGuardError) {
      await client.end().catch(() => undefined);
      fail(`Refused: ${error.message}`, 2);
    }
    await client.end().catch(() => undefined);
    fail(error instanceof Error ? error.message : String(error), 1);
  }

  await client.end();
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
