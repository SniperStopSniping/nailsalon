import { describe, expect, it } from 'vitest';

import {
  getValueImportSpecifiers,
  hasUseClientDirective,
  isTestOrStoryFile,
  readSourceFiles,
  resolveModuleSpecifier,
  walkTsFiles,
} from '@/libs/architectureGuardSupport';

/**
 * H3 — the client/server import boundary (architecture hardening pass).
 *
 * This repo has already shipped a real client-bundle leak once: a
 * `'use client'` module transitively imported `bookingPageConfig.ts`, which
 * imports `@/libs/DB` (`import 'server-only'`). `SalonProvider.tsx` now
 * guards against a recurrence by hand — it `import type`-only's
 * `BookingPageConfigSide` and keeps a hand-written client-safe default
 * literal (see that file's own doc comment). This suite makes the SAME rule
 * a deterministic, repo-wide check instead of a convention a future PR could
 * silently break: no `'use client'` module may runtime-import — directly or
 * TRANSITIVELY, through any number of intermediate non-`'use client'`
 * modules — a server-only module.
 *
 * "Server-only module" is this repo's own convention, not an invented one:
 *   - filename ends `.server.ts`/`.server.tsx`, OR
 *   - the file itself contains `import 'server-only';`
 * `@/libs/DB.ts` self-declares `import 'server-only'`, so it is a seed by
 * the second rule; the transitive walk is what catches an intermediate like
 * `bookingPageConfig.ts`, which is neither `.server.ts` nor self-declaring,
 * yet becomes unsafe for a client component to VALUE-import the moment it
 * imports something that is.
 *
 * `import type` is, and must remain, exempt — `getValueImportSpecifiers`
 * (architectureGuardSupport.ts) uses the real TypeScript compiler to erase
 * it exactly the way `tsc` does, including per-specifier `import { type A,
 * B } from '...'`, not a regex approximation.
 */

type BoundaryViolation = {
  clientFile: string;
  /** clientFile -> ... -> the server-only module it transitively value-imports. */
  chain: string[];
};

function isServerOnlySeed(repoRelativePath: string, sourceText: string): boolean {
  if (/\.server\.tsx?$/.test(repoRelativePath)) {
    return true;
  }
  return getValueImportSpecifiers(sourceText, repoRelativePath).includes('server-only');
}

function findClientServerBoundaryViolations(files: Map<string, string>): BoundaryViolation[] {
  const productionFiles = [...files.entries()].filter(([file]) => !isTestOrStoryFile(file));
  const exists = (candidate: string) => files.has(candidate);

  const seeds = new Set(
    productionFiles
      .filter(([file, text]) => isServerOnlySeed(file, text))
      .map(([file]) => file),
  );

  const graph = new Map<string, string[]>(
    productionFiles.map(([file, text]) => [
      file,
      getValueImportSpecifiers(text, file)
        .map(specifier => resolveModuleSpecifier(file, specifier, exists))
        .filter((resolved): resolved is string => resolved !== null),
    ]),
  );

  const violations: BoundaryViolation[] = [];
  for (const [file, text] of productionFiles) {
    if (!hasUseClientDirective(text, file)) {
      continue;
    }

    // Breadth-first so the reported chain is the SHORTEST path — the most
    // legible one when a failure needs to be read and fixed.
    const cameFrom = new Map<string, string>([[file, file]]);
    const queue = [file];
    let hitSeed: string | null = null;

    while (queue.length > 0 && !hitSeed) {
      const current = queue.shift()!;
      for (const next of graph.get(current) ?? []) {
        if (cameFrom.has(next)) {
          continue;
        }
        cameFrom.set(next, current);
        if (seeds.has(next)) {
          hitSeed = next;
          break;
        }
        queue.push(next);
      }
    }

    if (hitSeed) {
      const chain: string[] = [hitSeed];
      let cursor = hitSeed;
      while (cursor !== file) {
        const previous = cameFrom.get(cursor)!;
        chain.unshift(previous);
        cursor = previous;
      }
      violations.push({ clientFile: file, chain });
    }
  }

  return violations;
}

// =============================================================================
// Import classification — the compiler-accurate value/type distinction the
// whole guard rests on. These are deliberately synthetic and file-system-free.
// =============================================================================

