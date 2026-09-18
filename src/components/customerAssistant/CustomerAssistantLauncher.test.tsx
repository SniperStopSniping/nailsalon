import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomerAssistantLauncher } from './CustomerAssistantLauncher';

const sessionResponse = (conversation = 'signed-conversation') => new Response(JSON.stringify({ conversation }), { status: 200 });

describe('CustomerAssistantLauncher', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a salon-scoped session and closes back to manual booking', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));

    expect(await screen.findByRole('heading', { name: 'Help me choose' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/public/customer-assistant/isla-nail-studio/session', { method: 'POST' });
    expect(screen.getByText(/find an available time/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Continue manually' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Help me choose' })).not.toBeInTheDocument());
  });

  it('renders structured proposal details and never exposes a booking confirmation action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        conversation: 'rotated-token',
        result: {
          kind: 'proposal',
          proposal: {
            selection: { baseServiceId: 'gel-x', selectedAddOns: [] },
            fingerprint: 'selection-fingerprint',
            service: { id: 'gel-x', name: 'Gel-X Extensions', priceCents: 8500 },
            addOns: [{ id: 'french', name: 'French', quantity: 1, priceCents: 1500 }],
            currency: 'CAD',
            subtotalCents: 10000,
            durationMinutes: 120,
            expiresAt: '2026-09-18T12:00:00.000Z',
          },
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await screen.findByRole('heading', { name: 'Help me choose' });
    await user.type(screen.getByLabelText('Describe the nails you want'), 'Gel-X with French');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('region', { name: 'Suggested services' })).toBeVisible();
    expect(screen.getByText('Gel-X Extensions')).toBeVisible();
    expect(screen.getByText('French')).toBeVisible();
    expect(screen.getByText('$100.00')).toBeVisible();
    expect(screen.getByText('2h')).toBeVisible();
    expect(screen.queryByRole('button', { name: /confirm booking/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/chat', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ conversation: 'signed-conversation', message: 'Gel-X with French', locale: 'en' }),
    }));
  });

  it('keeps a failed chat on the existing token and offers restart only for invalid tokens', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('existing-token'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        conversation: 'existing-token',
        result: { kind: 'unavailable', reason: 'invalid_conversation' },
      }), { status: 200 }))
      .mockResolvedValueOnce(sessionResponse('new-token'));
    vi.stubGlobal('fetch', fetchMock);
    render(<CustomerAssistantLauncher salonSlug="isla-nail-studio" locale="en" />);

    fireEvent.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await screen.findByLabelText('Describe the nails you want');
    fireEvent.change(screen.getByLabelText('Describe the nails you want'), { target: { value: 'Gel-X' } });
    fireEvent.submit(screen.getByLabelText('Describe the nails you want').closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('previous conversation was kept');
    expect(sessionStorage.getItem('luster.customer-assistant.conversation.isla-nail-studio')).toBe('existing-token');
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();

    fireEvent.submit(screen.getByLabelText('Describe the nails you want').closest('form')!);
    const restart = await screen.findByRole('button', { name: 'Start over' });
    fireEvent.click(restart);

    await waitFor(() => expect(sessionStorage.getItem('luster.customer-assistant.conversation.isla-nail-studio')).toBe('new-token'));
  });

  it('retries session creation when initialization failed', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(sessionResponse('retried-token'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText('Describe the nails you want')).toBeEnabled());
  });

  it('continues in memory when session storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('memory-token'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        conversation: 'rotated-memory-token',
        result: { kind: 'clarification', question: 'length', options: ['Short'] },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonSlug="isla-nail-studio" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await screen.findByLabelText('Describe the nails you want');
    await user.type(screen.getByLabelText('Describe the nails you want'), 'Gel-X');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('What length would you like?')).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/chat', expect.objectContaining({
      body: JSON.stringify({ conversation: 'memory-token', message: 'Gel-X', locale: 'en' }),
    }));
  });

  it('sends one deterministic acceptance request for a double tap', async () => {
    const fingerprint = 'f'.repeat(64);
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('session'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'proposal-token', result: { kind: 'proposal', proposal: {
        selection: { baseServiceId: 'gel-x', selectedAddOns: [] },
        fingerprint,
        service: { id: 'gel-x', name: 'Gel-X', priceCents: 8500 },
        addOns: [],
        currency: 'CAD',
        subtotalCents: 8500,
        durationMinutes: 90,
        expiresAt: '2026-09-18T12:05:00Z',
      } } })))
      .mockReturnValueOnce(pending);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonSlug="isla-nail-studio" locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(screen.getByLabelText('Describe the nails you want'), 'Gel-X');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const accept = await screen.findByRole('button', { name: 'Choose these services' });
    fireEvent.click(accept);
    fireEvent.click(accept);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/action', expect.objectContaining({
      body: JSON.stringify({ conversation: 'proposal-token', action: 'accept_selection', fingerprint }),
    }));

    complete(new Response(JSON.stringify({ conversation: 'next-token', result: { kind: 'unavailable', reason: 'unavailable' } })));
    await screen.findByRole('status');
    await waitFor(() => expect(sessionStorage.getItem('luster.customer-assistant.conversation.isla-nail-studio')).toBe('next-token'));
  });

  it('keeps form contact out of chat and browser storage, and invalidates an edited review', async () => {
    const proposal = {
      selection: { baseServiceId: 'gel-x', selectedAddOns: [] },
      fingerprint: 'f'.repeat(64),
      service: { id: 'gel-x', name: 'Gel-X', priceCents: 8500 },
      addOns: [],
      currency: 'CAD',
      subtotalCents: 8500,
      durationMinutes: 90,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    const review = {
      status: 'INCOMPLETE',
      fingerprint: 'r'.repeat(64),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      salon: { id: 'salon', slug: 'isla-nail-studio', name: 'Isla Nail Studio' },
      location: null,
      services: [proposal.service],
      addOns: [],
      technician: { kind: 'any_artist' },
      date: '2026-09-19',
      time: '13:00',
      timeZone: 'America/Toronto',
      durationMinutes: 90,
      financial: { subtotalCents: 8500, estimatedTaxCents: 1105, estimatedTotalCents: 9605, currency: 'CAD' },
      deposit: { status: 'not_required', reason: 'not_enabled' },
      confirmationMode: 'instant',
      bookingPolicy: { required: false },
      blockers: ['reminder_integration', 'identity_pricing'],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionResponse('session-token'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'selected-token', result: { kind: 'slot_selected', proposal, preference: { date: '2026-09-19', earliest: '12:00', latest: '17:00' }, timeZone: 'America/Toronto', slot: { time: '13:00', startTime: '2026-09-19T17:00:00Z' } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: 'review-token', result: { kind: 'review_prepared', review } })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAssistantLauncher salonSlug="isla-nail-studio" locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Help me choose & book' }));
    await user.type(screen.getByLabelText('Describe the nails you want'), 'Saturday');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.type(await screen.findByLabelText('Full name'), 'Alex Test');
    await user.type(screen.getByLabelText('Email address'), 'alex@example.test');
    await user.type(screen.getByLabelText('Phone number'), '4165550100');
    const submit = screen.getByRole('button', { name: 'Review booking details' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(await screen.findByRole('region', { name: 'Your booking details' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/public/customer-assistant/isla-nail-studio/review', expect.objectContaining({
      body: JSON.stringify({ conversation: 'selected-token', contact: { name: 'Alex Test', email: 'alex@example.test', phone: '4165550100' } }),
    }));
    expect(fetchMock.mock.calls[1]?.[1]?.body).not.toMatch(/Alex|alex@example|416555/);
    expect(JSON.stringify(sessionStorage)).not.toMatch(/Alex|alex@example|416555/);
    expect(JSON.stringify(localStorage)).not.toMatch(/Alex|alex@example|416555/);
    expect(screen.getByLabelText('Email address')).toHaveValue('alex@example.test');

    await user.type(screen.getByLabelText('Full name'), ' Updated');

    expect(screen.queryByRole('region', { name: 'Your booking details' })).not.toBeInTheDocument();
    expect(screen.getByText('Your contact details changed. Review the booking details again.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /confirm booking/i })).not.toBeInTheDocument();
  });
});
