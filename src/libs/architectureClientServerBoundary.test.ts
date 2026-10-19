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

type BoundaryAnalysis = {
  seeds: Set<string>;
  clients: string[];
  violations: BoundaryViolation[];
};

function isServerOnlySeed(repoRelativePath: string, sourceText: string): boolean {
  if (/\.server\.tsx?$/.test(repoRelativePath)) {
    return true;
  }
  return getValueImportSpecifiers(sourceText, repoRelativePath).includes('server-only');
}

const analysisCache = new WeakMap<Map<string, string>, BoundaryAnalysis>();
const comparePaths = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function analyzeClientServerBoundary(files: Map<string, string>): BoundaryAnalysis {
  const cached = analysisCache.get(files);
  if (cached) {
    return cached;
  }

  // Sort once so tie-breaking is stable across filesystem enumeration order.
  // The source inventory remains complete; only its traversal order changes.
  const productionFiles = [...files.entries()]
    .filter(([file]) => !isTestOrStoryFile(file))
    .sort(([left], [right]) => comparePaths(left, right));
  const exists = (candidate: string) => files.has(candidate);

  const seeds = new Set<string>();
  const clients: string[] = [];
  const graph = new Map<string, string[]>();
  const reverseGraph = new Map<string, string[]>();

  // Each production file is inspected once for its value imports. Reuse those
  // specifiers both to identify `server-only` seeds and to build the graph.
  for (const [file, text] of productionFiles) {
    const specifiers = getValueImportSpecifiers(text, file);
    if (/\.server\.tsx?$/.test(file) || specifiers.includes('server-only')) {
      seeds.add(file);
    }
    if (hasUseClientDirective(text, file)) {
      clients.push(file);
    }

    const edges: string[] = [];
    for (const specifier of specifiers) {
      const target = resolveModuleSpecifier(file, specifier, exists);
      if (!target) {
        continue;
      }
      edges.push(target);
      const importers = reverseGraph.get(target) ?? [];
      importers.push(file);
      reverseGraph.set(target, importers);
    }
    graph.set(file, edges);
  }

  // Reverse multi-source BFS computes the nearest reachable seed for every
  // importer in one graph walk. `nextTowardSeed` preserves the forward chain
  // from each client to its seed; sorted seeds/importers give stable ties.
  const nextTowardSeed = new Map<string, string>();
  const queue = [...seeds].sort(comparePaths);
  for (const importers of reverseGraph.values()) {
    importers.sort(comparePaths);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const target = queue[head]!;
    for (const importer of reverseGraph.get(target) ?? []) {
      if (seeds.has(importer) || nextTowardSeed.has(importer)) {
        continue;
      }
      nextTowardSeed.set(importer, target);
      queue.push(importer);
    }
  }

  const violations: BoundaryViolation[] = [];
  for (const clientFile of clients) {
    if (seeds.has(clientFile)) {
      // Preserve the original rule for an unusual module that is both a
      // client entry and a seed: only a seed reached over an import edge is
      // reported. Such modules are rare, so keep this exceptional forward
      // search out of the normal reverse-BFS path.
      const cameFrom = new Map<string, string>([[clientFile, clientFile]]);
      const seedQueue = [clientFile];
      let hitSeed: string | null = null;
      for (let head = 0; head < seedQueue.length && !hitSeed; head += 1) {
        const current = seedQueue[head]!;
        for (const next of graph.get(current) ?? []) {
          if (cameFrom.has(next)) {
            continue;
          }
          cameFrom.set(next, current);
          if (seeds.has(next)) {
            hitSeed = next;
            break;
          }
          seedQueue.push(next);
        }
      }
      if (hitSeed) {
        const chain = [hitSeed];
        let cursor = hitSeed;
        while (cursor !== clientFile) {
          cursor = cameFrom.get(cursor)!;
          chain.unshift(cursor);
        }
        violations.push({ clientFile, chain });
      }
      continue;
    }
    const firstHop = nextTowardSeed.get(clientFile);
    if (!firstHop) {
      continue;
    }
    const chain = [clientFile];
    let cursor = firstHop;
    chain.push(cursor);
    while (!seeds.has(cursor)) {
      const next = nextTowardSeed.get(cursor);
      if (!next) {
        throw new Error(`client/server boundary predecessor map is inconsistent at ${cursor}`);
      }
      cursor = next;
      chain.push(cursor);
    }
    if (chain.length > 0) {
      violations.push({ clientFile, chain });
    }
  }

  const analysis = { seeds, clients, violations };
  analysisCache.set(files, analysis);
  return analysis;
}

