import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingExperience } from '@/types/salonPolicy';

import { formatCanadianPostalCode, SettingsModal } from './SettingsModal';

const { fetchMock, refreshMock, pushMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonSlug: null,
  }),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children),
    );

  return {
    motion: new Proxy({}, {
      get: (_, tag: string) => makeMotionTag(tag),
    }),
  };
});

vi.mock('./PageThemesSettings', () => ({
  PageThemesSettings: () => <div data-testid="page-themes-settings" />,
}));

vi.mock('./BookingFlowEditor', () => ({
  BookingFlowEditor: () => <div data-testid="booking-flow-editor" />,
}));

const DEFAULT_BOOKING_EXPERIENCE: BookingExperience = {
  primaryColor: null,
  bookingMessage: null,
  policy: {
    enabled: false,
    title: null,
    text: null,
    showOnServicePage: true,
    showBeforeConfirmation: true,
    showAfterConfirmation: true,
    showInConfirmationEmail: true,
    acknowledgment: {
      required: false,
      text: null,
    },
    version: null,
  },
  quickFacts: {
    appointmentOnly: {
      enabled: false,
      label: null,
    },
    depositNotice: {
      enabled: false,
      label: null,
    },
    cancellationNotice: {
      enabled: false,
      label: null,
    },
  },
  socialLinks: {
    instagram: null,
    facebook: null,
    tiktok: null,
  },
  confirmationMessage: null,
};

const CONFIGURED_BOOKING_EXPERIENCE: BookingExperience = {
  primaryColor: '#123456',
  bookingMessage: 'Welcome to online booking.',
  policy: {
    enabled: true,
    title: 'Before you book',
    text: 'Please arrive five minutes early.',
    showOnServicePage: true,
    showBeforeConfirmation: true,
    showAfterConfirmation: true,
    showInConfirmationEmail: true,
    acknowledgment: {
      required: false,
      text:
        'I understand this appointment reserves the technician’s time.',
    },
    version: `policy-v1:${'a'.repeat(64)}`,
  },
  quickFacts: {
    appointmentOnly: {
      enabled: true,
      label: 'Appointment only',
    },
    depositNotice: {
      enabled: true,
      label: '$15 deposit required',
    },
    cancellationNotice: {
      enabled: true,
      label: '24-hour cancellation policy',
    },
  },
  socialLinks: {
    instagram: 'https://instagram.com/salon-a',
    facebook: 'https://www.facebook.com/salon-a',
    tiktok: null,
  },
  confirmationMessage: 'We look forward to seeing you.',
};

