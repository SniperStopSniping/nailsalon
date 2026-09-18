import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  getValueImportSpecifiers,
  REPO_ROOT,
  resolveModuleSpecifier,
  walkTsFiles,
} from '@/libs/architectureGuardSupport';

/**
 * A1-2 Piece 1 — the availability engine must stay IDENTITY-FREE.
 *
 * `engine.server.ts` answers "can this day be booked", never "who is asking".
 * The public route keeps the caller's identity entirely to itself: the session
 * cookie, the manage token, the automatic-discount resolution and the Smart
 * Fit client keys. Smart Fit reaches the loop only through the opaque
 * `annotateSlot` callback.
 *
 * That separation is what lets a second caller (the owner assistant's
 * read-only day diagnosis) run the SAME rules without inheriting a public
 * endpoint's authentication surface — so it is enforced structurally, not by
 * convention.
 *
 * The check is RESOLUTION-based, like `architecturalInvariants.test.ts`: each
 * `import` specifier is resolved to a file under `src/`, and the whole
 * TRANSITIVE value-import graph is walked. A type-only import is deliberately
 * exempt (it is erased before runtime and cannot smuggle behaviour in);
 * `getValueImportSpecifiers` also follows dynamic `import()` and `require()`,
 * which is exactly how a lazy identity lookup would otherwise sneak past a
 * top-level-imports-only scan.
 */

const ENGINE = 'src/libs/availability/engine.server.ts';
/** The route legitimately imports all of these — it is the non-vacuousness control. */
const ROUTE = 'src/app/api/appointments/availability/route.ts';
/** The route wrapper delegates its direct identity imports to this handler. */
const AVAILABILITY_HANDLER = 'src/libs/publicBookingAvailability.server.ts';

/**
 * Every module that makes the engine's promise to an OWNER: "this answers what
 * the booking page would do, and it cannot see anything a client owns."
 *
 * The two owner-assistant tools are held to the same boundary as the engine
 * itself because they make the identical claim to the identical audience — the
 * day diagnosis re-runs the public route's decisions minus its identity
 * surface, and the readiness adapter hands an owner-facing projection to a
 * model. A client-session or manage-token import appearing in either one would
 * silently widen what the assistant can see, which is exactly the class of
 * regression a prose comment does not catch.
 */
const GUARDED: Array<{ file: string; blanketSmartFitPrefix: boolean }> = [
  { file: ENGINE, blanketSmartFitPrefix: true },
  { file: 'src/libs/ownerAssistant/tools/diagnoseDayAvailability.server.ts', blanketSmartFitPrefix: false },
  { file: 'src/libs/ownerAssistant/tools/getSetupReadiness.server.ts', blanketSmartFitPrefix: false },
];

/**
 * Forbidden EDGES, keyed by the module that owns each forbidden symbol. The
 * spec names symbols; a symbol can only arrive through its module, so
 * resolving the module is the stronger check.
 */
const FORBIDDEN_MODULES: Array<{ file: string; because: string }> = [
  { file: 'src/libs/clientAuth.ts', because: 'getClientSession' },
  { file: 'src/libs/appointmentAccess.ts', because: 'verifyAppointmentAccessToken' },
  { file: 'src/libs/firstVisitDiscount.ts', because: 'resolveAutomaticBookingDiscount' },
  { file: 'src/libs/smartFitBooking.ts', because: 'buildSmartFitClientKeys' },
];

/**
 * Anything under `src/libs/smartFit*`, which is STRICTER than the symbol the
 * spec names: `buildSmartFitClientKeys` lives in `smartFitBooking.ts` alone
 * (now also listed above, by module, for every guarded file). The engine is
 * held to the whole prefix because it has no business anywhere near Smart Fit;
 * the owner-assistant tools cannot be, because both reach the pure pricing
 * helpers `smartFit.ts` / `smartFitCustomer.ts` through `depositPolicy.ts` —
 * deposit PRICING, which carries no client identity and which a readiness or
 * availability answer legitimately depends on.
 */
const FORBIDDEN_PREFIX = /^src\/libs\/smartFit/;

const FORBIDDEN_SYMBOLS = [
  'getClientSession',
  'verifyAppointmentAccessToken',
  'resolveAutomaticBookingDiscount',
  'buildSmartFitClientKeys',
];

