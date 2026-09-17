/**
 * Usage & Billing modal — §10.2 presentation proofs (one primary number
 * first, plain-language breakdown, blocked-credits notice, history exactly
 * as the API masked it), plus P5a additions: the §6.5a status banner
 * (G18) and the Top-ups section (G17) read from /api/billing/topups.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageBillingModal } from './UsageBillingModal';

const fetchMock = vi.hoisted(() => vi.fn());

type PlanOverride = {
  displayName: string;
  cadence: string;
  status: string;
  paidThrough: string;
  cancelAtPeriodEnd: boolean;
  entitlement: {
    status: string;
    paidThrough: string | null;
    grantsEligible: boolean;
    label: string;
  };
} | null;

const ACTIVE_PLAN: PlanOverride = {
  displayName: 'Pro',
  cadence: 'monthly',
  status: 'active',
  paidThrough: '2026-09-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  entitlement: {
    status: 'active',
    paidThrough: '2026-09-01T00:00:00.000Z',
    grantsEligible: true,
    label: 'Active',
  },
};

function usageResponse(overrides: {
  creditPurchasesAvailable?: boolean;
  plan?: PlanOverride;
  pendingCredits?: number;
  history?: Array<Record<string, unknown>>;
  nextCursor?: string | null;
} = {}) {
  // Distinguish "key omitted -> default true" from "key present but
  // explicitly undefined" (simulating an older/mixed deployment payload) —
  // a plain `?? true` would collapse both to true and defeat the
  // it.each([false, undefined]) case below.
  const creditPurchasesAvailable = 'creditPurchasesAvailable' in overrides
    ? overrides.creditPurchasesAvailable
    : true;
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
        pendingCredits: overrides.pendingCredits ?? 0,
        plan: overrides.plan !== undefined ? overrides.plan : ACTIVE_PLAN,
      },
      history: overrides.history ?? [{
        id: 'ci_1',
        channel: 'sms',
        eventType: 'appointment_reminder',
        recipient: '•••• 0199',
        status: 'blocked_no_credit',
        scheduledFor: '2026-08-30T13:00:00.000Z',
        sentAt: null,
        creditsUsed: 0,
        reminderLeadMinutes: null,
        failureReason: 'SMS credits were unavailable.',
      }],
      nextCursor: 'nextCursor' in overrides ? overrides.nextCursor : null,
    },
  }), { status: 200 });
}

type TopupItemFixture = {
  id: string;
  offerKey: string;
  credits: number;
  priceCents: number;
  currency: string;
  status: 'pending' | 'fulfilled' | 'expired' | 'refunded' | 'disputed' | 'reversed';
  holdState: 'held' | null;
  createdAt: string;
  fulfilledAt: string | null;
  reversedAt: string | null;
};

function topupsResponse(payload: { available: boolean; items?: TopupItemFixture[]; nextCursor?: string | null }) {
  return new Response(JSON.stringify({
    available: payload.available,
    items: payload.items ?? [],
    nextCursor: payload.nextCursor ?? null,
  }), { status: 200 });
}

/** Default routing: usage → active plan, topups → available with no rows. */
function mockDefaultFetch() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/admin/salon/communications/usage')) {
      return usageResponse();
    }
    if (url.startsWith('/api/billing/topups')) {
      return topupsResponse({ available: true, items: [] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe('UsageBillingModal', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockDefaultFetch();
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

    // Active plan: no §6.5a banner, and the empty Top-ups state is visible.
    await screen.findByText('No top-ups yet.');

    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it.each([false, undefined])('does not offer or post credit purchases when readiness is %s', async (available) => {
    // Keep the offers populated to cover an older/mixed deployment response.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/salon/communications/usage')) {
        return usageResponse({ creditPurchasesAvailable: available });
      }
      if (url.startsWith('/api/billing/topups')) {
        return topupsResponse({ available: true, items: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);

    expect(await screen.findByText('Credit purchases are not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\d+ credits —/ })).not.toBeInTheDocument();
    expect(screen.getByText(/277/)).toBeInTheDocument();
    expect(screen.getByText('•••• 0199')).toBeInTheDocument();

    // Usage + top-ups: exactly the two GET reads this mount makes.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock).not.toHaveBeenCalledWith('/api/billing/checkout/topup', expect.anything());
  });

  it('posts the real salonId (not undefined) when opening the Billing Portal (G20)', async () => {
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);
    const button = await screen.findByRole('button', { name: 'Manage billing' });
    // No `url` in the response: the test asserts the outgoing request body,
    // not the redirect, and must not exercise jsdom's unimplemented navigation.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: 'salon_1', salonSlug: 'salon-a' }),
      });
    });
  });

  // OP-1 (2026-09-16): the Portal route has no dark switch, so it is live for
  // legacy-flow customers today. A collaborator who is not the owner now gets
  // `403 OWNER_REQUIRED` there — and before this, the button simply flipped
  // back to its idle label and said nothing, which reads as a broken button.
  it('shows the Portal refusal instead of failing silently', async () => {
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);
    const button = await screen.findByRole('button', { name: 'Manage billing' });
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'OWNER_REQUIRED', message: 'Only the salon owner can manage billing.' } }),
      { status: 403 },
    ));

    fireEvent.click(button);

    expect(await screen.findByText('Only the salon owner can manage billing.')).toBeInTheDocument();
    // The button returns to its idle label rather than sticking on "Opening…".
    expect(await screen.findByRole('button', { name: 'Manage billing' })).toBeEnabled();
  });

  // OP-1 / OP-2: neither refusal is fixed by retrying, so neither may be
  // reported as "Please try again."
  it.each([
    ['OWNER_REQUIRED', 'Only the salon owner can buy credits.'],
    ['CHECKOUT_IN_PROGRESS', 'A checkout for a different plan is already open for this salon.'],
  ])('surfaces the %s refusal verbatim rather than a retry prompt', async (code, message) => {
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);
    const button = await screen.findByRole('button', { name: /100 credits — \$5\.99/ });
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ error: { code, message } }),
      { status: code === 'OWNER_REQUIRED' ? 403 : 409 },
    ));

    fireEvent.click(button);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Could not start the purchase. Please try again.')).not.toBeInTheDocument();
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

