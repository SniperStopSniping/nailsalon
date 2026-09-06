import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CalendarSchedule } from '@/libs/calendarSchedule';

import { AppointmentsDayView } from './AppointmentsDayView';

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<object>('@dnd-kit/core');
  return {
    ...actual,
    useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      isDragging: false,
    }),
  };
});

const ALL_DAY = { start: '09:00', end: '21:00' };

/** Salon B: closed Sunday, Daniela 09:00–21:00 with a Wednesday 13–14 block. */
const SCHEDULE: CalendarSchedule = {
  businessHours: {
    sunday: null,
    monday: { open: '09:00', close: '21:00' },
    tuesday: { open: '09:00', close: '21:00' },
    wednesday: { open: '09:00', close: '21:00' },
    thursday: { open: '09:00', close: '21:00' },
    friday: { open: '09:00', close: '21:00' },
    saturday: { open: '10:00', close: '17:00' },
  },
  businessHoursSource: 'salon',
  technicians: [{
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
  }],
  timeOff: [],
  blockedSlots: [{
    id: 'blk_audit_1',
    technicianId: 'tech_daniela',
    dayOfWeek: 3,
    startTime: '13:00',
    endTime: '14:00',
    specificDate: null,
    label: 'Blocked',
    isRecurring: true,
  }],
};

function localIso(year: number, monthIndex: number, day: number, hour: number, minute = 0) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).toISOString();
}

function renderDayView(overrides: Partial<React.ComponentProps<typeof AppointmentsDayView>> = {}) {
  return render(
    <AppointmentsDayView
      selectedDate={new Date(2026, 8, 16, 12, 0, 0)}
      onSelectedDateChange={vi.fn()}
      appointments={[]}
      resources={[{ id: 'tech_daniela', label: 'Daniela' }]}
      slotIntervalMinutes={30}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      onAppointmentSelect={vi.fn()}
      onMoveAppointment={vi.fn()}
      emptyTitle="No appointments"
      emptyDescription="No appointments for the day."
      includeUnassignedResource={false}
      {...overrides}
    />,
  );
}

describe('AppointmentsDayView', () => {
  it('renders resource columns and opens appointments on click', () => {
    const onAppointmentSelect = vi.fn();

    render(
      <AppointmentsDayView
        selectedDate={new Date('2026-03-29T12:00:00.000Z')}
        onSelectedDateChange={vi.fn()}
        appointments={[{
          id: 'appt_1',
          clientName: 'Avery',
          startTime: '2026-03-29T14:00:00.000Z',
          endTime: '2026-03-29T15:00:00.000Z',
          status: 'confirmed',
          technicianId: 'tech_1',
          technicianName: 'Taylor',
          serviceLabel: 'Gel Manicure',
          totalPrice: 4500,
          totalDurationMinutes: 60,
          locationName: 'Front St',
          isLocked: false,
        }]}
        resources={[{ id: 'tech_1', label: 'Taylor' }]}
        slotIntervalMinutes={15}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onAppointmentSelect={onAppointmentSelect}
        onMoveAppointment={vi.fn()}
        emptyTitle="No appointments"
        emptyDescription="No appointments for the day."
        includeUnassignedResource={false}
      />,
    );

    expect(screen.getByText('Taylor')).toBeInTheDocument();
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /gel manicure/i }));

    expect(onAppointmentSelect).toHaveBeenCalledWith('appt_1');
  });

  // AG-today-calendar-04 / source-map I-019: the grid was a fixed 08:00–20:00.
  it('spans the technician schedule instead of a fixed 08:00-20:00 grid', () => {
    renderDayView({ schedule: SCHEDULE });

    expect(screen.getByText('9 AM')).toBeInTheDocument();
    expect(screen.getByText('9 PM')).toBeInTheDocument();
    expect(screen.queryByText('8 AM')).not.toBeInTheDocument();
  });

  it('keeps the previous bounds when no schedule is supplied', () => {
    renderDayView();

    expect(screen.getByText('8 AM')).toBeInTheDocument();
    expect(screen.getByText('8 PM')).toBeInTheDocument();
    expect(screen.queryByText('9 PM')).not.toBeInTheDocument();
  });

  it('widens the grid so an early appointment is never clipped above it', () => {
    renderDayView({
      schedule: SCHEDULE,
      appointments: [{
        id: 'appt_early',
        clientName: 'Avery',
        startTime: localIso(2026, 8, 16, 7, 0),
        endTime: localIso(2026, 8, 16, 8, 0),
        status: 'confirmed',
        technicianId: 'tech_daniela',
        technicianName: 'Daniela',
        serviceLabel: 'Gel Manicure',
        totalPrice: 4500,
        totalDurationMinutes: 60,
        locationName: null,
        isLocked: false,
      }],
    });

    expect(screen.getByText('7 AM')).toBeInTheDocument();
    // Top 0 = the first rendered hour: the block sits inside the grid.
    expect(screen.getByTestId('appointment-block-appt_early')).toHaveStyle({ top: '0px' });
  });

  it('draws the recurring blocked window as a non-bookable band', () => {
    renderDayView({ schedule: SCHEDULE });

    expect(screen.getByTestId('calendar-blocked-band-blk_audit_1')).toHaveTextContent(
      'Blocked · 1:00 PM – 2:00 PM',
    );
  });

  it('marks a closed day for the whole column', () => {
    // 2026-09-13 is a Sunday, and Salon B publishes no Sunday hours.
    renderDayView({ selectedDate: new Date(2026, 8, 13, 12, 0, 0), schedule: SCHEDULE });

    expect(screen.getByTestId('calendar-day-closed-banner')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-column-unavailable-tech_daniela')).toHaveTextContent('Closed');
  });
});
