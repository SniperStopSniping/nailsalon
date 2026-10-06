import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';
import { initializeStarter } from '../../model';
import { createDanielaFixtureState } from '../fixtures';
import { SITE_PALETTE_BY_ID } from '../model/palettes';
import type { OnboardingLabState } from '../model/types';
import { QUICK_BOOK_MEDIA_LAYOUTS } from '../quick-book/media-layouts';
import { QuickBookLayoutScreen } from './DesignScreens';
vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({ useCustomDesignAssetMap: () => new Map() }));
describe('QuickBookLayoutScreen media catalog', () => {
  it('offers all 24 designs with actual data and preserves saved choices and media', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onFullPreview = vi.fn();
    const fixture = createDanielaFixtureState();
    let latest = fixture;
    function Harness() {
      const [state, setState] = useState<OnboardingLabState>(fixture);
      latest = state;
      return <QuickBookLayoutScreen document={initializeStarter('quick_book')} onBack={vi.fn()} onContinue={onContinue} onFullPreview={onFullPreview} onUpdate={update => setState(current => update(current))} state={state} />;
    }
    const view = render(<Harness />);
    const group = screen.getByRole('group', { name: 'Quick Book layouts' });
    expect(group.querySelectorAll('[data-media-group]')).toHaveLength(8);
    for (const layout of QUICK_BOOK_MEDIA_LAYOUTS) expect(group.querySelector(`[data-testid="quick-book-layout-poster-${layout.id}"]`)).toBeInTheDocument();
    expect(group.querySelectorAll('button:has(.qb-poster)')).toHaveLength(25);
    expect(screen.getByRole('button', { name: /^Compact Dropdown/u })).toHaveAttribute('aria-pressed', 'true');
    for (const poster of group.querySelectorAll<HTMLElement>('.qb-poster')) expect(poster.style.getPropertyValue('--qb-ground')).toBe(SITE_PALETTE_BY_ID.blush_cocoa.roles.ground);
    await user.click(screen.getByRole('button', { name: /^Type Editorial/u }));
    expect(onFullPreview).toHaveBeenCalledOnce();
    expect(latest.recipe.quickBookLayout).toBe('text_editorial');
    expect(latest.profile).toEqual(fixture.profile);
    expect(group.querySelectorAll('button:has(.qb-poster)')).toHaveLength(24);
    expect(screen.queryByRole('button', { name: /^Compact Dropdown/u })).not.toBeInTheDocument();
    await user.click(view.container.querySelector('[data-media-group="cover"] > summary')!);
    await user.click(screen.getByRole('button', { name: /^Photo Split/u }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Photo Split/u })).toHaveAttribute('aria-pressed', 'true'));
    expect(latest.profile.profilePhoto).toEqual(fixture.profile.profilePhoto);
    expect(screen.getAllByText('Isla Nail Studio').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Hub Menu/u })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview selected layout' }));
    expect(onFullPreview).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole('button', { name: 'Use this layout' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
