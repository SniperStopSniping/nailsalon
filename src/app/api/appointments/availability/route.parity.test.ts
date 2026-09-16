import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { zonedTimeToUtc } from '@/libs/timeZone';
import * as schema from '@/models/Schema';

/**
 * A1-2 Piece 1 — BYTE-PARITY PIN for `GET /api/appointments/availability`.
 *
 * Written BEFORE the availability engine was extracted out of the route, and
 * committed with its snapshots, so the refactor has a mechanical, whole-body
 * proof of "behaviour preserved": every scenario snapshots the EXACT
 * `JSON.stringify(body)` the route produced before the extraction — key order
 * included, because `JSON.stringify` is order-sensitive and the slot objects
 * (`time`, `startTime`, `smartFit?`, `availability`) are built by spreading a
 * draft entry.
 *
 * If a snapshot ever fails after the extraction, the EXTRACTION is wrong. The
 * snapshots must never be regenerated (`-u`) to make this suite pass.
 *
 * Determinism (every input pinned):
 *   - `Date.now()` is frozen at `NOW` (the route reads it for the
 *     minimum-notice floor and for Smart Fit's grid anchor),
 *   - every id, slug, date and time is a literal,
 *   - Google Calendar is mocked with fixed busy windows / a fixed failure,
 *   - only scenario 16 enables Smart Fit, and it carries no client session and
 *     no `originalAppointmentId`, so the identity-aware discount resolution
 *     (which would reach the network-free but time-sensitive reward engine)
 *     never runs.
 *
 * The fixtures run on vitest's in-memory PGlite (migrated from `migrations/`),
 * so every query below `getSalonBySlug` — booking policy, overrides, time off,
 * blocked slots, appointments, locations — is the real one.
 */

vi.mock('server-only', () => ({}));

const { holder, GoogleCalendarAvailabilityError, captureException } = vi.hoisted(() => {
  class GoogleCalendarAvailabilityError extends Error {
    reconnectRequired: boolean;

    constructor(reconnectRequired = false) {
      super('Google Calendar availability is unavailable');
      this.name = 'GoogleCalendarAvailabilityError';
      this.reconnectRequired = reconnectRequired;
    }
  }

  return {
    GoogleCalendarAvailabilityError,
    captureException: vi.fn(),
    holder: {
      db: null as unknown,
      googleBusy: [] as Array<{ startTime: Date; endTime: Date }>,
      googleError: null as Error | null,
    },
  };
});

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException,
}));

vi.mock('@/libs/clientAuth', () => ({
  getClientSession: vi.fn(async () => null),
}));

vi.mock('@/libs/googleCalendar', () => ({
  GoogleCalendarAvailabilityError,
  getGoogleCalendarBusyWindows: vi.fn(async () => {
    if (holder.googleError) {
      throw holder.googleError;
    }

    return holder.googleBusy;
  }),
  isBusyWindowConflict: (
    startTime: Date,
    endTime: Date,
    busyWindows: Array<{ startTime: Date; endTime: Date }>,
  ) => busyWindows.some(window => startTime < window.endTime && endTime > window.startTime),
}));

/* eslint-disable import/first */
import { GET } from './route';
/* eslint-enable import/first */

const TIME_ZONE = 'America/Toronto';
/** Thursday 2026-03-05, 12:30 EST — two hours of default minimum notice lands at 14:30 local. */
const NOW = new Date('2026-03-05T17:30:00.000Z');

const D_TODAY = '2026-03-05'; // Thursday — the frozen "today"
const D_FRI = '2026-03-06';
const D_SAT = '2026-03-07';
const D_DST = '2026-03-08'; // Sunday — America/Toronto springs forward at 02:00
const D_MON = '2026-03-09';
const D_TUE = '2026-03-10';
const D_WED = '2026-03-11';

const OPEN_WEEK = {
  sunday: { start: '09:00', end: '18:00' },
  monday: { start: '09:00', end: '18:00' },
  tuesday: { start: '09:00', end: '18:00' },
  wednesday: { start: '09:00', end: '18:00' },
  thursday: { start: '09:00', end: '18:00' },
  friday: { start: '09:00', end: '18:00' },
  saturday: { start: '09:00', end: '18:00' },
};

function businessWeek(open: string, close: string) {
  return {
    sunday: { open, close },
    monday: { open, close },
    tuesday: { open, close },
    wednesday: { open, close },
    thursday: { open, close },
    friday: { open, close },
    saturday: { open, close },
  };
}

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function callAvailability(params: Record<string, string>): Promise<Response> {
  return GET(new Request(
    `http://localhost/api/appointments/availability?${new URLSearchParams(params).toString()}`,
  ));
}

