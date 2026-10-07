import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const globalCss = readFileSync(
  join(process.cwd(), 'src/styles/global.css'),
  'utf8',
);

const onboardingCss = readFileSync(
  join(process.cwd(), 'src/features/onboarding-v1-integration/onboarding-integration.css'),
  'utf8',
);

/**
 * Extract the declaration body of the first rule whose selector list matches.
 * jsdom cannot resolve Tailwind-processed custom properties, so the design
 * contract is asserted against the stylesheet text.
 */
function ruleBody(css: string, selectorFragment: string): string {
  const at = css.indexOf(selectorFragment);

  expect(at, `selector not found: ${selectorFragment}`).toBeGreaterThan(-1);

  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);

  return css.slice(open + 1, close);
}

describe('owner token layer', () => {
  const ownerScope = ruleBody(
    globalCss,
    '.owner-workspace-theme,\n  .owner-theme-scope,',
  );

  it('defines the Luster owner palette once, on the owner scopes', () => {
    expect(ownerScope).toContain('--owner-accent: #8f3155;');
    expect(ownerScope).toContain('--owner-accent-strong: #70213f;');
    expect(ownerScope).toContain('--owner-ground: #fcf3f2;');
    expect(ownerScope).toContain('--owner-surface: #fffcfa;');
    expect(ownerScope).toContain('--owner-ink: #3b192b;');
    expect(ownerScope).toContain('--owner-muted: #75656b;');
    expect(ownerScope).toContain('--owner-line: #ead7de;');
    expect(ownerScope).toContain('--owner-line-strong: #d8c1c8;');
    expect(ownerScope).toContain('--owner-focus: #8f3155;');
  });

  it('carries the shared radii, shadow and faces', () => {
    expect(ownerScope).toContain('--owner-radius-card: 26px;');
    expect(ownerScope).toContain('--owner-radius-sheet: 28px;');
    expect(ownerScope).toContain('--owner-shadow-card: 0 8px 26px rgb(96 41 58 / 4%), 0 2px 5px rgb(96 41 58 / 1%);');
    expect(ownerScope).toContain('--owner-font-display: var(--font-owner-display,');
    expect(ownerScope).toContain('--owner-font-body: var(--font-owner-sans,');
  });

  it('matches the approved owner-entry palette without changing customer tokens', () => {
    const entry = readFileSync(join(process.cwd(), 'src/components/owner-entry/owner-entry.css'), 'utf8');
    const pairs = [
      ['ground', 'ground'],
      ['surface', 'card'],
      ['ink', 'ink'],
      ['muted', 'muted'],
      ['line', 'border'],
      ['accent', 'plum'],
    ];
    for (const [ownerName, entryName] of pairs) {
      const entryValue = entry.match(new RegExp(`--entry-${entryName}: ([^;]+);`))![1];

      expect(ownerScope).toContain(`--owner-${ownerName}: ${entryValue};`);
    }
  });

  it('covers the onboarding hand-off surfaces from the same definition', () => {
    expect(globalCss).toContain('.onboarding-integration-owner,\n  .onboarding-integration-loading {');
  });

  it('is the only definition — onboarding no longer redefines the names', () => {
    const redefinitions = onboardingCss.match(/^\s*--owner-[a-z-]+:/gm);

    expect(redefinitions).toBeNull();
  });

  it('exposes an .owner-title utility bound to the display face', () => {
    const title = ruleBody(globalCss, '.owner-title {');

    expect(title).toContain('font-family: var(--owner-font-display);');
  });

  it('binds the owner shell body face outside @layer so it beats font-sans', () => {
    const unlayeredTail = globalCss.slice(globalCss.lastIndexOf('@keyframes shimmer'));

    expect(unlayeredTail).toContain('.owner-theme-scope {\n  font-family: var(--owner-font-body);');
  });
});

describe('customer --n5-* tokens', () => {
  it('are not defined on :root, so they never resolve on document.documentElement', () => {
    const root = ruleBody(globalCss, '  :root {');

    expect(root.match(/--n5-[a-z0-9-]+:/g)).toBeNull();
  });

  it('still ship their customer defaults, scoped to body', () => {
    const body = ruleBody(globalCss, '  body {');

    expect(body).toContain('--n5-bg-surface: #faf4ec;');
    expect(body).toContain('--n5-ink-main: #3f2b24;');
    expect(body).toContain('--n5-accent: #d6a249;');
    expect(body).toContain('--n5-font-heading:');
  });

  it('are dropped inside every owner scope', () => {
    const body = ruleBody(globalCss, '  body {');
    const declared = [...body.matchAll(/(--n5-[a-z0-9-]+):/g)].map(match => match[1]);
    const ownerScope = ruleBody(
      globalCss,
      '.owner-workspace-theme,\n  .owner-theme-scope,',
    );

    expect(declared.length).toBeGreaterThanOrEqual(40);

    for (const token of declared) {
      expect(ownerScope, `${token} is not reset in the owner scope`).toContain(`${token}: initial;`);
    }
  });
});
