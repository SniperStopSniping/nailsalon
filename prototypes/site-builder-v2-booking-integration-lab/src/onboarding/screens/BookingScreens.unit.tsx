import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { createDefaultBusinessProfile } from '../model/defaults';
import { ONBOARDING_NEXT_AVAILABILITY_LABEL } from '../model/booking-preview';
import type { BookingPreferencesDraft, StarterId } from '../model/types';
import {
  BookingPreferencesScreen,
  StartingPointScreen,
  StartingPreviewScreen,
} from './BookingScreens';

describe('BookingPreferencesScreen', () => {
  it('validates only its two essentials and reads the canonical Booking source', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();

    function Harness() {
      const [profile, setProfile] = useState(createDefaultBusinessProfile);
      const patchPreferences = (patch: Partial<BookingPreferencesDraft>) => {
        setProfile((current) => ({
          ...current,
          bookingPreferences: { ...current.bookingPreferences, ...patch },
        }));
      };
      return (
        <BookingPreferencesScreen
          profile={profile}
          onBack={vi.fn()}
          onBookingPreferencesChange={patchPreferences}
          onContinue={onContinue}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByRole('complementary', { name: 'Booking connection status' }))
      .toHaveTextContent('24 connected');
    expect(screen.getByText(/won’t need to re-enter services, prices, or durations/i)).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Customer booking information preview' }))
      .toHaveTextContent('Russian Manicure + French1 hr 45 min · From $80');
    expect(screen.getByText(ONBOARDING_NEXT_AVAILABILITY_LABEL)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save booking information' }));
    expect(screen.getByText('Choose how clients can visit you.')).toBeVisible();
    expect(screen.getByText('Choose your new-client status.')).toBeVisible();

    await user.click(screen.getByRole('radio', { name: 'Appointment only' }));
    await user.click(within(screen.getByRole('group', { name: 'Accepting new clients' }))
      .getByRole('radio', { name: 'Yes' }));
    expect(screen.getByRole('complementary', { name: 'Customer booking information preview' }))
      .toHaveTextContent('Appointment onlyNew clients welcome');
    await user.click(screen.getByRole('button', { name: 'Save booking information' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});

describe('StartingPointScreen', () => {
  it('offers exactly the three universal Builder starters with canonical copy', async () => {
    const user = userEvent.setup();
    const onChooseStarter = vi.fn<(starter: StarterId) => void>();
    render(
      <StartingPointScreen
        businessName="Isla Nail Studio"
        onBack={vi.fn()}
        onChooseStarter={onChooseStarter}
        portraitUrl="data:image/jpeg;base64,portrait"
        selectedStarter={null}
      />,
    );

    const cards = screen.getAllByRole('button', { name: /Start with/ });
    expect(cards).toHaveLength(3);
    expect(screen.getByText('Salon intro · Services · Booking')).toBeVisible();
    expect(screen.getByText('Welcome · About · Services · Gallery · Reviews · Booking')).toBeVisible();
    expect(screen.getByText('Home · Services & Booking · Gallery · About · Contact')).toBeVisible();
    expect(screen.getAllByText('Isla Nail Studio')).toHaveLength(3);
    const portraits = document.querySelectorAll('.final-starter-preview__portrait');
    expect(portraits).toHaveLength(3);
    for (const portrait of portraits) {
      expect(portrait).toHaveAttribute('src', 'data:image/jpeg;base64,portrait');
    }
    expect(screen.queryByText(/custom design/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Start with One-page/ }));
    expect(onChooseStarter).toHaveBeenCalledWith('one_page');
  });

  it('keeps all starter previews on static posters for the reduced-motion fixture', async () => {
    const user = userEvent.setup();
    render(
      <StartingPointScreen
        businessName="Isla Nail Studio"
        onBack={vi.fn()}
        onChooseStarter={vi.fn()}
        reducedMotion
        selectedStarter={null}
      />,
    );

    await user.tab();
    const previews = screen.getAllByTestId(/starter-preview-/u);
    expect(previews).toHaveLength(3);
    for (const preview of previews) {
      expect(preview).toHaveAttribute('data-preview-active', 'false');
      expect(preview).toHaveAttribute('data-preview-state', 'poster');
    }
  });
});

describe('StartingPreviewScreen', () => {
  it('keeps Preview and setup available without exposing Builder or an offer', async () => {
    const user = userEvent.setup();
    const onOpenPreview = vi.fn();
    const onContinue = vi.fn();
    const profile = createDefaultBusinessProfile();
    profile.businessName = 'Isla Nail Studio';
    profile.location.cityOrArea = 'Scarborough, Ontario';

    render(
      <StartingPreviewScreen
        preview={<div>Personalized customer site</div>}
        profile={profile}
        starter="one_page"
        onBack={vi.fn()}
        onContinue={onContinue}
        onOpenPreview={onOpenPreview}
      />,
    );

    expect(screen.getByRole('region', { name: 'Isla Nail Studio starting website preview' }))
      .toHaveTextContent('Personalized customer site');
    expect(screen.queryByRole('button', { name: /open my builder/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/lifetime access/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /customize my site/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Preview my site' }));
    await user.click(screen.getByRole('button', { name: 'Continue setting up my site' }));
    expect(onOpenPreview).toHaveBeenCalledOnce();
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
