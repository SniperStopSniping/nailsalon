import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, refreshMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: refreshMock,
  }),
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

import { SettingsModal } from './SettingsModal';

describe('SettingsModal booking notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/location?salonSlug=salon-a')) {
        if (init?.method === 'PATCH') {
          return Promise.resolve(new Response(JSON.stringify({
            data: {
              location: {
                id: 'loc_1',
                name: 'Main Studio',
                address: '123 Queen St W',
                city: 'Toronto',
                state: 'ON',
                zipCode: 'M5H 2M9',
                isPrimary: true,
              },
              locationCount: 1,
              created: false,
            },
          }), { status: 200 }));
        }

        return Promise.resolve(new Response(JSON.stringify({
          data: {
            salon: {
              id: 'salon_1',
              slug: 'salon-a',
              name: 'Salon A',
              locationCount: 1,
            },
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
          return Promise.resolve(new Response(JSON.stringify({
            reviewsEnabled: true,
            rewardsEnabled: true,
            bookingConfig: {
              bufferMinutes: 10,
              slotIntervalMinutes: 15,
              currency: 'CAD',
              timezone: 'America/Toronto',
              introPriceDefaultLabel: null,
              firstVisitDiscountEnabled: false,
            },
            bookingNotifications: {
              newBooking: {
                technicianEnabled: true,
                ownerEnabled: true,
                technicianChannel: 'both',
                ownerChannel: 'both',
              },
              appointmentCancelled: {
                technicianEnabled: true,
                ownerEnabled: true,
                technicianChannel: 'sms',
                ownerChannel: 'both',
              },
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
          }), { status: 200 }));
        }

        return Promise.resolve(new Response(JSON.stringify({
          reviewsEnabled: true,
          rewardsEnabled: true,
          bookingConfig: {
            bufferMinutes: 10,
            slotIntervalMinutes: 15,
            currency: 'CAD',
            timezone: 'America/Toronto',
            introPriceDefaultLabel: null,
            firstVisitDiscountEnabled: false,
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
        }), { status: 200 }));
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
  });

  it('loads notification settings and saves both booking and cancellation preferences', async () => {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    const ownerNewBookingToggle = await screen.findByLabelText('Notify salon owner for new booking alerts');
    expect(ownerNewBookingToggle).not.toBeChecked();

    fireEvent.click(ownerNewBookingToggle);
    fireEvent.click(await screen.findByLabelText('Notify salon owner for cancellation alerts'));
    fireEvent.change(screen.getByLabelText('Technician notification channel for new booking alerts'), {
      target: { value: 'both' },
    });
    fireEvent.change(screen.getByLabelText('Owner notification channel for new booking alerts'), {
      target: { value: 'both' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save alerts/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/salon/settings?salonSlug=salon-a',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingNotifications: {
              newBooking: {
                technicianEnabled: true,
                ownerEnabled: true,
                technicianChannel: 'both',
                ownerChannel: 'both',
              },
              appointmentCancelled: {
                technicianEnabled: true,
                ownerEnabled: true,
                technicianChannel: 'sms',
                ownerChannel: 'both',
              },
            },
          }),
        }),
      );
    });

    expect(await screen.findByText('Notification settings saved.')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });
});