function mockEndpoints(options: {
  billingMode?: 'NONE' | 'STRIPE';
  bookingExperience?: BookingExperience;
  bookingExperienceEntitled?: boolean;
  bookingExperiencePatchResponse?: Promise<Response>;
} = {}) {
  let persistedBookingExperience
    = options.bookingExperience ?? DEFAULT_BOOKING_EXPERIENCE;

  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/admin/location?salonSlug=salon-a')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: {
          salon: { id: 'salon_1', slug: 'salon-a', name: 'Salon A', locationCount: 1 },
          location: { id: 'loc_1', name: 'Main Studio', address: '123 Queen St W', city: 'Toronto', state: 'ON', zipCode: 'M5H 2M9', isPrimary: true },
          isPrimaryFallback: false,
        },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/retention/settings?salonSlug=salon-a')) {
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({
          data: { settings: { parkingInstructions: 'Park in the back.' } },
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        data: { settings: { parkingInstructions: 'Free parking behind the salon.' } },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/settings/booking-flow?salonSlug=salon-a')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { bookingFlowCustomizationEnabled: false, bookingFlow: null },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/settings/visibility?salonSlug=salon-a')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { visibility: { staff: {} }, entitled: true },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/settings/modules?salonSlug=salon-a')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: {
          modules: {
            smsReminders: true,
            referrals: true,
            rewards: true,
            scheduleOverrides: true,
            staffEarnings: true,
            clientFlags: true,
            clientBlocking: true,
            analyticsDashboard: true,
            utilization: true,
          },
          entitledModules: {
            smsReminders: true,
            referrals: true,
            rewards: true,
            scheduleOverrides: true,
            staffEarnings: true,
            clientFlags: true,
            clientBlocking: true,
            analyticsDashboard: true,
            utilization: true,
          },
        },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/salon/settings?salonSlug=salon-a')) {
      const requestBody = init?.body
        ? JSON.parse(String(init.body))
        : {};
      const requestedAppearance = requestBody.bookingExperienceAppearance;
      const requestedPolicy = requestBody.bookingPolicy;
      const isBookingExperiencePatch = Boolean(
        requestedAppearance || requestedPolicy || requestBody.bookingExperience,
      );

      if (
        init?.method === 'PATCH'
        && isBookingExperiencePatch
        && options.bookingExperiencePatchResponse
      ) {
        return options.bookingExperiencePatchResponse;
      }

      if (init?.method === 'PATCH' && requestedAppearance) {
        persistedBookingExperience = {
          ...persistedBookingExperience,
          ...requestedAppearance,
        };
      }

      if (init?.method === 'PATCH' && requestedPolicy) {
        persistedBookingExperience = {
          ...persistedBookingExperience,
          policy: requestedPolicy.policy,
          quickFacts: requestedPolicy.quickFacts,
        };
      }

      return Promise.resolve(new Response(JSON.stringify({
        reviewsEnabled: true,
        rewardsEnabled: true,
        billingMode: options.billingMode ?? 'NONE',
        subscriptionStatus: options.billingMode === 'STRIPE' ? 'active' : null,
        bookingConfig: {
          bufferMinutes: 10,
          slotIntervalMinutes: 15,
          currency: 'CAD',
          timezone: 'America/Toronto',
          introPriceDefaultLabel: '',
          firstVisitDiscountEnabled: false,
          clientChangeCutoffHours: 24,
        },
        merchandising: { featureLusterManicure: true },
        bookingNotifications: {},
        ownerPhonePresent: true,
        ownerEmailPresent: true,
        smsChannelAvailable: true,
        emailChannelAvailable: true,
        bookingExperience: persistedBookingExperience,
        bookingExperienceEntitlement: {
          featureKey: 'booking_experience_customization',
          entitled: options.bookingExperienceEntitled ?? true,
          source: 'plan',
          planKey: options.bookingExperienceEntitled === false
            ? 'free'
            : 'tier_1',
          storedPlan: options.bookingExperienceEntitled === false
            ? 'free'
            : 'single_salon',
          lockedReason: options.bookingExperienceEntitled === false
            ? 'upgrade_required'
            : null,
        },
      }), { status: 200 }));
    }

    if (url === '/api/admin/profile' && init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({
        data: { admin: { id: 'admin_1', name: 'Daniela D', email: 'daniela@example.com' } },
      }), { status: 200 }));
    }

    if (url === '/api/billing/portal' && init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({
        url: 'https://billing.stripe.com/session/test',
      }), { status: 200 }));
    }

    return Promise.reject(new Error(`Unhandled fetch: ${url}`));
  });
}

describe('formatCanadianPostalCode', () => {
  it('formats compact Canadian postal codes readably', () => {
    expect(formatCanadianPostalCode('m5h2m9')).toBe('M5H 2M9');
    expect(formatCanadianPostalCode(' M5V1L7 ')).toBe('M5V 1L7');
  });

  it('never corrupts values that are not Canadian postal codes', () => {
    expect(formatCanadianPostalCode('90210')).toBe('90210');
    expect(formatCanadianPostalCode('M5H 2M9')).toBe('M5H 2M9');
    expect(formatCanadianPostalCode('')).toBe('');
    expect(formatCanadianPostalCode('SW1A 1AA')).toBe('SW1A 1AA');
  });
});

