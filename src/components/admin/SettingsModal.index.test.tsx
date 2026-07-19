import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function mockEndpoints(options: { billingMode?: 'NONE' | 'STRIPE' } = {}) {
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