describe('import classification (getValueImportSpecifiers)', () => {
  it('excludes a whole-clause `import type`', () => {
    const source = `import type { Foo } from '@/libs/DB';\n`;

    expect(getValueImportSpecifiers(source, 'fixture.ts')).toEqual([]);
  });

  it('excludes every specifier in a named import when ALL are inline `type`', () => {
    const source = `import { type Foo, type Bar } from '@/libs/DB';\n`;

    expect(getValueImportSpecifiers(source, 'fixture.ts')).toEqual([]);
  });

  it('still counts the import when only SOME named specifiers are inline `type`', () => {
    const source = `import { type Foo, db } from '@/libs/DB';\n`;

    expect(getValueImportSpecifiers(source, 'fixture.ts')).toEqual(['@/libs/DB']);
  });

  it('counts a bare side-effect import (`import "server-only";`)', () => {
    const source = `import 'server-only';\n`;

    expect(getValueImportSpecifiers(source, 'fixture.ts')).toEqual(['server-only']);
  });

  it('counts a default import and a namespace import', () => {
    expect(getValueImportSpecifiers(`import db from '@/libs/DB';\n`, 'fixture.ts')).toEqual(['@/libs/DB']);
    expect(getValueImportSpecifiers(`import * as DB from '@/libs/DB';\n`, 'fixture.ts')).toEqual(['@/libs/DB']);
  });
});

// =============================================================================
// Synthetic regression fixture — reproduces the exact SalonProvider-style
// failure in-memory, without touching any real file under src/.
// =============================================================================

describe('client/server boundary — synthetic SalonProvider-style regression fixture', () => {
  const fixtureFiles = new Map<string, string>([
    [
      'src/libs/fixtureDb.server.ts',
      `import 'server-only';\n\nexport const db = {} as unknown;\n`,
    ],
    [
      // Mirrors the real bookingPageConfig.ts: NOT `.server.ts`, does not
      // itself declare 'server-only' — only unsafe because of what it imports.
      'src/libs/fixtureBookingPageConfig.ts',
      `import { db } from '@/libs/fixtureDb.server';\n\n`
      + `export type BookingPageConfigSide = { layout: string };\n\n`
      + `export function createDefaultSide(): BookingPageConfigSide {\n  void db;\n  return { layout: 'quick_book' };\n}\n`,
    ],
    [
      // The real SalonProvider.tsx before its fix would look like this.
      'src/providers/FixtureClientBad.tsx',
      `'use client';\n\n`
      + `import { createDefaultSide } from '@/libs/fixtureBookingPageConfig';\n\n`
      + `export function FixtureClientBad() {\n  return createDefaultSide();\n}\n`,
    ],
    [
      // The real SalonProvider.tsx pattern: `import type` only.
      'src/providers/FixtureClientGood.tsx',
      `'use client';\n\n`
      + `import type { BookingPageConfigSide } from '@/libs/fixtureBookingPageConfig';\n\n`
      + `export const FIXTURE_DEFAULT: BookingPageConfigSide = { layout: 'quick_book' };\n`,
    ],
  ]);

  it('flags a client component that value-imports a server-only module through an intermediate', () => {
    const violations = findClientServerBoundaryViolations(fixtureFiles);
    const bad = violations.find(v => v.clientFile === 'src/providers/FixtureClientBad.tsx');

    expect(bad).toBeDefined();
    expect(bad!.chain).toEqual([
      'src/providers/FixtureClientBad.tsx',
      'src/libs/fixtureBookingPageConfig.ts',
      'src/libs/fixtureDb.server.ts',
    ]);
  });

  it('does NOT flag the same module when it is only `import type`-ed (the real SalonProvider pattern)', () => {
    const violations = findClientServerBoundaryViolations(fixtureFiles);

    expect(violations.find(v => v.clientFile === 'src/providers/FixtureClientGood.tsx')).toBeUndefined();
  });
});

// =============================================================================
// Repo-wide enforcement — the actual CI-enforced guard, over real src/ files.
// =============================================================================

describe('client/server boundary — repo-wide enforcement', () => {
  const allFiles = readSourceFiles(walkTsFiles());

  it('the scan is not vacuous: at least one server-only seed and one `use client` module exist', () => {
    const productionFiles = [...allFiles.entries()].filter(([file]) => !isTestOrStoryFile(file));
    const seedCount = productionFiles.filter(([file, text]) => isServerOnlySeed(file, text)).length;
    const clientCount = productionFiles.filter(([file, text]) => hasUseClientDirective(text, file)).length;

    expect(seedCount).toBeGreaterThan(0);
    expect(clientCount).toBeGreaterThan(0);
  });

  it('no `use client` module runtime-imports a server-only module, directly or transitively', () => {
    const violations = findClientServerBoundaryViolations(allFiles);

    if (violations.length > 0) {
      const report = violations
        .map(v => `  ${v.clientFile}\n    -> ${v.chain.slice(1).join('\n    -> ')}`)
        .join('\n');
      throw new Error(`client/server boundary violated by ${violations.length} module(s):\n${report}`);
    }

    expect(violations).toEqual([]);
  });

  it('regression anchor: SalonProvider.tsx itself is scanned and passes clean', () => {
    const salonProvider = 'src/providers/SalonProvider.tsx';

    expect(allFiles.has(salonProvider)).toBe(true);
    expect(hasUseClientDirective(allFiles.get(salonProvider)!, salonProvider)).toBe(true);

    const violations = findClientServerBoundaryViolations(allFiles);

    expect(violations.find(v => v.clientFile === salonProvider)).toBeUndefined();
  });
});
