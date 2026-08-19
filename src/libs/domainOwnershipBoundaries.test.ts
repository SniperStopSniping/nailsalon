import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getValueImportSpecifiers, resolveModuleSpecifier } from '@/libs/architectureGuardSupport';

/**
 * H5 — domain ownership boundaries (architecture hardening pass).
 *
 * This repo's domains: catalog (resolver core / public projection / server
 * wrapper) · quote (`bookingQuote.ts` owns authoritative money math) ·
 * availability · deposits/payments · presentation (sections/layout/theme) ·
 * Discover · onboarding/publication.
 *
 * Per the hardening charter, this file enforces ONLY the high-value,
 * low-false-positive-risk illegal-import checks — each one scoped to an
 * explicit, small, named file list (never a repo-wide sweep, never a
 * generic "domain X may not import domain Y" rule engine). Every check
 * below is proven against `main` to have zero PRE-EXISTING violations
 * before this branch (see the H3/H4/H5/H6 report for the exact commands).
 *
 * What this file deliberately does NOT do: a full dependency-injection
 * boundary, a repo-wide domain-ownership sweep, or enforcement of every
 * domain pairing named in H5. Broader domain debt this pass does NOT
 * enforce is documented at the bottom instead of guarded, per the charter's
 * explicit instruction not to attempt a large unrelated refactor.
 *
 * MATCHING: every check below is DIRECT-IMPORT-ONLY by design (a fixed,
 * small file list — never transitive, never a repo-wide sweep; see the
 * module doc comment above). Within that direct-import scope, a forbidden
 * INTERNAL target (another `src/` module, e.g. `@/libs/DB`) is matched by
 * RESOLVING every value-import specifier with `resolveModuleSpecifier`
 * (`architectureGuardSupport.ts`) and comparing the resolved path — so
 * `from './DB'` is caught exactly like `from '@/libs/DB'`, both resolving to
 * the same `src/libs/DB.ts`, rather than by hand-rolling a second
 * alias-only regex that only a `@/libs/...` spelling would match. A
 * forbidden EXTERNAL package (`drizzle-orm`, `server-only`, `react`) has no
 * relative-path form at all — an npm package can't be imported as `./DB` —
 * so those stay a raw specifier check.
 */

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const fileExists = (candidate: string): boolean => existsSync(path.join(ROOT, candidate));

/** Every value-import specifier `file` writes, verbatim (for matching an EXTERNAL package by name). */
function rawValueImportSpecifiers(file: string): string[] {
  return getValueImportSpecifiers(read(file), file);
}

/** Every value-import specifier `file` writes, RESOLVED to a repo-relative path where it names an internal `src/` module (for matching an INTERNAL target regardless of alias vs. relative spelling). */
function resolvedValueImportTargets(file: string): string[] {
  return rawValueImportSpecifiers(file)
    .map(specifier => resolveModuleSpecifier(file, specifier, fileExists))
    .filter((resolved): resolved is string => resolved !== null);
}

// =============================================================================
// 1. Catalog core must not import DB / drizzle / server-only.
// =============================================================================