describe('message history grouping and net SMS credit clarity (ported from PR #176)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  const historyFixture = [
    {
      id: 'ci_confirm',
      channel: 'sms',
      eventType: 'booking_confirmation',
      recipient: '•••• 0100',
      status: 'delivered',
      scheduledFor: '2026-08-29T13:00:00.000Z',
      sentAt: '2026-08-29T13:00:05.000Z',
      creditsUsed: 1,
      reminderLeadMinutes: null,
      failureReason: null,
    },
    {
      id: 'ci_24h',
      channel: 'sms',
      eventType: 'appointment_reminder',
      recipient: '•••• 0101',
      status: 'delivered',
      scheduledFor: '2026-08-29T13:00:00.000Z',
      sentAt: '2026-08-29T13:00:05.000Z',
      creditsUsed: 2,
      reminderLeadMinutes: 1440,
      failureReason: null,
    },
    {
      id: 'ci_1h',
      channel: 'sms',
      eventType: 'appointment_reminder',
      recipient: '•••• 0102',
      status: 'canceled',
      scheduledFor: '2026-08-29T13:00:00.000Z',
      sentAt: null,
      creditsUsed: 0,
      reminderLeadMinutes: 60,
      failureReason: null,
    },
    {
      id: 'ci_cancel',
      channel: 'email',
      eventType: 'appointment_cancelled',
      recipient: 'c•••@example.com',
      status: 'sent',
      scheduledFor: '2026-08-29T13:05:00.000Z',
      sentAt: '2026-08-29T13:05:05.000Z',
      creditsUsed: 0,
      reminderLeadMinutes: null,
      failureReason: null,
    },
  ];

  function mockFetchForHistory(overrides: Parameters<typeof usageResponse>[0] = {}) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/salon/communications/usage')) {
        return url.includes('cursor=')
          ? usageResponse({ ...overrides, history: [historyFixture[3]!], nextCursor: null })
          : usageResponse(overrides);
      }
      if (url.startsWith('/api/billing/topups')) {
        return topupsResponse({ available: true, items: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  }

  it('groups history into confirmation/24h/1h/cancellation sections and labels net credit charges', async () => {
    mockFetchForHistory({ history: historyFixture, pendingCredits: 3 });
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Confirmations' });

    expect(screen.getByRole('heading', { name: '24-hour reminders' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1-hour reminders' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cancellations' })).toBeInTheDocument();
    // Net SMS credit charges (§ clearer usage) — never a synonym for "sent".
    expect(screen.getByText('1 SMS credit charged')).toBeInTheDocument();
    expect(screen.getByText('2 SMS credits charged')).toBeInTheDocument();
    expect(screen.getByText('No SMS credits charged')).toBeInTheDocument();
    expect(screen.getByText('Email included · no SMS credits')).toBeInTheDocument();
    // Credits held for texts that are queued/sending but not yet settled.
    expect(screen.getByText(/3\s+credits are\s+set aside for texts being sent\./)).toBeInTheDocument();
  });

  it('filters to one category at a time without losing the other groups from the DOM permanently', async () => {
    mockFetchForHistory({ history: historyFixture });
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Confirmations' });

    fireEvent.change(screen.getByLabelText('Filter message history'), { target: { value: '24h' } });

    expect(screen.getByRole('heading', { name: '24-hour reminders' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Confirmations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '1-hour reminders' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter message history'), { target: { value: 'all' } });

    expect(screen.getByRole('heading', { name: 'Confirmations' })).toBeInTheDocument();
  });

  it('loads another page of message history on demand, appending rather than replacing', async () => {
    mockFetchForHistory({ history: [historyFixture[0]!], nextCursor: 'CURSOR_1' });
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);

    await screen.findByText('•••• 0100');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      expect(screen.getByText('c•••@example.com')).toBeInTheDocument();
    });

    // The first page's row is still there — "Load more" appends.
    expect(screen.getByText('•••• 0100')).toBeInTheDocument();
    // Its nextCursor was null, so the button is gone.
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});

describe('§6.5a status banner (G18)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  const cases: Array<{
    name: string;
    status: string;
    grantsEligible: boolean;
    label: string;
  }> = [
    { name: 'active (no banner)', status: 'active', grantsEligible: true, label: 'Active' },
    {
      name: 'past_due',
      status: 'past_due',
      grantsEligible: true,
      label: 'Payment past due — prepaid credits continue until Oct 1, 2026',
    },
    { name: 'unpaid', status: 'unpaid', grantsEligible: false, label: 'Payment failed — no new monthly credits' },
    { name: 'incomplete', status: 'incomplete', grantsEligible: false, label: 'Setup not finished — no monthly credits yet' },
    {
      name: 'incomplete_expired',
      status: 'incomplete_expired',
      grantsEligible: false,
      label: 'Setup expired — no subscription',
    },
    { name: 'paused', status: 'paused', grantsEligible: false, label: 'Paused — no new monthly credits' },
    {
      name: 'canceled (future paidThrough)',
      status: 'canceled',
      grantsEligible: true,
      label: 'Cancelled — credits continue until Dec 25, 2099',
    },
    // grantsEligible mirrors GRANT_ELIGIBLE_STATUSES verbatim: 'canceled' is
    // always in that set regardless of paidThrough, so this still renders
    // the neutral (blue, not amber) styling — the label alone carries the
    // "already ended" nuance.
    { name: 'canceled (past paidThrough)', status: 'canceled', grantsEligible: true, label: 'Cancelled' },
    { name: 'trialing', status: 'trialing', grantsEligible: false, label: 'Needs review' },
  ];

  it.each(cases)('renders the right label for $name', async ({ status, grantsEligible, label }) => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/salon/communications/usage')) {
        return usageResponse({
          plan: {
            displayName: 'Pro',
            cadence: 'monthly',
            status,
            paidThrough: '2026-09-01T00:00:00.000Z',
            cancelAtPeriodEnd: false,
            entitlement: { status, paidThrough: '2026-09-01T00:00:00.000Z', grantsEligible, label },
          },
        });
      }
      if (url.startsWith('/api/billing/topups')) {
        return topupsResponse({ available: true, items: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);
    await screen.findByText(/SMS credits remaining/);

    if (status === 'active') {
      expect(screen.queryByText(label)).not.toBeInTheDocument();

      return;
    }

    const banner = await screen.findByText(label);

    expect(banner.className).toMatch(grantsEligible ? /bg-blue-50/ : /bg-amber-50/);
  });
});

