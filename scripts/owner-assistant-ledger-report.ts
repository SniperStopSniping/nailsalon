/**
 * Owner Assistant — ledger report (A1-4, deliverable G).
 *
 * READ-ONLY. Reads the durable per-turn evidence rows
 * (`salon_audit_log` where `action = 'owner_assistant_turn'`,
 * docs/OWNER_ASSISTANT_CHAT.md §6) for one salon over a date range and prints
 * turns per day, the outcome mix, p50/p95 latency, token totals and cost.
 *
 * It never writes. That is structural, not a promise: every statement runs
 * inside `BEGIN TRANSACTION READ ONLY`, so the server itself refuses a write.
 *
 * ---------------------------------------------------------------------------
 * GUARD — the repo's own database-command discipline (scripts/database-command.ts)
 * ---------------------------------------------------------------------------
 *  - CI may not run it.
 *  - The target is resolved with `requirePostgresDatabaseTarget`.
 *  - A target whose HOST is not an allowlisted non-production host requires
 *    `LUSTER_PRODUCTION_CONFIRM` to exactly equal today's local date — the same
 *    `requireProductionDatabaseCommandConfirmation` every production database
 *    command already requires — and is then attested with
 *    `rejectNonProductionMarkerForProduction` before a single row is read.
 *  - A non-production-shaped target must still ATTEST as Development or Preview
 *    through its own marker. If it cannot, it is treated as Production and needs
 *    the confirmation: an unattested target is never given the benefit of the
 *    doubt.
 *
 * ---------------------------------------------------------------------------
 * HOW AN OPERATOR RUNS IT
 * ---------------------------------------------------------------------------
 *   # against the development database
 *   npx dotenv -e .env.development.local -- tsx scripts/owner-assistant-ledger-report.ts \
 *     --salon salon_abc123 --from 2026-09-01 --to 2026-09-16
 *
 *   # against production (same confirmation every production command needs)
 *   LUSTER_PRODUCTION_CONFIRM=$(date +%F) \
 *   npx dotenv -e .env.production.local -- tsx scripts/owner-assistant-ledger-report.ts \
 *     --salon salon_abc123 --from 2026-09-01 --to 2026-09-16
 *
 * `--salon` is the salon ID (the `salon_id` column), not the slug.
 * Dates are inclusive and interpreted in UTC, matching the ledger's own
 * `created_at` and the budget counters' UTC day keys.
 */
import { Client } from 'pg';

import {
  NonProductionDatabaseGuardError,
  rejectNonProductionMarkerForProduction,
  requireExactNonProductionDatabaseEnvironment,
  requireNonProductionDatabaseTarget,
  requirePostgresDatabaseTarget,
} from '../src/libs/nonProductionDatabaseGuard';
import { OWNER_ASSISTANT_AUDIT_ACTION_NAME } from '../src/libs/ownerAssistant/__evals__/ledgerReportContract';
import {
  ProductionDatabaseCommandGuardError,
  requireProductionDatabaseCommandConfirmation,
} from '../src/libs/productionDatabaseCommandGuard';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type ReportOptions = {
  salonId: string;
  from: string;
  to: string;
};

type LedgerModelCall = {
  inputCount?: number;
  cachedInputCount?: number;
  cacheWriteInputCount?: number;
  outputCount?: number;
  latencyMs?: number;
};

type LedgerNewValue = {
  outcome?: string;
  model?: string;
  costMicros?: number;
  priceKnown?: boolean;
  modelCalls?: LedgerModelCall[];
  toolCalls?: Array<{ name?: string; ok?: boolean }>;
};

type LedgerRow = {
  created_at: Date;
  metadata: { newValue?: LedgerNewValue } | null;
};

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function isCiEnvironment(): boolean {
  return process.env.CI === 'true'
    || process.env.CI === '1'
    || process.env.GITHUB_ACTIONS === 'true'
    || process.env.GITHUB_ACTIONS === '1';
}

