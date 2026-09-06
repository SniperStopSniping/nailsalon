import { describe, expect, it } from 'vitest';

import {
  buildTimePickerSlots,
  type CalendarSchedule,
  EMPTY_CALENDAR_SCHEDULE,
  formatMinutesLabel,
  getDayAvailability,
  isSalonClosedOnDate,
  parseTimeToMinutes,
  resolveDayGridBounds,
} from './calendarSchedule';

const ALL_DAY = { start: '09:00', end: '21:00' };

const SALON_B: CalendarSchedule = {
  // Salon B: closed Sunday, open every other day.
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
      id: 'tech_jenny',
      name: 'Jenny',
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
  ],
  timeOff: [
    { id: 'toff_1', technicianId: 'tech_jenny', startDate: '2026-09-09', endDate: '2026-09-10', reason: 'vacation' },
  ],
  blockedSlots: [
    {
      id: 'blk_1',
      technicianId: 'tech_daniela',
      dayOfWeek: 3,
      startTime: '13:00',
      endTime: '14:00',
      specificDate: null,
      label: 'Lunch',
      isRecurring: true,
    },
    {
      id: 'blk_2',
      technicianId: 'tech_jenny',
      dayOfWeek: null,
      startTime: '15:00',
      endTime: '16:00',
      specificDate: '2026-09-15',
      label: 'Training',
      isRecurring: false,
    },
  ],
};

describe('parseTimeToMinutes', () => {
  it('reads H:MM and HH:MM, and rejects everything else', () => {
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('9:05')).toBe(545);
    expect(parseTimeToMinutes('21:00')).toBe(1260);
    expect(parseTimeToMinutes('nope')).toBeNull();
    expect(parseTimeToMinutes(null)).toBeNull();
    expect(parseTimeToMinutes('09:75')).toBeNull();
  });
});

describe('formatMinutesLabel', () => {
  it('renders a 12-hour label', () => {
    expect(formatMinutesLabel(0)).toBe('12:00 AM');
    expect(formatMinutesLabel(780)).toBe('1:00 PM');
    expect(formatMinutesLabel(1260)).toBe('9:00 PM');
  });
});

describe('isSalonClosedOnDate', () => {
  it('marks the weekday the salon publishes no hours for', () => {
    // 2026-09-06 is a Sunday.
    expect(isSalonClosedOnDate(SALON_B, '2026-09-06')).toBe(true);
    expect(isSalonClosedOnDate(SALON_B, '2026-09-07')).toBe(false);
  });

  it('never claims "closed" for a salon that publishes no hours at all', () => {
    expect(isSalonClosedOnDate(EMPTY_CALENDAR_SCHEDULE, '2026-09-06')).toBe(false);
  });
});

describe('getDayAvailability', () => {
  it('reports the salon closure, who is off and who is working', () => {
    // 2026-09-09 is a Wednesday inside Jenny's approved time off.
    const availability = getDayAvailability(SALON_B, '2026-09-09');

    expect(availability.closed).toBe(false);
    expect(availability.techniciansOff).toEqual([
      { id: 'tech_jenny', name: 'Jenny', reason: 'vacation' },
    ]);
    expect(availability.working.map(entry => entry.id)).toEqual(['tech_daniela']);
    expect(availability.openMinutes).toBe(9 * 60);
    expect(availability.closeMinutes).toBe(19 * 60);
  });

  it('surfaces the recurring Wednesday block with its window and owner', () => {
    const availability = getDayAvailability(SALON_B, '2026-09-16');

    expect(availability.blockedWindows).toEqual([
      expect.objectContaining({
        id: 'blk_1',
        technicianId: 'tech_daniela',
        technicianName: 'Daniela',
        startMinutes: 13 * 60,
        endMinutes: 14 * 60,
        label: 'Lunch',
      }),
    ]);
  });

  it('applies a one-off block only on its own date', () => {
    expect(getDayAvailability(SALON_B, '2026-09-15').blockedWindows.map(w => w.id)).toEqual(['blk_2']);
    expect(getDayAvailability(SALON_B, '2026-09-22').blockedWindows.map(w => w.id)).toEqual([]);
  });

  it('lists a technician who simply does not work the weekday', () => {
    // Saturday: Jenny has no shift, Daniela does.
    const availability = getDayAvailability(SALON_B, '2026-09-12');

    expect(availability.technicianIdsNotWorking).toEqual(['tech_jenny']);
    expect(availability.working.map(entry => entry.id)).toEqual(['tech_daniela']);
  });

  it('narrows to one technician when asked', () => {
    const availability = getDayAvailability(SALON_B, '2026-09-16', { technicianId: 'tech_jenny' });

    expect(availability.working.map(entry => entry.id)).toEqual(['tech_jenny']);
    expect(availability.blockedWindows).toEqual([]);
  });
});

