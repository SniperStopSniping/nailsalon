import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSalonBySlug,
  getServicesByIds,
  getLocationById,
  getTechnicianById,
  getTechniciansBySalonId,
  guardSalonApiRoute,
  selectResults,
  db,
} = vi.hoisted(() => {
  const selectResults: Array<unknown[] | Error> = [];

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
    getServicesByIds: vi.fn(),
    getLocationById: vi.fn(),
    getTechnicianById: vi.fn(),
    getTechniciansBySalonId: vi.fn(),
    guardSalonApiRoute: vi.fn(),
    selectResults,
    db: {
      select,
    },
  };
});

vi.mock('@/libs/queries', () => ({
  getSalonBySlug,
  getServicesByIds,
  getLocationById,
  getTechnicianById,
  getTechniciansBySalonId,
}));

vi.mock('@/libs/salonStatus', () => ({
  guardSalonApiRoute,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET } from './route';

describe('GET /api/appointments/availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    getSalonBySlug.mockResolvedValue({ id: 'salon_1', slug: 'salon-a' });
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
    guardSalonApiRoute.mockResolvedValue(null);
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
    expect(body.durationMinutes).toBe(90);
    expect(body.visibleSlots).not.toContain('17:00');
    expect(body.visibleSlots).not.toContain('17:30');
    expect(body.visibleSlots).toContain('16:30');
  });

  it('excludes the original appointment from conflict checks during reschedule availability', async () => {
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
    expect(body.visibleSlots).toContain('11:30');
    expect(body.visibleSlots).toContain('13:00');
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
