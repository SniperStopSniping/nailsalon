import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SMS_CREDITS_CHANGED_EVENT, smsCreditStatus } from '@/libs/smsCreditStatus';

import { SmsBalanceCard } from './SmsBalanceCard';
import { SmsCreditsModal } from './SmsCreditsModal';

vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ openUserProfile: vi.fn() }), useUser: () => ({ user: null }) }));

const fetchMock = vi.fn();
function response(remaining = 18, options: { allocation?: number | null; salonId?: string; canPurchase?: boolean } = {}) {
  return new Response(JSON.stringify({ data: {
    salonId: options.salonId ?? 'salon_fixture',
    canPurchase: options.canPurchase ?? true,
    creditPurchasesAvailable: true,
    balance: { availableCredits: remaining, allocationCredits: 'allocation' in options ? options.allocation : 100, pendingCredits: 0, status: smsCreditStatus(remaining), totalPurchased: 500, usedThisMonth: 82, timeZone: 'America/Toronto', lastPurchaseOfferKey: 'topup_500_2026_10' },
    topupOffers: [{ key: 'topup_100_2026_10', credits: 100, priceCents: 2000, currency: 'cad', available: true }, { key: 'topup_200_2026_10', credits: 200, priceCents: 3000, currency: 'cad', available: true }, { key: 'topup_500_2026_10', credits: 500, priceCents: 5000, currency: 'cad', available: true }],
    activity: { items: [], nextCursor: null },
  } }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('owner SMS card and purchase UI', () => {
  it('identifies Today, More purchase and More history focus targets for the active salon', async () => {
    fetchMock.mockImplementation(async () => response(0));
    render(
      <>
        <SmsBalanceCard compact salonSlug="a" onBuy={vi.fn()} />
        <SmsBalanceCard salonSlug="a" onBuy={vi.fn()} onHistory={vi.fn()} />
      </>,
    );

    expect(await screen.findByRole('button', { name: 'Buy texts' })).toHaveAttribute('data-dialog-return-focus-key', 'sms:a:today:topup');
    expect(screen.getByRole('button', { name: 'Buy More Texts' })).toHaveAttribute('data-dialog-return-focus-key', 'sms:a:more:topup');
    expect(screen.getByRole('button', { name: 'View usage history' })).toHaveAttribute('data-dialog-return-focus-key', 'sms:a:more:history');
  });

  it.each([[100, 'You’re all set.'], [25, 'Running low'], [10, 'Almost out'], [0, 'Out of texts']])('shows accurate status for %s credits', async (amount, status) => {
    fetchMock.mockImplementation(async () => response(Number(amount)));
    render(<SmsBalanceCard salonSlug="a" onBuy={vi.fn()} onHistory={vi.fn()} />);

    expect(await screen.findByText(String(status))).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(amount));

    if (amount === 0) {
      expect(screen.getByText(/Online booking, email and your core app remain available/)).toBeInTheDocument();
    }
  });

  it('omits an unknown denominator and never invents a percentage', async () => {
    fetchMock.mockImplementation(async () => response(1500, { allocation: null }));
    render(<SmsBalanceCard salonSlug="a" onBuy={vi.fn()} />);

    expect(await screen.findByText('1,500')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/of 100/)).not.toBeInTheDocument();
  });

  it('shows no fabricated zero on failure and retries', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 })).mockImplementation(async () => response(40));
    render(<SmsBalanceCard salonSlug="a" onBuy={vi.fn()} />);

    expect(await screen.findByText('Your balance is unavailable right now.')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('40')).toBeInTheDocument();
  });

  it('never displays another salon’s balance during a switch or late response', async () => {
    let resolveA!: (value: Response) => void;
    fetchMock.mockImplementation((url: string) => url.includes('salonSlug=a')
      ? new Promise((resolve) => {
        resolveA = resolve;
      })
      : Promise.resolve(response(7, { salonId: 'b' })));
    const { rerender } = render(<SmsBalanceCard salonSlug="a" onBuy={vi.fn()} />);
    rerender(<SmsBalanceCard salonSlug="b" onBuy={vi.fn()} />);

    expect(await screen.findByText('7')).toBeInTheDocument();

    await act(async () => resolveA(response(999, { salonId: 'a' })));

    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });

  it('refreshes after credit changes and exposes a direct Today top-up action only at ten or less', async () => {
    fetchMock.mockImplementation(async () => response(11));
    const buy = vi.fn();
    render(<SmsBalanceCard compact salonSlug="a" onBuy={buy} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    fetchMock.mockImplementation(async () => response(10));
    act(() => window.dispatchEvent(new Event(SMS_CREDITS_CHANGED_EVENT)));
    fireEvent.click(await screen.findByRole('button', { name: /Buy texts/ }));

    expect(buy).toHaveBeenCalledOnce();
  });

  it('uses current packages, marks last purchase, and posts only salon and offer keys', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/checkout/') ? new Response(JSON.stringify({ error: { code: 'PAYMENT_FAILED' } }), { status: 500 }) : response());
    render(<SmsCreditsModal salonSlug="a" initialView="topup" onClose={vi.fn()} />);

    expect(await screen.findByText('Best Value')).toBeInTheDocument();
    expect(screen.getByText('Your last purchase')).toBeInTheDocument();
    expect(screen.getByText('$0.10 per text credit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Buy 200 texts/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start the purchase.');
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/checkout/topup', expect.objectContaining({ body: JSON.stringify({ salonId: 'salon_fixture', topupOfferKey: 'topup_200_2026_10' }) }));
  });

  it('shows the history summary and empty state without private messages', async () => {
    fetchMock.mockImplementation(async () => response());
    render(<SmsCreditsModal salonSlug="a" initialView="history" onClose={vi.fn()} />);

    expect(await screen.findByText('Total credits purchased')).toBeInTheDocument();
    expect(screen.getByText(/No text credit activity yet/)).toBeInTheDocument();
  });

  it('does not offer a purchase to a non-owner', async () => {
    fetchMock.mockImplementation(async () => response(0, { canPurchase: false }));
    render(<SmsCreditsModal salonSlug="a" initialView="topup" onClose={vi.fn()} />);

    expect(await screen.findByText(/Only the salon owner can purchase/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Buy 100 texts/ })).toBeDisabled();
  });
});
