import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewRequestDisplay } from '@/libs/reviewRequestStatus';

import { ReviewRequestAction } from './ReviewRequestAction';

const fetchMock = vi.fn();

vi.mock('@/components/ui/dialog-shell', () => ({
  DialogShell: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div>{children}</div> : null,
}));

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
}

function reviewRequest(status: ReviewRequestDisplay['status'], overrides: Partial<ReviewRequestDisplay> = {}): ReviewRequestDisplay {
  return {
    status,
    reason: null,
    scheduledFor: status === 'scheduled' ? '2026-09-12T17:52:00.000Z' : null,
    sentAt: null,
    message: 'Hi Avery!',
    phone: '4165551234',
    clientId: 'client_1',
    source: 'manual',
    channel: 'sms',
    canSendManually: status === 'eligible' || status === 'scheduled',
    automationMode: 'manual',
    ...overrides,
  };
}

describe('ReviewRequestAction', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('queues a manual request only after confirmation when the server says it can be sent', async () => {
    fetchMock
      .mockResolvedValueOnce(response(reviewRequest('eligible')))
      .mockResolvedValueOnce(response(reviewRequest('sending', { canSendManually: false })));
    render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="completed" />);

    expect(await screen.findByRole('button', { name: 'Request review' })).toBeEnabled();
    expect(screen.getByText('Eligible — send manually.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Request review' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Send review request' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[1]).toEqual([expect.stringContaining('/api/appointments/appt_1/review-request?salonSlug=salon-a'), expect.objectContaining({ method: 'POST' })]);
    expect(await screen.findByRole('button', { name: 'Review request sending' })).toBeDisabled();
  });

  it('explains a scheduled-end request for Send now and shows the cancellation/no-show warning', async () => {
    fetchMock.mockResolvedValue(response(reviewRequest('scheduled', { automationMode: 'scheduled_end', source: 'automatic' })));
    render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="confirmed" />);

    expect(await screen.findByRole('button', { name: 'Send now' })).toBeEnabled();
    expect(screen.getByText(/Scheduled for Sep 12/)).toBeVisible();
    expect(screen.getByText('If this appointment is cancelled or a no-show, mark it before this request sends.')).toBeVisible();
    expect(screen.getByText('Send now queues one request and prevents another automatic request for this appointment.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));

    expect(screen.getByText('This queues one request and prevents another automatic request for this appointment. Quiet hours and eligibility checks still apply.')).toBeVisible();
  });

  it('shows sent provider acceptance separately from provider delivery evidence', async () => {
    fetchMock.mockResolvedValue(response(reviewRequest('sent', { sentAt: '2026-09-12T17:52:00.000Z', canSendManually: false })));
    render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="completed" />);

    expect(await screen.findByRole('button', { name: 'Review request sent' })).toBeDisabled();
    expect(screen.getByText(/Sent to the SMS provider Sep 12/)).toBeVisible();
  });

  it('does not invent a delivery timestamp from the provider-acceptance timestamp', async () => {
    fetchMock.mockResolvedValue(response(reviewRequest('delivered', { sentAt: '2026-09-12T17:52:00.000Z', canSendManually: false })));
    render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="completed" />);

    expect(await screen.findByRole('button', { name: 'Review request delivered' })).toBeDisabled();
    expect(screen.getByText(/Delivery confirmed by SMS provider\. Sent Sep 12/)).toBeVisible();
    expect(screen.queryByText(/Delivered by SMS Sep 12/)).not.toBeInTheDocument();
  });

  it('fails closed when the server says an otherwise completed appointment cannot be manually sent', async () => {
    fetchMock.mockResolvedValue(response(reviewRequest('eligible', { canSendManually: false, reason: 'A request is already reserved.' })));
    render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="completed" />);

    expect(await screen.findByText('Eligible — send manually. A request is already reserved.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Request review' })).toBeDisabled();
  });

  it('does not apply a late response for the prior appointment', async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(response(reviewRequest('skipped', { reason: 'Client opted out.' })));
    const { rerender } = render(<ReviewRequestAction appointmentId="appt_a" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="completed" />);

    rerender(<ReviewRequestAction appointmentId="appt_b" salonSlug="salon-b" timeZone="America/Toronto" appointmentStatus="completed" />);

    expect(await screen.findByText('Skipped — Client opted out.')).toBeVisible();

    resolveFirst?.(response(reviewRequest('sent', { sentAt: '2026-09-12T17:52:00.000Z', canSendManually: false })));
    await waitFor(() => expect(screen.queryByText(/Sent to the SMS provider/)).not.toBeInTheDocument());
  });

  it('reloads and fails closed when the visible appointment changes to a no-show', async () => {
    let resolveNoShow: ((value: Response) => void) | undefined;
    fetchMock
      .mockResolvedValueOnce(response(reviewRequest('eligible')))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveNoShow = resolve;
      }));
    const { rerender } = render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="completed" />);

    expect(await screen.findByRole('button', { name: 'Request review' })).toBeEnabled();

    rerender(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="no_show" />);

    expect(screen.getByRole('button', { name: 'Request review' })).toBeDisabled();

    resolveNoShow?.(response(reviewRequest('skipped', { canSendManually: false, reason: 'The appointment was marked no-show.' })));

    expect(await screen.findByText('Skipped — The appointment was marked no-show.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review request skipped' })).toBeDisabled();
  });

  it('requires a successful status reload after a send error before allowing another attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(response(reviewRequest('eligible')))
      .mockResolvedValueOnce(response(null, 503))
      .mockRejectedValueOnce(new Error('Still offline'))
      .mockResolvedValueOnce(response(reviewRequest('eligible')));
    render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="completed" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Request review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send review request' }));
    await screen.findByRole('alert');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request review' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Reload status' }));
    await screen.findByText('Still offline');

    expect(screen.getByRole('button', { name: 'Request review' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Reload status' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request review' })).toBeEnabled());

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
