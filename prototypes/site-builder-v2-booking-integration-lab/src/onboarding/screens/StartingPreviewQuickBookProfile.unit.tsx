import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { createDefaultBusinessProfile } from '../model/defaults';
import { QUICK_BOOK_SHORT_BIO_MAX_LENGTH } from '../model/quick-book-profile';
import {
  type BusinessProfileDraft,
  DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY,
  type QuickBookProfileVisibilityDraft,
  type StarterId,
} from '../model/types';
import { StartingPreviewScreen } from './BookingScreens';

const renderStartingPreview = ({
  profile = createDefaultBusinessProfile(),
  quickBookProfile = { ...DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY },
  starter = 'quick_book',
  onQuickBookBioChange = vi.fn(),
  onQuickBookProfileChange = vi.fn(),
}: {
  profile?: BusinessProfileDraft;
  quickBookProfile?: QuickBookProfileVisibilityDraft;
  starter?: StarterId;
  onQuickBookBioChange?: (value: string) => void;
  onQuickBookProfileChange?: (patch: Partial<QuickBookProfileVisibilityDraft>) => void;
} = {}) => render(
  <StartingPreviewScreen
    onBack={vi.fn()}
    onContinue={vi.fn()}
    onOpenPreview={vi.fn()}
    onQuickBookBioChange={onQuickBookBioChange}
    onQuickBookProfileChange={onQuickBookProfileChange}
    preview={<div>Live Quick Book preview</div>}
    profile={profile}
    quickBookProfile={quickBookProfile}
    starter={starter}
  />,
);

describe('StartingPreviewScreen Quick Book profile settings', () => {
  it('shows Quick Book-only presentation switches and emits narrow visibility patches', async () => {
    const user = userEvent.setup();
    const onQuickBookProfileChange = vi.fn();
    renderStartingPreview({ onQuickBookProfileChange });

    expect(screen.getByRole('heading', { name: 'Choose what clients see' })).toBeVisible();
    expect(screen.getByText(/switches change only Quick Book/u)).toBeVisible();

    const switches = [
      ['Show nail tech name', 'showTechName'],
      ['Show nail tech photo', 'showTechPhoto'],
      ['Show location', 'showLocation'],
      ['Show business hours', 'showHours'],
      ['Show phone', 'showPhone'],
      ['Show email', 'showEmail'],
      ['Show Instagram / work', 'showInstagram'],
      ['Show booking policy', 'showBookingPolicy'],
      ['Show cancellation policy', 'showCancellationPolicy'],
      ['Show reviews', 'showReviews'],
      ['Show short bio', 'showBio'],
    ] as const satisfies ReadonlyArray<readonly [string, keyof QuickBookProfileVisibilityDraft]>;

    for (const [label, key] of switches) {
      const control = screen.getByRole('switch', { name: label });

      expect(control).not.toBeChecked();

      await user.click(control);

      expect(onQuickBookProfileChange).toHaveBeenLastCalledWith({ [key]: true });
    }

    expect(onQuickBookProfileChange).toHaveBeenCalledTimes(switches.length);
  });

  it('keeps reviews configurable without inventing a rating when no real reviews exist', async () => {
    const user = userEvent.setup();
    const onQuickBookProfileChange = vi.fn();
    renderStartingPreview({ onQuickBookProfileChange });

    const reviews = screen.getByRole('switch', { name: 'Show reviews' });

    expect(reviews).toBeEnabled();
    expect(reviews).toHaveAccessibleDescription(
      'Appears after saving only when verified review data is connected. Luster never invents a rating.',
    );
    expect(screen.queryByText(/5\.0/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/128/u)).not.toBeInTheDocument();

    await user.click(reviews);

    expect(onQuickBookProfileChange).toHaveBeenCalledWith({ showReviews: true });
  });

  it('reveals the shared short-bio editor, enforces its limit, and updates the live count', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [profile, setProfile] = useState(() => {
        const next = createDefaultBusinessProfile();
        next.about.shortBio = 'A'.repeat(QUICK_BOOK_SHORT_BIO_MAX_LENGTH - 1);
        return next;
      });
      const [visibility, setVisibility] = useState<QuickBookProfileVisibilityDraft>({
        ...DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY,
      });
      return (
        <StartingPreviewScreen
          onBack={vi.fn()}
          onContinue={vi.fn()}
          onOpenPreview={vi.fn()}
          onQuickBookBioChange={value => setProfile(current => ({
            ...current,
            about: { ...current.about, shortBio: value },
          }))}
          onQuickBookProfileChange={patch => setVisibility(current => ({
            ...current,
            ...patch,
          }))}
          preview={<div>Live Quick Book preview</div>}
          profile={profile}
          quickBookProfile={visibility}
          starter="quick_book"
        />
      );
    }

    render(<Harness />);

    expect(screen.queryByRole('textbox', { name: 'Short salon or nail tech bio' }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Show short bio' }));
    const bio = screen.getByRole('textbox', { name: 'Short salon or nail tech bio' });

    expect(bio).toHaveAttribute('maxlength', String(QUICK_BOOK_SHORT_BIO_MAX_LENGTH));
    expect(screen.getByText('179/180 characters')).toBeVisible();

    await user.type(bio, 'BC');

    expect(bio).toHaveValue(`${'A'.repeat(179)}B`);
    expect(screen.getByText('180/180 characters')).toBeVisible();
  });

  it.each(['one_page', 'multi_page'] as const)(
    'does not expose Quick Book presentation controls for the %s starter',
    (starter) => {
      renderStartingPreview({ starter });

      expect(screen.queryByRole('heading', { name: 'Choose what clients see' }))
        .not.toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: 'Show phone' })).not.toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: 'Show short bio' })).not.toBeInTheDocument();
      expect(screen.getByText('Live Quick Book preview')).toBeVisible();
    },
  );
});
