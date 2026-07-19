import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashRetentionCampaignToken } from '@/libs/retentionCampaigns';
import { zonedTimeToUtc } from '@/libs/timeZone';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  googleBusy: [] as Array<{ startTime: Date; endTime: Date }>,
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
  requireAdminSalon: vi.fn(async () => ({
    ok: false,
    response: new Response(null, { status: 401 }),
  })),
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
        sessionId: 'client_session_sf',
      },
    };
  }),
}));

vi.mock('@/libs/salonStatus', () => ({
  guardSalonApiRoute: vi.fn(async () => null),
  guardFeatureEntitlement: vi.fn(async () => null),
}));

vi.mock('@/libs/googleCalendar', () => ({
  getGoogleCalendarBusyWindows: vi.fn(async () => holder.googleBusy),
  hasGoogleCalendarConflict: vi.fn(async (args: { startTime: Date; endTime: Date }) =>
    holder.googleBusy.some(window =>
      args.startTime < window.endTime && args.endTime > window.startTime,
    )),
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

const SALON_ID = 'salon_sf_post';
const SALON_SLUG = 'smartfit-post-salon';
const OTHER_SALON_ID = 'salon_sf_post_other';
const TECH_1 = 'tech_sfp_1';
const TECH_2 = 'tech_sfp_2';
const OTHER_TECH = 'tech_sfp_foreign';
const SERVICE_ID = 'srv_sfp_biab'; // 60 min, $65.00
const TIME_ZONE = 'America/Toronto';
const STALE_MESSAGE = 'This discounted time is no longer available. Please choose from the latest times.';

const FULL_WEEK = {
  sunday: { start: '9:00', end: '17:00' },
  monday: { start: '9:00', end: '17:00' },
  tuesday: { start: '9:00', end: '17:00' },
  wednesday: { start: '9:00', end: '17:00' },
  thursday: { start: '9:00', end: '17:00' },
  friday: { start: '9:00', end: '17:00' },
  saturday: { start: '9:00', end: '17:00' },
};

const SMART_FIT_ON = {
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
let counter = 0;

function futureDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

/** Fresh phone per test so the one-active-appointment rule never interferes. */
function freshPhone(): string {
  counter += 1;
  return `416555${String(1000 + counter).padStart(4, '0')}`;
}

async function seedSalonClient(phone: string): Promise<string> {
  const id = `sc_sfp_${phone}`;
  await db.insert(schema.salonClientSchema).values({
    id,
    salonId: SALON_ID,
    phone,
    fullName: 'Test Client',
  });
  return id;
}

async function seedAppointment(args: {
  date: string;
  startTime: string;
  visibleMinutes?: number;
  bufferMinutes?: number;
  technicianId?: string;
  salonId?: string;
  salonClientId?: string | null;
  clientPhone?: string;
  status?: string;
  discountType?: string | null;
  discountAmountCents?: number;
}): Promise<string> {
  counter += 1;
  const id = `appt_sfp_${counter}`;
  const visibleMinutes = args.visibleMinutes ?? 60;
  const bufferMinutes = args.bufferMinutes ?? 10;
  const startTime = at(args.date, args.startTime);
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: args.salonId ?? SALON_ID,
    technicianId: args.technicianId ?? TECH_1,
    clientPhone: args.clientPhone ?? '4165550999',
    clientName: 'Seeded Client',
    salonClientId: args.salonClientId === undefined ? 'sc_sfp_neighbor' : args.salonClientId,
    startTime,
    endTime: new Date(startTime.getTime() + visibleMinutes * 60_000),
    status: args.status ?? 'confirmed',
    totalPrice: 6500,
    totalDurationMinutes: visibleMinutes,
    bufferMinutes,
    blockedDurationMinutes: visibleMinutes + bufferMinutes,
    discountType: args.discountType ?? null,
    discountAmountCents: args.discountAmountCents ?? 0,
  });
  return id;
}

async function postBooking(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      salonSlug: SALON_SLUG,
      baseServiceId: SERVICE_ID,
      technicianId: TECH_1,
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

async function getAuditRows(appointmentId: string) {
  return db
    .select()
    .from(schema.appointmentAuditLogSchema)
    .where(and(
      eq(schema.appointmentAuditLogSchema.appointmentId, appointmentId),
      eq(schema.appointmentAuditLogSchema.action, 'discount_applied'),
    ));
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Smart Fit POST Salon', slug: SALON_SLUG, settings: SMART_FIT_ON },
    { id: OTHER_SALON_ID, name: 'Foreign Salon', slug: 'smartfit-post-foreign', settings: SMART_FIT_ON },
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
  ]);

  await db.insert(schema.technicianServicesSchema).values([
    { technicianId: TECH_1, serviceId: SERVICE_ID, enabled: true },
    { technicianId: TECH_2, serviceId: SERVICE_ID, enabled: true },
  ]);

  await db.insert(schema.salonClientSchema).values([
    { id: 'sc_sfp_neighbor', salonId: SALON_ID, phone: '4165550999', fullName: 'Neighbor' },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.googleBusy = [];
  holder.clientSession = null;
  await db.update(schema.salonSchema)
    .set({ settings: SMART_FIT_ON })
    .where(eq(schema.salonSchema.id, SALON_ID));
});

afterAll(async () => {
  await client.close();
});

describe('booking POST × Smart Fit — grant and persistence', () => {
  // Matrix 25 + 30: eligible slot books with a full, single smart_fit snapshot.
  it('books a qualifying slot with the smart_fit snapshot and one audit row', async () => {
    const date = futureDate(30);
    await seedAppointment({ date, startTime: '9:00' });
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const row = await getAppointmentRow(body.data.appointmentId);

    expect(row).toMatchObject({
      discountType: 'smart_fit',
      discountLabel: 'Smart Fit Discount',
      discountAmountCents: 650,
      discountPercent: 10,
      subtotalBeforeDiscountCents: 6500,
      totalPrice: 5850,
      technicianId: TECH_1,
    });
    expect(row!.discountAppliedAt).not.toBeNull();
    // Discount applied exactly once: totalPrice is subtotal minus the single discount.
    expect(row!.subtotalBeforeDiscountCents! - row!.discountAmountCents!).toBe(row!.totalPrice);

    const auditRows = await getAuditRows(body.data.appointmentId);

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      performedBy: 'system',
      performedByRole: 'system',
    });
    expect(auditRows[0]!.newValue).toMatchObject({
      type: 'smart_fit',
      discountType: 'percent',
      value: 10,
      discountAmountCents: 650,
      technicianId: TECH_1,
    });
  });

  // Matrix 5 analogue at the write boundary: a loose slot gets no discount.
  it('books a non-qualifying slot at full price with no audit row', async () => {
    const date = futureDate(31);
    await seedAppointment({ date, startTime: '9:00' });
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '13:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const row = await getAppointmentRow(body.data.appointmentId);

    expect(row).toMatchObject({
      discountType: null,
      discountAmountCents: 0,
      totalPrice: 6500,
    });
    expect(await getAuditRows(body.data.appointmentId)).toHaveLength(0);
  });

  // Matrix 43: Smart Fit off leaves the booking write untouched.
  it('keeps the legacy write path when Smart Fit is disabled', async () => {
    const date = futureDate(32);
    await seedAppointment({ date, startTime: '9:00' });
    await db.update(schema.salonSchema)
      .set({ settings: {} })
      .where(eq(schema.salonSchema.id, SALON_ID));
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const row = await getAppointmentRow(body.data.appointmentId);

    expect(row).toMatchObject({
      discountType: null,
      discountAmountCents: 0,
      totalPrice: 6500,
    });
    expect(await getAuditRows(body.data.appointmentId)).toHaveLength(0);
  });

  // 'any' technician: the pick prefers the technician for whom the slot is a
  // qualifying tight fit (approved P6 packing rule).
  it('assigns the qualifying technician in any-technician mode', async () => {
    const date = futureDate(33);
    // Only TECH_2 has adjacency at 10:15; TECH_1 is free (and listed first).
    await seedAppointment({ date, startTime: '9:00', technicianId: TECH_2 });
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
      technicianId: null,
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const row = await getAppointmentRow(body.data.appointmentId);

    expect(row).toMatchObject({
      technicianId: TECH_2,
      discountType: 'smart_fit',
      discountAmountCents: 650,
      totalPrice: 5850,
    });
  });

  // Matrix 41: another salon's adjacent appointment mints nothing here.
  it('ignores adjacency belonging to a different salon', async () => {
    const date = futureDate(34);
    await seedAppointment({
      date,
      startTime: '9:00',
      salonId: OTHER_SALON_ID,
      technicianId: OTHER_TECH,
      salonClientId: null,
    });
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(await getAppointmentRow(body.data.appointmentId)).toMatchObject({
      discountType: null,
      totalPrice: 6500,
    });
  });
});

