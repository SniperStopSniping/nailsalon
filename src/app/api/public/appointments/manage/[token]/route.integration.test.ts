/**
 * Customer manage-link cancellation — real SQL on a dedicated PGlite, exercising
 * the actual route handler. This is the path that previously notified nobody at
 * the salon, so the salon alert is asserted end to end.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOpaqueToken } from '@/libs/lusterSecurity';
import * as schema from '@/models/Schema';

import { PATCH } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const { sendTransactionalEmail, sendTransactionalEmailDetailed } = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(),
  sendTransactionalEmailDetailed: vi.fn(),
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

const SALON_ID = 'salon_manage';
const TECH_ID = 'tech_manage';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let appointmentCounter = 0;

async function seedAppointmentWithToken(
  overrides: Partial<typeof schema.appointmentSchema.$inferInsert> = {},
) {
  appointmentCounter += 1;
  const id = `appt_manage_${appointmentCounter}`;
  const startTime = new Date(Date.UTC(2026, 8, 1 + appointmentCounter, 18, 0, 0));
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: '4165559876',
    clientName: 'Daniel Smith',
    clientEmail: 'daniel@example.com',
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
    serviceId: 'svc_manage_gel',
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

function cancelRequest() {
  return new Request('http://localhost/api/public/appointments/manage/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel', reason: 'client_request' }),
  });
}

async function salonDeliveriesFor(appointmentId: string) {
  return db
    .select()
    .from(schema.notificationDeliverySchema)
    .where(eq(schema.notificationDeliverySchema.appointmentId, appointmentId));
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
    slug: 'isla-nail-studio',
    ownerEmail: 'owner@example.com',
    settings: { booking: { clientChangeCutoffHours: 0 } },
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Daniela',
  });
  await db.insert(schema.serviceSchema).values({
    id: 'svc_manage_gel',
    salonId: SALON_ID,
    name: 'Gel Manicure',
    category: 'manicure',
    price: 4500,
    durationMinutes: 60,
  });
});

beforeEach(() => {
  sendTransactionalEmail.mockReset();
  sendTransactionalEmail.mockResolvedValue(true);
  sendTransactionalEmailDetailed.mockReset();
  sendTransactionalEmailDetailed.mockResolvedValue({
    ok: true,
    errorCode: null,
    providerMessageId: 'msg_manage',
  });
});

describe('customer manage-link cancellation', () => {
  it('cancels the appointment and queues exactly one salon alert', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();

    const response = await PATCH(cancelRequest(), { params: { token } });

    expect(response.status).toBe(200);

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));

    expect(appointment!.status).toBe('cancelled');

    const deliveries = await salonDeliveriesFor(appointmentId);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.purpose).toBe('salon_cancelled');
    expect(deliveries[0]!.status).toBe('sent');
    expect(sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);

    const salonEmail = sendTransactionalEmailDetailed.mock.calls[0]![0] as {
      to: string;
      subject: string;
      text: string;
    };

    expect(salonEmail.to).toBe('owner@example.com');
    expect(salonEmail.subject).toContain('Appointment cancelled: Daniel Smith');
    expect(salonEmail.text).toContain('Client manage link');
    expect(salonEmail.text).toContain(
      `appointment=${appointmentId}`,
    );
  });

  it('still sends the client confirmation unchanged', async () => {
    const { token } = await seedAppointmentWithToken();

    await PATCH(cancelRequest(), { params: { token } });

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail.mock.calls[0]![0]).toMatchObject({
      to: 'daniel@example.com',
      subject: 'Isla Nail Studio appointment cancelled',
    });
  });

  it('does not notify again when the cancellation is repeated', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();

    const first = await PATCH(cancelRequest(), { params: { token } });
    const second = await PATCH(cancelRequest(), { params: { token } });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await salonDeliveriesFor(appointmentId)).toHaveLength(1);
    expect(sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for an appointment that was already cancelled', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken({
      status: 'cancelled',
      cancelReason: 'client_request',
    });

    const response = await PATCH(cancelRequest(), { params: { token } });

    expect(response.status).toBe(409);
    expect(await salonDeliveriesFor(appointmentId)).toHaveLength(0);
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('sends no salon alert when cancellation emails are disabled', async () => {
    await db
      .update(schema.salonSchema)
      .set({
        settings: {
          booking: { clientChangeCutoffHours: 0 },
          notifications: { salonEmail: { cancelled: false } },
        },
      })
      .where(eq(schema.salonSchema.id, SALON_ID));
    const { appointmentId, token } = await seedAppointmentWithToken();

    await PATCH(cancelRequest(), { params: { token } });

    expect(await salonDeliveriesFor(appointmentId)).toHaveLength(0);
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();

    await db
      .update(schema.salonSchema)
      .set({ settings: { booking: { clientChangeCutoffHours: 0 } } })
      .where(eq(schema.salonSchema.id, SALON_ID));
  });

  it('keeps the appointment cancelled when the salon email fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      errorCode: 'RESEND_HTTP_500',
      providerMessageId: null,
    });
    const { appointmentId, token } = await seedAppointmentWithToken();

    const response = await PATCH(cancelRequest(), { params: { token } });

    expect(response.status).toBe(200);

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));

    expect(appointment!.status).toBe('cancelled');

    const deliveries = await salonDeliveriesFor(appointmentId);

    expect(deliveries[0]!.status).toBe('failed');

    vi.restoreAllMocks();
  });
});
