import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SMS_BALANCE_CHANGED_EVENT } from '@/libs/commercialPolicy';

import { UsageBillingModal } from './UsageBillingModal';

vi.mock('./StarterSmsCreditsCard', () => ({ StarterSmsCreditsCard: () => <div>Verify starter allowance</div> }));
const fetchMock = vi.fn();
const offers = [100, 200, 500].map((credits, i) => ({ key: `topup_${credits}_2026_10`, credits, priceCents: [2000, 3000, 5000][i] }));
function response(balance = 42, options: Record<string, unknown> = {}) {
  return Response.json({ data: {
    salonId: 'salon_1',
    creditPurchasesAvailable: true,
    canPurchaseCredits: true,
    topupOffers: offers,
    usage: { availableCredits: balance, starterCredits: 0, pendingCredits: 0, blockedMessages: 0, plan: null },
    history: [{ id: 'reminder_1', channel: 'sms', eventType: 'appointment_reminder', status: 'sent', creditsUsed: 1, recipient: '•••• 1234', sentAt: '2026-10-03T12:00:00Z', scheduledFor: '2026-10-03T12:00:00Z', failureReason: null }],
    nextCursor: null,
    ...options,
  } });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetchMock);
});

describe('Usage & Top Ups', () => {
  it('shows one simple balance, all packages, and settled text usage without subscription sales', async () => {
    render(<UsageBillingModal salonSlug="isla" onClose={vi.fn()} />);

    expect(await screen.findByText('42 texts remaining')).toBeVisible();

    for (const name of ['100 texts', '200 texts', '500 texts']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeEnabled();
    }

    expect(screen.getByText('Best value')).toBeVisible();
    expect(screen.getByText('Appointment reminder')).toBeVisible();
    expect(screen.getByText('1 text')).toBeVisible();
    expect(screen.queryByText('Compare plans')).not.toBeInTheDocument();
    expect(screen.getByText('Purchased texts never expire.')).toBeVisible();
  });

  it.each([0, 8, 20])('shows actionable low balance at %i', async (balance) => {
    fetchMock.mockResolvedValueOnce(response(balance));
    render(<UsageBillingModal salonSlug="isla" onClose={vi.fn()} />);
    await screen.findByText(`${balance} texts remaining`);

    expect(screen.getByRole('link', { name: 'Top up now' })).toHaveAttribute('href', '#buymore-heading');

    if (balance === 0) {
      expect(screen.getByText(/You’re out of text credits/)).toBeVisible();
    }
  });

  it.each([{ creditPurchasesAvailable: false }, { canPurchaseCredits: false }])('preserves operational purchase gates %j', async (options) => {
    fetchMock.mockResolvedValueOnce(response(42, options));
    render(<UsageBillingModal salonSlug="isla" onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /100 texts/ })).toBeDisabled();
  });

  it('submits the authorized salon and server catalog key, and renders checkout rejection', async () => {
    fetchMock.mockImplementation(async url => url === '/api/billing/checkout/topup'
      ? Response.json({ error: { message: 'Purchase unavailable' } }, { status: 503 })
      : response());
    render(<UsageBillingModal salonSlug="isla" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /200 texts/ }));

    expect(await screen.findByText('Purchase unavailable')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/checkout/topup', expect.objectContaining({
      body: JSON.stringify({ salonId: 'salon_1', topupOfferKey: 'topup_200_2026_10' }),
    }));
  });

  it('refreshes settled balance when credits change', async () => {
    const view = render(<UsageBillingModal salonSlug="isla" onClose={vi.fn()} />);
    await screen.findByText('42 texts remaining');
    fetchMock.mockResolvedValueOnce(response(142));
    act(() => window.dispatchEvent(new Event(SMS_BALANCE_CHANGED_EVENT)));

    expect(await screen.findByText('142 texts remaining')).toBeVisible();

    view.unmount();
  });

  it('rejects a late balance from the previous salon', async () => {
    let resolveOld!: (value: Response) => void;
    fetchMock.mockImplementation((url: string) => url.includes('salonSlug=old')
      ? new Promise((resolve) => {
        resolveOld = resolve;
      })
      : Promise.resolve(response(7, { salonId: 'salon_2' })));
    const view = render(<UsageBillingModal salonSlug="old" onClose={vi.fn()} />);
    view.rerender(<UsageBillingModal salonSlug="new" onClose={vi.fn()} />);
    await screen.findByText('7 texts remaining');
    await act(async () => resolveOld(response(999)));

    expect(screen.queryByText('999 texts remaining')).not.toBeInTheDocument();
  });

  it('paginates real usage and preserves it when the first page refreshes', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('cursor=')
      ? response(42, { history: [{ id: 'review_1', channel: 'sms', eventType: 'review_request', status: 'failed', creditsUsed: 0, recipient: '•••• 1111', sentAt: null, scheduledFor: '2026-10-01T12:00:00Z', failureReason: null }] })
      : response(42, { nextCursor: 'cursor_1' }));
    render(<UsageBillingModal salonSlug="isla" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByText('Review request');

    expect(screen.getByText('No credits used')).toBeVisible();

    act(() => window.dispatchEvent(new Event(SMS_BALANCE_CHANGED_EVENT)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(screen.getByText('Review request')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});
