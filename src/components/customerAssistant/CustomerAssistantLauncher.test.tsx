import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomerReadyReviewSnapshot } from '@/libs/customerAssistant/reviewContracts';

import { BookingStatusCard, CustomerAssistantLauncher, CustomerBookingRecovery } from './CustomerAssistantLauncher';

const navigation = vi.hoisted(() => ({ push: vi.fn(), params: {}, pathname: '/en/isla-nail-studio/book/service' }));
const bookingState = vi.hoisted(() => ({ applyAssistantHandoff: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => navigation.params,
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

vi.mock('@/hooks/useBookingState', () => ({
  useBookingState: () => bookingState,
}));

const sessionResponse = (conversation = 'signed-conversation', salonName = 'Isla Nail Studio') => new Response(JSON.stringify({ conversation, salon: { name: salonName } }), { status: 200 });
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
    navigation.params = {};
    navigation.pathname = '/en/isla-nail-studio/book/service';
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

    expect(await screen.findByRole('heading', { name: 'AI booking assistant' })).toBeVisible();
    expect(await screen.findByText('Hey! Welcome to Isla Nail Studio 💅 I’m your AI receptionist. How can I help?')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Book an appointment' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/public/customer-assistant/isla-nail-studio/session', { method: 'POST' });

    await user.click(screen.getByRole('button', { name: 'Continue manually' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'AI booking assistant' })).not.toBeInTheDocument());
  });

  it('opens the normal service selector from the welcome action without a chat request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse());
    vi.stubGlobal('fetch', fetchMock);
    navigation.pathname = '/en/isla-nail-studio';
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" campaignToken="campaign-token" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.click(await screen.findByRole('button', { name: 'Book an appointment' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith('/en/isla-nail-studio/book/service?campaign=campaign-token');
    expect(screen.queryByRole('heading', { name: 'AI booking assistant' })).not.toBeInTheDocument();
  });

  it('keeps the assistant open and starts consultation when already on service selection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse());
    vi.stubGlobal('fetch', fetchMock);
    navigation.params = { slug: 'isla-nail-studio' };
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.click(await screen.findByRole('button', { name: 'Book an appointment' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'AI booking assistant' })).toBeVisible();
    expect(screen.getByText(/What are you hoping for today/)).toBeVisible();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('starts a local consultation prompt without a chat request and focuses the composer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.click(await screen.findByRole('button', { name: 'Help me choose' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/What are you hoping for today/)).toBeVisible();

    await waitFor(() => expect(screen.getByLabelText('Tell me what you would like')).toHaveFocus());
  });

  it('shows authoritative public prices without a chat request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ salon: { name: 'Isla Nail Studio' }, catalogue: { currency: 'CAD', services: [{ id: 'gel-x', name: 'Gel-X Extensions', description: 'Extensions with flexible length options.', price: { baseDisplay: '$85.00', displayLabel: null, range: null } }] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.click(await screen.findByRole('button', { name: 'See prices' }));

    const prices = await screen.findByRole('region', { name: 'Current service prices' });

    expect(prices).toHaveTextContent('Gel-X Extensions');
    expect(prices).toHaveTextContent('$85.00');

    expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/prices');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resumes the same branded welcome without issuing another session and restarts with a fresh welcome', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('first-session', 'First Salon'))
      .mockResolvedValueOnce(sessionResponse('second-session', 'First Salon'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));

    expect(await screen.findByText(/Welcome to First Salon/)).toBeVisible();

    await user.click(screen.getByLabelText('Close assistant'));
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));

    expect(await screen.findByText(/Welcome to First Salon/)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Start a new conversation' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(await screen.findByText(/Welcome to First Salon/)).toBeVisible();
  });

  it('restores legacy stored welcome labels as deterministic actions', async () => {
    sessionStorage.setItem('luster.customer-assistant.conversation.isla-nail-studio', JSON.stringify({
      version: 2,
      conversation: 'legacy-welcome',
      messages: [{ id: 1, role: 'assistant', message: 'Hey! Welcome to Isla Nail Studio 💅 I’m your AI receptionist. How can I help?' }],
      result: null,
      welcomeQuickReplies: ['Book an appointment', 'See prices', 'Help me choose'],
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));

    expect(await screen.findByRole('button', { name: 'Book an appointment' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'See prices' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Help me choose' })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders server-priced consultation choices and sends their authoritative message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        conversation: 'length-token',
        result: {
          kind: 'clarification',
          question: 'length',
          options: ['Medium'],
          choices: [
            { label: 'Medium', message: 'Medium', deltaCents: 1000, subtotalCents: 8000, durationMinutes: 100, currency: 'CAD' },
          ],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'next-token', result: { kind: 'answer', message: 'Perfect!', options: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Extensions');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const medium = await screen.findByRole('button', { name: /Medium.*\+\$10\.00.*1h 40m/i });

    expect(medium).toHaveTextContent('Subtotal $80.00');

    await user.click(medium);

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/chat', expect.objectContaining({ body: JSON.stringify({ conversation: 'length-token', message: 'Medium', locale: 'en' }) })));
  });

  it('shows authoritative service and add-on line prices, per-unit repairs, and included options', async () => {
    const packageQuote = { ...proposal(), addOns: [
      { id: 'repairs', name: 'Nail repair', quantity: 2, unitPriceCents: 300, priceCents: 600 },
      { id: 'included', name: 'Included finish', quantity: 1, unitPriceCents: 0, priceCents: 0 },
    ], subtotalCents: 9100 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sessionResponse()).mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'package-token', result: { kind: 'proposal', proposal: packageQuote } }), { status: 200 })));
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'My complete package');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const card = await screen.findByRole('region', { name: 'Your appointment package' });

    expect(card).toHaveTextContent('Gel-X Extensions$85.00');
    expect(card).toHaveTextContent('2 × Nail repair$3.00 each · $6.00 total');
    expect(card).toHaveTextContent('Included finishIncluded');
    expect(card).toHaveTextContent('$91.00');
    expect(card).not.toHaveTextContent('$0.00');
  });

  it('binds a campaign session without persisting its raw token and preserves it through assistant handoff', async () => {
    const token = 'campaign-token-12345678901234567890';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('campaign-session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'proposal-token', result: { kind: 'proposal', proposal: proposal() } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        conversation: 'handoff-token',
        result: { kind: 'handoff', handoff: { selection: proposal().selection, flow: { flowToken: 'v1.123e4567-e89b-12d3-a456-426614174000.1.signed', expiresAt: '2030-01-01T00:00:00.000Z' } } },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.setItem('luster.customer-assistant.conversation.isla-nail-studio', JSON.stringify({ version: 2, conversation: 'old-session', messages: [], result: { kind: 'proposal', proposal: proposal() } }));
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" campaignToken={token} />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Gel-X');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Choose these services' }));

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/public/customer-assistant/isla-nail-studio/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaignToken: token }),
    });

    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));

    expect(navigation.push.mock.calls[0]?.[0]).toContain(`campaign=${token}`);
    expect(sessionStorage.getItem('luster.customer-assistant.conversation.isla-nail-studio')).not.toContain(token);
  });

  it('keeps the same campaign conversation on close and reopen without storing its bearer token', async () => {
    const token = 'campaign-token-12345678901234567890';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('campaign-session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'campaign-answer', result: { kind: 'answer', message: 'Your offer is ready to review.', options: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" campaignToken={token} />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'What is my offer?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Your offer is ready to review.')).toBeVisible();

    await user.click(screen.getByLabelText('Close assistant'));
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));

    expect(await screen.findByText('Your offer is ready to review.')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const stored = sessionStorage.getItem('luster.customer-assistant.conversation.isla-nail-studio');

    expect(stored).not.toContain(token);
    expect(JSON.parse(stored ?? '{}').campaignBinding).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not restore a campaign-bound conversation on an ordinary visit or a different campaign link', async () => {
    const firstToken = 'campaign-token-12345678901234567890';
    const secondToken = 'campaign-token-abcdefghijklmnopqrst';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('first-session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'first-answer', result: { kind: 'answer', message: 'First campaign answer.', options: [] } }), { status: 200 }))
      .mockResolvedValueOnce(sessionResponse('ordinary-session'))
      .mockResolvedValueOnce(sessionResponse('second-session'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const view = render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" campaignToken={firstToken} />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'First offer');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('First campaign answer.')).toBeVisible();

    view.rerender(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(screen.queryByText('First campaign answer.')).not.toBeInTheDocument();

    view.rerender(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" campaignToken={secondToken} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaignToken: secondToken }),
    });
  });

  it('does not let a delayed campaign chat replace a newer campaign session', async () => {
    const firstToken = 'campaign-token-12345678901234567890';
    const secondToken = 'campaign-token-abcdefghijklmnopqrst';
    let resolveDelayedChat!: (response: Response) => void;
    const delayedChat = new Promise<Response>((resolve) => {
      resolveDelayedChat = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('first-session'))
      .mockReturnValueOnce(delayedChat)
      .mockResolvedValueOnce(sessionResponse('second-session'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const view = render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" campaignToken={firstToken} />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'First offer');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    view.rerender(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" campaignToken={secondToken} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    resolveDelayedChat(new Response(JSON.stringify({ conversation: 'stale-first-answer', result: { kind: 'answer', message: 'Stale first offer.', options: [] } }), { status: 200 }));

    await waitFor(() => expect(sessionStorage.getItem('luster.customer-assistant.conversation.isla-nail-studio')).toContain('second-session'));

    expect(screen.queryByText('Stale first offer.')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('luster.customer-assistant.conversation.isla-nail-studio')).not.toContain('stale-first-answer');
  });

  it('does not let a delayed campaign handoff navigate after the booking scope changes', async () => {
    const firstToken = 'campaign-token-12345678901234567890';
    const secondToken = 'campaign-token-abcdefghijklmnopqrst';
    let resolveDelayedHandoff!: (response: Response) => void;
    const delayedHandoff = new Promise<Response>((resolve) => {
      resolveDelayedHandoff = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('first-session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'proposal-token', result: { kind: 'proposal', proposal: proposal() } }), { status: 200 }))
      .mockReturnValueOnce(delayedHandoff)
      .mockResolvedValueOnce(sessionResponse('second-session'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const view = render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" campaignToken={firstToken} />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Gel-X');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Choose these services' }));

    view.rerender(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" campaignToken={secondToken} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    resolveDelayedHandoff(new Response(JSON.stringify({
      conversation: 'stale-handoff',
      result: { kind: 'handoff', handoff: { selection: proposal().selection, flow: { flowToken: 'v1.123e4567-e89b-12d3-a456-426614174000.1.signed', expiresAt: '2030-01-01T00:00:00.000Z' } } },
    }), { status: 200 }));

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(navigation.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('luster.normal-confirm-handoff.v1.salon-id')).toBeNull();
  });

  it('does not let a delayed handoff navigate after the assistant closes', async () => {
    let resolveDelayedHandoff!: (response: Response) => void;
    const delayedHandoff = new Promise<Response>((resolve) => {
      resolveDelayedHandoff = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'proposal-token', result: { kind: 'proposal', proposal: proposal() } }), { status: 200 }))
      .mockReturnValueOnce(delayedHandoff);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Gel-X');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Choose these services' }));
    await user.click(screen.getByLabelText('Close assistant'));
    resolveDelayedHandoff(new Response(JSON.stringify({
      conversation: 'stale-handoff',
      result: { kind: 'handoff', handoff: { selection: proposal().selection, flow: { flowToken: 'v1.123e4567-e89b-12d3-a456-426614174000.1.signed', expiresAt: '2030-01-01T00:00:00.000Z' } } },
    }), { status: 200 }));

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(navigation.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('luster.normal-confirm-handoff.v1.salon-id')).toBeNull();
  });

  it('invalidates a restarted session before a later pending handoff closes', async () => {
    let resolveDelayedHandoff!: (response: Response) => void;
    const delayedHandoff = new Promise<Response>((resolve) => {
      resolveDelayedHandoff = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('initial-session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'expired-session', result: { kind: 'unavailable', reason: 'conversation_used' } }), { status: 200 }))
      .mockResolvedValueOnce(sessionResponse('restarted-session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'proposal-token', result: { kind: 'proposal', proposal: proposal() } }), { status: 200 }))
      .mockReturnValueOnce(delayedHandoff);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Start over' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Gel-X');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Choose these services' }));
    await user.click(screen.getByLabelText('Close assistant'));
    resolveDelayedHandoff(new Response(JSON.stringify({
      conversation: 'stale-handoff',
      result: { kind: 'handoff', handoff: { selection: proposal().selection, flow: { flowToken: 'v1.123e4567-e89b-12d3-a456-426614174000.1.signed', expiresAt: '2030-01-01T00:00:00.000Z' } } },
    }), { status: 200 }));

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(navigation.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('luster.normal-confirm-handoff.v1.salon-id')).toBeNull();
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
      body: JSON.stringify({ conversation: 'proposal-token', fingerprint, locale: 'en' }),
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'answer-token', result: { kind: 'answer', message: 'Would you like French tips?', options: ['Yes', 'No'] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'next-token', result: { kind: 'answer', message: 'French tips selected.', options: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonId="salon-id" salonSlug="isla-nail-studio" locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(await screen.findByLabelText('Tell me what you would like'), 'Gel manicure');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Would you like French tips?')).toBeVisible();
    expect(screen.getByLabelText('You')).toHaveTextContent('Gel manicure');
    expect(screen.getAllByLabelText('Assistant').at(-1)).toHaveTextContent('Would you like French tips?');

    await user.click(screen.getByLabelText('Close assistant'));
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));

    expect(await screen.findByLabelText('You')).toHaveTextContent('Gel manicure');
    expect(screen.getAllByLabelText('Assistant').at(-1)).toHaveTextContent('Would you like French tips?');

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/chat', expect.objectContaining({ body: JSON.stringify({ conversation: 'answer-token', message: 'Yes', locale: 'en' }) })));

    expect(await screen.findByText('French tips selected.')).toBeVisible();
    expect(screen.getByLabelText('You chose: Yes')).toHaveTextContent('Yes');
    expect(screen.getByLabelText('You')).toHaveTextContent('Gel manicure');

    await user.click(screen.getByLabelText('Close assistant'));
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));

    expect(await screen.findByLabelText('You chose: Yes')).toBeVisible();
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

    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('luster.customer-assistant.conversation.isla-nail-studio') ?? 'null')).toMatchObject({
      conversation: 'fresh',
      messages: [{ role: 'assistant', message: expect.stringContaining('Welcome to Isla Nail Studio') }],
      result: null,
    }));

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
