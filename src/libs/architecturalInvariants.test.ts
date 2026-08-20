import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getValueImportSpecifiers,
  isTestOrStoryFile,
  resolveModuleSpecifier,
  walkTsFiles,
} from '@/libs/architectureGuardSupport';
import { buildPublicCatalogSnapshot } from '@/libs/catalogResolverCore';
import { CATALOG_FIXTURE_SCENARIOS } from '@/libs/catalogResolverFixtures';

/**
 * H6 — the architectural invariant suite (architecture hardening pass).
 *
 * A small, fast, EXPLICIT checklist numbered to match the charter. Where an
 * invariant is already the natural conclusion of a richer guard living
 * elsewhere, this file does not re-implement that guard — it cross-
 * references it and, where practical, adds one direct, cheap assertion of
 * its own so the checklist item is still independently verifiable here.
 *
 *   1. catalogResolverCore is DB-free.                    — self-contained below
 *   2. Public projector excludes forbidden fields.         — catalogPublicDtoBoundary.test.ts (H4)
 *   3. Browser-facing modules never expose capability IDs. — catalogPublicDtoBoundary.test.ts (H4)
 *   4. No client component runtime-imports DB/server-only. — architectureClientServerBoundary.test.ts (H3)
 *   5. PR3 core has zero production hot-path invocation.   — self-contained below
 *   6. Migration ledger/file identity remains valid.       — self-contained below
 *   7. Schema-readiness drift.                              — OUT OF SCOPE (another agent's guard)
 *   8. "No preset creates a second booking engine."        — documented future guard only, see bottom
 */

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Strips comments so a doc comment describing the invariant can never trip the check for it. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

// =============================================================================
// 1. catalogResolverCore is DB-free (no @/libs/DB, no drizzle, no server-only).
// =============================================================================

