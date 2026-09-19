import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomerReadyReviewSnapshot } from '@/libs/customerAssistant/reviewContracts';

import { BookingStatusCard, CustomerAssistantLauncher, CustomerBookingRecovery } from './CustomerAssistantLauncher';

const navigation = vi.hoisted(() => ({ push: vi.fn(), params: {} }));
const bookingState = vi.hoisted(() => ({ applyAssistantHandoff: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => navigation.params,
  useRouter: () => ({ push: navigation.push }),
}));

vi.mock('@/hooks/useBookingState', () => ({
  useBookingState: () => bookingState,
}));

const sessionResponse = (conversation = 'signed-conversation') => new Response(JSON.stringify({ conversation }), { status: 200 });
const proposal = (fingerprint = 'f'.repeat(64)) => ({
  selection: { baseServiceId: 'gel-x', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] },
  fingerprint,
  service: { id: 'gel-x', name: 'Gel-X Extensions', priceCents: 8500 },
  addOns: [{ id: 'french', name: 'French tips', quantity: 1, priceCents: 1500 }],
  currency: 'CAD',
  subtotalCents: 10000,
  durationMinutes: 120,
  expiresAt: '2030-01-01T00:00:00.000Z',
});
const readyReview: CustomerReadyReviewSnapshot = {
  status: 'READY',
  fingerprint: 'r'.repeat(64),
  expiresAt: '2030-01-01T00:00:00.000Z',
  salon: { id: 'salon-id', slug: 'isla-nail-studio', name: 'Synthetic Salon' },
  location: null,
  services: [{ id: 'gel-x', name: 'Gel-X Extensions', priceCents: 8500 }],
  addOns: [],
  technician: { kind: 'any_artist' },
  date: '2030-01-01',
  time: '12:00',
  timeZone: 'America/Toronto',
  durationMinutes: 90,
  financial: { subtotalCents: 8500, discountAmountCents: 0, discountLabel: null, taxAmountCents: 0, totalDueCents: 8500, currency: 'CAD' },
  deposit: { status: 'not_required', reason: 'policy_inactive' },
  confirmationMode: 'instant',
  bookingPolicy: { required: false },
  reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true },
};

