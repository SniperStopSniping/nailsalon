import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BulkClientMessageComposer } from './BulkClientMessageComposer';

const fetchMock = vi.fn();
const clients = [
  { id: 'old', fullName: 'Ava Old', phone: '4165550101', lastCompletedAt: '2026-10-14T16:00:00Z', hasUpcomingAppointment: false, eligible: true, unavailableReason: null },
  { id: 'recent', fullName: 'Bea Recent', phone: '4165550102', lastCompletedAt: '2026-11-04T16:00:00Z', hasUpcomingAppointment: false, eligible: true, unavailableReason: null },
  { id: 'new', fullName: 'Cam New', phone: '4165550103', lastCompletedAt: null, hasUpcomingAppointment: false, eligible: true, unavailableReason: null },
  { id: 'booked', fullName: 'Dee Booked', phone: '4165550104', lastCompletedAt: '2026-10-14T16:00:00Z', hasUpcomingAppointment: true, eligible: true, unavailableReason: null },
  { id: 'stop', fullName: 'Eve Optout', phone: '4165550105', lastCompletedAt: '2026-10-14T16:00:00Z', hasUpcomingAppointment: false, eligible: false, unavailableReason: 'Promotional texts unavailable or opted out' },
];
const preview = { fingerprint: 'a'.repeat(64), body: 'Isla via Luster: Book your next visit. Reply STOP to opt out.', recipients: [clients[0]], skipped: 0, creditsPerText: 1, totalCredits: 1 };
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
const props = { salonSlug: 'isla', salonName: 'Isla', onBack: vi.fn() };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const input = JSON.parse(String(init.body));
      return Promise.resolve(input.action === 'preview' ? response({ preview }) : response({ receipt: { requestId: input.requestId, queued: 1, skipped: 0, totalCredits: 1, messages: [{ id: 'ci-one', clientName: 'Ava Old', status: 'queued', failureReason: null }] } }, 202));
    }
    return Promise.resolve(response({ clients, asOf: '2026-11-11T16:00:00Z', timeZone: 'America/Toronto', bookingUrl: 'https://isla.test/book', sms: { manualAvailable: true, availableCredits: 100, senderLabel: 'Luster', detail: '' } }));
  });
});

describe('bulk message composer', () => {
  it('highlights three-or-more-week clients, supports all and individual picks, and keeps opt-outs unavailable', async () => {
    render(<BulkClientMessageComposer {...props} />);
    await screen.findByLabelText('Select Ava Old');
    fireEvent.click(screen.getByRole('button', { name: 'Last visit' }));

    expect(screen.getByLabelText('Weeks since last completed visit')).toHaveValue(3);
    expect(screen.getByLabelText('Select Ava Old')).toBeChecked();
    expect(screen.queryByLabelText('Select Bea Recent')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select Cam New')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select Dee Booked')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select Eve Optout')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'All clients' }));

    expect(screen.getByText('3 selected')).toBeVisible();

    fireEvent.click(screen.getByLabelText('Select Bea Recent'));

    expect(screen.getByText('2 selected')).toBeVisible();

    fireEvent.click(screen.getByLabelText('Exclude clients with upcoming bookings'));

    expect(screen.getByLabelText('Select Dee Booked')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'Bea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select all matching' }));

    expect(screen.getByText('1 selected')).toBeVisible();
    expect(screen.getByLabelText('Select Bea Recent')).toBeChecked();
  });

  it('reviews the exact audience and credits before queuing, then reports queued instead of delivered', async () => {
    render(<BulkClientMessageComposer {...props} />);
    fireEvent.click(await screen.findByLabelText('Select Ava Old'));
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Book your next visit.' } });
    fireEvent.click(screen.getByRole('button', { name: /Review message/ }));
    await screen.findByText('Review your message');

    expect(screen.getByText('1 client · 1 credit')).toBeVisible();

    const posts = () => fetchMock.mock.calls.filter(call => call[1]?.method === 'POST').map(call => JSON.parse(String(call[1].body)));

    expect(posts()).toEqual([expect.objectContaining({ action: 'preview', clientIds: ['old'], filter: { minWeeks: null, excludeUpcoming: true } })]);

    fireEvent.click(screen.getByRole('button', { name: 'Send to 1 client · 1 credit' }));

    expect(await screen.findByText('Your messages are queued')).toBeVisible();
    expect(posts()[1]).toMatchObject({ action: 'send', message: 'Book your next visit.', clientIds: ['old'], previewFingerprint: preview.fingerprint });
    expect(screen.getByText('Queued', { exact: true })).toBeVisible();
    expect(screen.queryByText('Delivered', { exact: true })).not.toBeInTheDocument();
  });

  it('freezes an uncertain send and retries the identical request without duplicating the audience', async () => {
    render(<BulkClientMessageComposer {...props} />);
    fireEvent.click(await screen.findByLabelText('Select Ava Old'));
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Book your next visit.' } });
    fireEvent.click(screen.getByRole('button', { name: /Review message/ }));
    await screen.findByText('Review your message');
    fetchMock.mockRejectedValueOnce(new Error('connection lost'));
    fireEvent.click(screen.getByRole('button', { name: 'Send to 1 client · 1 credit' }));
    await screen.findByRole('button', { name: 'Check this same send' });

    expect(screen.getByRole('button', { name: 'Edit message or clients' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Check this same send' }));
    await screen.findByText('Your messages are queued');
    const sends = fetchMock.mock.calls.filter(call => call[1]?.method === 'POST').map(call => JSON.parse(String(call[1].body))).filter(item => item.action === 'send');

    expect(sends).toHaveLength(2);
    expect(sends[0]).toEqual(sends[1]);
  });

  it('does not review with unavailable texting, missing recipients, or an invalid week threshold', async () => {
    render(<BulkClientMessageComposer {...props} />);
    await screen.findByLabelText('Select Ava Old');
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Hello' } });

    expect(screen.getByRole('button', { name: /Review message/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Last visit' }));
    fireEvent.change(screen.getByLabelText('Weeks since last completed visit'), { target: { value: '' } });

    expect(screen.getByRole('button', { name: /Review message/ })).toBeDisabled();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