describe('invariant 1 — catalogResolverCore is DB-free', () => {
  const FORBIDDEN = /from\s+['"](?:@\/libs\/DB|drizzle-orm[^'"]*)['"]|^\s*import\s+['"]server-only['"]/m;

  it('the pattern matches a known-bad import (non-vacuous)', () => {
    expect(FORBIDDEN.test(`import { db } from '@/libs/DB';`)).toBe(true);
    expect(FORBIDDEN.test(`import 'server-only';`)).toBe(true);
    expect(FORBIDDEN.test(`import { eq } from 'drizzle-orm';`)).toBe(true);
  });

  it('catalogResolverCore.ts contains no such import', () => {
    const source = codeOnly(read('src/libs/catalogResolverCore.ts'));

    expect(FORBIDDEN.test(source)).toBe(false);
  });
});

// =============================================================================
// 2 & 3. Public projector field-safety and capability-id-freedom — verified
// in full, with mutation-test non-vacuousness proof, in
// catalogPublicDtoBoundary.test.ts. Re-asserted here directly (not
// duplicated) as a cheap smoke test tied to this checklist.
// =============================================================================

describe('invariant 2 & 3 — public projector excludes forbidden fields and capability ids (see catalogPublicDtoBoundary.test.ts for the full guard)', () => {
  it('a requires_capability scenario, run through the real builder, carries no capabilityId anywhere', () => {
    const scenario = CATALOG_FIXTURE_SCENARIOS.find(s => s.key === 'capability_driven_server_outcome');

    expect(scenario).toBeDefined();

    if (scenario!.kind === 'material-change') {
      throw new Error('capability_driven_server_outcome is expected to be a snapshot/selection scenario');
    }
    const result = buildPublicCatalogSnapshot(scenario!.buildSnapshotInput());

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('capabilityId');
  });
});

// =============================================================================
// 4. No client component runtime-imports DB/server-only — the full
// transitive graph guard lives in architectureClientServerBoundary.test.ts
// (H3). Not duplicated here.
// =============================================================================

describe('invariant 4 — client/server import boundary (see architectureClientServerBoundary.test.ts for the full guard)', () => {
  it('the guarding file exists and is part of this branch', () => {
    expect(() => read('src/libs/architectureClientServerBoundary.test.ts')).not.toThrow();
  });
});

// =============================================================================
// 5. PR3 core has zero UNAUTHORIZED production hot-path invocation.
//
// "The catalog module set" — every production file L1 PR3 added (per its
// own commits: 0ed829f, 18a2836, 6e7ea7e). PR4 DELIBERATELY changes this
// contract: `catalogSubmissionReconciliation.server.ts` (§13, L1 PR4) is now
// an authorized production importer of `catalogResolver.server.ts` — it is
// the seam that wires the PR3 resolver into `POST /api/appointments`
// (`route.ts`), gated by `resolveCatalogDomainView` (dark for every real
// salon today; see that module's own doc comment for the full story).
//
// This invariant does NOT become a no-op: it still fails for ANY importer
// or ANY module-set member not named in `AUTHORIZED_PRODUCTION_IMPORTS`
// below — the allowlist is a closed, explicit (importer -> imported) edge
// list, not a blanket exemption for a file or a directory. Widening it
// again requires touching this test, on purpose, exactly like this PR did.
//
// L1 PR6 (owner/admin catalog configuration surface) widens it again, for
// the FIRST write paths these tables have ever had:
//
//   * `ownerCatalogGroups.server.ts` reuses `addOnGroupBoundsSchema`
//     (`catalogRuleContract.ts`) to validate add-on group selection bounds
//     against the exact CHECKs migration 0073 enforces.
//   * `ownerCatalogRules.server.ts` reuses `catalogRuleWriteSchema`
//     (`catalogRuleContract.ts`) to map owner INTENT onto the six landed
//     rule types, and `detectAutoAddCycle` (`catalogRuleGraph.ts`) to
//     reject a bundling rule that would introduce an auto-add cycle.
//   * `ownerCatalogPreview.server.ts` calls `resolvePublicCatalogSnapshot` /
//     `resolveCatalogSelectionForSalon` (`catalogResolver.server.ts`) so an
//     authenticated owner preview resolves through the SAME engine booking
//     uses — never a second price/duration calculation.
//
// None of these three files write through anywhere but the server wrapper
// (`catalogResolver.server.ts`) or the pure contract/graph modules — never
// `catalogResolverCore.ts`/`catalogDomain.ts` directly.
// =============================================================================

describe('invariant 5 — the L1 PR3 catalog core has zero UNAUTHORIZED production hot-path invocation', () => {
  const CATALOG_MODULE_SET = [
    'catalogDomain',
    'catalogResolverCore',
    'catalogRuleGraph',
    'catalogRuleContract',
    'confirmationMode',
    'catalogFingerprint',
    'catalogFingerprint.server',
    'catalogResolver.server',
    'catalogResolverFixtures',
  ];
  const MODULE_SET_FILES = new Set(CATALOG_MODULE_SET.map(m => `src/libs/${m}.ts`));

  /**
   * Closed allowlist of (importer -> imported set member) edges. Every entry
   * must be a PRODUCTION file (never a test) deliberately wired to consume
   * the PR3 core through its intended boundary (`catalogResolver.server.ts`,
   * the server wrapper — never `catalogResolverCore.ts`/`catalogDomain.ts`
   * directly, which stay DB-free and browser-safe per ADR 0004).
   */
  const AUTHORIZED_PRODUCTION_IMPORTS: ReadonlyArray<{ importer: string; imports: string }> = [
    {
      importer: 'src/libs/catalogSubmissionReconciliation.server.ts',
      imports: 'src/libs/catalogResolver.server.ts',
    },
    // L1 PR6 — add-on group bounds validation reuses the same Zod contract
    // the database CHECKs mirror.
    {
      importer: 'src/libs/ownerCatalogGroups.server.ts',
      imports: 'src/libs/catalogRuleContract.ts',
    },
  ];
  const isAuthorized = (importer: string, imported: string) =>
    AUTHORIZED_PRODUCTION_IMPORTS.some(edge => edge.importer === importer && edge.imports === imported);

  // Every real `src/` file, for `resolveModuleSpecifier`'s existence check
  // AND so "does file X import module Y" is answered by RESOLUTION
  // (catching `from './catalogResolverCore'` exactly like `from '@/libs/
  // catalogResolverCore'`), not by a hand-rolled `@/libs/...`-only regex —
  // a sibling in `src/libs/` is exactly the file most likely to reach for
  // the relative spelling.
  const allSrcFiles = new Set(walkTsFiles());
  const fileExists = (candidate: string) => MODULE_SET_FILES.has(candidate) || allSrcFiles.has(candidate);

  it('the module set really does have at least one importer among itself + tests (non-vacuous)', () => {
    // catalogResolverCore.ts imports catalogDomain.ts — an internal edge —
    // and catalogResolverCore.test.ts imports catalogResolverCore.ts.
    const coreSource = read('src/libs/catalogResolverCore.ts');

    expect(coreSource).toContain('@/libs/catalogDomain');
  });

  it('the resolver actually resolves a relative import to the same target as its aliased form (non-vacuous)', () => {
    const resolveFromLibs = (specifier: string) => resolveModuleSpecifier('src/libs/fixture.ts', specifier, fileExists);

    expect(resolveFromLibs('@/libs/catalogResolverCore')).toBe('src/libs/catalogResolverCore.ts');
    expect(resolveFromLibs('./catalogResolverCore')).toBe('src/libs/catalogResolverCore.ts');
  });

  it('every authorized edge is a REAL file that REALLY imports its named target (the allowlist cannot list a stale/fictional edge)', () => {
    for (const edge of AUTHORIZED_PRODUCTION_IMPORTS) {
      expect(allSrcFiles.has(edge.importer), `${edge.importer} does not exist`).toBe(true);
      expect(MODULE_SET_FILES.has(edge.imports), `${edge.imports} is not a catalog module-set member`).toBe(true);

      const source = read(edge.importer);
      const resolvedTargets = getValueImportSpecifiers(source, edge.importer)
        .map(specifier => resolveModuleSpecifier(edge.importer, specifier, fileExists));

      expect(resolvedTargets, `${edge.importer} does not actually import ${edge.imports}`).toContain(edge.imports);
    }
  });

  it('a hypothetical UNAUTHORIZED importer of the same module-set member is still caught (non-vacuous)', () => {
    expect(isAuthorized('src/libs/someRandomFile.ts', 'src/libs/catalogResolver.server.ts')).toBe(false);
    expect(isAuthorized('src/libs/catalogSubmissionReconciliation.server.ts', 'src/libs/catalogResolverCore.ts')).toBe(false);
  });

  it('no production file outside the set imports any set member except through an authorized edge', () => {
    const offenders: string[] = [];
    for (const file of allSrcFiles) {
      if (isTestOrStoryFile(file) || MODULE_SET_FILES.has(file)) {
        continue;
      }
      const source = read(file);
      for (const specifier of getValueImportSpecifiers(source, file)) {
        const resolved = resolveModuleSpecifier(file, specifier, fileExists);
        if (resolved && MODULE_SET_FILES.has(resolved) && !isAuthorized(file, resolved)) {
          offenders.push(`${file} imports ${resolved} (as '${specifier}')`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

// =============================================================================
// 6. Migration ledger/file identity remains valid — every journal entry has
// a matching .sql file and vice versa, with no gaps or duplicate indices.
// Read-only: asserts against migrations/**, never writes to it.
// =============================================================================

describe('invariant 6 — migration ledger/file identity', () => {
  type JournalEntry = { idx: number; tag: string };
  const journal = JSON.parse(read('migrations/meta/_journal.json')) as { entries: JournalEntry[] };
  const sqlFiles = readdirSync(path.join(ROOT, 'migrations')).filter(f => f.endsWith('.sql'));

  it('the ledger is non-empty (non-vacuous)', () => {
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(sqlFiles.length).toBeGreaterThan(0);
  });

  it('every journal entry has a matching migrations/<tag>.sql file', () => {
    const missing = journal.entries
      .map(entry => `${entry.tag}.sql`)
      .filter(fileName => !sqlFiles.includes(fileName));

    expect(missing).toEqual([]);
  });

  it('every .sql file under migrations/ has a matching journal entry', () => {
    const tags = new Set(journal.entries.map(entry => entry.tag));
    const orphaned = sqlFiles.filter(fileName => !tags.has(fileName.replace(/\.sql$/, '')));

    expect(orphaned).toEqual([]);
  });

  it('journal indices are sequential from 0, in array order, with no duplicates or gaps', () => {
    const indices = journal.entries.map(entry => entry.idx);

    expect(indices).toEqual(journal.entries.map((_, i) => i));
  });

  it('the file/entry counts match exactly', () => {
    expect(sqlFiles.length).toBe(journal.entries.length);
  });
});

// =============================================================================
// 7. Schema-readiness drift — deliberately out of scope. Owned by another
// in-flight agent's uncommitted work (src/libs/schemaReadiness*.ts,
// src/app/api/health/*), which this branch does not modify. See that
// agent's own tests (schemaReadinessCore.test.ts) for that invariant.
// =============================================================================

// =============================================================================
// 8. "No preset creates a second booking engine" — documented future guard
// only. The catalog PRESET feature this would guard against does not exist
// yet anywhere in this codebase (no preset selection, no preset-specific
// resolution path) — there is nothing to scan for today, and inventing a
// check against code that isn't there would just be an assertion that
// always vacuously passes. `it.todo` keeps this on the visible test-report
// checklist rather than only in a comment, without pretending to enforce it.
//
// When a preset concept lands, this should assert: every preset resolves
// bookable state through the SAME `buildPublicCatalogSnapshot` /
// `resolveCatalogSelection` entry points `catalogResolverCore.ts` already
// exports — e.g. by scanning for a second `function resolveCatalogSelection`-
// shaped export, or a second consumer of `catalog_rule` rows that bypasses
// `catalogResolver.server.ts` — rather than a preset growing its own
// parallel resolution/pricing/availability engine.
// =============================================================================

describe('invariant 8 — no preset creates a second booking engine', () => {
  it.todo('once a catalog preset exists, assert every preset resolves through catalogResolverCore\'s single entry point (not implemented: no preset exists in this codebase yet)');
});
