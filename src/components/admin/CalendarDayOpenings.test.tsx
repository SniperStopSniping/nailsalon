import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalendarOpening } from '@/libs/calendarOpenings';

import { CalendarDayOpenings } from './CalendarDayOpenings';

const openings: CalendarOpening[] = Array.from({ length: 4 }, (_, index) => ({
  technicianId: `tech_${index}`,
  technicianName: `Technician ${index + 1}`,
  date: '2026-01-31',
  time: `${10 + index}:00`,
  startTime: `2026-01-31T${10 + index}:00:00Z`,
  endTime: `2026-01-31T${11 + index}:00:00Z`,
}));
const props = { salonSlug: 'test-salon', date: '2026-01-31', technicianId: null, refreshKey: 0, onSelect: vi.fn() };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { openings, timeZone: 'UTC' } }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('CalendarDayOpenings disclosure', () => {
  it('starts collapsed for a booked day while preserving full gap selection', async () => {
    render(<CalendarDayOpenings {...props} defaultExpanded={false} />);
    const disclosure = screen.getByTestId('calendar-openings-disclosure');

    expect(disclosure.tagName).toBe('DETAILS');
    expect(disclosure).not.toHaveAttribute('open');
    expect(disclosure.querySelector('summary')).toHaveTextContent('Available gaps');

    await screen.findByText('Technician 1');
    fireEvent.click(disclosure.querySelector('summary')!);

    expect(disclosure).toHaveAttribute('open');
    expect(screen.queryByText('Technician 4')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show all gaps' }));

    expect(screen.getByText('Technician 4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Technician 4/ }));

    expect(props.onSelect).toHaveBeenCalledWith(openings[3]);

    fireEvent.click(screen.getByRole('button', { name: 'Show fewer gaps' }));

    expect(screen.queryByText('Technician 4')).not.toBeInTheDocument();
  });

  it('starts expanded for an empty day and includes a full range and duration', async () => {
    render(<CalendarDayOpenings {...props} defaultExpanded />);

    expect(screen.getByTestId('calendar-openings-disclosure')).toHaveAttribute('open');

    const gap = await screen.findByRole('button', { name: /Technician 1/ });

    expect(gap).toHaveTextContent(/10:00\s*AM\s*–\s*11:00\s*AM/i);
    expect(gap).toHaveTextContent(/1h/);
  });

  it('offers service-aware recovery when the day has no gaps', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { openings: [], timeZone: 'UTC' } }) });
    const onFindOpening = vi.fn();
    render(<CalendarDayOpenings {...props} onFindOpening={onFindOpening} />);
    await screen.findByText('No openings for this day.');
    fireEvent.click(screen.getByRole('button', { name: 'Find next opening' }));

    expect(onFindOpening).toHaveBeenCalledOnce();
  });

  it('keeps retry available after a failed request', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    render(<CalendarDayOpenings {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: /Technician 1/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