describe('booking POST × Smart Fit — precedence', () => {
  // Matrix 19: first visit beats Smart Fit.
  it('applies the first-visit discount, not smart_fit, when both would apply', async () => {
    const date = futureDate(35);
    await seedAppointment({ date, startTime: '9:00' });
    await db.update(schema.salonSchema)
      .set({
        settings: {
          ...SMART_FIT_ON,
          booking: { firstVisitDiscountEnabled: true },
        },
      })
      .where(eq(schema.salonSchema.id, SALON_ID));
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(await getAppointmentRow(body.data.appointmentId)).toMatchObject({
      discountType: 'first_visit_25',
      discountAmountCents: 1625,
      totalPrice: 4875,
    });
    expect(await getAuditRows(body.data.appointmentId)).toHaveLength(0);
  });

  // Matrix 18: an active reward beats Smart Fit.
  it('applies an active reward, not smart_fit, when both would apply', async () => {
    const date = futureDate(36);
    await seedAppointment({ date, startTime: '9:00' });
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };
    await db.insert(schema.rewardSchema).values({
      id: `reward_sfp_${phone}`,
      salonId: SALON_ID,
      clientPhone: phone,
      type: 'referral_referrer',
      discountType: 'fixed_amount',
      discountAmountCents: 500,
      status: 'active',
    });

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(await getAppointmentRow(body.data.appointmentId)).toMatchObject({
      discountType: 'reward',
      discountAmountCents: 500,
      totalPrice: 6000,
    });
    expect(await getAuditRows(body.data.appointmentId)).toHaveLength(0);
  });

  // Matrix 17: a campaign token beats Smart Fit (structural precedence).
  it('applies a retention campaign, not smart_fit, when both would apply', async () => {
    const date = futureDate(37);
    await seedAppointment({ date, startTime: '9:00' });
    const phone = freshPhone();
    const salonClientId = await seedSalonClient(phone);
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const token = 'campaign_token_smartfit_precedence_0001';
    await db.insert(schema.retentionCampaignSchema).values({
      id: `campaign_sfp_${phone}`,
      salonId: SALON_ID,
      salonClientId,
      tokenHash: hashRetentionCampaignToken(token),
      stage: 'promo_6w',
      promotionSnapshot: {
        enabled: true,
        name: 'We miss you: 20% off',
        discountType: 'percent',
        value: 20,
        eligibleServiceIds: [],
        expiryDays: 30,
        code: null,
        messageTemplate: 'Come back!',
        singleUse: true,
      },
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      singleUse: true,
    });

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
      campaignToken: token,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(await getAppointmentRow(body.data.appointmentId)).toMatchObject({
      discountType: 'retention_promo_6w',
      discountAmountCents: 1300,
      totalPrice: 5200,
    });
    expect(await getAuditRows(body.data.appointmentId)).toHaveLength(0);
  });
});