describe('CustomerAssistantLauncher', () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
    navigation.push.mockReset();
    bookingState.applyAssistantHandoff.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the assistant optional and closes back to the existing flow', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));

    expect(await screen.findByRole('heading', { name: 'Help me choose' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/public/customer-assistant/isla-nail-studio/session', { method: 'POST' });

    await user.click(screen.getByRole('button', { name: 'Continue manually' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Help me choose' })).not.toBeInTheDocument());
  });

  it('keeps the optional conversation usable in memory when site storage cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse()));
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));

    expect(await screen.findByLabelText('Tell me what you would like')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Continue manually' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('transfers an accepted authoritative proposal once into normal Time without a capability URL', async () => {
    const fingerprint = 'f'.repeat(64);
    let completeHandoff!: (response: Response) => void;
    const handoffResponse = new Promise<Response>((resolve) => {
      completeHandoff = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'proposal-token', result: { kind: 'proposal', proposal: proposal(fingerprint) } }), { status: 200 }))
      .mockReturnValueOnce(handoffResponse);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Gel-X with French');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const accept = await screen.findByRole('button', { name: 'Choose these services' });

    expect(bookingState.applyAssistantHandoff).not.toHaveBeenCalled();

    await user.click(accept);
    await user.click(accept);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/handoff', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ conversation: 'proposal-token', fingerprint }),
    }));

    completeHandoff(new Response(JSON.stringify({
      conversation: 'handoff-token',
      result: { kind: 'handoff', handoff: { selection: proposal(fingerprint).selection, flow: { flowToken: 'v1.123e4567-e89b-12d3-a456-426614174000.1.signed', expiresAt: '2030-01-01T00:00:00.000Z' } } },
    }), { status: 200 }));

    await waitFor(() => expect(bookingState.applyAssistantHandoff).toHaveBeenCalledWith(proposal(fingerprint).selection));

    expect(navigation.push).toHaveBeenCalledTimes(1);

    const destination = navigation.push.mock.calls[0]?.[0] as string;

    expect(destination).toContain('/en/isla-nail-studio/book/time');
    expect(destination).toContain('bookingFlow=assistant');
    expect(destination).not.toContain('v1.123e4567-e89b-12d3-a456-426614174000.1.signed');
    expect(sessionStorage.getItem('luster.normal-confirm-handoff.v1.salon-id')).toContain('v1.123e4567-e89b-12d3-a456-426614174000.1.signed');
    expect(screen.queryByRole('button', { name: /confirm booking/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Phone number')).not.toBeInTheDocument();
  });

  it('renders assistant answers with optional quick replies', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'answer-token', result: { kind: 'answer', message: 'Would you like French tips?', options: ['Yes', 'No'] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Gel manicure');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Would you like French tips?')).toBeVisible();
    expect(screen.getByLabelText('You')).toHaveTextContent('Gel manicure');
    expect(screen.getByLabelText('Assistant')).toHaveTextContent('Would you like French tips?');

    await user.click(screen.getByLabelText('Close assistant'));
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));

    expect(await screen.findByLabelText('You')).toHaveTextContent('Gel manicure');
    expect(screen.getByLabelText('Assistant')).toHaveTextContent('Would you like French tips?');

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/chat', expect.objectContaining({ body: JSON.stringify({ conversation: 'answer-token', message: 'Yes', locale: 'en' }) })));
  });

  it('renders authoritative availability with the salon-local date and time zone', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        conversation: 'slots-token',
        result: {
          kind: 'slots',
          proposal: proposal(),
          preference: { date: '2026-09-19', earliest: '12:00', latest: '17:00' },
          timeZone: 'America/Toronto',
          slots: [{ time: '3:00 PM', startTime: '2026-09-19T19:00:00.000Z' }],
          checkedAt: '2026-09-18T00:00:00.000Z',
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Saturday afternoon');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('heading', { name: 'Available times to consider' })).toBeVisible();
    expect(screen.getByText(/Sep 19.*3:00.*(?:EDT|EST)/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose these services' })).toBeVisible();
  });

  it('recovers an opaque legacy operation without needing the assistant feature', async () => {
    const operation = { version: 1, salonId: 'salon-id', capability: 'opaque-capability', revision: 1, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' };
    localStorage.setItem('luster.customer-booking.operation.salon-id', JSON.stringify(operation));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: 'booking_status', operation, status: 'awaiting_approval', review: {}, appointment: null, payment: null, lastFailure: null })));
    vi.stubGlobal('fetch', fetchMock);

    render(<CustomerBookingRecovery salonId="salon-id" locale="en" />);

    expect(await screen.findByText('Your booking request is awaiting salon approval.')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/public/customer-booking/salon-id/status', expect.objectContaining({ method: 'POST', body: JSON.stringify({ capability: 'opaque-capability' }) }));
  });

  it('does not render legacy status actions without a working handler', () => {
    render(
      <BookingStatusCard
        locale="en"
        status={{
          kind: 'booking_status',
          operation: { capability: 'opaque-capability', revision: 1, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' },
          status: 'payment_required',
          review: readyReview,
          appointment: { id: 'appointment-id', startTime: '2030-01-01T12:00:00.000Z', durationMinutes: 60, technicianName: null, reminderState: 'enabled' },
          payment: { amountCents: 1000, currency: 'CAD', holdExpiresAt: '2030-01-01T13:00:00.000Z', canResume: true },
          lastFailure: null,
        }}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Resume payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage booking' })).not.toBeInTheDocument();
  });

  it('migrates a raw legacy signed conversation instead of discarding it', async () => {
    sessionStorage.setItem('luster.customer-assistant.conversation.isla-nail-studio', 'legacy.signed.conversation');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversation: 'next', result: { kind: 'answer', message: 'Recovered', options: [] } })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/public/customer-assistant/isla-nail-studio/chat', expect.objectContaining({ body: JSON.stringify({ conversation: 'legacy.signed.conversation', message: 'Hello', locale: 'en' }) }));
  });

  it.each(['conversation_expired', 'session_limit'] as const)('restarts terminal %s without clearing the normal booking flow', async (reason) => {
    sessionStorage.setItem('luster.normal-confirm-handoff.v1.salon-id', JSON.stringify({ flowToken: 'v1.123e4567-e89b-12d3-a456-426614174000.1.signed', expiresAt: '2030-01-01T00:00:00.000Z' }));
    const fetchMock = vi.fn().mockResolvedValueOnce(sessionResponse('session')).mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'session', result: { kind: 'unavailable', reason } }))).mockResolvedValueOnce(sessionResponse('fresh'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Start over' }));

    expect(fetchMock).toHaveBeenCalledTimes(3);

    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('luster.customer-assistant.conversation.isla-nail-studio') ?? 'null')).toMatchObject({ conversation: 'fresh', messages: [], result: null }));

    expect(sessionStorage.getItem('luster.normal-confirm-handoff.v1.salon-id')).toContain('v1.123e4567');
  });

  it('retries the exact stale conversation request without opening a new session', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sessionResponse('session')).mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'session', result: { kind: 'unavailable', reason: 'stale_conversation' } }))).mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'next', result: { kind: 'answer', message: 'Recovered', options: [] } })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/chat', expect.objectContaining({ body: JSON.stringify({ conversation: 'session', message: 'Hello', locale: 'en' }) }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('blocks handoff and navigation when a legacy operation status is unavailable', async () => {
    const operation = { version: 1, salonId: 'salon-id', capability: 'legacy-capability', revision: 1, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' };
    localStorage.setItem('luster.customer-booking.operation.salon-id', JSON.stringify(operation));
    sessionStorage.setItem('luster.customer-assistant.conversation.isla-nail-studio', JSON.stringify({ version: 2, conversation: 'proposal-token', messages: [], result: { kind: 'proposal', proposal: proposal() } }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.click(await screen.findByRole('button', { name: 'Choose these services' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/status');
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('shows a committed legacy status and blocks handoff navigation', async () => {
    const operation = { version: 1, salonId: 'salon-id', capability: 'legacy-capability', revision: 1, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' };
    localStorage.setItem('luster.customer-booking.operation.salon-id', JSON.stringify(operation));
    sessionStorage.setItem('luster.customer-assistant.conversation.isla-nail-studio', JSON.stringify({ version: 2, conversation: 'proposal-token', messages: [], result: { kind: 'proposal', proposal: proposal() } }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: 'booking_status', operation, status: 'confirmed', review: {}, appointment: null, payment: null, lastFailure: null })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.click(await screen.findByRole('button', { name: 'Choose these services' }));

    expect(await screen.findByText('Your appointment is confirmed.')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('adopts a not-created legacy operation before navigation', async () => {
    const operation = { version: 1, salonId: 'salon-id', capability: 'legacy-capability', revision: 1, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' };
    const adopted = { capability: 'server-capability', revision: 2, fingerprint: 'b'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' };
    const flowToken = 'v1.123e4567-e89b-12d3-a456-426614174000.1.signed';
    localStorage.setItem('luster.customer-booking.operation.salon-id', JSON.stringify(operation));
    sessionStorage.setItem('luster.customer-assistant.conversation.isla-nail-studio', JSON.stringify({ version: 2, conversation: 'proposal-token', messages: [], result: { kind: 'proposal', proposal: proposal() } }));
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ kind: 'booking_status', operation, status: 'not_created', review: {}, appointment: null, payment: null, lastFailure: null }))).mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'next', result: { kind: 'handoff', handoff: { selection: proposal().selection, flow: { flowToken, expiresAt: '2030-01-01T00:00:00.000Z' }, operation: adopted } } })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.click(await screen.findByRole('button', { name: 'Choose these services' }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));

    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ body: expect.stringContaining('legacy-capability') }));
    expect(localStorage.getItem('luster.normal-booking.operation.salon-id.123e4567-e89b-12d3-a456-426614174000')).toContain('server-capability');
  });
});
