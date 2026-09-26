import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoShowRecords } from './NoShowRecords';

type FetchResult = { ok: boolean; json: () => Promise<unknown> };

function response(items: unknown[], total: number): FetchResult {
  return { ok: true, json: async () => ({ page: 1, pageSize: 25, platformActive: true, items, total }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('super-admin no-show records', () => {
  it('ignores an older response after a salon filter changes', async () => {
    let resolveOld!: (value: FetchResult) => void;
    let resolveNew!: (value: FetchResult) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<FetchResult>((resolve) => {
        resolveOld = resolve;
      }))
      .mockImplementationOnce(() => new Promise<FetchResult>((resolve) => {
        resolveNew = resolve;
      }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NoShowRecords />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Salon'), { target: { value: 'Salon B' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[1]?.[0]).toContain('salon=Salon+B');

    await act(async () => resolveNew(response([], 0)));

    expect(screen.getByText('No records match these filters.')).toBeInTheDocument();

    await act(async () => resolveOld(response([{
      appointmentId: 'stale-appointment',
      salonId: 'salon-a',
      salonName: 'Salon A',
      salonSlug: 'salon-a',
      clientName: 'Stale Client',
      clientPhone: '••• 1234',
      clientEmail: null,
      appointmentStatus: 'no_show',
      cancelReason: 'no_show',
      updatedAt: new Date().toISOString(),
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      eventId: null,
      eventState: null,
      eventEligible: false,
      markedAt: null,
      expiresAt: null,
      countsForNetwork: false,
    }], 1)));

    expect(screen.queryByText('Stale Client')).not.toBeInTheDocument();
    expect(screen.getByText('No records match these filters.')).toBeInTheDocument();
  });
});
