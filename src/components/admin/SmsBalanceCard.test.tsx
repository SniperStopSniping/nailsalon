import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SmsCreditActivity } from '@/hooks/useSmsCredits';
import { SMS_CREDITS_CHANGED_EVENT, smsCreditStatus } from '@/libs/smsCreditStatus';

import { SmsBalanceCard } from './SmsBalanceCard';
import { SmsCreditsModal } from './SmsCreditsModal';

const clerkMocks = vi.hoisted(() => ({ openUserProfile: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ openUserProfile: clerkMocks.openUserProfile }), useUser: () => ({ user: null }) }));

const fetchMock = vi.fn();
function response(remaining = 18, options: { allocation?: number | null; salonId?: string; canPurchase?: boolean; activity?: SmsCreditActivity[] } = {}) {
  return new Response(JSON.stringify({ data: {
    salonId: options.salonId ?? 'salon_fixture',
    canPurchase: options.canPurchase ?? true,
    creditPurchasesAvailable: true,
    balance: { availableCredits: remaining, allocationCredits: 'allocation' in options ? options.allocation : 100, pendingCredits: 0, status: smsCreditStatus(remaining), totalPurchased: 500, usedThisMonth: 82, timeZone: 'America/Toronto', lastPurchaseOfferKey: 'topup_500_2026_10' },
    topupOffers: [{ key: 'topup_100_2026_10', credits: 100, priceCents: 2000, currency: 'cad', available: true }, { key: 'topup_200_2026_10', credits: 200, priceCents: 3000, currency: 'cad', available: true }, { key: 'topup_500_2026_10', credits: 500, priceCents: 5000, currency: 'cad', available: true }],
    activity: { items: options.activity ?? [], nextCursor: null },
  } }));
}

beforeEach(() => {
  fetchMock.mockReset();
  clerkMocks.openUserProfile.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('owner SMS card and purchase UI', () => {
  it('identifies Today, More purchase and More history focus targets for the active salon', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/starter-credits')
      ? new Response(JSON.stringify({ data: { status: 'verified', canClaim: false } }))
      : response(0));
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

  it('leads a new zero-balance owner to claim free texts and verify contacts, without opening checkout', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/starter-credits')
      ? new Response(JSON.stringify({ data: { status: 'unclaimed', canClaim: true, verification: { email: true, phone: false } } }))
      : response(0));
    const buy = vi.fn();
    render(<SmsBalanceCard compact salonSlug="new-salon" onBuy={buy} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Claim 100 free texts' }));

    expect(clerkMocks.openUserProfile).toHaveBeenCalledOnce();
    expect(screen.queryByText('0 texts remaining')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buy texts' })).not.toBeInTheDocument();
    expect(buy).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });

  it('claims from Today after verification and refreshes the real balance', async () => {
    let remaining = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/starter-credits')) {
        if (init?.method === 'POST') {
          remaining = 100;
          return new Response(JSON.stringify({ data: { status: 'granted', granted: true } }));
        }
        return new Response(JSON.stringify({ data: { status: 'unclaimed', canClaim: true, verification: { email: true, phone: true } } }));
      }
      return response(remaining);
    });
    render(<SmsBalanceCard compact salonSlug="new-salon" onBuy={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Claim 100 free texts' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Verifying…' })).not.toBeInTheDocument());

    expect(remaining).toBe(100);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/salon/communications/starter-credits', expect.objectContaining({ body: JSON.stringify({ salonId: 'salon_fixture' }), method: 'POST' }));
    expect(screen.queryByRole('button', { name: 'Buy texts' })).not.toBeInTheDocument();
  });

  it.each(['verified', 'unclaimed'])('keeps the purchase path when %s cannot be claimed by this viewer', async (status) => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/starter-credits')
      ? new Response(JSON.stringify({ data: { status, canClaim: false } }))
      : response(0));
    const buy = vi.fn();
    render(<SmsBalanceCard compact salonSlug="existing-salon" onBuy={buy} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Buy texts' }));

    expect(screen.queryByRole('button', { name: 'Claim 100 free texts' })).not.toBeInTheDocument();
    expect(buy).toHaveBeenCalledOnce();
  });

  it('does not infer claim eligibility from a zero balance when its status request fails', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/starter-credits') ? new Response('', { status: 503 }) : response(0));
    render(<SmsBalanceCard compact salonSlug="new-salon" onBuy={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Retry status check' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim 100 free texts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buy texts' })).not.toBeInTheDocument();
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

  it.each([
    [1, '+1 credit'],
    [-1, '−1 credit'],
    [2, '+2 credits'],
    [-2, '−2 credits'],
    [10000, '+10,000 credits'],
    [-10000, '−10,000 credits'],
    [0, '−0 credits'],
  ])('labels %s history credits without changing the amount or sign', async (credits, label) => {
    fetchMock.mockImplementation(async () => response(18, { activity: [{ id: 'activity_fixture', type: 'sms_debit', bucket: 'purchased', credits: Number(credits), eventType: 'appointment_reminder', createdAt: '2026-10-08T14:00:00Z' }] }));
    render(<SmsCreditsModal salonSlug="a" initialView="history" onClose={vi.fn()} />);

    const item = await screen.findByRole('listitem');

    expect(item).toHaveTextContent(new RegExp(`${String(label).replace('+', '\\+').replace(' ', '\\s*')}$`));
    expect(item).toHaveTextContent('Appointment reminder');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/salon/communications/usage?salonSlug=a&view=credits', expect.objectContaining({ cache: 'no-store' }));
  });
});
