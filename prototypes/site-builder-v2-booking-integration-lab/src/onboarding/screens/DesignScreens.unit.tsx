import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { initializeStarter } from '../../model';
import { createDanielaFixtureState } from '../fixtures';
import { SITE_PALETTE_BY_ID } from '../model/palettes';
import type { OnboardingLabState } from '../model/types';
import { ONBOARDING_STYLE_ROLES } from '../preview/OnboardingSitePreview';
import { QUICK_BOOK_LAYOUTS } from '../quick-book/layouts';
import { QuickBookLayoutScreen } from './DesignScreens';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

describe('QuickBookLayoutScreen', () => {
  it('offers every registered data-preserving layout and updates the canonical live preview', async () => {
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
          onUpdate={update => setState(current => update(current))}
          state={state}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole('heading', { name: 'Choose your Quick Book layout' }))
      .toBeVisible();

    const layoutGroup = screen.getByRole('group', { name: 'Quick Book layouts' });

    expect(layoutGroup.querySelectorAll('button')).toHaveLength(QUICK_BOOK_LAYOUTS.length);
    expect(layoutGroup.querySelectorAll('[data-layout-family]')).toHaveLength(3);

    const posters = layoutGroup.querySelectorAll<HTMLElement>('.qb-poster');

    expect(posters).toHaveLength(QUICK_BOOK_LAYOUTS.length);

    for (const poster of posters) {
      expect(poster.style.getPropertyValue('--qb-ground')).toBe(
        SITE_PALETTE_BY_ID.blush_cocoa.roles.ground,
      );
      expect(poster.style.getPropertyValue('--qb-heading-font')).toBe(
        ONBOARDING_STYLE_ROLES.soft.headingFont,
      );
    }

    // Composition-essential slots always keep their image area: the fixture's
    // own portrait when it is shown, the default illustration otherwise. A
    // cover has no onboarding upload yet, so cover layouts show the default.
    expect(layoutGroup.querySelector('.qb-poster[data-qb-layout="side_portrait"] .qb-poster__portrait'))
      .toHaveAttribute('data-qb-image', expect.stringMatching(/^(?:custom|default)$/u));
    expect(layoutGroup.querySelector('.qb-poster[data-qb-layout="hero_banner"] .qb-poster__cover'))
      .toHaveAttribute('data-qb-image', 'default');
    expect(screen.getByRole('button', { name: /^Compact Dropdown/u }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('[data-quick-book-layout="compact_dropdown"]'))
      .toBeInTheDocument();

    // A layout without a default image area shows no default note…
    expect(screen.queryByTestId('quick-book-layout-default-note')).not.toBeInTheDocument();

    // …and a cover layout explains the default cover before it is chosen for good.
    await user.click(screen.getByRole('button', { name: /^Hero Banner/u }));

    await waitFor(() => {
      expect(screen.getByTestId('quick-book-layout-default-note')).toHaveTextContent(/default cover/u);
      expect(document.querySelector('[data-quick-book-layout="hero_banner"] .qb-cover[data-qb-image="default"]'))
        .toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^Editorial Elegant/u }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Editorial Elegant/u }))
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