function findClientServerBoundaryViolations(files: Map<string, string>): BoundaryViolation[] {
  return analyzeClientServerBoundary(files).violations;
}

/** Simple forward-BFS oracle retained for the small synthetic graph fixtures. */
function findClientServerBoundaryViolationsReference(files: Map<string, string>): BoundaryViolation[] {
  const productionFiles = [...files.entries()].filter(([file]) => !isTestOrStoryFile(file));
  const exists = (candidate: string) => files.has(candidate);
  const seeds = new Set(
    productionFiles.filter(([file, text]) => isServerOnlySeed(file, text)).map(([file]) => file),
  );
  const graph = new Map<string, string[]>(productionFiles.map(([file, text]) => [
    file,
    getValueImportSpecifiers(text, file)
      .map(specifier => resolveModuleSpecifier(file, specifier, exists))
      .filter((resolved): resolved is string => resolved !== null),
  ]));
  const violations: BoundaryViolation[] = [];

  for (const [file, text] of productionFiles) {
    if (!hasUseClientDirective(text, file)) {
      continue;
    }
    const cameFrom = new Map<string, string>([[file, file]]);
    const queue = [file];
    let hitSeed: string | null = null;
    for (let head = 0; head < queue.length && !hitSeed; head += 1) {
      const current = queue[head]!;
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
      const chain = [hitSeed];
      let cursor = hitSeed;
      while (cursor !== file) {
        cursor = cameFrom.get(cursor)!;
        chain.unshift(cursor);
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

  it('counts a dynamic `import()` with a static string literal, anywhere in the tree', () => {
    // Not a top-level ImportDeclaration — nested inside a function body, the
    // exact shape a top-level-statements-only scan would miss.
    const source = `export async function loadDb() {\n  const { db } = await import('@/libs/DB');\n  return db;\n}\n`;

    expect(getValueImportSpecifiers(source, 'fixture.ts')).toEqual(['@/libs/DB']);
  });

  it('counts a CommonJS `require()` with a static string literal', () => {
    const source = `const { db } = require('@/libs/DB');\n`;

    expect(getValueImportSpecifiers(source, 'fixture.ts')).toEqual(['@/libs/DB']);
  });

  it('skips a dynamic `import()`/`require()` whose argument is not a static string (cannot be resolved without running the program)', () => {
    expect(getValueImportSpecifiers(`const mod = await import(someVariable);\n`, 'fixture.ts')).toEqual([]);
    // The fixture source text itself deliberately contains a template
    // literal WITH a substitution (`./${name}`) — not a mistaken plain
    // string, so the interpolation-typo lint rule is disabled for this line.
    // eslint-disable-next-line no-template-curly-in-string
    expect(getValueImportSpecifiers('const mod = require(`./${name}`);\n', 'fixture.ts')).toEqual([]);
  });

  it('does NOT treat a type-position `import(...)` as a value edge (it is a different AST node, not a CallExpression)', () => {
    const source = `type Foo = import('@/libs/DB').SomeType;\n`;

    expect(getValueImportSpecifiers(source, 'fixture.ts')).toEqual([]);
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
// Synthetic regression fixture — the SAME leak shape, but via a dynamic
// `import()` instead of a top-level `import` statement. `await import(...)`
// is a real leak shape a top-level-statements-only scan cannot see; a
// non-literal argument is deliberately unresolvable and must NOT be flagged.
// =============================================================================

describe('client/server boundary — dynamic import() regression fixture', () => {
  const fixtureFiles = new Map<string, string>([
    [
      'src/libs/fixtureDb.server.ts',
      `import 'server-only';\n\nexport const db = {} as unknown;\n`,
    ],
    [
      'src/providers/FixtureClientDynamicImportBad.tsx',
      `'use client';\n\n`
      + `export async function loadIt() {\n  const { db } = await import('@/libs/fixtureDb.server');\n  return db;\n}\n`,
    ],
    [
      // A non-literal argument can't be resolved statically — must not be
      // treated as reaching the seed just because SOME dynamic import exists.
      'src/providers/FixtureClientDynamicImportUnresolvable.tsx',
      `'use client';\n\n`
      + `export async function loadIt(moduleName: string) {\n  return import(moduleName);\n}\n`,
    ],
  ]);

  it('flags a client component that reaches a server-only module through a dynamic import()', () => {
    const violations = findClientServerBoundaryViolations(fixtureFiles);
    const bad = violations.find(v => v.clientFile === 'src/providers/FixtureClientDynamicImportBad.tsx');

    expect(bad).toBeDefined();
    expect(bad!.chain).toEqual([
      'src/providers/FixtureClientDynamicImportBad.tsx',
      'src/libs/fixtureDb.server.ts',
    ]);
  });

  it('does NOT flag a dynamic import() whose argument cannot be resolved statically', () => {
    const violations = findClientServerBoundaryViolations(fixtureFiles);

    expect(violations.find(v => v.clientFile === 'src/providers/FixtureClientDynamicImportUnresolvable.tsx')).toBeUndefined();
  });
});

describe('client/server boundary — shortest path across cycles and diamonds', () => {
  const fixtureFiles = new Map<string, string>([
    [
      'src/server/fixtureDb.server.ts',
      `import 'server-only';\nexport const db = {};\n`,
    ],
    [
      'src/libs/fixtureDiamondLeft.ts',
      `import '@/libs/fixtureCycleA';\nexport const left = true;\n`,
    ],
    [
      'src/libs/fixtureDiamondRight.ts',
      `import '@/server/fixtureDb.server';\nexport const right = true;\n`,
    ],
    [
      'src/libs/fixtureCycleA.ts',
      `import '@/libs/fixtureCycleB';\nexport const a = true;\n`,
    ],
    [
      'src/libs/fixtureCycleB.ts',
      `import '@/libs/fixtureCycleA';\nimport '@/server/fixtureDb.server';\nexport const b = true;\n`,
    ],
    [
      'src/components/FixtureClient.tsx',
      `'use client';\nimport '@/libs/fixtureDiamondLeft';\nimport '@/libs/fixtureDiamondRight';\n`,
    ],
    [
      'src/components/FixtureClientSeed.tsx',
      `'use client';\nimport 'server-only';\nimport '@/server/fixtureDb.server';\n`,
    ],
  ]);

  it('terminates on cycles and reports the shortest valid client-to-seed chain', () => {
    const violations = findClientServerBoundaryViolations(fixtureFiles);

    expect(violations).toEqual([
      {
        clientFile: 'src/components/FixtureClient.tsx',
        chain: [
          'src/components/FixtureClient.tsx',
          'src/libs/fixtureDiamondRight.ts',
          'src/server/fixtureDb.server.ts',
        ],
      },
      {
        clientFile: 'src/components/FixtureClientSeed.tsx',
        chain: [
          'src/components/FixtureClientSeed.tsx',
          'src/server/fixtureDb.server.ts',
        ],
      },
    ]);
    expect(violations).toEqual(findClientServerBoundaryViolationsReference(fixtureFiles));
  });
});

// =============================================================================
// Repo-wide enforcement — the actual CI-enforced guard, over real src/ files.
// =============================================================================

describe('client/server boundary — repo-wide enforcement', () => {
  const allFiles = readSourceFiles(walkTsFiles());
  const analysis = analyzeClientServerBoundary(allFiles);

  it('the scan is not vacuous: at least one server-only seed and one `use client` module exist', () => {
    expect(analysis.seeds.size).toBeGreaterThan(0);
    expect(analysis.clients.length).toBeGreaterThan(0);
  });

  it('no `use client` module runtime-imports a server-only module, directly or transitively', () => {
    const violations = analysis.violations;

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

    const violations = analysis.violations;

    expect(violations.find(v => v.clientFile === salonProvider)).toBeUndefined();
  });

  it('regression anchor: lusterSecurity.ts (AES-256-GCM/HMAC key derivation from Env secrets) is recognized as a seed', () => {
    // Adversarial review found this as a real, nameable escape: it derives
    // encryption/HMAC keys from `Env.INTEGRATION_ENCRYPTION_KEY` /
    // `Env.CLERK_SECRET_KEY`, but was neither `.server.ts` nor
    // self-declaring `import 'server-only'` — and imports no OTHER seed
    // module (only `node:crypto` and `@/libs/Env`, which is deliberately
    // client-importable t3-env), so nothing about it was structurally
    // detectable before its own `import 'server-only'` was added. This
    // pins that fix so a future edit can't silently drop it back into the
    // guard's blind spot.
    const file = 'src/libs/lusterSecurity.ts';

    expect(allFiles.has(file)).toBe(true);
    expect(isServerOnlySeed(file, allFiles.get(file)!)).toBe(true);
  });
});
