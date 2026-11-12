import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '@/libs/customerPayments/settings';

import { CustomerPaymentDraftSettings } from './CustomerPaymentDraftSettings';

const fetchMock = vi.fn();
const initial = { revision: 0, settings: DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, testOnly: true, collectionEnabled: false };
const saved = { ...initial, revision: 1, settings: { ...initial.settings, enabled: true } };
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValueOnce(response(initial));
});

afterEach(() => vi.unstubAllGlobals());

async function edit() {
  render(<CustomerPaymentDraftSettings salonSlug="test-salon" />);
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('persisted test payment draft editor', () => {
  it('loads disabled settings and saves a separate owner draft', async () => {
    await edit();
    fetchMock.mockResolvedValueOnce(response(saved));
    fireEvent.click(screen.getByRole('button', { name: 'Save test draft' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Live collection remains off'));

    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/salon/customer-payments?salonSlug=test-salon', expect.objectContaining({ method: 'PATCH' }));

    const body = JSON.parse(fetchMock.mock.calls[1]![1].body);

    expect(body).toMatchObject({ expectedRevision: 0, settings: { enabled: true, mode: 'optional_full', feePayer: 'salon' } });
    expect(body.requestId).toEqual(expect.any(String));
  });

  it('retries the same request identity after uncertain outcome and freezes edits', async () => {
    await edit();
    fetchMock.mockRejectedValueOnce(new Error('lost response'));
    fireEvent.click(screen.getByRole('button', { name: 'Save test draft' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry same save' })).toBeEnabled());

    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload saved draft' })).toBeDisabled();

    fetchMock.mockResolvedValueOnce(response(saved));
    fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Test draft saved'));

    expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[2]![1].body);
  });

  it('requires reload after revision conflict and never claims save success', async () => {
    await edit();
    fetchMock.mockResolvedValueOnce(response({}, 409));
    fireEvent.click(screen.getByRole('button', { name: 'Save test draft' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Reload it'));

    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(response(saved));
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved draft' }));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
  });
});
