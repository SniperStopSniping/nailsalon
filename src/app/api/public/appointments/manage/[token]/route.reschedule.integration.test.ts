/**
 * Customer manage-link reschedule — real SQL on a dedicated PGlite, exercising
 * the actual route handler.
 *
 * The property that matters most here is identity: a reschedule must MOVE the
 * existing appointment, never cancel it and create a replacement. Every test
 * therefore asserts the row count as well as the outcome.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOpaqueToken } from '@/libs/lusterSecurity';
import * as schema from '@/models/Schema';

import { POST } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const {
  sendTransactionalEmail,
  sendTransactionalEmailDetailed,
  getGoogleCalendarBusyWindows,
  enqueueGoogleCalendarUpsert,
  enqueueGoogleCalendarDelete,
} = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(),
  sendTransactionalEmailDetailed: vi.fn(),
  getGoogleCalendarBusyWindows: vi.fn(),
  enqueueGoogleCalendarUpsert: vi.fn(),
  enqueueGoogleCalendarDelete: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/email', () => ({
  sendTransactionalEmail,
  sendTransactionalEmailDetailed,
}));

vi.mock('@/libs/googleCalendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/googleCalendar')>();
  return {
    getGoogleCalendarBusyWindows,
    // The real overlap predicate — only the network fetch is stubbed.
    isBusyWindowConflict: actual.isBusyWindowConflict,
  };
});

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarUpsert,
  enqueueGoogleCalendarDelete,
}));

const SALON_ID = 'salon_resched';
const TECH_ID = 'tech_resched';
const SERVICE_ID = 'svc_resched_gel';
const CLIENT_ID = 'client_resched';

// 2026-09-01 is a Tuesday. 18:00Z = 14:00 EDT, inside the seeded 09:00–20:00.
const CURRENT_START = new Date('2026-09-01T18:00:00.000Z');
const NEW_START = new Date('2026-09-01T20:00:00.000Z');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let counter = 0;

async function seedAppointmentWithToken(
  overrides: Partial<typeof schema.appointmentSchema.$inferInsert> = {},
) {
  counter += 1;
  const id = `appt_resched_${counter}`;
  const startTime = overrides.startTime instanceof Date ? overrides.startTime : CURRENT_START;
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: '4165559876',
    clientName: 'Daniel Smith',
    clientEmail: 'daniel@example.com',
    salonClientId: CLIENT_ID,
    startTime,
    endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
    status: 'confirmed',
    totalPrice: 4500,
    totalDurationMinutes: 60,
    ...overrides,
  });
  await db.insert(schema.appointmentServicesSchema).values({
    id: `apptSvc_${id}`,
    appointmentId: id,
    serviceId: SERVICE_ID,
    priceAtBooking: 4500,
    durationAtBooking: 60,
    nameSnapshot: 'Gel Manicure',
    priceCentsSnapshot: 4500,
    durationMinutesSnapshot: 60,
  });

  const capability = createOpaqueToken();
  await db.insert(schema.appointmentAccessTokenSchema).values({
    id: `tok_${id}`,
    salonId: SALON_ID,
    appointmentId: id,
    tokenHash: capability.tokenHash,
    expiresAt: new Date(startTime.getTime() + 30 * 24 * 60 * 60 * 1000),
  });

  return { appointmentId: id, token: capability.token };
}

function rescheduleRequest(startTime: string | undefined, action = 'reschedule') {
  return new Request('http://localhost/api/public/appointments/manage/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(startTime === undefined ? {} : { startTime }) }),
  });
}

async function appointmentRows() {
  return db.select().from(schema.appointmentSchema);
}

async function deliveriesFor(
  appointmentId: string,
  purpose: string,
) {
  return db
    .select()
    .from(schema.notificationDeliverySchema)
    .where(and(
      eq(schema.notificationDeliverySchema.appointmentId, appointmentId),
      eq(schema.notificationDeliverySchema.purpose, purpose),
    ));
}

function detailedEmailsTo(address: string) {
  return sendTransactionalEmailDetailed.mock.calls
    .map(call => call[0] as { to: string; subject: string; text: string })
    .filter(message => message.to === address);
}

beforeAll(async () => {
  process.env.PUBLIC_APP_URL = 'https://app.luster.test';
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Isla Nail Studio',
    slug: 'isla-nail-studio1',
    ownerEmail: 'owner@example.com',
    settings: { booking: { clientChangeCutoffHours: 0, slotIntervalMinutes: 15 } },
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Daniela',
    weeklySchedule: {
      monday: { start: '09:00', end: '20:00' },
      tuesday: { start: '09:00', end: '20:00' },
      wednesday: { start: '09:00', end: '20:00' },
      thursday: { start: '09:00', end: '20:00' },
      friday: { start: '09:00', end: '20:00' },
      saturday: { start: '09:00', end: '20:00' },
      sunday: { start: '09:00', end: '20:00' },
    },
  });
  await db.insert(schema.salonClientSchema).values({
    id: CLIENT_ID,
    salonId: SALON_ID,
    phone: '4165559876',
    fullName: 'Daniel Smith',
    email: 'current@example.com',
  });
  await db.insert(schema.serviceSchema).values({
    id: SERVICE_ID,
    salonId: SALON_ID,
    name: 'Gel Manicure',
    category: 'manicure',
    price: 4500,
    durationMinutes: 60,
  });
});

beforeEach(async () => {
  vi.clearAllMocks();
  sendTransactionalEmail.mockResolvedValue(true);
  sendTransactionalEmailDetailed.mockResolvedValue({
    ok: true,
    errorCode: null,
    providerMessageId: 'msg_resched',
  });
  getGoogleCalendarBusyWindows.mockResolvedValue([]);
  enqueueGoogleCalendarUpsert.mockResolvedValue(undefined);
  enqueueGoogleCalendarDelete.mockResolvedValue(undefined);
  await db.delete(schema.appointmentAccessTokenSchema);
  await db.delete(schema.appointmentServicesSchema);
  await db.delete(schema.notificationDeliverySchema);
  await db.delete(schema.appointmentSchema);
});

describe('customer manage-link reschedule', () => {
  it('moves the existing appointment without creating a second row', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();

    const response = await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('rescheduled');
    expect(body.data.appointmentId).toBe(appointmentId);

    const rows = await appointmentRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(appointmentId);
    expect(rows[0]!.status).toBe('confirmed');
    expect(rows[0]!.startTime.toISOString()).toBe(NEW_START.toISOString());
    // Identity and permitted pricing state survive the move.
    expect(rows[0]!.clientEmail).toBe('daniel@example.com');
    expect(rows[0]!.totalPrice).toBe(4500);
  });

  it('keeps the customer’s capability token working after the move', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();

    await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });

    const tokens = await db
      .select()
      .from(schema.appointmentAccessTokenSchema)
      .where(eq(schema.appointmentAccessTokenSchema.appointmentId, appointmentId));

    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.revokedAt).toBeNull();
  });

  it('reports "no changes" and writes nothing when the same time is submitted', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();

    const response = await POST(rescheduleRequest(CURRENT_START.toISOString()), { params: { token } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('unchanged');

    const rows = await appointmentRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.startTime.toISOString()).toBe(CURRENT_START.toISOString());
    // No notification of any kind for a non-change.
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarUpsert).not.toHaveBeenCalled();
    expect(await db
      .select()
      .from(schema.notificationDeliverySchema)
      .where(eq(schema.notificationDeliverySchema.appointmentId, appointmentId))).toHaveLength(0);
  });

  it('notifies the customer and the salon exactly once', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();

    await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });

    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);
    expect(detailedEmailsTo('current@example.com')[0]).toMatchObject({
      to: 'current@example.com',
      subject: 'Isla Nail Studio appointment rescheduled',
    });

    const deliveries = await db
      .select()
      .from(schema.notificationDeliverySchema)
      .where(eq(schema.notificationDeliverySchema.appointmentId, appointmentId));

    expect(deliveries).toHaveLength(2);
    expect(await deliveriesFor(appointmentId, 'salon_rescheduled'))
      .toHaveLength(1);
    expect(await deliveriesFor(
      appointmentId,
      'client_appointment_rescheduled',
    )).toHaveLength(1);
    expect(enqueueGoogleCalendarUpsert).toHaveBeenCalledTimes(1);
  });

  it('sends the customer the working management link, not a booking URL', async () => {
    const { token } = await seedAppointmentWithToken();

    await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });

    const [email] = detailedEmailsTo('current@example.com');

    expect(email).toBeDefined();
    expect(email!.text).toContain(`https://app.luster.test/en/isla-nail-studio1/manage/${encodeURIComponent(token)}`);
    expect(email!.text).not.toMatch(/\/book\//);
  });

  it('does not re-notify when the same committed move is submitted again', async () => {
    const { token } = await seedAppointmentWithToken();

    const first = await POST(
      rescheduleRequest(NEW_START.toISOString()),
      { params: { token } },
    );
    const second = await POST(
      rescheduleRequest(NEW_START.toISOString()),
      { params: { token } },
    );
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody.data.status).toBe('unchanged');
    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);
  });

  it('claims one customer email for concurrent identical reschedules', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();
    let arrivals = 0;
    let releaseBoth!: () => void;
    let markBothArrived!: () => void;
    const bothArrived = new Promise<void>((resolve) => {
      markBothArrived = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    getGoogleCalendarBusyWindows.mockImplementation(async () => {
      arrivals += 1;
      if (arrivals === 2) {
        markBothArrived();
      }
      await release;
      return [];
    });

    const pendingResponses = Promise.all([
      POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } }),
      POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } }),
    ]);
    await bothArrived;
    releaseBoth();
    const responses = await pendingResponses;

    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(arrivals).toBe(2);
    expect(await deliveriesFor(
      appointmentId,
      'client_appointment_rescheduled',
    )).toHaveLength(1);
    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);
  });

  it('uses the current email when contact changes before the committed move', async () => {
    getGoogleCalendarBusyWindows.mockImplementationOnce(async () => {
      await db
        .update(schema.salonClientSchema)
        .set({ email: 'changed@example.com' })
        .where(eq(schema.salonClientSchema.id, CLIENT_ID));
      return [];
    });
    const { token } = await seedAppointmentWithToken();

    await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });

    expect(detailedEmailsTo('current@example.com')).toHaveLength(0);
    expect(detailedEmailsTo('changed@example.com')).toHaveLength(1);

    await db
      .update(schema.salonClientSchema)
      .set({ email: 'current@example.com' })
      .where(eq(schema.salonClientSchema.id, CLIENT_ID));
  });

  it('keeps the customer notice when calendar queueing fails after the move', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    enqueueGoogleCalendarUpsert.mockRejectedValueOnce(
      new Error('calendar queue unavailable'),
    );
    const { appointmentId, token } = await seedAppointmentWithToken();

    const response = await POST(
      rescheduleRequest(NEW_START.toISOString()),
      { params: { token } },
    );

    expect(response.status).toBe(200);
    expect(await deliveriesFor(
      appointmentId,
      'client_appointment_rescheduled',
    )).toEqual([
      expect.objectContaining({ status: 'sent' }),
    ]);
    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it('keeps a moved appointment committed when customer email delivery fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendTransactionalEmailDetailed.mockRejectedValue(
      new Error('provider unavailable'),
    );
    const { appointmentId, token } = await seedAppointmentWithToken();

    const response = await POST(
      rescheduleRequest(NEW_START.toISOString()),
      { params: { token } },
    );

    expect(response.status).toBe(200);

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));

    expect(appointment!.startTime.toISOString()).toBe(NEW_START.toISOString());
    expect(appointment!.clientEmail).toBe('daniel@example.com');

    vi.restoreAllMocks();
  });

  it('moves the appointment but sends nothing when the current email is invalid', async () => {
    await db
      .update(schema.salonClientSchema)
      .set({ email: 'invalid-current-email' })
      .where(eq(schema.salonClientSchema.id, CLIENT_ID));
    const { appointmentId, token } = await seedAppointmentWithToken();

    const response = await POST(
      rescheduleRequest(NEW_START.toISOString()),
      { params: { token } },
    );

    expect(response.status).toBe(200);
    expect(detailedEmailsTo('current@example.com')).toHaveLength(0);
    expect(await deliveriesFor(
      appointmentId,
      'client_appointment_rescheduled',
    )).toEqual([
      expect.objectContaining({
        status: 'failed',
        errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
      }),
    ]);

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));

    expect(appointment!.startTime.toISOString()).toBe(NEW_START.toISOString());
    expect(appointment!.clientEmail).toBe('daniel@example.com');

    await db
      .update(schema.salonClientSchema)
      .set({ email: 'current@example.com' })
      .where(eq(schema.salonClientSchema.id, CLIENT_ID));
  });

  /**
   * Documented behaviour for the in-place path: a move changes WHEN the
   * appointment happens and nothing else. The existing discount — Smart Fit
   * included — is carried over exactly as booked, and a second discount is
   * never stacked on top of it.
   */
  it('preserves an existing Smart Fit discount exactly once', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken({
      subtotalBeforeDiscountCents: 5000,
      discountAmountCents: 500,
      discountType: 'smart_fit',
      discountLabel: 'Smart Fit saving',
      totalPrice: 4500,
    });

    await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });

    const [row] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));

    expect(row!.discountType).toBe('smart_fit');
    expect(row!.discountLabel).toBe('Smart Fit saving');
    expect(row!.discountAmountCents).toBe(500);
    expect(row!.subtotalBeforeDiscountCents).toBe(5000);
    expect(row!.totalPrice).toBe(4500);
  });

  it('does not invent a discount for an undiscounted booking on a loose slot', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();

    const response = await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });
    const body = await response.json();

    expect(body.data.smartFit).toBe('none');

    const [row] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));

    expect(row!.discountType).toBeNull();
    expect(row!.discountAmountCents ?? 0).toBe(0);
    expect(row!.totalPrice).toBe(4500);
  });

  it('leaves a reward discount alone instead of replacing it with Smart Fit', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken({
      subtotalBeforeDiscountCents: 5000,
      discountAmountCents: 1000,
      discountType: 'reward',
      discountLabel: 'Reward applied',
      totalPrice: 4000,
    });

    await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });

    const [row] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));

    expect(row!.discountType).toBe('reward');
    expect(row!.discountAmountCents).toBe(1000);
    expect(row!.totalPrice).toBe(4000);
  });

  it('cannot stack a second discount when the same reschedule is retried', async () => {
    const { token } = await seedAppointmentWithToken({
      subtotalBeforeDiscountCents: 5000,
      discountAmountCents: 500,
      discountType: 'smart_fit',
      discountLabel: 'Smart Fit Discount',
      totalPrice: 4500,
    });

    await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });
    const LATER = new Date('2026-09-01T21:00:00.000Z');
    await POST(rescheduleRequest(LATER.toISOString()), { params: { token } });

    const rows = await appointmentRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.discountAmountCents).toBe(500);
    expect(rows[0]!.totalPrice).toBe(4500);
    expect(rows[0]!.startTime.toISOString()).toBe(LATER.toISOString());
  });

  it('rejects a slot Google Calendar reports as busy', async () => {
    getGoogleCalendarBusyWindows.mockResolvedValue([{
      startTime: NEW_START,
      endTime: new Date(NEW_START.getTime() + 60 * 60 * 1000),
    }]);
    const { token } = await seedAppointmentWithToken();

    const response = await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('APPOINTMENT_CONFLICT');
    expect((await appointmentRows())[0]!.startTime.toISOString()).toBe(CURRENT_START.toISOString());
  });

  it('excludes this appointment from its own Google mirror check', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();

    await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });

    expect(getGoogleCalendarBusyWindows).toHaveBeenCalledWith(
      expect.objectContaining({ excludeAppointmentId: appointmentId }),
    );
  });

  it('fails closed when Google availability cannot be verified', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getGoogleCalendarBusyWindows.mockRejectedValue(new Error('google down'));
    const { token } = await seedAppointmentWithToken();

    const response = await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });

    expect(response.status).toBe(503);
    expect((await appointmentRows())[0]!.startTime.toISOString()).toBe(CURRENT_START.toISOString());

    errorSpy.mockRestore();
  });

  it('rejects an invalid token without revealing anything', async () => {
    await seedAppointmentWithToken();

    const response = await POST(
      rescheduleRequest(NEW_START.toISOString()),
      { params: { token: 'not-a-real-token' } },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('MANAGE_LINK_INVALID');
    expect((await appointmentRows())[0]!.startTime.toISOString()).toBe(CURRENT_START.toISOString());
  });

  it('rejects an expired token', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();
    await db
      .update(schema.appointmentAccessTokenSchema)
      .set({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(schema.appointmentAccessTokenSchema.appointmentId, appointmentId));

    const response = await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });

    expect(response.status).toBe(404);
    expect((await appointmentRows())[0]!.startTime.toISOString()).toBe(CURRENT_START.toISOString());
  });

  it('rejects malformed and off-grid start times', async () => {
    const { token } = await seedAppointmentWithToken();

    const missing = await POST(rescheduleRequest(undefined), { params: { token } });
    const garbage = await POST(rescheduleRequest('not-a-date'), { params: { token } });
    const offGrid = await POST(
      rescheduleRequest(new Date('2026-09-01T20:07:00.000Z').toISOString()),
      { params: { token } },
    );

    expect(missing.status).toBe(400);
    expect(garbage.status).toBe(400);
    expect(offGrid.status).toBe(400);
    expect((await appointmentRows())[0]!.startTime.toISOString()).toBe(CURRENT_START.toISOString());
  });

  it('rejects a non-reschedule action on this endpoint', async () => {
    const { token } = await seedAppointmentWithToken();

    const response = await POST(rescheduleRequest(NEW_START.toISOString(), 'cancel'), { params: { token } });

    expect(response.status).toBe(400);
  });

  it('refuses to move an appointment that is no longer active', async () => {
    const { token } = await seedAppointmentWithToken({ status: 'cancelled' });

    const response = await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('APPOINTMENT_NOT_ACTIVE');
  });

  it('never logs the capability token', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getGoogleCalendarBusyWindows.mockRejectedValue(new Error('google down'));
    const { token } = await seedAppointmentWithToken();

    await POST(rescheduleRequest(NEW_START.toISOString()), { params: { token } });

    const logged = [...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .map(call => JSON.stringify(call))
      .join('\n');

    expect(logged).not.toContain(token);

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
