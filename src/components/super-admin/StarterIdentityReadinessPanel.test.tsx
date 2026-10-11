import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StarterIdentityReadinessPanel } from './StarterIdentityReadinessPanel';

const fetchMock = vi.fn();
const ready = { keysReady: true, totalClaims: 8, missingEmail: 0, missingPhone: 0, purgedClaims: 1, ready: true, newClaimsEnabled: false };
const response = (data: unknown = ready) => new Response(JSON.stringify({ data }));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('loads counts from the existing uncached protected GET without enabling or granting anything', async () => {
  fetchMock.mockResolvedValue(response());
  render(<StarterIdentityReadinessPanel />);

  expect(await screen.findByText('New claims paused')).toBeInTheDocument();
  expect(screen.getByText(/identity checks are complete/i)).toBeInTheDocument();
  expect(screen.getByText('8')).toBeInTheDocument();
  expect(screen.getByText('1', { exact: true })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/super-admin/billing/starter-identity-readiness', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    signal: expect.any(AbortSignal),
  });
  expect(screen.getAllByRole('button')).toHaveLength(1);
});

it.each([
  [{ ...ready, ready: false, keysReady: false }, /Identity protection needs setup/],
  [{ ...ready, ready: false, missingPhone: 8 }, /Earlier allowances need verified contact links/],
  [{ ...ready, ready: false, missingEmail: 2, newClaimsEnabled: true }, /New claims are enabled, but earlier allowances/],
  [{ ...ready, newClaimsEnabled: true }, /Each owner still needs a verified email and phone/],
])('distinguishes configuration, history and activation states', async (report, text) => {
  fetchMock.mockResolvedValue(response(report));
  render(<StarterIdentityReadinessPanel />);

  expect(await screen.findByText(text)).toBeInTheDocument();
});

it.each([401, 403])('shows an access problem instead of counts for HTTP %s', async (status) => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Private server detail' }), { status }));
  render(<StarterIdentityReadinessPanel />);

  expect(await screen.findByText('Sign in to super admin to check free-text claims.')).toBeInTheDocument();
  expect(screen.queryByText('Historical allowances')).not.toBeInTheDocument();
  expect(screen.queryByText(/Private server detail/)).not.toBeInTheDocument();
});

it.each([{}, { ...ready, totalClaims: -1 }, { ...ready, ready: 'true' }, { ...ready, missingPhone: null }])('does not fabricate balances from malformed report data', async (data) => {
  fetchMock.mockResolvedValue(response(data));
  render(<StarterIdentityReadinessPanel />);

  expect(await screen.findByText(/could not be checked/)).toBeInTheDocument();
  expect(screen.queryByText('Historical allowances')).not.toBeInTheDocument();
});

it('recovers from a failed report with a read-only refresh', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(response());
  render(<StarterIdentityReadinessPanel />);

  expect(await screen.findByText(/could not be checked/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Refresh report' }));

  expect(await screen.findByText('New claims paused')).toBeInTheDocument();
  expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(['GET', 'GET']);
});

it('clears old counts if refreshing fails', async () => {
  fetchMock.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('Network down'));
  render(<StarterIdentityReadinessPanel />);

  expect(await screen.findByText('Historical allowances')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Refresh report' }));

  expect(await screen.findByText(/could not be checked/)).toBeInTheDocument();
  expect(screen.queryByText('Historical allowances')).not.toBeInTheDocument();
});

it('offers a retry when a report request hangs, without accepting its late result', async () => {
  vi.useFakeTimers();
  let finish: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
    finish = resolve;
  }));
  render(<StarterIdentityReadinessPanel />);
  await act(async () => vi.advanceTimersByTimeAsync(15_000));

  expect(screen.getByRole('status')).toHaveTextContent(/could not be checked/);
  expect(screen.getByRole('button', { name: 'Refresh report' })).toBeEnabled();
  expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);

  await act(async () => finish?.(response()));

  expect(screen.queryByText('Historical allowances')).not.toBeInTheDocument();
});

it('aborts pending requests on unmount and ignores late responses', async () => {
  let finish: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
    finish = resolve;
  }));
  const view = render(<StarterIdentityReadinessPanel />);

  expect(screen.getByRole('button', { name: 'Refresh report' })).toBeDisabled();

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
  view.unmount();

  expect(signal.aborted).toBe(true);

  await act(async () => finish?.(response()));

  expect(screen.queryByText('Historical allowances')).not.toBeInTheDocument();
});
