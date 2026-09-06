import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APPOINTMENT_DATA_CHANGED_EVENT } from '@/libs/dashboardEvents';

import { ScheduleCalendarModal } from './ScheduleCalendarModal';

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'nail-salon-no5' }),
}));

vi.mock('./NewAppointmentModal', () => ({
  NewAppointmentModal: ({ isOpen }: { isOpen: boolean }) => (
    isOpen ? <div data-testid="new-appointment-modal" /> : null
  ),
}));

const ALL_DAY = { start: '09:00', end: '21:00' };

const SCHEDULE = {
  businessHours: {
    sunday: null,
    monday: { open: '09:00', close: '19:00' },
    tuesday: { open: '09:00', close: '19:00' },
    wednesday: { open: '09:00', close: '19:00' },
    thursday: { open: '09:00', close: '19:00' },
    friday: { open: '09:00', close: '19:00' },
    saturday: { open: '10:00', close: '17:00' },
  },
  businessHoursSource: 'salon',
  technicians: [
    {
      id: 'tech_daniela',
      name: 'Daniela',
      weeklySchedule: {
        sunday: ALL_DAY,
        monday: ALL_DAY,
        tuesday: ALL_DAY,
        wednesday: ALL_DAY,
        thursday: ALL_DAY,
        friday: ALL_DAY,
        saturday: ALL_DAY,
      },
    },
    {
      id: 'tech_tiffany',
      name: 'Tiffany',
      weeklySchedule: {
        sunday: null,
        monday: { start: '10:00', end: '18:00' },
        tuesday: { start: '10:00', end: '18:00' },
        wednesday: { start: '10:00', end: '18:00' },
        thursday: { start: '10:00', end: '18:00' },
        friday: { start: '10:00', end: '18:00' },
        saturday: null,
      },
    },
    { id: 'tech_jenny', name: 'Jenny', weeklySchedule: null },
  ],
  timeOff: [
    { id: 'toff_audit_1', technicianId: 'tech_jenny', startDate: '2026-09-09', endDate: '2026-09-10', reason: null },
  ],
  blockedSlots: [
    {
      id: 'blk_audit_1',
      technicianId: 'tech_daniela',
      dayOfWeek: 3,
      startTime: '13:00',
      endTime: '14:00',
      specificDate: null,
      label: 'Blocked',
      isRecurring: true,
    },
  ],
};

const fetchMock = vi.fn();
let appointmentsCallCount = 0;

function appointmentsPayload() {
  appointmentsCallCount += 1;
  return {
    data: {
      appointments: [
        {
          id: 'appt_daniela',
          clientName: 'Avery Client',
          startTime: '2026-09-16T17:00:00.000Z',
          endTime: '2026-09-16T18:00:00.000Z',
          status: 'confirmed',
          services: [{ name: 'Gel Manicure' }],
          technician: { id: 'tech_daniela', name: 'Daniela' },
        },
        {
          id: 'appt_tiffany',
          clientName: 'Robin Guest',
          startTime: '2026-09-16T19:00:00.000Z',
          endTime: '2026-09-16T20:00:00.000Z',
          status: 'confirmed',
          services: [{ name: 'Pedicure' }],
          technician: { id: 'tech_tiffany', name: 'Tiffany' },
        },
      ],
      technicians: SCHEDULE.technicians,
      schedule: SCHEDULE,
    },
    meta: { slotIntervalMinutes: 15, timeZone: 'America/Toronto' },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-16T15:00:00.000Z'));
  appointmentsCallCount = 0;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/admin/appointments')) {
      return { ok: true, status: 200, json: async () => appointmentsPayload() };
    }
    if (url.startsWith('/api/integrations/google/events')) {
      return { ok: true, status: 200, json: async () => ({ data: { events: [] } }) };
    }
    throw new Error(`Unrouted fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderCalendar() {
  render(<ScheduleCalendarModal onClose={vi.fn()} salonSlug="nail-salon-no5" />);
  await screen.findByTestId('calendar-technician-filter');
}

describe('ScheduleCalendarModal availability overlay', () => {
  it('marks a closed Sunday and leaves open days unmarked', async () => {
    await renderCalendar();

    // 2026-09-06 is a Sunday; the salon publishes no Sunday hours.
    const sunday = screen.getByTestId('calendar-day-2026-09-06');
    const monday = screen.getByTestId('calendar-day-2026-09-07');

    expect(sunday).toHaveAttribute('data-closed', 'true');
    expect(within(sunday).getByText('Closed')).toBeInTheDocument();
    expect(sunday).toHaveAttribute('aria-label', expect.stringContaining('Salon closed'));

    expect(monday).toHaveAttribute('data-closed', 'false');
    expect(monday).not.toHaveAttribute('aria-label', expect.stringContaining('Salon closed'));
  });

  it('marks the days a technician is on approved time off', async () => {
    await renderCalendar();

    const off = screen.getByTestId('calendar-day-2026-09-09');

    expect(off).toHaveAttribute('data-off-count', '1');
    expect(off).toHaveAttribute('aria-label', expect.stringContaining('Jenny off'));
    expect(screen.getByTestId('calendar-day-off-2026-09-09')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-day-2026-09-11')).toHaveAttribute('data-off-count', '0');
  });

  it('shows the recurring blocked window in the day detail', async () => {
    await renderCalendar();

    fireEvent.click(screen.getByTestId('calendar-day-2026-09-16'));
    await screen.findByLabelText('Close day details');

    expect(screen.getByTestId('calendar-day-availability-blocked-blk_audit_1'))
      .toHaveTextContent('Daniela · 1:00 PM – 2:00 PM · Blocked');
  });

  it('filters the day counts and the day detail to one technician', async () => {
    await renderCalendar();

    const dayCell = screen.getByTestId('calendar-day-2026-09-16');

    expect(dayCell).toHaveTextContent('2 appts');

    fireEvent.click(screen.getByTestId('calendar-technician-chip-tech_tiffany'));

    expect(screen.getByTestId('calendar-day-2026-09-16')).toHaveTextContent('1 appt');

    fireEvent.click(screen.getByTestId('calendar-day-2026-09-16'));
    await screen.findByLabelText('Close day details');

    expect(screen.getByTestId('day-detail-appointment-appt_tiffany')).toBeInTheDocument();
    expect(screen.queryByTestId('day-detail-appointment-appt_daniela')).not.toBeInTheDocument();
  });

  it('lists the week\'s appointments in the weekly view instead of an empty strip', async () => {
    await renderCalendar();

    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));

    const agenda = await screen.findByTestId('calendar-week-agenda');

    expect(within(agenda).getByTestId('calendar-week-entry-appt_daniela')).toHaveTextContent('Avery Client');
    expect(within(agenda).getByTestId('calendar-week-entry-appt_tiffany')).toHaveTextContent('Robin Guest');
    // Every day of the week is present, closed ones included.
    expect(within(agenda).getByTestId('calendar-week-agenda-2026-09-13')).toHaveTextContent('Closed — salon hours');
  });

  it('refetches when an appointment changes anywhere in the workspace', async () => {
    await renderCalendar();

    const before = appointmentsCallCount;

    window.dispatchEvent(new Event(APPOINTMENT_DATA_CHANGED_EVENT));

    await waitFor(() => {
      expect(appointmentsCallCount).toBeGreaterThan(before);
    });
  });
});
