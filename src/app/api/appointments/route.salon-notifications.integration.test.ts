/**
 * Booking POST × salon notification emails — real SQL on a dedicated PGlite,
 * exercising the actual route handler. Covers the new-booking and
 * customer-reschedule alerts, including that a reschedule never also announces
 * itself as a new booking.
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
}));

const { sendTransactionalEmailDetailed } = vi.hoisted(() => ({
  sendTransactionalEmailDetailed: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/email', () => ({
  sendTransactionalEmailDetailed,
  sendTransactionalEmail: vi.fn(async () => true),
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
        sessionId: 'client_session_notify',
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
  getCanonicalAppOrigin: vi.fn(() => 'https://app.luster.test'),
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_notify_post';
const SALON_SLUG = 'notify-post-salon';
const TECH_ID = 'tech_notify_post';
const SERVICE_ID = 'srv_notify_post';
const TIME_ZONE = 'America/Toronto';

const FULL_WEEK = {
  sunday: { start: '9:00', end: '19:00' },
  monday: { start: '9:00', end: '19:00' },
  tuesday: { start: '9:00', end: '19:00' },
  wednesday: { start: '9:00', end: '19:00' },
  thursday: { start: '9:00', end: '19:00' },
  friday: { start: '9:00', end: '19:00' },
  saturday: { start: '9:00', end: '19:00' },
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let counter = 0;

const at = (date: string, time: string) =>
  zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

function futureDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function freshPhone(): string {
  counter += 1;
  return `416777${String(1000 + counter).padStart(4, '0')}`;
}

function setClientSession(phone: string) {
  holder.clientSession = {
    normalizedPhone: phone,
    phoneVariants: [phone, `+1${phone}`],
  };
}

async function postBooking(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      salonSlug: SALON_SLUG,
      baseServiceId: SERVICE_ID,
      technicianId: TECH_ID,
      ...body,
    }),
  }));
}

async function salonDeliveries(purpose?: string) {
  const rows = await db.select().from(schema.notificationDeliverySchema);
  return purpose ? rows.filter(row => row.purpose === purpose) : rows;
}

async function setSalonSettings(settings: Record<string, unknown> | null) {
  await db
    .update(schema.salonSchema)
    .set({ settings: settings as never })
    .where(eq(schema.salonSchema.id, SALON_ID));
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Notify Salon',
    slug: SALON_SLUG,
    ownerEmail: 'owner@example.com',
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Daniela',
    weeklySchedule: FULL_WEEK,
  });
  await db.insert(schema.serviceSchema).values({
    id: SERVICE_ID,
    salonId: SALON_ID,
    name: 'Gel Manicure',
    category: 'manicure',
    price: 4500,
    durationMinutes: 60,
  });
  await db.insert(schema.technicianServicesSchema).values({
    technicianId: TECH_ID,
    serviceId: SERVICE_ID,
    enabled: true,
  });
}, 60_000);

beforeEach(async () => {
  holder.clientSession = null;
  sendTransactionalEmailDetailed.mockReset();
  sendTransactionalEmailDetailed.mockResolvedValue({
    ok: true,
    errorCode: null,
    providerMessageId: 'msg_notify',
  });
  await db.delete(schema.notificationDeliverySchema);
  await setSalonSettings(null);
});

afterAll(async () => {
  await client.close();
});

describe('new booking alerts', () => {
  it('queues exactly one salon alert for a successful booking', async () => {
    const date = futureDate(20);
    const phone = freshPhone();
    setClientSession(phone);

    const response = await postBooking({
      startTime: at(date, '10:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const deliveries = await salonDeliveries('salon_new_booking');

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.appointmentId).toBe(body.data.appointmentId);
    expect(deliveries[0]!.status).toBe('sent');

    const email = sendTransactionalEmailDetailed.mock.calls[0]![0] as {
      to: string;
      subject: string;
      text: string;
    };

    expect(email.to).toBe('owner@example.com');
    expect(email.subject).toContain('New booking:');
    expect(email.text).toContain('Gel Manicure');
    expect(email.text).toContain('Online booking page');
  });

  it('sends nothing when new booking emails are disabled', async () => {
    await setSalonSettings({
      notifications: { salonEmail: { newBooking: false } },
    });
    const date = futureDate(21);
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(date, '10:00').toISOString(),
    });

    expect(response.status).toBe(201);
    expect(await salonDeliveries()).toHaveLength(0);
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('sends nothing when the booking fails validation', async () => {
    const date = futureDate(22);
    setClientSession(freshPhone());

    const response = await postBooking({
      baseServiceId: 'srv_does_not_exist',
      startTime: at(date, '10:00').toISOString(),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await salonDeliveries()).toHaveLength(0);
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('keeps the booking when the salon email provider fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      errorCode: 'RESEND_HTTP_500',
      providerMessageId: null,
    });
    const date = futureDate(23);
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(date, '10:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, body.data.appointmentId));

    expect(['pending', 'confirmed']).toContain(appointment!.status);

    const deliveries = await salonDeliveries('salon_new_booking');

    expect(deliveries[0]!.status).toBe('failed');

    vi.restoreAllMocks();
  });
});

describe('customer reschedule alerts', () => {
  async function bookThenReschedule(args: {
    date: string;
    firstTime: string;
    secondTime: string;
  }) {
    const phone = freshPhone();
    setClientSession(phone);

    const first = await postBooking({
      startTime: at(args.date, args.firstTime).toISOString(),
    });
    const firstBody = await first.json();

    expect(first.status).toBe(201);

    const second = await postBooking({
      startTime: at(args.date, args.secondTime).toISOString(),
      originalAppointmentId: firstBody.data.appointmentId,
    });
    const secondBody = await second.json();

    expect(second.status).toBe(201);

    return {
      originalId: firstBody.data.appointmentId as string,
      newId: secondBody.data.appointmentId as string,
      phone,
    };
  }

  it('announces a reschedule instead of a second new booking', async () => {
    const date = futureDate(25);

    const { newId } = await bookThenReschedule({
      date,
      firstTime: '10:00',
      secondTime: '14:00',
    });

    const rescheduled = await salonDeliveries('salon_rescheduled');
    const created = await salonDeliveries('salon_new_booking');

    expect(rescheduled).toHaveLength(1);
    expect(rescheduled[0]!.appointmentId).toBe(newId);
    // Only the original booking announced itself as new.
    expect(created).toHaveLength(1);
    expect(created[0]!.appointmentId).not.toBe(newId);

    const email = sendTransactionalEmailDetailed.mock.calls.at(-1)![0] as {
      subject: string;
      text: string;
    };

    expect(email.subject).toContain('Appointment rescheduled:');
    expect(email.text).toContain('10:00 AM–11:00 AM');
    expect(email.text).toContain('2:00 PM–3:00 PM');
  });

  it('sends one alert per legitimate reschedule', async () => {
    const date = futureDate(26);
    const { newId } = await bookThenReschedule({
      date,
      firstTime: '10:00',
      secondTime: '14:00',
    });

    const third = await postBooking({
      startTime: at(date, '16:00').toISOString(),
      originalAppointmentId: newId,
    });

    expect(third.status).toBe(201);
    expect(await salonDeliveries('salon_rescheduled')).toHaveLength(2);
  });

  it('sends nothing when reschedule emails are disabled', async () => {
    await setSalonSettings({
      notifications: { salonEmail: { rescheduled: false } },
    });
    const date = futureDate(27);

    await bookThenReschedule({ date, firstTime: '10:00', secondTime: '14:00' });

    expect(await salonDeliveries('salon_rescheduled')).toHaveLength(0);
  });
});
