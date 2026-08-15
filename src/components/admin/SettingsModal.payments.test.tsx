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
  deposit?: Record<string, unknown>;
};

type DepositPolicyPayload = {
  collectionLive: boolean;
  entitled: boolean;
  active: boolean;
  reason: string | null;
  readinessStale: boolean;
  readinessAgeMs: number | null;
};

function mockEndpoints(options: {
  payments?: PaymentsPayload;
  depositPolicy?: DepositPolicyPayload;
} = {}) {
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
        depositPolicy: options.depositPolicy ?? {
          collectionLive: false,
          entitled: false,
          active: false,
          reason: 'not_configured',
          readinessStale: false,
          readinessAgeMs: null,
        },
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
    fireEvent.change(screen.getByTestId('payments-tax-jurisdiction'), { target: { value: 'Ontario HST' } });
    fireEvent.change(screen.getByTestId('payments-tax-country'), { target: { value: 'CA' } });
    fireEvent.change(screen.getByTestId('payments-tax-region'), { target: { value: 'ON' } });
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
      forfeitureTaxEstimationEnabled: false,
      jurisdiction: 'Ontario HST',
      country: 'CA',
      region: 'ON',
      scheduledChange: null,
    });
    expect(body.payments.etransfer).toMatchObject({ enabled: false });
  });

  it('loads jurisdiction metadata and explains the gross-only fallback', async () => {
    mockEndpoints({
      payments: {
        tax: {
          enabled: true,
          name: 'HST',
          rateBps: 1300,
          jurisdiction: 'Ontario HST',
          country: 'CA',
          region: 'ON',
          forfeitureTaxEstimationEnabled: true,
        },
      },
    });

    await openPaymentsView();

    expect(screen.getByTestId('payments-tax-jurisdiction')).toHaveValue('Ontario HST');
    expect(screen.getByTestId('payments-tax-country')).toHaveValue('CA');
    expect(screen.getByTestId('payments-tax-region')).toHaveValue('ON');
    expect(screen.getByTestId('payments-tax-forfeiture-estimate')).toBeChecked();
    expect(screen.getByText(/other or missing locations report/i)).toBeInTheDocument();
    expect(screen.getByText(/tax calculations and estimates are based on the settings you enter/i))
      .toBeInTheDocument();
    expect(screen.getByText(/your business is responsible for registration, rates, tax treatment, filing, and remittance/i))
      .toBeInTheDocument();
    expect(screen.getByText(/does not provide tax or accounting advice and does not file taxes/i))
      .toBeInTheDocument();
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
      effectiveFrom: '2026-09-01',
    });
  });

  it('persists the forfeiture estimate as an explicit default-false opt-in', async () => {
    await openPaymentsView();

    fireEvent.click(screen.getByTestId('payments-tax-enabled'));

    expect(screen.getByTestId('payments-tax-forfeiture-estimate')).not.toBeChecked();

    fireEvent.click(screen.getByTestId('payments-tax-forfeiture-estimate'));
    fireEvent.click(screen.getByTestId('payments-save'));

    await waitFor(() => {
      expect(screen.getByText('Payments & taxes saved.')).toBeInTheDocument();
    });
    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    const body = JSON.parse(String((patchCall![1] as RequestInit).body));

    expect(body.payments.tax.forfeitureTaxEstimationEnabled).toBe(true);
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

// =============================================================================
// D3 — the Deposits card (Group G)
// =============================================================================

describe('SettingsModal Deposits card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockEndpoints();
  });

  async function openDeposits(options: Parameters<typeof mockEndpoints>[0] = {}) {
    mockEndpoints(options);
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

  function lastPatchBody() {
    const patchCall = fetchMock.mock.calls
      .filter(call => (call[1] as RequestInit | undefined)?.method === 'PATCH')
      .at(-1)!;
    return JSON.parse(String((patchCall[1] as RequestInit).body));
  }

  it('renders the launch-gate status line off its OWN boolean, not off the reason', async () => {
    await openDeposits();

    expect(screen.getByTestId('deposits-status'))
      .toHaveTextContent('Deposit payments are not switched on yet.');
  });

  it('renders the entitlement gate once collection is live', async () => {
    await openDeposits({
      depositPolicy: {
        collectionLive: true,
        entitled: false,
        active: false,
        reason: 'not_configured',
        readinessStale: false,
        readinessAgeMs: null,
      },
    });

    expect(screen.getByTestId('deposits-status'))
      .toHaveTextContent('Deposits are not enabled for your salon yet.');
  });

  it('renders the DIAGNOSTIC reason in plain language when both gates are open', async () => {
    await openDeposits({
      depositPolicy: {
        collectionLive: true,
        entitled: true,
        active: false,
        reason: 'account_not_charge_ready',
        readinessStale: true,
        readinessAgeMs: 90_000_000,
      },
    });

    expect(screen.getByTestId('deposits-status'))
      .toHaveTextContent('Your payment account cannot accept charges yet.');
    // A NEUTRAL informational line, never a warning affordance: its expected
    // steady-state value is `true` for every enabled salon.
    expect(screen.getByTestId('deposits-readiness-age'))
      .toHaveTextContent('Stripe status last confirmed');
  });

  it('renders both money-bearing sentences from the policy module', async () => {
    await openDeposits({ payments: { deposit: { enabled: false, amountCents: 200_000 } } });

    expect(screen.getByTestId('deposits-clamp-notice'))
      .toHaveTextContent('Bookings under $0.50 are not charged.');
    expect(screen.getByTestId('deposits-recommended-max'))
      .toHaveTextContent('$1,000.00');
  });

  it('DIRTY-FIELD SAVE — an untouched amount is OMITTED from the body entirely', async () => {
    await openDeposits({ payments: { deposit: { enabled: false, amountCents: 50_000 } } });

    // Touch only the toggle.
    fireEvent.click(screen.getByTestId('deposits-enabled'));
    fireEvent.click(screen.getByTestId('deposits-save'));

    await waitFor(() => expect(fetchMock.mock.calls.some(
      call => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    )).toBe(true));

    const body = lastPatchBody();

    // `not.toHaveProperty`, NOT `toBeUndefined()` — the latter passes for a sent
    // `undefined`, and a sent `undefined` is what silently reverts a deliberate
    // correction made in another tab.
    expect(body.payments.deposit).not.toHaveProperty('amountCents');
    expect(body.payments.deposit.enabled).toBe(true);
  });

  it('DIRTY-FIELD SAVE — and the symmetric case for the toggle', async () => {
    await openDeposits({ payments: { deposit: { enabled: true, amountCents: 50_000 } } });

    fireEvent.change(screen.getByTestId('deposits-amount'), { target: { value: '25.00' } });
    fireEvent.click(screen.getByTestId('deposits-save'));

    await waitFor(() => expect(fetchMock.mock.calls.some(
      call => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    )).toBe(true));

    const body = lastPatchBody();

    expect(body.payments.deposit).not.toHaveProperty('enabled');
    expect(body.payments.deposit.amountCents).toBe(2500);
    // Its OWN save action: a deposit save must carry neither tax nor e-Transfer.
    expect(body.payments).not.toHaveProperty('tax');
    expect(body.payments).not.toHaveProperty('etransfer');
  });

  it('disables Save when neither field was touched in this session', async () => {
    await openDeposits({ payments: { deposit: { enabled: false, amountCents: 50_000 } } });

    expect(screen.getByTestId('deposits-save')).toBeDisabled();
  });

  it('SURFACES the refusal body instead of discarding it', async () => {
    await openDeposits({ payments: { deposit: { enabled: false, amountCents: 2500 } } });

    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
      error: 'STRIPE_ACCOUNT_NOT_CHARGE_READY',
      message: 'The payment account cannot accept charges yet.',
    }), { status: 409 })));

    fireEvent.click(screen.getByTestId('deposits-enabled'));
    fireEvent.click(screen.getByTestId('deposits-save'));

    expect(await screen.findByTestId('deposits-error'))
      .toHaveTextContent('The payment account cannot accept charges yet.');
  });
});
