import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomerBookingStatus } from '@/libs/customerAssistant/bookingOperationContracts';

import { CustomerAssistantLauncher } from './CustomerAssistantLauncher';

function pending(): CustomerBookingStatus {
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  return {
    kind: 'booking_status',
    status: 'not_created',
    appointment: null,
    payment: null,
    lastFailure: null,
    operation: { capability: 'original-capability', revision: 3, fingerprint: 'a'.repeat(64), expiresAt },
    review: {
      status: 'READY',
      fingerprint: 'r'.repeat(64),
      expiresAt,
      salon: { id: 'synthetic', slug: 'isla-nail-studio', name: 'Synthetic salon' },
      location: null,
      services: [{ id: 'gel-x', name: 'Gel-X', priceCents: 8500 }],
      addOns: [],
      technician: { kind: 'any_artist' },
      date: '2030-01-02',
      time: '13:00',
      timeZone: 'America/Toronto',
      durationMinutes: 90,
      financial: { subtotalCents: 8500, discountAmountCents: 0, discountLabel: null, taxAmountCents: 0, totalDueCents: 8500, currency: 'CAD' },
      deposit: { status: 'not_required', reason: 'policy_inactive' },
      confirmationMode: 'instant',
      bookingPolicy: { required: false },
      reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true },
    },
  };
}

async function open(status: CustomerBookingStatus) {
  localStorage.setItem('luster.customer-booking.operation.synthetic', JSON.stringify({ version: 1, salonId: 'synthetic', ...status.operation }));
  sessionStorage.setItem('luster.customer-assistant.conversation.isla-nail-studio', 'original-conversation');
  render(<CustomerAssistantLauncher salonId="synthetic" salonSlug="isla-nail-studio" locale="en" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
  return user;
}

async function contact(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Full name'), 'Synthetic Guest');
  await user.type(screen.getByLabelText('Email address'), 'synthetic@example.test');
  await user.type(screen.getByLabelText('Phone number'), '4165550100');
}

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('durable booking recovery controls', () => {
  it('hydrates the authoritative reminder choice and requires a new review after changing it', async () => {
    const status = pending();
    const revised = { ...status.operation, revision: 4, fingerprint: 'b'.repeat(64) };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json({ conversation: 'revised-conversation', result: { kind: 'booking_review', review: { ...status.review, reminders: { mode: 'default_on', selection: 'explicit_off', requestedEnabled: false } }, operation: revised } }))
      .mockResolvedValueOnce(Response.json({ ...status, operation: revised, status: 'confirmed' }));
    vi.stubGlobal('fetch', fetchMock);
    const user = await open(status);
    await contact(user);
    const checkbox = screen.getByRole('checkbox', { name: 'Text reminders' });

    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review booking details' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm booking' }));
    const reviewBody = JSON.parse(fetchMock.mock.calls[1]![1].body);

    expect(reviewBody).toMatchObject({ expectedRevision: 3, smsConsent: { granted: false, selection: 'explicit_off' } });
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toMatchObject({ capability: 'original-capability', revision: 4 });
  });

  it('restores an explicitly disabled reminder as unchecked', async () => {
    const status = pending();
    status.review.reminders = { mode: 'default_on', selection: 'explicit_off', requestedEnabled: false };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(status)));
    await open(status);

    expect(await screen.findByRole('checkbox', { name: 'Text reminders' })).not.toBeChecked();
  });

  it('retries an ambiguous confirmation only after reading its original operation', async () => {
    const status = pending();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(status))
      .mockRejectedValueOnce(new Error('lost confirm response'))
      .mockRejectedValueOnce(new Error('status temporarily unavailable'))
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json({ ...status, status: 'confirmed' }));
    vi.stubGlobal('fetch', fetchMock);
    const user = await open(status);
    await contact(user);
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await user.click(await screen.findByRole('button', { name: 'Check booking status' }));

    expect(await screen.findByText('Your appointment is confirmed.')).toBeVisible();
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/public/customer-booking/synthetic/status',
      '/api/public/customer-assistant/isla-nail-studio/booking/confirm',
      '/api/public/customer-booking/synthetic/status',
      '/api/public/customer-booking/synthetic/status',
      '/api/public/customer-assistant/isla-nail-studio/booking/confirm',
    ]);
    expect(fetchMock.mock.calls[4]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
    expect(screen.queryByRole('button', { name: 'Check booking status' })).not.toBeInTheDocument();
  });

  it('makes the recovery button work when the first refresh lookup fails', async () => {
    const status = pending();
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('temporary outage')).mockResolvedValueOnce(Response.json(status));
    vi.stubGlobal('fetch', fetchMock);
    const user = await open(status);
    await user.click(await screen.findByRole('button', { name: 'Check booking status' }));

    expect(await screen.findByRole('button', { name: 'Confirm booking' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(call => String(call[0]).endsWith('/status'))).toBe(true);
  });

  it('refreshes alternatives after reloading a definitely rejected slot', async () => {
    const status = pending();
    status.lastFailure = 'slot_unavailable';
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(status)).mockResolvedValueOnce(Response.json({ conversation: 'alternatives', result: { kind: 'unavailable', reason: 'unavailable' } }));
    vi.stubGlobal('fetch', fetchMock);
    await open(status);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ conversation: 'original-conversation', action: 'choose_date', date: status.review.date });
    expect(await screen.findByText('That time is no longer available. Choose another time.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument();
  });
});
