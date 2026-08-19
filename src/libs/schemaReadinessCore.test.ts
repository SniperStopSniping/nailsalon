/**
 * Production schema-drift readiness (hardening the incident where code was
 * deployed expecting migrations through 0072 while the database was still
 * at 0068 — /api/health still reported `status: "ok"`).
 *
 * `getSchemaTailReadiness` compares the repository's expected migration tail
 * (migrations/meta/_journal.json) against how many migrations the database
 * has actually applied (drizzle.__drizzle_migrations). The ledger stores
 * hashes, not tags, so comparing COUNTS is the robust, deterministic signal.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import {
  DEFAULT_JOURNAL_ENTRIES,
  getSchemaTailReadiness,
  type JournalEntry,
  type SchemaReadinessSqlHandle,
} from './schemaReadinessCore';

let migrated: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  await client.waitReady;
  migrated = drizzle(client, { schema });
  await migrate(migrated, { migrationsFolder: path.join(process.cwd(), 'migrations') });
});

function syntheticEntry(tag: string): JournalEntry {
  return { idx: 0, version: '7', when: 0, tag, breakpoints: true };
}

describe('DEFAULT_JOURNAL_ENTRIES (expected-tail source)', () => {
  it('is bundled from the repository journal, not read from disk at request time', () => {
    // Cross-check the module-imported constant against an independent
    // filesystem read of the same file. If these two ever disagree, the
    // build-time JSON import has gone stale relative to the repository.
    const onDisk = JSON.parse(
      readFileSync(path.join(process.cwd(), 'migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: JournalEntry[] };

    expect(DEFAULT_JOURNAL_ENTRIES.length).toBe(onDisk.entries.length);
    expect(DEFAULT_JOURNAL_ENTRIES[DEFAULT_JOURNAL_ENTRIES.length - 1]?.tag)
      .toBe(onDisk.entries[onDisk.entries.length - 1]?.tag);
  });
});

describe('getSchemaTailReadiness — match', () => {
  it('is ready against a database migrated to exactly the expected tail', async () => {
    const readiness = await getSchemaTailReadiness(
      migrated as unknown as SchemaReadinessSqlHandle,
    );

    expect(readiness.state).toBe('match');
    expect(readiness.ready).toBe(true);
    expect(readiness.appliedCount).toBe(DEFAULT_JOURNAL_ENTRIES.length);
    expect(readiness.expectedCount).toBe(DEFAULT_JOURNAL_ENTRIES.length);
    expect(readiness.expectedTail).toBe(
      DEFAULT_JOURNAL_ENTRIES[DEFAULT_JOURNAL_ENTRIES.length - 1]?.tag,
    );
  });
});

describe('getSchemaTailReadiness — DB behind', () => {
  it('is not ready when the database is one migration behind what the release expects', async () => {
    const expectedEntries = [
      ...DEFAULT_JOURNAL_ENTRIES,
      syntheticEntry('9999_not_yet_applied'),
    ];

    const readiness = await getSchemaTailReadiness(
      migrated as unknown as SchemaReadinessSqlHandle,
      { expectedEntries },
    );

    expect(readiness.state).toBe('behind');
    expect(readiness.ready).toBe(false);
    expect(readiness.appliedCount).toBe(DEFAULT_JOURNAL_ENTRIES.length);
    expect(readiness.expectedCount).toBe(DEFAULT_JOURNAL_ENTRIES.length + 1);
  });

  it('is not ready when the database is several migrations behind', async () => {
    const expectedEntries = [
      ...DEFAULT_JOURNAL_ENTRIES,
      syntheticEntry('9996_pending_a'),
      syntheticEntry('9997_pending_b'),
      syntheticEntry('9998_pending_c'),
      syntheticEntry('9999_pending_d'),
    ];

    const readiness = await getSchemaTailReadiness(
      migrated as unknown as SchemaReadinessSqlHandle,
      { expectedEntries },
    );

    expect(readiness.state).toBe('behind');
    expect(readiness.ready).toBe(false);
    expect(readiness.expectedCount - (readiness.appliedCount ?? 0)).toBe(4);
  });

  it('treats a genuinely empty ledger as "behind", explicitly distinct from "unavailable"', async () => {
    // An empty-but-present ledger (table exists, zero rows applied) is a
    // legitimate, explicit "behind" reading — not the same failure mode as a
    // database the probe cannot query at all.
    const handle: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockResolvedValue([{ applied_count: 0 }]),
    };

    const readiness = await getSchemaTailReadiness(handle);

    expect(readiness.state).toBe('behind');
    expect(readiness.ready).toBe(false);
    expect(readiness.appliedCount).toBe(0);
  });

  it('REGRESSION: reproduces the actual 0068-vs-0072 incident (68 applied, 72 expected)', async () => {
    // The incident: code deployed expecting migrations through 0072 while
    // the database was still at 0068 — 68 applied rows vs. a 72-entry
    // expected journal. /api/health reported "ok" anyway. This proves the
    // counting comparison catches exactly that shape of drift.
    const expectedEntries = DEFAULT_JOURNAL_ENTRIES.slice(0, 72);
    const handle: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockResolvedValue([{ applied_count: 68 }]),
    };

    const readiness = await getSchemaTailReadiness(handle, { expectedEntries });

    expect(readiness.state).toBe('behind');
    expect(readiness.ready).toBe(false);
    expect(readiness.expectedCount).toBe(72);
    expect(readiness.appliedCount).toBe(68);
    expect(readiness.expectedCount - (readiness.appliedCount ?? 0)).toBe(4);
  });
});

describe('getSchemaTailReadiness — DB ahead', () => {
  it('is NOT reported ready when the database has applied more migrations than this release expects', async () => {
    // "Ahead" means the database has objects/state this release's code does
    // not know about. That is never safe to call ready.
    const expectedEntries = DEFAULT_JOURNAL_ENTRIES.slice(
      0,
      DEFAULT_JOURNAL_ENTRIES.length - 4,
    );

    const readiness = await getSchemaTailReadiness(
      migrated as unknown as SchemaReadinessSqlHandle,
      { expectedEntries },
    );

    expect(readiness.state).toBe('ahead');
    expect(readiness.ready).toBe(false);
    expect(readiness.appliedCount).toBe(DEFAULT_JOURNAL_ENTRIES.length);
    expect(readiness.expectedCount).toBe(DEFAULT_JOURNAL_ENTRIES.length - 4);
  });
});

describe('getSchemaTailReadiness — malformed ledger', () => {
  it('is not ready when the query succeeds but returns a non-numeric count', async () => {
    const handle: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockResolvedValue([{ applied_count: 'not-a-number' }]),
    };

    const readiness = await getSchemaTailReadiness(handle);

    expect(readiness.state).toBe('malformed_ledger');
    expect(readiness.ready).toBe(false);
    expect(readiness.appliedCount).toBeNull();
  });

  it('is not ready when the query succeeds but the expected column is absent', async () => {
    const handle: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockResolvedValue([{ unexpected: 'shape' }]),
    };

    const readiness = await getSchemaTailReadiness(handle);

    expect(readiness.state).toBe('malformed_ledger');
    expect(readiness.ready).toBe(false);
  });

  it('is not ready when the reported count is negative', async () => {
    const handle: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockResolvedValue([{ applied_count: -1 }]),
    };

    const readiness = await getSchemaTailReadiness(handle);

    expect(readiness.state).toBe('malformed_ledger');
    expect(readiness.ready).toBe(false);
  });

  it('is not ready when the expected journal itself is empty, and never queries the database', async () => {
    const execute = vi.fn().mockResolvedValue([{ applied_count: 74 }]);
    const handle: SchemaReadinessSqlHandle = { execute };

    const readiness = await getSchemaTailReadiness(handle, { expectedEntries: [] });

    expect(readiness.state).toBe('malformed_ledger');
    expect(readiness.ready).toBe(false);
    expect(readiness.expectedTail).toBeNull();
    // Never report ready when we don't even know what "ready" means — and
    // never issue the (pointless) query to find out.
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('getSchemaTailReadiness — query failure', () => {
  it('NEVER throws — a failing handle resolves to a typed not-ready state, not an exception', async () => {
    const handle: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockRejectedValue(
        new Error('relation "drizzle.__drizzle_migrations" does not exist'),
      ),
    };

    await expect(getSchemaTailReadiness(handle)).resolves.toMatchObject({
      state: 'query_failed',
      ready: false,
      appliedCount: null,
    });
  });

  it('is distinct from an empty ledger: query failure vs. zero applied rows are different states', async () => {
    const failing: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockRejectedValue(new Error('connection terminated')),
    };
    const empty: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockResolvedValue([{ applied_count: 0 }]),
    };

    const failingReadiness = await getSchemaTailReadiness(failing);
    const emptyReadiness = await getSchemaTailReadiness(empty);

    expect(failingReadiness.state).toBe('query_failed');
    expect(emptyReadiness.state).toBe('behind');
    expect(failingReadiness.state).not.toBe(emptyReadiness.state);
  });
});

describe('getSchemaTailReadiness — no mutation, ever', () => {
  it('issues exactly one bounded, read-only SELECT and nothing else', async () => {
    const executedQueries: string[] = [];
    const handle: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockImplementation(async (query) => {
        // Drizzle's SQL builder exposes the literal template text via
        // `queryChunks`; concatenate it to inspect exactly what would be
        // sent to Postgres.
        const text = (query as { queryChunks: { value?: unknown }[] }).queryChunks
          .map(chunk => (Array.isArray(chunk?.value) ? chunk.value.join('') : ''))
          .join('');
        executedQueries.push(text);
        return [{ applied_count: DEFAULT_JOURNAL_ENTRIES.length }];
      }),
    };

    await getSchemaTailReadiness(handle);

    expect(handle.execute).toHaveBeenCalledTimes(1);
    expect(executedQueries).toHaveLength(1);

    const [issuedQuery] = executedQueries;
    const normalized = issuedQuery!.toLowerCase();

    // It is a SELECT...
    expect(normalized.trim().startsWith('select')).toBe(true);
    // ...against only the migration ledger, never a tenant/customer table...
    expect(normalized).toContain('drizzle.__drizzle_migrations');
    expect(normalized).not.toMatch(/\bsalon\b/);
    expect(normalized).not.toMatch(/\bappointment\b/);
    expect(normalized).not.toMatch(/\bclient\b/);
    // ...and it contains no mutation verb whatsoever.
    expect(normalized).not.toMatch(
      /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create)\b/,
    );
  });
});
