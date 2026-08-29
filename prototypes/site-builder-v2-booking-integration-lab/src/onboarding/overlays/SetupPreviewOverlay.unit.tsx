import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';

import { createDefaultOnboardingState } from '../model/defaults';
import { SetupPreviewOverlay } from './SetupPreviewOverlay';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

const installMatchMedia = () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })));
};

describe('SetupPreviewOverlay shared preview targeting', () => {
  beforeEach(installMatchMedia);

  it('shrink-wraps the shared overlay around the scaled stage instead of reserving a blank flex row', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/onboarding/onboarding.css'),
      'utf8',
    );

    expect(css).toMatch(
      /\.dialog-panel--sheet:has\(\.onboarding-preview-overlay\) \{[^}]*height: auto;/su,
    );
    expect(css).toMatch(
      /\.onboarding-preview-overlay \{[^}]*height: auto;[^}]*grid-template-rows: auto auto auto;/su,
    );
    expect(css).toMatch(
      /\.onboarding-preview-overlay \.onboarding-preview-stage \{[^}]*var\(--preview-stage-height\)[^}]*clamp\(210px, 64svh, 600px\)/su,
    );
    expect(css).not.toMatch(
      /\.onboarding-preview-overlay \.onboarding-preview-stage \{[^}]*height: 100%/su,
    );
    expect(css).not.toMatch(
      /\.dialog-panel--sheet:has\(\.onboarding-preview-overlay\) \{[^}]*\n\s+height: (?:100d?vh|calc\(100vh - 28px\))/su,
    );
  });

  it.each([
    ['starting_preview', 'top'],
    ['about', 'about'],
    ['about_design', 'about'],
    ['site_style', 'top'],
    ['final_preview', 'top'],
  ] as const)('maps the %s source to the %s preview target', (source, target) => {
    render(
      <SetupPreviewOverlay
        document={null}
        onClose={vi.fn()}
        onContinue={vi.fn()}
        open
        source={source}
        state={createDefaultOnboardingState()}
      />,
    );

    const stage = document.querySelector<HTMLElement>('.onboarding-preview-stage');
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(stage).toHaveAttribute('data-preview-initial-target', target);
    expect(stage).toHaveAttribute('data-preview-device', 'phone');
    expect(stage?.style.getPropertyValue('--preview-target-width')).toBe('390px');
  });

  it('accepts an explicit target override through the root wiring seam', () => {
    render(
      <SetupPreviewOverlay
        document={null}
        initialTarget="top"
        onClose={vi.fn()}
        onContinue={vi.fn()}
        open
        source="about"
        state={createDefaultOnboardingState()}
      />,
    );

    expect(document.querySelector('.onboarding-preview-stage'))
      .toHaveAttribute('data-preview-initial-target', 'top');
  });
});
