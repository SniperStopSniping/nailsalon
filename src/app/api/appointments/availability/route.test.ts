/* eslint-disable import/first */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSalonBySlug,
  getSalonById,
  getServicesByIds,
  getLocationById,
  getTechnicianById,
  getTechniciansBySalonId,
  getAppointmentById,
  getClientSession,
  verifyAppointmentAccessToken,
  guardSalonApiRoute,
  GoogleCalendarAvailabilityError,
  getGoogleCalendarBusyWindows,
  isBusyWindowConflict,
  selectResults,
  findService,
  findTechnician,
  captureException,
  db,
} = vi.hoisted(() => {
  const selectResults: Array<unknown[] | Error> = [];
  class GoogleCalendarAvailabilityError extends Error {
    reconnectRequired: boolean;

    constructor(reconnectRequired = false) {
      super('Google Calendar availability is unavailable');
      this.reconnectRequired = reconnectRequired;
    }
  }

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const result = selectResults.shift() ?? [];
        if (result instanceof Error) {
          return {
            limit: vi.fn(async () => {
              throw result;
            }),
            then: (_resolve: (value: unknown) => void, reject?: (reason: unknown) => void) => {
              if (reject) {
                reject(result);
                return;
              }
              throw result;
            },
          };
        }
        return {
          limit: vi.fn(async () => result),
          then: (resolve: (value: unknown) => void) => resolve(result),
        };
      }),
    })),
  }));

  return {
    getSalonBySlug: vi.fn(),
    getSalonById: vi.fn(),
    getServicesByIds: vi.fn(),
    getLocationById: vi.fn(),
    getTechnicianById: vi.fn(),
    getTechniciansBySalonId: vi.fn(),
    getAppointmentById: vi.fn(),
    getClientSession: vi.fn(),
    verifyAppointmentAccessToken: vi.fn(),
    guardSalonApiRoute: vi.fn(),
    GoogleCalendarAvailabilityError,
    getGoogleCalendarBusyWindows: vi.fn(),
    isBusyWindowConflict: vi.fn((startTime: Date, endTime: Date, busyWindows: Array<{ startTime: Date; endTime: Date }>) =>
      busyWindows.some(window => startTime < window.endTime && endTime > window.startTime),
    ),
    selectResults,
    findService: vi.fn(),
    findTechnician: vi.fn(),
    captureException: vi.fn(),
    db: {
      select,
      query: {
        serviceSchema: { findFirst: vi.fn((...args: unknown[]) => findService(...args)) },
        technicianSchema: { findFirst: vi.fn((...args: unknown[]) => findTechnician(...args)) },
      },
    },
  };
});

vi.mock('@/libs/queries', () => ({
  getSalonBySlug,
  getSalonById,
  getServicesByIds,
  getLocationById,
  getTechnicianById,
  getTechniciansBySalonId,
  getAppointmentById,
}));

// Reschedule ownership proof (Prompt 9): the route only excludes the original
// appointment when a client session or manage token verifies ownership. These
// doubles default to "guest, no token" so each test opts into ownership.
vi.mock('@/libs/clientAuth', () => ({
  getClientSession,
}));

vi.mock('@/libs/appointmentAccess', () => ({
  verifyAppointmentAccessToken,
}));

vi.mock('@/libs/salonStatus', () => ({
  guardSalonApiRoute,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/googleCalendar', () => ({
  GoogleCalendarAvailabilityError,
  getGoogleCalendarBusyWindows,
  isBusyWindowConflict,
}));

vi.mock('@sentry/nextjs', () => ({
  captureException,
}));

// The route imports @/libs/firstVisitDiscount ('server-only') for the
// identity-aware Smart Fit annotation (P7.5); none of these fixtures enable
// Smart Fit, so no identity resolution runs in this suite.
vi.mock('server-only', () => ({}));

import { GET } from './route';

