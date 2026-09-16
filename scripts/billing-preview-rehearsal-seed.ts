#!/usr/bin/env tsx
/**
 * Minimal, guarded, idempotent seed for the **billing rehearsal salon** on the
 * **Preview** database.
 *
 * WHY THIS SCRIPT EXISTS
 * ---------------------------------------------------------------------------
 * No existing command can seed the Preview database:
 *   - `npm run db:seed:e2e` is hard-pinned to the disposable loopback target
 *     (`src/libs/disposableDatabaseTarget.ts:274-312` — host must be
 *     127.0.0.1/localhost, port 55432, user `luster_e2e_ci`, database
 *     `luster_e2e_ci_disposable`, and `neon.tech` is explicitly banned at
 *     `:16-26,268-270`).
 *   - `scripts/seed.ts:46,72` refuses anything but a `development` marker.
 *   - `scripts/preview-service-image-fixtures.ts` expects a different database
 *     name, port and role than this Preview project has.
 *
 * WHAT IT SEEDS (and nothing else)
 * ---------------------------------------------------------------------------
 *   1. `salon`                   — the rehearsal salon row.
 *   2. `admin_user`              — the rehearsal OWNER (`is_super_admin=false`),
 *                                  linked to the Preview Clerk user id.
 *   3. `admin_salon_membership`  — `role='owner'`, which is what
 *                                  `requireAdmin` checks for a non-super-admin
 *                                  (`src/libs/adminAuth.ts:444-455`).
 *
 * It deliberately creates NO billing row and NO `sms_credit_account`:
 * `lockCreditAccount` (`src/libs/billing/creditLedger.ts:50-63`) inserts the
 * account lazily with `onConflictDoNothing` on first use, and
 * `grantStarterCredits` calls it (`src/libs/billing/creditGrants.ts:62`).
 * Pre-creating it would fabricate evidence the rehearsal is meant to produce.
 * It also creates no `salon_location`, `service` or `technician` rows — none of
 * the billing surfaces read them.
 *
 * SAFETY GATES (every one refuses rather than guesses)
 * ---------------------------------------------------------------------------
 *  1. CONNECTION SOURCE. The connection string is read from
 *     `PREVIEW_REHEARSAL_DATABASE_URL` **only**. `DATABASE_URL` is never read,
 *     so a shell that happens to carry a production or development URL cannot
 *     be used by accident.
 *  2. TYPED HOST. `--expect-host <hostname>` is REQUIRED in every mode and must
 *     equal the connection string's hostname exactly (ASCII-lowercased, trailing
 *     dot and IPv6 brackets normalized away). The operator therefore types the
 *     Preview hostname deliberately. Only the hostname is ever printed; the
 *     connection string, user and password are never printed, quoted or logged.
 *  3. URL SHAPE. Same structural rules as
 *     `src/libs/nonProductionDatabaseGuard.ts:263-281`: `postgres:`/`postgresql:`
 *     only, no `#` fragment, no routing-override query key (`host`, `hostaddr`,
 *     `port`, `user`, `password`, `database`, `dbname`) that could send the
 *     driver somewhere other than the hostname just attested.
 *  4. LIVE MARKER. `SELECT environment FROM public.luster_environment` must
 *     return EXACTLY ONE row equal to `'preview'` — the same authoritative
 *     marker `requireExactNonProductionDatabaseEnvironment` demands
 *     (`nonProductionDatabaseGuard.ts:327-387`). It is re-checked a second time
 *     INSIDE the write transaction, so the transaction that writes is itself
 *     attested.
 *  5. NO FOREIGN ROWS ARE EVER TOUCHED. A pre-existing salon at the target slug
 *     is accepted only if it carries BOTH this script's deterministic id prefix
 *     (`rehearsal-`) AND its `internal_notes` marker. Anything else aborts.
 *     Likewise a pre-existing `admin_user` colliding on id, `lower(email)` or
 *     `clerk_user_id` must be this script's own row with the same inputs.
 *  6. DRY RUN IS THE DEFAULT, AND THE SESSION SAYS SO. `--plan` (also the
 *     default with no mode flag) and `--verify` issue
 *     `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` as their FIRST
 *     statement, before any other query, and then assert it took effect by
 *     reading `SHOW transaction_read_only` back (`enforceReadOnlySession`).
 *     PostgreSQL itself then rejects any INSERT/UPDATE/DELETE/DDL in those two
 *     modes with `25006 read_only_sql_transaction`, so read-only-ness is a
 *     session property rather than a promise about which statements the code
 *     happens to issue today. `--apply` deliberately does NOT set it — it is
 *     the one mode that writes. Nothing is written without an explicit
 *     `--apply`.
 *  6b. NO CREDENTIAL REACHES STDERR. Every error output path is passed through
 *     a redactor built from the parsed connection URL's user, password and
 *     host (`buildConnectionRedactor`), because the most likely pg failure —
 *     28P01 — carries the role name verbatim (`password authentication failed
 *     for user "<role>"`) and gate 2 promises it is never printed.
 *  7. ONE TRANSACTION. `--apply` wraps the marker re-check, an advisory lock on
 *     the slug, both precondition checks and all three inserts in a single
 *     `BEGIN`/`COMMIT`; any refusal rolls the whole thing back.
 *  8. THE BILLING SWITCHES ARE NOT TOUCHED. `BILLING_SUBSCRIPTIONS_ENABLED`,
 *     `BILLING_TOPUPS_ENABLED`, `PUBLIC_PRICING_ENABLED` and
 *     `BILLING_TAX_COLLECTION_ENABLED` are never read, written or defaulted,
 *     and nothing here opens the founding-promotion window.
 *  9. NO NETWORK BEYOND POSTGRES. No Stripe call, no Vercel call, no deploy, no
 *     `@/libs/DB` import (which would build a Drizzle pool from `DATABASE_URL`),
 *     no `server-only` module import.
 *
 * PICKING `--plan-tier`
 * ---------------------------------------------------------------------------
 * Top-up audience is derived SERVER-SIDE from `salon.plan`:
 * `resolveTopupAudienceForLegacyPlan` (`src/libs/billing/legacyPlanAdapter.ts:112-114`)
 * maps `'free'` — and any NULL or unrecognized value, via `normalizeLegacyPlan`
 * at `:59-64`, whose fallback is `'free'` — to `'free_plan'`, and every other
 * `SALON_PLANS` value (`src/models/Schema.ts:2762`) to `'paid_plan'`. The route
 * rejects a mismatched offer with `400 OFFER_AUDIENCE_MISMATCH`
 * (`src/app/api/billing/checkout/topup/route.ts:115-118`).
 *
 *   - Free-audience rehearsal (the default): `--plan-tier free`  → the three
 *     `free_plan` offers in `src/libs/billing/topupOffers.ts:42,50,58` apply.
 *   - Paid-audience rehearsal: re-run with `--plan-tier single_salon` (or
 *     `multi_salon` / `enterprise`) and a DIFFERENT `--slug`, so the two
 *     rehearsal salons coexist; the four `paid_plan` offers at
 *     `topupOffers.ts:66,74,82,90` then apply. Do not mutate an existing
 *     rehearsal salon's plan — this script never updates a row it finds.
 *
 * Both top-up and subscription checkout are dark (503) while the billing
 * switches stay unset, so the only billing action rehearsable today is the
 * super-admin starter grant, which is not switch-gated.
 *
 * USAGE
 * ---------------------------------------------------------------------------
 *   export PREVIEW_REHEARSAL_DATABASE_URL='postgresql://...'   # never printed
 *
 *   npx tsx scripts/billing-preview-rehearsal-seed.ts --plan \
 *       --expect-host <preview-neon-hostname> \
 *       [--slug isla-rehearsal] [--name 'Isla Rehearsal (Preview)'] \
 *       [--plan-tier free] \
 *       --owner-clerk-user-id user_xxx --owner-email owner@example.com
 *
 *   npx tsx scripts/billing-preview-rehearsal-seed.ts --apply \
 *       --expect-host <preview-neon-hostname> \
 *       --owner-clerk-user-id user_xxx --owner-email owner@example.com
 *
 *   npx tsx scripts/billing-preview-rehearsal-seed.ts --verify \
 *       --expect-host <preview-neon-hostname> [--slug isla-rehearsal]
 *
 * Exit codes: 0 success · 2 usage error · 3 safety-gate refusal ·
 * 4 verification failure · 5 database error.
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The ONLY environment variable this script reads a connection string from. */
export const CONNECTION_ENV_VAR = 'PREVIEW_REHEARSAL_DATABASE_URL';

