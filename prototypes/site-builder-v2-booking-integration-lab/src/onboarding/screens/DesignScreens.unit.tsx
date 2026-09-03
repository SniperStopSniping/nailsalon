import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { initializeStarter } from '../../model';
import { createDanielaFixtureState } from '../fixtures';
import { SITE_PALETTE_BY_ID } from '../model/palettes';
import type { OnboardingLabState } from '../model/types';
import { ONBOARDING_STYLE_ROLES } from '../preview/OnboardingSitePreview';
import { QuickBookLayoutScreen } from './DesignScreens';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

describe('QuickBookLayoutScreen', () => {
  it('offers six data-preserving layouts and updates the canonical live preview', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onFullPreview = vi.fn();
    const siteDocument = initializeStarter('quick_book');

    function Harness() {
      const [state, setState] = useState<OnboardingLabState>(() => {
        const fixture = createDanielaFixtureState();
        return {
          ...fixture,
          recipe: {
            ...fixture.recipe,
            quickBookLayout: 'compact_dropdown',
            starter: 'quick_book',
          },
        };
      });

      return (
        <QuickBookLayoutScreen
          document={siteDocument}
          onBack={vi.fn()}
          onContinue={onContinue}
          onFullPreview={onFullPreview}
          onUpdate={(update) => setState((current) => update(current))}
          state={state}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole('heading', { name: 'Choose your Quick Book layout' }))
      .toBeVisible();
    const layoutGroup = screen.getByRole('group', { name: 'Quick Book layouts' });
    expect(layoutGroup.querySelectorAll('button')).toHaveLength(6);
    const posters = layoutGroup.querySelectorAll<HTMLElement>(
      '.onboarding-quick-book-layout-poster',
    );
    expect(posters).toHaveLength(6);
    for (const poster of posters) {
      expect(poster.style.getPropertyValue('--quick-book-poster-ground')).toBe(
        SITE_PALETTE_BY_ID.blush_cocoa.roles.ground,
      );
      expect(poster.style.getPropertyValue('--quick-book-poster-heading-font')).toBe(
        ONBOARDING_STYLE_ROLES.soft.headingFont,
      );
    }
    expect(screen.getByRole('button', { name: /Compact Dropdown/u }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('[data-quick-book-layout="compact_dropdown"]'))
      .toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Editorial/u }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Editorial/u }))
        .toHaveAttribute('aria-pressed', 'true');
      expect(document.querySelector('[data-quick-book-layout="editorial"]'))
        .toBeInTheDocument();
    });
    expect(screen.getAllByText('Isla Nail Studio').length).toBeGreaterThan(0);
    expect(screen.getByText('Editorial selected')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'View full preview' }));
    expect(onFullPreview).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Use this layout' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
