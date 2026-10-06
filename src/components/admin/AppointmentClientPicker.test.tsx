import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppointmentClientPicker } from './AppointmentClientPicker';

const client = { id: 'client_1', fullName: 'Alex Example', phone: '+14165550101', email: 'alex@example.test' };
const response = (clients: unknown[]) => new Response(JSON.stringify({ data: { clients } }), { status: 200 });

describe('AppointmentClientPicker', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('searches the salon directory and normalizes an optional +1 without writing client data', async () => {
    fetchMock.mockResolvedValue(response([client]));
    const onSelect = vi.fn();
    render(<AppointmentClientPicker salonSlug="isla-fixture" onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText('Find an existing client'), { target: { value: 'Alex' } });
    fireEvent.click(await screen.findByRole('button', { name: /Alex Example/ }));

    expect(onSelect).toHaveBeenCalledWith({ ...client, phone: '4165550101' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [path, options] = fetchMock.mock.calls[0]!;
    const query = new URL(path, 'http://localhost').searchParams;

    expect(query.get('salonSlug')).toBe('isla-fixture');
    expect(query.get('search')).toBe('Alex');
    expect(options.cache).toBe('no-store');
    expect(options.method).toBeUndefined();
  });

  it('does not turn an international phone number into a different ten-digit client identity', async () => {
    fetchMock.mockResolvedValue(response([{ ...client, phone: '+442079460958' }]));
    const onSelect = vi.fn();
    render(<AppointmentClientPicker salonSlug="fixture" onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText('Find an existing client'), { target: { value: 'Alex' } });
    const result = await screen.findByRole('button', { name: /Alex Example/ });

    expect(result).toBeDisabled();
    expect(result).toHaveTextContent('442079460958');

    fireEvent.click(result);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores an older response after the query changes', async () => {
    let resolveOld!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveOld = resolve;
    }));
    fetchMock.mockResolvedValue(response([]));
    render(<AppointmentClientPicker salonSlug="fixture" onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Find an existing client'), { target: { value: 'Alex' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Find an existing client'), { target: { value: 'Nobody' } });
    await screen.findByText(/No matching clients/);
    resolveOld(response([client]));

    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);

    await waitFor(() => expect(screen.queryByRole('button', { name: /Alex Example/ })).not.toBeInTheDocument());
  });

  it('offers retry after a search failure while leaving manual entry possible', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValue(response([client]));
    render(<AppointmentClientPicker salonSlug="fixture" onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Find an existing client'), { target: { value: 'Alex' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry search' }));

    expect(await screen.findByRole('button', { name: /Alex Example/ })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
