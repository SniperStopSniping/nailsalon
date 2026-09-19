import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APPOINTMENT_DATA_CHANGED_EVENT } from '@/libs/dashboardEvents';

import { CalendarBlockTime } from './CalendarBlockTime';

const fetchMock = vi.fn();
const onClose = vi.fn();
const block = {
  id: 'block_1',
  technicianId: 'tech_1',
  startsAt: '2026-09-20T18:00:00.000Z',
  endsAt: '2026-09-20T20:00:00.000Z',
  label: 'Lunch',
  updatedAt: '2026-09-19T12:00:00.000Z',
};

function health(blocks = [block], timeZone = 'America/Toronto') {
  return new Response(JSON.stringify({ data: { blocks, timeZone } }), { status: 200 });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(() => Promise.resolve(health()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderEditor(props: Partial<React.ComponentProps<typeof CalendarBlockTime>> = {}) {
  return render(
    <CalendarBlockTime
      salonSlug="studio"
      date="2026-09-20"
      technicians={[{ id: 'tech_1', name: 'Isla' }]}
      onClose={onClose}
      {...props}
    />,
  );
}

describe('CalendarBlockTime', () => {
  it('does not mutate availability until the owner submits a valid block', async () => {
    renderEditor();
    await screen.findByText('Lunch');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '15:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '16:00' } });
    fireEvent.change(screen.getByLabelText('Label (optional)'), { target: { value: 'Break' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Block time' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/admin/calendar-blocks?salonSlug=studio');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ technicianId: 'tech_1', date: '2026-09-20', startTime: '15:00', endTime: '16:00', label: 'Break' });
  });

  it('uses the returned salon timezone and confirms before deletion', async () => {
    renderEditor();

    expect(await screen.findByText(/Times in/)).toHaveTextContent('America/Toronto');
    expect(screen.getByText('14:00–16:00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove block' }));

    expect(screen.getByText(/Remove this block/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Keep block' }));

    expect(screen.queryByText(/Remove this block/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retains entered values after a conflict and publishes one refresh event only after success', async () => {
    fetchMock
      .mockResolvedValueOnce(health([]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'That time overlaps an appointment.' } }), { status: 409 }));
    const changed = vi.fn();
    window.addEventListener(APPOINTMENT_DATA_CHANGED_EVENT, changed);
    renderEditor();
    await screen.findByText(/No saved intraday blocks/);

    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '15:00' } });
    fireEvent.change(screen.getByLabelText('Label (optional)'), { target: { value: 'Break' } });
    fireEvent.click(screen.getByRole('button', { name: 'Block time' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That time overlaps an appointment.');
    expect(screen.getByLabelText('Start time')).toHaveValue('15:00');
    expect(screen.getByLabelText('Label (optional)')).toHaveValue('Break');
    expect(changed).not.toHaveBeenCalled();

    window.removeEventListener(APPOINTMENT_DATA_CHANGED_EVENT, changed);
  });

  it('ignores a stale load response when the selected salon changes', async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes('salonSlug=first')) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(health([{ ...block, label: 'Second salon' }]));
    });
    const { rerender } = renderEditor({ salonSlug: 'first' });
    rerender(<CalendarBlockTime salonSlug="second" date="2026-09-20" technicians={[{ id: 'tech_1', name: 'Isla' }]} onClose={onClose} />);

    expect(await screen.findByText('Second salon')).toBeInTheDocument();

    resolveFirst?.(health([{ ...block, label: 'First salon' }]));
    await waitFor(() => expect(screen.queryByText('First salon')).not.toBeInTheDocument());
  });

  it('shows technician choice only for a team and focuses its named editor', async () => {
    const { rerender } = renderEditor({ technicians: [{ id: 'tech_1', name: 'Isla' }, { id: 'tech_2', name: 'Maya' }] });
    await screen.findByText('Lunch');

    expect(screen.getByLabelText('Technician')).toHaveValue('tech_1');
    expect(screen.getByRole('heading', { name: 'Block Time' })).toHaveFocus();

    rerender(<CalendarBlockTime salonSlug="studio" date="2026-09-20" technicians={[{ id: 'tech_1', name: 'Isla' }]} onClose={onClose} />);

    expect(screen.queryByLabelText('Technician')).not.toBeInTheDocument();
  });
});
