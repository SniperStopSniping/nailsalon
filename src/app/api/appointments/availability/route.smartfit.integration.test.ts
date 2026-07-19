import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { zonedTimeToUtc } from '@/libs/timeZone';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  googleBusy: [] as Array<{ startTime: Date; endTime: Date }>,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/libs/googleCalendar', () => ({
  getGoogleCalendarBusyWindows: vi.fn(async () => holder.googleBusy),
  isBusyWindowConflict: (
    startTime: Date,
    endTime: Date,
    busyWindows: Array<{ startTime: Date; endTime: Date }>,
  ) => busyWindows.some(window => startTime < window.endTime && endTime > window.startTime),
  GoogleCalendarAvailabilityError: class GoogleCalendarAvailabilityError extends Error {
    constructor(public readonly reconnectRequired: boolean) {
      super('google_unavailable');
    }
  },
}));

/* eslint-disable import/first */
import { GET } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_sf_avail';
const SALON_SLUG = 'smartfit-availability-salon';
const OTHER_SALON_ID = 'salon_sf_other';
const TECH_1 = 'tech_sf_1';
const TECH_2 = 'tech_sf_2';
const OTHER_TECH = 'tech_sf_foreign';
const SERVICE_ID = 'srv_sf_biab'; // 60 min, $65.00
const ADD_ON_ID = 'addon_sf_art'; // 30 min, $20.00
const LOC_MAIN = 'loc_sf_main';
const LOC_LATE = 'loc_sf_late';
const TIME_ZONE = 'America/Toronto';

const FULL_WEEK = {
  sunday: { start: '9:00', end: '17:00' },
  monday: { start: '9:00', end: '17:00' },
  tuesday: { start: '9:00', end: '17:00' },
  wednesday: { start: '9:00', end: '17:00' },
  thursday: { start: '9:00', end: '17:00' },
  friday: { start: '9:00', end: '17:00' },
  saturday: { start: '9:00', end: '17:00' },
};

const ENABLED_SMART_FIT_SETTINGS = {
  smartFit: {
    enabled: true,
    discountType: 'percent',
    value: 10,
    maxRemainingGapMinutes: 10,
    minImprovementMinutes: 20,
  },
} as const;

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let appointmentCounter = 0;

/** Each test uses its own future date so day schedules never interfere. */
function futureDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

async function seedNeighborAppointment(args: {
  date: string;
  startTime: string;
  visibleMinutes?: number;
  bufferMinutes?: number;
  technicianId?: string;
  salonId?: string;
  salonClientId?: string;
  clientPhone?: string;
  status?: string;
}): Promise<string> {
  appointmentCounter += 1;
  const id = `appt_nbr_${appointmentCounter}`;
  const visibleMinutes = args.visibleMinutes ?? 60;
  const bufferMinutes = args.bufferMinutes ?? 10;
  const startTime = at(args.date, args.startTime);
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: args.salonId ?? SALON_ID,
    technicianId: args.technicianId ?? TECH_1,
    clientPhone: args.clientPhone ?? '4165550999',
    clientName: 'Neighbor Client',
    salonClientId: args.salonClientId ?? 'sc_neighbor',
    startTime,
    endTime: new Date(startTime.getTime() + visibleMinutes * 60_000),
    status: args.status ?? 'confirmed',
    totalPrice: 6500,
    totalDurationMinutes: visibleMinutes,
    bufferMinutes,
    blockedDurationMinutes: visibleMinutes + bufferMinutes,
  });
  return id;
}

async function queryAvailability(params: Record<string, string>): Promise<any> {
  const search = new URLSearchParams({
    salonSlug: SALON_SLUG,
    technicianId: 'any',
    baseServiceId: SERVICE_ID,
    ...params,
  });
  const response = await GET(
    new Request(`http://localhost/api/appointments/availability?${search.toString()}`),
  );

  expect(response.status).toBe(200);

  return response.json();
}

function slotByTime(body: any, time: string): any {
  return body.slots.find((slot: any) => slot.time === time);
}

