/**
 * PR 1 stage (e), route level: enforcement must not cost us the telemetry that
 * justifies it.
 *
 * The observation write (required_add_on_rule_omitted) sits AFTER a successful
 * validatePublicBookingSelection, so the moment enforcement starts throwing,
 * a blocked attempt would stop being recorded — a rollout that loses its own
 * measurement exactly when it starts mattering. This proves both halves are
 * live at once:
 *
 *  - gate OFF (every salon today): the booking is created, and the gap is
 *    still recorded as required_add_on_rule_omitted;
 *  - gate ON: the booking is refused 400 with the public required-add-on
 *    message, no appointment row is written, and the attempt is recorded as
 *    required_add_on_booking_blocked (a distinct action, so "would have
 *    blocked" and "did block" are never the same number).
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { zonedTimeToUtc } from '@/libs/timeZone';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  clientSession: null as null | {
    normalizedPhone: string;
    phoneVariants: string[];
  },
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/core/redis/redisClient', () => ({
  isRedisAvailable: vi.fn(async () => false),
  redis: null,
}));

vi.mock('@/libs/staffAuth', () => ({
  requireStaffSession: vi.fn(async () => ({
    ok: false,
    response: new Response(null, { status: 401 }),
  })),
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async () => ({
    ok: false,
    response: new Response(null, { status: 401 }),
  })),
  requireAdminSalon: vi.fn(async () => ({ salon: null, error: new Response(null, { status: 401 }) })),
}));

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession: vi.fn(async () => {
    if (!holder.clientSession) {
      return { ok: false, response: new Response(null, { status: 401 }) };
    }
    return {
      ok: true,
      normalizedPhone: holder.clientSession.normalizedPhone,
      phoneVariants: holder.clientSession.phoneVariants,
      session: {
        phone: `+1${holder.clientSession.normalizedPhone}`,
        clientName: 'Session Client',
        sessionId: 'client_session_rae',
      },
    };
  }),
}));

vi.mock('@/libs/salonStatus', () => ({
  guardSalonApiRoute: vi.fn(async () => null),
  guardFeatureEntitlement: vi.fn(async () => null),
}));

vi.mock('@/libs/googleCalendar', () => ({
  getGoogleCalendarBusyWindows: vi.fn(async () => []),
  hasGoogleCalendarConflict: vi.fn(async () => false),
  isBusyWindowConflict: () => false,
  GoogleCalendarAvailabilityError: class GoogleCalendarAvailabilityError extends Error {
    constructor(public readonly reconnectRequired: boolean) {
      super('google_unavailable');
    }
  },
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarUpsert: vi.fn(async () => {}),
  enqueueGoogleCalendarDelete: vi.fn(async () => {}),
}));

vi.mock('@/libs/googleEventReview', () => ({
  recordGoogleEventReviewDecision: vi.fn(async () => {}),
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForNewBooking: vi.fn(async () => {}),
}));

vi.mock('@/libs/customerBookingEmail', () => ({
  sendCustomerBookingConfirmationEmail: vi.fn(async () => ({ delivered: false })),
}));

vi.mock('@/libs/SMS', () => ({
  sendBookingConfirmationToClient: vi.fn(async () => ({ success: true })),
  sendRescheduleConfirmation: vi.fn(async () => ({ success: true })),
  sendCancellationNotificationToTech: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/libs/publicUrl', () => ({
  buildSalonTenantPublicUrl: vi.fn(() => 'http://localhost:3101/manage/token'),
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const TIME_ZONE = 'America/Toronto';

const OFF_SALON_ID = 'salon_rae_off';
const OFF_SALON_SLUG = 'rae-off-salon';
const ON_SALON_ID = 'salon_rae_on';
const ON_SALON_SLUG = 'rae-on-salon';

const FULL_WEEK = {
  sunday: { start: '9:00', end: '17:00' },
  monday: { start: '9:00', end: '17:00' },
  tuesday: { start: '9:00', end: '17:00' },
  wednesday: { start: '9:00', end: '17:00' },
  thursday: { start: '9:00', end: '17:00' },
  friday: { start: '9:00', end: '17:00' },
  saturday: { start: '9:00', end: '17:00' },
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let counter = 0;

const techId = (salonId: string) => `tech_rae_${salonId}`;
const serviceId = (salonId: string) => `srv_rae_gelx_${salonId}`;
const requiredAddOnId = (salonId: string) => `addon_rae_removal_${salonId}`;

function futureDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

/** Fresh phone per test so the one-active-appointment rule never interferes. */
function signInFreshClient(): void {
  counter += 1;
  const phone = `416778${String(1000 + counter).padStart(4, '0')}`;
  holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };
}

async function postBooking(salonSlug: string, salonId: string, offsetDays: number): Promise<Response> {
  return POST(new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      salonSlug,
      technicianId: techId(salonId),
      // Deliberately omits the required add-on.
      baseServiceId: serviceId(salonId),
      selectedAddOns: [],
      startTime: at(futureDate(offsetDays), '10:00').toISOString(),
    }),
  }));
}

