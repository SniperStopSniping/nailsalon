import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

/**
 * Architecture hardening pass (H3/H5/H6) — shared MECHANICAL helpers for the
 * structural-guard test suite.
 *
 * This module intentionally holds no policy. It does not know what counts as
 * "server-only", which modules own which domain, or what fields a DTO may
 * carry — every test file that imports this keeps its own hardcoded list of
 * files/patterns and its own assertions. This file only answers three
 * mechanical questions, correctly, once, so every guard test agrees on the
 * answer instead of each re-implementing (and possibly disagreeing on) its
 * own regex:
 *
 *   1. Does this file start with a `'use client'` directive?
 *   2. Which of this file's imports bring in a RUNTIME VALUE (as opposed to
 *      an `import type` — erased at compile time, and deliberately allowed
 *      to cross the client/server boundary; see `SalonProvider.tsx`)? This
 *      includes a statically-resolvable dynamic `import('...')` or
 *      `require('...')` — those can smuggle a value edge past a scan that
 *      only looks at top-level `ImportDeclaration`s.
 *   3. Given an import specifier and the file that wrote it, which file on
 *      disk (if any, under `src/`) does it resolve to?
 *
 * Not imported by any production code path — this is test-support tooling
 * only, the same role `catalogResolverFixtures.ts` plays for the catalog
 * resolver tests.
 */

export const REPO_ROOT = process.cwd();
export const SRC_ROOT = path.join(REPO_ROOT, 'src');

/** Posix-normalized, repo-root-relative path — the key shape every guard test keys its file maps by. */
export function toRepoRelativePosix(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
}

export function isTestOrStoryFile(repoRelativePath: string): boolean {
  return /\.(?:test|spec|stories)\.tsx?$/.test(repoRelativePath);
}

/**
 * Recursively lists every `.ts`/`.tsx` file under `dir` (repo-root-relative
 * posix paths), skipping `node_modules` wherever it appears.
 */
export function walkTsFiles(dir: string = SRC_ROOT): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'node_modules' ? [] : walkTsFiles(full);
    }
    return /\.tsx?$/.test(full) ? [toRepoRelativePosix(full)] : [];
  });
}

/** Reads every listed (repo-relative) path into a `path -> source text` map. */
export function readSourceFiles(repoRelativePaths: string[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const relativePath of repoRelativePaths) {
    files.set(relativePath, readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
  }
  return files;
}

function parse(sourceText: string, repoRelativePath: string): ts.SourceFile {
  const kind = repoRelativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(repoRelativePath, sourceText, ts.ScriptTarget.Latest, true, kind);
}

/**
 * True when the file's FIRST statement is exactly the `'use client'` (or
 * `"use client"`) directive prologue — the same rule Next.js itself uses to
 * decide a module is client-bundled.
 */
export function hasUseClientDirective(sourceText: string, repoRelativePath: string): boolean {
  const sourceFile = parse(sourceText, repoRelativePath);
  const first = sourceFile.statements[0];
  return !!first
    && ts.isExpressionStatement(first)
    && ts.isStringLiteral(first.expression)
    && first.expression.text === 'use client';
}

/**
 * Every module specifier this file imports (or re-exports) a RUNTIME VALUE
 * from — i.e. every edge that survives `tsc` erasing `import type` (whole
 * clause) and per-specifier `type` modifiers (`import { type A, B } from`).
 * A bare side-effect import (`import 'server-only';`) always counts: its
 * only purpose is the runtime/build-time effect of being evaluated.
 *
 * Deliberately does not attempt to resolve or dedupe — callers do that.
 */
export function getValueImportSpecifiers(sourceText: string, repoRelativePath: string): string[] {
  const sourceFile = parse(sourceText, repoRelativePath);
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const moduleSpecifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;

      if (!clause) {
        // `import 'server-only';` — side-effect only, always a value edge.
        specifiers.push(moduleSpecifier);
        continue;
      }
      if (clause.isTypeOnly) {
        // `import type { ... } from '...'` — fully erased, no edge.
        continue;
      }

      let bringsValue = !!clause.name; // default import binding
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          bringsValue = true; // `import * as ns from '...'`
        } else if (ts.isNamedImports(clause.namedBindings)) {
          // `import { type A, B } from '...'` — B alone makes this a value edge.
          bringsValue = bringsValue || clause.namedBindings.elements.some(el => !el.isTypeOnly);
        }
      }
      if (bringsValue) {
        specifiers.push(moduleSpecifier);
      }
      continue;
    }

    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      // `export { x } from '...'` re-exports a value edge too (rare in this
      // repo, but a barrel re-export is exactly the shape that would smuggle
      // a value import past a naive "only look at `import` statements" scan).
      if (statement.isTypeOnly) {
        continue;
      }
      let bringsValue = true;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        bringsValue = statement.exportClause.elements.some(el => !el.isTypeOnly);
      }
      if (bringsValue) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    }
  }

  specifiers.push(...collectDynamicSpecifiers(sourceFile));

  return specifiers;
}

/**
 * Dynamic `import('...')` and CommonJS `require('...')` calls are a REAL
 * value-import shape — unlike a top-level `ImportDeclaration`, they can
 * appear anywhere in the tree (inside a function body, a conditional, an
 * event handler), so this walks every node rather than just
 * `sourceFile.statements`.
 *
 * Only a STATIC STRING (or no-substitution template) argument is resolvable
 * — `import(someVariable)` or `require(\`./${name}\`)` can't be resolved
 * without running the program, so those are deliberately skipped rather than
 * guessed at. A type-position `import('...')` (e.g. `type Foo =
 * import('./x').Foo`) is a DIFFERENT AST node (`ImportTypeNode`, not a
 * `CallExpression`) and is correctly never visited here — it stays exempt,
 * same as `import type`.
 */
function collectDynamicSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      // `ts.isImportCall` exists at runtime but isn't part of the public
      // `typescript.d.ts` surface, so this checks the same thing the public
      // way: a dynamic `import(...)` call's callee is the bare `import`
      // keyword token, not an identifier or property access.
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequireCall) {
        const arg = node.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
          specifiers.push(arg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return specifiers;
}

/**
 * Resolves an import specifier written inside `fromFile` to a repo-relative
 * posix path, using this repo's ONLY alias (`@/* -> src/*`, tsconfig.json)
 * plus relative (`./`, `../`) resolution. Returns `null` for anything that
 * isn't a source file under `src/` in `exists` (external packages, the
 * `@/public/*` asset alias, or a specifier this candidate set doesn't
 * contain) — those are simply not part of the internal graph a guard walks.
 */
export function resolveModuleSpecifier(
  fromFile: string,
  specifier: string,
  exists: (candidate: string) => boolean,
): string | null {
  let base: string;
  if (specifier.startsWith('@/public/')) {
    return null; // static-asset alias, never a TS module
  }
  if (specifier.startsWith('@/')) {
    base = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith('.')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  } else {
    return null; // external package (react, drizzle-orm, zod, server-only, ...)
  }

  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find(exists) ?? null;
}

/** Strips `//` and `/* *\/` comments so prose in a doc comment can never trip a source-text scan. */
export function stripComments(sourceText: string): string {
  return sourceText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}
