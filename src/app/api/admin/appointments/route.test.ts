import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

// `bookingPolicy` reaches `appointmentBlocking`, which is server-only.
vi.mock('server-only', () => ({}));

const {
  requireAdminSalonFromRequest,
  db,
  getBookingConfigForSalon,
  getTechniciansBySalonId,
  getPrimaryLocation,
  tableRows,
} = vi.hoisted(() => {
  /**
   * Rows keyed by the drizzle table object the query selects `from`, so the
   * appointment listing, the time-off read and the blocked-slot read can each
   * be seeded independently. Anything unseeded answers with no rows.
   */
  const tableRows = new Map<unknown, unknown[]>();

  function makeQuery() {
    let rows: unknown[] = [];
    const resolve = () => Promise.resolve(rows);
    const query: Record<string, unknown> = {
      from: (table: unknown) => {
        rows = tableRows.get(table) ?? [];
        return query;
      },
      leftJoin: () => query,
      innerJoin: () => query,
      where: () => query,
      orderBy: () => query,
      limit: () => resolve(),
      then: (onFulfilled: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
      catch: (onRejected: (reason: unknown) => unknown) => resolve().catch(onRejected),
    };
    return query;
  }

  return {
    requireAdminSalonFromRequest: vi.fn(),
    getBookingConfigForSalon: vi.fn(async () => ({ slotIntervalMinutes: 15, timezone: 'America/Toronto' })),
    getTechniciansBySalonId: vi.fn(async () => [] as Array<Record<string, unknown>>),
    getPrimaryLocation: vi.fn(async () => null as null | Record<string, unknown>),
    db: { select: vi.fn(() => makeQuery()) },
    tableRows,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalonFromRequest,
}));

vi.mock('@/libs/bookingConfig', () => ({
  getBookingConfigForSalon,
}));

vi.mock('@/libs/queries', () => ({
  getTechniciansBySalonId,
  getPrimaryLocation,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

const SALON_HOURS = {
  sunday: null,
  monday: { open: '09:00', close: '19:00' },
  tuesday: { open: '09:00', close: '19:00' },
  wednesday: { open: '09:00', close: '19:00' },
  thursday: { open: '09:00', close: '19:00' },
  friday: { open: '09:00', close: '19:00' },
  saturday: { open: '10:00', close: '17:00' },
};

describe('GET /api/admin/appointments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableRows.clear();
    getTechniciansBySalonId.mockResolvedValue([]);
    getPrimaryLocation.mockResolvedValue(null);
  });

  it('rejects unauthorized admins', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
      admin: null,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/appointments?date=2026-03-14'),
    );

    expect(response.status).toBe(401);
  });

  it('lists appointments for the active salon only', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1' },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/appointments?date=2026-03-14'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.appointments).toEqual([]);
    expect(body.data.technicians).toEqual([]);
    expect(body.meta).toEqual({ slotIntervalMinutes: 15, timeZone: 'America/Toronto' });
  });

  // AG-security-tenancy-03: `?salon=`/`?salonSlug=` must reach the guard, so a
  // deep link naming one salon is never answered from another one's cookie.
  it('scopes the listing to the salon the URL names', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_requested', name: 'Requested Salon' },
      admin: { id: 'admin_1' },
    });

    const request = new Request(
      'http://localhost/api/admin/appointments?date=2026-03-14&salon=requested-salon',
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(requireAdminSalonFromRequest).toHaveBeenCalledWith(request);
    expect(getBookingConfigForSalon).toHaveBeenCalledWith('salon_requested');
  });

  // AG-today-calendar-04: the calendar has to draw the same authorities the
  // booking engine enforces, so they ship with the appointments.
  describe('schedule payload', () => {
    beforeEach(async () => {
      const schema = await import('@/models/Schema');
      requireAdminSalonFromRequest.mockResolvedValue({
        error: null,
        salon: { id: 'salon_active', name: 'Active Salon', businessHours: SALON_HOURS },
        admin: { id: 'admin_1' },
      });
      getTechniciansBySalonId.mockResolvedValue([
        {
          id: 'tech_daniela',
          name: 'Daniela',
          weeklySchedule: {
            sunday: { start: '09:00', end: '21:00' },
            monday: { start: '09:00', end: '21:00' },
            tuesday: { start: '09:00', end: '21:00' },
            wednesday: { start: '09:00', end: '21:00' },
            thursday: { start: '09:00', end: '21:00' },
            friday: { start: '09:00', end: '21:00' },
            saturday: { start: '09:00', end: '21:00' },
          },
        },
      ]);
      tableRows.set(schema.technicianTimeOffSchema, [{
        id: 'toff_1',
        technicianId: 'tech_jenny',
        startDate: new Date('2026-09-09T00:00:00.000Z'),
        endDate: new Date('2026-09-10T00:00:00.000Z'),
        reason: 'vacation',
      }]);
      tableRows.set(schema.technicianBlockedSlotSchema, [{
        id: 'blk_1',
        technicianId: 'tech_daniela',
        dayOfWeek: 3,
        startTime: '13:00',
        endTime: '14:00',
        specificDate: null,
        label: 'Lunch',
        isRecurring: true,
      }]);
    });

    it('returns hours, weekly schedules, time off and blocked slots', async () => {
      const response = await GET(
        new Request('http://localhost/api/admin/appointments?startDate=2026-09-01&endDate=2026-09-30'),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.schedule.businessHours.sunday).toBeNull();
      expect(body.data.schedule.businessHoursSource).toBe('salon');
      expect(body.data.schedule.technicians).toEqual([
        expect.objectContaining({
          id: 'tech_daniela',
          name: 'Daniela',
          weeklySchedule: expect.objectContaining({ wednesday: { start: '09:00', end: '21:00' } }),
        }),
      ]);
      // Whole-day columns are serialised as date-only strings, never instants.
      expect(body.data.schedule.timeOff).toEqual([
        { id: 'toff_1', technicianId: 'tech_jenny', startDate: '2026-09-09', endDate: '2026-09-10', reason: 'vacation' },
      ]);
      expect(body.data.schedule.blockedSlots).toEqual([
        expect.objectContaining({ id: 'blk_1', dayOfWeek: 3, startTime: '13:00', endTime: '14:00', label: 'Lunch' }),
      ]);
      // Additive: the pre-existing technician list keeps its shape.
      expect(body.data.technicians[0]).toEqual(expect.objectContaining({ id: 'tech_daniela', name: 'Daniela' }));
    });

    it('prefers the primary location hours over the salon row', async () => {
      getPrimaryLocation.mockResolvedValue({
        id: 'loc_primary',
        businessHours: { ...SALON_HOURS, saturday: { open: '11:00', close: '16:00' } },
      });

      const response = await GET(
        new Request('http://localhost/api/admin/appointments?startDate=2026-09-01&endDate=2026-09-30'),
      );
      const body = await response.json();

      expect(body.data.schedule.businessHoursSource).toBe('location');
      expect(body.data.schedule.businessHours.saturday).toEqual({ open: '11:00', close: '16:00' });
    });
  });
});