async function pinBody(scenario: string, params: Record<string, string>): Promise<any> {
  const response = await callAvailability(params);
  const body = await response.json();

  expect(response.status).toBe(200);

  await expect(JSON.stringify(body))
    .toMatchFileSnapshot(path.join(__dirname, '__snapshots__', `${scenario}.json`));

  return body;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: 'salon_parity_hours',
      name: 'Parity Hours Salon',
      slug: 'parity-salon-hours',
      // Opening hours live on the salon row only (no location row at all).
      businessHours: { ...businessWeek('09:00', '17:00'), friday: null },
    },
    {
      id: 'salon_parity_loc',
      name: 'Parity Location Salon',
      slug: 'parity-salon-location',
      businessHours: null,
    },
    {
      id: 'salon_parity_open',
      name: 'Parity Open Salon',
      slug: 'parity-salon-open',
      businessHours: null,
    },
    {
      id: 'salon_parity_policy',
      name: 'Parity Policy Salon',
      slug: 'parity-salon-policy',
      businessHours: null,
    },
    {
      id: 'salon_parity_empty',
      name: 'Parity Empty Salon',
      slug: 'parity-salon-empty',
      businessHours: null,
    },
    {
      id: 'salon_parity_incompat',
      name: 'Parity Incompatible Salon',
      slug: 'parity-salon-incompatible',
      businessHours: null,
    },
    {
      id: 'salon_parity_smartfit',
      name: 'Parity Smart Fit Salon',
      slug: 'parity-salon-smartfit',
      businessHours: null,
      // The only scenario that exercises the per-slot annotation seam, so the
      // snapshot also pins the slot key ORDER an annotated slot produces
      // (`time`, `startTime`, `smartFit`, `availability`).
      settings: {
        smartFit: {
          enabled: true,
          discountType: 'percent',
          value: 10,
          maxRemainingGapMinutes: 10,
          minImprovementMinutes: 20,
        },
      },
    },
  ]);

  await db.insert(schema.salonLocationSchema).values({
    id: 'loc_parity_main',
    salonId: 'salon_parity_loc',
    name: 'Parity Main Studio',
    isPrimary: true,
    // Closed Saturday; 10:00–16:00 every other day.
    businessHours: { ...businessWeek('10:00', '16:00'), saturday: null },
  });

  await db.insert(schema.technicianSchema).values([
    { id: 'tech_parity_hours', salonId: 'salon_parity_hours', name: 'Hours Tech', weeklySchedule: OPEN_WEEK },
    { id: 'tech_parity_loc', salonId: 'salon_parity_loc', name: 'Location Tech', weeklySchedule: OPEN_WEEK },
    {
      id: 'tech_parity_open',
      salonId: 'salon_parity_open',
      name: 'Friday Only Tech',
      // Friday only — every other weekday is a technician day off.
      weeklySchedule: { friday: { start: '09:00', end: '18:00' } },
    },
    { id: 'tech_parity_policy', salonId: 'salon_parity_policy', name: 'Policy Tech', weeklySchedule: OPEN_WEEK },
    { id: 'tech_parity_incompat', salonId: 'salon_parity_incompat', name: 'Incompatible Tech', weeklySchedule: OPEN_WEEK },
    { id: 'tech_parity_sf', salonId: 'salon_parity_smartfit', name: 'Smart Fit Tech', weeklySchedule: OPEN_WEEK },
  ]);

  await db.insert(schema.serviceSchema).values([
    {
      id: 'srv_parity_policy',
      salonId: 'salon_parity_policy',
      name: 'Parity Gel Set',
      category: 'builder_gel',
      price: 6500,
      durationMinutes: 60,
    },
    {
      id: 'srv_parity_wanted',
      salonId: 'salon_parity_incompat',
      name: 'Parity Wanted Service',
      category: 'builder_gel',
      price: 5500,
      durationMinutes: 45,
    },
    {
      id: 'srv_parity_other',
      salonId: 'salon_parity_incompat',
      name: 'Parity Other Service',
      category: 'hands',
      price: 3500,
      durationMinutes: 30,
    },
    {
      id: 'srv_parity_sf',
      salonId: 'salon_parity_smartfit',
      name: 'Parity Smart Fit Set',
      category: 'builder_gel',
      price: 6500,
      durationMinutes: 60,
    },
  ]);

  await db.insert(schema.technicianServicesSchema).values([
    { technicianId: 'tech_parity_policy', serviceId: 'srv_parity_policy', enabled: true },
    { technicianId: 'tech_parity_sf', serviceId: 'srv_parity_sf', enabled: true },
    // Structured assignments exist, but NOT for the service the request asks
    // for — the preflight's `no_compatible_technicians` branch.
    { technicianId: 'tech_parity_incompat', serviceId: 'srv_parity_other', enabled: true },
  ]);

  await db.insert(schema.technicianTimeOffSchema).values({
    id: 'timeoff_parity_1',
    salonId: 'salon_parity_policy',
    technicianId: 'tech_parity_policy',
    startDate: new Date('2026-03-06T00:00:00.000Z'),
    endDate: new Date('2026-03-07T00:00:00.000Z'),
    reason: 'vacation',
  });

  await db.insert(schema.technicianScheduleOverrideSchema).values({
    id: 'override_parity_1',
    salonId: 'salon_parity_policy',
    technicianId: 'tech_parity_policy',
    date: D_SAT,
    type: 'hours',
    startTime: '12:00',
    endTime: '14:00',
  });

  await db.insert(schema.technicianBlockedSlotSchema).values({
    id: 'blocked_parity_1',
    salonId: 'salon_parity_policy',
    technicianId: 'tech_parity_policy',
    dayOfWeek: null,
    startTime: '12:00',
    endTime: '13:00',
    specificDate: at(D_MON, '0:00'),
    label: 'Lunch',
    isRecurring: false,
  });

  await db.insert(schema.appointmentSchema).values({
    id: 'appt_parity_1',
    salonId: 'salon_parity_policy',
    technicianId: 'tech_parity_policy',
    clientPhone: '4165550100',
    clientName: 'Parity Client',
    startTime: at(D_TUE, '10:00'),
    endTime: at(D_TUE, '11:00'),
    status: 'confirmed',
    totalPrice: 6500,
    totalDurationMinutes: 60,
    bufferMinutes: 10,
    blockedDurationMinutes: 70,
  });

  await db.insert(schema.appointmentSchema).values({
    id: 'appt_parity_sf',
    salonId: 'salon_parity_smartfit',
    technicianId: 'tech_parity_sf',
    clientPhone: '4165550200',
    clientName: 'Smart Fit Neighbor',
    startTime: at(D_WED, '9:00'),
    endTime: at(D_WED, '10:00'),
    status: 'confirmed',
    totalPrice: 6500,
    totalDurationMinutes: 60,
    bufferMinutes: 10,
    blockedDurationMinutes: 70,
  });
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  holder.googleBusy = [];
  holder.googleError = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await client.close();
});

