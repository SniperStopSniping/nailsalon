/**
 * Regression coverage for the Luster Manicure price-mismatch incident:
 * `price` (cents) is the only bookable price; `priceDisplayText` and the
 * intro badge are display-only and must never change what a booking charges.
 * Proves the full owner-edit → customer-charge path: admin PATCH persists the
 * numeric price, and the booking POST + time/confirm resolver charge the
 * salon's saved service price — never the template default, never a display
 * string.
 */
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
  clientSession: null as null | {
    normalizedPhone: string;
    phoneVariants: string[];
  },
  // Set only while calling the admin PATCH handler; booking POSTs stay public.
  adminSalon: null as null | { id: string; slug: string },
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
  requireAdminSalon: vi.fn(async () => {
    if (holder.adminSalon) {
      return { salon: holder.adminSalon, error: null };
    }
    return { salon: null, error: new Response(null, { status: 401 }) };
  }),
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
        sessionId: 'client_session_lp',
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
import { resolvePublicBookingSelection } from '@/libs/publicBookingSelection';

import { PATCH } from '../salon/services/[id]/route';
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_luster_price';
const SALON_SLUG = 'luster-price-salon';
const TECH_ID = 'tech_lp_1';
const LUSTER_SERVICE_ID = 'srv_lp_luster';
const STALE_SERVICE_ID = 'srv_lp_stale';
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

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let counter = 0;

function futureDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

/** Fresh phone per test so the one-active-appointment rule never interferes. */
function freshPhone(): string {
  counter += 1;
  return `416777${String(1000 + counter).padStart(4, '0')}`;
}

function signInFreshClient(): void {
  const phone = freshPhone();
  holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };
}

async function postBooking(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      salonSlug: SALON_SLUG,
      technicianId: TECH_ID,
      ...body,
    }),
  }));
}

async function getAppointmentRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, id));
  return row;
}

async function getAppointmentServiceRows(appointmentId: string) {
  return db
    .select()
    .from(schema.appointmentServicesSchema)
    .where(eq(schema.appointmentServicesSchema.appointmentId, appointmentId));
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Luster Price Salon', slug: SALON_SLUG, settings: {} },
  ]);

  await db.insert(schema.technicianSchema).values([
    { id: TECH_ID, salonId: SALON_ID, name: 'Isla', weeklySchedule: FULL_WEEK },
  ]);

  await db.insert(schema.serviceSchema).values([
    {
      // The corrected production shape: numeric price is the price, badge is
      // a label, no display-text override.
      id: LUSTER_SERVICE_ID,
      salonId: SALON_ID,
      name: 'Luster Manicure',
      category: 'manicure',
      price: 5500,
      priceDisplayText: null,
      isIntroPrice: true,
      introPriceLabel: 'Intro price',
      durationMinutes: 60,
      templateKey: 'luster_manicure',
    },
    {
      // The broken production shape that caused the incident: stale $45
      // price behind a "$75+" display override and a "$55" badge.
      id: STALE_SERVICE_ID,
      salonId: SALON_ID,
      name: 'Stale Display Service',
      category: 'manicure',
      price: 4500,
      priceDisplayText: '$75+',
      isIntroPrice: true,
      introPriceLabel: '$55',
      durationMinutes: 60,
    },
  ]);

  await db.insert(schema.technicianServicesSchema).values([
    { technicianId: TECH_ID, serviceId: LUSTER_SERVICE_ID, enabled: true },
    { technicianId: TECH_ID, serviceId: STALE_SERVICE_ID, enabled: true },
  ]);
}, 60_000);

beforeEach(() => {
  holder.clientSession = null;
  holder.adminSalon = null;
});

afterAll(async () => {
  await client.close();
});

