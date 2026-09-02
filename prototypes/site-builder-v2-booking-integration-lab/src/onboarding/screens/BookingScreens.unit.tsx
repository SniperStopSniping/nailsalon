import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { MOCK_ADD_ONS } from '../../booking/data';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
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
  it('shows a one-time, non-blocking service-menu celebration when the menu is confirmed', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [profile, setProfile] = useState(createDefaultBusinessProfile);
      return (
        <BookingPreferencesScreen
          profile={profile}
          onBack={vi.fn()}
          onBookingPreferencesChange={vi.fn()}
          onContinue={vi.fn()}
          onDepositChange={vi.fn()}
          onServiceMenuChange={(serviceMenu) => setProfile(current => ({
            ...current,
            serviceMenu,
          }))}
        />
      );
    }

    render(<FeedbackProvider testMode><Harness /></FeedbackProvider>);
    const confirmation = screen.getByRole('button', {
      name: 'Continue with these 6 services',
    });
    await user.click(confirmation);

    expect(document.querySelector('.onboarding-service-menu-card')).toHaveClass(
      'is-celebrating',
    );
    expect(document.querySelector('.onboarding-feedback')).toHaveTextContent(
      'Your service menu is ready. 6 services added.',
    );
    expect(confirmation).toBeEnabled();
  });

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
    expect(screen.getByRole('combobox', {
      name: 'How much notice do you need before an appointment?',
    })).toHaveAccessibleDescription(
      'Clients must book at least 2 hours before the appointment starts.',
    );
    expect(screen.queryByText('Booking cutoff')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Booking connection status' }))
      .toHaveTextContent('Clients must book at least 2 hours before the appointment starts.');
    expect(screen.queryByText(/Booking mock/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Availability sourceConnected/u)).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Customer booking information preview' }))
      .toHaveTextContent(
        'Minimum booking noticeBook at least 2 hours before your appointment.',
      );
    expect(screen.getByRole('complementary', { name: 'Customer booking information preview' }))
      .toHaveTextContent('Russian Manicure1 hr 30 min · From $65');
    expect(screen.queryByText('Available times after your notice')).not.toBeInTheDocument();
    expect(screen.queryByText('Earliest bookable time')).not.toBeInTheDocument();
    expect(document.querySelector('[data-bookable-time]')).toBeNull();
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

    render(<FeedbackProvider testMode><Harness /></FeedbackProvider>);
    expect(document.querySelector('.onboarding-service-menu-count'))
      .toHaveTextContent('4 add-ons ready');
    await user.click(screen.getByRole('button', { name: 'Review services & add-ons' }));
    let library = screen.getByRole('dialog', { name: 'Choose your services' });
    expect(within(library).queryByText('French')).not.toBeInTheDocument();
    expect(within(library).getByText('6 services selected')).toBeVisible();
    expect(within(library).getByRole('button', { name: 'Done' })).toBeVisible();
    const russianItem = within(library).getByText('Russian Manicure').closest('li');
    expect(russianItem).not.toBeNull();
    await user.click(within(russianItem!).getByRole('button', { name: 'Remove Russian Manicure' }));
    expect(latest.serviceMenu.selectedServiceIds).not.toContain('svc-manicure-russian');
    expect(document.querySelector('.onboarding-feedback')).toBeNull();
    await waitFor(() => expect(document.querySelector('.visually-hidden[role="status"]'))
      .toHaveTextContent('Russian Manicure removed.'));
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
    expect(document.querySelector('.onboarding-feedback')).toBeNull();
    await waitFor(() => expect(document.querySelector('.visually-hidden[role="status"]'))
      .toHaveTextContent('Classic Manicure added.'));

    await user.click(within(library).getByRole('tab', { name: 'Add-ons' }));
    expect(within(library).getByText('French')).toBeVisible();
    expect(within(library).queryByText('Russian Manicure')).not.toBeInTheDocument();
    expect(within(library).getByText('4 add-ons added')).toBeVisible();
    for (const addOn of MOCK_ADD_ONS) {
      const item = within(library).getByText(addOn.name).closest('li');
      expect(item).not.toBeNull();
      expect(within(item!).getByRole('button', { name: `Remove ${addOn.name}` }))
        .toBeVisible();
    }
  });

  it('keeps the category rail separate from results and reveals the selected category', async () => {
    const user = userEvent.setup();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      render(
        <BookingPreferencesScreen
          profile={createDefaultBusinessProfile()}
          onBack={vi.fn()}
          onBookingPreferencesChange={vi.fn()}
          onContinue={vi.fn()}
          onDepositChange={vi.fn()}
          onServiceMenuChange={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Review services & add-ons' }));
      const library = screen.getByRole('dialog', { name: 'Choose your services' });
      const categories = within(library).getByLabelText('Service categories');
      const servicesTab = within(library).getByRole('tab', { name: 'Services' });
      const addOnsTab = within(library).getByRole('tab', { name: 'Add-ons' });

      await waitFor(() => expect(within(library).getByRole('button', {
        name: 'Close Choose your services',
      })).toHaveFocus());
      servicesTab.focus();
      await user.keyboard('{ArrowRight}');
      await waitFor(() => expect(addOnsTab).toHaveFocus());
      expect(addOnsTab).toHaveAttribute('aria-selected', 'true');
      expect(within(library).getByRole('tabpanel')).toHaveAttribute(
        'aria-labelledby',
        'onboarding-service-library-tab-add-ons',
      );
      await user.keyboard('{ArrowLeft}');
      await waitFor(() => expect(servicesTab).toHaveFocus());
      expect(servicesTab).toHaveAttribute('aria-selected', 'true');

      expect(categories.parentElement).toHaveClass(
        'onboarding-service-library__category-rail',
      );
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      scrollIntoView.mockClear();
      await user.click(within(categories).getByRole('button', { name: 'Manicure' }));

      expect(within(categories).getByRole('button', { name: 'Manicure' }))
        .toHaveAttribute('aria-pressed', 'true');
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'auto',
        block: 'nearest',
        inline: 'nearest',
      }));

      await user.click(within(library).getByRole('tab', { name: 'Add-ons' }));
      const addOnCategories = within(library).getByLabelText('Add-on categories');
      expect(within(addOnCategories).getByRole('button', { name: 'All add-ons' }))
        .toHaveAttribute('aria-pressed', 'true');
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    }
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
    await user.clear(screen.getByRole('spinbutton', { name: 'Custom amount' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Custom amount' }), '3');
    expect(latest.bookingPreferences.minimumNoticeMinutes).toBe(180);
    expect(screen.getByRole('combobox', {
      name: 'How much notice do you need before an appointment?',
    })).toHaveAccessibleDescription(
      'Clients must book at least 3 hours before the appointment starts.',
    );
    expect(screen.queryByText('Booking cutoff')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Booking connection status' }))
      .toHaveTextContent('Clients must book at least 3 hours before the appointment starts.');
    expect(screen.getByRole('complementary', { name: 'Customer booking information preview' }))
      .toHaveTextContent('Book at least 3 hours before your appointment.');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Unit' }), 'days');
    await user.clear(screen.getByRole('spinbutton', { name: 'Custom amount' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Custom amount' }), '5');
    expect(latest.bookingPreferences.minimumNoticeMinutes).toBe(7_200);
    expect(screen.getByRole('combobox', {
      name: 'How much notice do you need before an appointment?',
    })).toHaveAccessibleDescription(
      'Clients must book at least 5 days before the appointment starts.',
    );
  });

  it.each([
    ['preset:0', 'No minimum notice', 'Clients can book without a minimum-notice requirement.', 'Clients can book without a minimum-notice requirement.'],
    ['preset:120', '2 hours', 'Clients must book at least 2 hours before the appointment starts.', 'Book at least 2 hours before your appointment.'],
    ['preset:240', '4 hours', 'Clients must book at least 4 hours before the appointment starts.', 'Book at least 4 hours before your appointment.'],
    ['preset:480', '8 hours', 'Clients must book at least 8 hours before the appointment starts.', 'Book at least 8 hours before your appointment.'],
    ['preset:720', '12 hours', 'Clients must book at least 12 hours before the appointment starts.', 'Book at least 12 hours before your appointment.'],
    ['preset:1440', '1 day', 'Clients must book at least 1 day before the appointment starts.', 'Book at least 1 day before your appointment.'],
    ['preset:2880', '2 days', 'Clients must book at least 2 days before the appointment starts.', 'Book at least 2 days before your appointment.'],
    ['preset:4320', '3 days', 'Clients must book at least 3 days before the appointment starts.', 'Book at least 3 days before your appointment.'],
  ])('renders %s as a cutoff without fabricated times', async (
    choice,
    label,
    helper,
    customer,
  ) => {
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
          profile={profile}
        />
      );
    }

    render(<Harness />);
    const notice = screen.getByRole('combobox', {
      name: 'How much notice do you need before an appointment?',
    });
    await user.selectOptions(notice, choice);

    expect(notice).toHaveDisplayValue(label);
    expect(notice).toHaveAccessibleDescription(helper);
    expect(screen.getByRole('complementary', { name: 'Booking connection status' }))
      .toHaveTextContent(`Minimum notice${label}`);
    expect(screen.queryByText('Booking cutoff')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Booking connection status' }))
      .toHaveTextContent(helper);
    expect(screen.getByRole('complementary', { name: 'Customer booking information preview' }))
      .toHaveTextContent(`Minimum booking notice${customer}`);
    expect(screen.queryByText('Available times after your notice')).not.toBeInTheDocument();
    expect(screen.queryByText('Earliest bookable time')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Bookable appointment times after minimum notice'))
      .not.toBeInTheDocument();
    expect(document.querySelector('[data-bookable-time]')).toBeNull();
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
        logoUrl="data:image/png;base64,logo"
        onBack={vi.fn()}
        onChooseStarter={onChooseStarter}
        selectedStarter={null}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Choose your starting point' })).toBeVisible();
    expect(screen.getByLabelText('Luster')).toBeVisible();
    expect(screen.getByText('Your progress saves automatically on this device.')).toBeVisible();
    expect(screen.getByText('You’ll preview your site before choosing a plan.')).toBeVisible();
    expect(screen.getByText('Nothing is permanent.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    const cards = screen.getAllByRole('button', { name: /Start with/ });
    expect(cards).toHaveLength(3);
    // Each card describes the exact locked customer recipe. Site-shell chrome
    // is automatic and therefore never appears in this content/page summary.
    expect(screen.getByText(
      'Salon intro · Nail work · Services & Booking · About · Visit & Contact',
    )).toBeVisible();
    expect(screen.getByText(
      'Welcome · Gallery · About · Services & Booking · Reviews · Before You Book · Visit & Contact',
    )).toBeVisible();
    expect(screen.getByText(
      'Home · Services & Booking · Gallery · About · Contact',
    )).toBeVisible();
    expect(screen.getAllByText('Isla Nail Studio').length).toBeGreaterThanOrEqual(3);
    const logos = document.querySelectorAll('.final-starter-preview__logo');
    expect(logos).toHaveLength(3);
    for (const logo of logos) {
      expect(logo).toHaveAttribute('data-media-role', 'logo');
      expect(logo).toHaveAttribute('src', 'data:image/png;base64,logo');
    }
    expect(screen.queryByText(/custom design/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Start with One-page/ }));
    await waitFor(() => expect(onChooseStarter).toHaveBeenCalledWith('one_page'));
  });

  it('plays one commit beat for a first choice and ignores double activation', async () => {
    const user = userEvent.setup();
    const onChooseStarter = vi.fn<(starter: StarterId) => void>();
    render(
      <StartingPointScreen
        businessName="Isla Nail Studio"
        onBack={vi.fn()}
        onChooseStarter={onChooseStarter}
        selectedStarter={null}
      />,
    );

    const onePage = screen.getByRole('button', { name: /Start with One-page/ });
    await user.click(onePage);
    expect(onePage).toHaveAttribute('data-committing', 'true');
    expect(onChooseStarter).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Start with Quick Book/ }));
    await waitFor(() => expect(onChooseStarter).toHaveBeenCalledWith('one_page'));
    expect(onChooseStarter).toHaveBeenCalledOnce();
  });

  it('commits immediately under reduced motion and for an already-selected starter', async () => {
    const user = userEvent.setup();
    const onChooseStarter = vi.fn<(starter: StarterId) => void>();
    const { rerender } = render(
      <StartingPointScreen
        businessName="Isla Nail Studio"
        onBack={vi.fn()}
        onChooseStarter={onChooseStarter}
        reducedMotion
        selectedStarter={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Start with Multi-page/ }));
    expect(onChooseStarter).toHaveBeenCalledWith('multi_page');

    onChooseStarter.mockClear();
    rerender(
      <StartingPointScreen
        businessName="Isla Nail Studio"
        onBack={vi.fn()}
        onChooseStarter={onChooseStarter}
        selectedStarter="multi_page"
      />,
    );
    await user.click(screen.getByRole('button', {
      name: /Continue with this starting point/,
    }));
    expect(onChooseStarter).toHaveBeenCalledWith('multi_page');
  });

  it('notes a Canva intent inline without leaving the screen', async () => {
    const user = userEvent.setup();
    const onCanvaIntent = vi.fn();
    const { rerender } = render(
      <StartingPointScreen
        businessName=""
        onBack={vi.fn()}
        onCanvaIntent={onCanvaIntent}
        onChooseStarter={vi.fn()}
        selectedStarter={null}
      />,
    );

    const canvaButton = screen.getByRole('button', { name: 'I want to use a Canva design' });
    expect(canvaButton).toHaveAttribute('aria-pressed', 'false');
    await user.click(canvaButton);
    expect(onCanvaIntent).toHaveBeenCalledOnce();

    rerender(
      <StartingPointScreen
        businessName=""
        canvaIntentNoted
        onBack={vi.fn()}
        onCanvaIntent={onCanvaIntent}
        onChooseStarter={vi.fn()}
        selectedStarter={null}
      />,
    );
    expect(screen.getByRole('button', { name: 'I want to use a Canva design' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status'))
      .toHaveTextContent('Noted — we’ll bring your Canva design in at the Extras step.');
  });

  it('offers Back only when there is onboarding history behind the entry screen', () => {
    const onBack = vi.fn();
    render(
      <StartingPointScreen
        businessName="Isla Nail Studio"
        canGoBack
        onBack={onBack}
        onChooseStarter={vi.fn()}
        selectedStarter="one_page"
      />,
    );

    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible();
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
  it('applies the bounded reveal treatment only when requested', () => {
    const profile = createDefaultBusinessProfile();
    const { rerender } = render(
      <StartingPreviewScreen
        preview={<div>Customer site</div>}
        profile={profile}
        reveal
        starter="one_page"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onOpenPreview={vi.fn()}
      />,
    );

    expect(document.querySelector('.onboarding-starting-preview-screen'))
      .toHaveClass('is-revealing');
    rerender(
      <StartingPreviewScreen
        preview={<div>Customer site</div>}
        profile={profile}
        starter="one_page"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onOpenPreview={vi.fn()}
      />,
    );
    expect(document.querySelector('.onboarding-starting-preview-screen'))
      .not.toHaveClass('is-revealing');
  });

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
