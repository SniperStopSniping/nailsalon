import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsModal } from './SettingsModal';

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

type PaymentsPayload = {
  tax?: Record<string, unknown>;
  etransfer?: Record<string, unknown>;
};

function mockEndpoints(options: { payments?: PaymentsPayload } = {}) {
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
      return Promise.resolve(new Response(JSON.stringify({
        data: { settings: { parkingInstructions: '' } },
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
        data: { modules: {}, entitledModules: {} },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/salon/settings?salonSlug=salon-a')) {
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({
          payments: JSON.parse(String(init.body)).payments,
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        reviewsEnabled: true,
        rewardsEnabled: true,
        billingMode: 'NONE',
        subscriptionStatus: null,
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
        payments: options.payments ?? {},
        ownerPhonePresent: true,
        ownerEmailPresent: true,
        smsChannelAvailable: true,
        emailChannelAvailable: true,
      }), { status: 200 }));
    }

    return Promise.reject(new Error(`Unhandled fetch: ${url}`));
  });
}

async function openPaymentsView() {
  render(
    <SettingsModal
      onClose={vi.fn()}
      salonSlug="salon-a"
      userName="Daniela"
      onOpenApp={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByText('Payments & taxes'));
  await screen.findByText('Charge tax');
}

describe('SettingsModal Payments & taxes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockEndpoints();
  });

  it('shows stored tax settings in the index row value', async () => {
    mockEndpoints({
      payments: { tax: { enabled: true, name: 'HST', rateBps: 1300 } },
    });
    render(
      <SettingsModal
        onClose={vi.fn()}
        salonSlug="salon-a"
        userName="Daniela"
        onOpenApp={vi.fn()}
      />,
    );

    expect(await screen.findByText('HST 13%')).toBeInTheDocument();
  });

  it('hides tax fields until tax is enabled and reveals them on toggle', async () => {
    await openPaymentsView();

    expect(screen.queryByTestId('payments-tax-name')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('payments-tax-enabled'));

    expect(screen.getByTestId('payments-tax-name')).toBeInTheDocument();
    expect(screen.getByTestId('payments-tax-rate')).toBeInTheDocument();
    expect(screen.getByTestId('payments-tax-inclusive')).toBeInTheDocument();
  });

  it('saves only the payments key, converting the percent rate to basis points', async () => {
    await openPaymentsView();

    fireEvent.click(screen.getByTestId('payments-tax-enabled'));
    fireEvent.change(screen.getByTestId('payments-tax-name'), { target: { value: 'HST' } });
    fireEvent.change(screen.getByTestId('payments-tax-rate'), { target: { value: '13' } });
    fireEvent.click(screen.getByTestId('payments-save'));

    await waitFor(() => {
      expect(screen.getByText('Payments & taxes saved.')).toBeInTheDocument();
    });

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );

    expect(patchCall).toBeDefined();

    const body = JSON.parse(String((patchCall![1] as RequestInit).body));

    expect(Object.keys(body)).toEqual(['payments']);
    expect(body.payments.tax).toMatchObject({
      enabled: true,
      name: 'HST',
      rateBps: 1300,
      pricesIncludeTax: false,
      scheduledChange: null,
    });
    expect(body.payments.etransfer).toMatchObject({ enabled: false });
  });

  it('includes a scheduled rate change only when both rate and date are set', async () => {
    await openPaymentsView();

    fireEvent.click(screen.getByTestId('payments-tax-enabled'));
    fireEvent.change(screen.getByTestId('payments-tax-scheduled-rate'), { target: { value: '15' } });
    fireEvent.change(screen.getByTestId('payments-tax-scheduled-date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByTestId('payments-save'));

    await waitFor(() => {
      expect(screen.getByText('Payments & taxes saved.')).toBeInTheDocument();
    });

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    const body = JSON.parse(String((patchCall![1] as RequestInit).body));

    expect(body.payments.tax.scheduledChange).toEqual({
      rateBps: 1500,
      effectiveFrom: '2026-09-01T00:00:00',
    });
  });

  it('keeps Save disabled until a field changes (explicit-save pattern)', async () => {
    await openPaymentsView();

    expect(screen.getByTestId('payments-save')).toBeDisabled();

    fireEvent.click(screen.getByTestId('payments-etransfer-enabled'));

    expect(screen.getByTestId('payments-save')).toBeEnabled();
  });

  it('e-Transfer card never asks for banking credentials and gates fields on enable', async () => {
    await openPaymentsView();

    expect(screen.queryByTestId('payments-etransfer-recipient')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('payments-etransfer-enabled'));

    expect(screen.getByTestId('payments-etransfer-recipient')).toBeInTheDocument();
    expect(screen.getByTestId('payments-etransfer-qr')).toBeInTheDocument();
    // Manual instructions only — no password/banking-credential inputs, and the
    // honest limitation is stated.
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText(/cannot verify bank deposits/i)).toBeInTheDocument();
  });

  it('warns on Back when the payments view has unsaved edits', async () => {
    await openPaymentsView();

    fireEvent.click(screen.getByTestId('payments-tax-enabled'));
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));

    expect(await screen.findByText(/unsaved changes/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(await screen.findByText('Payments & taxes')).toBeInTheDocument();
  });
});