describe('Top-ups (G17)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('lists a held pending row and a reversed row, and loads more on demand', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/salon/communications/usage')) {
        return usageResponse();
      }
      if (url.includes('cursor=')) {
        return topupsResponse({
          available: true,
          items: [{
            id: 'stp_3',
            offerKey: 'topup_900_paid_2026_08',
            credits: 900,
            priceCents: 3599,
            currency: 'cad',
            status: 'fulfilled',
            holdState: null,
            createdAt: '2026-06-01T00:00:00.000Z',
            fulfilledAt: '2026-06-01T00:05:00.000Z',
            reversedAt: null,
          }],
          nextCursor: null,
        });
      }
      if (url.startsWith('/api/billing/topups')) {
        return topupsResponse({
          available: true,
          items: [
            {
              id: 'stp_1',
              offerKey: 'topup_300_paid_2026_08',
              credits: 300,
              priceCents: 1599,
              currency: 'cad',
              status: 'pending',
              holdState: 'held',
              createdAt: '2026-08-01T00:00:00.000Z',
              fulfilledAt: null,
              reversedAt: null,
            },
            {
              id: 'stp_2',
              offerKey: 'topup_60_paid_2026_08',
              credits: 60,
              priceCents: 399,
              currency: 'cad',
              status: 'reversed',
              holdState: null,
              createdAt: '2026-07-15T00:00:00.000Z',
              fulfilledAt: '2026-07-15T00:05:00.000Z',
              reversedAt: '2026-07-20T00:00:00.000Z',
            },
          ],
          nextCursor: 'CURSOR_1',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);

    expect(await screen.findByText(/300 credits — \$15\.99/)).toBeInTheDocument();
    expect(screen.getByText('held — being reconciled')).toBeInTheDocument();
    expect(screen.getByText(/60 credits — \$3\.99/)).toBeInTheDocument();
    expect(screen.getByText('Reversed')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      expect(screen.getByText(/900 credits — \$35\.99/)).toBeInTheDocument();
    });

    // The two original rows are still there — "Load more" appends.
    expect(screen.getByText(/300 credits — \$15\.99/)).toBeInTheDocument();
    // Its nextCursor was null, so the button is gone.
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows a one-line message and never loops when history is unavailable', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/salon/communications/usage')) {
        return usageResponse();
      }
      if (url.startsWith('/api/billing/topups')) {
        return topupsResponse({ available: false });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);

    expect(await screen.findByText('Top-up history is not available yet.')).toBeInTheDocument();

    const callsAfterMount = fetchMock.mock.calls.length;

    await new Promise(resolve => setTimeout(resolve, 30));

    expect(fetchMock.mock.calls.length).toBe(callsAfterMount);
  });
});
