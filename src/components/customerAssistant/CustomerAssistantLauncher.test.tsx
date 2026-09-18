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
    expect(screen.getByText(/Booking comes next/)).toBeVisible();

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
});
