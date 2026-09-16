import { describe, expect, it, vi } from 'vitest';

import type { LoadedBookingPolicy } from '@/libs/bookingPolicy';
import { zonedTimeToUtc } from '@/libs/timeZone';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import type { AvailabilityCause, ComputeDaySlotsInput } from './engine.server';
import { computeDaySlots, preflightDayAvailability } from './engine.server';
/* eslint-enable import/first */

/**
 * A1-2 Piece 1 — `computeDaySlots({ explain: true })`.
 *
 * The engine takes PRE-RESOLVED inputs, so these are pure unit tests: the
 * booking policy, the hours ceiling and the busy windows are handed in
 * directly, which lets each scenario isolate exactly one refusal reason and
 * assert its code AND its count. The same scenarios run end-to-end against
 * PGlite through the route in `route.parity.test.ts`.
 *
 * Every scenario also re-runs with `explain: false` and asserts the slot
 * output is identical — the explain path must only ADD an aggregate, never
 * change what the public route would serve.
 */

const TIME_ZONE = 'America/Toronto';
/** Thursday 2026-03-05, 12:30 EST. Two hours of notice lands the floor at 14:30 local. */
const NOW = new Date('2026-03-05T17:30:00.000Z');
const FRIDAY = '2026-03-06';
const THURSDAY = '2026-03-05';
const TECH_ID = 'tech_engine_1';

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

function emptyPolicy(): LoadedBookingPolicy {
  return {
    appointmentsByTechnician: new Map(),
    overridesByTechnician: new Map(),
    timeOffTechnicianIds: new Set(),
    blockedSlotsByTechnician: new Map(),
  };
}

/**
 * One technician working 09:00–17:00 on a 60-minute grid with no buffer, so
 * "bookable" is exactly the eight starts 9:00…16:00 and every count below is
 * checkable by hand.
 */
function baseInput(overrides: Partial<ComputeDaySlotsInput> = {}): ComputeDaySlotsInput {
  return {
    date: FRIDAY,
    technicians: [{
      id: TECH_ID,
      weeklySchedule: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
        wednesday: { start: '09:00', end: '17:00' },
        thursday: { start: '09:00', end: '17:00' },
        friday: { start: '09:00', end: '17:00' },
      },
      enabledServiceIds: [],
      serviceIds: [],
      specialties: [],
      primaryLocationId: null,
    }],
    requestedServices: [],
    capabilityMode: 'unrestricted',
    bookingPolicy: emptyPolicy(),
    googleBusyWindows: [],
    hoursCeiling: { locationId: null, businessHours: null, source: 'none' },
    effectiveLocationId: null,
    visibleDurationMinutes: 60,
    bufferMinutes: 0,
    slotIntervalMinutes: 60,
    minimumNoticeMinutes: 120,
    timeZone: TIME_ZONE,
    now: NOW,
    excludedAppointmentId: null,
    ...overrides,
  };
}

function causeFor(causes: AvailabilityCause[], code: string): AvailabilityCause | undefined {
  return causes.find(cause => cause.code === code);
}

/**
 * Runs the same input both ways and asserts the slot output is byte-identical,
 * then hands back the explanation.
 */
function explain(input: ComputeDaySlotsInput) {
  const explained = computeDaySlots(input, { explain: true });
  const plain = computeDaySlots(input);

  expect(JSON.stringify({
    visibleSlots: explained.visibleSlots,
    slots: explained.slots,
    bookedSlots: explained.bookedSlots,
  })).toBe(JSON.stringify(plain));

  return explained;
}

describe('preflightDayAvailability', () => {
  it('refuses an empty roster without consulting compatibility', () => {
    const compatibility = vi.fn(() => true);

    const result = preflightDayAvailability({ technicians: [], compatibility });

    expect(result).toEqual({ ok: false, code: 'no_technicians' });
    expect(compatibility).not.toHaveBeenCalled();
  });

  it('refuses a roster where nobody is compatible', () => {
    const result = preflightDayAvailability({
      technicians: [{ id: 'a' }, { id: 'b' }],
      compatibility: () => false,
    });

    expect(result).toEqual({ ok: false, code: 'no_compatible_technicians' });
  });

  it('narrows to the compatible technicians, in input order', () => {
    const result = preflightDayAvailability({
      technicians: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      compatibility: technician => technician.id !== 'b',
    });

    expect(result).toEqual({ ok: true, technicians: [{ id: 'a' }, { id: 'c' }] });
  });
});

