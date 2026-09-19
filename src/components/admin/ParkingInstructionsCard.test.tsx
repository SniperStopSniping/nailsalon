import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ParkingInstructionsCard } from './ParkingInstructionsCard';

const fetchMock = vi.fn();

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ParkingInstructionsCard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('uses the established retention settings read/write path', async () => {
    const onDirtyChange = vi.fn();
    fetchMock
      .mockResolvedValueOnce(response({ data: { settings: { parkingInstructions: 'Park behind the studio.' } } }))
      .mockResolvedValueOnce(response({ data: { settings: { parkingInstructions: 'Use the side entrance.' } } }));

    render(<ParkingInstructionsCard salonSlug="salon-a" onDirtyChange={onDirtyChange} />);

    const field = await screen.findByDisplayValue('Park behind the studio.');
    fireEvent.change(field, { target: { value: 'Use the side entrance.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save parking info' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/admin/retention/settings?salonSlug=salon-a',
      { cache: 'no-store' },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/admin/retention/settings?salonSlug=salon-a',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ parkingInstructions: 'Use the side entrance.' }),
      }),
    );
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(await screen.findByText('Parking instructions saved.')).toBeVisible();
  });

  it('does not expose an empty editor after the existing settings read fails', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { message: 'Unavailable' } }, 503));

    render(<ParkingInstructionsCard salonSlug="salon-a" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    expect(screen.queryByLabelText('Parking & entry instructions')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it('keeps the explicit edit dirty when saving fails', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ data: { settings: { parkingInstructions: 'Park behind.' } } }))
      .mockResolvedValueOnce(response({ error: { message: 'Try again' } }, 503));

    render(<ParkingInstructionsCard salonSlug="salon-a" />);

    const field = await screen.findByLabelText('Parking & entry instructions');
    fireEvent.change(field, { target: { value: 'Use the side entrance.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save parking info' }));
    await screen.findByText('Try again');

    expect(field).toHaveValue('Use the side entrance.');
    expect(screen.getByRole('button', { name: 'Save parking info' })).toBeEnabled();
    expect(screen.getByText('Try again')).toBeVisible();
  });
});