/** Deterministic id prefix — half of the "this script authored it" proof. */
export const REHEARSAL_ID_PREFIX = 'rehearsal-';

/** `salon.internal_notes` stamp — the other half of that proof. */
export const REHEARSAL_MARKER = 'luster-billing-preview-rehearsal-v1';

export const DEFAULT_SLUG = 'isla-rehearsal';
export const DEFAULT_NAME = 'Isla Rehearsal (Preview)';

/**
 * LOCAL COPY of `SALON_PLANS` at `src/models/Schema.ts:2762`. Not imported:
 * `Schema.ts` pulls the whole Drizzle model graph, and the billing modules that
 * re-export plan helpers carry `import 'server-only'`
 * (`src/libs/billing/legacyPlanAdapter.ts` → `topupOffers.ts:12`), which throws
 * outside Node's `react-server` condition. `assertPlanTiersMatchSchema()` below
 * re-reads that line's text so the copies cannot drift unnoticed.
 */
export const SALON_PLAN_TIERS = ['free', 'single_salon', 'multi_salon', 'enterprise'] as const;
export type SalonPlanTier = (typeof SALON_PLAN_TIERS)[number];

/** Free-audience tier, so the free-plan top-up offers apply by default. */
export const DEFAULT_PLAN_TIER: SalonPlanTier = 'free';

/** Mirrors `nonProductionDatabaseGuard.ts:13-21`. */
const ROUTING_OVERRIDE_QUERY_KEYS = new Set([
  'database',
  'dbname',
  'host',
  'hostaddr',
  'password',
  'port',
  'user',
]);

/** Byte-identical to `nonProductionDatabaseGuard.ts:23-24`, minus the LIMIT. */
export const MARKER_QUERY = 'SELECT environment FROM public.luster_environment LIMIT 2';

export const EXIT = {
  ok: 0,
  usage: 2,
  refusal: 3,
  verification: 4,
  database: 5,
} as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SeedError extends Error {
  public readonly exitCode: number;
  public readonly code: string;

  constructor(exitCode: number, code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SeedError';
    this.exitCode = exitCode;
    this.code = code;
  }
}

export class UsageError extends SeedError {
  constructor(code: string, message: string) {
    super(EXIT.usage, code, message);
    this.name = 'UsageError';
  }
}

export class RefusalError extends SeedError {
  constructor(code: string, message: string) {
    super(EXIT.refusal, code, message);
    this.name = 'RefusalError';
  }
}