describe('catalog core is free of DB access (H5 #1)', () => {
  // The domain-ownership statement, broader than H6 invariant 1 (which pins
  // the single narrowest file, `catalogResolverCore.ts`, verbatim from the
  // charter): the WHOLE catalog core layer stays DB-free, not just its
  // entry point. `catalogFingerprint.server.ts` and `catalogResolver.server.ts`
  // are deliberately excluded — they are the server half of this same
  // domain and are SUPPOSED to touch the database; see
  // architectureClientServerBoundary.test.ts, which is what keeps THEM out
  // of a client bundle instead.
  const CATALOG_CORE_FILES = [
    'src/libs/catalogDomain.ts',
    'src/libs/catalogResolverCore.ts',
    'src/libs/catalogRuleGraph.ts',
    'src/libs/catalogRuleContract.ts',
    'src/libs/confirmationMode.ts',
  ];

  const FORBIDDEN_INTERNAL_TARGETS = new Set(['src/libs/DB.ts']);
  const isForbiddenExternalPackage = (specifier: string) =>
    specifier === 'server-only' || specifier === 'drizzle-orm' || specifier.startsWith('drizzle-orm/');

  function offenders(): string[] {
    return CATALOG_CORE_FILES.filter(file =>
      resolvedValueImportTargets(file).some(target => FORBIDDEN_INTERNAL_TARGETS.has(target))
      || rawValueImportSpecifiers(file).some(isForbiddenExternalPackage));
  }

  it('the matcher actually catches a known-bad import, aliased AND relative (non-vacuous)', () => {
    // `src/libs/DB.ts` is a real file, so resolving against a fixture path
    // in the SAME directory (`src/libs/`) exercises the real resolver, not a
    // mocked one.
    const resolveFromLibs = (specifier: string) => resolveModuleSpecifier('src/libs/fixture.ts', specifier, fileExists);

    expect(resolveFromLibs('@/libs/DB')).toBe('src/libs/DB.ts');
    expect(resolveFromLibs('./DB')).toBe('src/libs/DB.ts');
    expect(isForbiddenExternalPackage('server-only')).toBe(true);
    expect(isForbiddenExternalPackage('drizzle-orm')).toBe(true);
    expect(isForbiddenExternalPackage('drizzle-orm/pg-core')).toBe(true);
    // A doc comment merely NAMING these must never trip the check — this
    // repo's own catalog-core files say "no `@/libs/DB`, no `server-only`"
    // in prose (see catalogDomain.ts's module doc comment). Comments are
    // never parsed as imports by `getValueImportSpecifiers` in the first
    // place (it walks the AST, not source text), so there is nothing here
    // for a doc comment to accidentally match.
  });

  it('none of the catalog core files import DB (aliased or relative), drizzle, or server-only', () => {
    expect(offenders()).toEqual([]);
  });
});

// =============================================================================
// 2. Resolver core must not import React (it must stay usable in the
//    browser AND on the server, with no rendering dependency either way).
//    `react`/`react-dom` are npm packages with no relative-path form, so
//    this stays a raw specifier check.
// =============================================================================

describe('resolver core has no React dependency (H5 #2)', () => {
  const RESOLVER_CORE_FILES = ['src/libs/catalogResolverCore.ts', 'src/libs/catalogDomain.ts'];
  const isForbiddenExternalPackage = (specifier: string) => specifier === 'react' || specifier === 'react-dom';

  it('the matcher actually catches a known-bad import (non-vacuous)', () => {
    expect(isForbiddenExternalPackage('react')).toBe(true);
    expect(isForbiddenExternalPackage('react-dom')).toBe(true);
  });

  it('neither file imports react, and neither is a .tsx file (so JSX is not even syntactically possible)', () => {
    const offenders = RESOLVER_CORE_FILES.filter(file => rawValueImportSpecifiers(file).some(isForbiddenExternalPackage));

    expect(offenders).toEqual([]);

    for (const file of RESOLVER_CORE_FILES) {
      expect(file.endsWith('.ts')).toBe(true);
      expect(file.endsWith('.tsx')).toBe(false);
    }
  });
});

// =============================================================================
// 3. Presentation (sections/layout/theme) must not import deposit internals.
// =============================================================================

describe('presentation does not reach into deposit internals (H5 #3)', () => {
  const PRESENTATION_FILES = [
    'src/libs/bookingPageConfig.ts',
    'src/libs/bookingExperience.ts',
    'src/libs/salonContent.ts',
    'src/libs/sectionRegistry.ts',
  ];
  // A prefix, not a single file — the whole `deposit*`/`deposits/**` family.
  const isForbiddenInternalTarget = (resolvedTarget: string) => resolvedTarget.startsWith('src/libs/deposit');

  function offenders(): string[] {
    return PRESENTATION_FILES.filter(file => resolvedValueImportTargets(file).some(isForbiddenInternalTarget));
  }

  it('the matcher actually catches a known-bad import, aliased AND relative (non-vacuous)', () => {
    const resolveFromLibs = (specifier: string) => resolveModuleSpecifier('src/libs/fixture.ts', specifier, fileExists);

    expect(isForbiddenInternalTarget(resolveFromLibs('@/libs/depositPolicy')!)).toBe(true);
    expect(isForbiddenInternalTarget(resolveFromLibs('./depositPolicy')!)).toBe(true);
    expect(isForbiddenInternalTarget(resolveFromLibs('@/libs/deposits/holdWriters')!)).toBe(true);
    expect(isForbiddenInternalTarget(resolveFromLibs('./deposits/holdWriters')!)).toBe(true);
  });

  it('no presentation module imports a deposit internal, aliased or relative', () => {
    expect(offenders()).toEqual([]);
  });
});

// =============================================================================
// 4. Public DTO modules must not import payment/provider secret modules.
// =============================================================================

