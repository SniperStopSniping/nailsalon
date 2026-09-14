/**
 * Choose plan panel — P7 proofs.
 *
 * Cards render straight from the mocked usage/billing-status payload (never
 * a client-side price mirror — repricing on the server must be visible here
 * with no client change). While `capabilities.subscriptions` is false the
 * surface stays informational with the existing contact sentence and no
 * Choose buttons (dark-safe, §12). Once true, clicking Choose starts a real
 * Checkout via `POST /api/billing/checkout` and walks to a confirmation step
 * rendering the server's disclosure verbatim before redirecting; a founding
 * promotion is sent only for an eligible annual offer and the confirmation
 * discloses the first-term-only note; `ACTIVE_SUBSCRIPTION_EXISTS` hands off
 * to the existing Billing Portal flow; other errors show the server's
 * (already masked) message.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChoosePlanPanel } from './ChoosePlanPanel';

const fetchMock = vi.hoisted(() => vi.fn());

const PLANS = [
  { key: 'starter_2026_08', family: 'starter', displayName: 'Starter', monthlySmsCredits: 200, starterCreditsOneTime: 100, transactionalEmailIncluded: true as const },
  { key: 'pro_2026_08', family: 'pro', displayName: 'Pro', monthlySmsCredits: 400, starterCreditsOneTime: 100, transactionalEmailIncluded: true as const },
  { key: 'elite_2026_08', family: 'elite', displayName: 'Elite', monthlySmsCredits: 800, starterCreditsOneTime: 100, transactionalEmailIncluded: true as const },
];

const OFFERS = [
  { key: 'starter_2026_08_monthly', planDefinitionKey: 'starter_2026_08', cadence: 'monthly' as const, priceCents: 1499, currency: 'cad' as const },
  { key: 'starter_2026_08_annual', planDefinitionKey: 'starter_2026_08', cadence: 'annual' as const, priceCents: 14990, currency: 'cad' as const },
  { key: 'pro_2026_08_monthly', planDefinitionKey: 'pro_2026_08', cadence: 'monthly' as const, priceCents: 2499, currency: 'cad' as const },
  { key: 'pro_2026_08_annual', planDefinitionKey: 'pro_2026_08', cadence: 'annual' as const, priceCents: 24990, currency: 'cad' as const },
  { key: 'elite_2026_08_monthly', planDefinitionKey: 'elite_2026_08', cadence: 'monthly' as const, priceCents: 4499, currency: 'cad' as const },
  { key: 'elite_2026_08_annual', planDefinitionKey: 'elite_2026_08', cadence: 'annual' as const, priceCents: 44990, currency: 'cad' as const },
];

type FoundingFixture = {
  key: string;
  percentOff: number;
  rateProtectionMonths: number;
  eligibleOfferKeys: string[];
  endsAt: string | null;
} | null;

function usageResponse(overrides: { subscriptions?: boolean; founding?: FoundingFixture } = {}) {
  return new Response(JSON.stringify({
    data: {
      salonId: 'salon_1',
      capabilities: {
        subscriptions: overrides.subscriptions ?? false,
        topups: false,
        pricingPublic: false,
      },
      catalog: {
        plans: PLANS,
        offers: OFFERS,
        founding: overrides.founding ?? null,
      },
      usage: {
        availableCredits: 0,
        monthlyCredits: 0,
        starterCredits: 0,
        purchasedCredits: 0,
        bonusCredits: 0,
        monthlyAllowance: 0,
        resetsAt: null,
        blockedMessages: 0,
        plan: null,
      },
      history: [],
      nextCursor: null,
      topupOffers: [],
      creditPurchasesAvailable: false,
    },
  }), { status: 200 });
}

function mockUsage(overrides: { subscriptions?: boolean; founding?: FoundingFixture } = {}) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/admin/salon/communications/usage')) {
      return usageResponse(overrides);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('dark (capabilities.subscriptions is false)', () => {
  it('renders the exact catalogue numbers, no Choose buttons, and the contact sentence', async () => {
    mockUsage({ subscriptions: false });

    render(<ChoosePlanPanel salonSlug="salon-a" onClose={vi.fn()} />);

    expect(await screen.findByText('$14.99')).toBeInTheDocument();
    expect(screen.getByText('$24.99')).toBeInTheDocument();
    expect(screen.getByText('$44.99')).toBeInTheDocument();
    expect(screen.getByText(/200 SMS credits \/ month/)).toBeInTheDocument();
    expect(screen.getByText(/400 SMS credits \/ month/)).toBeInTheDocument();
    expect(screen.getByText(/800 SMS credits \/ month/)).toBeInTheDocument();
    expect(screen.getByText('$149.90 / year (10 monthly payments)')).toBeInTheDocument();
    expect(screen.getByText('$249.90 / year (10 monthly payments)')).toBeInTheDocument();
    expect(screen.getByText('$449.90 / year (10 monthly payments)')).toBeInTheDocument();
    expect(screen.getAllByText('Email confirmations and reminders included')).toHaveLength(3);

    expect(screen.queryByTestId('choose-plan-monthly-starter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('choose-plan-annual-starter')).not.toBeInTheDocument();
    expect(screen.getByText('To change plans, contact Luster at support@lustergel.app')).toBeInTheDocument();
  });
});

describe('enabled (capabilities.subscriptions is true)', () => {
  it('shows Choose buttons and walks a monthly checkout to the disclosure confirmation', async () => {
    mockUsage({ subscriptions: true });

    render(<ChoosePlanPanel salonSlug="salon-a" onClose={vi.fn()} />);

    const button = await screen.findByTestId('choose-plan-monthly-starter');

    expect(screen.queryByText('To change plans, contact Luster at support@lustergel.app')).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        url: 'https://checkout.stripe.com/session_123',
        disclosure: {
          billingOfferKey: 'starter_2026_08_monthly',
          planDefinitionKey: 'starter_2026_08',
          cadence: 'monthly',
          currency: 'cad',
          firstTermCents: 1499,
          renewalCents: 1499,
        },
      },
    }), { status: 200 }));

    fireEvent.click(button);

    expect(await screen.findByTestId('choose-plan-confirmation')).toBeInTheDocument();
    // No discount on this offer — "charged now" and "renews at" are both
    // $14.99, so two distinct <strong> elements legitimately carry the same
    // text.
    expect(screen.getAllByText('$14.99')).toHaveLength(2);
    expect(screen.getByText(/Renews at/)).toBeInTheDocument();
    expect(screen.queryByText(/protected for/)).not.toBeInTheDocument();
    expect(screen.queryByText(/first annual term only/)).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenLastCalledWith('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonId: 'salon_1', billingOfferKey: 'starter_2026_08_monthly' }),
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    fireEvent.click(screen.getByTestId('choose-plan-continue'));
    // jsdom cannot navigate; the redirect target is proven via the disclosure
    // + url the panel received, mirroring the existing portal-redirect test
    // pattern elsewhere in this codebase.
  });

  it('returns to the cards from the confirmation step on Back', async () => {
    mockUsage({ subscriptions: true });
    render(<ChoosePlanPanel salonSlug="salon-a" onClose={vi.fn()} />);

    const button = await screen.findByTestId('choose-plan-monthly-pro');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        url: 'https://checkout.stripe.com/session_789',
        disclosure: {
          billingOfferKey: 'pro_2026_08_monthly',
          planDefinitionKey: 'pro_2026_08',
          cadence: 'monthly',
          currency: 'cad',
          firstTermCents: 2499,
          renewalCents: 2499,
        },
      },
    }), { status: 200 }));
    fireEvent.click(button);

    await screen.findByTestId('choose-plan-confirmation');
    fireEvent.click(screen.getByTestId('choose-plan-back'));

    expect(screen.queryByTestId('choose-plan-confirmation')).not.toBeInTheDocument();
    expect(await screen.findByTestId('choose-plan-monthly-pro')).toBeInTheDocument();
  });

  it('sends the founding promotionKey only for an eligible annual offer and discloses the first-term-only note', async () => {
    mockUsage({
      subscriptions: true,
      founding: {
        key: 'founding_annual_2026',
        percentOff: 40,
        rateProtectionMonths: 24,
        eligibleOfferKeys: ['starter_2026_08_annual', 'pro_2026_08_annual', 'elite_2026_08_annual'],
        endsAt: '2026-12-31T00:00:00.000Z',
      },
    });

    render(<ChoosePlanPanel salonSlug="salon-a" onClose={vi.fn()} />);

    const annualButton = await screen.findByTestId('choose-plan-annual-starter');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        url: 'https://checkout.stripe.com/session_456',
        disclosure: {
          billingOfferKey: 'starter_2026_08_annual',
          planDefinitionKey: 'starter_2026_08',
          cadence: 'annual',
          currency: 'cad',
          firstTermCents: 8994,
          renewalCents: 14990,
          promotionKey: 'founding_annual_2026',
          rateProtectionMonths: 24,
        },
      },
    }), { status: 200 }));

    fireEvent.click(annualButton);

    await screen.findByTestId('choose-plan-confirmation');

    expect(fetchMock).toHaveBeenLastCalledWith('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonId: 'salon_1',
        billingOfferKey: 'starter_2026_08_annual',
        promotionKey: 'founding_annual_2026',
      }),
    });
    expect(screen.getByText('$89.94')).toBeInTheDocument();
    expect(screen.getByText(/protected for 24 months/)).toBeInTheDocument();
    expect(screen.getByText(/first annual term only/)).toBeInTheDocument();
  });

  it('does not send a promotionKey for a monthly offer even when the founding promotion is open', async () => {
    mockUsage({
      subscriptions: true,
      founding: {
        key: 'founding_annual_2026',
        percentOff: 40,
        rateProtectionMonths: 24,
        eligibleOfferKeys: ['starter_2026_08_annual', 'pro_2026_08_annual', 'elite_2026_08_annual'],
        endsAt: '2026-12-31T00:00:00.000Z',
      },
    });

    render(<ChoosePlanPanel salonSlug="salon-a" onClose={vi.fn()} />);

    const monthlyButton = await screen.findByTestId('choose-plan-monthly-starter');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        url: 'https://checkout.stripe.com/session_999',
        disclosure: {
          billingOfferKey: 'starter_2026_08_monthly',
          planDefinitionKey: 'starter_2026_08',
          cadence: 'monthly',
          currency: 'cad',
          firstTermCents: 1499,
          renewalCents: 1499,
        },
      },
    }), { status: 200 }));

    fireEvent.click(monthlyButton);

    await screen.findByTestId('choose-plan-confirmation');

    expect(fetchMock).toHaveBeenLastCalledWith('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonId: 'salon_1', billingOfferKey: 'starter_2026_08_monthly' }),
    });
  });

  it('ACTIVE_SUBSCRIPTION_EXISTS shows the server message and hands off to Manage billing', async () => {
    mockUsage({ subscriptions: true });
    render(<ChoosePlanPanel salonSlug="salon-a" onClose={vi.fn()} />);

    const button = await screen.findByTestId('choose-plan-monthly-pro');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: 'ACTIVE_SUBSCRIPTION_EXISTS',
        message: 'This salon already has a live subscription. Manage it in the Billing Portal.',
      },
    }), { status: 409 }));

    fireEvent.click(button);

    expect(await screen.findByText(
      'This salon already has a live subscription. Manage it in the Billing Portal.',
    )).toBeInTheDocument();
    expect(screen.queryByTestId('choose-plan-card-pro')).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      url: 'https://billing.stripe.com/session/portal',
    }), { status: 200 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fireEvent.click(screen.getByTestId('choose-plan-manage-billing'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: 'salon_1' }),
      });
    });
  });

  it('shows the (already masked) server message for other checkout errors', async () => {
    mockUsage({ subscriptions: true });
    render(<ChoosePlanPanel salonSlug="salon-a" onClose={vi.fn()} />);

    const button = await screen.findByTestId('choose-plan-monthly-elite');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'PRICE_UNCONFIGURED', message: 'Billing prices are not configured in this environment.' },
    }), { status: 503 }));

    fireEvent.click(button);

    expect(await screen.findByTestId('choose-plan-error')).toHaveTextContent(
      'Billing prices are not configured in this environment.',
    );
    expect(screen.queryByTestId('choose-plan-confirmation')).not.toBeInTheDocument();
  });
});
