import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientReviewOverview } from '@/libs/reviewRequestStatus';

import { ReviewRequestSuppression } from './ReviewRequestSuppression';

const fetchMock = vi.fn();

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
}

function overview(overrides: Partial<ClientReviewOverview> = {}): ClientReviewOverview {
  return {
    timeZone: 'America/Toronto',
    reviewRequestsSuppressed: false,
    history: [
      {
        id: 'history_sent',
        appointmentId: 'appt_1',
        status: 'sent',
        reason: null,
        scheduledFor: null,
        sentAt: '2026-09-12T17:52:00.000Z',
        message: null,
        phone: null,
        clientId: 'client_1',
        source: 'automatic',
        channel: 'sms',
        canSendManually: false,
        automationMode: 'scheduled_end',
        occurredAt: '2026-09-12T17:52:00.000Z',
      },
      {
        id: 'history_reported',
        appointmentId: null,
        status: 'reported_sent',
        reason: 'Owner confirmed the request outside Luster.',
        scheduledFor: null,
        sentAt: '2026-06-12T17:52:00.000Z',
        message: null,
        phone: null,
        clientId: 'client_1',
        source: 'owner_reported',
        channel: 'owner_device',
        canSendManually: false,
        automationMode: 'manual',
        occurredAt: '2026-06-12T17:52:00.000Z',
      },
    ],
    hasMore: false,
    ...overrides,
  };
}

describe('ReviewRequestSuppression', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('persists suppression and keeps bounded history with honest provider labels', async () => {
    const initial = overview();
    fetchMock
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(response({ ...initial, reviewRequestsSuppressed: true }));
    render(<ReviewRequestSuppression salonSlug="isla" clientId="client_1" />);

    const control = await screen.findByRole('checkbox', { name: 'Do not send review requests' });

    expect(screen.getByText('Sent to SMS provider')).toBeVisible();
    expect(screen.getByText('Owner reported sent — delivery not verified')).toBeVisible();
    expect(screen.getByText(/Automatic · SMS/)).toBeVisible();
    expect(screen.getByText(/Owner-reported · Owner device/)).toBeVisible();

    fireEvent.click(control);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/admin/clients/client_1/review-requests?salonSlug=isla');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ reviewRequestsSuppressed: true });
    expect(await screen.findByText('Future requests are skipped. A request already sending may still arrive.')).toBeVisible();
  });

  it('does not apply a late load from a prior salon or client', async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(response(overview({ history: [], reviewRequestsSuppressed: true })));
    const { rerender } = render(<ReviewRequestSuppression salonSlug="isla" clientId="client_a" />);

    rerender(<ReviewRequestSuppression salonSlug="other" clientId="client_b" />);

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Do not send review requests' })).toBeChecked());

    expect(screen.getByText('No review requests yet.')).toBeVisible();

    resolveFirst?.(response(overview()));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Do not send review requests' })).toBeChecked());

    expect(screen.queryByText('Sent to SMS provider')).not.toBeInTheDocument();
  });

  it('fails closed when history cannot be loaded', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Unavailable' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    render(<ReviewRequestSuppression salonSlug="isla" clientId="client_1" />);

    const control = await screen.findByRole('checkbox', { name: 'Do not send review requests' });

    expect(control).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Unavailable');

    fireEvent.click(control);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('formats history in the salon time zone and separates recorded and sent times', async () => {
    const initial = overview({
      timeZone: 'Pacific/Auckland',
      history: [
        {
          ...overview().history[0]!,
          status: 'delivered',
          occurredAt: '2026-09-12T17:52:00.000Z',
          sentAt: '2026-09-12T18:52:00.000Z',
        },
        {
          ...overview().history[1]!,
          status: 'suppressed',
          reason: 'Review requests are off for this client.',
        },
      ],
    });
    fetchMock.mockResolvedValue(response(initial));
    render(<ReviewRequestSuppression salonSlug="isla" clientId="client_1" />);

    expect(await screen.findByText('Delivered by SMS')).toBeVisible();
    expect(screen.getByText(/Recorded Sep 13, 2026/)).toBeVisible();
    expect(screen.getByText(/Sent Sep 13, 2026/)).toBeVisible();
    expect(screen.getByText('Skipped')).toBeVisible();
    expect(screen.getByText('Review requests are off for this client.')).toBeVisible();
    expect(screen.queryByText(/client opted out/i)).not.toBeInTheDocument();
  });
});