describe('booking POST × Smart Fit — stale expectations (final revalidation)', () => {
  // Matrix 26–29: the in-transaction recheck is authoritative.
  it('rejects with the approved SMART_FIT_CHANGED response when the neighbor was cancelled', async () => {
    const date = futureDate(38);
    const neighborId = await seedAppointment({ date, startTime: '9:00' });
    // Schedule changed between display and confirm: the neighbor cancelled.
    await db.update(schema.appointmentSchema)
      .set({ status: 'cancelled' })
      .where(eq(schema.appointmentSchema.id, neighborId));
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
      expectedDiscountType: 'smart_fit',
      expectedTotalCents: 5850,
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('SMART_FIT_CHANGED');
    expect(body.error.message).toBe(STALE_MESSAGE);
    expect(body.error.details).toMatchObject({
      refreshAvailability: true,
      breakdown: {
        subtotalBeforeDiscountCents: 6500,
        discountAmountCents: 0,
        discountType: null,
        finalTotalCents: 6500,
      },
    });

    // Matrix 29: the appointment was NOT silently created at full price.
    const created = await db
      .select({ id: schema.appointmentSchema.id })
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.clientPhone, phone));

    expect(created).toHaveLength(0);
  });

  // Matrix 27: a concurrent booking can invalidate a previously shown offer.
  it('rejects when a concurrent booking consumed the schedule improvement', async () => {
    const date = futureDate(39);
    await seedAppointment({ date, startTime: '9:00' });
    // Lands between availability display and confirm: shrinks the free span to
    // 10 minutes of slack (< minImprovementMinutes).
    await seedAppointment({ date, startTime: '11:30' });
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
      expectedDiscountType: 'smart_fit',
      expectedTotalCents: 5850,
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('SMART_FIT_CHANGED');
    expect(body.error.message).toBe(STALE_MESSAGE);
  });

  // Without declared expectations there is nothing to protect: the server
  // recomputes silently and books at the honest current price (approved P6).
  it('recomputes silently at the honest price when no expectations were sent', async () => {
    const date = futureDate(40);
    const neighborId = await seedAppointment({ date, startTime: '9:00' });
    await db.update(schema.appointmentSchema)
      .set({ status: 'cancelled' })
      .where(eq(schema.appointmentSchema.id, neighborId));
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(await getAppointmentRow(body.data.appointmentId)).toMatchObject({
      discountType: null,
      discountAmountCents: 0,
      totalPrice: 6500,
    });
  });

  // Matching expectations confirm at the displayed price.
  it('books at the expected price when the offer is still valid', async () => {
    const date = futureDate(41);
    await seedAppointment({ date, startTime: '9:00' });
    const phone = freshPhone();
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
      expectedDiscountType: 'smart_fit',
      expectedTotalCents: 5850,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(await getAppointmentRow(body.data.appointmentId)).toMatchObject({
      discountType: 'smart_fit',
      totalPrice: 5850,
    });
  });
});

