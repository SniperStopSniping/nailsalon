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
    expect(ownerScope).toContain('--owner-ground: #f8f2ed;');
    expect(ownerScope).toContain('--owner-surface: #fffdfb;');
    expect(ownerScope).toContain('--owner-ink: #30262a;');
    expect(ownerScope).toContain('--owner-muted: #706267;');
    expect(ownerScope).toContain('--owner-line: #dfd1d4;');
    expect(ownerScope).toContain('--owner-line-strong: #d8c1c8;');
    expect(ownerScope).toContain('--owner-focus: #b85075;');
  });

  it('carries the shared radii, shadow and faces', () => {
    expect(ownerScope).toContain('--owner-radius-card: 20px;');
    expect(ownerScope).toContain('--owner-radius-sheet: 24px;');
    expect(ownerScope).toContain('--owner-shadow-card: 0 10px 30px rgb(76 29 46 / 6%);');
    expect(ownerScope).toContain('--owner-font-display: var(--font-owner-display,');
    expect(ownerScope).toContain('--owner-font-body: var(--font-owner-sans,');
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