const ALL_SOURCE_FILES = new Set(walkTsFiles());
const exists = (candidate: string) => ALL_SOURCE_FILES.has(candidate);

function read(repoRelativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, repoRelativePath), 'utf8');
}

/** Every `src/` file reachable from `entry` through RUNTIME (non-type) imports. */
function valueImportClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);

    for (const specifier of getValueImportSpecifiers(read(file), file)) {
      const resolved = resolveModuleSpecifier(file, specifier, exists);
      if (resolved && !seen.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return seen;
}

/**
 * Every name a file binds through an `import` — default, namespace and named,
 * including `import type` ones, because the point here is that the engine does
 * not even MENTION these symbols. Read off the AST, so prose in a doc comment
 * (this file's own rationale names all four) can never trip it.
 */
function importedBindings(repoRelativePath: string): Set<string> {
  const sourceFile = ts.createSourceFile(
    repoRelativePath,
    read(repoRelativePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const bindings = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      continue;
    }

    const clause = statement.importClause;
    if (clause.name) {
      bindings.add(clause.name.text);
    }

    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        bindings.add(clause.namedBindings.name.text);
      } else {
        for (const element of clause.namedBindings.elements) {
          bindings.add((element.propertyName ?? element.name).text);
        }
      }
    }
  }

  return bindings;
}

function forbiddenHits(closure: Set<string>, blanketSmartFitPrefix = true): string[] {
  return Array.from(closure)
    .filter(file =>
      (blanketSmartFitPrefix && FORBIDDEN_PREFIX.test(file))
      || FORBIDDEN_MODULES.some(entry => entry.file === file))
    .sort();
}

describe('availability engine import boundary', () => {
  it('resolves the modules it guards (non-vacuous)', () => {
    for (const { file } of FORBIDDEN_MODULES) {
      expect(exists(file)).toBe(true);
    }

    expect(Array.from(ALL_SOURCE_FILES).some(file => FORBIDDEN_PREFIX.test(file))).toBe(true);
    expect(exists(ROUTE)).toBe(true);
    expect(exists(AVAILABILITY_HANDLER)).toBe(true);

    for (const { file } of GUARDED) {
      expect(exists(file), `guarded file missing: ${file}`).toBe(true);
    }
  });

  it('flags the availability route, which legitimately imports every forbidden module (control)', () => {
    // If this ever comes back empty the guard below has stopped guarding
    // anything: the closure walk, the resolver, or the forbidden list broke.
    const hits = forbiddenHits(valueImportClosure(ROUTE));

    expect(hits).toContain('src/libs/clientAuth.ts');
    expect(hits).toContain('src/libs/appointmentAccess.ts');
    expect(hits).toContain('src/libs/firstVisitDiscount.ts');
    expect(hits).toContain('src/libs/smartFitBooking.ts');
    expect(hits.some(file => FORBIDDEN_PREFIX.test(file))).toBe(true);

    // The module-only policy the tools are held to still catches the route:
    // dropping the blanket prefix must not drop the symbol's own module.
    expect(forbiddenHits(valueImportClosure(ROUTE), false)).toContain('src/libs/smartFitBooking.ts');
  });

  it.each(GUARDED)('never reaches an identity module from $file, transitively', ({ file, blanketSmartFitPrefix }) => {
    const closure = valueImportClosure(file);

    expect(closure.size).toBeGreaterThan(1);
    expect(forbiddenHits(closure, blanketSmartFitPrefix)).toEqual([]);
  });

  it.each(GUARDED)('never binds an identity symbol in the import statements of $file', ({ file }) => {
    const bound = importedBindings(file);

    // The control: the route's handler binds them, so an empty/broken extractor fails here.
    const routeBindings = importedBindings(AVAILABILITY_HANDLER);

    expect(FORBIDDEN_SYMBOLS.filter(symbol => routeBindings.has(symbol)).sort())
      .toEqual([...FORBIDDEN_SYMBOLS].sort());

    for (const symbol of FORBIDDEN_SYMBOLS) {
      expect(bound.has(symbol)).toBe(false);
    }
  });

  it('keeps reasons.ts pure — no runtime import at all', () => {
    const closure = valueImportClosure('src/libs/availability/reasons.ts');

    expect(Array.from(closure)).toEqual(['src/libs/availability/reasons.ts']);
  });
});