describe('computeDaySlots — explain aggregate', () => {
  it('reports a fully open day with no refusals inside the working window', () => {
    const { explanation, visibleSlots } = explain(baseInput());

    expect(visibleSlots).toEqual(['9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
    expect(explanation.bookableSlotCount).toBe(8);
    expect(explanation.firstBookable).toBe('9:00');
    expect(causeFor(explanation.causes, 'outside_schedule')).toEqual({
      code: 'outside_schedule',
      count: 16,
      technicianId: TECH_ID,
    });
  });

  it('reports technician_day_off for a weekday the technician does not work', () => {
    const input = baseInput({
      technicians: [{ ...baseInput().technicians[0]!, weeklySchedule: { monday: { start: '09:00', end: '17:00' } } }],
    });

    const { explanation } = explain(input);

    expect(explanation.bookableSlotCount).toBe(0);
    expect(explanation.firstBookable).toBeNull();
    expect(explanation.causes).toEqual([
      { code: 'technician_day_off', count: 24, technicianId: TECH_ID },
    ]);
  });

  it('reports technician_time_off ahead of the weekly schedule', () => {
    const bookingPolicy = emptyPolicy();
    bookingPolicy.timeOffTechnicianIds.add(TECH_ID);

    const { explanation } = explain(baseInput({ bookingPolicy }));

    expect(explanation.causes).toEqual([
      { code: 'technician_time_off', count: 24, technicianId: TECH_ID },
    ]);
  });

  it('reports service_unsupported when the technician cannot perform the selection', () => {
    const { explanation } = explain(baseInput({
      capabilityMode: 'service_assignments',
      requestedServices: [{ id: 'srv_engine_1', name: 'Gel Set', category: 'builder_gel' }],
    }));

    expect(explanation.bookableSlotCount).toBe(0);
    expect(explanation.causes).toEqual([
      { code: 'service_unsupported', count: 24, technicianId: TECH_ID },
    ]);
  });

  it('reports location_unavailable when the opening-hours ceiling closes the day', () => {
    const { explanation } = explain(baseInput({
      hoursCeiling: {
        locationId: 'loc_engine_1',
        businessHours: { friday: null, monday: { open: '10:00', close: '16:00' } },
        source: 'location',
      },
      effectiveLocationId: 'loc_engine_1',
    }));

    expect(explanation.bookableSlotCount).toBe(0);
    // Precedence matters and is preserved: `canTechnicianTakeAppointment`
    // checks the technician's own schedule BEFORE the opening-hours ceiling,
    // so only the eight starts the technician would otherwise work report the
    // closed location — the rest are still plain `outside_schedule`.
    expect(explanation.causes).toEqual([
      { code: 'outside_schedule', count: 16, technicianId: TECH_ID },
      { code: 'location_unavailable', count: 8, technicianId: TECH_ID },
    ]);
  });

  it('reports blocked_slot for the starts a technician break overlaps', () => {
    const bookingPolicy = emptyPolicy();
    bookingPolicy.blockedSlotsByTechnician.set(TECH_ID, [
      { startTime: '12:00', endTime: '13:00', label: 'Lunch' },
    ]);

    const { explanation } = explain(baseInput({ bookingPolicy }));

    expect(explanation.bookableSlotCount).toBe(7);
    expect(causeFor(explanation.causes, 'blocked_slot')).toEqual({
      code: 'blocked_slot',
      count: 1,
      technicianId: TECH_ID,
    });
  });

  it('reports time_conflict as a slot count only, from the decision pass', () => {
    const bookingPolicy = emptyPolicy();
    bookingPolicy.appointmentsByTechnician.set(TECH_ID, [{
      id: 'appt_engine_1',
      startTime: at(FRIDAY, '14:00'),
      endTime: at(FRIDAY, '15:00'),
      totalDurationMinutes: 60,
      bufferMinutes: 0,
      blockedDurationMinutes: 60,
      status: 'confirmed',
      salonClientId: 'sc_engine_1',
      clientPhone: '4165550123',
    }]);

    const { explanation, bookedSlots } = explain(baseInput({ bookingPolicy }));

    expect(bookedSlots).toEqual(['14:00']);
    expect(causeFor(explanation.causes, 'time_conflict')).toEqual({
      code: 'time_conflict',
      count: 1,
      technicianId: TECH_ID,
    });
    expect(explanation.bookableSlotCount).toBe(7);
  });

  it('reports google_busy as a slot count only, with no technician attribution', () => {
    const { explanation, bookedSlots } = explain(baseInput({
      googleBusyWindows: [
        { startTime: at(FRIDAY, '10:00'), endTime: at(FRIDAY, '11:00') },
        { startTime: at(FRIDAY, '15:00'), endTime: at(FRIDAY, '15:30') },
      ],
    }));

    expect(bookedSlots).toEqual(['10:00', '15:00']);
    expect(causeFor(explanation.causes, 'google_busy')).toEqual({ code: 'google_busy', count: 2 });
    expect(explanation.bookableSlotCount).toBe(6);
  });

  it('reports min_notice for the starts inside the lead window on today', () => {
    const { explanation } = explain(baseInput({ date: THURSDAY }));

    // 00:00 through 14:00 local are inside the 120-minute floor (14:30).
    expect(causeFor(explanation.causes, 'min_notice')).toEqual({ code: 'min_notice', count: 15 });
    expect(explanation.bookableSlotCount).toBe(2);
    expect(explanation.firstBookable).toBe('15:00');
  });

  it('attributes per-technician causes separately and keeps the day bookable', () => {
    const bookingPolicy = emptyPolicy();
    bookingPolicy.timeOffTechnicianIds.add('tech_engine_2');

    const { explanation } = explain(baseInput({
      bookingPolicy,
      technicians: [
        baseInput().technicians[0]!,
        { ...baseInput().technicians[0]!, id: 'tech_engine_2' },
      ],
    }));

    expect(explanation.bookableSlotCount).toBe(8);
    expect(explanation.causes).toContainEqual({
      code: 'outside_schedule',
      count: 16,
      technicianId: TECH_ID,
    });
    expect(explanation.causes).toContainEqual({
      code: 'technician_time_off',
      count: 24,
      technicianId: 'tech_engine_2',
    });
  });

  it('never leaks appointment, client or calendar-event detail into the explanation', () => {
    const bookingPolicy = emptyPolicy();
    bookingPolicy.appointmentsByTechnician.set(TECH_ID, [{
      id: 'appt_secret_1',
      startTime: at(FRIDAY, '14:00'),
      endTime: at(FRIDAY, '15:00'),
      blockedDurationMinutes: 60,
      status: 'confirmed',
      salonClientId: 'sc_secret_1',
      clientPhone: '4165550199',
    }]);
    bookingPolicy.blockedSlotsByTechnician.set(TECH_ID, [
      { startTime: '12:00', endTime: '13:00', label: 'Dentist appointment for Marie' },
    ]);

    const { explanation } = explain(baseInput({
      bookingPolicy,
      googleBusyWindows: [{ startTime: at(FRIDAY, '10:00'), endTime: at(FRIDAY, '11:00') }],
    }));

    const serialized = JSON.stringify(explanation);

    for (const secret of ['appt_secret_1', 'sc_secret_1', '4165550199', 'Marie', 'Dentist']) {
      expect(serialized).not.toContain(secret);
    }

    // Counts and the technician id are all that survive.
    for (const cause of explanation.causes) {
      expect(Object.keys(cause).sort()).toEqual(
        cause.technicianId === undefined ? ['code', 'count'] : ['code', 'count', 'technicianId'],
      );
      expect(typeof cause.count).toBe('number');
    }
  });

  it('omits the explanation entirely when explain is not requested', () => {
    const result = computeDaySlots(baseInput());

    expect(result).not.toHaveProperty('explanation');
    expect(JSON.stringify(result)).not.toContain('explanation');
  });

  it('calls no annotator and mutates no slot when none is supplied', () => {
    const { slots } = computeDaySlots(baseInput(), { explain: true });

    for (const slot of slots) {
      expect(Object.keys(slot)).toEqual(['time', 'startTime', 'availability']);
    }
  });

  it('lets an annotator add a field before the availability verdict', () => {
    const { slots } = computeDaySlots(baseInput(), {
      annotateSlot: ({ slot, technicians, isTechnicianAvailable }) => {
        slot.marker = technicians.filter(isTechnicianAvailable).length;
        return slot;
      },
    });

    expect(Object.keys(slots[0]!)).toEqual(['time', 'startTime', 'marker', 'availability']);
    expect(slots[0]!.marker).toBe(1);
  });
});