const USAGE = [
  'Usage: tsx scripts/owner-assistant-ledger-report.ts --salon <salonId> --from <YYYY-MM-DD> --to <YYYY-MM-DD>',
  '',
  'Read-only report over the owner-assistant turn ledger. A production target',
  'requires LUSTER_PRODUCTION_CONFIRM to equal today\'s local date.',
].join('\n');

function parseArguments(argv: readonly string[]): ReportOptions | null {
  let salonId = '';
  let from = '';
  let to = '';

  for (let index = 0; index < argv.length; index++) {
    const value = argv[index + 1];
    switch (argv[index]) {
      case '--salon':
        if (!value) {
          return null;
        }
        salonId = value;
        index++;
        break;
      case '--from':
        if (!value) {
          return null;
        }
        from = value;
        index++;
        break;
      case '--to':
        if (!value) {
          return null;
        }
        to = value;
        index++;
        break;
      default:
        return null;
    }
  }

  if (!salonId || !DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
    return null;
  }

  return { salonId, from, to };
}

/** Nearest-rank percentile, matching the eval harness's own definition. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1] ?? 0;
}

function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

/** Host-shape only: a static decision, made before anything connects. */
function isNonProductionShapedTarget(): boolean {
  try {
    requireNonProductionDatabaseTarget(process.env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attests the connected target and refuses if it may not be read. Returns the
 * classification so the report can say which database it read.
 */
async function attestTarget(
  client: Client,
  nonProductionShaped: boolean,
): Promise<'development' | 'preview' | 'production'> {
  if (nonProductionShaped) {
    for (const environment of ['development', 'preview'] as const) {
      try {
        await requireExactNonProductionDatabaseEnvironment(client, environment);
        return environment;
      } catch {
        // Try the next marker; an UNATTESTED target falls through to the
        // production path below and needs the production confirmation. An
        // unmarked database is never given the benefit of the doubt.
      }
    }
  }

  // Production path — exactly what scripts/database-command.ts requires.
  requireProductionDatabaseCommandConfirmation(process.env);
  await rejectNonProductionMarkerForProduction(client);

  return 'production';
}

function summarize(rows: readonly LedgerRow[]): void {
  const perDay = new Map<string, number>();
  const outcomes = new Map<string, number>();
  const toolUse = new Map<string, { ok: number; failed: number }>();
  const latencies: number[] = [];
  const models = new Set<string>();
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteTokens = 0;
  let outputTokens = 0;
  let costMicros = 0;
  let unpricedTurns = 0;

  for (const row of rows) {
    const value = row.metadata?.newValue ?? {};
    const day = row.created_at.toISOString().slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);

    const outcome = value.outcome ?? 'unknown';
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);

    if (value.model) {
      models.add(value.model);
    }

    let turnLatency = 0;
    for (const call of value.modelCalls ?? []) {
      inputTokens += call.inputCount ?? 0;
      cachedInputTokens += call.cachedInputCount ?? 0;
      cacheWriteTokens += call.cacheWriteInputCount ?? 0;
      outputTokens += call.outputCount ?? 0;
      turnLatency += call.latencyMs ?? 0;
    }
    if ((value.modelCalls ?? []).length > 0) {
      latencies.push(turnLatency);
    }

    for (const call of value.toolCalls ?? []) {
      const name = call.name ?? 'unknown';
      const bucket = toolUse.get(name) ?? { ok: 0, failed: 0 };
      if (call.ok === true) {
        bucket.ok += 1;
      } else {
        bucket.failed += 1;
      }
      toolUse.set(name, bucket);
    }

    costMicros += value.costMicros ?? 0;
    if (value.priceKnown === false) {
      unpricedTurns += 1;
    }
  }

  const sortedLatencies = [...latencies].sort((a, b) => a - b);

  write('');
  write(`Turns: ${rows.length}`);
  write(`Models seen: ${[...models].join(', ') || 'none'}`);
  write('');
  write('Turns per day (UTC)');
  for (const day of [...perDay.keys()].sort()) {
    write(`  ${day}  ${perDay.get(day)}`);
  }

  write('');
  write('Outcome mix');
  for (const [outcome, count] of [...outcomes.entries()].sort((a, b) => b[1] - a[1])) {
    const share = rows.length === 0 ? 0 : (count / rows.length) * 100;
    write(`  ${outcome.padEnd(34)} ${String(count).padStart(5)}  ${share.toFixed(1)}%`);
  }

  if (toolUse.size > 0) {
    write('');
    write('Tool calls');
    for (const [name, bucket] of [...toolUse.entries()].sort((a, b) => (b[1].ok + b[1].failed) - (a[1].ok + a[1].failed))) {
      write(`  ${name.padEnd(34)} ok ${String(bucket.ok).padStart(5)}  failed ${String(bucket.failed).padStart(5)}`);
    }
  }

  write('');
  write('Latency (sum of a turn\'s model calls)');
  write(`  p50 ${percentile(sortedLatencies, 0.5)} ms`);
  write(`  p95 ${percentile(sortedLatencies, 0.95)} ms`);

  write('');
  write('Tokens');
  write(`  input        ${inputTokens}`);
  write(`  cached input ${cachedInputTokens}`);
  write(`  cache writes ${cacheWriteTokens}`);
  write(`  output       ${outputTokens}`);

  write('');
  write('Cost (as the ledger recorded it)');
  write(`  total     ${formatMicros(costMicros)}`);
  write(`  per turn  ${rows.length === 0 ? formatMicros(0) : formatMicros(Math.round(costMicros / rows.length))}`);
  if (unpricedTurns > 0) {
    write(`  ${unpricedTurns} turn(s) ran on a model with no price-table entry and are costed as 0.`);
  }
}

async function main(argv: readonly string[]): Promise<void> {
  if (isCiEnvironment()) {
    fail('Owner assistant ledger report rejected: database commands are forbidden in CI.');
    return;
  }

  const options = parseArguments(argv);
  if (!options) {
    fail(USAGE);
    return;
  }

  let target: ReturnType<typeof requirePostgresDatabaseTarget>;
  let nonProductionShaped: boolean;
  try {
    target = requirePostgresDatabaseTarget(process.env);
    nonProductionShaped = isNonProductionShapedTarget();
    if (!nonProductionShaped) {
      // A production-shaped target needs fresh, explicit intent BEFORE this
      // script opens a connection to it at all.
      requireProductionDatabaseCommandConfirmation(process.env);
    }
  } catch (error) {
    fail(
      error instanceof NonProductionDatabaseGuardError
      || error instanceof ProductionDatabaseCommandGuardError
        ? error.message
        : 'Owner assistant ledger report rejected safely.',
    );
    return;
  }

  const client = new Client({ connectionString: target.connectionString });
  let connected = false;

  try {
    await client.connect();
    connected = true;

    const classification = await attestTarget(client, nonProductionShaped);

    // Read-only for the whole session: the server refuses a write even if a
    // later edit to this file tried one.
    await client.query('BEGIN TRANSACTION READ ONLY');
    const result = await client.query<LedgerRow>(
      `select created_at, metadata
         from salon_audit_log
        where salon_id = $1
          and action = $2
          and created_at >= $3::date
          and created_at < ($4::date + interval '1 day')
        order by created_at asc`,
      [options.salonId, OWNER_ASSISTANT_AUDIT_ACTION_NAME, options.from, options.to],
    );
    await client.query('COMMIT');

    write(`Owner assistant ledger — salon ${options.salonId}`);
    write(`Range ${options.from} … ${options.to} (inclusive, UTC)`);
    write(`Database: ${classification} (${target.host})`);
    summarize(result.rows);
  } catch (error) {
    if (connected) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    fail(
      error instanceof ProductionDatabaseCommandGuardError
      || error instanceof NonProductionDatabaseGuardError
        ? error.message
        : 'Owner assistant ledger report rejected safely.',
    );
  } finally {
    if (connected) {
      await client.end().catch(() => undefined);
    }
  }
}

void main(process.argv.slice(2));
