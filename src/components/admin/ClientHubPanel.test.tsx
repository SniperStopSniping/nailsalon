import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientInsightsData } from '@/types/clientInsights';

import { ClientInsightsPanel } from './ClientHubPanel';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonSlug: 'isla-nail-studio',
    salonName: 'Isla Nail Studio',
  }),
}));

vi.mock('@/libs/dashboardEvents', () => ({
  notifyRetentionDataChanged: vi.fn(),
}));

const insights: ClientInsightsData = {
  generatedAt: '2026-07-15T16:00:00.000Z',
  timeZone: 'America/Toronto',
  rulesVersion: '2026-07-24',
  kpis: {
    active: 42,
    new_this_month: 6,
    due_to_return: 8,
    overdue: 3,
  },
  segments: [
    { id: 'active', label: 'Active clients', count: 42 },
    { id: 'new_this_month', label: 'New this month', count: 6 },
    { id: 'rebooked', label: 'Rebooked', count: 10 },
    { id: 'due_to_return', label: 'Due to return', count: 8 },
    { id: 'due_soon', label: 'Due soon', count: 4 },
    { id: 'due_now', label: 'Due now', count: 4 },
    { id: 'overdue', label: 'Overdue', count: 3 },
    { id: 'needs_rebooking', label: 'Needs rebooking', count: 11 },
    { id: 'no_future_appointment', label: 'No future appointment', count: 14 },
    { id: 'first_time_no_return', label: 'First-time clients who did not return', count: 2 },
    { id: 'recent_cancellation', label: 'Recent cancellations to reschedule', count: 1 },
    { id: 'not_seen_30', label: 'Not seen in 30 days', count: 9 },
    { id: 'not_seen_60', label: 'Not seen in 60 days', count: 5 },
    { id: 'inactive_90', label: 'Inactive 90+ days', count: 2 },
    { id: 'completed_outstanding', label: 'Completed outstanding balance', count: 1 },
  ],
  attention: {
    total: 1,
    items: [{
      clientId: 'client_1',
      clientName: 'Ava Thompson',
      phone: '4165550111',
      email: 'ava@example.test',
      primaryReason: 'due_now',
      reasons: ['due_now', 'no_future_appointment'],
      lastVisitAt: '2026-06-24T16:00:00.000Z',
      expectedReturnAt: '2026-07-15T04:00:00.000Z',
      completedOutstandingCents: 0,
      outreachStage: 'rebook',
    }],
  },
};

describe('ClientInsightsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('renders the renamed actionable workspace without legacy financial reports', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: insights }), { status: 200 }));
    const onOpenSegment = vi.fn();
    const onOpenClient = vi.fn();
    const onBookClient = vi.fn();

    render(
      <ClientInsightsPanel
        onOpenSegment={onOpenSegment}
        onOpenClient={onOpenClient}
        onBookClient={onBookClient}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Client health' })).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Ava Thompson')).toBeInTheDocument();
    expect(screen.queryByText(/Final service revenue/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/client-insights?salonSlug=isla-nail-studio',
      { cache: 'no-store' },
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/admin/marketing'))).toBe(false);

    fireEvent.click(screen.getByTestId('client-insights-kpi-overdue'));

    expect(onOpenSegment).toHaveBeenCalledWith('overdue');

    fireEvent.click(screen.getByTestId('client-insights-segment-completed_outstanding'));

    expect(onOpenSegment).toHaveBeenCalledWith('completed_outstanding');

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(onOpenClient).toHaveBeenCalledWith('client_1');

    fireEvent.click(screen.getByRole('button', { name: /Book/ }));

    expect(onBookClient).toHaveBeenCalledWith(insights.attention.items[0]);
  });

  it('shows a loading skeleton, retryable error, and honest empty follow-up state', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          ...insights,
          attention: { total: 0, items: [] },
        },
      }), { status: 200 }));

    render(
      <ClientInsightsPanel
        onOpenSegment={vi.fn()}
        onOpenClient={vi.fn()}
        onBookClient={vi.fn()}
      />,
    );

    expect(screen.getByRole('status', { name: 'Loading Client Insights' })).toBeInTheDocument();

    resolveFirst?.(new Response(JSON.stringify({
      error: { message: 'Reporting service unavailable.' },
    }), { status: 503 }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Reporting service unavailable.');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Nothing urgent right now')).toBeInTheDocument();
  });

  it('prepares an encoded SMS target and records prepared versus not-sent honestly', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/client-insights')) {
        return new Response(JSON.stringify({ data: insights }), { status: 200 });
      }
      if (url === '/api/admin/retention') {
        return new Response(JSON.stringify({
          data: { communication: { id: 'communication_1' } },
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const openNative = vi.fn();

    render(
      <ClientInsightsPanel
        onOpenSegment={vi.fn()}
        onOpenClient={vi.fn()}
        onBookClient={vi.fn()}
        onOpenNativeUrl={openNative}
      />,
    );

    await screen.findByText('Ava Thompson');
    fireEvent.click(screen.getByRole('button', { name: /Text/ }));

    expect(screen.getByRole('dialog', { name: 'Review text' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Messages' }));

    await waitFor(() => expect(openNative).toHaveBeenCalledTimes(1));
    const target = openNative.mock.calls[0]![0] as string;

    expect(target).toMatch(/^sms:4165550111[?&]body=/);
    expect(decodeURIComponent(target)).toContain('Ava');

    const retentionBodies = () => fetchMock.mock.calls
      .filter(([url]) => String(url) === '/api/admin/retention')
      .map(([, init]) => JSON.parse(String(init?.body)));

    expect(retentionBodies()).toEqual([
      expect.objectContaining({
        clientId: 'client_1',
        kind: 'rebook',
        status: 'prepared',
      }),
    ]);

    expect(await screen.findByRole('dialog', { name: 'Did you send the text?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Not sent' }));
    await waitFor(() => expect(retentionBodies()).toHaveLength(2));

    expect(retentionBodies()[1]).toEqual(expect.objectContaining({
      status: 'not_sent',
    }));
    expect(retentionBodies().some(body =>
      body.status === 'marked_sent'
      || body.status === 'converted')).toBe(false);
  });

  it('reuses retention snooze, dismiss, and converted mutations for eligible rows', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/client-insights')) {
        return new Response(JSON.stringify({ data: insights }), { status: 200 });
      }
      if (url === '/api/admin/retention') {
        return new Response(JSON.stringify({ data: { communication: { id: 'c' } } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <ClientInsightsPanel
        onOpenSegment={vi.fn()}
        onOpenClient={vi.fn()}
        onBookClient={vi.fn()}
      />,
    );

    await screen.findByText('Ava Thompson');
    fireEvent.click(screen.getByRole('button', { name: 'Snooze 7 days' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/retention',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"status":"snoozed"'),
      }),
    ));
    const snoozeCall = fetchMock.mock.calls.find(([, init]) =>
      String(init?.body).includes('"status":"snoozed"'));

    expect(JSON.parse(String(snoozeCall?.[1]?.body))).not.toHaveProperty('messageSnapshot');

    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/retention',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"status":"converted"'),
      }),
    ));
  });
});
