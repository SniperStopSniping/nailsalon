import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerPaymentLiveSettings } from './CustomerPaymentLiveSettings';

const fetchMock = vi.fn();
const initial = { revision: 0, enabled: false, cancellationPolicy: '', platformFeeCents: 0, mode: 'optional_full', feePayer: 'salon', setupAvailable: true };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(response(initial));
});

describe('owner customer payment activation', () => {
  it('requires explicit opt-in and a policy, then reads the latest state after saving', async () => {
    fetchMock.mockResolvedValueOnce(response(initial));
    render(<CustomerPaymentLiveSettings salonSlug="salon" />);
    const enable = await screen.findByRole('checkbox', { name: 'Accept online customer payments' });
    await waitFor(() => expect(enable).toBeEnabled());

    expect(enable).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(enable);

    expect(screen.getByRole('button', { name: 'Save payment settings' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Cancellation and refund policy'), { target: { value: 'Contact us before changing your booking.' } });
    fetchMock.mockResolvedValueOnce(response({ ...initial, revision: 1, enabled: true }));
    // Another owner disabled collection after the original successful save.
    fetchMock.mockResolvedValueOnce(response({ ...initial, revision: 2, enabled: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Save payment settings' }));

    expect(await screen.findByRole('status')).toHaveTextContent('settings saved');
    expect(enable).not.toBeChecked();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ expectedRevision: 0, enabled: true, cancellationPolicy: 'Contact us before changing your booking.' });
  });

  it('locks edits after a lost response and retries with the same durable identity', async () => {
    fetchMock.mockResolvedValueOnce(response(initial));
    render(<CustomerPaymentLiveSettings salonSlug="salon" />);
    const enable = await screen.findByRole('checkbox', { name: 'Accept online customer payments' });
    await waitFor(() => expect(enable).toBeEnabled());
    fireEvent.click(enable);
    fireEvent.change(screen.getByLabelText('Cancellation and refund policy'), { target: { value: 'Refund policy' } });
    fetchMock.mockRejectedValueOnce(new TypeError('Network response lost'));
    fireEvent.click(screen.getByRole('button', { name: 'Save payment settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
    expect(enable).toBeDisabled();

    const firstBody = fetchMock.mock.calls[1]![1].body;
    fetchMock.mockResolvedValueOnce(response({ ...initial, revision: 1, enabled: true, cancellationPolicy: 'Refund policy' }));
    fetchMock.mockResolvedValueOnce(response({ ...initial, revision: 1, enabled: true, cancellationPolicy: 'Refund policy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry this save' }));
    await screen.findByRole('status');

    expect(fetchMock.mock.calls[2]![1].body).toBe(firstBody);
    expect(enable).toBeEnabled();
    expect(enable).toBeChecked();
  });

  it('allows an owner to turn collection off when provider execution is unavailable', async () => {
    fetchMock.mockResolvedValueOnce(response({ ...initial, enabled: true, revision: 2, setupAvailable: false, cancellationPolicy: 'Refund policy' }));
    render(<CustomerPaymentLiveSettings salonSlug="salon" />);
    const enable = await screen.findByRole('checkbox', { name: 'Accept online customer payments' });
    await waitFor(() => expect(enable).toBeChecked());

    expect(enable).toBeEnabled();

    fireEvent.click(enable);

    expect(screen.getByRole('button', { name: 'Save payment settings' })).toBeEnabled();
  });
});
