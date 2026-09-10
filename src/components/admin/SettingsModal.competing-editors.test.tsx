/**
 * Settings ↔ Booking Page hub: ONE canonical writer per record.
 *
 * Covers the competing-editor repairs in source map §C1:
 *   - address    → Settings hands off to Your Information (no second form)
 *   - colour     → the drafted palette is the authority; Settings only links
 *   - Instagram  → one normaliser, one stored form, handle shown
 *   - minimum notice → the missing editor (AG-w2-settings-integrations-01)
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingExperience } from '@/types/salonPolicy';

import { SettingsModal } from './SettingsModal';

const { fetchMock, refreshMock, pushMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    refresh: refreshMock,
  }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: null }),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children),
    );

  return {
    motion: new Proxy({}, { get: (_, tag: string) => makeMotionTag(tag) }),
  };
});

vi.mock('./PageThemesSettings', () => ({
  PageThemesSettings: () => <div data-testid="page-themes-settings" />,
}));

vi.mock('./BookingFlowEditor', () => ({
  BookingFlowEditor: () => <div data-testid="booking-flow-editor" />,
}));

const BOOKING_EXPERIENCE: BookingExperience = {
  primaryColor: '#123456',
  bookingMessage: null,
  policy: {
    enabled: false,
    title: null,
    text: null,
    showOnServicePage: true,
    showBeforeConfirmation: true,
    showAfterConfirmation: true,
    showInConfirmationEmail: true,
    acknowledgment: { required: false, text: null },
    version: null,
  },
  quickFacts: {
    appointmentOnly: { enabled: false, label: null },
    depositNotice: { enabled: false, label: null },
    cancellationNotice: { enabled: false, label: null },
  },
  socialLinks: {
    instagram: 'https://www.instagram.com/audit0905lacquer/',
    facebook: null,
    tiktok: null,
  },
  confirmationMessage: null,
};

function patchBodies(match: string): Array<Record<string, any>> {
  return fetchMock.mock.calls
    .filter(([input, init]) =>
      String(input).includes(match)
      && (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function mockEndpoints(bookingConfigOverrides: Record<string, unknown> = {}) {
  let persistedBookingExperience = BOOKING_EXPERIENCE;

  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/admin/retention/settings')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { settings: { parkingInstructions: 'Free parking behind the salon.' } },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/settings/booking-flow')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { bookingFlowCustomizationEnabled: false, bookingFlow: null },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/settings/visibility')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { visibility: { staff: {} }, entitled: true },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/settings/modules')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { modules: {}, entitledModules: {} },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/salon/settings')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (init?.method === 'PATCH' && body.bookingExperienceAppearance) {
        persistedBookingExperience = {
          ...persistedBookingExperience,
          ...body.bookingExperienceAppearance,
        };
      }
      return Promise.resolve(new Response(JSON.stringify({
        reviewsEnabled: true,
        rewardsEnabled: true,
        billingMode: 'NONE',
        subscriptionStatus: null,
        bookingConfig: {
          bufferMinutes: 10,
          slotIntervalMinutes: 15,
          minimumNoticeMinutes: 120,
          currency: 'CAD',
          timezone: 'America/Toronto',
          introPriceDefaultLabel: '',
          firstVisitDiscountEnabled: false,
          clientChangeCutoffHours: 24,
          ...bookingConfigOverrides,
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
          entitled: true,
          source: 'plan',
          planKey: 'tier_1',
          storedPlan: 'single_salon',
          lockedReason: null,
        },
      }), { status: 200 }));
    }

    return Promise.reject(new Error(`Unhandled fetch: ${url}`));
  });
}

function open() {
  render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);
}

async function openBookingRules() {
  fireEvent.click(await screen.findByText('Booking & Availability'));
  fireEvent.click(await screen.findByText('Booking Rules'));
}

async function openBusinessCard(card: 'Branding & Social' | 'Location & Arrival') {
  fireEvent.click(await screen.findByText('Business'));
  fireEvent.click(await screen.findByText(card));
}

describe('SettingsModal — one writer per record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockEndpoints();
  });

  describe('minimum booking notice (AG-w2-settings-integrations-01)', () => {
    it('defaults to automatic confirmation and saves review mode without changing notice', async () => {
      open();
      await openBookingRules();
      const mode = await screen.findByLabelText(/^Booking confirmation/);

      expect(mode).toHaveValue('instant');

      fireEvent.change(mode, { target: { value: 'request_approval' } });
      fireEvent.click(screen.getByRole('button', { name: /save booking settings|save/i }));

      await waitFor(() => {
        expect(patchBodies('/api/admin/salon/settings')).toContainEqual(expect.objectContaining({
          bookingConfig: expect.objectContaining({ confirmationMode: 'request_approval', minimumNoticeMinutes: 120 }),
        }));
      });
    });

    it('loads the saved review mode and keeps it when editing notice', async () => {
      mockEndpoints({ confirmationMode: 'request_approval', minimumNoticeMinutes: 480 });
      open();
      await openBookingRules();

      expect(await screen.findByLabelText(/^Booking confirmation/)).toHaveValue('request_approval');

      fireEvent.change(screen.getByTestId('minimum-notice-select'), { target: { value: '1440' } });
      fireEvent.click(screen.getByRole('button', { name: /save booking settings|save/i }));

      await waitFor(() => {
        expect(patchBodies('/api/admin/salon/settings')).toContainEqual(expect.objectContaining({
          bookingConfig: expect.objectContaining({ confirmationMode: 'request_approval', minimumNoticeMinutes: 1440 }),
        }));
      });
    });

    it('shows the stored value on the Booking rules row and in the editor', async () => {
      open();

      fireEvent.click(await screen.findByText('Booking & Availability'));
      expect(await screen.findByText('15 minute slots · 2 hours notice')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Booking Rules'));

      expect(await screen.findByTestId('minimum-notice-select')).toHaveValue('120');
      expect(screen.getByTestId('minimum-notice-current')).toHaveTextContent('Now: 2 hours');
    });

    it('writes settings.booking.minimumNoticeMinutes for a preset choice', async () => {
      open();
      await openBookingRules();
      fireEvent.change(await screen.findByTestId('minimum-notice-select'), { target: { value: '1440' } });
      fireEvent.click(screen.getByRole('button', { name: /save booking settings|save/i }));

      await waitFor(() => {
        expect(patchBodies('/api/admin/salon/settings')
          .some(body => body.bookingConfig?.minimumNoticeMinutes === 1_440)).toBe(true);
      });
    });

    it('accepts a custom value the presets do not offer', async () => {
      open();
      await openBookingRules();
      fireEvent.change(await screen.findByTestId('minimum-notice-select'), { target: { value: 'custom' } });
      fireEvent.change(await screen.findByTestId('minimum-notice-custom'), { target: { value: '180' } });

      expect(screen.getByTestId('minimum-notice-current')).toHaveTextContent('Now: 3 hours');

      fireEvent.click(screen.getByRole('button', { name: /save booking settings|save/i }));

      await waitFor(() => {
        expect(patchBodies('/api/admin/salon/settings')
          .some(body => body.bookingConfig?.minimumNoticeMinutes === 180)).toBe(true);
      });
    });

    it('keeps a stored custom value selected instead of snapping to a preset', async () => {
      mockEndpoints({ minimumNoticeMinutes: 180 });
      open();
      await openBookingRules();

      expect(await screen.findByTestId('minimum-notice-select')).toHaveValue('custom');
      expect(screen.getByTestId('minimum-notice-custom')).toHaveValue(180);
    });
  });

  describe('appearance authorities (AG-more-settings-06)', () => {
    it('names the two Business rows and where each one goes', async () => {
      open();

      fireEvent.click(await screen.findByText('Business'));
      expect(await screen.findByText('Branding & Social')).toBeInTheDocument();
      expect(screen.getByText('Booking messages and social links')).toBeInTheDocument();
      expect(screen.queryByText('Website layout & colours')).not.toBeInTheDocument();
      expect(screen.queryByText('Branding & appearance')).not.toBeInTheDocument();
    });

    it('replaces the free colour control with a link to the drafted palette', async () => {
      open();
      await openBusinessCard('Branding & Social');

      const handoff = await screen.findByTestId('branding-colour-authority');

      expect(handoff).toHaveTextContent('Booking Page → Style & Colours');
      expect(screen.getByRole('link', { name: /open style & colours/i }))
        .toHaveAttribute('href', '/en/admin/booking-page?salon=salon-a&panel=appearance');
      expect(screen.queryByLabelText('Primary brand colour')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Choose primary brand colour')).not.toBeInTheDocument();
    });

    it('never writes primaryColor from this screen, including on Reset', async () => {
      open();
      await openBusinessCard('Branding & Social');
      fireEvent.click(await screen.findByRole('button', { name: /reset to default/i }));
      fireEvent.click(screen.getByRole('button', { name: /save booking experience/i }));

      await waitFor(() => {
        expect(patchBodies('/api/admin/salon/settings').length).toBeGreaterThan(0);
      });

      for (const body of patchBodies('/api/admin/salon/settings')) {
        expect(body.bookingExperienceAppearance?.primaryColor).toBe('#123456');
      }
    });
  });

  describe('Instagram (AG-w2-information-parity-02)', () => {
    it('shows the stored URL as a bare handle with the shared helper text', async () => {
      open();
      await openBusinessCard('Branding & Social');

      expect(await screen.findByTestId('branding-instagram')).toHaveValue('audit0905lacquer');
      expect(screen.getByTestId('branding-instagram-helper'))
        .toHaveTextContent('Username or link — clients see @audit0905lacquer');
    });

    it('stores the canonical profile URL whether a handle or a link is typed', async () => {
      open();
      await openBusinessCard('Branding & Social');

      const field = await screen.findByTestId('branding-instagram');

      fireEvent.change(field, { target: { value: 'audit0905parity' } });

      expect(field).toHaveValue('audit0905parity');

      fireEvent.change(field, { target: { value: 'https://instagram.com/audit0905parity' } });

      expect(field).toHaveValue('audit0905parity');

      fireEvent.click(screen.getByRole('button', { name: /save booking experience/i }));

      await waitFor(() => {
        expect(patchBodies('/api/admin/salon/settings')
          .some(body => body.bookingExperienceAppearance?.socialLinks?.instagram
            === 'https://www.instagram.com/audit0905parity/')).toBe(true);
      });
    });

    it('explains an unusable value instead of silently storing it', async () => {
      open();
      await openBusinessCard('Branding & Social');
      fireEvent.change(await screen.findByTestId('branding-instagram'), { target: { value: 'https://example.com/someone' } });

      expect(screen.getByTestId('branding-instagram-helper')).toHaveTextContent(/only your Instagram username/i);
    });
  });

  describe('address (source map §C1 row 1)', () => {
    it('keeps the row but hands the five address fields to Your Information', async () => {
      open();
      await openBusinessCard('Location & Arrival');

      expect(await screen.findByTestId('settings-location-handoff')).toBeInTheDocument();
      // The competing form is gone: no second copy of the address fields.
      expect(screen.queryByPlaceholderText('123 Main St')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /save location/i })).not.toBeInTheDocument();
      // Parking & entry instructions live only here and stay.
      expect(await screen.findByDisplayValue('Free parking behind the salon.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /edit salon address/i }));

      expect(await screen.findByTestId('booking-page-information-editor')).toBeInTheDocument();
      expect(pushMock).toHaveBeenLastCalledWith(
        '/en/admin?salon=salon-a&app=settings&view=business-profile',
        { scroll: false },
      );
      expect(pushMock).not.toHaveBeenCalledWith(
        '/en/admin/booking-page?salon=salon-a&panel=information',
      );
    });
  });
});