describe('Luster Manicure price — every booking surface derives the same current price', () => {
  it('resolves the selection (time/confirm pages) from the saved numeric price', async () => {
    const resolved = await resolvePublicBookingSelection({
      salonId: SALON_ID,
      baseServiceId: LUSTER_SERVICE_ID,
      technicianId: TECH_ID,
    });

    expect(resolved.services[0]).toMatchObject({
      id: LUSTER_SERVICE_ID,
      priceCents: 5500,
      priceDisplayText: null,
      resolvedIntroPriceLabel: 'Intro price',
    });
    expect(resolved.subtotalBeforeDiscountCents).toBe(5500);
    expect(resolved.discountAmountCents).toBe(0);
    expect(resolved.totalPriceCents).toBe(5500);
  });

  it('books at $55 and snapshots 5500 into the appointment (checkout charges the snapshot)', async () => {
    signInFreshClient();

    const response = await postBooking({
      baseServiceId: LUSTER_SERVICE_ID,
      startTime: at(futureDate(30), '10:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const row = await getAppointmentRow(body.data.appointmentId);

    expect(row).toMatchObject({
      totalPrice: 5500,
      discountAmountCents: 0,
    });

    const serviceRows = await getAppointmentServiceRows(body.data.appointmentId);

    expect(serviceRows).toHaveLength(1);
    // The checkout route charges priceCentsSnapshot ?? priceAtBooking — these
    // are the exact fields it reads.
    expect(serviceRows[0]).toMatchObject({
      serviceId: LUSTER_SERVICE_ID,
      priceAtBooking: 5500,
      priceCentsSnapshot: 5500,
      priceDisplayTextSnapshot: null,
      resolvedIntroPriceLabelSnapshot: 'Intro price',
    });
  });

  it('charges the numeric price, never the display text or badge (incident shape)', async () => {
    signInFreshClient();

    const response = await postBooking({
      baseServiceId: STALE_SERVICE_ID,
      startTime: at(futureDate(31), '10:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const row = await getAppointmentRow(body.data.appointmentId);

    // Display strings ("$75+", "$55") never affect the charge — this is why
    // the incident record booked at $45 until the numeric price was fixed.
    expect(row?.totalPrice).toBe(4500);

    const serviceRows = await getAppointmentServiceRows(body.data.appointmentId);

    expect(serviceRows[0]).toMatchObject({
      priceAtBooking: 4500,
      priceCentsSnapshot: 4500,
      priceDisplayTextSnapshot: '$75+',
      resolvedIntroPriceLabelSnapshot: '$55',
    });
  });

  it('admin PATCH repair persists price 5500 + cleared display text, and new bookings charge it', async () => {
    // Exactly the admin-UI correction: Price 55, display text cleared,
    // badge relabeled "Intro price".
    holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
    const patchResponse = await PATCH(
      new Request(`http://localhost/api/salon/services/${STALE_SERVICE_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: SALON_SLUG,
          name: 'Stale Display Service',
          description: null,
          descriptionItems: [],
          price: 5500,
          priceDisplayText: '',
          durationMinutes: 60,
          category: 'manicure',
          isIntroPrice: true,
          introPriceLabel: 'Intro price',
          isActive: true,
        }),
      }),
      { params: { id: STALE_SERVICE_ID } },
    );
    holder.adminSalon = null;

    expect(patchResponse.status).toBe(200);

    const [saved] = await db
      .select()
      .from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.id, STALE_SERVICE_ID));

    expect(saved).toMatchObject({
      price: 5500,
      priceDisplayText: null,
      isIntroPrice: true,
      introPriceLabel: 'Intro price',
    });

    // The owner's saved price — not the seeded value — is what the customer
    // flow resolves and the booking POST charges.
    const resolved = await resolvePublicBookingSelection({
      salonId: SALON_ID,
      baseServiceId: STALE_SERVICE_ID,
      technicianId: TECH_ID,
    });

    expect(resolved.totalPriceCents).toBe(5500);

    signInFreshClient();
    const response = await postBooking({
      baseServiceId: STALE_SERVICE_ID,
      startTime: at(futureDate(32), '10:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const serviceRows = await getAppointmentServiceRows(body.data.appointmentId);

    expect(serviceRows[0]).toMatchObject({
      priceAtBooking: 5500,
      priceCentsSnapshot: 5500,
      priceDisplayTextSnapshot: null,
      resolvedIntroPriceLabelSnapshot: 'Intro price',
    });
  });

  it('leaves historical bookings untouched by later price edits', async () => {
    signInFreshClient();
    const response = await postBooking({
      baseServiceId: LUSTER_SERVICE_ID,
      startTime: at(futureDate(33), '10:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    await db
      .update(schema.serviceSchema)
      .set({ price: 6000 })
      .where(eq(schema.serviceSchema.id, LUSTER_SERVICE_ID));

    const serviceRows = await getAppointmentServiceRows(body.data.appointmentId);

    expect(serviceRows[0]?.priceAtBooking).toBe(5500);
    expect(serviceRows[0]?.priceCentsSnapshot).toBe(5500);

    await db
      .update(schema.serviceSchema)
      .set({ price: 5500 })
      .where(eq(schema.serviceSchema.id, LUSTER_SERVICE_ID));
  });
});
