/**
 * Usage & Billing modal — §10.2 presentation proofs: one primary number
 * first, plain-language breakdown, blocked-credits notice with the email
 * reassurance, and history rendered exactly as the API masked it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageBillingModal } from './UsageBillingModal';

const fetchMock = vi.hoisted(() => vi.fn());

function usageResponse(creditPurchasesAvailable: boolean | undefined) {
  return new Response(JSON.stringify({
    data: {
      salonId: 'salon_1',
      creditPurchasesAvailable,
      topupOffers: [
        { key: 'topup_100_paid_2026_08', credits: 100, priceCents: 599 },
        { key: 'topup_250_paid_2026_08', credits: 250, priceCents: 1399 },
      ],
      usage: {
        availableCredits: 277,
        monthlyCredits: 277,
        starterCredits: 73,
        purchasedCredits: 250,
        bonusCredits: 0,
        monthlyAllowance: 400,
        resetsAt: '2026-09-01T00:00:00.000Z',
        blockedMessages: 2,
        plan: {
          displayName: 'Pro',
          cadence: 'monthly',
          status: 'active',
          paidThrough: '2026-09-01T00:00:00.000Z',
          cancelAtPeriodEnd: false,
        },
      },
      history: [{
        id: 'ci_1',
        channel: 'sms',
        eventType: 'appointment_reminder',
        recipient: '•••• 0199',
        status: 'blocked_no_credit',
        scheduledFor: '2026-08-30T13:00:00.000Z',
        sentAt: null,
        creditsUsed: 0,
        failureReason: 'SMS credits were unavailable.',
      }],
      nextCursor: null,
    },
  }), { status: 200 });
}

describe('UsageBillingModal', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(usageResponse(true));
  });

  it('leads with the primary total and speaks the owner vocabulary (§10.2)', async () => {
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/277/)).toBeInTheDocument();
    });

    expect(screen.getByText(/SMS credits remaining/)).toBeInTheDocument();
    expect(screen.getByText(/123 of 400 monthly credits used/)).toBeInTheDocument();
    expect(screen.getByText(/73 starter credits \(do not renew\)/)).toBeInTheDocument();
    expect(screen.getByText(/250 purchased credits \(never expire\)/)).toBeInTheDocument();
    expect(screen.getByText(/Email confirmations and reminders are always included/)).toBeInTheDocument();
    // Blocked notice carries the email reassurance.
    expect(screen.getByText(/2\s+texts are\s+waiting for credits/)).toBeInTheDocument();
    // History is masked and friendly — no raw phone anywhere.
    expect(screen.getByText('•••• 0199')).toBeInTheDocument();
    expect(screen.getByText('SMS credits were unavailable.')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('4165550199');
    // No internal ledger vocabulary leaks.
    expect(document.body.innerHTML).not.toMatch(/lot|reservation|ledger|debit/i);
    // Buy More renders the server-resolved offers (§9.6) — real buttons, no
    // client-side catalogue.
    expect(screen.getByRole('button', { name: /100 credits — \$5\.99/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /250 credits — \$13\.99/ })).toBeInTheDocument();
  });

  it.each([false, undefined])('does not offer or post credit purchases when readiness is %s', async (available) => {
    // Keep the offers populated to cover an older/mixed deployment response.
    fetchMock.mockResolvedValue(usageResponse(available));
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);

    expect(await screen.findByText('Credit purchases are not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\d+ credits —/ })).not.toBeInTheDocument();
    expect(screen.getByText(/277/)).toBeInTheDocument();
    expect(screen.getByText('•••• 0199')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/billing/checkout/topup', expect.anything());
  });

  it.each(['TOPUPS_DISABLED', 'PRICE_UNCONFIGURED'])('preserves configured checkout and explains a later %s response', async (code) => {
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);
    const button = await screen.findByRole('button', { name: /100 credits — \$5\.99/ });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code } }), { status: 503 }));

    fireEvent.click(button);

    expect(await screen.findByText('Credit purchases are not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\d+ credits —/ })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/checkout/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonId: 'salon_1', topupOfferKey: 'topup_100_paid_2026_08' }),
    });
  });
});
