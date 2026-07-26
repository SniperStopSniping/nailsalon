/**
 * Customer manage-link cancellation — real SQL on a dedicated PGlite, exercising
 * the actual route handler. This is the path that previously notified nobody at
 * the salon, so the salon alert is asserted end to end.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { retryBookingRecoveryEmail } from '@/libs/bookingRecoveryEmail';
import { sendAppointmentOperationalEmailOnce } from '@/libs/clientLifecycleStabilization';
import { retryCustomerBookingConfirmationEmail } from '@/libs/customerBookingEmail';
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
const CLIENT_ID = 'client_manage';

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
    .where(and(
      eq(schema.notificationDeliverySchema.appointmentId, appointmentId),
      eq(schema.notificationDeliverySchema.purpose, 'salon_cancelled'),
    ));
}

async function customerDeliveriesFor(appointmentId: string) {
  return db
    .select()
    .from(schema.notificationDeliverySchema)
    .where(and(
      eq(schema.notificationDeliverySchema.appointmentId, appointmentId),
      eq(
        schema.notificationDeliverySchema.purpose,
        'client_appointment_cancelled',
      ),
    ));
}

function detailedEmailsTo(address: string) {
  return sendTransactionalEmailDetailed.mock.calls
    .map(call => call[0] as {
      to: string;
      subject: string;
      text: string;
      html: string;
    })
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
    slug: 'isla-nail-studio',
    ownerEmail: 'owner@example.com',
    settings: { booking: { clientChangeCutoffHours: 0 } },
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Daniela',
  });
  await db.insert(schema.salonClientSchema).values({
    id: CLIENT_ID,
    salonId: SALON_ID,
    phone: '4165559876',
    fullName: 'Daniel Smith',
    email: 'current@example.com',
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
  it('durably claims one concurrent customer email business event', async () => {
    const { appointmentId } = await seedAppointmentWithToken();
    const input = {
      salonId: SALON_ID,
      appointmentId,
      purpose: 'test_operational_email_claim',
      eventVersion: 'event_1',
      prepare: () => ({
        subject: 'Test customer event',
        text: 'Test customer event',
        html: '<p>Test customer event</p>',
      }),
    };

    const results = await Promise.all([
      sendAppointmentOperationalEmailOnce(input),
      sendAppointmentOperationalEmailOnce(input),
    ]);

    expect(results.map(result => result.status).sort())
      .toEqual(['duplicate', 'sent']);
    expect(results.map(result => result.claimed).sort())
      .toEqual([false, true]);
    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);

    await db
      .update(schema.salonClientSchema)
      .set({ email: 'changed@example.com' })
      .where(eq(schema.salonClientSchema.id, CLIENT_ID));

    await expect(sendAppointmentOperationalEmailOnce(input))
      .resolves.toMatchObject({ status: 'sent' });
    expect(detailedEmailsTo('changed@example.com')).toHaveLength(0);

    await db
      .update(schema.salonClientSchema)
      .set({ email: 'current@example.com' })
      .where(eq(schema.salonClientSchema.id, CLIENT_ID));
  });

  it('lets only one worker reclaim a retryable failed email event', async () => {
    const { appointmentId } = await seedAppointmentWithToken();
    const purpose = 'test_operational_email_retry';
    const eventVersion = 'event_1';
    await db.insert(schema.notificationDeliverySchema).values({
      id: `delivery_failed_${appointmentId}`,
      salonId: SALON_ID,
      appointmentId,
      channel: 'email',
      purpose,
      dedupeKey:
        `email:operational:${purpose}:${appointmentId}:${eventVersion}`,
      status: 'failed',
      errorCode: 'EMAIL_PROVIDER_UNAVAILABLE',
      retryable: true,
    });
    const input = {
      salonId: SALON_ID,
      appointmentId,
      purpose,
      eventVersion,
      retryFailed: true,
      prepare: () => ({
        subject: 'Retried customer event',
        text: 'Retried customer event',
        html: '<p>Retried customer event</p>',
      }),
    };

    const results = await Promise.all([
      sendAppointmentOperationalEmailOnce(input),
      sendAppointmentOperationalEmailOnce(input),
    ]);

    expect(results.map(result => result.status).sort())
      .toEqual(['duplicate', 'sent']);
    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);
  });

  it('does not retry an ambiguous provider network outcome', async () => {
    const { appointmentId } = await seedAppointmentWithToken();
    const input = {
      salonId: SALON_ID,
      appointmentId,
      purpose: 'test_operational_email_ambiguous',
      eventVersion: 'event_1',
      retryFailed: true,
      prepare: () => ({
        subject: 'Ambiguous customer event',
        text: 'Ambiguous customer event',
        html: '<p>Ambiguous customer event</p>',
      }),
    };
    sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      errorCode: 'RESEND_NETWORK_ERROR',
      providerMessageId: null,
    });

    await expect(sendAppointmentOperationalEmailOnce(input))
      .resolves.toMatchObject({ status: 'failed' });
    await expect(sendAppointmentOperationalEmailOnce(input))
      .resolves.toMatchObject({ status: 'duplicate' });

    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);

    const [delivery] = await db
      .select()
      .from(schema.notificationDeliverySchema)
      .where(and(
        eq(schema.notificationDeliverySchema.appointmentId, appointmentId),
        eq(
          schema.notificationDeliverySchema.purpose,
          'test_operational_email_ambiguous',
        ),
      ));

    expect(delivery).toMatchObject({
      errorCode: 'RESEND_NETWORK_ERROR',
      retryable: false,
      status: 'failed',
    });
  });

  it('marks a definitive failure terminal when the caller has no replay path', async () => {
    const { appointmentId } = await seedAppointmentWithToken();
    const input = {
      salonId: SALON_ID,
      appointmentId,
      purpose: 'test_operational_email_without_replay',
      eventVersion: 'event_1',
      prepare: () => ({
        subject: 'Best-effort customer event',
        text: 'Best-effort customer event',
        html: '<p>Best-effort customer event</p>',
      }),
    };
    sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      errorCode: 'RESEND_HTTP_503',
      providerMessageId: null,
    });

    await expect(sendAppointmentOperationalEmailOnce(input))
      .resolves.toMatchObject({ status: 'failed' });
    await expect(sendAppointmentOperationalEmailOnce(input))
      .resolves.toMatchObject({ status: 'duplicate' });

    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);

    const [delivery] = await db
      .select()
      .from(schema.notificationDeliverySchema)
      .where(and(
        eq(schema.notificationDeliverySchema.appointmentId, appointmentId),
        eq(
          schema.notificationDeliverySchema.purpose,
          'test_operational_email_without_replay',
        ),
      ));

    expect(delivery).toMatchObject({
      errorCode: 'RESEND_HTTP_503',
      retryable: false,
      status: 'failed',
    });
  });

  it('records recipient infrastructure failures separately and retries safely', async () => {
    const { appointmentId } = await seedAppointmentWithToken();
    const input = {
      salonId: SALON_ID,
      appointmentId,
      purpose: 'test_operational_email_resolution_failure',
      eventVersion: 'event_1',
      retryFailed: true,
      prepare: () => ({
        subject: 'Resolved customer event',
        text: 'Resolved customer event',
        html: '<p>Resolved customer event</p>',
      }),
    };

    await client.exec('alter table appointment rename to appointment_resolution_unavailable');
    try {
      await expect(sendAppointmentOperationalEmailOnce(input))
        .resolves.toMatchObject({ status: 'failed' });
    } finally {
      await client.exec('alter table appointment_resolution_unavailable rename to appointment');
    }

    const [failedDelivery] = await db
      .select()
      .from(schema.notificationDeliverySchema)
      .where(and(
        eq(schema.notificationDeliverySchema.appointmentId, appointmentId),
        eq(
          schema.notificationDeliverySchema.purpose,
          'test_operational_email_resolution_failure',
        ),
      ));

    expect(failedDelivery).toMatchObject({
      errorCode: 'OPERATIONAL_EMAIL_RESOLUTION_FAILED',
      retryable: true,
      status: 'failed',
    });

    await expect(sendAppointmentOperationalEmailOnce(input))
      .resolves.toMatchObject({ status: 'sent' });
    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);
  });

  it('never resends after provider success when sent-state persistence fails', async () => {
    const { appointmentId } = await seedAppointmentWithToken();
    const input = {
      salonId: SALON_ID,
      appointmentId,
      purpose: 'test_operational_email_sent_state_failure',
      eventVersion: 'event_1',
      retryFailed: true,
      prepare: () => ({
        subject: 'Committed customer event',
        text: 'Committed customer event',
        html: '<p>Committed customer event</p>',
      }),
    };
    await client.exec(`
      create function fail_test_operational_sent_state()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.status = 'sent'
          and new.purpose = 'test_operational_email_sent_state_failure'
        then
          raise exception 'forced sent-state failure';
        end if;
        return new;
      end
      $$;
      create trigger fail_test_operational_sent_state
      before update on notification_delivery
      for each row execute function fail_test_operational_sent_state();
    `);
    try {
      await expect(sendAppointmentOperationalEmailOnce(input))
        .resolves.toMatchObject({ status: 'sent' });
    } finally {
      await client.exec(`
        drop trigger fail_test_operational_sent_state on notification_delivery;
        drop function fail_test_operational_sent_state();
      `);
    }

    await expect(sendAppointmentOperationalEmailOnce(input))
      .resolves.toMatchObject({ status: 'duplicate' });
    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);

    const [delivery] = await db
      .select()
      .from(schema.notificationDeliverySchema)
      .where(and(
        eq(schema.notificationDeliverySchema.appointmentId, appointmentId),
        eq(
          schema.notificationDeliverySchema.purpose,
          'test_operational_email_sent_state_failure',
        ),
      ));

    expect(delivery?.status).toBe('queued');
  });

  it('lets one real delivery-row claim invoke a booking retry provider', async () => {
    const { appointmentId } = await seedAppointmentWithToken();
    const deliveryId = `delivery_booking_retry_${appointmentId}`;
    await db.insert(schema.notificationDeliverySchema).values({
      id: deliveryId,
      salonId: SALON_ID,
      appointmentId,
      channel: 'email',
      purpose: 'booking_confirmation',
      dedupeKey: `test:booking-retry:${appointmentId}`,
      status: 'failed',
      errorCode: 'RESEND_HTTP_503',
      retryable: true,
    });
    let providerCalls = 0;
    let signalProviderEntered!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      signalProviderEntered = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    sendTransactionalEmailDetailed.mockImplementation(async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        signalProviderEntered();
        await providerRelease;
      }
      return {
        ok: true,
        errorCode: null,
        providerMessageId: 'msg_booking_retry',
      };
    });

    const winner = retryCustomerBookingConfirmationEmail({
      salonId: SALON_ID,
      appointmentId,
      deliveryId,
    });
    await providerEntered;
    const loser = await retryCustomerBookingConfirmationEmail({
      salonId: SALON_ID,
      appointmentId,
      deliveryId,
    });
    releaseProvider();
    const winningResult = await winner;

    expect(winningResult.ok).toBe(true);
    expect(loser.ok).toBe(false);
    expect(providerCalls).toBe(1);
  });

  it('lets one real delivery-row claim invoke a recovery retry provider', async () => {
    const { appointmentId } = await seedAppointmentWithToken();
    const deliveryId = `delivery_recovery_retry_${appointmentId}`;
    await db.insert(schema.notificationDeliverySchema).values({
      id: deliveryId,
      salonId: SALON_ID,
      appointmentId,
      channel: 'email',
      purpose: 'booking_recovery',
      dedupeKey: `test:recovery-retry:${appointmentId}`,
      status: 'failed',
      errorCode: 'RESEND_HTTP_503',
      retryable: true,
    });
    let providerCalls = 0;
    let signalProviderEntered!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      signalProviderEntered = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    sendTransactionalEmailDetailed.mockImplementation(async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        signalProviderEntered();
        await providerRelease;
      }
      return {
        ok: true,
        errorCode: null,
        providerMessageId: 'msg_recovery_retry',
      };
    });

    const winner = retryBookingRecoveryEmail({
      salonId: SALON_ID,
      deliveryId,
      appointmentIds: [appointmentId],
    });
    await providerEntered;
    const loser = await retryBookingRecoveryEmail({
      salonId: SALON_ID,
      deliveryId,
      appointmentIds: [appointmentId],
    });
    releaseProvider();
    const winningResult = await winner;

    expect(winningResult.ok).toBe(true);
    expect(loser.ok).toBe(false);
    expect(providerCalls).toBe(1);
  });

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
    expect(sendTransactionalEmailDetailed).toHaveBeenCalledTimes(2);

    const [salonEmail] = detailedEmailsTo('owner@example.com');

    expect(salonEmail).toBeDefined();
    expect(salonEmail!.to).toBe('owner@example.com');
    expect(salonEmail!.subject).toContain('Appointment cancelled: Daniel Smith');
    expect(salonEmail!.text).toContain('Client manage link');
    expect(salonEmail!.text).toContain(
      `appointment=${appointmentId}`,
    );
  });

  it('sends the client confirmation to the current terminal email without changing the snapshot', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();

    await PATCH(cancelRequest(), { params: { token } });

    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);
    expect(detailedEmailsTo('current@example.com')[0]).toMatchObject({
      to: 'current@example.com',
      subject: 'Isla Nail Studio appointment cancelled',
    });
    expect(await customerDeliveriesFor(appointmentId)).toHaveLength(1);

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));

    expect(appointment!.clientEmail).toBe('daniel@example.com');
  });

  it('finishes calendar and stale-capability bookkeeping before customer delivery', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();
    const staleCapability = createOpaqueToken();
    await db.insert(schema.appointmentAccessTokenSchema).values({
      id: `tok_stale_${appointmentId}`,
      salonId: SALON_ID,
      appointmentId,
      tokenHash: staleCapability.tokenHash,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    sendTransactionalEmailDetailed.mockImplementation(async (message) => {
      if ((message as { to: string }).to === 'current@example.com') {
        const [calendarJob, tokens] = await Promise.all([
          db
            .select()
            .from(schema.integrationOutboxSchema)
            .where(and(
              eq(schema.integrationOutboxSchema.appointmentId, appointmentId),
              eq(schema.integrationOutboxSchema.operation, 'delete_event'),
            )),
          db
            .select()
            .from(schema.appointmentAccessTokenSchema)
            .where(eq(
              schema.appointmentAccessTokenSchema.appointmentId,
              appointmentId,
            )),
        ]);

        expect(calendarJob).toHaveLength(1);
        expect(tokens.find(row => row.id === `tok_stale_${appointmentId}`)?.revokedAt)
          .toBeInstanceOf(Date);
      }
      return {
        ok: true,
        errorCode: null,
        providerMessageId: 'msg_manage',
      };
    });

    const response = await PATCH(cancelRequest(), { params: { token } });

    expect(response.status).toBe(200);
    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);
  });

  it('escapes salon markup in the cancellation email body', async () => {
    await db
      .update(schema.salonSchema)
      .set({ name: 'Isla <script>alert(1)</script>' })
      .where(eq(schema.salonSchema.id, SALON_ID));
    const { token } = await seedAppointmentWithToken();

    try {
      const response = await PATCH(cancelRequest(), { params: { token } });

      expect(response.status).toBe(200);

      const [message] = detailedEmailsTo('current@example.com');

      expect(message?.text).toContain('Isla <script>alert(1)</script>');
      expect(message?.html).toContain(
        'Isla &lt;script&gt;alert(1)&lt;/script&gt;',
      );
      expect(message?.html).not.toContain('<script>');
    } finally {
      await db
        .update(schema.salonSchema)
        .set({ name: 'Isla Nail Studio' })
        .where(eq(schema.salonSchema.id, SALON_ID));
    }
  });

  it('does not notify again when the cancellation is repeated', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();

    const first = await PATCH(cancelRequest(), { params: { token } });
    const second = await PATCH(cancelRequest(), { params: { token } });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await salonDeliveriesFor(appointmentId)).toHaveLength(1);
    expect(await customerDeliveriesFor(appointmentId)).toHaveLength(1);
    expect(detailedEmailsTo('owner@example.com')).toHaveLength(1);
    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);
  });

  it('allows only one concurrent cancellation to notify the customer', async () => {
    const { appointmentId, token } = await seedAppointmentWithToken();
    let updateArrivals = 0;
    let markBothArrived!: () => void;
    let releaseUpdates!: () => void;
    const bothArrived = new Promise<void>((resolve) => {
      markBothArrived = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseUpdates = resolve;
    });
    const originalUpdate = db.update.bind(db);
    const updateSpy = vi.spyOn(db, 'update').mockImplementation(((
      table: Parameters<typeof db.update>[0],
    ) => {
      const builder = originalUpdate(table);
      if (table !== schema.appointmentSchema) {
        return builder;
      }
      const originalSet = builder.set.bind(builder);
      builder.set = ((values: Parameters<typeof builder.set>[0]) => {
        const statement = originalSet(values);
        const originalReturning = statement.returning.bind(statement);
        statement.returning = ((
          ...args: Parameters<typeof statement.returning>
        ) => {
          const query = originalReturning(...args);
          const originalThen = query.then.bind(query);
          query.then = (async (
            ...thenArgs: Parameters<typeof query.then>
          ) => {
            updateArrivals += 1;
            if (updateArrivals === 2) {
              markBothArrived();
            }
            await release;
            return originalThen(...thenArgs);
          }) as typeof query.then;
          return query;
        }) as typeof statement.returning;
        return statement;
      }) as typeof builder.set;
      return builder;
    }) as typeof db.update);

    try {
      const pendingResponses = Promise.all([
        PATCH(cancelRequest(), { params: { token } }),
        PATCH(cancelRequest(), { params: { token } }),
      ]);
      await bothArrived;
      releaseUpdates();
      const responses = await pendingResponses;

      expect(updateArrivals).toBe(2);
      expect(responses.map(response => response.status).sort())
        .toEqual([200, 409]);
      expect(await salonDeliveriesFor(appointmentId)).toHaveLength(1);
      expect(await customerDeliveriesFor(appointmentId)).toHaveLength(1);
      expect(detailedEmailsTo('current@example.com')).toHaveLength(1);
    } finally {
      updateSpy.mockRestore();
    }
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
    expect(detailedEmailsTo('owner@example.com')).toHaveLength(0);
    expect(detailedEmailsTo('current@example.com')).toHaveLength(1);

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

  it('keeps the appointment cancelled when current-recipient delivery fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendTransactionalEmailDetailed.mockRejectedValue(
      new Error('provider unavailable'),
    );
    const { appointmentId, token } = await seedAppointmentWithToken();

    const response = await PATCH(cancelRequest(), { params: { token } });

    expect(response.status).toBe(200);

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));

    expect(appointment!.status).toBe('cancelled');
    expect(appointment!.clientEmail).toBe('daniel@example.com');

    vi.restoreAllMocks();
  });

  it('commits cancellation but sends nothing when the current identity is unsupported', async () => {
    await db
      .update(schema.salonClientSchema)
      .set({ email: 'invalid-current-email' })
      .where(eq(schema.salonClientSchema.id, CLIENT_ID));
    const { appointmentId, token } = await seedAppointmentWithToken();

    const response = await PATCH(cancelRequest(), { params: { token } });

    expect(response.status).toBe(200);
    expect(detailedEmailsTo('current@example.com')).toHaveLength(0);
    expect(await customerDeliveriesFor(appointmentId)).toEqual([
      expect.objectContaining({
        status: 'failed',
        errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
      }),
    ]);

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));

    expect(appointment!.status).toBe('cancelled');
    expect(appointment!.clientEmail).toBe('daniel@example.com');

    await db
      .update(schema.salonClientSchema)
      .set({ email: 'current@example.com' })
      .where(eq(schema.salonClientSchema.id, CLIENT_ID));
  });
});