export class VerificationError extends SeedError {
  constructor(code: string, message: string) {
    super(EXIT.verification, code, message);
    this.name = 'VerificationError';
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function emit(line: string): void {
  process.stdout.write(`${line}\n`);
}

function emitError(line: string): void {
  process.stderr.write(`${line}\n`);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export type SeedMode = 'plan' | 'apply' | 'verify';

export type SeedArguments = {
  mode: SeedMode;
  expectHost: string;
  slug: string;
  name: string;
  planTier: SalonPlanTier;
  ownerClerkUserId: string | null;
  ownerEmail: string | null;
};

const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const USAGE = `Usage:
  npx tsx scripts/billing-preview-rehearsal-seed.ts --plan --expect-host <preview hostname>
      [--slug <slug>] [--name <display name>] [--plan-tier <tier>]
      [--owner-clerk-user-id <user_...>] [--owner-email <address>]
  npx tsx scripts/billing-preview-rehearsal-seed.ts --apply --expect-host <preview hostname>
      --owner-clerk-user-id <user_...> --owner-email <address> [--slug <slug>] [--name <display name>]
      [--plan-tier <tier>]
  npx tsx scripts/billing-preview-rehearsal-seed.ts --verify --expect-host <preview hostname> [--slug <slug>]

  --plan                    Dry run (the default). The session is SET READ ONLY before any query.
  --apply                   The one mode that writes: three rows, one transaction, ON CONFLICT DO NOTHING.
  --verify                  Read-only evidence query for the seeded salon, owner and membership.
  --expect-host <hostname>  REQUIRED in every mode. Must equal the hostname inside
                            ${CONNECTION_ENV_VAR}; only the hostname is ever printed.
  --slug <slug>             Salon slug (default: ${DEFAULT_SLUG}).
  --name <name>             Salon display name (default: ${DEFAULT_NAME}).
  --plan-tier <tier>        One of ${SALON_PLAN_TIERS.join(', ')} (default: ${DEFAULT_PLAN_TIER}). Decides the
                            top-up audience the route derives server-side from salon.plan.
  --owner-clerk-user-id <id>
                            Clerk user id of the rehearsal owner. Required for --apply.
  --owner-email <address>   Owner email. Required for --apply.
  -h, --help                Print this and exit.

Connection source: ${CONNECTION_ENV_VAR} only (never DATABASE_URL). The connection string, its user and
its password are never printed. The database must carry the single-row 'preview' marker in
public.luster_environment, re-checked inside the write transaction.

This script NEVER creates a super-admin (admin_user.is_super_admin is hard-coded false) and never
touches the BILLING_* switches. The first super-admin on a Preview deployment is bootstrapped by the
owner — see docs/BILLING_PREVIEW_REHEARSAL.md §5.`;

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new UsageError('MISSING_VALUE', `${flag} requires a value`);
  }
  return value;
}

/**
 * Same normalization `nonProductionDatabaseGuard` applies to a URL host: ASCII
 * lowercase, IPv6 brackets stripped, one trailing dot removed. Applied to BOTH
 * sides of the `--expect-host` comparison so an operator typing `HOST.` or
 * `Host` is not silently compared against a different string.
 */
export function normalizeHost(host: string): string {
  let normalized = host.trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Email shape check matching the only thing billing does with the value:
 * `normalizeEmailForHmac` (`src/libs/billing/businessIdentity.ts:33-41`) rejects
 * anything whose last `@` is at position 0 or at the end.
 */
export function isPlausibleEmail(value: string): boolean {
  if (/\s/.test(value)) {
    return false;
  }
  const at = value.lastIndexOf('@');
  return at > 0 && at < value.length - 1;
}

export function parseArguments(argv: string[]): SeedArguments {
  const modes: SeedMode[] = [];
  let expectHost: string | null = null;
  let slug = DEFAULT_SLUG;
  let name = DEFAULT_NAME;
  let planTier: SalonPlanTier = DEFAULT_PLAN_TIER;
  let ownerClerkUserId: string | null = null;
  let ownerEmail: string | null = null;

  const setMode = (next: SeedMode): void => {
    const conflicting = modes.find(mode => mode !== next);
    if (conflicting !== undefined) {
      throw new UsageError('MODE_CONFLICT', `--${conflicting} and --${next} are mutually exclusive`);
    }
    modes.push(next);
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    switch (argument) {
      case '--plan':
        setMode('plan');
        break;
      case '--apply':
        setMode('apply');
        break;
      case '--verify':
        setMode('verify');
        break;
      case '--expect-host':
        index += 1;
        expectHost = normalizeHost(requireValue('--expect-host', argv[index]));
        break;
      case '--slug':
        index += 1;
        slug = requireValue('--slug', argv[index]).trim();
        break;
      case '--name':
        index += 1;
        name = requireValue('--name', argv[index]).trim();
        break;
      case '--plan-tier': {
        index += 1;
        const value = requireValue('--plan-tier', argv[index]).trim();
        if (!(SALON_PLAN_TIERS as readonly string[]).includes(value)) {
          throw new UsageError(
            'PLAN_TIER_UNKNOWN',
            `--plan-tier must be one of ${SALON_PLAN_TIERS.join(', ')} (Schema.ts:2762), got "${value}"`,
          );
        }
        planTier = value as SalonPlanTier;
        break;
      }
      case '--owner-clerk-user-id':
        index += 1;
        ownerClerkUserId = requireValue('--owner-clerk-user-id', argv[index]).trim();
        break;
      case '--owner-email':
        index += 1;
        ownerEmail = requireValue('--owner-email', argv[index]).trim();
        break;
      default:
        throw new UsageError('UNKNOWN_ARGUMENT', `unrecognized argument "${argument}"`);
    }
  }

  const resolvedMode: SeedMode = modes[0] ?? 'plan';

  if (expectHost === null) {
    throw new UsageError(
      'EXPECT_HOST_REQUIRED',
      '--expect-host <hostname> is required in every mode: it is the deliberate, typed proof of which database is being touched',
    );
  }
  if (!SLUG_SHAPE.test(slug)) {
    throw new UsageError('SLUG_SHAPE', `--slug must be lowercase alphanumeric with internal hyphens, got "${slug}"`);
  }
  if (name.length === 0) {
    throw new UsageError('NAME_EMPTY', '--name must not be empty');
  }
  if (ownerClerkUserId !== null && /\s/.test(ownerClerkUserId)) {
    throw new UsageError('OWNER_CLERK_USER_ID_SHAPE', '--owner-clerk-user-id must not contain whitespace');
  }
  if (ownerEmail !== null && !isPlausibleEmail(ownerEmail)) {
    throw new UsageError('OWNER_EMAIL_SHAPE', '--owner-email is not a usable address (businessIdentity.ts:33-41)');
  }
  if (resolvedMode === 'apply') {
    if (ownerClerkUserId === null) {
      throw new UsageError(
        'OWNER_CLERK_USER_ID_REQUIRED',
        '--owner-clerk-user-id is required for --apply: it is the Clerk user id the owner signs in with on the Preview Clerk instance, and the first business-identity signal (businessIdentity.ts:70-73)',
      );
    }
    if (ownerEmail === null) {
      throw new UsageError(
        'OWNER_EMAIL_REQUIRED',
        '--owner-email is required for --apply: it feeds salon.owner_email, the §7.3 email_hmac identity signal (starterGrantBackfill.ts:218) and the Stripe customer_email fallback (checkout/route.ts:287-289)',
      );
    }
  }

  return { mode: resolvedMode, expectHost, slug, name, planTier, ownerClerkUserId, ownerEmail };
}

// ---------------------------------------------------------------------------
// Connection target
// ---------------------------------------------------------------------------

export type ConnectionTarget = { connectionString: string; host: string };

/**
 * Reads `PREVIEW_REHEARSAL_DATABASE_URL` and proves its hostname equals the
 * typed `--expect-host`. `DATABASE_URL` is never consulted. The returned
 * `connectionString` is handed straight to `pg` and must never be printed.
 */
export function resolveConnectionTarget(
  env: Record<string, string | undefined>,
  expectHost: string,
): ConnectionTarget {
  const raw = env[CONNECTION_ENV_VAR];
  if (raw === undefined || raw.trim().length === 0) {
    throw new RefusalError(
      'CONNECTION_ENV_MISSING',
      `${CONNECTION_ENV_VAR} is not set. This script never reads DATABASE_URL — export the Preview URL under the dedicated name instead.`,
    );
  }
  if (/\s/.test(raw)) {
    throw new RefusalError('CONNECTION_MALFORMED', `${CONNECTION_ENV_VAR} contains whitespace`);
  }
  if (raw.includes('#')) {
    throw new RefusalError('FRAGMENT_FORBIDDEN', `${CONNECTION_ENV_VAR} must not contain a URL fragment`);
  }

  let parsed: URL;
  try {
    decodeURI(raw);
    parsed = new URL(raw);
  } catch {
    throw new RefusalError('CONNECTION_MALFORMED', `${CONNECTION_ENV_VAR} is not a parseable URL`);
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new RefusalError('PROTOCOL_WRONG', `${CONNECTION_ENV_VAR} must use postgres:// or postgresql://`);
  }
  if (!parsed.hostname) {
    throw new RefusalError('CONNECTION_MALFORMED', `${CONNECTION_ENV_VAR} has no hostname`);
  }
  for (const key of parsed.searchParams.keys()) {
    if (ROUTING_OVERRIDE_QUERY_KEYS.has(key.toLowerCase())) {
      throw new RefusalError(
        'ROUTING_OVERRIDE_FORBIDDEN',
        `${CONNECTION_ENV_VAR} carries the routing-override query key "${key}", which can send the driver somewhere other than the attested hostname`,
      );
    }
  }

  const host = normalizeHost(parsed.hostname);
  if (host !== expectHost) {
    throw new RefusalError(
      'HOST_MISMATCH',
      `${CONNECTION_ENV_VAR} points at "${host}" but --expect-host says "${expectHost}"`,
    );
  }

  return { connectionString: raw, host };
}

// ---------------------------------------------------------------------------
// Minimal database surface (so tests can mock it with no network)
// ---------------------------------------------------------------------------

export type SeedQueryResult = { rows: Array<Record<string, unknown>> };

export type SeedDbClient = {
  query: (text: string, values?: unknown[]) => Promise<SeedQueryResult>;
};

/** Gate 4. Exactly one row, exactly `'preview'`. */
export function assertPreviewMarker(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    throw new RefusalError('MARKER_ROW_MISSING', 'public.luster_environment has no row — this is not an attested database');
  }
  if (rows.length > 1) {
    throw new RefusalError('MARKER_ROW_MULTIPLE', 'public.luster_environment has more than one row');
  }
  const environment = rows[0]?.environment;
  if (environment !== 'preview') {
    throw new RefusalError(
      'MARKER_ENVIRONMENT_MISMATCH',
      `public.luster_environment says "${String(environment)}", not "preview"`,
    );
  }
}

export async function readAndAssertPreviewMarker(client: SeedDbClient): Promise<void> {
  let result: SeedQueryResult;
  try {
    result = await client.query(MARKER_QUERY);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === '42P01') {
      throw new RefusalError('MARKER_TABLE_MISSING', 'public.luster_environment does not exist');
    }
    throw new RefusalError('MARKER_QUERY_FAILED', 'could not read public.luster_environment');
  }
  assertPreviewMarker(result.rows);
}