function annotatedTimes(body: any): string[] {
  return body.slots.filter((slot: any) => slot.smartFit).map((slot: any) => slot.time);
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: SALON_ID,
      name: 'Smart Fit Availability Salon',
      slug: SALON_SLUG,
      settings: ENABLED_SMART_FIT_SETTINGS,
    },
    {
      id: OTHER_SALON_ID,
      name: 'Foreign Salon',
      slug: 'smartfit-foreign-salon',
      settings: ENABLED_SMART_FIT_SETTINGS,
    },
  ]);

  await db.insert(schema.technicianSchema).values([
    { id: TECH_1, salonId: SALON_ID, name: 'Daniela', weeklySchedule: FULL_WEEK },
    { id: TECH_2, salonId: SALON_ID, name: 'Isla', weeklySchedule: FULL_WEEK },
    { id: OTHER_TECH, salonId: OTHER_SALON_ID, name: 'Foreign Tech', weeklySchedule: FULL_WEEK },
  ]);

  await db.insert(schema.serviceSchema).values([
    {
      id: SERVICE_ID,
      salonId: SALON_ID,
      name: 'BIAB Short',
      category: 'builder_gel',
      price: 6500,
      durationMinutes: 60,
    },
    {
      id: 'srv_sf_foreign',
      salonId: OTHER_SALON_ID,
      name: 'Foreign Service',
      category: 'builder_gel',
      price: 6500,
      durationMinutes: 60,
    },
  ]);

  await db.insert(schema.technicianServicesSchema).values([
    { technicianId: TECH_1, serviceId: SERVICE_ID, enabled: true },
    { technicianId: TECH_2, serviceId: SERVICE_ID, enabled: true },
  ]);

  await db.insert(schema.addOnSchema).values({
    id: ADD_ON_ID,
    salonId: SALON_ID,
    name: 'Nail Art',
    slug: 'nail-art',
    category: 'nail_art',
    priceCents: 2000,
    durationMinutes: 30,
  });
  await db.insert(schema.serviceAddOnSchema).values({
    id: 'svcaddon_sf_1',
    salonId: SALON_ID,
    serviceId: SERVICE_ID,
    addOnId: ADD_ON_ID,
  });

  await db.insert(schema.salonClientSchema).values([
    { id: 'sc_neighbor', salonId: SALON_ID, phone: '4165550999', fullName: 'Neighbor Client' },
    { id: 'sc_self', salonId: SALON_ID, phone: '4165550111', fullName: 'Self Client' },
    { id: 'sc_foreign', salonId: OTHER_SALON_ID, phone: '4165550888', fullName: 'Foreign Client' },
  ]);

  await db.insert(schema.salonLocationSchema).values([
    {
      id: LOC_MAIN,
      salonId: SALON_ID,
      name: 'Main Studio',
      businessHours: FULL_WEEK_HOURS('9:00', '17:00'),
    },
    {
      id: LOC_LATE,
      salonId: SALON_ID,
      name: 'Late Studio',
      businessHours: FULL_WEEK_HOURS('13:00', '17:00'),
    },
  ]);
}, 60_000);

