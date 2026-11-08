import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerPaymentQuotePreview } from './CustomerPaymentQuotePreview';

const fetchMock = vi.fn();
function quote(tipCents = 0, extra = {}) {
  return { data: { quoteId: 'quote1', fingerprint: 'a'.repeat(64), expiresAt: new Date(Date.now() + 300000).toISOString(), testOnly: true, collectionEnabled: false, executable: false, currency: 'CAD', servicesCents: 10500, discountCents: 0, taxCents: 1365, tipCents, customerFeeCents: 0, totalCents: 11865 + tipCents, dueNowCents: 11865 + tipCents, remainingCents: 0, ...extra } };
}
function response(value = quote(), status = 200) {
  return new Response(JSON.stringify(value), { status });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('appointment-bound non-executable quote preview', () => {
  it('never requests on mount and displays only server quote amounts', async () => {
    render(<CustomerPaymentQuotePreview token="test-token" />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Test payment quote preview' })).toHaveAttribute('id', 'customer-payment-preview');
    expect(screen.getByRole('button', { name: 'No tip' })).toHaveAttribute('aria-pressed', 'true');

    fetchMock.mockResolvedValueOnce(response());
    fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' }));
    await waitFor(() => expect(screen.getByText('Preview total: $118.65')).toBeVisible());

    expect(fetchMock).toHaveBeenCalledWith('/api/public/appointments/manage/test-token/payment-quote', expect.objectContaining({ method: 'POST', referrerPolicy: 'no-referrer' }));
    expect(screen.queryByRole('button', { name: /secure payment|pay now/i })).not.toBeInTheDocument();
  });

  it('retries identical request after uncertain outcome', async () => {
    render(<CustomerPaymentQuotePreview token="test-token" />);
    fetchMock.mockRejectedValueOnce(new Error('lost response'));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry same quote request' })).toBeEnabled());

    expect(screen.getByLabelText('Custom tip (CAD)')).toBeDisabled();

    fetchMock.mockResolvedValueOnce(response());
    fireEvent.click(screen.getByRole('button', { name: 'Retry same quote request' }));
    await waitFor(() => expect(screen.getByText('Preview total: $118.65')).toBeVisible());

    expect(fetchMock.mock.calls[0]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
  });

  it('suppresses repeated submit and rejects a late response after tip changes', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((done) => {
      resolve = done;
    }));
    render(<CustomerPaymentQuotePreview token="test-token" />);
    const button = screen.getByRole('button', { name: 'Prepare test quote' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByLabelText('Custom tip (CAD)'), { target: { value: '5.25' } });
    await act(async () => resolve(response()));

    expect(screen.queryByText('Preview total: $118.65')).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(response(quote(525)));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' }));
    await waitFor(() => expect(screen.getByText('Preview total: $123.90')).toBeVisible());

    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).requestId).not.toBe(JSON.parse(fetchMock.mock.calls[0]![1].body).requestId);
  });

  it('removes stale quote on conflict and starts a new review request', async () => {
    fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ data: {} } as ReturnType<typeof quote>, 409)).mockResolvedValueOnce(response());
    render(<CustomerPaymentQuotePreview token="test-token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recheck test quote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Recheck test quote' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('appointment details changed'));

    expect(screen.queryByText('Preview total: $118.65')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' }));
    await waitFor(() => expect(screen.getByText('Preview total: $118.65')).toBeVisible());

    expect(JSON.parse(fetchMock.mock.calls[2]![1].body).requestId).not.toBe(JSON.parse(fetchMock.mock.calls[1]![1].body).requestId);
  });

  it('does not accept executable, incorrect-tip or inconsistent responses', async () => {
    fetchMock.mockResolvedValueOnce(response(quote(0, { executable: true })));
    render(<CustomerPaymentQuotePreview token="test-token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be verified'));

    expect(screen.queryByText(/Preview total:/)).not.toBeInTheDocument();
  });

  it('aborts an in-flight request when unmounted', () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<CustomerPaymentQuotePreview token="test-token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' }));
    unmount();

    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it('expires the displayed quote and requires a fresh request before amounts return', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(response(quote(0, { expiresAt: new Date(Date.now() + 1000).toISOString() })));
    render(<CustomerPaymentQuotePreview token="test-token" />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' })));

    expect(screen.getByText('Preview total: $118.65')).toBeVisible();

    await act(async () => vi.advanceTimersByTime(1001));

    expect(screen.queryByText('Preview total: $118.65')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('This test quote expired');

    fetchMock.mockResolvedValueOnce(response());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' })));

    expect(screen.getByText('Preview total: $118.65')).toBeVisible();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).requestId).not.toBe(JSON.parse(fetchMock.mock.calls[0]![1].body).requestId);
  });

  it('ignores an old response after navigation replaces the keyed appointment preview', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => {
      finish = resolve;
    }));
    const { rerender } = render(<CustomerPaymentQuotePreview key="old-token" token="old-token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' }));
    rerender(<CustomerPaymentQuotePreview key="new-token" token="new-token" />);

    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    await act(async () => finish(response()));

    expect(screen.queryByText('Preview total: $118.65')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare test quote' })).toBeEnabled();

    fetchMock.mockResolvedValueOnce(response());
    fireEvent.click(screen.getByRole('button', { name: 'Prepare test quote' }));
    await screen.findByText('Preview total: $118.65');

    expect(fetchMock).toHaveBeenLastCalledWith('/api/public/appointments/manage/new-token/payment-quote', expect.anything());
  });
});
