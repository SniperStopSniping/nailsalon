import { describe, expect, it, vi } from 'vitest';

import {
  canTechnicianTakeAppointment,
  hasBufferedConflict,
  resolveBookingHoursCeiling,
  resolveTechnicianCapabilityMode,
  technicianCanPerformServices,
} from './bookingPolicy';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({
  db: {},
}));

describe('bookingPolicy', () => {
  it('treats cleanup time as a conflict in both directions', () => {
    const existingAppointments = [{
      id: 'appt_1',
      startTime: new Date('2026-03-14T10:00:00.000Z'),
      endTime: new Date('2026-03-14T11:00:00.000Z'),
    }];

    const earlierRequestConflicts = hasBufferedConflict({
      startTime: new Date('2026-03-14T09:00:00.000Z'),
      endTime: new Date('2026-03-14T10:00:00.000Z'),
      existingAppointments,
    });
    const laterRequestIsAllowed = hasBufferedConflict({
      startTime: new Date('2026-03-14T11:10:00.000Z'),
      endTime: new Date('2026-03-14T12:10:00.000Z'),
      existingAppointments,
    });

    expect(earlierRequestConflicts).toBe(true);
    expect(laterRequestIsAllowed).toBe(false);
  });

  it('blocks appointments whose full service duration exceeds the technician schedule', () => {
    const decision = canTechnicianTakeAppointment({
      startTime: new Date('2026-03-14T22:00:00.000Z'),
      endTime: new Date('2026-03-14T23:30:00.000Z'),
      weeklySchedule: {
        saturday: { start: '09:00', end: '18:00' },
      },
      existingAppointments: [],
    });

    expect(decision).toEqual({
      available: false,
      reason: 'outside_schedule',
    });
  });

  it('applies override off and time off before weekly schedule availability', () => {
    const startTime = new Date('2026-03-14T15:00:00.000Z');
    const endTime = new Date('2026-03-14T16:00:00.000Z');

    const overrideOffDecision = canTechnicianTakeAppointment({
      startTime,
      endTime,
      weeklySchedule: {
        saturday: { start: '09:00', end: '18:00' },
      },
      override: {
        technicianId: 'tech_1',
        type: 'off',
        startTime: null,
        endTime: null,
      },
      existingAppointments: [],
    });

    const timeOffDecision = canTechnicianTakeAppointment({
      startTime,
      endTime,
      weeklySchedule: {
        saturday: { start: '09:00', end: '18:00' },
      },
      isOnTimeOff: true,
      existingAppointments: [],
    });

    expect(overrideOffDecision).toEqual({
      available: false,
      reason: 'day_off',
    });
    expect(timeOffDecision).toEqual({
      available: false,
      reason: 'time_off',
    });
  });

  it('blocks appointments that overlap technician blocked slots such as lunch breaks', () => {
    const decision = canTechnicianTakeAppointment({
      startTime: new Date('2026-03-16T16:30:00.000Z'),
      endTime: new Date('2026-03-16T17:30:00.000Z'),
      weeklySchedule: {
        monday: { start: '09:00', end: '18:00' },
      },
      blockedSlots: [{
        startTime: '12:00',
        endTime: '13:00',
        label: 'Lunch',
      }],
      existingAppointments: [],
    });

    expect(decision).toEqual({
      available: false,
      reason: 'blocked_slot',
    });
  });

  it('enforces technician service capability when structured service assignments exist', () => {
    const capabilityMode = resolveTechnicianCapabilityMode(
      [{
        enabledServiceIds: ['srv_gel'],
        serviceIds: ['srv_gel'],
        specialties: null,
      }],
      [{ id: 'srv_builder', name: 'Builder Gel', category: 'hands' }],
    );

    expect(capabilityMode).toBe('service_assignments');
    expect(
      technicianCanPerformServices({
        technician: {
          enabledServiceIds: ['srv_gel'],
          specialties: null,
        },
        requestedServices: [{ id: 'srv_builder', name: 'Builder Gel', category: 'hands' }],
        capabilityMode,
      }),
    ).toBe(false);
  });

  it('falls back to specialty matching when service assignments are unavailable but specialties are complete', () => {
    const capabilityMode = resolveTechnicianCapabilityMode(
      [
        { enabledServiceIds: [], serviceIds: [], specialties: ['Builder Gel', 'Nail Art'] },
        { enabledServiceIds: [], serviceIds: [], specialties: ['Gel Manicure'] },
      ],
      [{ id: 'srv_builder', name: 'Builder Gel Overlay', category: 'hands' }],
    );

    expect(capabilityMode).toBe('specialty_fallback');
    expect(
      technicianCanPerformServices({
        technician: {
          enabledServiceIds: [],
          specialties: ['Builder Gel', 'Nail Art'],
        },
        requestedServices: [{ id: 'srv_builder', name: 'Builder Gel Overlay', category: 'hands' }],
        capabilityMode,
      }),
    ).toBe(true);
  });

  it('rejects technicians whose primary location conflicts with the requested booking location', () => {
    const decision = canTechnicianTakeAppointment({
      startTime: new Date('2026-03-16T15:00:00.000Z'),
      endTime: new Date('2026-03-16T16:00:00.000Z'),
      weeklySchedule: {
        monday: { start: '09:00', end: '18:00' },
      },
      locationId: 'loc_b',
      primaryLocationId: 'loc_a',
      existingAppointments: [],
    });

    expect(decision).toEqual({
      available: false,
      reason: 'location_unavailable',
    });
  });

  // OP-010: opening hours must bind every salon, including one whose hours
  // exist only on the `salon` row because it has no `salon_location`.
  describe('resolveBookingHoursCeiling', () => {
    const locationHours = { sunday: null, monday: { open: '11:00', close: '16:00' } };
    const salonHours = { sunday: null, monday: { open: '10:00', close: '18:00' } };

    it('prefers the resolved location hours and reports the location id', () => {
      expect(resolveBookingHoursCeiling({
        location: { id: 'loc_1', businessHours: locationHours },
        salonBusinessHours: salonHours,
      })).toEqual({ locationId: 'loc_1', businessHours: locationHours, source: 'location' });
    });

    it('falls back to salon hours when the salon has no location row', () => {
      expect(resolveBookingHoursCeiling({ location: null, salonBusinessHours: salonHours }))
        .toEqual({ locationId: null, businessHours: salonHours, source: 'salon' });
    });

    it('falls back to salon hours when the location carries none', () => {
      expect(resolveBookingHoursCeiling({
        location: { id: 'loc_1', businessHours: null },
        salonBusinessHours: salonHours,
      })).toEqual({ locationId: 'loc_1', businessHours: salonHours, source: 'salon' });
    });

    it('reports no ceiling only when neither record has hours', () => {
      expect(resolveBookingHoursCeiling({})).toEqual({ locationId: null, businessHours: null, source: 'none' });
    });

    it('closes a day the salon hours mark closed, with no location at all', () => {
      const ceiling = resolveBookingHoursCeiling({ salonBusinessHours: salonHours });
      const decision = canTechnicianTakeAppointment({
        // Sunday 2026-03-15 15:00 UTC — inside the technician schedule.
        startTime: new Date('2026-03-15T15:00:00.000Z'),
        endTime: new Date('2026-03-15T16:00:00.000Z'),
        weeklySchedule: { sunday: { start: '09:00', end: '21:00' } },
        locationId: ceiling.locationId,
        locationBusinessHours: ceiling.businessHours,
        existingAppointments: [],
      });

      expect(decision).toEqual({ available: false, reason: 'location_unavailable' });
    });
  });
});