describe('GET /api/appointments/availability — pre-extraction byte parity', () => {
  it('01 — closed that day by salon business hours (no location row)', async () => {
    const body = await pinBody('01-closed-day-salon-hours', {
      date: D_FRI,
      salonSlug: 'parity-salon-hours',
      technicianId: 'tech_parity_hours',
      durationMinutes: '60',
    });

    expect(body.visibleSlots).toEqual([]);
  });

  it('02 — open day clipped by salon business hours', async () => {
    const body = await pinBody('02-open-day-salon-hours', {
      date: D_SAT,
      salonSlug: 'parity-salon-hours',
      technicianId: 'tech_parity_hours',
      durationMinutes: '60',
    });

    expect(body.visibleSlots.length).toBeGreaterThan(0);
  });

  it('03 — closed that day by the primary location business hours', async () => {
    const body = await pinBody('03-closed-day-location-hours', {
      date: D_SAT,
      salonSlug: 'parity-salon-location',
      technicianId: 'tech_parity_loc',
      durationMinutes: '60',
    });

    expect(body.visibleSlots).toEqual([]);
  });

  it('04 — day clipped by the primary location business hours', async () => {
    const body = await pinBody('04-open-day-location-hours', {
      date: D_MON,
      salonSlug: 'parity-salon-location',
      technicianId: 'tech_parity_loc',
      durationMinutes: '60',
    });

    expect(body.visibleSlots.length).toBeGreaterThan(0);
  });

  it('05 — no hours ceiling anywhere, technician schedule is the only bound', async () => {
    const body = await pinBody('05-no-hours-ceiling', {
      date: D_FRI,
      salonSlug: 'parity-salon-open',
      technicianId: 'tech_parity_open',
      durationMinutes: '60',
    });

    expect(body.visibleSlots.length).toBeGreaterThan(0);
  });

  it('06 — technician day off (no weekly schedule entry for that weekday)', async () => {
    const body = await pinBody('06-technician-day-off', {
      date: D_SAT,
      salonSlug: 'parity-salon-open',
      technicianId: 'tech_parity_open',
      durationMinutes: '60',
    });

    expect(body.visibleSlots).toEqual([]);
  });

  it('07 — technician time off', async () => {
    const body = await pinBody('07-technician-time-off', {
      date: D_FRI,
      salonSlug: 'parity-salon-policy',
      technicianId: 'any',
      baseServiceId: 'srv_parity_policy',
    });

    expect(body.visibleSlots).toEqual([]);
  });

  it('08 — schedule override replaces the weekly hours', async () => {
    const body = await pinBody('08-override-hours', {
      date: D_SAT,
      salonSlug: 'parity-salon-policy',
      technicianId: 'any',
      baseServiceId: 'srv_parity_policy',
    });

    expect(body.visibleSlots.length).toBeGreaterThan(0);
  });

  it('09 — one-off blocked slot', async () => {
    const body = await pinBody('09-blocked-slot', {
      date: D_MON,
      salonSlug: 'parity-salon-policy',
      technicianId: 'any',
      baseServiceId: 'srv_parity_policy',
    });

    expect(body.visibleSlots.length).toBeGreaterThan(0);
  });

  it('10 — existing appointment conflict', async () => {
    const body = await pinBody('10-appointment-conflict', {
      date: D_TUE,
      salonSlug: 'parity-salon-policy',
      technicianId: 'any',
      baseServiceId: 'srv_parity_policy',
    });

    expect(body.bookedSlots.length).toBeGreaterThan(0);
  });

  it('11 — Google Calendar busy windows', async () => {
    holder.googleBusy = [
      { startTime: at(D_WED, '10:00'), endTime: at(D_WED, '11:00') },
      { startTime: at(D_WED, '15:00'), endTime: at(D_WED, '15:30') },
    ];

    const body = await pinBody('11-google-busy-windows', {
      date: D_WED,
      salonSlug: 'parity-salon-policy',
      technicianId: 'any',
      baseServiceId: 'srv_parity_policy',
    });

    expect(body.bookedSlots.length).toBeGreaterThan(0);
  });

  it('12 — minimum-notice edge on the frozen "today"', async () => {
    const body = await pinBody('12-minimum-notice-today', {
      date: D_TODAY,
      salonSlug: 'parity-salon-policy',
      technicianId: 'any',
      baseServiceId: 'srv_parity_policy',
    });

    expect(body.visibleSlots).not.toContain('14:15');
    expect(body.visibleSlots[0]).toBe('14:30');
  });

  it('13 — DST spring-forward day', async () => {
    const body = await pinBody('13-dst-transition-day', {
      date: D_DST,
      salonSlug: 'parity-salon-policy',
      technicianId: 'any',
      baseServiceId: 'srv_parity_policy',
    });

    expect(body.visibleSlots.length).toBeGreaterThan(0);
  });

  it('14 — no technicians at all', async () => {
    const body = await pinBody('14-no-technicians', {
      date: D_FRI,
      salonSlug: 'parity-salon-empty',
      technicianId: 'any',
      durationMinutes: '60',
    });

    expect(body.reason).toBe('no_technicians');
  });

  it('15 — no technician offers the requested service', async () => {
    const body = await pinBody('15-no-compatible-technicians', {
      date: D_FRI,
      salonSlug: 'parity-salon-incompatible',
      technicianId: 'any',
      serviceIds: 'srv_parity_wanted',
      durationMinutes: '45',
    });

    expect(body.reason).toBe('no_compatible_technicians');
  });

  it('16 — Smart Fit annotates a tight slot (pins the annotated slot key order)', async () => {
    const body = await pinBody('16-smart-fit-annotation', {
      date: D_WED,
      salonSlug: 'parity-salon-smartfit',
      technicianId: 'any',
      baseServiceId: 'srv_parity_sf',
    });

    expect(body.slots.filter((slot: { smartFit?: unknown }) => slot.smartFit).length).toBeGreaterThan(0);
  });

  it('17 — Google Calendar failure maps to a sanitized 503', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    holder.googleError = new GoogleCalendarAvailabilityError(true);

    const response = await callAvailability({
      date: D_WED,
      salonSlug: 'parity-salon-policy',
      technicianId: 'any',
      baseServiceId: 'srv_parity_policy',
    });
    const body = await response.json();

    expect(response.status).toBe(503);

    await expect(JSON.stringify({ status: response.status, body }))
      .toMatchFileSnapshot(path.join(__dirname, '__snapshots__', '17-google-error-503.json'));

    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