function FULL_WEEK_HOURS(open: string, close: string) {
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

beforeEach(async () => {
  holder.googleBusy = [];
  await db.update(schema.salonSchema)
    .set({ settings: ENABLED_SMART_FIT_SETTINGS })
    .where(eq(schema.salonSchema.id, SALON_ID));
});

afterAll(async () => {
  await client.close();
});

describe('availability × Smart Fit — disabled leaves the contract unchanged', () => {
  // Matrix 1.
  it('emits the legacy shape with no smartFit fields when the salon has not enabled it', async () => {
    const date = futureDate(4);
    await seedNeighborAppointment({ date, startTime: '9:00' });
    await db.update(schema.salonSchema)
      .set({ settings: {} })
      .where(eq(schema.salonSchema.id, SALON_ID));

    const body = await queryAvailability({ date });

    expect(JSON.stringify(body)).not.toContain('smartFit');
    expect(body.visibleSlots.length).toBeGreaterThan(0);

    for (const slot of body.slots) {
      expect(Object.keys(slot).sort()).toEqual(['availability', 'startTime', 'time']);
    }
  });
});

describe('availability × Smart Fit — qualifying slots are annotated', () => {
  // Matrix 3 (fits after a neighbor) + Matrix 5 (loose slots stay regular).
  it('annotates only the tightest slot after a real appointment', async () => {
    const date = futureDate(5);
    // Blocked 9:00–10:10 (60 visible + 10 buffer); tightest grid fit is 10:15.
    await seedNeighborAppointment({ date, startTime: '9:00' });

    const body = await queryAvailability({ date, technicianId: TECH_1 });

    expect(annotatedTimes(body)).toEqual(['10:15']);
    expect(slotByTime(body, '10:15').smartFit).toEqual({
      eligible: true,
      discountType: 'percent',
      discountValue: 10,
      discountAmountCents: 650,
      originalPriceCents: 6500,
      discountedPriceCents: 5850,
      qualifyingSides: ['before'],
      improvementMinutes: expect.any(Number),
      consolidatedMinutes: expect.any(Number),
    });
    expect(slotByTime(body, '10:30').smartFit).toBeUndefined();
    expect(body.bookedSlots).toContain('9:00');
  });

  // With 'any' technician a slot blocked for one technician can still be free
  // (and unannotated) through another whose day has no adjacency.
  it('only annotates when an AVAILABLE technician qualifies in any-tech mode', async () => {
    const date = futureDate(26);
    await seedNeighborAppointment({ date, startTime: '9:00', technicianId: TECH_1 });

    const body = await queryAvailability({ date });

    // TECH_1 qualifies at 10:15; TECH_2 keeps 9:00 available without annotation.
    expect(annotatedTimes(body)).toEqual(['10:15']);
    expect(body.bookedSlots).not.toContain('9:00');
    expect(slotByTime(body, '9:00').smartFit).toBeUndefined();
  });

  // Matrix 2 (fits before a neighbor) + Matrix 7 (candidate buffer included).
  it('annotates the tightest slot before a later appointment and blocks the buffered overlap', async () => {
    const date = futureDate(6);
    await seedNeighborAppointment({ date, startTime: '13:00' });

    const body = await queryAvailability({ date, technicianId: TECH_1 });

    // Blocked candidate window is 70 min → floor(13:00 − 70min) = 11:45 (gap 5)
    // before the neighbor; 14:15 is the tight fit after its blocked end 14:10.
    expect(annotatedTimes(body)).toEqual(['11:45', '14:15']);
    expect(slotByTime(body, '11:45').smartFit.qualifyingSides).toEqual(['after']);
    expect(slotByTime(body, '14:15').smartFit.qualifyingSides).toEqual(['before']);
    // 12:00 + 70 min blocked = 13:10 overlaps the neighbor: unavailable, not annotated.
    expect(body.bookedSlots).toContain('12:00');
  });

  // Matrix 4: a between fit with both sides tight.
  it('annotates a between slot with both qualifying sides', async () => {
    const date = futureDate(7);
    // A: blocked 9:00–10:05 (55 visible + 10 buffer). B starts 11:35.
    await seedNeighborAppointment({ date, startTime: '9:00', visibleMinutes: 55 });
    await seedNeighborAppointment({ date, startTime: '11:35' });

    const body = await queryAvailability({ date, technicianId: TECH_1 });

    // 10:15 leaves gap 10 before (10:05) and gap 10 after (11:25 → 11:35);
    // slack = 20 = minImprovementMinutes. 12:45 is the tight fit after B's
    // blocked end.
    expect(annotatedTimes(body)).toEqual(['10:15', '12:45']);
    expect(slotByTime(body, '10:15').smartFit.qualifyingSides).toEqual(['before', 'after']);
    expect(slotByTime(body, '12:45').smartFit.qualifyingSides).toEqual(['before']);
  });

  // Matrix 5 + Matrix 11: an open day and boundary-tight fits never qualify.
  it('annotates nothing on an open day (working-window boundaries are not neighbors)', async () => {
    const date = futureDate(8);

    const body = await queryAvailability({ date });

    expect(body.visibleSlots.length).toBeGreaterThan(0);
    expect(annotatedTimes(body)).toEqual([]);
    expect(slotByTime(body, '9:00').smartFit).toBeUndefined();
  });

  // Matrix 6: add-on duration and price flow into the annotation.
  it('includes add-ons in the evaluated duration and the discounted price', async () => {
    const date = futureDate(9);
    await seedNeighborAppointment({ date, startTime: '9:00' });

    const body = await queryAvailability({
      date,
      selectedAddOns: JSON.stringify([{ addOnId: ADD_ON_ID }]),
    });

    // 90 visible + 10 buffer still fits tightest at 10:15; price includes the add-on.
    const annotated = slotByTime(body, '10:15');

    expect(annotated.smartFit.originalPriceCents).toBe(8500);
    expect(annotated.smartFit.discountAmountCents).toBe(850);
    expect(annotated.smartFit.discountedPriceCents).toBe(7650);
  });

  // Matrix 8: breaks are qualifying neighbors.
  it('annotates the tightest slot before a technician break', async () => {
    const date = futureDate(10);
    await db.insert(schema.technicianBlockedSlotSchema).values({
      id: 'blocked_sf_lunch',
      technicianId: TECH_1,
      salonId: SALON_ID,
      dayOfWeek: null,
      startTime: '12:00',
      endTime: '13:00',
      specificDate: at(date, '12:00'),
      isRecurring: false,
      label: 'Lunch',
    });

    const body = await queryAvailability({ date, technicianId: TECH_1 });

    try {
      // floor(12:00 − 70min) = 10:45, gap 5 against the break; 13:00 is the
      // zero-gap fit right after the break ends.
      expect(annotatedTimes(body)).toEqual(['10:45', '13:00']);
      expect(slotByTime(body, '10:45').smartFit.qualifyingSides).toEqual(['after']);
      expect(slotByTime(body, '13:00').smartFit.qualifyingSides).toEqual(['before']);
    } finally {
      await db.delete(schema.technicianBlockedSlotSchema)
        .where(eq(schema.technicianBlockedSlotSchema.id, 'blocked_sf_lunch'));
    }
  });

  // Matrix 9: time off removes the technician (and any annotation) entirely.
  it('produces no slots and no annotations for a technician on time off', async () => {
    const date = futureDate(11);
    await seedNeighborAppointment({ date, startTime: '9:00' });
    await db.insert(schema.technicianTimeOffSchema).values({
      id: 'timeoff_sf_1',
      technicianId: TECH_1,
      salonId: SALON_ID,
      startDate: at(date, '0:00'),
      endDate: at(date, '23:00'),
    });

    const body = await queryAvailability({ date, technicianId: TECH_1 });

    try {
      expect(body.visibleSlots).toEqual([]);
      expect(JSON.stringify(body)).not.toContain('smartFit');
    } finally {
      await db.delete(schema.technicianTimeOffSchema)
        .where(eq(schema.technicianTimeOffSchema.id, 'timeoff_sf_1'));
    }
  });

  // Matrix 10: Google busy shrinks the free span but never creates adjacency.
  it('lets Google busy kill the improvement but never qualify a slot by itself', async () => {
    const date = futureDate(12);
    await seedNeighborAppointment({ date, startTime: '9:00' });
    // Shrinks the span after the tight fit to 85 min → slack 15 < 20.
    holder.googleBusy = [{ startTime: at(date, '11:35'), endTime: at(date, '17:00') }];

    const shrunk = await queryAvailability({ date, technicianId: TECH_1 });

    expect(annotatedTimes(shrunk)).toEqual([]);

    // Google-only adjacency: busy 9:00–10:10 with no real appointment.
    const googleOnlyDate = futureDate(13);
    holder.googleBusy = [
      { startTime: at(googleOnlyDate, '9:00'), endTime: at(googleOnlyDate, '10:10') },
    ];

    const googleOnly = await queryAvailability({ date: googleOnlyDate, technicianId: TECH_1 });

    expect(annotatedTimes(googleOnly)).toEqual([]);
  });

  // Matrix 12: minimum notice — nothing inside the lead window is offered at all.
  it('never returns (or annotates) slots inside the 120-minute lead window', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
    const body = await queryAvailability({ date: today });

    const leadBoundaryMs = Date.now() + 120 * 60_000 - 60_000; // 1 min tolerance
    for (const slot of body.slots) {
      expect(new Date(slot.startTime).getTime()).toBeGreaterThan(leadBoundaryMs);
    }
  });

  // Matrix 13: another technician's neighbor creates no eligibility.
  it('does not annotate a technician whose own day has no adjacent block', async () => {
    const date = futureDate(14);
    await seedNeighborAppointment({ date, startTime: '9:00', technicianId: TECH_1 });

    const tech2Body = await queryAvailability({ date, technicianId: TECH_2 });

    expect(annotatedTimes(tech2Body)).toEqual([]);

    const tech1Body = await queryAvailability({ date, technicianId: TECH_1 });

    expect(annotatedTimes(tech1Body)).toEqual(['10:15']);
  });

  // Matrix 14: location hours reshape the working window and the annotation.
  it('respects location business hours when evaluating tight fits', async () => {
    const date = futureDate(15);
    await seedNeighborAppointment({ date, startTime: '9:00' });

    const mainBody = await queryAvailability({ date, locationId: LOC_MAIN });

    expect(annotatedTimes(mainBody)).toEqual(['10:15']);

    // The late location opens at 13:00: the 10:15 fit is outside its hours and
    // the 9:00 neighbor sits outside the working window — nothing qualifies.
    const lateBody = await queryAvailability({ date, locationId: LOC_LATE });

    expect(annotatedTimes(lateBody)).toEqual([]);
  });

  // Matrix 41 (tenant isolation): another salon's schedule never leaks in.
  it('ignores appointments belonging to a different salon', async () => {
    const date = futureDate(16);
    await seedNeighborAppointment({
      date,
      startTime: '9:00',
      salonId: OTHER_SALON_ID,
      technicianId: OTHER_TECH,
      salonClientId: 'sc_foreign',
      clientPhone: '4165550888',
    });

    const body = await queryAvailability({ date });

    expect(annotatedTimes(body)).toEqual([]);
  });
});

