import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SalonProvider } from '@/providers/SalonProvider';

import { DepositStatusPanel } from './DepositStatusPanel';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

function mockSessionStatus(body: Record<string, unknown>) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('DepositStatusPanel — hold countdown and resume', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/?session_id=cs_test_1');
  });

  it('counts down from the endpoint\'s authoritative expiry and offers resume while live', async () => {
    const holdExpiresAt = '2030-03-20T15:35:00.000Z';
    mockSessionStatus({
      state: 'awaiting_payment',
      holdExpiresAt,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });

    render(
      <SalonProvider bookingTimeZone="America/Vancouver">
        <DepositStatusPanel variant="cancel" />
      </SalonProvider>,
    );

    expect(await screen.findByTestId('hold-countdown')).toBeInTheDocument();
    expect(screen.getByTestId('hold-deadline')).toHaveAttribute('datetime', holdExpiresAt);
    expect(screen.getByTestId('hold-deadline')).toHaveTextContent(/8:35.*PDT/i);
    expect(screen.getByText(/salon local time/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Resume payment' })).toHaveAttribute(
      'href',
      'https://checkout.stripe.com/c/pay/cs_test_1',
    );
  });

  it('an expired hold shows the released copy and never offers resume', async () => {
    // The endpoint answered while its snapshot said awaiting_payment, but the
    // authoritative expiry is already in the past by render time.
    mockSessionStatus({
      state: 'awaiting_payment',
      holdExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });

    render(<DepositStatusPanel variant="cancel" />);

    expect(await screen.findByText(/hold has ended/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Resume payment' })).not.toBeInTheDocument();
  });

  it('a session-status response without a checkout URL renders no resume link', async () => {
    mockSessionStatus({
      state: 'awaiting_payment',
      holdExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });

    render(<DepositStatusPanel variant="cancel" />);

    expect(await screen.findByTestId('hold-countdown')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Resume payment' })).not.toBeInTheDocument();
  });
});