describe('GET /api/appointments/availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-12T12:00:00.000Z').getTime());
    selectResults.length = 0;
    getSalonBySlug.mockResolvedValue({ id: 'salon_1', slug: 'salon-a' });
    getSalonById.mockResolvedValue({
      id: 'salon_1',
      slug: 'salon-a',
      settings: {
        booking: {
          bufferMinutes: 10,
          slotIntervalMinutes: 15,
          currency: 'CAD',
          timezone: 'America/Toronto',
          introPriceDefaultLabel: null,
        },
      },
    });
    getServicesByIds.mockResolvedValue([]);
    getLocationById.mockResolvedValue(null);
    getTechnicianById.mockResolvedValue({
      id: 'tech_1',
      weeklySchedule: {
        friday: { start: '09:00', end: '18:00' },
      },
      enabledServiceIds: [],
      serviceIds: [],
      specialties: [],
      primaryLocationId: null,
    });
    getTechniciansBySalonId.mockResolvedValue([]);
    getAppointmentById.mockResolvedValue(null);
    getClientSession.mockResolvedValue(null);
    verifyAppointmentAccessToken.mockResolvedValue(null);
    guardSalonApiRoute.mockResolvedValue(null);
    getGoogleCalendarBusyWindows.mockResolvedValue([]);
    findService.mockResolvedValue(null);
    findTechnician.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks late-day slots when the requested service duration no longer fits the schedule', async () => {
    selectResults.push(
      [],
      [],
      [],
      [],
    );

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=90'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getGoogleCalendarBusyWindows).toHaveBeenCalledWith(expect.objectContaining({ salonId: 'salon_1' }));
    expect(body.durationMinutes).toBe(90);
    expect(body.visibleSlots).not.toContain('17:00');
    expect(body.visibleSlots).not.toContain('17:30');
    expect(body.visibleSlots).not.toContain('16:30');
    expect(body.visibleSlots).toContain('16:15');
  });

  it('returns a friendly recoverable error without leaking internal codes for a missing assignment', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    findService.mockResolvedValue({
      id: 'svc_builder_overlay',
      salonId: 'salon_1',
      name: 'Builder Gel Overlay',
      category: 'builder_gel',
      isActive: true,
    });
    findTechnician.mockResolvedValue({ id: 'tech_1', salonId: 'salon_1', isActive: true });
    getTechniciansBySalonId.mockResolvedValue([{
      id: 'tech_2',
      enabledServiceIds: ['svc_builder_overlay'],
      serviceIds: ['svc_builder_overlay'],
    }]);
    selectResults.push([]);

    const response = await GET(new Request(
      'http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&baseServiceId=svc_builder_overlay',
    ));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(400);
    expect(body.error).toEqual({
      kind: 'unsupported_technician',
      message: 'This service is not available with the selected technician. Please choose another technician.',
      canRetry: false,
      canReselectTechnician: true,
    });
    expect(serialized).not.toContain('TECHNICIAN_SERVICE_UNSUPPORTED');
    expect(serialized).not.toContain('svc_builder_overlay');
    expect(serialized).not.toContain('tech_1');
    expect(warnSpy).toHaveBeenCalledWith(
      '[Availability API] Invalid public booking selection',
      expect.objectContaining({ classification: 'unsupported_technician', salonId: 'salon_1' }),
    );
  });

  it('rejects a cross-tenant technician as an unsupported selection', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    findService.mockResolvedValue({
      id: 'svc_builder_overlay',
      salonId: 'salon_1',
      name: 'Builder Gel Overlay',
      category: 'builder_gel',
      isActive: true,
    });
    findTechnician.mockResolvedValue(null);

    const response = await GET(new Request(
      'http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_other_salon&baseServiceId=svc_builder_overlay',
    ));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.kind).toBe('unsupported_technician');
    expect(JSON.stringify(body)).not.toContain('tech_other_salon');
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('returns a retryable public error and reports unexpected failures to Sentry', async () => {
    const internalError = new Error('database connection details must stay private');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    findService.mockRejectedValue(internalError);

    const response = await GET(new Request(
      'http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&baseServiceId=svc_builder_overlay',
    ));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      kind: 'temporary_failure',
      message: 'Unable to evaluate availability for the selected day.',
      canRetry: true,
      canReselectTechnician: false,
    });
    expect(JSON.stringify(body)).not.toContain(internalError.message);
    expect(captureException).toHaveBeenCalledWith(internalError, expect.objectContaining({
      tags: expect.objectContaining({ route: '/api/appointments/availability' }),
    }));
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('returns a sanitized non-retryable 503 when Google Calendar must be reconnected', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    selectResults.push([], [], [], []);
    getGoogleCalendarBusyWindows.mockRejectedValue(new GoogleCalendarAvailabilityError(true));

    const response = await GET(new Request(
      'http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=60',
    ));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      kind: 'temporary_failure',
      message: 'Online booking is temporarily unavailable while the salon restores its calendar connection. Please try again later.',
      canRetry: false,
      canReselectTechnician: false,
    });
    expect(captureException).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Availability API] Google Calendar unavailable',
      expect.objectContaining({ salonSlug: 'salon-a' }),
    );
  });

  it('returns a sanitized retryable 503 for a transient Google Calendar outage', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    selectResults.push([], [], [], []);
    getGoogleCalendarBusyWindows.mockRejectedValue(new GoogleCalendarAvailabilityError(false));

    const response = await GET(new Request(
      'http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=60',
    ));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      kind: 'temporary_failure',
      message: 'Live calendar availability is temporarily unavailable. Please try again shortly.',
      canRetry: true,
      canReselectTechnician: false,
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  // Prompt 9: exclusion now requires PROVEN ownership. A logged-in client
  // whose session phone matches the appointment gets the original slot back.
  it('excludes the original appointment from conflict checks when the session owns it', async () => {
    getAppointmentById.mockResolvedValue({
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      clientPhone: '4165551234',
      salonClientId: 'sc_1',
      startTime: new Date('2026-03-13T10:00:00'),
      endTime: new Date('2026-03-13T11:00:00'),
    });
    getClientSession.mockResolvedValue({
      phone: '4165551234',
      clientName: null,
      clientEmail: null,
      sessionId: 'sess_1',
    });
    selectResults.push(
      [],
      [],
      [],
      [{
        id: 'appt_1',
        technicianId: 'tech_1',
        startTime: new Date('2026-03-13T10:00:00'),
        endTime: new Date('2026-03-13T11:00:00'),
      }],
    );

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=60&originalAppointmentId=appt_1'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.visibleSlots).toContain('10:00');
    expect(body.bookedSlots).not.toContain('10:00');
  });

  // Prompt 9: an unauthenticated caller passing a bare originalAppointmentId
  // must NOT be able to make that appointment's window appear open — the
  // public endpoint would otherwise be a schedule oracle for any guessed id.
  it('keeps the original appointment blocking when ownership is unproven', async () => {
    getAppointmentById.mockResolvedValue({
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      clientPhone: '4165551234',
      salonClientId: 'sc_1',
      startTime: new Date('2026-03-13T10:00:00'),
      endTime: new Date('2026-03-13T11:00:00'),
    });
    // No session, no manage token (beforeEach defaults).
    selectResults.push(
      [],
      [],
      [],
      [{
        id: 'appt_1',
        technicianId: 'tech_1',
        startTime: new Date('2026-03-13T10:00:00'),
        endTime: new Date('2026-03-13T11:00:00'),
        totalDurationMinutes: 60,
        bufferMinutes: 10,
        blockedDurationMinutes: 70,
      }],
    );

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=60&originalAppointmentId=appt_1'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookedSlots).toContain('10:00');
  });

  // Prompt 9: a manage token that verifies for this exact appointment proves
  // ownership for a guest — same exclusion a logged-in owner gets.
  it('excludes the original appointment when a valid manage token is presented', async () => {
    getAppointmentById.mockResolvedValue({
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      clientPhone: '4165551234',
      salonClientId: 'sc_1',
      startTime: new Date('2026-03-13T10:00:00'),
      endTime: new Date('2026-03-13T11:00:00'),
    });
    verifyAppointmentAccessToken.mockResolvedValue({
      tokenId: 'token_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
    });
    selectResults.push(
      [],
      [],
      [],
      [{
        id: 'appt_1',
        technicianId: 'tech_1',
        startTime: new Date('2026-03-13T10:00:00'),
        endTime: new Date('2026-03-13T11:00:00'),
      }],
    );

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=60&originalAppointmentId=appt_1&manageToken=tok_abcdefghijklmnopqrstuv'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(verifyAppointmentAccessToken).toHaveBeenCalledWith('tok_abcdefghijklmnopqrstuv', {
      appointmentId: 'appt_1',
      salonId: 'salon_1',
    });
    expect(body.visibleSlots).toContain('10:00');
    expect(body.bookedSlots).not.toContain('10:00');
  });

  it('authorizes the Google Calendar mirror exclusion from the verified manage token', async () => {
    getAppointmentById.mockResolvedValue({
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      clientPhone: '4165551234',
      salonClientId: 'sc_1',
      startTime: new Date('2026-03-13T10:00:00'),
      endTime: new Date('2026-03-13T11:00:00'),
    });
    verifyAppointmentAccessToken.mockResolvedValue({
      tokenId: 'token_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
    });
    selectResults.push([], [], [], []);

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=60&originalAppointmentId=appt_1&manageToken=tok_abcdefghijklmnopqrstuv'),
    );

    expect(response.status).toBe(200);
    expect(getGoogleCalendarBusyWindows).toHaveBeenCalledWith(
      expect.objectContaining({ excludeAppointmentId: 'appt_1' }),
    );
  });

  it('never excludes a Google Calendar mirror for an unproven appointment id', async () => {
    getAppointmentById.mockResolvedValue({
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      clientPhone: '4165551234',
      salonClientId: 'sc_1',
      startTime: new Date('2026-03-13T10:00:00'),
      endTime: new Date('2026-03-13T11:00:00'),
    });
    verifyAppointmentAccessToken.mockResolvedValue(null);
    selectResults.push([], [], [], []);

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=60&originalAppointmentId=appt_1'),
    );

    expect(response.status).toBe(200);
    expect(getGoogleCalendarBusyWindows).toHaveBeenCalledWith(
      expect.objectContaining({ excludeAppointmentId: null }),
    );
  });

  it('keeps unrelated Google busy windows blocking during a reschedule', async () => {
    getAppointmentById.mockResolvedValue({
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      clientPhone: '4165551234',
      salonClientId: 'sc_1',
      startTime: new Date('2026-03-13T10:00:00'),
      endTime: new Date('2026-03-13T11:00:00'),
    });
    verifyAppointmentAccessToken.mockResolvedValue({
      tokenId: 'token_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
    });
    // The library drops only the appointment's own mirror; anything it still
    // returns is a real external conflict and must keep blocking.
    getGoogleCalendarBusyWindows.mockResolvedValue([{
      startTime: new Date('2026-03-13T14:00:00.000Z'),
      endTime: new Date('2026-03-13T15:00:00.000Z'),
    }]);
    selectResults.push([], [], [], []);

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=30&originalAppointmentId=appt_1&manageToken=tok_abcdefghijklmnopqrstuv'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookedSlots).toContain('10:00');
  });

  it('removes technician blocked slots from the visible slot range', async () => {
    selectResults.push(
      [],
      [],
      [{
        technicianId: 'tech_1',
        dayOfWeek: 5,
        startTime: '12:00',
        endTime: '13:00',
        specificDate: null,
        label: 'Lunch',
        isRecurring: true,
      }],
      [],
    );

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=30'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.visibleSlots).not.toContain('12:00');
    expect(body.visibleSlots).not.toContain('12:30');
    expect(body.visibleSlots).not.toContain('11:30');
    expect(body.visibleSlots).toContain('11:15');
    expect(body.visibleSlots).toContain('13:00');
  });

  it('marks Google Calendar busy windows as booked slots', async () => {
    getGoogleCalendarBusyWindows.mockResolvedValue([{
      startTime: new Date('2026-03-13T14:00:00.000Z'),
      endTime: new Date('2026-03-13T15:00:00.000Z'),
    }]);
    selectResults.push([], [], [], []);

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=30'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.visibleSlots).toContain('10:00');
    expect(body.bookedSlots).toContain('10:00');
    expect(body.bookedSlots).toContain('10:30');
    expect(body.bookedSlots).not.toContain('11:00');
  });

  it('blocks every start whose service and buffer would overlap a 7:15 PM appointment', async () => {
    getTechnicianById.mockResolvedValue({
      id: 'tech_1',
      weeklySchedule: { friday: { start: '09:00', end: '23:00' } },
      enabledServiceIds: [],
      serviceIds: [],
      specialties: [],
      primaryLocationId: null,
    });
    selectResults.push(
      [],
      [],
      [],
      [{
        id: 'appt_715',
        technicianId: 'tech_1',
        startTime: new Date('2026-03-13T23:15:00.000Z'),
        endTime: new Date('2026-03-14T00:45:00.000Z'),
      }],
    );

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&durationMinutes=90'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.blockedDurationMinutes).toBe(100);
    expect(body.bookedSlots).toEqual(expect.arrayContaining(['17:45', '18:00', '18:15', '18:30', '18:45', '19:00', '19:15']));
    expect(body.bookedSlots).not.toContain('17:30');
    expect(body.slots.find((slot: { time: string }) => slot.time === '17:45')).toMatchObject({ availability: 'schedule_conflict' });
  });

  it('only considers technicians who can actually perform the requested services', async () => {
    getTechniciansBySalonId.mockResolvedValue([
      {
        id: 'tech_unsupported',
        weeklySchedule: {
          friday: { start: '09:00', end: '18:00' },
        },
        enabledServiceIds: [],
        serviceIds: [],
        specialties: [],
        primaryLocationId: null,
      },
      {
        id: 'tech_supported',
        weeklySchedule: {
          friday: { start: '11:00', end: '18:00' },
        },
        enabledServiceIds: ['srv_1'],
        serviceIds: ['srv_1'],
        specialties: [],
        primaryLocationId: null,
      },
    ]);
    getServicesByIds.mockResolvedValue([
      { id: 'srv_1', name: 'Gel Manicure', category: 'hands' },
    ]);
    selectResults.push([], [], [], []);

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&serviceIds=srv_1&durationMinutes=30'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.visibleSlots).not.toContain('10:00');
    expect(body.visibleSlots).toContain('11:00');
  });

  it('clips visible slots to the requested location business hours', async () => {
    getLocationById.mockResolvedValue({
      id: 'loc_1',
      businessHours: {
        friday: { open: '11:00', close: '16:00' },
      },
    });
    selectResults.push([], [], [], []);

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-13&salonSlug=salon-a&technicianId=tech_1&locationId=loc_1&durationMinutes=30'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.visibleSlots).not.toContain('10:30');
    expect(body.visibleSlots).toContain('11:00');
    expect(body.visibleSlots).not.toContain('16:00');
  });

  it('does not throw for a single-service any-technician request when one technician has a legacy-shaped schedule', async () => {
    getTechniciansBySalonId.mockResolvedValue([
      {
        id: 'tech_legacy',
        weeklySchedule: {
          friday: { open: '09:00', close: '18:00' },
        },
        enabledServiceIds: ['svc_biab-short'],
        serviceIds: ['svc_biab-short'],
        specialties: [],
        primaryLocationId: null,
      },
      {
        id: 'tech_supported',
        weeklySchedule: {
          friday: { start: '09:00', end: '18:00' },
        },
        enabledServiceIds: ['svc_biab-short'],
        serviceIds: ['svc_biab-short'],
        specialties: [],
        primaryLocationId: null,
      },
    ]);
    getServicesByIds.mockResolvedValue([
      { id: 'svc_biab-short', name: 'BIAB Short', category: 'hands' },
    ]);
    selectResults.push([], [], [], []);

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-20&salonSlug=salon-a&durationMinutes=75&serviceIds=svc_biab-short'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.durationMinutes).toBe(75);
    expect(body.visibleSlots).toContain('9:00');
  });

  it('fails safely when technician_time_off is missing in the local database', async () => {
    getTechniciansBySalonId.mockResolvedValue([
      {
        id: 'tech_supported',
        weeklySchedule: {
          friday: { start: '09:00', end: '18:00' },
        },
        enabledServiceIds: ['svc_biab-short'],
        serviceIds: ['svc_biab-short'],
        specialties: [],
        primaryLocationId: null,
      },
    ]);
    getServicesByIds.mockResolvedValue([
      { id: 'svc_biab-short', name: 'BIAB Short', category: 'hands' },
    ]);

    const missingTimeOffTable = Object.assign(
      new Error('relation "technician_time_off" does not exist'),
      { code: '42P01' },
    );

    selectResults.push(
      [],
      missingTimeOffTable,
      [],
      [],
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-20&salonSlug=salon-a&durationMinutes=75&serviceIds=svc_biab-short'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.visibleSlots.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalledWith(
      '[BookingPolicy] Missing relation "technician_time_off". Treating it as empty. Run `npm run db:migrate:dev` for the local database.',
    );

    warnSpy.mockRestore();
  });

  it('fails safely when technician_blocked_slot is missing in the local database', async () => {
    getTechniciansBySalonId.mockResolvedValue([
      {
        id: 'tech_supported',
        weeklySchedule: {
          friday: { start: '09:00', end: '18:00' },
        },
        enabledServiceIds: ['svc_biab-short'],
        serviceIds: ['svc_biab-short'],
        specialties: [],
        primaryLocationId: null,
      },
    ]);
    getServicesByIds.mockResolvedValue([
      { id: 'svc_biab-short', name: 'BIAB Short', category: 'hands' },
    ]);

    const missingBlockedSlotsTable = Object.assign(
      new Error('relation "technician_blocked_slot" does not exist'),
      { code: '42P01' },
    );

    selectResults.push(
      [],
      [],
      missingBlockedSlotsTable,
      [],
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await GET(
      new Request('http://localhost/api/appointments/availability?date=2026-03-20&salonSlug=salon-a&durationMinutes=75&serviceIds=svc_biab-short'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.visibleSlots.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalledWith(
      '[BookingPolicy] Missing relation "technician_blocked_slot". Treating it as empty. Run `npm run db:migrate:dev` for the local database.',
    );

    warnSpy.mockRestore();
  });
});
