import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduleCalendarModal } from './ScheduleCalendarModal';

vi.mock('@/providers/SalonProvider', () => ({ useSalon: () => ({ salonSlug: 'test-salon' }) }));
vi.mock('./NewAppointmentModal', () => ({
  NewAppointmentModal: ({ isOpen, findOpeningFrom, openingTechnicianId }: { isOpen: boolean; findOpeningFrom: string | null; openingTechnicianId: string | null }) => isOpen ? <div data-testid="new-appointment-prefill">{JSON.stringify({ findOpeningFrom, openingTechnicianId })}</div> : null,
}));

const VIEW_KEY = 'luster:owner-calendar-view:v1';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 0, 31, 12));
  vi.stubGlobal('fetch', vi.fn(async (input: string) => ({
    ok: true,
    json: async () => input.startsWith('/api/admin/today')
      ? { data: { integrationHealth: { google: { status: 'disconnected', readiness: 'not_connected' } } } }
      : { data: { appointments: [], events: [], blocks: [], openings: [], schedule: { timeZone: 'UTC', technicians: [{ id: 'tech_1', name: 'Taylor', weeklySchedule: null }, { id: 'tech_2', name: 'Avery', weeklySchedule: null }], timeOff: [], blockedSlots: [] } }, meta: { timeZone: 'UTC' } },
  })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

async function openCalendar() {
  render(<ScheduleCalendarModal onClose={vi.fn()} />);
  await screen.findByRole('group', { name: 'Calendar view' });
  await waitFor(() => expect(screen.queryByText('Loading appointments…')).not.toBeInTheDocument());
}

describe('calendar navigation and accessible view preference', () => {
  it.each([
    { month: 0, direction: 'Next month' },
    { month: 2, direction: 'Previous month' },
  ])('navigates from month-end into February ($direction)', async ({ month, direction }) => {
    vi.setSystemTime(new Date(2026, month, 31, 12));
    await openCalendar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Monthly', exact: true }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: direction }));
    });

    expect(screen.getByText('February 2026', { exact: true })).toBeInTheDocument();
  });

  it('announces the selected view and persists only an explicit selection', async () => {
    await openCalendar();
    const group = screen.getByRole('group', { name: 'Calendar view' });

    expect(localStorage.getItem(VIEW_KEY)).toBeNull();

    await act(async () => {
      fireEvent.click(within(group).getByRole('button', { name: 'Weekly', exact: true }));
    });

    expect(within(group).getByRole('button', { name: 'Weekly', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Monthly', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(VIEW_KEY)).toBe('weekly');
  });

  it('restores a valid saved preference and marks today', async () => {
    localStorage.setItem(VIEW_KEY, 'weekly');
    await openCalendar();

    expect(screen.getByRole('button', { name: 'Weekly', exact: true })).toHaveAttribute('aria-pressed', 'true');

    const today = document.querySelector('[aria-current="date"]');

    expect(today).toBeInTheDocument();
    expect(today).toHaveAccessibleName(/January 31/);
  });

  it.each([
    { day: 'January 30', expected: '2026-01-31' },
    { day: 'February 1', expected: '2026-02-01' },
  ])('starts recovery from $expected and retains the technician', async ({ day, expected }) => {
    await openCalendar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Monthly', exact: true }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole('group', { name: 'Filter calendar by technician' })).getByRole('button', { name: 'Taylor', exact: true }));
    });
    if (day.startsWith('February')) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
      });
    }
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`${day},`) }));
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Find next opening' }));

    expect(await screen.findByTestId('new-appointment-prefill')).toHaveTextContent(JSON.stringify({ findOpeningFrom: expected, openingTechnicianId: 'tech_1' }));
  });

  it('ignores invalid saved preferences', async () => {
    localStorage.setItem(VIEW_KEY, 'invalid');
    await openCalendar();
    const buttons = within(screen.getByRole('group', { name: 'Calendar view' })).getAllByRole('button');

    expect(buttons.filter(button => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('still switches view when storage reads and writes throw', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    await openCalendar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Weekly', exact: true }));
    });

    expect(screen.getByRole('button', { name: 'Weekly', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Monthly', exact: true }));
    });

    expect(screen.getByRole('button', { name: 'Monthly', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});
