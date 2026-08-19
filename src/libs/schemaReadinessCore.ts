import { type SQL, sql } from 'drizzle-orm';

// Bundled at build time as a JSON module import, NOT read from disk at
// request time. A production server route may run in an environment without
// arbitrary filesystem access, so the expected migration tail must be
// resolvable purely by the bundler (webpack/turbopack both inline JSON
// imports as a module; `resolveJsonModule` is already enabled in
// tsconfig.json). This file lives at `migrations/meta/_journal.json`, one
// level above `src/`.
import journalData from '../../migrations/meta/_journal.json';

export type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
};

/**
 * The six states a comparison between the repository's expected migration
 * tail and the database's applied migration ledger can land in.
 *
 * - `match`: applied count equals expected count, AND the applied tail's
 *   timestamp equals the expected tail's timestamp. The only ready state.
 * - `behind`: the database has applied fewer migrations than the release
 *   expects. This is the exact class of the 0068-vs-0072 incident.
 * - `ahead`: the database has applied MORE migrations than the release
 *   expects. This means the database has objects/state the running code does
 *   not know about — never safe to call "ready".
 * - `tail_mismatch`: applied count equals expected count, but the applied
 *   tail's timestamp does NOT equal the expected tail's timestamp. A
 *   count-only comparison cannot see this: two different migration histories
 *   can happen to be the same length. This repository specifically runs
 *   provisional, renumbered migrations across parallel branches against one
 *   shared (dev+prod) Neon database, so "same count, different content" is a
 *   live scenario here, not a theoretical one — this state exists to close
 *   exactly that gap.
 * - `malformed_ledger`: either the expected journal or the applied-ledger
 *   query result could not be parsed into well-formed data. Distinct from
 *   `query_failed` — the query executed without throwing but returned
 *   nonsensical data (or the bundled journal itself is empty/corrupt).
 * - `query_failed`: the read-only probe could not be executed at all
 *   (connection failure, missing table/schema, permissions). Distinct from
 *   an empty ledger, which is a `behind` state with `appliedCount: 0`.
 */
export type SchemaTailState =
  | 'match'
  | 'behind'
  | 'ahead'
  | 'tail_mismatch'
  | 'malformed_ledger'
  | 'query_failed';

export type SchemaTailReadiness = {
  state: SchemaTailState;
  ready: boolean;
  expectedTail: string | null;
  expectedCount: number;
  expectedTailMillis: number | null;
  appliedCount: number | null;
  appliedTailMillis: number | null;
};

export type SchemaReadinessSqlHandle = {
  execute: (query: SQL) => Promise<unknown>;
};

function readRows(result: unknown): Record<string, unknown>[] {
  const resultWithRows = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(resultWithRows?.rows)) {
    return resultWithRows.rows;
  }
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

/**
 * The repository's own expected migration tail, straight from the journal
 * Drizzle maintains. `entries[-1].tag` is the newest migration the running
 * code was built against; `entries.length` is the count the applied ledger
 * must match.
 */
export const DEFAULT_JOURNAL_ENTRIES: readonly JournalEntry[]
  = (journalData as { entries: JournalEntry[] }).entries;

function resolveExpectedTail(entries: readonly JournalEntry[]): {
  expectedCount: number;
  expectedTail: string | null;
  expectedTailMillis: number | null;
} {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { expectedCount: 0, expectedTail: null, expectedTailMillis: null };
  }
  const last = entries[entries.length - 1];
  const expectedTail = typeof last?.tag === 'string' && last.tag.length > 0
    ? last.tag
    : null;
  // Drizzle's migrator writes this exact value into `created_at` for the
  // corresponding ledger row (node_modules/drizzle-orm/migrator.cjs:
  // `folderMillis: journalEntry.when`), which is what makes it comparable
  // against the applied tail's `created_at` below.
  const expectedTailMillis = typeof last?.when === 'number' && Number.isFinite(last.when)
    ? last.when
    : null;
  return { expectedCount: entries.length, expectedTail, expectedTailMillis };
}

/**
 * Parses a value that MUST be present (never SQL NULL) into a non-negative
 * integer, tolerating the string form Postgres bigint/numeric columns are
 * often returned as. `null` signals "could not parse" — the caller decides
 * what that means for the state being computed.
 */
function parseNonNegativeInteger(raw: unknown): number | null {
  const numeric = typeof raw === 'string' ? Number(raw) : raw;
  if (
    typeof numeric !== 'number'
    || !Number.isFinite(numeric)
    || !Number.isInteger(numeric)
    || numeric < 0
  ) {
    return null;
  }
  return numeric;
}

/**
 * Parses a value that MAY legitimately be SQL NULL (e.g. `max(created_at)`
 * over an empty ledger) into a non-negative integer or `null`. Distinguishes
 * "legitimately absent" from "present but unparseable" via `ok`.
 */
function parseNullableNonNegativeInteger(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  const value = parseNonNegativeInteger(raw);
  if (value === null) {
    return { ok: false };
  }
  return { ok: true, value };
}

