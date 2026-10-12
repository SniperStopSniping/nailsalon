import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const restricted = {
  ...connected,
  status: 'restricted',
  hasBindingHistory: true,
  lastSyncedAt: '2026-09-28T12:00:00.000Z',
  requirements: { pastDue: ['business_profile.url'], currentlyDue: [] },
};
const refreshed = {
  status: 'charge_ready',
  chargeReady: true,
  payoutsPending: false,
  requirements: null,
  lastSyncedAt: '2026-10-12T18:00:00.000Z',
  stale: false,
};

function healthResponse(value = restricted) {
  return new Response(JSON.stringify({ data: { stripeConnect: value } }), { status: 200 });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
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

  it('shows when status was checked and contacts Stripe only on explicit refresh', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => String(input).startsWith('/api/integrations/health')
      ? healthResponse()
      : new Response(JSON.stringify(refreshed), { status: 200 }));
    render(<StripeConnectPanel salonSlug="studio" />);

    expect(await screen.findByText('Action required')).toBeInTheDocument();
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Check status again' }));

    expect(await screen.findByText('Ready for deposits')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Payment status is up to date.');
    expect(screen.queryByText('business profile → url')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume onboarding' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/integrations/stripe-connect/refresh-status', expect.objectContaining({ method: 'POST', body: JSON.stringify({ salonId: 'salon_1' }) }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last saved status visible when the provider returns a stale fallback', async () => {
    fetchMock.mockResolvedValueOnce(healthResponse()).mockResolvedValueOnce(new Response(JSON.stringify({ ...refreshed, status: 'restricted', chargeReady: false, payoutsPending: null, stale: true }), { status: 200 }));
    render(<StripeConnectPanel salonSlug="studio" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check status again' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not confirm.*last saved status/i);
    expect(screen.getByText('Action required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check status again' })).toBeEnabled();
    expect(screen.queryByText('Payment status is up to date.')).not.toBeInTheDocument();
  });

  it.each([
    [403, { error: { code: 'FORBIDDEN' } }],
    [503, { error: { code: 'UNAVAILABLE' } }],
    [200, {}],
    [200, { ...refreshed, status: 'unexpected' }],
    [200, { ...refreshed, requirements: { pastDue: 'not-an-array' } }],
  ])('preserves payment setup and offers retry after an invalid refresh (%s)', async (status, payload) => {
    fetchMock.mockResolvedValueOnce(healthResponse()).mockResolvedValueOnce(new Response(JSON.stringify(payload), { status }));
    render(<StripeConnectPanel salonSlug="studio" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check status again' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not confirm/i);
    expect(screen.getByText('Action required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume onboarding' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Check status again' })).toBeEnabled();
  });

  it('prevents duplicate refresh and setup requests while a refresh is pending', async () => {
    let resolveRefresh: ((response: Response) => void) | undefined;
    fetchMock.mockResolvedValueOnce(healthResponse()).mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    }));
    render(<StripeConnectPanel salonSlug="studio" />);
    const refreshButton = await screen.findByRole('button', { name: 'Check status again' });
    fireEvent.click(refreshButton);
    fireEvent.click(refreshButton);
    fireEvent.click(screen.getByRole('button', { name: 'Resume onboarding' }));

    expect(screen.getByRole('button', { name: 'Checking status…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resume onboarding' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRefresh?.(new Response(JSON.stringify(refreshed), { status: 200 }));
    });

    expect(await screen.findByRole('button', { name: 'Check status again' })).toBeEnabled();
  });

  it('ignores a prior salon refresh after switching salons and unlocks the new salon', async () => {
    let resolveRefresh: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation((input: RequestInfo | URL) => String(input).includes('refresh-status')
      ? new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      })
      : Promise.resolve(healthResponse(String(input).includes('salonSlug=second') ? { ...restricted, salonId: 'salon_2' } : restricted)));
    const { rerender } = render(<StripeConnectPanel salonSlug="first" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check status again' }));
    rerender(<StripeConnectPanel salonSlug="second" />);

    expect(await screen.findByRole('button', { name: 'Check status again' })).toBeEnabled();

    await act(async () => {
      resolveRefresh?.(new Response(JSON.stringify(refreshed), { status: 200 }));
    });

    expect(screen.getByText('Action required')).toBeInTheDocument();
    expect(screen.queryByText('Ready for deposits')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment status is up to date.')).not.toBeInTheDocument();
  });
});
