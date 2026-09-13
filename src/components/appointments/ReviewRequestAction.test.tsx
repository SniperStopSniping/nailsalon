import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewRequestAction } from './ReviewRequestAction';

const fetchMock = vi.fn();

vi.mock('@/components/ui/dialog-shell', () => ({
  DialogShell: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div>{children}</div> : null,
}));

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ReviewRequestAction', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('queues a manual request only after confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ status: 'eligible', reason: null, scheduledFor: null, sentAt: null, message: 'Hi Avery!', phone: '4165551234', clientId: 'client_1' }))
      .mockResolvedValueOnce(response({ status: 'sending', reason: null, scheduledFor: null, sentAt: null, message: 'Hi Avery!', phone: '4165551234', clientId: 'client_1' }));
    render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="completed" />);

    expect(await screen.findByRole('button', { name: 'Request review' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Request review' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Send review request' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[1]).toEqual([expect.stringContaining('/api/appointments/appt_1/review-request?salonSlug=salon-a'), expect.objectContaining({ method: 'POST' })]);
    expect(await screen.findByText('Review request sending')).toBeVisible();
  });

  it('keeps the Google link action visible without a recorded visit and does not fetch an invalid appointment', () => {
    render(<ReviewRequestAction salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="unavailable" actionLabel="Send Google review link" />);

    expect(screen.getByRole('button', { name: 'Send Google review link' })).toBeDisabled();
    expect(screen.getByText('Available after a completed appointment is recorded for this client.')).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens the Google link preview without sending until the owner confirms', async () => {
    fetchMock.mockResolvedValue(response({ status: 'eligible', reason: null, scheduledFor: null, sentAt: null, message: 'Leave a review: https://g.page/r/salon-a/review', phone: '4165551234', clientId: 'client_1' }));
    render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="completed" actionLabel="Send Google review link" />);
    const action = screen.getByRole('button', { name: 'Send Google review link' });
    await waitFor(() => expect(action).toBeEnabled());
    fireEvent.click(action);

    expect(screen.getByRole('dialog', { name: 'Send review request' })).toBeVisible();
    expect(screen.getByText('Leave a review: https://g.page/r/salon-a/review')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows scheduled state and permits a deliberate send-now confirmation', async () => {
    fetchMock.mockResolvedValue(response({ status: 'scheduled', reason: null, scheduledFor: '2026-09-12T17:52:00.000Z', sentAt: null, message: 'Hi Avery!', phone: '4165551234', clientId: 'client_1' }));
    render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="completed" />);

    expect(await screen.findByRole('button', { name: 'Review request scheduled' })).toBeEnabled();
  });

  it('keeps the action disabled until an appointment is completed', async () => {
    fetchMock.mockResolvedValue(response({ status: 'eligible', reason: null, scheduledFor: null, sentAt: null, message: null, phone: null, clientId: 'client_1' }));
    render(<ReviewRequestAction appointmentId="appt_1" salonSlug="salon-a" timeZone="America/Toronto" appointmentStatus="confirmed" />);

    expect(await screen.findByRole('button', { name: 'Request review' })).toBeDisabled();
    expect(screen.getByText('Available after this appointment is completed.')).toBeVisible();
  });
});
