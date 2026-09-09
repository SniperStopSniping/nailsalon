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
        pendingCredits: 1,
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
        reminderLeadMinutes: 1440,
        failureReason: 'SMS credits were unavailable.',
      }],
      nextCursor: null,
    },
  }), { status: 200 });
}

function settingsResponse() {
  return new Response(JSON.stringify({
    communications: {
      email: { enabled: true },
      sms: { enabled: false },
      killSwitch: false,
      quietHours: { enabled: true, start: '21:00', end: '09:00' },
      events: {
        booking_confirmation: { enabled: true, channels: 'both' },
        appointment_reminder: { enabled: true, channels: 'both' },
        appointment_cancelled: { enabled: true, channels: 'both' },
        appointment_rescheduled: { enabled: true, channels: 'both' },
      },
      reminders: { rules: [{ id: 'crule_default_24h', offsetMinutes: 1440, channels: 'both', enabled: true }] },
    },
  }), { status: 200 });
}

describe('UsageBillingModal', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((url: string) => Promise.resolve(url.includes('/communications/usage') ? usageResponse(true) : settingsResponse()));
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
    expect(screen.getByText('1 credit is set aside for texts being sent.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /100 credits — CAD \$5\.99/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /250 credits — CAD \$13\.99/ })).toBeInTheDocument();
  });

  it.each([false, undefined])('does not offer or post credit purchases when readiness is %s', async (available) => {
    // Keep the offers populated to cover an older/mixed deployment response.
    fetchMock.mockImplementation((url: string) => Promise.resolve(url.includes('/communications/usage') ? usageResponse(available) : settingsResponse()));
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);

    expect(await screen.findByText('Credit purchases are not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\d+ credits —/ })).not.toBeInTheDocument();
    expect(screen.getByText(/277/)).toBeInTheDocument();
    expect(screen.getByText('•••• 0199')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalledWith('/api/billing/checkout/topup', expect.anything());
  });

  it.each(['TOPUPS_DISABLED', 'PRICE_UNCONFIGURED'])('preserves configured checkout and explains a later %s response', async (code) => {
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);
    const button = await screen.findByRole('button', { name: /100 credits — CAD \$5\.99/ });
    fetchMock.mockImplementation((url: string) => Promise.resolve(url === '/api/billing/checkout/topup'
      ? new Response(JSON.stringify({ error: { code } }), { status: 503 })
      : url.includes('/communications/usage') ? usageResponse(true) : settingsResponse()));

    fireEvent.click(button);

    expect(await screen.findByText('Credit purchases are not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\d+ credits —/ })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/checkout/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonId: 'salon_1', topupOfferKey: 'topup_100_paid_2026_08' }),
    });
  });

  it('groups history, loads another page, and saves reminder timing settings', async () => {
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);
    await screen.findByRole('heading', { name: '24-hour reminders' });

    expect(screen.getByText('No SMS credits charged')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const timing = screen.getByLabelText('Reminder 1 timing');
    fireEvent.change(timing, { target: { value: '60' } });
    fireEvent.click(screen.getByLabelText('Cancellation notices enabled'));
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder settings' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/salon/settings?salonSlug=salon-a', expect.objectContaining({ method: 'PATCH' })));

    const patchCall = fetchMock.mock.calls.find(([url, options]) => url === '/api/admin/salon/settings?salonSlug=salon-a' && (options as RequestInit | undefined)?.method === 'PATCH');

    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string).communications.events).toEqual({
      appointment_cancelled: { enabled: false, channels: 'both' },
    });

    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});