/**
 * Best-effort parse for a diagnostic-only field on a branch (`behind`/
 * `ahead`) where the value is not decisive. A missing or unparseable value
 * here is reported as `null`, never treated as an error — the branch's
 * correctness does not depend on it.
 */
function parseAppliedTailMillisLenient(raw: unknown): number | null {
  const parsed = parseNullableNonNegativeInteger(raw);
  return parsed.ok ? parsed.value : null;
}

/**
 * Compares the repository's expected migration tail (from the journal) with
 * what the database has actually applied (from Drizzle's own
 * `drizzle.__drizzle_migrations` ledger) — both by COUNT and, when the counts
 * agree, by the applied tail's timestamp.
 *
 * READ-ONLY. Issues exactly one bounded `select count(*), max(created_at)` —
 * no mutation SQL, no tenant or customer data, ever. NEVER throws: every
 * failure mode resolves to a typed, non-ready state.
 *
 * `applied` is deliberately a COUNT plus a timestamp, not a tag comparison —
 * the ledger stores hashes, not human-readable tags, so tag names cannot be
 * compared directly against it. Counts alone detect "database is behind" and
 * "database is ahead of what this release expects", but counts alone CANNOT
 * detect two different migration histories that happen to be the same
 * length — which is exactly what happens when two branches each apply their
 * own same-numbered migration against a shared database. The timestamp check
 * closes that gap: Drizzle writes each journal entry's own `when` value into
 * `created_at` for its ledger row, so the applied tail's `created_at` is
 * compared against the expected tail's `when` whenever the counts match.
 */
export async function getSchemaTailReadiness(
  handle: SchemaReadinessSqlHandle,
  options?: { expectedEntries?: readonly JournalEntry[] },
): Promise<SchemaTailReadiness> {
  const { expectedCount, expectedTail, expectedTailMillis } = resolveExpectedTail(
    options?.expectedEntries ?? DEFAULT_JOURNAL_ENTRIES,
  );

  if (expectedCount === 0 || expectedTail === null || expectedTailMillis === null) {
    // The repository's own expected tail could not be determined. Never
    // report ready when we don't even know what "ready" means.
    return {
      state: 'malformed_ledger',
      ready: false,
      expectedTail,
      expectedCount,
      expectedTailMillis,
      appliedCount: null,
      appliedTailMillis: null,
    };
  }

  let result: unknown;
  try {
    result = await handle.execute(sql`
      select
        count(*)::int as applied_count,
        max(created_at)::bigint as applied_tail_millis
      from drizzle.__drizzle_migrations
    `);
  } catch {
    return {
      state: 'query_failed',
      ready: false,
      expectedTail,
      expectedCount,
      expectedTailMillis,
      appliedCount: null,
      appliedTailMillis: null,
    };
  }

  const row = readRows(result)[0];
  const appliedCount = parseNonNegativeInteger(row?.applied_count);
  if (appliedCount === null) {
    return {
      state: 'malformed_ledger',
      ready: false,
      expectedTail,
      expectedCount,
      expectedTailMillis,
      appliedCount: null,
      appliedTailMillis: null,
    };
  }

  if (appliedCount < expectedCount) {
    return {
      state: 'behind',
      ready: false,
      expectedTail,
      expectedCount,
      expectedTailMillis,
      appliedCount,
      appliedTailMillis: parseAppliedTailMillisLenient(row?.applied_tail_millis),
    };
  }

  if (appliedCount > expectedCount) {
    return {
      state: 'ahead',
      ready: false,
      expectedTail,
      expectedCount,
      expectedTailMillis,
      appliedCount,
      appliedTailMillis: parseAppliedTailMillisLenient(row?.applied_tail_millis),
    };
  }

  // appliedCount === expectedCount, and expectedCount > 0 (guarded above), so
  // the ledger has rows and `max(created_at)` must be a real, non-null value.
  // A missing/unparseable value here — unlike in the behind/ahead branches
  // above, where the timestamp is only diagnostic — IS decisive: without it
  // we cannot rule out the false-match scenario this check exists to catch.
  const parsedTailMillis = parseNullableNonNegativeInteger(row?.applied_tail_millis);
  if (!parsedTailMillis.ok || parsedTailMillis.value === null) {
    return {
      state: 'malformed_ledger',
      ready: false,
      expectedTail,
      expectedCount,
      expectedTailMillis,
      appliedCount,
      appliedTailMillis: null,
    };
  }
  const appliedTailMillis = parsedTailMillis.value;

  if (appliedTailMillis !== expectedTailMillis) {
    return {
      state: 'tail_mismatch',
      ready: false,
      expectedTail,
      expectedCount,
      expectedTailMillis,
      appliedCount,
      appliedTailMillis,
    };
  }

  return {
    state: 'match',
    ready: true,
    expectedTail,
    expectedCount,
    expectedTailMillis,
    appliedCount,
    appliedTailMillis,
  };
}