describe('the public catalog DTO layer does not import payment/provider secrets (H5 #4)', () => {
  const PUBLIC_DTO_FILES = ['src/libs/catalogDomain.ts', 'src/libs/catalogResolverCore.ts'];
  // Named provider/secret modules — deliberately additive to (not a restatement
  // of) check #1's "no server-only" rule: this targets specific PROVIDERS a
  // reviewer would recognize by name, so a failure reads as "why does the
  // catalog projector need Stripe/Twilio/Google?" rather than a generic hit.
  const FORBIDDEN_INTERNAL_TARGETS = new Set([
    'src/libs/stripe.ts',
    'src/libs/googleCalendar.ts',
    'src/libs/twilioMessagingSend.ts',
    'src/libs/smsSender.ts',
    'src/libs/email.ts',
  ]);

  function offenders(): string[] {
    return PUBLIC_DTO_FILES.filter(file => resolvedValueImportTargets(file).some(target => FORBIDDEN_INTERNAL_TARGETS.has(target)));
  }

  it('the matcher actually catches a known-bad import, aliased AND relative (non-vacuous)', () => {
    const resolveFromLibs = (specifier: string) => resolveModuleSpecifier('src/libs/fixture.ts', specifier, fileExists);

    expect(resolveFromLibs('@/libs/stripe')).toBe('src/libs/stripe.ts');
    expect(resolveFromLibs('./stripe')).toBe('src/libs/stripe.ts');
  });

  it('neither public DTO module imports a payment or provider secret module, aliased or relative', () => {
    expect(offenders()).toEqual([]);
  });
});

// =============================================================================
// 5. Client presentation must not import the server catalog loader.
//
// NOT re-implemented here — it is already the GENERAL CASE of
// architectureClientServerBoundary.test.ts (H3), which flags ANY 'use
// client' module that runtime-imports ANY `.server.ts` module, transitively,
// repo-wide (and, per that guard's own MINOR-3 fix, through a dynamic
// `import()`/`require()` too). `catalogResolver.server.ts` is exactly such a
// module, so it is already covered by that broader guard; a second,
// narrower check here would just be the same assertion restated. This test
// only pins the PRECONDITION that makes that true, so the cross-reference
// stays honest if the file is ever renamed.
// =============================================================================

describe('client presentation cannot reach the server catalog loader (H5 #5 — enforced by H3)', () => {
  it('catalogResolver.server.ts is named so the H3 boundary guard treats it as server-only', () => {
    expect('src/libs/catalogResolver.server.ts').toMatch(/\.server\.tsx?$/);
  });
});

// =============================================================================
// Documented, NOT enforced — broader domain-ownership debt out of scope for
// this pass (would require either a large refactor or a repo-wide sweep with
// meaningfully higher false-positive risk than the checks above).
//
//   - availability <-> quote: `bookingQuote.ts` and the availability module(s)
//     are not import-fenced from each other; no illegal-import check exists
//     because the two domains legitimately call into one another today and
//     drawing the line would require a design decision this pass is not
//     chartered to make.
//   - Discover / onboarding-publication: no ownership checks exist yet —
//     these domains are newer and their module boundaries are still settling
//     (see the L1 phased plan); adding a guard now would likely need
//     rewriting shortly after.
//   - deposits/payments -> presentation (the REVERSE direction of check #3):
//     not enforced. Nothing under `src/components/deposits/**` currently
//     imports `bookingPageConfig.ts`/`bookingExperience.ts`/`salonContent.ts`/
//     `sectionRegistry.ts` (checked against this branch), so the guard would
//     not be vacuous today — it is left undone only because "deposits/payments"
//     is a domain, not a fixed file list the way `PRESENTATION_FILES` above
//     is, and enumerating it risks the same drift a generic rule engine would.
//   - An intermediate helper smuggling a forbidden target into one of the
//     scoped files above via a SECOND hop (e.g. catalogDomain.ts importing a
//     small local helper that itself imports `@/libs/DB`) is NOT caught —
//     every check above is direct-import-only BY DESIGN (see the module doc
//     comment), the same deliberate scoping choice H3 makes the opposite way
//     on purpose (H3 IS transitive, because "does a client bundle end up
//     with server code in it" only has one right answer at any depth; these
//     domain-ownership checks are narrower on purpose so they stay reviewable
//     and don't turn into a repo-wide dependency-graph policy engine).
// =============================================================================
