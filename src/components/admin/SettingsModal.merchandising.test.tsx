import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsModal } from './SettingsModal';

const { fetchMock, refreshMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
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

const settingsPayload = (
  featureLusterManicure: boolean,
  showServiceImages?: unknown,
) => ({
  reviewsEnabled: true,
  rewardsEnabled: true,
  bookingConfig: {
    bufferMinutes: 10,
    slotIntervalMinutes: 15,
    currency: 'CAD',
    timezone: 'America/Toronto',
    introPriceDefaultLabel: null,
    firstVisitDiscountEnabled: false,
    clientChangeCutoffHours: 24,
  },
  bookingNotifications: {
    newBooking: {
      technicianEnabled: true,
      ownerEnabled: false,
      technicianChannel: 'sms',
      ownerChannel: 'both',
    },
    appointmentCancelled: {
      technicianEnabled: true,
      ownerEnabled: false,
      technicianChannel: 'sms',
      ownerChannel: 'both',
    },
  },
  merchandising: {
    featureLusterManicure,
    ...(showServiceImages === undefined ? {} : { showServiceImages }),
    lusterPromoDismissed: false,
    serviceLibraryIntroDismissed: false,
  },
  ownerPhonePresent: true,
  ownerEmailPresent: true,
  smsChannelAvailable: true,
  emailChannelAvailable: true,
  effectivePoints: {
    welcomeBonus: 0,
    profileCompletion: 0,
    referralReferee: 0,
    referralReferrer: 0,
  },
  defaults: {
    welcomeBonus: 0,
    profileCompletion: 0,
    referralReferee: 0,
    referralReferrer: 0,
  },
  billingMode: 'NONE',
  subscriptionStatus: null,
});

let settingsGetResponse = settingsPayload(true);
let settingsPatchResponse = settingsPayload(false, false);

describe('SettingsModal merchandising toggles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    settingsGetResponse = settingsPayload(true);
    settingsPatchResponse = settingsPayload(false, false);

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/location?salonSlug=salon-a')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            salon: { id: 'salon_1', slug: 'salon-a', name: 'Salon A', locationCount: 1 },
            location: {
              id: 'loc_1',
              name: 'Main Studio',
              address: '123 Queen St W',
              city: 'Toronto',
              state: 'ON',
              zipCode: 'M5H 2M9',
              isPrimary: true,
            },
            isPrimaryFallback: false,
          },
        }), { status: 200 }));
      }

      if (url.includes('/api/admin/settings/booking-flow?salonSlug=salon-a')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            bookingFlowCustomizationEnabled: false,
            bookingFlow: ['service', 'tech', 'time', 'confirm'],
          },
        }), { status: 200 }));
      }

      if (url.includes('/api/admin/settings/visibility?salonSlug=salon-a')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            visibility: {
              staff: {
                showClientPhone: true,
                showClientEmail: false,
                showClientFullName: true,
                showAppointmentPrice: true,
                showClientHistory: false,
                showClientNotes: true,
                showOtherTechAppointments: false,
              },
            },
            entitled: true,
          },
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
        if (init?.method === 'PATCH') {
          return Promise.resolve(new Response(
            JSON.stringify(settingsPatchResponse),
            { status: 200 },
          ));
        }
        return Promise.resolve(new Response(
          JSON.stringify(settingsGetResponse),
          { status: 200 },
        ));
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
  });

  it('defaults service images on and saves both merchandising settings together', async () => {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    // Settings is now an index of categories; open the Booking rules view first.
    fireEvent.click(await screen.findByText('Booking rules'));

    const lusterToggle = await screen.findByTestId('feature-luster-manicure-toggle');
    const serviceImagesToggle = screen.getByTestId('show-service-images-toggle');

    expect(lusterToggle).toBeChecked();
    expect(serviceImagesToggle).toBeChecked();
    expect(screen.getByText('Show your active Luster Manicure first in Featured Services.')).toBeInTheDocument();
    expect(screen.getByText('Show uploaded service images on your public booking page. Turning this off keeps uploads stored.')).toBeInTheDocument();

    fireEvent.click(lusterToggle);
    fireEvent.click(serviceImagesToggle);
    fireEvent.click(screen.getByRole('button', { name: /save booking config/i }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([input, init]) =>
        String(input).includes('/api/admin/salon/settings')
        && (init as RequestInit | undefined)?.method === 'PATCH');

      expect(patchCall).toBeTruthy();

      const body = JSON.parse(String((patchCall![1] as RequestInit).body));

      expect(body.merchandising).toEqual({
        featureLusterManicure: false,
        showServiceImages: false,
      });
      expect(body.bookingConfig).toBeTruthy();
    });

    expect(await screen.findByText('Booking configuration saved.')).toBeInTheDocument();
    expect(screen.getByTestId('feature-luster-manicure-toggle')).not.toBeChecked();
    expect(screen.getByTestId('show-service-images-toggle')).not.toBeChecked();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['string', 'false'],
    ['number', 0],
    ['object', {}],
  ])('defaults a %s service-image setting on', async (_label, rawValue) => {
    settingsGetResponse = settingsPayload(true, rawValue);

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking rules'));

    expect(await screen.findByTestId('show-service-images-toggle')).toBeChecked();
  });

  it('respects an explicit service-image opt-out', async () => {
    settingsGetResponse = settingsPayload(true, false);

    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Booking rules'));

    expect(await screen.findByTestId('show-service-images-toggle')).not.toBeChecked();
  });
});
