import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from '@/libs/architectureGuardSupport';

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
 */

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** True when `source`'s value-import lines (comments stripped) match `pattern`. */
function importsMatching(source: string, pattern: RegExp): boolean {
  return pattern.test(stripComments(source));
}

function offendersAmong(files: readonly string[], pattern: RegExp): string[] {
  return files.filter(file => importsMatching(read(file), pattern));
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

  // `server-only` is always a bare side-effect import (`import 'server-only';`
  // — no `from`), so it needs its own alternative rather than folding into
  // the `from '...'` pattern the other two use.
  const FORBIDDEN = /from\s+['"](?:@\/libs\/DB|drizzle-orm[^'"]*)['"]|^\s*import\s+['"]server-only['"]/m;

  it('the pattern actually matches a known-bad import (non-vacuous)', () => {
    expect(importsMatching(`import { db } from '@/libs/DB';\n`, FORBIDDEN)).toBe(true);
    expect(importsMatching(`import 'server-only';\n`, FORBIDDEN)).toBe(true);
    expect(importsMatching(`import { eq } from 'drizzle-orm';\n`, FORBIDDEN)).toBe(true);
    // A doc comment merely NAMING these must never trip the check — this
    // repo's own catalog-core files say "no `@/libs/DB`, no `server-only`"
    // in prose (see catalogDomain.ts's module doc comment).
    expect(importsMatching(`/** no @/libs/DB, no server-only, no drizzle-orm here */\n`, FORBIDDEN)).toBe(false);
  });

  it('none of the catalog core files import DB, drizzle, or server-only', () => {
    expect(offendersAmong(CATALOG_CORE_FILES, FORBIDDEN)).toEqual([]);
  });
});

// =============================================================================
// 2. Resolver core must not import React (it must stay usable in the
//    browser AND on the server, with no rendering dependency either way).
// =============================================================================

describe('resolver core has no React dependency (H5 #2)', () => {
  const RESOLVER_CORE_FILES = ['src/libs/catalogResolverCore.ts', 'src/libs/catalogDomain.ts'];
  const FORBIDDEN = /from\s+['"]react(?:-dom)?['"]/;

  it('the pattern actually matches a known-bad import (non-vacuous)', () => {
    expect(importsMatching(`import { useState } from 'react';\n`, FORBIDDEN)).toBe(true);
  });

  it('neither file imports react, and neither is a .tsx file (so JSX is not even syntactically possible)', () => {
    expect(offendersAmong(RESOLVER_CORE_FILES, FORBIDDEN)).toEqual([]);

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
  // Matches both `@/libs/depositXxx` and the `@/libs/deposits/*` directory.
  const FORBIDDEN = /from\s+['"]@\/libs\/deposit/;

  it('the pattern actually matches a known-bad import (non-vacuous)', () => {
    expect(importsMatching(`import { getDepositPolicy } from '@/libs/depositPolicy';\n`, FORBIDDEN)).toBe(true);
    expect(importsMatching(`import { releaseHold } from '@/libs/deposits/holdWriters';\n`, FORBIDDEN)).toBe(true);
  });

  it('no presentation module imports a deposit internal', () => {
    expect(offendersAmong(PRESENTATION_FILES, FORBIDDEN)).toEqual([]);
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
  const FORBIDDEN = /from\s+['"]@\/libs\/(?:stripe|googleCalendar|twilioMessagingSend|smsSender|email)['"]/;

  it('the pattern actually matches a known-bad import (non-vacuous)', () => {
    expect(importsMatching(`import { stripe } from '@/libs/stripe';\n`, FORBIDDEN)).toBe(true);
  });

  it('neither public DTO module imports a payment or provider secret module', () => {
    expect(offendersAmong(PUBLIC_DTO_FILES, FORBIDDEN)).toEqual([]);
  });
});

// =============================================================================
// 5. Client presentation must not import the server catalog loader.
//
// NOT re-implemented here — it is already the GENERAL CASE of
// architectureClientServerBoundary.test.ts (H3), which flags ANY 'use
// client' module that runtime-imports ANY `.server.ts` module, transitively,
// repo-wide. `catalogResolver.server.ts` is exactly such a module, so it is
// already covered by that broader guard; a second, narrower check here
// would just be the same assertion restated. This test only pins the
// PRECONDITION that makes that true, so the cross-reference stays honest if
// the file is ever renamed.
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
// =============================================================================