describe('resolveDayGridBounds', () => {
  it('spans the earliest technician start to the latest end, not a fixed 08–20', () => {
    expect(resolveDayGridBounds({ schedule: SALON_B, dateKey: '2026-09-16' }))
      .toEqual({ startHour: 9, endHour: 21 });
  });

  it('falls back when no schedule is known', () => {
    expect(resolveDayGridBounds({})).toEqual({ startHour: 8, endHour: 20 });
  });

  it('always widens to cover an appointment outside the schedule', () => {
    expect(resolveDayGridBounds({
      schedule: SALON_B,
      dateKey: '2026-09-16',
      appointmentWindows: [{ startMinutes: 7 * 60 + 30, endMinutes: 22 * 60 + 15 }],
    })).toEqual({ startHour: 7, endHour: 23 });
  });

  it('keeps at least one hour of grid', () => {
    const bounds = resolveDayGridBounds({ fallback: { startHour: 10, endHour: 10 } });

    expect(bounds.endHour).toBeGreaterThan(bounds.startHour);
  });
});

describe('buildTimePickerSlots', () => {
  it('spans the selected technician\'s schedule, including the last hour', () => {
    const slots = buildTimePickerSlots({
      schedule: SALON_B,
      dateKey: '2026-09-16',
      technicianId: 'tech_daniela',
    });

    // Salon closes at 19:00 on a Wednesday, so that is the ceiling.
    expect(slots[0]).toBe('09:00');
    expect(slots).not.toContain('08:00');
    expect(slots).not.toContain('08:30');
    expect(slots).toContain('18:30');
    expect(slots.at(-1)).toBe('19:00');
  });

  it('reaches 21:00 when the salon publishes no closing hour', () => {
    const slots = buildTimePickerSlots({
      schedule: { ...SALON_B, businessHours: null, businessHoursSource: 'none' },
      dateKey: '2026-09-16',
      technicianId: 'tech_daniela',
    });

    expect(slots[0]).toBe('09:00');
    expect(slots.at(-1)).toBe('21:00');
  });

  it('unions the team when no technician is selected', () => {
    const slots = buildTimePickerSlots({
      schedule: { ...SALON_B, businessHours: null, businessHoursSource: 'none' },
      dateKey: '2026-09-16',
      technicianId: null,
    });

    expect(slots).toContain('09:00');
    expect(slots).toContain('21:00');
  });

  it('keeps a prefilled time selectable even outside the schedule', () => {
    const slots = buildTimePickerSlots({
      schedule: SALON_B,
      dateKey: '2026-09-16',
      technicianId: 'tech_daniela',
      alwaysInclude: '07:15',
    });

    expect(slots[0]).toBe('07:15');
  });

  it('falls back to the fixed range with no schedule at all', () => {
    const slots = buildTimePickerSlots({ schedule: null, dateKey: '2026-09-16' });

    expect(slots[0]).toBe('08:00');
    expect(slots.at(-1)).toBe('20:00');
  });
});