describe('SettingsModal index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockEndpoints();
  });

  it('shows the grouped index with no inputs; tax appears only via the Payments & taxes row', async () => {
    render(
      <SettingsModal
        onClose={vi.fn()}
        salonSlug="salon-a"
        userName="Daniela"
        onOpenApp={vi.fn()}
      />,
    );

    expect(await screen.findByText('Locations & directions')).toBeInTheDocument();
    expect(screen.getByText('Branding & appearance')).toBeInTheDocument();
    expect(screen.getByText('Booking rules')).toBeInTheDocument();
    expect(screen.getByText('Booking policy')).toBeInTheDocument();
    expect(screen.getByText('Booking & cancellation alerts')).toBeInTheDocument();
    expect(await screen.findByText('Modules & programs')).toBeInTheDocument();
    expect(screen.getByText('Manage integrations')).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();

    // Payments & taxes is a navigation row on the index; the only tax mention
    // is that row (default state "Tax off"). No editing controls leak onto the
    // index, and deposits (not implemented) never appear.
    expect(screen.getByText('Payments & taxes')).toBeInTheDocument();
    expect(screen.getByText('Tax off')).toBeInTheDocument();

    const taxMentions = screen.getAllByText(/tax/i);

    expect(taxMentions.length).toBe(2); // the row label + its "Tax off" value
    expect(screen.queryByText(/e-transfer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deposit/i)).not.toBeInTheDocument();

    // The index holds navigation rows only, not editing inputs.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('links Integrations to the dedicated Integrations app instead of duplicating setup', async () => {
    const onOpenApp = vi.fn();
    render(
      <SettingsModal
        onClose={vi.fn()}
        salonSlug="salon-a"
        userName="Daniela"
        onOpenApp={onOpenApp}
      />,
    );

    fireEvent.click(await screen.findByText('Manage integrations'));

    expect(onOpenApp).toHaveBeenCalledWith('integrations');
    // No provider setup UI inside Settings.
    expect(screen.queryByText(/connect google calendar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/authorize twilio/i)).not.toBeInTheDocument();
  });

  it('wires the About rows to the real terms and privacy pages', async () => {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Terms of Service'));

    expect(pushMock).toHaveBeenCalledWith('/en/terms');

    fireEvent.click(screen.getByText('Privacy Policy'));

    expect(pushMock).toHaveBeenCalledWith('/en/privacy');
  });

  it('warns before leaving a focused view with unsaved changes', async () => {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking rules'));
    const buffer = await screen.findByDisplayValue('10');
    fireEvent.change(buffer, { target: { value: '20' } });

    fireEvent.click(screen.getByRole('button', { name: /settings/i }));

    expect(await screen.findByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('feature-luster-manicure-toggle')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));

    expect(await screen.findByText('Locations & directions')).toBeInTheDocument();
  });

  it('keeps parking instructions in the Locations view as the single directions source', async () => {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Locations & directions'));

    const parking = await screen.findByDisplayValue('Free parking behind the salon.');
    fireEvent.change(parking, { target: { value: 'Park in the back.' } });
    fireEvent.click(screen.getByRole('button', { name: /save parking info/i }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([input, init]) =>
        String(input).includes('/api/admin/retention/settings')
        && (init as RequestInit | undefined)?.method === 'PATCH');

      expect(patchCall).toBeTruthy();

      const body = JSON.parse(String((patchCall![1] as RequestInit).body));

      // Saves only the parking field — never other retention settings.
      expect(body).toEqual({ parkingInstructions: 'Park in the back.' });
    });

    expect(await screen.findByText('Parking instructions saved.')).toBeInTheDocument();
  });

  it('keeps the page-theme editor and loads the bounded booking experience editor in Branding', async () => {
    fetchMock.mockReset();
    mockEndpoints({ bookingExperience: CONFIGURED_BOOKING_EXPERIENCE });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Branding & appearance'));

    expect(await screen.findByTestId('page-themes-settings')).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Primary brand colour' }),
    ).toHaveValue('#123456');
    expect(
      screen.getByDisplayValue('Welcome to online booking.'),
    ).toBeInTheDocument();

    const preview = within(screen.getByTestId('booking-experience-preview'));

    expect(preview.getByText('Welcome to online booking.')).toBeInTheDocument();
    expect(
      preview.getByRole('img', { name: 'Instagram social icon preview' }),
    ).toBeInTheDocument();
    expect(
      preview.getByRole('img', { name: 'Facebook social icon preview' }),
    ).toBeInTheDocument();
    expect(
      preview.queryByRole('img', { name: 'TikTok social icon preview' }),
    ).not.toBeInTheDocument();
    expect(preview.getByText('We look forward to seeing you.')).toBeInTheDocument();
    expect(
      preview.getByTestId('booking-experience-preview-button'),
    ).toHaveStyle({
      backgroundColor: '#123456',
      color: '#FFFFFF',
    });
    expect(
      preview.getByTestId('booking-experience-preview-service'),
    ).toHaveStyle({ borderColor: '#123456' });
  });

  it('loads the canonical policy, explicit quick facts, placements, and preview in the dedicated editor', async () => {
    fetchMock.mockReset();
    mockEndpoints({ bookingExperience: CONFIGURED_BOOKING_EXPERIENCE });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking policy'));

    expect(await screen.findByRole('checkbox', {
      name: 'Enable booking policy',
    })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Policy title' })).toHaveValue(
      'Before you book',
    );
    expect(screen.getByRole('textbox', { name: 'Full policy text' })).toHaveValue(
      'Please arrive five minutes early.',
    );
    expect(screen.getByText('Show before confirmation')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', {
      name: 'Enable appointment only badge',
    })).toBeChecked();
    expect(screen.getByRole('textbox', {
      name: 'Appointment only label',
    })).toHaveValue('Appointment only');
    expect(screen.getByRole('textbox', {
      name: 'Deposit notice label',
    })).toHaveValue('$15 deposit required');

    const preview = within(screen.getByTestId('booking-policy-preview'));

    expect(preview.getByText('Appointment only')).toBeInTheDocument();
    expect(preview.getByText('$15 deposit required')).toBeInTheDocument();
    expect(preview.getByText('24-hour cancellation policy')).toBeInTheDocument();
    expect(preview.getByText('Before you book')).toBeInTheDocument();
    expect(preview.getByText('Please arrive five minutes early.')).toBeInTheDocument();
    expect(preview.getByText('Confirm appointment')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Show before confirmation',
    }));

    expect(preview.queryByText('Before you book')).not.toBeInTheDocument();
    expect(preview.getByText('Confirm appointment')).toBeInTheDocument();
  });

  it('forces required policy dependencies and keeps the acknowledgment preview local until Save', async () => {
    const longPolicy = `${'Please contact the salon as soon as possible if you cannot attend. '.repeat(5)}Thank you.`;
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking policy'));
    await screen.findByTestId('booking-policy-preview');

    const requireAcknowledgment = screen.getByRole('checkbox', {
      name: 'Require acknowledgment',
    });
    fireEvent.click(requireAcknowledgment);

    expect(requireAcknowledgment).toBeChecked();
    expect(screen.getByRole('checkbox', {
      name: 'Enable booking policy',
    })).toBeChecked();
    expect(screen.getByRole('checkbox', {
      name: 'Enable booking policy',
    })).toBeDisabled();
    expect(screen.getByRole('checkbox', {
      name: 'Show before confirmation',
    })).toBeChecked();
    expect(screen.getByRole('checkbox', {
      name: 'Show before confirmation',
    })).toBeDisabled();
    expect(screen.getByRole('button', {
      name: 'Save booking policy',
    })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter full policy text before requiring acknowledgment.',
    );

    fireEvent.change(screen.getByRole('textbox', {
      name: 'Full policy text',
    }), {
      target: { value: longPolicy },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter acknowledgment wording before requiring acknowledgment.',
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Use suggested wording',
    }));

    const preview = within(screen.getByTestId('booking-policy-preview'));
    const previewCheckbox = preview.getByRole('checkbox', {
      name: 'I understand this appointment reserves the technician’s time. If I cannot attend, I will contact the salon as soon as possible.',
    });
    const previewConfirm = preview.getByRole('button', {
      name: 'Confirm appointment',
    });
    const previewExpand = preview.getByRole('button', {
      name: 'View full policy',
    });

    expect(screen.getByRole('textbox', {
      name: 'Acknowledgment wording',
    })).toHaveValue(
      'I understand this appointment reserves the technician’s time. If I cannot attend, I will contact the salon as soon as possible.',
    );
    expect(previewCheckbox).not.toBeChecked();
    expect(previewConfirm).toBeDisabled();
    expect(previewExpand).toHaveAttribute('aria-expanded', 'false');
    expect(previewExpand).toHaveAttribute('aria-controls');

    fireEvent.click(previewExpand);

    expect(preview.getByRole('button', {
      name: 'Show less',
    })).toHaveAttribute('aria-expanded', 'true');
    expect(preview.getByText(longPolicy)).toBeInTheDocument();

    fireEvent.click(previewCheckbox);

    expect(previewConfirm).toBeEnabled();
    expect(
      fetchMock.mock.calls.filter(([, init]) =>
        (init as RequestInit | undefined)?.method === 'PATCH'),
    ).toHaveLength(0);
    expect(screen.getByRole('button', {
      name: 'Save booking policy',
    })).toBeEnabled();
  });

  it('counts acknowledgment wording by Unicode code point and blocks oversized drafts', async () => {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking policy'));
    const wording = await screen.findByRole('textbox', {
      name: 'Acknowledgment wording',
    });

    fireEvent.change(wording, {
      target: { value: '💅'.repeat(220) },
    });

    expect(screen.getByText('220/220')).toBeInTheDocument();

    fireEvent.change(wording, {
      target: { value: '💅'.repeat(221) },
    });

    expect(screen.getByText('221/220')).toHaveClass('text-red-700');
    expect(wording).toHaveAttribute('aria-invalid', 'true');
  });

  it('sends required acknowledgment configuration without the read-only version', async () => {
    fetchMock.mockReset();
    mockEndpoints();

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking policy'));
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Require acknowledgment',
    }));
    fireEvent.change(screen.getByRole('textbox', {
      name: 'Full policy text',
    }), {
      target: { value: 'Please give notice if you cannot attend.' },
    });
    fireEvent.change(screen.getByRole('textbox', {
      name: 'Acknowledgment wording',
    }), {
      target: { value: 'I understand this appointment reserves time.' },
    });
    fireEvent.click(screen.getByRole('button', {
      name: 'Save booking policy',
    }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([input, init]) =>
        String(input).includes('/api/admin/salon/settings')
        && (init as RequestInit | undefined)?.method === 'PATCH');

      expect(patchCall).toBeTruthy();

      const body = JSON.parse(String((patchCall![1] as RequestInit).body));

      expect(body.bookingPolicy.policy).toMatchObject({
        enabled: true,
        showBeforeConfirmation: true,
        acknowledgment: {
          required: true,
          text: 'I understand this appointment reserves time.',
        },
      });
      expect(body.bookingPolicy.policy).not.toHaveProperty('version');
    });
  });

  /**
   * S1 (Stage 1) — BEHAVIOUR CHANGE, deliberately replacing two previously green
   * assertions.
   *
   * These asserted that an unentitled ("locked") salon saw its own booking
   * message, confirmation message and policy rendered READ-ONLY behind a
   * "locked for this plan" banner, with the public preview marked inactive and
   * Save disabled.
   *
   * Under UX-OD-02 every field these two editors write is UNIVERSAL owner
   * content, so the entitlement prop, the locked banners and the
   * preview-inactive states were removed rather than left as dead chrome
   * telling a free owner their own content is not public. The server-side write
   * gate was removed in the same change.
   */
  it('a free/unentitled salon can EDIT its booking settings — no locked state remains', async () => {
    fetchMock.mockReset();
    mockEndpoints({
      bookingExperience: CONFIGURED_BOOKING_EXPERIENCE,
      bookingExperienceEntitled: false,
    });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Branding & appearance'));
    await screen.findByTestId('booking-experience-preview');

    // The locked banner and the inactive-preview notice are gone entirely.
    expect(screen.queryByTestId('booking-experience-locked')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-experience-preview-inactive')).not.toBeInTheDocument();

    // Saved values still load...
    expect(
      screen.getByRole('textbox', { name: 'Booking message' }),
    ).toHaveValue('Welcome to online booking.');
    expect(
      screen.getByRole('textbox', { name: 'Confirmation message' }),
    ).toHaveValue('We look forward to seeing you.');

    // ...and are now editable rather than read-only.
    expect(
      screen.getByRole('textbox', { name: 'Booking message' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('textbox', { name: 'Confirmation message' }),
    ).toBeEnabled();
    expect(screen.getByTestId('booking-experience-preview')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Reset to Default' }),
    ).toBeEnabled();
  });

  it('a free/unentitled salon can EDIT its booking policy — no locked state remains', async () => {
    fetchMock.mockReset();
    mockEndpoints({
      bookingExperience: CONFIGURED_BOOKING_EXPERIENCE,
      bookingExperienceEntitled: false,
    });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking policy'));
    await screen.findByTestId('booking-policy-preview');

    expect(screen.queryByTestId('booking-policy-locked')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-policy-preview-inactive')).not.toBeInTheDocument();

    expect(screen.getByRole('textbox', { name: 'Policy title' })).toHaveValue(
      'Before you book',
    );
    expect(screen.getByRole('textbox', { name: 'Policy title' })).toBeEnabled();
    expect(screen.getByRole('checkbox', {
      name: 'Require acknowledgment',
    })).toBeEnabled();
    expect(screen.getByRole('textbox', {
      name: 'Acknowledgment wording',
    })).toBeEnabled();
    expect(screen.getByTestId('booking-policy-preview')).toBeVisible();
  });

  it('updates every appearance preview element from the unsaved draft', async () => {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Branding & appearance'));
    await screen.findByTestId('booking-experience-preview');

    fireEvent.change(screen.getByRole('textbox', { name: 'Primary brand colour' }), {
      target: { value: '#F5D000' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Booking message' }), {
      target: { value: 'Pick a service that feels right.' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Instagram' }), {
      target: { value: 'https://instagram.com/salon-a' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'TikTok' }), {
      target: { value: 'https://tiktok.com/@salon-a' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Confirmation message' }), {
      target: { value: 'Bring your inspiration photos.' },
    });

    const preview = within(screen.getByTestId('booking-experience-preview'));

    expect(preview.getByText('Pick a service that feels right.')).toBeInTheDocument();
    expect(preview.getByText('Bring your inspiration photos.')).toBeInTheDocument();
    expect(
      preview.getByRole('img', { name: 'Instagram social icon preview' }),
    ).toBeInTheDocument();
    expect(
      preview.getByRole('img', { name: 'TikTok social icon preview' }),
    ).toBeInTheDocument();
    expect(
      preview.getByTestId('booking-experience-preview-button'),
    ).toHaveStyle({
      backgroundColor: '#F5D000',
      color: '#000000',
    });
    expect(
      preview.getByTestId('booking-experience-preview-service'),
    ).toHaveStyle({ borderColor: '#000000' });
  });

  it('updates explicit quick facts and the canonical policy preview from an unsaved policy draft', async () => {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking policy'));
    await screen.findByTestId('booking-policy-preview');

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Enable booking policy',
    }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Policy title' }), {
      target: { value: 'Booking notes' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Full policy text' }), {
      target: { value: 'Changes require advance notice.' },
    });
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Enable appointment only badge',
    }));
    fireEvent.change(screen.getByRole('textbox', {
      name: 'Appointment only label',
    }), {
      target: { value: 'Appointment only' },
    });

    const preview = within(screen.getByTestId('booking-policy-preview'));

    expect(preview.getByText('Appointment only')).toBeInTheDocument();
    expect(preview.getByText('Booking notes')).toBeInTheDocument();
    expect(preview.getByText('Changes require advance notice.')).toBeInTheDocument();
  });

  it('saves only the policy and quick-fact subpaths from the dedicated editor', async () => {
    fetchMock.mockReset();
    mockEndpoints({ bookingExperience: CONFIGURED_BOOKING_EXPERIENCE });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking policy'));
    fireEvent.change(await screen.findByRole('textbox', {
      name: 'Policy title',
    }), {
      target: { value: 'Updated booking policy' },
    });
    fireEvent.change(screen.getByRole('textbox', {
      name: 'Deposit notice label',
    }), {
      target: { value: 'Deposit required for new clients' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save booking policy' }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([input, init]) =>
        String(input).includes('/api/admin/salon/settings')
        && (init as RequestInit | undefined)?.method === 'PATCH');

      expect(patchCall).toBeTruthy();

      const body = JSON.parse(String((patchCall![1] as RequestInit).body));

      expect(body).toEqual({
        bookingPolicy: {
          policy: {
            enabled: true,
            title: 'Updated booking policy',
            text: 'Please arrive five minutes early.',
            showOnServicePage: true,
            showBeforeConfirmation: true,
            showAfterConfirmation: true,
            showInConfirmationEmail: true,
            acknowledgment: {
              required: false,
              text:
                'I understand this appointment reserves the technician’s time.',
            },
          },
          quickFacts: {
            ...CONFIGURED_BOOKING_EXPERIENCE.quickFacts,
            depositNotice: {
              enabled: true,
              label: 'Deposit required for new clients',
            },
          },
        },
      });
      expect(body).not.toHaveProperty('bookingExperience');
      expect(body).not.toHaveProperty('bookingExperienceAppearance');
      expect(body.bookingPolicy.policy).not.toHaveProperty('version');
    });

    expect(await screen.findByText('Booking policy saved.')).toBeInTheDocument();
  });

  it('keeps Reset to Default draft-only until an explicit Save', async () => {
    fetchMock.mockReset();
    mockEndpoints({ bookingExperience: CONFIGURED_BOOKING_EXPERIENCE });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Branding & appearance'));
    await screen.findByDisplayValue('Welcome to online booking.');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));

    expect(screen.getByRole('textbox', { name: 'Booking message' })).toHaveValue('');
    expect(
      fetchMock.mock.calls.filter(([, init]) =>
        (init as RequestInit | undefined)?.method === 'PATCH'),
    ).toHaveLength(0);

    fireEvent.click(
      screen.getByRole('button', { name: 'Save booking experience' }),
    );

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([input, init]) =>
        String(input).includes('/api/admin/salon/settings')
        && (init as RequestInit | undefined)?.method === 'PATCH');

      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String((patchCall![1] as RequestInit).body))).toEqual({
        bookingExperienceAppearance: {
          primaryColor: DEFAULT_BOOKING_EXPERIENCE.primaryColor,
          bookingMessage: DEFAULT_BOOKING_EXPERIENCE.bookingMessage,
          socialLinks: DEFAULT_BOOKING_EXPERIENCE.socialLinks,
          confirmationMessage: DEFAULT_BOOKING_EXPERIENCE.confirmationMessage,
        },
      });
    });

    expect(await screen.findByText('Booking experience saved.')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('locks the draft while an explicit Save is in flight', async () => {
    let resolvePatch!: (response: Response) => void;
    const pendingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    fetchMock.mockReset();
    mockEndpoints({ bookingExperiencePatchResponse: pendingPatch });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Branding & appearance'));
    const bookingMessage = await screen.findByRole('textbox', {
      name: 'Booking message',
    });
    fireEvent.change(bookingMessage, {
      target: { value: 'Save this exact draft.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save booking experience' }),
    );

    await waitFor(() => {
      expect(bookingMessage).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Reset to Default' }),
      ).toBeDisabled();
    });

    resolvePatch(new Response(JSON.stringify({
      bookingExperience: {
        ...DEFAULT_BOOKING_EXPERIENCE,
        bookingMessage: 'Save this exact draft.',
      },
    }), { status: 200 }));

    expect(await screen.findByText('Booking experience saved.')).toHaveAttribute(
      'role',
      'status',
    );
    expect(bookingMessage).toBeEnabled();
  });

  /**
   * S1 (Stage 1) — BEHAVIOUR CHANGE, deliberately replacing a previously green
   * assertion. The editors are no longer entitlement-gated (UX-OD-02), so the
   * "locked" chrome this asserted no longer exists.
   */
  it('surfaces the server error but no longer locks the editor when a PATCH is refused', async () => {
    fetchMock.mockReset();
    mockEndpoints({
      bookingExperience: CONFIGURED_BOOKING_EXPERIENCE,
      bookingExperiencePatchResponse: Promise.resolve(
        new Response(JSON.stringify({
          error: {
            code: 'UPGRADE_REQUIRED',
            message:
              'Booking Experience Customization requires an eligible plan.',
          },
        }), { status: 403 }),
      ),
    });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Branding & appearance'));
    const bookingMessage = await screen.findByRole('textbox', {
      name: 'Booking message',
    });
    fireEvent.change(bookingMessage, {
      target: { value: 'Preserve this draft after a refused save.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save booking experience' }),
    );

    // The error is still surfaced honestly...
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Booking Experience Customization requires an eligible plan.',
    );
    // ...the unsaved draft is still preserved...
    expect(bookingMessage).toHaveValue(
      'Preserve this draft after a refused save.',
    );
    // ...but the editor is NOT locked, because these fields are universal.
    // The server no longer returns this code for them, and the client-side
    // lock branch was removed entirely — the only remaining degradation is
    // this error alert.
    expect(screen.queryByTestId('booking-experience-locked')).not.toBeInTheDocument();
    expect(bookingMessage).toBeEnabled();
  });

  /**
   * S1 (Stage 1) — BEHAVIOUR CHANGE, deliberately replacing a previously green
   * assertion. The editors are no longer entitlement-gated (UX-OD-02), so the
   * "locked" chrome this asserted no longer exists.
   */
  it('a successful Save keeps the editor usable even when the response reports no entitlement', async () => {
    fetchMock.mockReset();
    mockEndpoints({
      bookingExperience: CONFIGURED_BOOKING_EXPERIENCE,
      bookingExperiencePatchResponse: Promise.resolve(
        new Response(JSON.stringify({
          bookingExperience: {
            ...CONFIGURED_BOOKING_EXPERIENCE,
            bookingMessage: 'Saved immediately before access changed.',
          },
          bookingExperienceEntitlement: {
            featureKey: 'booking_experience_customization',
            entitled: false,
            source: 'override',
            planKey: 'tier_1',
            storedPlan: 'single_salon',
            lockedReason: 'upgrade_required',
          },
        }), { status: 200 }),
      ),
    });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Branding & appearance'));
    const bookingMessage = await screen.findByRole('textbox', {
      name: 'Booking message',
    });
    fireEvent.change(bookingMessage, {
      target: { value: 'Saved immediately before access changed.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save booking experience' }),
    );

    expect(
      await screen.findByText('Booking experience saved.'),
    ).toBeInTheDocument();
    expect(bookingMessage).toHaveValue(
      'Saved immediately before access changed.',
    );
    // The response still carries entitlement metadata for the super-admin
    // surfaces, but it no longer gates this editor.
    expect(screen.queryByTestId('booking-experience-locked')).not.toBeInTheDocument();
    expect(bookingMessage).toBeEnabled();
  });

  it('guards unsaved booking-experience navigation and discards only the draft', async () => {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Branding & appearance'));
    await screen.findByTestId('booking-experience-preview');
    fireEvent.change(screen.getByRole('textbox', { name: 'Booking message' }), {
      target: { value: 'Unsaved welcome' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(
      await screen.findByRole('alertdialog', { name: 'Unsaved changes' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    fireEvent.click(await screen.findByText('Branding & appearance'));

    expect(
      await screen.findByRole('textbox', { name: 'Booking message' }),
    ).toHaveValue('');
  });

  it('shows a field-specific save error and keeps the failed draft unsaved', async () => {
    fetchMock.mockReset();
    mockEndpoints({
      bookingExperience: CONFIGURED_BOOKING_EXPERIENCE,
      bookingExperiencePatchResponse: Promise.resolve(
        new Response(JSON.stringify({
          error: 'Invalid request data',
          details: {
            fieldErrors: {
              bookingExperience: [
                'Instagram link must be a valid Instagram profile URL.',
              ],
            },
          },
          bookingExperience: {
            ...CONFIGURED_BOOKING_EXPERIENCE,
            bookingMessage: 'This response must not replace the draft.',
          },
        }), { status: 400 }),
      ),
    });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Branding & appearance'));
    await screen.findByTestId('booking-experience-preview');

    fireEvent.change(screen.getByRole('textbox', { name: 'Instagram' }), {
      target: { value: 'http://example.com/not-instagram' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Booking message' }), {
      target: { value: 'Keep this unsaved draft.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save booking experience' }),
    );

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('Instagram link must be a valid Instagram profile URL.');
    expect(screen.getByRole('textbox', { name: 'Instagram' })).toHaveValue(
      'http://example.com/not-instagram',
    );
    expect(screen.getByRole('textbox', { name: 'Booking message' })).toHaveValue(
      'Keep this unsaved draft.',
    );
    expect(
      screen.queryByText('Booking experience saved.'),
    ).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Save booking experience' }),
    ).toBeEnabled();
    expect(
      fetchMock.mock.calls.filter(([input, init]) =>
        String(input).includes('/api/admin/salon/settings')
        && (init as RequestInit | undefined)?.method === 'PATCH'),
    ).toHaveLength(1);
  });

  it('chooses a deterministic field message when validation reports multiple errors', async () => {
    fetchMock.mockReset();
    mockEndpoints({
      bookingExperiencePatchResponse: Promise.resolve(
        new Response(JSON.stringify({
          error: 'Invalid request data',
          details: {
            fieldErrors: {
              socialLinks: [
                'Instagram link must be a valid Instagram profile URL.',
              ],
              policy: [
                'Policy text is required when the policy is enabled.',
              ],
            },
          },
        }), { status: 400 }),
      ),
    });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking policy'));
    await screen.findByTestId('booking-policy-preview');
    fireEvent.change(screen.getByRole('textbox', { name: 'Policy title' }), {
      target: { value: 'Unsaved policy title' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save booking policy' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Policy text is required when the policy is enabled.',
    );
    expect(
      screen.queryByText('Booking policy saved.'),
    ).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('falls back safely when field validation details are malformed', async () => {
    fetchMock.mockReset();
    mockEndpoints({
      bookingExperiencePatchResponse: Promise.resolve(
        new Response(JSON.stringify({
          error: { code: 'INVALID_REQUEST' },
          details: {
            fieldErrors: {
              bookingExperience: [null, '', { stack: 'internal details' }],
            },
          },
        }), { status: 400 }),
      ),
    });

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Branding & appearance'));
    await screen.findByTestId('booking-experience-preview');
    fireEvent.change(screen.getByRole('textbox', { name: 'Booking message' }), {
      target: { value: 'Keep this draft too' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save booking experience' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to save booking experience settings.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('[object Object]');
    expect(screen.getByRole('textbox', { name: 'Booking message' })).toHaveValue(
      'Keep this draft too',
    );
    expect(
      screen.queryByText('Booking experience saved.'),
    ).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('saves the owner profile through the existing profile endpoint', async () => {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByTestId('settings-profile-card'));

    const saveButton = await screen.findByRole('button', { name: /save profile/i });

    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'daniela@example.com' },
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/profile',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Daniela', email: 'daniela@example.com' }),
        }),
      );
    });

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
  });

  it('shows offline billing as status text with no billing portal button', async () => {
    render(
      <SettingsModal
        onClose={vi.fn()}
        salonSlug="salon-a"
        salonId="salon_1"
        userName="Daniela"
      />,
    );

    fireEvent.click(await screen.findByTestId('settings-profile-card'));

    expect(await screen.findByText('Cash / Offline billing enabled')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-billing-button')).not.toBeInTheDocument();
  });

  it('offers the Stripe billing portal only to Stripe-billed salons', async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockEndpoints({ billingMode: 'STRIPE' });
    // jsdom cannot navigate; the redirect is absorbed by the component's error
    // handling and the target is asserted via the API call instead.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <SettingsModal
        onClose={vi.fn()}
        salonSlug="salon-a"
        salonId="salon_1"
        userName="Daniela"
      />,
    );

    fireEvent.click(await screen.findByTestId('settings-profile-card'));

    const manageButton = await screen.findByTestId('manage-billing-button');
    fireEvent.click(manageButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/billing/portal',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ salonId: 'salon_1' }),
        }),
      );
    });
  });
});
