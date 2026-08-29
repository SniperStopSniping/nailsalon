import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { createDefaultBusinessProfile } from '../model/defaults';
import {
  getDepositPolicyMode,
} from '../model/policies';
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
          onDepositChange={(deposit) => setProfile((current) => ({
            ...current,
            policies: { ...current.policies, deposits: deposit },
          }))}
          onServiceMenuChange={(serviceMenu) => setProfile((current) => ({
            ...current,
            serviceMenu,
          }))}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByRole('complementary', { name: 'Booking connection status' }))
      .toHaveTextContent('Services6 selected');
    expect(screen.getByRole('complementary', { name: 'Booking connection status' }))
      .toHaveTextContent('Minimum notice2 hours');
    expect(screen.queryByText(/Booking mock/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Availability sourceConnected/u)).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Customer booking information preview' }))
      .toHaveTextContent('Russian Manicure1 hr 30 min · From $65');
    expect(screen.queryByText(/Tomorrow at 10:30 AM/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save booking setup' }));
    expect(screen.getAllByText('Choose how clients can visit you.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Choose your new-client status.').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('radio', { name: 'Appointment only' }));
    await user.click(within(screen.getByRole('group', { name: 'Are you accepting new clients?' }))
      .getByRole('radio', { name: 'Yes' }));
    expect(screen.getByRole('complementary', { name: 'Customer booking information preview' }))
      .toHaveTextContent('Appointment onlyNew clients welcome');
    await user.click(screen.getByRole('button', { name: 'Save booking setup' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('stores one fixed deposit amount in the shared policy draft', async () => {
    const user = userEvent.setup();
    let latest = createDefaultBusinessProfile();
    const originalBookingPreferences = latest.bookingPreferences;

    function Harness() {
      const [profile, setProfile] = useState(latest);
      return (
        <BookingPreferencesScreen
          profile={profile}
          onBack={vi.fn()}
          onBookingPreferencesChange={(patch) => setProfile((current) => {
            latest = {
              ...current,
              bookingPreferences: { ...current.bookingPreferences, ...patch },
            };
            return latest;
          })}
          onContinue={vi.fn()}
          onDepositChange={(deposit) => setProfile((current) => {
            latest = {
              ...current,
              policies: { ...current.policies, deposits: deposit },
            };
            return latest;
          })}
          onServiceMenuChange={vi.fn()}
        />
      );
    }

    render(<Harness />);
    const depositQuestion = screen.getByRole('group', {
      name: 'How do you handle booking deposits?',
    });
    await user.click(within(depositQuestion).getByRole('radio', {
      name: 'Same deposit for every service',
    }));
    await user.click(within(screen.getByRole('group', { name: 'Deposit amount' }))
      .getByRole('radio', { name: '$25' }));

    expect(getDepositPolicyMode(latest.policies)).toBe('fixed');
    expect(latest.policies.deposits.amountCents).toBe(2_500);
    expect(latest.bookingPreferences).toBe(originalBookingPreferences);
    expect(screen.queryByText(/depends on the service/i)).not.toBeInTheDocument();
  });

  it('removes and adds existing canonical services through the Library port', async () => {
    const user = userEvent.setup();
    let latest = createDefaultBusinessProfile();

    function Harness() {
      const [profile, setProfile] = useState(latest);
      return (
        <BookingPreferencesScreen
          profile={profile}
          onBack={vi.fn()}
          onBookingPreferencesChange={vi.fn()}
          onContinue={vi.fn()}
          onDepositChange={vi.fn()}
          onServiceMenuChange={(serviceMenu) => setProfile((current) => {
            latest = { ...current, serviceMenu };
            return latest;
          })}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Review services' }));
    let library = screen.getByRole('dialog', { name: 'Choose your services' });
    expect(within(library).queryByText('French')).not.toBeInTheDocument();
    expect(within(library).getByText('6 services selected')).toBeVisible();
    expect(within(library).getByRole('button', { name: 'Done' })).toBeVisible();
    const russianItem = within(library).getByText('Russian Manicure').closest('li');
    expect(russianItem).not.toBeNull();
    await user.click(within(russianItem!).getByRole('button', { name: 'Remove Russian Manicure' }));
    expect(latest.serviceMenu.selectedServiceIds).not.toContain('svc-manicure-russian');
    library = screen.getByRole('dialog', { name: 'Choose your services' });
    const updatedRussianItem = within(library).getByText('Russian Manicure').closest('li');
    expect(updatedRussianItem).not.toBeNull();
    expect(within(updatedRussianItem!).getByRole('button', { name: 'Add Russian Manicure' })).toBeVisible();
    expect(within(library).getByText('Classic Manicure')).toBeVisible();
    const classicItem = within(library).getByText('Classic Manicure').closest('li');
    expect(classicItem).not.toBeNull();
    expect(classicItem).toHaveTextContent('Manicure · 45 min$35');
    await user.click(within(classicItem!).getByRole('button', { name: 'Add Classic Manicure' }));
    expect(latest.serviceMenu.selectedServiceIds).toContain('svc-manicure-classic');

    await user.click(within(library).getByRole('tab', { name: 'Add-ons' }));
    expect(within(library).getByText('French')).toBeVisible();
    expect(within(library).queryByText('Russian Manicure')).not.toBeInTheDocument();
  });

  it('normalizes notice presets and custom day amounts to minutes', async () => {
    const user = userEvent.setup();
    let latest = createDefaultBusinessProfile();

    function Harness() {
      const [profile, setProfile] = useState(latest);
      return (
        <BookingPreferencesScreen
          profile={profile}
          onBack={vi.fn()}
          onBookingPreferencesChange={(patch) => setProfile((current) => {
            latest = {
              ...current,
              bookingPreferences: { ...current.bookingPreferences, ...patch },
            };
            return latest;
          })}
          onContinue={vi.fn()}
          onDepositChange={vi.fn()}
          onServiceMenuChange={vi.fn()}
        />
      );
    }

    render(<Harness />);
    await user.selectOptions(screen.getByRole('combobox', {
      name: 'How much notice do you need before an appointment?',
    }), 'preset:720');
    expect(latest.bookingPreferences.minimumNoticeMinutes).toBe(720);

    await user.selectOptions(screen.getByRole('combobox', {
      name: 'How much notice do you need before an appointment?',
    }), 'custom');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Unit' }), 'days');
    await user.clear(screen.getByRole('spinbutton', { name: 'Custom amount' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Custom amount' }), '5');
    expect(latest.bookingPreferences.minimumNoticeMinutes).toBe(7_200);

  });

  it('changes the displayed bookable appointment times when minimum notice changes', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [profile, setProfile] = useState(createDefaultBusinessProfile);
      return (
        <BookingPreferencesScreen
          onBack={vi.fn()}
          onBookingPreferencesChange={(patch) => setProfile((current) => ({
            ...current,
            bookingPreferences: { ...current.bookingPreferences, ...patch },
          }))}
          onContinue={vi.fn()}
          onDepositChange={vi.fn()}
          onServiceMenuChange={vi.fn()}
          previewTimestamp="2026-08-27T18:30:00.000Z"
          profile={profile}
        />
      );
    }

    render(<Harness />);
    const notice = screen.getByRole('combobox', {
      name: 'How much notice do you need before an appointment?',
    });
    expect(document.querySelector('[data-bookable-time="2026-08-27T19:30:00.000Z"]'))
      .toBeNull();
    expect(document.querySelector('[data-bookable-time="2026-08-27T22:00:00.000Z"]'))
      .not.toBeNull();

    await user.selectOptions(notice, 'preset:0');
    expect(document.querySelector('[data-bookable-time="2026-08-27T19:30:00.000Z"]'))
      .not.toBeNull();

    await user.selectOptions(notice, 'preset:4320');
    expect(document.querySelector('[data-bookable-time="2026-08-30T19:30:00.000Z"]'))
      .not.toBeNull();
    expect(screen.getByRole('complementary', { name: 'Booking connection status' }))
      .toHaveTextContent(/Earliest bookable time.*Sun, Aug 30 · 3:30 p\.m\./u);
  });

  it('blocks blank custom notice and deposit values, focuses the first error, and preserves valid state', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    let latest = createDefaultBusinessProfile();
    latest.bookingPreferences.visitMode = 'appointment_only';
    latest.bookingPreferences.newClientStatus = 'yes';

    function Harness() {
      const [profile, setProfile] = useState(latest);
      return (
        <BookingPreferencesScreen
          profile={profile}
          onBack={vi.fn()}
          onBookingPreferencesChange={(patch) => setProfile((current) => {
            latest = {
              ...current,
              bookingPreferences: { ...current.bookingPreferences, ...patch },
            };
            return latest;
          })}
          onContinue={onContinue}
          onDepositChange={(deposit) => setProfile((current) => {
            latest = {
              ...current,
              policies: { ...current.policies, deposits: deposit },
            };
            return latest;
          })}
          onServiceMenuChange={vi.fn()}
        />
      );
    }

    render(<Harness />);
    await user.selectOptions(screen.getByRole('combobox', {
      name: 'How much notice do you need before an appointment?',
    }), 'custom');
    const notice = screen.getByRole('spinbutton', { name: 'Custom amount' });
    await user.clear(notice);
    await user.click(screen.getByRole('radio', { name: 'Same deposit for every service' }));
    await user.click(within(screen.getByRole('group', { name: 'Deposit amount' }))
      .getByRole('radio', { name: 'Custom amount' }));
    const deposit = screen.getByRole('spinbutton', { name: 'Custom deposit amount' });
    await user.clear(deposit);

    await user.click(screen.getByRole('button', { name: 'Save booking setup' }));

    expect(screen.getByRole('alert')).toHaveTextContent('2 answers need attention');
    expect(screen.getAllByText('Enter a custom notice amount greater than zero.'))
      .toHaveLength(2);
    expect(screen.getAllByText('Enter a custom deposit amount greater than zero.'))
      .toHaveLength(2);
    await waitFor(() => expect(notice).toHaveFocus());
    expect(latest.bookingPreferences.minimumNoticeMinutes).toBe(120);
    expect(latest.policies.deposits.amountCents).toBe(2_000);
    expect(onContinue).not.toHaveBeenCalled();

    await user.type(notice, '6');
    await user.type(deposit, '35.5');
    expect(latest.bookingPreferences.minimumNoticeMinutes).toBe(360);
    expect(latest.policies.deposits.amountCents).toBe(3_550);
    await user.click(screen.getByRole('button', { name: 'Save booking setup' }));
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
    expect(screen.getAllByText('Isla Nail Studio').length).toBeGreaterThanOrEqual(3);
    const portraits = document.querySelectorAll('.final-starter-preview__portrait');
    expect(portraits).toHaveLength(3);
    for (const portrait of portraits) {
      expect(portrait).toHaveAttribute('src', 'data:image/jpeg;base64,portrait');
    }
    expect(screen.queryByText(/custom design/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Start with One-page/ }));
    expect(onChooseStarter).toHaveBeenCalledWith('one_page');
  });

  it('uses the shared public-location resolver and never leaks an after-booking address', () => {
    const profile = createDefaultBusinessProfile();
    profile.businessName = 'Mia’s Nail Studio';
    profile.ownerName = 'Mia Torres';
    profile.location = {
      ...profile.location,
      addressVisibility: 'after_booking',
      cityOrArea: 'Hamilton, Ontario',
      exactAddress: '91 Private Lane',
    };

    render(
      <StartingPointScreen
        businessName={profile.businessName}
        location={profile.location}
        onBack={vi.fn()}
        onChooseStarter={vi.fn()}
        ownerName={profile.ownerName}
        selectedStarter={null}
      />,
    );

    for (const preview of screen.getAllByTestId(/starter-preview-/u)) {
      expect(preview).toHaveTextContent('Mia’s Nail Studio');
      expect(preview).toHaveTextContent('Mia Torres');
      expect(preview).toHaveTextContent('Hamilton, Ontario');
      expect(preview).not.toHaveTextContent('91 Private Lane');
      expect(preview).not.toHaveTextContent('Toronto');
    }
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

  it('marks the current starter visibly and exposes pressed state to assistive technology', () => {
    render(
      <StartingPointScreen
        businessName="Isla Nail Studio"
        onBack={vi.fn()}
        onChooseStarter={vi.fn()}
        selectedStarter="one_page"
      />,
    );

    const current = screen.getByRole('button', {
      name: /Current starting point.*One-page website/u,
    });
    expect(current).toHaveAttribute('aria-pressed', 'true');
    expect(current).toHaveAttribute('data-selected', 'true');
    expect(within(current).getByText('Current starting point')).toBeVisible();
    expect(within(current).getByText('Continue with this starting point')).toBeVisible();

    const quickBook = screen.getByRole('button', { name: /Switch to Quick Book/u });
    expect(quickBook).toHaveAttribute('aria-pressed', 'false');
    expect(quickBook).toHaveAttribute('data-selected', 'false');
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
