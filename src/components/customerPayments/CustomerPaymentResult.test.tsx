import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CustomerPaymentResult from './CustomerPaymentResult';

const fetchMock = vi.fn();
const response = (status = 'pending', refundedCents = 0) => ({ ok: true, json: async () => ({ data: { status, currency: 'CAD', amountCents: 11300, refundedCents } }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/payments/result?result=success#status=synthetic-status-capability');
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('customer payment return', () => {
  it('ignores success query parameters and confirms only the status returned by the server', async () => {
    fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce(response('received', 1300));
    render(<CustomerPaymentResult />);
    await screen.findByText('$113.00 CAD');

    expect(screen.getByRole('heading')).toHaveTextContent('Checking your payment');
    expect(fetchMock).toHaveBeenCalledWith('/api/public/payments/status', expect.objectContaining({ method: 'POST', cache: 'no-store', credentials: 'omit', body: JSON.stringify({ token: 'synthetic-status-capability' }) }));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }));
    await screen.findByRole('heading', { name: 'Payment received' });

    expect(screen.getByText('$13.00 CAD')).toBeInTheDocument();
    expect(screen.getByText('Refund confirmed')).toBeInTheDocument();
  });

  it('does not request payment status with missing or expired access', async () => {
    window.history.replaceState(null, '', '/payments/result?result=success&operation=guessed');
    const rendered = render(<CustomerPaymentResult />);
    await screen.findByRole('heading', { name: 'Payment status unavailable' });

    expect(fetchMock).not.toHaveBeenCalled();

    rendered.unmount();
    window.history.replaceState(null, '', '/payments/result#status=expired');
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    render(<CustomerPaymentResult />);
    await screen.findByRole('heading', { name: 'Payment status unavailable' });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('retains the last verified receipt when a refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(response('received')).mockRejectedValueOnce(new TypeError('Network unavailable'));
    render(<CustomerPaymentResult />);
    await screen.findByRole('heading', { name: 'Payment received' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }));
    await screen.findByText(/could not refresh/);

    expect(screen.getByRole('heading')).toHaveTextContent('Payment received');
  });

  it('stops automatic checks after six reads and offers an explicit refresh', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(response());
    render(<CustomerPaymentResult />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(screen.getByRole('button', { name: 'Refresh payment status' })).toBeEnabled();
  });

  it('ignores stale responses after a Strict Mode effect restart', async () => {
    let resolveOld: (value: ReturnType<typeof response>) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveOld = resolve;
    })).mockResolvedValueOnce(response('received'));
    render(<StrictMode><CustomerPaymentResult /></StrictMode>);
    await screen.findByRole('heading', { name: 'Payment received' });
    await act(async () => resolveOld(response('closed')));

    expect(screen.getByRole('heading')).toHaveTextContent('Payment received');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