describe('availability × Smart Fit — reschedules and privacy', () => {
  // Matrix 15: self-neighbor exclusion using server-derived identity.
  it('excludes the rescheduling client\'s own appointments from adjacency', async () => {
    const date = futureDate(17);
    // The client's own second appointment forms the only adjacency.
    await seedNeighborAppointment({
      date,
      startTime: '9:00',
      salonClientId: 'sc_self',
      clientPhone: '4165550111',
    });
    // The appointment being rescheduled (excluded from blocks entirely).
    const originalId = await seedNeighborAppointment({
      date,
      startTime: '14:00',
      salonClientId: 'sc_self',
      clientPhone: '4165550111',
    });

    const selfBody = await queryAvailability({ date, originalAppointmentId: originalId });

    // 10:15 is tight against the client's own appointment → no discount.
    expect(annotatedTimes(selfBody)).toEqual([]);
    // The original's old window is bookable again (excluded from conflicts).
    expect(selfBody.bookedSlots).not.toContain('14:00');

    // Control: a different client's neighbor still qualifies during reschedule.
    const controlDate = futureDate(18);
    await seedNeighborAppointment({
      date: controlDate,
      startTime: '9:00',
      salonClientId: 'sc_neighbor',
      clientPhone: '4165550999',
    });
    const controlOriginal = await seedNeighborAppointment({
      date: controlDate,
      startTime: '14:00',
      salonClientId: 'sc_self',
      clientPhone: '4165550111',
    });

    const controlBody = await queryAvailability({
      date: controlDate,
      originalAppointmentId: controlOriginal,
    });

    expect(annotatedTimes(controlBody)).toContain('10:15');
  });

  // Matrix 16: no private neighbor data in the response.
  it('never exposes neighbor identities, ids, or evaluator internals', async () => {
    const date = futureDate(19);
    const neighborId = await seedNeighborAppointment({ date, startTime: '9:00' });

    const body = await queryAvailability({ date });
    const serialized = JSON.stringify(body);

    expect(annotatedTimes(body)).toEqual(['10:15']);
    expect(serialized).not.toContain(neighborId);
    expect(serialized).not.toContain('4165550999');
    expect(serialized).not.toContain('Neighbor Client');
    expect(serialized).not.toContain('client:');
    expect(serialized).not.toContain('phone:');
    expect(serialized).not.toContain('neighbor');
    expect(serialized).not.toContain('reason');
  });
});