/**
 * Gate 6. Makes the session itself read-only, then PROVES it.
 *
 * `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` changes the session
 * default for `transaction_read_only`; PostgreSQL then raises
 * `25006 read_only_sql_transaction` on any INSERT/UPDATE/DELETE/COPY-in/DDL
 * issued in that session. The write half of the guarantee therefore stops
 * depending on which statements this file happens to contain — a future edit
 * that adds a write to `inspectPreconditions` or `runVerify` fails loudly
 * instead of silently making `--plan` write.
 *
 * `SHOW transaction_read_only` is read back rather than assumed, because a
 * pooler could in principle swallow the SET, and a silently-ignored guard is
 * worse than none. It returns the string `on` / `off`, never a boolean.
 *
 * Deliberately NOT used by `--apply`: that is the one mode that writes.
 */
export const READ_ONLY_SESSION_STATEMENT = 'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY';
export const READ_ONLY_PROBE_QUERY = 'SHOW transaction_read_only';

export async function enforceReadOnlySession(client: SeedDbClient): Promise<void> {
  try {
    await client.query(READ_ONLY_SESSION_STATEMENT);
  } catch {
    throw new RefusalError(
      'READ_ONLY_SESSION_REFUSED',
      `the server refused "${READ_ONLY_SESSION_STATEMENT}"; this mode will not run against a session it cannot make read-only`,
    );
  }

  let probe: SeedQueryResult;
  try {
    probe = await client.query(READ_ONLY_PROBE_QUERY);
  } catch {
    throw new RefusalError(
      'READ_ONLY_SESSION_UNVERIFIABLE',
      `"${READ_ONLY_PROBE_QUERY}" could not be read back, so the read-only session cannot be proven`,
    );
  }

  const value = probe.rows[0]?.transaction_read_only;
  if (value !== 'on') {
    throw new RefusalError(
      'READ_ONLY_SESSION_NOT_ESTABLISHED',
      `transaction_read_only is "${String(value)}", not "on", after ${READ_ONLY_SESSION_STATEMENT}`,
    );
  }
}

/**
 * Gate 6b. A redactor built from the ONE connection string this script reads.
 *
 * pg surfaces the credential in its error text on the most likely failure
 * path: 28P01 is `password authentication failed for user "<role>"`. Gate 2
 * promises the user is never printed, so every error output path runs through
 * this. Fragments are replaced longest-first so a host that contains the user
 * name (or vice versa) cannot leave a tail behind, and each is labelled rather
 * than blanked so the message stays diagnosable.
 *
 * Built defensively: an unset or unparseable variable yields an
 * identity-ish redactor rather than throwing, because this runs inside the
 * top-level error handler, where throwing would lose the original error.
 */
