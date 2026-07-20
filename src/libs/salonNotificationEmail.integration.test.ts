/**
 * Salon notification email tests — real SQL on a dedicated PGlite with the full
 * migration set, so the notification_delivery unique index (the idempotency
 * gate) is exercised for real rather than mocked.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildRescheduleEventVersion,
  retrySalonNotificationEmail,
  sendSalonNotificationEmail,
} from '@/libs/salonNotificationEmail';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const { sendTransactionalEmailDetailed } = vi.hoisted(() => ({
  sendTransactionalEmailDetailed: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/email', () => ({ sendTransactionalEmailDetailed }));

const SALON_ID = 'salon_notify';
const OTHER_SALON_ID = 'salon_notify_other';
const TECH_ID = 'tech_notify';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let appointmentCounter = 0;

type SentEmail = { to: string; subject: string; html: string; text: string };

function lastEmail(): SentEmail {
  const calls = sendTransactionalEmailDetailed.mock.calls;
  return calls[calls.length - 1]![0] as SentEmail;
}

async function setSalonSettings(
  salonId: string,
  settings: Record<string, unknown> | null,
) {
  await db
    .update(schema.salonSchema)
    .set({ settings: settings as never })
    .where(eq(schema.salonSchema.id, salonId));
}

async function setSalonEmails(
  salonId: string,
  emails: { ownerEmail?: string | null; email?: string | null },
) {
  await db
    .update(schema.salonSchema)
    .set(emails)
    .where(eq(schema.salonSchema.id, salonId));
}

async function seedAppointment(
  overrides: Partial<typeof schema.appointmentSchema.$inferInsert> = {},
) {
  appointmentCounter += 1;
  const id = `appt_notify_${appointmentCounter}`;
  // Distinct slots per appointment — the anti-double-booking constraint is
  // unique on (technician, start slot) for active statuses.
  const startTime = new Date(Date.UTC(2026, 6, 1 + appointmentCounter, 18, 0, 0));
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: '4165551234',
    clientName: 'Daniel Smith',
    clientEmail: 'daniel@example.com',
    startTime,
    endTime: new Date(startTime.getTime() + 70 * 60 * 1000),
    status: 'confirmed',
    totalPrice: 5050,
    totalDurationMinutes: 70,
    basePriceCents: 4500,
    addOnsPriceCents: 1000,
    subtotalBeforeDiscountCents: 5500,
    ...overrides,
  });
  await db.insert(schema.appointmentServicesSchema).values({
    id: `apptSvc_${id}`,
    appointmentId: id,
    serviceId: 'svc_notify_gel',
    priceAtBooking: 4500,
    durationAtBooking: 60,
    nameSnapshot: 'Gel Manicure',
    priceCentsSnapshot: 4500,
    durationMinutesSnapshot: 60,
  });
  return id;
}

async function addFrenchTips(appointmentId: string) {
  await db.insert(schema.appointmentAddOnSchema).values({
    id: `addon_${appointmentId}`,
    appointmentId,
    addOnId: 'addon_notify_french',
    quantitySnapshot: 1,
    nameSnapshot: 'French Tips',
    categorySnapshot: 'nail_art',
    pricingTypeSnapshot: 'fixed',
    unitPriceCentsSnapshot: 1000,
    durationMinutesSnapshot: 10,
    lineTotalCentsSnapshot: 1000,
    lineDurationMinutesSnapshot: 10,
  });
}

async function deliveriesFor(appointmentId: string) {
  return db
    .select()
    .from(schema.notificationDeliverySchema)
    .where(eq(schema.notificationDeliverySchema.appointmentId, appointmentId));
}

async function outboxFor(appointmentId: string) {
  return db
    .select()
    .from(schema.integrationOutboxSchema)
    .where(eq(schema.integrationOutboxSchema.appointmentId, appointmentId));
}

beforeAll(async () => {
  process.env.PUBLIC_APP_URL = 'https://app.luster.test';
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: SALON_ID,
      name: 'Isla Nail Studio',
      slug: 'isla-nail-studio',
      ownerEmail: 'owner@example.com',
    },
    {
      id: OTHER_SALON_ID,
      name: 'Other Salon',
      slug: 'other-salon',
      ownerEmail: 'other-owner@example.com',
    },
  ]);
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Daniela',
  });
  await db.insert(schema.serviceSchema).values({
    id: 'svc_notify_gel',
    salonId: SALON_ID,
    name: 'Gel Manicure',
    category: 'manicure',
    price: 4500,
    durationMinutes: 60,
  });
  await db.insert(schema.addOnSchema).values({
    id: 'addon_notify_french',
    salonId: SALON_ID,
    slug: 'french-tips',
    name: 'French Tips',
    category: 'nail_art',
    pricingType: 'fixed',
    priceCents: 1000,
    durationMinutes: 10,
  });
});

beforeEach(async () => {
  sendTransactionalEmailDetailed.mockReset();
  sendTransactionalEmailDetailed.mockResolvedValue({
    ok: true,
    errorCode: null,
    providerMessageId: 'msg_1',
  });
  await setSalonSettings(SALON_ID, null);
  await setSalonEmails(SALON_ID, {
    ownerEmail: 'owner@example.com',
    email: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('new booking notifications', () => {
  it('sends exactly one email and records a sent delivery', async () => {
    const appointmentId = await seedAppointment();

    const result = await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    expect(result.status).toBe('sent');
    expect(sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);

    const deliveries = await deliveriesFor(appointmentId);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe('sent');
    expect(deliveries[0]!.purpose).toBe('salon_new_booking');
    expect(deliveries[0]!.dedupeKey).toBe(
      `appointment:${appointmentId}:salon:new-booking`,
    );
  });

  it('uses the configured notification email over the owner email', async () => {
    await setSalonSettings(SALON_ID, {
      notifications: { salonEmail: { recipientEmail: 'frontdesk@example.com' } },
    });
    const appointmentId = await seedAppointment();

    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    expect(lastEmail().to).toBe('frontdesk@example.com');
  });

  it('falls back to the owner email, then the salon account email', async () => {
    const ownerAppointment = await seedAppointment();
    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId: ownerAppointment,
      event: 'newBooking',
      source: 'online_booking',
    });

    expect(lastEmail().to).toBe('owner@example.com');

    await setSalonEmails(SALON_ID, {
      ownerEmail: null,
      email: 'salon@example.com',
    });
    const accountAppointment = await seedAppointment();
    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId: accountAppointment,
      event: 'newBooking',
      source: 'online_booking',
    });

    expect(lastEmail().to).toBe('salon@example.com');
  });

  it('records a failure and sends nothing when no recipient is configured', async () => {
    await setSalonEmails(SALON_ID, { ownerEmail: null, email: null });
    const appointmentId = await seedAppointment();

    const result = await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    expect(result).toEqual({
      status: 'failed',
      reason: 'NO_SALON_NOTIFICATION_RECIPIENT',
      deliveryId: null,
    });
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();

    const deliveries = await deliveriesFor(appointmentId);

    expect(deliveries[0]!.status).toBe('failed');
    expect(deliveries[0]!.errorCode).toBe('NO_SALON_NOTIFICATION_RECIPIENT');
    expect(deliveries[0]!.retryable).toBe(false);
  });

  it('sends nothing when new booking emails are turned off', async () => {
    await setSalonSettings(SALON_ID, {
      notifications: { salonEmail: { newBooking: false } },
    });
    const appointmentId = await seedAppointment();

    const result = await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(await deliveriesFor(appointmentId)).toHaveLength(0);
  });

  it('does not send twice when the same event is retried', async () => {
    const appointmentId = await seedAppointment();
    const input = {
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking' as const,
      source: 'online_booking' as const,
    };

    await sendSalonNotificationEmail(input);
    const second = await sendSalonNotificationEmail(input);

    expect(second).toEqual({ status: 'duplicate' });
    expect(sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
    expect(await deliveriesFor(appointmentId)).toHaveLength(1);
  });

  it('includes add-ons, Smart Fit discount, totals and the salon timezone', async () => {
    const appointmentId = await seedAppointment({
      discountType: 'smart_fit',
      discountLabel: 'Smart Fit Discount',
      discountAmountCents: 450,
      totalPrice: 5050,
    });
    await addFrenchTips(appointmentId);

    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    const email = lastEmail();

    expect(email.subject).toContain('New booking: Daniel Smith');
    expect(email.subject).toContain('Gel Manicure');
    expect(email.text).toContain('French Tips: $10.00');
    expect(email.text).toContain('Smart Fit discount: -$4.50');
    expect(email.text).toContain('Expected total: $50.50');
    expect(email.text).toContain('Service: $45.00');
    // 18:00 UTC is 2:00 PM in America/Toronto (the salon default).
    expect(email.text).toContain('Start: 2:00 PM');
    expect(email.text).toContain('Expected finish: 3:10 PM');
    expect(email.text).toContain('America/Toronto');
    expect(email.html).toContain('New booking');
  });

  it('falls back to a placeholder when the client left no notes', async () => {
    const appointmentId = await seedAppointment();

    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    expect(lastEmail().text).toContain('No notes provided');
  });

  it('links to the appointment in the owning salon dashboard', async () => {
    const appointmentId = await seedAppointment();

    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    const email = lastEmail();

    expect(email.text).toContain(
      `https://app.luster.test/admin?salon=isla-nail-studio&app=bookings&appointment=${appointmentId}`,
    );
    expect(email.text).not.toContain('other-salon');
  });

  it('never uses another salon recipient for this salon appointment', async () => {
    await setSalonEmails(OTHER_SALON_ID, { ownerEmail: 'other-owner@example.com' });
    const appointmentId = await seedAppointment();

    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    expect(lastEmail().to).toBe('owner@example.com');
  });

  it('sends nothing for an appointment that does not belong to the salon', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const appointmentId = await seedAppointment();

    const result = await sendSalonNotificationEmail({
      salonId: OTHER_SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'appointment_not_found',
    });
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalled();
  });

  it('keeps client details out of the logs when delivery fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      errorCode: 'RESEND_HTTP_500',
      providerMessageId: null,
    });
    const appointmentId = await seedAppointment();

    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    const logged = JSON.stringify(consoleError.mock.calls);

    expect(logged).toContain('RESEND_HTTP_500');
    expect(logged).not.toContain('Daniel Smith');
    expect(logged).not.toContain('4165551234');
    expect(logged).not.toContain('daniel@example.com');
  });
});

describe('reschedule notifications', () => {
  async function reschedule(newAppointmentId: string, previousStart: Date) {
    return sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId: newAppointmentId,
      event: 'rescheduled',
      source: 'client_manage_link',
      previous: {
        appointmentId: 'appt_notify_previous',
        startTime: previousStart.toISOString(),
        endTime: new Date(previousStart.getTime() + 70 * 60 * 1000).toISOString(),
        technicianName: 'Daniela',
        serviceSummary: 'Gel Manicure',
        discountLabel: null,
        discountAmountCents: 0,
        totalPriceCents: 5500,
      },
    });
  }

  it('shows the previous and new times', async () => {
    const appointmentId = await seedAppointment();
    const previousStart = new Date(Date.UTC(2026, 6, 21, 18, 0, 0));

    await reschedule(appointmentId, previousStart);

    const email = lastEmail();

    expect(email.subject).toContain('Appointment rescheduled: Daniel Smith');
    expect(email.text).toContain('Tuesday, July 21');
    expect(email.text).toContain('2:00 PM–3:10 PM');
    expect(email.html).toContain('Rescheduled');
  });

  it('does not duplicate when the same reschedule is retried', async () => {
    const appointmentId = await seedAppointment();
    const previousStart = new Date(Date.UTC(2026, 6, 21, 18, 0, 0));

    await reschedule(appointmentId, previousStart);
    const second = await reschedule(appointmentId, previousStart);

    expect(second).toEqual({ status: 'duplicate' });
    expect(sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('sends once per legitimate reschedule of the same appointment', async () => {
    const appointmentId = await seedAppointment();

    await reschedule(appointmentId, new Date(Date.UTC(2026, 6, 21, 18, 0, 0)));
    await reschedule(appointmentId, new Date(Date.UTC(2026, 6, 22, 20, 30, 0)));

    expect(sendTransactionalEmailDetailed).toHaveBeenCalledTimes(2);
    expect(await deliveriesFor(appointmentId)).toHaveLength(2);
  });

  it('sends nothing when reschedule emails are turned off', async () => {
    await setSalonSettings(SALON_ID, {
      notifications: { salonEmail: { rescheduled: false } },
    });
    const appointmentId = await seedAppointment();

    const result = await reschedule(
      appointmentId,
      new Date(Date.UTC(2026, 6, 21, 18, 0, 0)),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('shows previous and new discount and total when Smart Fit changes', async () => {
    const appointmentId = await seedAppointment({
      discountType: 'smart_fit',
      discountLabel: 'Smart Fit Discount',
      discountAmountCents: 450,
      totalPrice: 5050,
    });

    await reschedule(appointmentId, new Date(Date.UTC(2026, 6, 21, 18, 0, 0)));

    const email = lastEmail();

    expect(email.text).toContain('Previous discount: None');
    expect(email.text).toContain('New discount: Smart Fit discount -$4.50');
    expect(email.text).toContain('Previous expected total: $55.00');
    expect(email.text).toContain('New expected total: $50.50');
  });

  it('derives a stable event version from the confirmed schedules', () => {
    const args = {
      previousAppointmentId: 'appt_a',
      previousStartTime: '2026-07-21T18:00:00.000Z',
      previousEndTime: '2026-07-21T19:10:00.000Z',
      newStartTime: '2026-07-22T20:30:00.000Z',
      newEndTime: '2026-07-22T21:40:00.000Z',
    };

    expect(buildRescheduleEventVersion(args)).toBe(
      buildRescheduleEventVersion(args),
    );
    expect(buildRescheduleEventVersion(args)).not.toBe(
      buildRescheduleEventVersion({ ...args, newStartTime: '2026-07-23T20:30:00.000Z' }),
    );
  });
});

describe('cancellation notifications', () => {
  it('reports the cancelled appointment without claiming a refund', async () => {
    const appointmentId = await seedAppointment({
      status: 'cancelled',
      cancelReason: 'client_request',
      paymentStatus: 'paid',
    });
    await addFrenchTips(appointmentId);

    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'cancelled',
      source: 'client_manage_link',
      cancellation: {
        reason: 'client_request',
        cancelledAt: '2026-07-20T18:30:00.000Z',
      },
    });

    const email = lastEmail();

    expect(email.subject).toContain('Appointment cancelled: Daniel Smith');
    expect(email.text).toContain('This appointment is cancelled');
    expect(email.text).toContain('French Tips: $10.00');
    expect(email.text).toContain('Client manage link');
    expect(email.text.toLowerCase()).not.toContain('refund');
    expect(email.html.toLowerCase()).not.toContain('refund');
  });

  it('includes the cancellation reason when one was given', async () => {
    const appointmentId = await seedAppointment({ status: 'cancelled' });

    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'cancelled',
      source: 'dashboard',
      cancellation: {
        reason: 'salon_request',
        cancelledAt: '2026-07-20T18:30:00.000Z',
      },
    });

    expect(lastEmail().text).toContain('Reason: salon request');
  });

  it('does not duplicate when the cancellation is retried', async () => {
    const appointmentId = await seedAppointment({ status: 'cancelled' });
    const input = {
      salonId: SALON_ID,
      appointmentId,
      event: 'cancelled' as const,
      source: 'dashboard' as const,
      cancellation: {
        reason: 'client_request',
        cancelledAt: '2026-07-20T18:30:00.000Z',
      },
    };

    await sendSalonNotificationEmail(input);
    const second = await sendSalonNotificationEmail(input);

    expect(second).toEqual({ status: 'duplicate' });
    expect(sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when cancellation emails are turned off', async () => {
    await setSalonSettings(SALON_ID, {
      notifications: { salonEmail: { cancelled: false } },
    });
    const appointmentId = await seedAppointment({ status: 'cancelled' });

    const result = await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'cancelled',
      source: 'dashboard',
      cancellation: { reason: null, cancelledAt: '2026-07-20T18:30:00.000Z' },
    });

    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });
});

describe('provider failure handling', () => {
  it('queues one retry job and leaves the delivery retryable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      errorCode: 'RESEND_HTTP_500',
      providerMessageId: null,
    });
    const appointmentId = await seedAppointment();

    const result = await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });

    expect(result.status).toBe('failed');

    const deliveries = await deliveriesFor(appointmentId);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe('failed');
    expect(deliveries[0]!.retryable).toBe(true);

    const jobs = await outboxFor(appointmentId);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.operation).toBe('retry_salon_notification');
  });

  it('retries against the same delivery row instead of creating a second one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      errorCode: 'RESEND_HTTP_500',
      providerMessageId: null,
    });
    const appointmentId = await seedAppointment();
    await sendSalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      event: 'newBooking',
      source: 'online_booking',
    });
    const [delivery] = await deliveriesFor(appointmentId);

    sendTransactionalEmailDetailed.mockResolvedValue({
      ok: true,
      errorCode: null,
      providerMessageId: 'msg_retry',
    });
    await retrySalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      deliveryId: delivery!.id,
      event: 'newBooking',
      source: 'online_booking',
    });

    const deliveries = await deliveriesFor(appointmentId);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe('sent');
    expect(deliveries[0]!.providerMessageId).toBe('msg_retry');
    expect(deliveries[0]!.retryable).toBe(false);
  });

  it('marks the delivery failed again when the retry also fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const appointmentId = await seedAppointment();
    const deliveryId = crypto.randomUUID();
    await db.insert(schema.notificationDeliverySchema).values({
      id: deliveryId,
      salonId: SALON_ID,
      appointmentId,
      channel: 'email',
      purpose: 'salon_new_booking',
      dedupeKey: `appointment:${appointmentId}:salon:new-booking`,
      status: 'failed',
    });
    sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      errorCode: 'RESEND_HTTP_500',
      providerMessageId: null,
    });

    await expect(retrySalonNotificationEmail({
      salonId: SALON_ID,
      appointmentId,
      deliveryId,
      event: 'newBooking',
      source: 'online_booking',
    })).rejects.toThrow('RESEND_HTTP_500');

    const [delivery] = await db
      .select()
      .from(schema.notificationDeliverySchema)
      .where(and(
        eq(schema.notificationDeliverySchema.id, deliveryId),
        eq(schema.notificationDeliverySchema.salonId, SALON_ID),
      ));

    expect(delivery!.status).toBe('failed');
  });
});
