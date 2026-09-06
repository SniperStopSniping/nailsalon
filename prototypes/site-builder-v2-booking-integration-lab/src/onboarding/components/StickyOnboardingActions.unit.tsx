import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';

import { StickyOnboardingActions } from './StickyOnboardingActions';

function readOnboardingCss(): string {
  return readFileSync(join(process.cwd(), 'src/onboarding/onboarding.css'), 'utf8');
}

describe('StickyOnboardingActions', () => {
  it('renders the primary before Back when primaryFirst is set', () => {
    render(
      <StickyOnboardingActions
        primaryFirst
        primaryLabel="Show me my site →"
        onBack={() => {}}
      />,
    );

    const footer = screen.getByRole('contentinfo', { name: 'Onboarding actions' });

    expect(footer.className).toContain('is-primary-first');

    const buttons = [...footer.querySelectorAll('button')];

    expect(buttons.map(button => button.textContent)).toEqual([
      'Show me my site →',
      'Back',
    ]);
    // The exact shape that used to fire the positional fallback: Back is the
    // LAST child, so `> button:last-child:not(:only-child)` matched it.
    expect(buttons.at(-1)?.className).toBe('sticky-onboarding-actions__back');
  });

  it('renders Back before the primary by default', () => {
    render(
      <StickyOnboardingActions primaryLabel="Continue" onBack={() => {}} />,
    );

    const buttons = [
      ...screen
        .getByRole('contentinfo', { name: 'Onboarding actions' })
        .querySelectorAll('button'),
    ];

    expect(buttons.map(button => button.textContent)).toEqual([
      'Back',
      'Continue',
    ]);
  });
});

/**
 * AG-cohesion-03 — one filled plum CTA per onboarding screen.
 *
 * The filled recipe must reach `.sticky-onboarding-actions__primary` only. The
 * positional fallbacks exist for class-less legacy markup and are guarded so
 * they cannot paint the Back button of a primary-first footer, where Back is
 * the last child.
 */
describe('onboarding footer button hierarchy (AG-cohesion-03)', () => {
  it('never applies the filled primary recipe positionally inside a primary-first footer', () => {
    const css = readOnboardingCss();

    expect(css).toMatch(
      /\.sticky-onboarding-actions__primary,\s*\.sticky-onboarding-actions:not\(\.is-primary-first\)\s*> button:last-child:not\(:only-child\) \{[^}]*background: var\(--onboarding-accent\);/u,
    );
    expect(css).toMatch(
      /\.sticky-onboarding-actions__primary:hover:not\(:disabled\),\s*\.sticky-onboarding-actions:not\(\.is-primary-first\)\s*> button:last-child:not\(:only-child\):hover:not\(:disabled\) \{/u,
    );
    expect(css).toMatch(
      /\.sticky-onboarding-actions__back,\s*\.sticky-onboarding-actions:not\(\.is-primary-first\)\s*> button:first-child:not\(:last-child\) \{/u,
    );
    // The >=480px sizing fallback would otherwise make Back the widest button.
    expect(css).toMatch(
      /\.sticky-onboarding-actions__primary,\s*\.sticky-onboarding-actions:not\(\.is-primary-first\)\s*> button:last-child:not\(:only-child\) \{\s*min-width: min\(245px, 42vw\);/u,
    );

    // No unguarded positional fallback may survive.
    expect(css).not.toMatch(
      /\.sticky-onboarding-actions > button:(?:last|first)-child:not\(/u,
    );
  });

  it('keeps the primary-first Back button quiet: surface ground, no CTA shadow', () => {
    const css = readOnboardingCss();

    expect(css).toMatch(
      /\.sticky-onboarding-actions\.is-primary-first > \.sticky-onboarding-actions__back \{[^}]*background: var\(--onboarding-surface\);[^}]*box-shadow: none;/u,
    );
    expect(css).toMatch(
      /\.sticky-onboarding-actions\.is-primary-first > \.sticky-onboarding-actions__primary \{[^}]*background: var\(--onboarding-accent\);/u,
    );
  });
});
