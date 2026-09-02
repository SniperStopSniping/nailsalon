import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { createDefaultBusinessProfile } from '../model/defaults';
import type { BusinessProfileDraft, StarterId } from '../model/types';
import { StartingPreviewScreen } from './BookingScreens';

const renderStartingPreview = ({
  profile = createDefaultBusinessProfile(),
  starter = 'quick_book',
  onContinue = vi.fn(),
  onOpenPreview = vi.fn(),
}: {
  profile?: BusinessProfileDraft;
  starter?: StarterId;
  onContinue?: () => void;
  onOpenPreview?: () => void;
} = {}) => render(
  <StartingPreviewScreen
    onBack={vi.fn()}
    onContinue={onContinue}
    onOpenPreview={onOpenPreview}
    preview={<div>Personalized website preview</div>}
    profile={profile}
    starter={starter}
  />,
);

describe('StartingPreviewScreen', () => {
  it('is a preview-only payoff screen with no profile questions', () => {
    const profile = createDefaultBusinessProfile();
    profile.businessName = 'Isla Nail Studio';
    profile.siteSlug = 'isla-nail-studio';

    renderStartingPreview({ profile });

    expect(screen.getByRole('heading', { name: 'Your starting site is ready' })).toBeVisible();
    expect(screen.getByText('Quick Book')).toBeVisible();
    expect(screen.getByText('Isla Nail Studio')).toBeVisible();
    expect(screen.getByText('lustergel.app/isla-nail-studio')).toBeVisible();
    expect(screen.getByText('Personalized website preview')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose what clients see')).not.toBeInTheDocument();
  });

  it('keeps the continue and full-preview actions available', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onOpenPreview = vi.fn();
    renderStartingPreview({ onContinue, onOpenPreview });

    await user.click(screen.getByRole('button', { name: 'Continue setting up my site' }));
    expect(onContinue).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Preview my site' }));
    expect(onOpenPreview).toHaveBeenCalledOnce();
  });

  it.each([
    ['quick_book', 'Quick Book'],
    ['one_page', 'One-page website'],
    ['multi_page', 'Multi-page website'],
  ] as const)('labels the selected %s starter without starter-specific questions', (
    starter,
    label,
  ) => {
    renderStartingPreview({ starter });

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