describe('booking POST × Smart Fit — client reschedule', () => {
  // Matrix 44/45: reschedule re-qualifies at the new time.
  it('re-earns smart_fit when rescheduling into a qualifying slot', async () => {
    const date = futureDate(42);
    await seedAppointment({ date, startTime: '9:00' });
    const phone = freshPhone();
    const salonClientId = await seedSalonClient(phone);
    const originalId = await seedAppointment({
      date,
      startTime: '14:00',
      salonClientId,
      clientPhone: phone,
    });
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
      originalAppointmentId: originalId,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(await getAppointmentRow(body.data.appointmentId)).toMatchObject({
      discountType: 'smart_fit',
      discountAmountCents: 650,
      totalPrice: 5850,
    });
    expect(await getAppointmentRow(originalId)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'rescheduled',
    });
  });

  // A smart_fit original re-qualifies or DROPS — never blindly preserved.
  it('drops the discount when rescheduling a smart_fit booking to a loose slot', async () => {
    const date = futureDate(43);
    await seedAppointment({ date, startTime: '9:00' });
    const phone = freshPhone();
    const salonClientId = await seedSalonClient(phone);
    const originalId = await seedAppointment({
      date,
      startTime: '10:15',
      salonClientId,
      clientPhone: phone,
      discountType: 'smart_fit',
      discountAmountCents: 650,
    });
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '14:00').toISOString(),
      originalAppointmentId: originalId,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(await getAppointmentRow(body.data.appointmentId)).toMatchObject({
      discountType: null,
      discountAmountCents: 0,
      totalPrice: 6500,
    });
  });

  // Matrix 46: a stale reschedule is rejected and the original survives.
  it('rejects a stale reschedule and keeps the original appointment active', async () => {
    const date = futureDate(44);
    const neighborId = await seedAppointment({ date, startTime: '9:00' });
    const phone = freshPhone();
    const salonClientId = await seedSalonClient(phone);
    const originalId = await seedAppointment({
      date,
      startTime: '14:00',
      salonClientId,
      clientPhone: phone,
    });
    await db.update(schema.appointmentSchema)
      .set({ status: 'cancelled' })
      .where(eq(schema.appointmentSchema.id, neighborId));
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
      originalAppointmentId: originalId,
      expectedDiscountType: 'smart_fit',
      expectedTotalCents: 5850,
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('SMART_FIT_CHANGED');
    expect(body.error.message).toBe(STALE_MESSAGE);
    // The whole transaction rolled back — the original is still confirmed.
    expect(await getAppointmentRow(originalId)).toMatchObject({ status: 'confirmed' });
  });

  // Matrix 47: the appointment being rescheduled cannot be its own neighbor.
  it('excludes the original appointment from adjacency during reschedule', async () => {
    const date = futureDate(45);
    const phone = freshPhone();
    const salonClientId = await seedSalonClient(phone);
    // The client's own original at 9:00 is the ONLY adjacency for a 10:15 fit.
    const originalId = await seedAppointment({
      date,
      startTime: '9:00',
      salonClientId,
      clientPhone: phone,
    });
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '10:15').toISOString(),
      originalAppointmentId: originalId,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(await getAppointmentRow(body.data.appointmentId)).toMatchObject({
      discountType: null,
      discountAmountCents: 0,
      totalPrice: 6500,
    });
  });

  // Matrix 48: non-Smart-Fit rescheduling is untouched when the feature is off.
  it('keeps plain rescheduling working when Smart Fit is disabled', async () => {
    const date = futureDate(46);
    await db.update(schema.salonSchema)
      .set({ settings: {} })
      .where(eq(schema.salonSchema.id, SALON_ID));
    const phone = freshPhone();
    const salonClientId = await seedSalonClient(phone);
    const originalId = await seedAppointment({
      date,
      startTime: '14:00',
      salonClientId,
      clientPhone: phone,
    });
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone] };

    const response = await postBooking({
      startTime: at(date, '11:00').toISOString(),
      originalAppointmentId: originalId,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(await getAppointmentRow(body.data.appointmentId)).toMatchObject({
      discountType: null,
      totalPrice: 6500,
    });
    expect(await getAppointmentRow(originalId)).toMatchObject({ status: 'cancelled' });
  });

  // Matrix 42: another client cannot reschedule someone else's appointment.
  it('still rejects a reschedule for an appointment the session does not own', async () => {
    const date = futureDate(47);
    const ownerPhone = freshPhone();
    const ownerClientId = await seedSalonClient(ownerPhone);
    const originalId = await seedAppointment({
      date,
      startTime: '14:00',
      salonClientId: ownerClientId,
      clientPhone: ownerPhone,
    });
    const attackerPhone = freshPhone();
    holder.clientSession = { normalizedPhone: attackerPhone, phoneVariants: [attackerPhone] };

    const response = await postBooking({
      startTime: at(date, '11:00').toISOString(),
      originalAppointmentId: originalId,
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('UNAUTHORIZED_RESCHEDULE');
    expect(await getAppointmentRow(originalId)).toMatchObject({ status: 'confirmed' });
  });
});
