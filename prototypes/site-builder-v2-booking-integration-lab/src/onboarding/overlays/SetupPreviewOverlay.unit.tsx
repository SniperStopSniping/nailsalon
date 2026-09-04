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

  it('keeps the preview and its return actions in one bounded dialog viewport', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/onboarding/onboarding.css'),
      'utf8',
    );

    expect(css).toMatch(
      /\.dialog-panel--sheet:has\(\.onboarding-preview-overlay\) \{[^}]*height: min\(900px, calc\(100dvh - 16px\)\);/u,
    );
    expect(css).toMatch(
      /\.dialog-panel:has\(\.onboarding-preview-overlay\) \.dialog-body \{[^}]*display: flex;[^}]*flex: 1 1 auto;[^}]*overflow: hidden;/u,
    );
    expect(css).toMatch(
      /\.onboarding-preview-overlay \{[^}]*height: 100%;[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto;/u,
    );
    expect(css).toMatch(
      /\.onboarding-preview-overlay \.onboarding-preview-stage \{[^}]*height: 100%/u,
    );
    expect(css).toMatch(
      /\.onboarding-preview-overlay \.onboarding-preview-measurement-host \{[^}]*height: 100%/u,
    );
    expect(css).toMatch(
      /\.onboarding-overlay-actions \{[^}]*position: relative;[^}]*z-index: 2;[^}]*background: #e8e2df;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 479px\) \{[\s\S]*?\.dialog-panel--sheet:has\(\.onboarding-preview-overlay\) \{[^}]*height: min\(760px, 90dvh\);[^}]*max-height: 90dvh;/u,
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
