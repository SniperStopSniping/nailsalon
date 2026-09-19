import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StripeConnectPanel } from './StripeConnectPanel';

const fetchMock = vi.fn();
const connected = {
  salonId: 'salon_1',
  visible: true,
  status: 'not_connected',
  chargeReady: false,
  payoutsPending: false,
  hasBindingHistory: false,
  lastSyncedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('StripeConnectPanel', () => {
  it('uses the existing server-owned account-link request only after showing the selected salon status', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/integrations/health')) {
        return new Response(JSON.stringify({ data: { stripeConnect: connected } }), { status: 200 });
      }
      if (String(input) === '/api/integrations/stripe-connect/onboard') {
        return new Response(JSON.stringify({}), { status: 500 });
      }
      return new Response('{}', { status: 404 });
    });
    render(<StripeConnectPanel salonSlug="studio" />);

    expect(await screen.findByText('Not connected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set up payments' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/integrations/stripe-connect/onboard', expect.objectContaining({ method: 'POST', body: JSON.stringify({ salonId: 'salon_1' }) })));

    expect(await screen.findByText(/Payment setup could not be started/i)).toBeInTheDocument();
  });

  it('shows a retryable status failure instead of treating a failed response as no payments setup', async () => {
    fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }));
    render(<StripeConnectPanel salonSlug="studio" />);

    expect(await screen.findByRole('status')).toHaveTextContent(/Payment status could not be loaded/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('ignores a stale health result after the selected salon changes', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes('salonSlug=first')) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ data: { stripeConnect: { ...connected, salonId: 'salon_2', status: 'charge_ready' } } }), { status: 200 }));
    });
    const { rerender } = render(<StripeConnectPanel salonSlug="first" />);
    rerender(<StripeConnectPanel salonSlug="second" />);

    expect(await screen.findByText('Ready for deposits')).toBeInTheDocument();

    resolveFirst?.(new Response(JSON.stringify({ data: { stripeConnect: connected } }), { status: 200 }));
    await waitFor(() => expect(screen.queryByText('Not connected')).not.toBeInTheDocument());
  });
});