export function buildConnectionRedactor(raw: string | undefined): (text: string) => string {
  const fragments: Array<{ value: string; label: string }> = [];
  const add = (value: string | undefined, label: string): void => {
    if (value !== undefined && value.length >= 3) {
      fragments.push({ value, label });
    }
  };

  if (raw !== undefined && raw.length > 0) {
    add(raw, '[redacted:connection-string]');
    try {
      const parsed = new URL(raw);
      add(parsed.password, '[redacted:password]');
      add(decodeURIComponent(parsed.password), '[redacted:password]');
      add(parsed.username, '[redacted:user]');
      add(decodeURIComponent(parsed.username), '[redacted:user]');
      add(parsed.host, '[redacted:host]');
      add(parsed.hostname, '[redacted:host]');
    } catch {
      // An unparseable value still gets its literal form redacted above.
    }
  }

  fragments.sort((a, b) => b.value.length - a.value.length);

  return (text: string): string => fragments.reduce(
    (accumulator, fragment) => accumulator.split(fragment.value).join(fragment.label),
    text,
  );
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export type DeterministicIds = { salonId: string; adminId: string };

export function deterministicIds(slug: string): DeterministicIds {
  return {
    salonId: `${REHEARSAL_ID_PREFIX}salon-${slug}`,
    adminId: `${REHEARSAL_ID_PREFIX}admin-${slug}`,
  };
}

export type TopupAudience = 'free_plan' | 'paid_plan';

/**
 * LOCAL MIRROR of `resolveTopupAudienceForLegacyPlan`
 * (`src/libs/billing/legacyPlanAdapter.ts:112-114`) composed with
 * `normalizeLegacyPlan` (`:59-64`). Note the direction of the fallback:
 * `normalizeLegacyPlan` maps NULL **and any string outside `SALON_PLANS`** to
 * `'free'`, so those all land in the `free_plan` audience — only a recognized
 * NON-free tier buys at paid-plan prices. A test cross-checks this function
 * against the live resolver for every tier, for NULL and for an unrecognized
 * string. Reported by `--plan` and `--verify` so the operator can see which
 * top-up offers the seeded row admits.
 */
export function resolveTopupAudience(plan: string | null): TopupAudience {
  const normalized = plan !== null && (SALON_PLAN_TIERS as readonly string[]).includes(plan)
    ? plan
    : 'free';
  return normalized === 'free' ? 'free_plan' : 'paid_plan';
}

export type SalonInsertRow = {
  id: string;
  name: string;
  slug: string;
  plan: SalonPlanTier;
  billing_mode: 'NONE';
  status: 'active';
  publication_status: 'published';
  is_active: true;
  free_solo_enabled: false;
  owner_email: string | null;
  owner_clerk_user_id: string | null;
  internal_notes: string;
};

export type AdminUserInsertRow = {
  id: string;
  name: string;
  email: string | null;
  clerk_user_id: string | null;
  is_super_admin: false;
};

export type MembershipInsertRow = {
  admin_id: string;
  salon_id: string;
  role: 'owner';
};

export type SeedPlan = {
  ids: DeterministicIds;
  salon: SalonInsertRow;
  adminUser: AdminUserInsertRow;
  membership: MembershipInsertRow;
  topupAudience: TopupAudience;
};

/**
 * Every column set here is either NOT NULL without a default on `salon`
 * (`id`, `name`, `slug` — `src/models/Schema.ts:154-159`) or a column a billing
 * surface actually reads:
 *   - `plan`            → top-up audience (`topup/route.ts:115-118`)
 *   - `owner_clerk_user_id`, `owner_email`, `stripe_customer_id`
 *                       → §7.3 identity signals, in that preference order
 *                         (`starterGrantBackfill.ts:118-143`, `:215-220`).
 *                         `stripe_customer_id` is left NULL: the rehearsal must
 *                         mint it through Stripe, never have it fabricated.
 *   - `deleted_at`      → left NULL, else the starter grant 409s
 *                         (`starterGrantBackfill.ts:94-96`)
 *   - `billing_mode`, `status`, `publication_status`, `is_active`,
 *     `free_solo_enabled` → written explicitly rather than left to the DB
 *     defaults (`Schema.ts:209,212,221,227,229,273`) so the seeded row is
 *     self-describing in the evidence query.
 *   - `internal_notes`  → the authorship marker (gate 5).
 */
export function buildSeedPlan(args: SeedArguments): SeedPlan {
  const ids = deterministicIds(args.slug);
  return {
    ids,
    salon: {
      id: ids.salonId,
      name: args.name,
      slug: args.slug,
      plan: args.planTier,
      billing_mode: 'NONE',
      status: 'active',
      publication_status: 'published',
      is_active: true,
      free_solo_enabled: false,
      owner_email: args.ownerEmail,
      owner_clerk_user_id: args.ownerClerkUserId,
      internal_notes: REHEARSAL_MARKER,
    },
    adminUser: {
      id: ids.adminId,
      name: `${args.name} owner`,
      email: args.ownerEmail,
      clerk_user_id: args.ownerClerkUserId,
      is_super_admin: false,
    },
    membership: {
      admin_id: ids.adminId,
      salon_id: ids.salonId,
      role: 'owner',
    },
    topupAudience: resolveTopupAudience(args.planTier),
  };
}

// ---------------------------------------------------------------------------
// Preconditions (gate 5)
// ---------------------------------------------------------------------------

export type ExistingSalonRow = {
  id: unknown;
  slug: unknown;
  internal_notes: unknown;
  deleted_at: unknown;
};

export type ExistingAdminRow = {
  id: unknown;
  email: unknown;
  clerk_user_id: unknown;
  is_super_admin: unknown;
};

/**
 * `'absent'` → nothing at this slug. `'owned'` → this script's own row, so a
 * re-run is a no-op. Anything else refuses: a salon this script did not author
 * is never mutated, and never reused as the rehearsal target.
 */
export function classifyExistingSalon(
  row: ExistingSalonRow | undefined,
  expectedId: string,
  slug: string,
): 'absent' | 'owned' {
  if (row === undefined) {
    return 'absent';
  }
  const id = String(row.id);
  if (!id.startsWith(REHEARSAL_ID_PREFIX) || id !== expectedId) {
    throw new RefusalError(
      'SALON_SLUG_TAKEN_BY_FOREIGN_ROW',
      `slug "${slug}" already belongs to salon id "${id}", which this script did not create (expected "${expectedId}"). Choose another --slug.`,
    );
  }
  if (row.internal_notes !== REHEARSAL_MARKER) {
    throw new RefusalError(
      'SALON_MARKER_MISSING',
      `salon "${id}" does not carry internal_notes = "${REHEARSAL_MARKER}", so this script cannot claim authorship of it`,
    );
  }
  if (row.deleted_at !== null && row.deleted_at !== undefined) {
    throw new RefusalError(
      'SALON_SOFT_DELETED',
      `salon "${id}" is soft-deleted; the starter grant would 409 SALON_DELETED (starterGrantBackfill.ts:94-96). Restore or re-slug it deliberately.`,
    );
  }
  return 'owned';
}

/**
 * The `admin_user` identity columns are all uniquely indexed — `id` (PK),
 * `email`, `lower(email)` and `clerk_user_id` (`src/models/Schema.ts:2072-2079`).
 * A blind insert would therefore fail loudly on a collision, so the collision is
 * classified up front instead: only this script's own row with the SAME inputs
 * is treated as already-seeded.
 */
export function classifyExistingAdmin(
  rows: ExistingAdminRow[],
  expected: AdminUserInsertRow,
): 'absent' | 'owned' {
  if (rows.length === 0) {
    return 'absent';
  }
  const foreign = rows.filter(row => String(row.id) !== expected.id);
  if (foreign.length > 0) {
    throw new RefusalError(
      'ADMIN_IDENTITY_COLLISION',
      `admin_user id(s) ${foreign.map(row => `"${String(row.id)}"`).join(', ')} already claim this email or Clerk user id. This script never re-points a foreign admin row.`,
    );
  }
  const mine = rows[0] as ExistingAdminRow;
  const email = mine.email === null || mine.email === undefined ? null : String(mine.email);
  const clerkUserId = mine.clerk_user_id === null || mine.clerk_user_id === undefined ? null : String(mine.clerk_user_id);
  const expectedEmail = expected.email === null ? null : expected.email.toLowerCase();
  if ((email === null ? null : email.toLowerCase()) !== expectedEmail) {
    throw new RefusalError(
      'ADMIN_ROW_DIVERGED',
      `admin_user "${expected.id}" already exists with a different email. Re-run with the original --owner-email, or pick a new --slug.`,
    );
  }
  if (clerkUserId !== expected.clerk_user_id) {
    throw new RefusalError(
      'ADMIN_ROW_DIVERGED',
      `admin_user "${expected.id}" already exists bound to Clerk user id "${String(clerkUserId)}". Re-run with that id, or pick a new --slug.`,
    );
  }
  if (mine.is_super_admin === true) {
    throw new RefusalError(
      'ADMIN_ROW_DIVERGED',
      `admin_user "${expected.id}" is flagged is_super_admin; this script only ever creates a non-super-admin salon owner`,
    );
  }
  return 'owned';
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const SELECT_SALON_BY_SLUG
  = 'SELECT id, slug, internal_notes, deleted_at FROM public.salon WHERE slug = $1 LIMIT 1';

const SELECT_ADMIN_COLLISIONS = `
  SELECT id, email, clerk_user_id, is_super_admin
  FROM public.admin_user
  WHERE id = $1
     OR ($2::text IS NOT NULL AND lower(email) = lower($2))
     OR ($3::text IS NOT NULL AND clerk_user_id = $3)`;

const INSERT_SALON = `
  INSERT INTO public.salon (
    id, name, slug, plan, billing_mode, status, publication_status,
    is_active, free_solo_enabled, owner_email, owner_clerk_user_id, internal_notes
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (id) DO NOTHING
  RETURNING id`;

const INSERT_ADMIN_USER = `
  INSERT INTO public.admin_user (id, name, email, clerk_user_id, is_super_admin, email_verified_at)
  VALUES ($1, $2, $3, $4, false, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END)
  ON CONFLICT (id) DO NOTHING
  RETURNING id`;

const INSERT_MEMBERSHIP = `
  INSERT INTO public.admin_salon_membership (admin_id, salon_id, role)
  VALUES ($1, $2, $3)
  ON CONFLICT (admin_id, salon_id) DO NOTHING
  RETURNING admin_id`;

/**
 * Transaction-scoped advisory lock on the slug, so two concurrent `--apply`
 * runs cannot both observe "absent" and race into a unique-index violation.
 * Same shape as the identity resolver's lock at
 * `src/libs/billing/businessIdentity.ts:118-121`.
 */
const LOCK_SLUG = 'SELECT pg_advisory_xact_lock(hashtextextended($1, 42))';

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

export type PlanOutcome = {
  salon: 'absent' | 'owned';
  admin: 'absent' | 'owned';
  membershipPresent: boolean;
};

/** Read-only precondition sweep shared by `--plan` and `--apply`. */
export async function inspectPreconditions(
  client: SeedDbClient,
  plan: SeedPlan,
): Promise<PlanOutcome> {
  const salonResult = await client.query(SELECT_SALON_BY_SLUG, [plan.salon.slug]);
  const salon = classifyExistingSalon(
    salonResult.rows[0] as ExistingSalonRow | undefined,
    plan.ids.salonId,
    plan.salon.slug,
  );

  const adminResult = await client.query(SELECT_ADMIN_COLLISIONS, [
    plan.ids.adminId,
    plan.adminUser.email,
    plan.adminUser.clerk_user_id,
  ]);
  const admin = classifyExistingAdmin(adminResult.rows as ExistingAdminRow[], plan.adminUser);

  const membershipResult = await client.query(
    'SELECT role FROM public.admin_salon_membership WHERE admin_id = $1 AND salon_id = $2 LIMIT 1',
    [plan.ids.adminId, plan.ids.salonId],
  );

  return { salon, admin, membershipPresent: membershipResult.rows.length > 0 };
}

export type ApplyOutcome = {
  salonInserted: boolean;
  adminInserted: boolean;
  membershipInserted: boolean;
  ids: DeterministicIds;
};

/**
 * Gate 7: ONE transaction — marker re-check, slug lock, preconditions, inserts.
 * Any throw rolls everything back.
 */
export async function applySeed(client: SeedDbClient, plan: SeedPlan): Promise<ApplyOutcome> {
  await client.query('BEGIN');
  try {
    await readAndAssertPreviewMarker(client);
    await client.query(LOCK_SLUG, [`rehearsal-seed:${plan.salon.slug}`]);
    await inspectPreconditions(client, plan);

    const salonResult = await client.query(INSERT_SALON, [
      plan.salon.id,
      plan.salon.name,
      plan.salon.slug,
      plan.salon.plan,
      plan.salon.billing_mode,
      plan.salon.status,
      plan.salon.publication_status,
      plan.salon.is_active,
      plan.salon.free_solo_enabled,
      plan.salon.owner_email,
      plan.salon.owner_clerk_user_id,
      plan.salon.internal_notes,
    ]);
    const adminResult = await client.query(INSERT_ADMIN_USER, [
      plan.adminUser.id,
      plan.adminUser.name,
      plan.adminUser.email,
      plan.adminUser.clerk_user_id,
    ]);
    const membershipResult = await client.query(INSERT_MEMBERSHIP, [
      plan.membership.admin_id,
      plan.membership.salon_id,
      plan.membership.role,
    ]);

    await client.query('COMMIT');
    return {
      salonInserted: salonResult.rows.length > 0,
      adminInserted: adminResult.rows.length > 0,
      membershipInserted: membershipResult.rows.length > 0,
      ids: plan.ids,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export type VerifyReport = {
  salon: {
    id: string;
    slug: string;
    plan: string | null;
    billingMode: string | null;
    status: string | null;
    publicationStatus: string | null;
    isActive: boolean | null;
    deletedAt: boolean;
    ownerEmailSet: boolean;
    ownerClerkUserId: string | null;
    stripeCustomerId: string | null;
    authoredByThisScript: boolean;
  };
  admins: Array<{ adminId: string; role: string; isSuperAdmin: boolean; clerkUserId: string | null }>;
  identityLinks: Array<{ linkId: string; linkType: string; businessIdentityId: string; hmacKeyVersion: number | null }>;
  billingCounts: Record<string, number>;
};

const SELECT_SALON_FOR_VERIFY = `
  SELECT id, slug, plan, billing_mode, status, publication_status, is_active,
         deleted_at, owner_email, owner_clerk_user_id, stripe_customer_id, internal_notes
  FROM public.salon
  WHERE slug = $1
  LIMIT 1`;

const SELECT_ADMIN_LINKS = `
  SELECT m.admin_id, m.role, u.is_super_admin, u.clerk_user_id
  FROM public.admin_salon_membership AS m
  INNER JOIN public.admin_user AS u ON u.id = m.admin_id
  WHERE m.salon_id = $1
  ORDER BY m.admin_id`;

/**
 * §7.3 link types this script can look up without a secret: `salon` (always
 * present once an identity exists) and `clerk_user` / `stripe_customer` when
 * the salon carries those signals. `email_hmac` is deliberately NOT queried —
 * its `link_value` is an HMAC that requires `BILLING_IDENTITY_HMAC_SECRET`
 * (`businessIdentity.ts:47-56`), which this script must never read.
 */
const SELECT_IDENTITY_LINKS = `
  SELECT id, link_type, business_identity_id, hmac_key_version
  FROM public.billing_business_identity_link
  WHERE (link_type = 'salon' AND link_value = $1)
     OR ($2::text IS NOT NULL AND link_type = 'clerk_user' AND link_value = $2)
     OR ($3::text IS NOT NULL AND link_type = 'stripe_customer' AND link_value = $3)
  ORDER BY link_type`;

const SELECT_BILLING_COUNTS = `
  SELECT
    (SELECT count(*) FROM public.billing_starter_grant    WHERE salon_id = $1) AS billing_starter_grant,
    (SELECT count(*) FROM public.billing_subscription     WHERE salon_id = $1) AS billing_subscription,
    (SELECT count(*) FROM public.billing_checkout_attempt WHERE salon_id = $1) AS billing_checkout_attempt,
    (SELECT count(*) FROM public.billing_promotion_claim  WHERE salon_id = $1) AS billing_promotion_claim,
    (SELECT count(*) FROM public.sms_credit_account       WHERE salon_id = $1) AS sms_credit_account,
    (SELECT count(*) FROM public.sms_credit_ledger        WHERE salon_id = $1) AS sms_credit_ledger,
    (SELECT count(*) FROM public.sms_topup_purchase       WHERE salon_id = $1) AS sms_topup_purchase`;

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Read-only evidence query for the rehearsal document. Writes nothing. */
export async function runVerify(client: SeedDbClient, slug: string): Promise<VerifyReport> {
  const salonResult = await client.query(SELECT_SALON_FOR_VERIFY, [slug]);
  const row = salonResult.rows[0];
  if (row === undefined) {
    throw new VerificationError('SALON_NOT_FOUND', `no salon with slug "${slug}" on this database`);
  }

  const salonId = String(row.id);
  const ownerClerkUserId = asNullableString(row.owner_clerk_user_id);
  const stripeCustomerId = asNullableString(row.stripe_customer_id);

  const adminResult = await client.query(SELECT_ADMIN_LINKS, [salonId]);
  const linkResult = await client.query(SELECT_IDENTITY_LINKS, [salonId, ownerClerkUserId, stripeCustomerId]);
  const countResult = await client.query(SELECT_BILLING_COUNTS, [salonId]);

  const billingCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(countResult.rows[0] ?? {})) {
    billingCounts[key] = Number(value);
  }

  return {
    salon: {
      id: salonId,
      slug: String(row.slug),
      plan: asNullableString(row.plan),
      billingMode: asNullableString(row.billing_mode),
      status: asNullableString(row.status),
      publicationStatus: asNullableString(row.publication_status),
      isActive: row.is_active === null || row.is_active === undefined ? null : Boolean(row.is_active),
      deletedAt: row.deleted_at !== null && row.deleted_at !== undefined,
      ownerEmailSet: row.owner_email !== null && row.owner_email !== undefined && String(row.owner_email).length > 0,
      ownerClerkUserId,
      stripeCustomerId,
      authoredByThisScript: row.internal_notes === REHEARSAL_MARKER && salonId.startsWith(REHEARSAL_ID_PREFIX),
    },
    admins: adminResult.rows.map(admin => ({
      adminId: String(admin.admin_id),
      role: String(admin.role),
      isSuperAdmin: Boolean(admin.is_super_admin),
      clerkUserId: asNullableString(admin.clerk_user_id),
    })),
    identityLinks: linkResult.rows.map(link => ({
      linkId: String(link.id),
      linkType: String(link.link_type),
      businessIdentityId: String(link.business_identity_id),
      hmacKeyVersion: link.hmac_key_version === null || link.hmac_key_version === undefined
        ? null
        : Number(link.hmac_key_version),
    })),
    billingCounts,
  };
}

// ---------------------------------------------------------------------------
// Drift check against Schema.ts
// ---------------------------------------------------------------------------

/**
 * Proves the local `SALON_PLAN_TIERS` copy still matches
 * `src/models/Schema.ts:2762` by reading that file's text — importing it would
 * pull the whole Drizzle model graph into a tsx script.
 */
export async function assertPlanTiersMatchSchema(readFile: (path: string) => Promise<string>, schemaPath: string): Promise<void> {
  const source = await readFile(schemaPath);
  const match = /export const SALON_PLANS = \[([^\]]*)\] as const;/.exec(source);
  if (match === null) {
    throw new VerificationError('SCHEMA_PLAN_ENUM_NOT_FOUND', 'could not locate SALON_PLANS in Schema.ts');
  }
  const schemaTiers = (match[1] as string)
    .split(',')
    .map(part => part.trim().replace(/^'|'$/g, ''))
    .filter(part => part.length > 0);
  const local = [...SALON_PLAN_TIERS];
  if (schemaTiers.join('|') !== local.join('|')) {
    throw new VerificationError(
      'SCHEMA_PLAN_ENUM_DRIFT',
      `Schema.ts SALON_PLANS is [${schemaTiers.join(', ')}] but this script's copy is [${local.join(', ')}]`,
    );
  }
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/**
 * `--plan` prints the exact values it would write, including `owner_email` —
 * the operator typed it on this very command line, so echoing it back discloses
 * nothing new. `--verify` reads from the database instead and reports
 * `owner_email_set` rather than the address.
 */
export function formatPlan(plan: SeedPlan, outcome: PlanOutcome): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push('PLAN — rows that --apply would insert (nothing is written in this mode)');
  lines.push('');
  lines.push(`salon (${outcome.salon === 'absent' ? 'would INSERT' : 'already present — no-op'})`);
  for (const [key, value] of Object.entries(plan.salon)) {
    lines.push(`  ${key.padEnd(22)} ${value === null ? 'NULL' : String(value)}`);
  }
  lines.push('  deleted_at             NULL');
  lines.push('  stripe_customer_id     NULL (the rehearsal must mint this through Stripe)');
  lines.push('');
  lines.push(`admin_user (${outcome.admin === 'absent' ? 'would INSERT' : 'already present — no-op'})`);
  for (const [key, value] of Object.entries(plan.adminUser)) {
    lines.push(`  ${key.padEnd(22)} ${value === null ? 'NULL' : String(value)}`);
  }
  lines.push('  phone_e164             NULL (nullable for Clerk-first owners, Schema.ts:2054-2058)');
  lines.push('');
  lines.push(`admin_salon_membership (${outcome.membershipPresent ? 'already present — no-op' : 'would INSERT'})`);
  for (const [key, value] of Object.entries(plan.membership)) {
    lines.push(`  ${key.padEnd(22)} ${String(value)}`);
  }
  lines.push('');
  lines.push(`derived top-up audience: ${plan.topupAudience} (legacyPlanAdapter.ts:112-114)`);
  lines.push('not created: sms_credit_account (lazy — creditLedger.ts:50-63), and no billing_* row of any kind');
  return lines;
}

export function formatVerify(report: VerifyReport): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push('VERIFY — read-only evidence');
  lines.push('');
  lines.push('salon');
  lines.push(`  id                     ${report.salon.id}`);
  lines.push(`  slug                   ${report.salon.slug}`);
  lines.push(`  plan                   ${report.salon.plan ?? 'NULL'}`);
  lines.push(`  topup_audience         ${resolveTopupAudience(report.salon.plan)}`);
  lines.push(`  billing_mode           ${report.salon.billingMode ?? 'NULL'}`);
  lines.push(`  status                 ${report.salon.status ?? 'NULL'}`);
  lines.push(`  publication_status     ${report.salon.publicationStatus ?? 'NULL'}`);
  lines.push(`  is_active              ${report.salon.isActive === null ? 'NULL' : String(report.salon.isActive)}`);
  lines.push(`  soft_deleted           ${String(report.salon.deletedAt)}`);
  lines.push(`  owner_email_set        ${String(report.salon.ownerEmailSet)}`);
  lines.push(`  owner_clerk_user_id    ${report.salon.ownerClerkUserId ?? 'NULL'}`);
  lines.push(`  stripe_customer_id     ${report.salon.stripeCustomerId ?? 'NULL'}`);
  lines.push(`  authored_by_this_script ${String(report.salon.authoredByThisScript)}`);
  lines.push('');
  lines.push(`admin_salon_membership (${report.admins.length})`);
  if (report.admins.length === 0) {
    lines.push('  (none — only a super admin could reach this salon, adminAuth.ts:438-441)');
  }
  for (const admin of report.admins) {
    lines.push(`  admin_id=${admin.adminId} role=${admin.role} is_super_admin=${String(admin.isSuperAdmin)} clerk_user_id=${admin.clerkUserId ?? 'NULL'}`);
  }
  lines.push('');
  lines.push(`billing_business_identity_link (${report.identityLinks.length})`);
  if (report.identityLinks.length === 0) {
    lines.push('  (none — no identity has been resolved for this salon yet)');
  }
  for (const link of report.identityLinks) {
    lines.push(`  link_id=${link.linkId} type=${link.linkType} business_identity_id=${link.businessIdentityId} hmac_key_version=${link.hmacKeyVersion ?? 'NULL'}`);
  }
  lines.push('  note: email_hmac links are not queried — their link_value needs BILLING_IDENTITY_HMAC_SECRET');
  lines.push('');
  lines.push('billing row counts for this salon');
  for (const [table, count] of Object.entries(report.billingCounts)) {
    lines.push(`  ${table.padEnd(26)} ${count}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  // Before parseArguments, which requires --expect-host in every mode: asking
  // for help must never be an argument error.
  if (argv.includes('--help') || argv.includes('-h')) {
    emit(USAGE);
    return;
  }

  const args = parseArguments(argv);
  const target = resolveConnectionTarget(process.env, args.expectHost);

  const { readFile } = await import('node:fs/promises');
  const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'models', 'Schema.ts');
  await assertPlanTiersMatchSchema(async file => readFile(file, 'utf8'), schemaPath);

  emit(`mode: ${args.mode}`);
  emit(`host: ${target.host}`); // hostname only — the credential half is never printed
  emit(`slug: ${args.slug}`);

  const client = new Client({ connectionString: target.connectionString });
  await client.connect();
  try {
    // Gate 6: BEFORE any query, and only for the two non-writing modes.
    if (args.mode !== 'apply') {
      await enforceReadOnlySession(client);
      emit('session: READ ONLY (SET SESSION CHARACTERISTICS …, verified by SHOW transaction_read_only)');
    }

    await readAndAssertPreviewMarker(client);
    emit('marker: preview (single row)');

    if (args.mode === 'verify') {
      const report = await runVerify(client, args.slug);
      for (const line of formatVerify(report)) {
        emit(line);
      }
      return;
    }

    const plan = buildSeedPlan(args);
    if (args.mode === 'plan') {
      const outcome = await inspectPreconditions(client, plan);
      for (const line of formatPlan(plan, outcome)) {
        emit(line);
      }
      emit('');
      emit('Nothing was written. Re-run with --apply to insert.');
      return;
    }

    const outcome = await applySeed(client, plan);
    emit('');
    emit('APPLIED (one transaction)');
    emit(`  salon.id                ${outcome.ids.salonId} ${outcome.salonInserted ? '(inserted)' : '(already present)'}`);
    emit(`  admin_user.id           ${outcome.ids.adminId} ${outcome.adminInserted ? '(inserted)' : '(already present)'}`);
    emit(`  membership              ${outcome.ids.adminId} -> ${outcome.ids.salonId} role=owner ${outcome.membershipInserted ? '(inserted)' : '(already present)'}`);
    emit('');
    emit('Re-run with --verify for the read-only evidence query.');
  } finally {
    await client.end();
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error: unknown) => {
    // Gate 6b: EVERY error output path is redacted. A pg 28P01 message carries
    // the role name verbatim, and a connection-string parse failure could echo
    // the whole URL.
    const redact = buildConnectionRedactor(process.env[CONNECTION_ENV_VAR]);
    if (error instanceof SeedError) {
      emitError(redact(`ERROR ${error.message}`));
      process.exit(error.exitCode);
    }
    const message = error instanceof Error ? error.message : 'unknown error';
    emitError(redact(`ERROR (unhandled — most likely the database) ${message}`));
    process.exit(EXIT.database);
  });
}
