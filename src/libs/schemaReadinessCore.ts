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
 * The five states a comparison between the repository's expected migration
 * tail and the database's applied migration ledger can land in.
 *
 * - `match`: applied count equals expected count. The only state where the
 *   database is caught up with what the running code expects.
 * - `behind`: the database has applied fewer migrations than the release
 *   expects. This is the exact class of the 0068-vs-0072 incident.
 * - `ahead`: the database has applied MORE migrations than the release
 *   expects. This means the database has objects/state the running code does
 *   not know about — never safe to call "ready".
 * - `malformed_ledger`: either the expected journal or the applied-count
 *   query result could not be parsed into a well-formed count. Distinct from
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
  | 'malformed_ledger'
  | 'query_failed';

export type SchemaTailReadiness = {
  state: SchemaTailState;
  ready: boolean;
  expectedTail: string | null;
  expectedCount: number;
  appliedCount: number | null;
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
} {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { expectedCount: 0, expectedTail: null };
  }
  const last = entries[entries.length - 1];
  const expectedTail = typeof last?.tag === 'string' && last.tag.length > 0
    ? last.tag
    : null;
  return { expectedCount: entries.length, expectedTail };
}

function parseAppliedCount(result: unknown): number | null {
  const row = readRows(result)[0];
  const raw = row?.applied_count;
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
 * Compares the repository's expected migration tail (from the journal) with
 * how many migrations the database has actually applied (from Drizzle's own
 * `drizzle.__drizzle_migrations` ledger).
 *
 * READ-ONLY. Issues exactly one bounded `select count(*)` — no mutation SQL,
 * no tenant or customer data, ever. NEVER throws: every failure mode resolves
 * to a typed, non-ready state.
 *
 * `applied` is deliberately a COUNT, not a tag comparison — the ledger stores
 * hashes, not human-readable tags, so tag names cannot be compared directly
 * against it. Comparing counts is the robust, deterministic signal: it
 * detects "database is behind", "database is ahead of what this release
 * expects", and everything in between.
 */
export async function getSchemaTailReadiness(
  handle: SchemaReadinessSqlHandle,
  options?: { expectedEntries?: readonly JournalEntry[] },
): Promise<SchemaTailReadiness> {
  const { expectedCount, expectedTail } = resolveExpectedTail(
    options?.expectedEntries ?? DEFAULT_JOURNAL_ENTRIES,
  );

  if (expectedCount === 0 || expectedTail === null) {
    // The repository's own expected tail could not be determined. Never
    // report ready when we don't even know what "ready" means.
    return {
      state: 'malformed_ledger',
      ready: false,
      expectedTail,
      expectedCount,
      appliedCount: null,
    };
  }

  let result: unknown;
  try {
    result = await handle.execute(sql`
      select count(*)::int as applied_count
      from drizzle.__drizzle_migrations
    `);
  } catch {
    return {
      state: 'query_failed',
      ready: false,
      expectedTail,
      expectedCount,
      appliedCount: null,
    };
  }

  const appliedCount = parseAppliedCount(result);
  if (appliedCount === null) {
    return {
      state: 'malformed_ledger',
      ready: false,
      expectedTail,
      expectedCount,
      appliedCount: null,
    };
  }

  if (appliedCount === expectedCount) {
    return {
      state: 'match',
      ready: true,
      expectedTail,
      expectedCount,
      appliedCount,
    };
  }

  if (appliedCount < expectedCount) {
    return {
      state: 'behind',
      ready: false,
      expectedTail,
      expectedCount,
      appliedCount,
    };
  }

  return {
    state: 'ahead',
    ready: false,
    expectedTail,
    expectedCount,
    appliedCount,
  };
}