async function auditRows(salonId: string, action: string) {
  return db
    .select()
    .from(schema.auditLogSchema)
    .where(and(eq(schema.auditLogSchema.salonId, salonId), eq(schema.auditLogSchema.action, action)));
}

async function seedSalon(salonId: string, slug: string, enforce: boolean) {
  await db.insert(schema.salonSchema).values({
    id: salonId,
    name: slug,
    slug,
    // The OFF salon has no `enforceRequiredAddOns` key at all — the shape of
    // every salon in the database on the day this ships.
    settings: enforce ? { booking: { enforceRequiredAddOns: true } } : { booking: {} },
  });
  await db.insert(schema.technicianSchema).values({
    id: techId(salonId),
    salonId,
    name: 'Isla',
    weeklySchedule: FULL_WEEK,
  });
  await db.insert(schema.serviceSchema).values({
    id: serviceId(salonId),
    salonId,
    name: 'Gel-X New Set',
    category: 'extensions',
    price: 9000,
    durationMinutes: 60,
  });
  await db.insert(schema.addOnSchema).values({
    id: requiredAddOnId(salonId),
    salonId,
    name: 'Removal',
    slug: 'removal',
    category: 'removal',
    priceCents: 1500,
    durationMinutes: 20,
  });
  await db.insert(schema.serviceAddOnSchema).values({
    id: `svcaddon_rae_${salonId}`,
    salonId,
    serviceId: serviceId(salonId),
    addOnId: requiredAddOnId(salonId),
    selectionMode: 'required',
    displayOrder: 0,
  });
  await db.insert(schema.technicianServicesSchema).values({
    technicianId: techId(salonId),
    serviceId: serviceId(salonId),
    enabled: true,
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await seedSalon(OFF_SALON_ID, OFF_SALON_SLUG, false);
  await seedSalon(ON_SALON_ID, ON_SALON_SLUG, true);
}, 60_000);

beforeEach(() => {
  holder.clientSession = null;
});

afterAll(async () => {
  await client.close();
});

describe('POST /api/appointments — required add-on gap stays measurable on both sides of the gate', () => {
  it('gate OFF: books anyway and records required_add_on_rule_omitted', async () => {
    signInFreshClient();

    const response = await postBooking(OFF_SALON_SLUG, OFF_SALON_ID, 30);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.appointmentId).toBeTruthy();

    const observed = await auditRows(OFF_SALON_ID, 'required_add_on_rule_omitted');

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      actorType: 'client',
      entityType: 'service',
      entityId: serviceId(OFF_SALON_ID),
    });
    expect((observed[0]?.metadata as { missingRequiredAddOnIds?: string[] })?.missingRequiredAddOnIds)
      .toEqual([requiredAddOnId(OFF_SALON_ID)]);

    // The enforcement action belongs to the other salon only.
    await expect(auditRows(OFF_SALON_ID, 'required_add_on_booking_blocked')).resolves.toHaveLength(0);
  });

  it('gate ON: refuses the booking, writes no appointment, and records required_add_on_booking_blocked', async () => {
    signInFreshClient();

    const response = await postBooking(ON_SALON_SLUG, ON_SALON_ID, 31);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_SELECTION');
    expect(body.error.message).toContain('requires an additional add-on');

    const appointments = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.salonId, ON_SALON_ID));

    expect(appointments).toHaveLength(0);

    const blocked = await auditRows(ON_SALON_ID, 'required_add_on_booking_blocked');

    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({
      actorType: 'client',
      entityType: 'service',
      entityId: serviceId(ON_SALON_ID),
    });
    expect((blocked[0]?.metadata as { missingRequiredAddOnIds?: string[] })?.missingRequiredAddOnIds)
      .toEqual([requiredAddOnId(ON_SALON_ID)]);

    // Distinct from the observation action: a blocked attempt must never be
    // counted as a tolerated one.
    await expect(auditRows(ON_SALON_ID, 'required_add_on_rule_omitted')).resolves.toHaveLength(0);
  });

  it('gate ON: books normally once the required add-on is selected', async () => {
    signInFreshClient();

    const response = await POST(new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: ON_SALON_SLUG,
        technicianId: techId(ON_SALON_ID),
        baseServiceId: serviceId(ON_SALON_ID),
        selectedAddOns: [{ addOnId: requiredAddOnId(ON_SALON_ID), quantity: 1 }],
        startTime: at(futureDate(32), '10:00').toISOString(),
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.appointmentId).toBeTruthy();

    // Still exactly the one blocked attempt from the previous test — a
    // satisfied selection adds no rollout noise either way.
    await expect(auditRows(ON_SALON_ID, 'required_add_on_booking_blocked')).resolves.toHaveLength(1);
    await expect(auditRows(ON_SALON_ID, 'required_add_on_rule_omitted')).resolves.toHaveLength(0);
  });
});
