/**
 * D5 confirmation-outbox delivery semantics.
 *
 * These tests use the real PGlite schema and real outbox/confirmation handler
 * dispatch. Only external side-effect modules are replaced. In particular,
 * the customer-email notification ledger is real: T20 would resend if its
 * persisted dedupe claim were removed. Assertions about the mocked SMS and
 * internal-notification functions cover aggregate invocation semantics, not
 * Twilio's provider-failure behavior.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const emailEnvironment = vi.hoisted(() => {
  const original = {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.RESEND_API_KEY = 'ci-placeholder-not-a-secret';
  process.env.RESEND_FROM_EMAIL = 'notifications@example.invalid';
  return original;
});

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  usesRuntimePostgres: false,
  DatabaseSessionReleaseError: class DatabaseSessionReleaseError extends Error {},
  withDedicatedDatabaseSession: async (work: (database: unknown) => unknown) => work(holder.db),
}));

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => sentry);

const externalEffects = vi.hoisted(() => ({
  deterministicGoogleCalendarEventId: vi.fn((input: {
    appointmentId: string;
    idempotencyKey: string;
    salonId: string;
  }) => `deterministic:${input.salonId}:${input.appointmentId}:${input.idempotencyKey}`),
  sendBookingConfirmationToClient: vi.fn(),
  sendBookingNotificationsForNewBooking: vi.fn(),
  sendSalonNotificationEmail: vi.fn(),
  syncGoogleCalendarEventForAppointment: vi.fn(),
  deleteGoogleCalendarEventForAppointment: vi.fn(),
  listGoogleCalendarEventsForSalon: vi.fn(),
}));

vi.mock('@/libs/SMS', () => ({
  sendBookingConfirmationToClient: externalEffects.sendBookingConfirmationToClient,
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForNewBooking:
    externalEffects.sendBookingNotificationsForNewBooking,
}));

vi.mock('@/libs/salonNotificationEmail', () => ({
  sendSalonNotificationEmail: externalEffects.sendSalonNotificationEmail,
}));

vi.mock('@/libs/googleCalendar', () => ({
  deterministicGoogleCalendarEventId:
    externalEffects.deterministicGoogleCalendarEventId,
  deleteGoogleCalendarEventForAppointment: (
    input: unknown,
    options: { dispatchFence?: <T>(operation: () => Promise<T>) => Promise<T> } = {},
  ) => {
    const operation = () => externalEffects.deleteGoogleCalendarEventForAppointment(
      input,
      options,
    );
    return options.dispatchFence ? options.dispatchFence(operation) : operation();
  },
  listGoogleCalendarEventsForSalon: externalEffects.listGoogleCalendarEventsForSalon,
  syncGoogleCalendarEventForAppointment: (
    input: unknown,
    options: { dispatchFence?: <T>(operation: () => Promise<T>) => Promise<T> } = {},
  ) => {
    const operation = () => externalEffects.syncGoogleCalendarEventForAppointment(
      input,
      options,
    );
    return options.dispatchFence ? options.dispatchFence(operation) : operation();
  },
}));

/* eslint-disable import/first */
import {
  enqueueGoogleCalendarAppointmentMutation,
  enqueueGoogleCalendarDeleteInTx,
  enqueueGoogleCalendarUpsert,
  processIntegrationOutbox,
} from '@/libs/integrationOutbox';

/* eslint-enable import/first */

const SALON_ID = 'salon_outbox_d5';
const CLIENT_ID = 'client_outbox_d5';
const APPOINTMENT_ID = 'appt_outbox_d5';
const DEPOSIT_ID = 'dep_outbox_d5';
const DUE = new Date('2000-01-01T00:00:00.000Z');
const NOT_DUE = new Date('2099-01-01T00:00:00.000Z');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const providerEmail = vi.fn();

async function seedConfirmationJob(googleCalendarSyncEligible = false) {
  await db.insert(schema.integrationOutboxSchema).values({
    id: 'job_outbox_d5',
    salonId: SALON_ID,
    appointmentId: APPOINTMENT_ID,
    provider: 'email',
    operation: 'booking_confirmed_side_effects',
    dedupeKey: `deposit:${DEPOSIT_ID}:confirmed-side-effects`,
    payload: {
      appliedRewardId: null,
      depositId: DEPOSIT_ID,
      googleCalendarSyncEligible,
      manageUrl: 'https://app.luster.test/manage/d5-capability',
      smsConsentGranted: true,
    },
  });
}

async function readCalendarJobs() {
  return db.select().from(schema.integrationOutboxSchema)
    .where(eq(schema.integrationOutboxSchema.provider, 'google_calendar'));
}

async function readJob() {
  const [job] = await db.select().from(schema.integrationOutboxSchema)
    .where(eq(schema.integrationOutboxSchema.id, 'job_outbox_d5'));
  return job;
}

async function simulateLostCompletionWrite(jobId: string) {
  // Model the durable state left when the handler returned but the worker died
  // before its final `completed` update committed. The real worker reclaims
  // this stale processing lease and invokes the aggregate handler again.
  await db.update(schema.integrationOutboxSchema).set({
    status: 'processing',
    processedAt: null,
    updatedAt: new Date(Date.now() - 16 * 60_000),
  }).where(eq(schema.integrationOutboxSchema.id, jobId));
}

function calendarInput(startTime: Date, endTime: Date) {
  return {
    appointmentId: APPOINTMENT_ID,
    salonId: SALON_ID,
    salonName: 'D5 Salon',
    clientName: 'D5 Client',
    clientPhone: '4165550100',
    serviceNames: [],
    technicianName: null,
    startTime,
    endTime,
    totalPrice: 7500,
    totalDurationMinutes: 60,
    timeZone: 'America/Toronto',
    locationName: null,
    locationAddress: null,
    notes: null,
    googleCalendarEventId: null,
  };
}

async function enqueueCurrentAppointmentMutation() {
  const [appointment] = await db.select().from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
  return db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
    appointmentId: APPOINTMENT_ID,
    salonId: SALON_ID,
    mutationVersion: appointment!.updatedAt,
  }));
}

async function seedBidirectionalMirror(input: {
  id: string;
  calendarId: string;
  eventId: string;
}) {
  const [appointment] = await db.select().from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
  await db.insert(schema.googleCalendarEventSchema).values({
    id: input.id,
    salonId: SALON_ID,
    calendarId: input.calendarId,
    googleEventId: input.eventId,
    appointmentId: APPOINTMENT_ID,
    sourceAccessRole: 'writer',
    syncMode: 'bidirectional',
    startTime: appointment!.startTime,
    endTime: appointment!.endTime,
    durationMinutes: appointment!.totalDurationMinutes,
    reviewStatus: 'appointment',
  });
}

function persistSuccessfulCalendarSync() {
  externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValue({
    eventId: 'google_event_d5',
    status: 'synced',
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.notificationDeliverySchema);
  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.googleCalendarEventSchema);
  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.appointmentAccessTokenSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentServicesSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.serviceSchema);
  await db.delete(schema.salonClientSchema);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.salonGoogleCalendarConnectionSchema);
  await db.delete(schema.salonSchema);

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'D5 Salon',
    ownerEmail: null,
    slug: 'd5-outbox-salon',
  });
  await db.insert(schema.salonGoogleCalendarConnectionSchema).values({
    salonId: SALON_ID,
    encryptedRefreshToken: 'encrypted-test-token',
    destinationCalendarId: 'destination_calendar',
    busyCalendarIds: ['destination_calendar'],
    status: 'active',
  });
  await db.insert(schema.salonClientSchema).values({
    id: CLIENT_ID,
    salonId: SALON_ID,
    email: 'client@example.com',
    fullName: 'D5 Client',
    phone: '4165550100',
  });
  await db.insert(schema.salonStripeAccountSchema).values({
    id: 'ssa_outbox_d5',
    salonId: SALON_ID,
    stripeAccountId: 'acct_outbox_d5',
    livemode: false,
  });
  const startTime = new Date(Date.now() + 86_400_000);
  await db.insert(schema.appointmentSchema).values({
    id: APPOINTMENT_ID,
    salonId: SALON_ID,
    salonClientId: CLIENT_ID,
    clientEmail: 'client@example.com',
    clientName: 'D5 Client',
    clientPhone: '4165550100',
    endTime: new Date(startTime.getTime() + 3_600_000),
    startTime,
    status: 'confirmed',
    totalDurationMinutes: 60,
    totalPrice: 7500,
  });
  await db.insert(schema.appointmentDepositSchema).values({
    id: DEPOSIT_ID,
    salonId: SALON_ID,
    appointmentId: APPOINTMENT_ID,
    amountCents: 2500,
    status: 'paid',
    stripeAccountId: 'acct_outbox_d5',
    stripeCheckoutSessionId: 'cs_outbox_d5',
    stripePaymentIntentId: 'pi_outbox_d5',
  });

  externalEffects.sendBookingConfirmationToClient.mockRejectedValue(
    new Error('SMS provider failed'),
  );
  externalEffects.sendBookingNotificationsForNewBooking.mockResolvedValue(undefined);
  externalEffects.sendSalonNotificationEmail.mockResolvedValue(undefined);
  providerEmail.mockResolvedValue(new Response(
    JSON.stringify({ id: 'email_d5_1' }),
    {
      headers: { 'content-type': 'application/json' },
      status: 200,
    },
  ));
  vi.stubGlobal('fetch', providerEmail);
  externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValue({
    eventId: 'google_event_d5',
    status: 'synced',
  });
  externalEffects.deleteGoogleCalendarEventForAppointment.mockResolvedValue({
    status: 'deleted',
  });
  externalEffects.listGoogleCalendarEventsForSalon.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (emailEnvironment.apiKey === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = emailEnvironment.apiKey;
  }
  if (emailEnvironment.from === undefined) {
    delete process.env.RESEND_FROM_EMAIL;
  } else {
    process.env.RESEND_FROM_EMAIL = emailEnvironment.from;
  }
  await client.close();
});

describe('D5 integration outbox', () => {
  it('schedules one calendar upsert after paid confirmation and calls Google only on its worker pass', async () => {
    externalEffects.sendBookingConfirmationToClient.mockResolvedValue(undefined);
    await seedConfirmationJob(true);

    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    expect(await readCalendarJobs()).toHaveLength(0);
    expect(externalEffects.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();

    expect(await processIntegrationOutbox()).toMatchObject({
      failed: 0,
      retried: 0,
      scanned: 1,
      succeeded: 1,
    });
    expect((await readJob())?.status).toBe('completed');

    const [calendarJob] = await readCalendarJobs();

    expect(calendarJob).toEqual(expect.objectContaining({
      appointmentId: APPOINTMENT_ID,
      attempts: 0,
      dedupeKey: `google:${SALON_ID}:${APPOINTMENT_ID}:upsert:deposit-confirmation:job_outbox_d5`,
      operation: 'upsert_event',
      provider: 'google_calendar',
      salonId: SALON_ID,
      status: 'pending',
    }));
    expect(calendarJob?.payload).toEqual(expect.objectContaining({
      appointmentId: APPOINTMENT_ID,
      clientName: 'D5 Client',
      clientPhone: '4165550100',
      endTime: appointment!.endTime.toISOString(),
      googleCalendarEventId: null,
      locationAddress: null,
      locationName: null,
      notes: null,
      salonId: SALON_ID,
      salonName: 'D5 Salon',
      serviceNames: [],
      startTime: appointment!.startTime.toISOString(),
      technicianName: null,
      timeZone: 'America/Toronto',
      totalDurationMinutes: 60,
      totalPrice: 7500,
    }));
    expect(externalEffects.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0]?.googleCalendarSyncStatus)
      .toBe('pending');

    expect(await processIntegrationOutbox()).toMatchObject({
      failed: 0,
      retried: 0,
      scanned: 1,
      succeeded: 1,
    });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: APPOINTMENT_ID,
        endTime: appointment!.endTime,
        googleCalendarEventId: null,
        salonId: SALON_ID,
        startTime: appointment!.startTime,
      }),
      expect.objectContaining({ persistResult: false, signal: expect.any(AbortSignal) }),
    );
    expect((await readCalendarJobs())[0]?.status).toBe('completed');

    expect(await processIntegrationOutbox()).toMatchObject({ scanned: 0, succeeded: 0 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
  });

  it('keeps one calendar operation when the confirmation batch replays after a later effect fails', async () => {
    externalEffects.sendBookingConfirmationToClient.mockResolvedValue(undefined);
    externalEffects.sendBookingNotificationsForNewBooking
      .mockRejectedValueOnce(new Error('later booking effect failed'))
      .mockResolvedValue(undefined);
    await seedConfirmationJob(true);

    expect(await processIntegrationOutbox()).toMatchObject({
      failed: 0,
      retried: 1,
      scanned: 1,
      succeeded: 0,
    });

    const [originalCalendarJob] = await readCalendarJobs();

    expect(originalCalendarJob).toBeDefined();
    expect(externalEffects.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();

    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: NOT_DUE })
      .where(eq(schema.integrationOutboxSchema.id, originalCalendarJob!.id));
    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, 'job_outbox_d5'));

    expect(await processIntegrationOutbox()).toMatchObject({
      failed: 0,
      retried: 0,
      scanned: 1,
      succeeded: 1,
    });

    const calendarJobs = await readCalendarJobs();

    expect(calendarJobs).toHaveLength(1);
    expect(calendarJobs[0]?.id).toBe(originalCalendarJob!.id);
    expect(calendarJobs[0]?.dedupeKey).toBe(originalCalendarJob!.dedupeKey);
    expect(externalEffects.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();

    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, originalCalendarJob!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
  });

  it('keeps one immutable confirmation child and fences delayed A after a legitimate move to B', async () => {
    externalEffects.sendBookingConfirmationToClient.mockResolvedValue(undefined);
    externalEffects.sendBookingNotificationsForNewBooking
      .mockRejectedValueOnce(new Error('later booking effect failed'))
      .mockResolvedValue(undefined);
    await seedConfirmationJob(true);
    const [appointmentAtA] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    expect(await processIntegrationOutbox()).toMatchObject({ retried: 1, scanned: 1 });

    const [confirmationA] = await readCalendarJobs();

    expect(confirmationA).toEqual(expect.objectContaining({
      dedupeKey: `google:${SALON_ID}:${APPOINTMENT_ID}:upsert:deposit-confirmation:job_outbox_d5`,
      status: 'pending',
    }));

    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: NOT_DUE })
      .where(eq(schema.integrationOutboxSchema.id, confirmationA!.id));
    const startB = new Date(appointmentAtA!.startTime.getTime() + 2 * 60 * 60_000);
    const endB = new Date(appointmentAtA!.endTime.getTime() + 2 * 60 * 60_000);
    await db.update(schema.appointmentSchema)
      .set({ startTime: startB, endTime: endB })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();

    const beforeReplay = await readCalendarJobs();
    const legitimateB = beforeReplay.find(job => job.id !== confirmationA!.id);

    expect(legitimateB).toEqual(expect.objectContaining({
      dedupeKey: expect.stringContaining(`google:${SALON_ID}:${APPOINTMENT_ID}:sync:appointment-mutation:`),
      status: 'pending',
    }));

    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: NOT_DUE })
      .where(eq(schema.integrationOutboxSchema.id, legitimateB!.id));
    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, 'job_outbox_d5'));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });

    const afterReplay = await readCalendarJobs();

    expect(afterReplay).toHaveLength(2);
    expect(afterReplay.filter(job => job.dedupeKey.includes('deposit-confirmation')))
      .toEqual([expect.objectContaining({
        id: confirmationA!.id,
        dedupeKey: confirmationA!.dedupeKey,
        payload: expect.objectContaining({
          startTime: appointmentAtA!.startTime.toISOString(),
          endTime: appointmentAtA!.endTime.toISOString(),
        }),
      })]);

    persistSuccessfulCalendarSync();
    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, legitimateB!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenLastCalledWith(
      expect.objectContaining({ startTime: startB, endTime: endB }),
      expect.objectContaining({ persistResult: false, signal: expect.any(AbortSignal) }),
    );

    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, confirmationA!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);

    const finalChildren = await readCalendarJobs();

    expect(finalChildren.find(job => job.id === confirmationA!.id)).toEqual(
      expect.objectContaining({ status: 'cancelled', lastError: 'SUPERSEDED' }),
    );
    expect(finalChildren.find(job => job.id === legitimateB!.id)).toEqual(
      expect.objectContaining({ status: 'completed' }),
    );
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        startTime: startB,
        endTime: endB,
        googleCalendarSyncStatus: 'synced',
      }));
  });

  it('fences stale A before provider execution when A is scanned before B', async () => {
    const [appointmentAtA] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueGoogleCalendarUpsert(
      calendarInput(appointmentAtA!.startTime, appointmentAtA!.endTime),
      {
        cause: {
          kind: 'deposit_confirmation',
          parentJobId: 'parent_a_before_b',
        },
        mutationVersion: appointmentAtA!.updatedAt,
      },
    );
    const [staleA] = await readCalendarJobs();
    const startB = new Date(appointmentAtA!.startTime.getTime() + 3 * 60 * 60_000);
    const endB = new Date(appointmentAtA!.endTime.getTime() + 3 * 60 * 60_000);
    await db.update(schema.appointmentSchema)
      .set({ startTime: startB, endTime: endB })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();
    const legitimateB = (await readCalendarJobs()).find(job => job.id !== staleA!.id);
    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: NOT_DUE })
      .where(eq(schema.integrationOutboxSchema.id, legitimateB!.id));
    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, staleA!.id));
    persistSuccessfulCalendarSync();

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect((await readCalendarJobs()).find(job => job.id === staleA!.id))
      .toEqual(expect.objectContaining({ status: 'cancelled', lastError: 'SUPERSEDED' }));

    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, legitimateB!.id));

    expect(await processIntegrationOutbox()).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: startB, endTime: endB }),
      expect.objectContaining({ persistResult: false, signal: expect.any(AbortSignal) }),
    );
  });

  it('never deletes a canonical identity adopted by a newer intent', async () => {
    const [appointmentAtA] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();
    const [intentA] = await readCalendarJobs();
    externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'failed',
      error: 'response lost after remote acceptance',
      createAttempted: true,
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ retried: 1, scanned: 1 });

    expect((await readCalendarJobs()).find(job => job.operation === 'delete_event'))
      .toBeUndefined();

    const startB = new Date(appointmentAtA!.startTime.getTime() + 90 * 60_000);
    const endB = new Date(appointmentAtA!.endTime.getTime() + 90 * 60_000);
    await db.update(schema.appointmentSchema).set({
      startTime: startB,
      endTime: endB,
      updatedAt: new Date(appointmentAtA!.updatedAt.getTime() + 1),
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();
    const intentB = (await readCalendarJobs()).find(job => job.id !== intentA!.id);
    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: NOT_DUE })
      .where(eq(schema.integrationOutboxSchema.id, intentB!.id));
    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, intentA!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);

    const afterSupersession = await readCalendarJobs();

    expect(afterSupersession.find(job => job.id === intentA!.id)).toEqual(
      expect.objectContaining({ status: 'cancelled', lastError: 'SUPERSEDED' }),
    );
    expect(afterSupersession.find(job => job.operation === 'delete_event'))
      .toBeUndefined();

    persistSuccessfulCalendarSync();
    await db.update(schema.integrationOutboxSchema).set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, intentB!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });

    expect(externalEffects.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        googleCalendarEventId: 'google_event_d5',
        googleCalendarSyncStatus: 'synced',
        startTime: startB,
      }));
  });

  it('pins one target calendar across an ambiguous retry after destination changes', async () => {
    await enqueueCurrentAppointmentMutation();
    const [intent] = await readCalendarJobs();
    externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'failed',
      error: 'response lost after remote acceptance',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, retried: 1 });

    const [afterFailure] = await readCalendarJobs();

    expect(afterFailure!.payload).toEqual(expect.objectContaining({
      targetCalendarId: 'destination_calendar',
    }));

    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      destinationCalendarId: 'replacement_calendar',
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: null,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.update(schema.integrationOutboxSchema).set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, intent!.id));
    externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'synced',
      eventId: 'google_event_pinned_calendar',
      calendarId: 'destination_calendar',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(2);

    for (const call of externalEffects.syncGoogleCalendarEventForAppointment.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({
        targetCalendarId: 'destination_calendar',
      }));
    }

    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        googleCalendarEventId: 'google_event_pinned_calendar',
        googleCalendarSyncStatus: 'synced',
      }));
  });

  it('adopts an authoritative mirror that appears after target pinning but before dispatch', async () => {
    await enqueueCurrentAppointmentMutation();
    const [intent] = await readCalendarJobs();

    expect(intent?.payload).toEqual(expect.objectContaining({
      targetCalendarId: 'destination_calendar',
    }));
    expect(intent?.payload).not.toEqual(expect.objectContaining({
      googleCalendarEventId: expect.any(String),
    }));

    await seedBidirectionalMirror({
      id: 'gce_appeared_after_enqueue',
      calendarId: 'destination_calendar',
      eventId: 'event_appeared_after_enqueue',
    });
    externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'synced',
      eventId: 'event_appeared_after_enqueue',
      calendarId: 'destination_calendar',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        googleCalendarEventId: 'event_appeared_after_enqueue',
      }),
      expect.objectContaining({ targetCalendarId: 'destination_calendar' }),
    );
    expect((await readCalendarJobs())[0]?.payload).toEqual(expect.objectContaining({
      googleCalendarEventId: 'event_appeared_after_enqueue',
      targetCalendarId: 'destination_calendar',
    }));
  });

  it('inherits the successful D1 mirror for later mutation and deletion after destination changes to D2', async () => {
    await enqueueCurrentAppointmentMutation();
    externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'synced',
      eventId: 'google_event_owned_d1',
      calendarId: 'destination_calendar',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(await db.select().from(schema.googleCalendarEventSchema)).toEqual([
      expect.objectContaining({
        appointmentId: APPOINTMENT_ID,
        calendarId: 'destination_calendar',
        googleEventId: 'google_event_owned_d1',
        syncMode: 'bidirectional',
      }),
    ]);

    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      destinationCalendarId: 'replacement_calendar',
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    const [beforeMove] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const moveVersion = new Date(beforeMove!.updatedAt.getTime() + 1);
    await db.update(schema.appointmentSchema).set({
      startTime: new Date(beforeMove!.startTime.getTime() + 60_000),
      endTime: new Date(beforeMove!.endTime.getTime() + 60_000),
      updatedAt: moveVersion,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();
    const moveJob = (await readCalendarJobs()).find(job => (
      job.status === 'pending' && job.operation === 'sync_appointment'
    ));

    expect(moveJob?.payload).toEqual(expect.objectContaining({
      googleCalendarEventId: 'google_event_owned_d1',
      targetCalendarId: 'destination_calendar',
    }));

    externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'synced',
      eventId: 'google_event_owned_d1',
      calendarId: 'destination_calendar',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenLastCalledWith(
      expect.objectContaining({ googleCalendarEventId: 'google_event_owned_d1' }),
      expect.objectContaining({ targetCalendarId: 'destination_calendar' }),
    );

    const terminalVersion = new Date(moveVersion.getTime() + 1);
    await db.transaction(async (tx) => {
      await tx.update(schema.appointmentSchema).set({
        status: 'cancelled',
        canvasState: 'cancelled',
        updatedAt: terminalVersion,
      }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
      await enqueueGoogleCalendarDeleteInTx(tx, {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: terminalVersion,
        googleCalendarEventId: 'google_event_owned_d1',
      });
    });
    const deleteJob = (await readCalendarJobs()).find(job => (
      job.status === 'pending' && job.operation === 'delete_event'
    ));

    expect(deleteJob?.payload).toEqual(expect.objectContaining({
      googleCalendarEventId: 'google_event_owned_d1',
      targetCalendarId: 'destination_calendar',
    }));

    externalEffects.deleteGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'deleted',
      eventId: 'google_event_owned_d1',
      calendarId: 'destination_calendar',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ googleCalendarEventId: 'google_event_owned_d1' }),
      expect.objectContaining({ targetCalendarId: 'destination_calendar' }),
    );
    expect((await db.select().from(schema.googleCalendarEventSchema))[0])
      .toEqual(expect.objectContaining({
        calendarId: 'destination_calendar',
        deletedAt: expect.any(Date),
      }));
  });

  it('scopes obsolete-result cleanup adoption and bookkeeping to the exact calendar', async () => {
    await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: 'same_event_id',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_same_id_d2',
      calendarId: 'replacement_calendar',
      eventId: 'same_event_id',
    });
    await db.insert(schema.integrationOutboxSchema).values({
      id: 'cleanup_same_id_d1',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'delete_event',
      dedupeKey: 'cleanup:same-id:d1',
      payload: {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: null,
        googleCalendarEventId: 'same_event_id',
        targetCalendarId: 'destination_calendar',
        cleanup: true,
      },
    });
    externalEffects.deleteGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'deleted',
      eventId: 'same_event_id',
      calendarId: 'destination_calendar',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ googleCalendarEventId: 'same_event_id' }),
      expect.objectContaining({ targetCalendarId: 'destination_calendar' }),
    );
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({ googleCalendarEventId: 'same_event_id' }));
    expect((await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, 'gce_same_id_d2')))[0])
      .toEqual(expect.objectContaining({ deletedAt: null }));

    await db.insert(schema.integrationOutboxSchema).values({
      id: 'cleanup_same_id_d2',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'delete_event',
      dedupeKey: 'cleanup:same-id:d2',
      payload: {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: null,
        googleCalendarEventId: 'same_event_id',
        targetCalendarId: 'replacement_calendar',
        cleanup: true,
      },
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect((await readCalendarJobs()).find(job => job.id === 'cleanup_same_id_d2'))
      .toEqual(expect.objectContaining({ status: 'cancelled', lastError: 'SUPERSEDED' }));
  });

  it('cancels delayed cleanup when the exact writable mirror remains authoritative', async () => {
    await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: null,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_cleanup_adopted_without_scalar',
      calendarId: 'destination_calendar',
      eventId: 'adopted_without_scalar',
    });
    await db.insert(schema.integrationOutboxSchema).values({
      id: 'cleanup_adopted_without_scalar',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'delete_event',
      dedupeKey: 'cleanup:adopted-without-scalar',
      payload: {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: null,
        googleCalendarEventId: 'adopted_without_scalar',
        targetCalendarId: 'destination_calendar',
        cleanup: true,
      },
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect((await readCalendarJobs())[0]).toEqual(expect.objectContaining({
      status: 'cancelled',
      lastError: 'SUPERSEDED',
    }));
    expect((await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, 'gce_cleanup_adopted_without_scalar')))[0])
      .toEqual(expect.objectContaining({ deletedAt: null }));
  });

  it('retains appointment provider state while another writable mirror remains', async () => {
    await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
      canvasState: 'cancelled',
      googleCalendarEventId: 'legacy_deleted_event',
      googleCalendarSyncStatus: 'pending_deletion',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_legacy_deleted_pair',
      calendarId: 'destination_calendar',
      eventId: 'legacy_deleted_event',
    });
    await seedBidirectionalMirror({
      id: 'gce_legacy_surviving_pair',
      calendarId: 'replacement_calendar',
      eventId: 'different_surviving_event',
    });
    await db.insert(schema.integrationOutboxSchema).values({
      id: 'delete_one_legacy_pair',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'delete_event',
      dedupeKey: 'delete:one-legacy-pair',
      payload: {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: null,
        googleCalendarEventId: 'legacy_deleted_event',
        targetCalendarId: 'destination_calendar',
        cleanup: true,
      },
    });
    externalEffects.deleteGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'deleted',
      eventId: 'legacy_deleted_event',
      calendarId: 'destination_calendar',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect((await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, 'gce_legacy_deleted_pair')))[0])
      .toEqual(expect.objectContaining({ deletedAt: expect.any(Date) }));
    expect((await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, 'gce_legacy_surviving_pair')))[0])
      .toEqual(expect.objectContaining({ deletedAt: null }));
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        googleCalendarEventId: 'legacy_deleted_event',
        googleCalendarSyncStatus: 'pending_deletion',
      }));
  });

  it('derives a null appointment event id from one active mirror and no-ops without one', async () => {
    const [terminal] = await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
      canvasState: 'cancelled',
      googleCalendarEventId: null,
      updatedAt: new Date(Date.now() + 1),
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();

    const noMirror = await db.transaction(tx => enqueueGoogleCalendarDeleteInTx(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: terminal!.updatedAt,
      googleCalendarEventId: null,
    }));

    expect(noMirror).toEqual({ inserted: false, reason: 'no_event' });
    expect(await readCalendarJobs()).toHaveLength(0);
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({ googleCalendarSyncStatus: 'not_synced' }));

    await seedBidirectionalMirror({
      id: 'gce_null_appointment_id',
      calendarId: 'destination_calendar',
      eventId: 'mirror_owned_event',
    });
    const fromMirror = await db.transaction(tx => enqueueGoogleCalendarDeleteInTx(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: terminal!.updatedAt,
      googleCalendarEventId: null,
    }));

    expect(fromMirror).toEqual(expect.objectContaining({ inserted: true }));
    expect((await readCalendarJobs())[0]?.payload).toEqual(expect.objectContaining({
      googleCalendarEventId: 'mirror_owned_event',
      targetCalendarId: 'destination_calendar',
    }));

    externalEffects.deleteGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'deleted',
      eventId: 'mirror_owned_event',
      calendarId: 'destination_calendar',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ googleCalendarEventId: 'mirror_owned_event' }),
      expect.objectContaining({ targetCalendarId: 'destination_calendar' }),
    );
    expect((await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, 'gce_null_appointment_id')))[0])
      .toEqual(expect.objectContaining({ deletedAt: expect.any(Date) }));
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        googleCalendarEventId: null,
        googleCalendarSyncStatus: 'deleted',
      }));
  });

  it('fails closed instead of choosing between multiple active calendar mirrors', async () => {
    const [terminal] = await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
      canvasState: 'cancelled',
      googleCalendarEventId: null,
      updatedAt: new Date(Date.now() + 1),
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
    await seedBidirectionalMirror({
      id: 'gce_ambiguous_d1',
      calendarId: 'destination_calendar',
      eventId: 'ambiguous_event',
    });
    await seedBidirectionalMirror({
      id: 'gce_ambiguous_d2',
      calendarId: 'replacement_calendar',
      eventId: 'ambiguous_event',
    });

    await expect(db.transaction(tx => enqueueGoogleCalendarDeleteInTx(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: terminal!.updatedAt,
      googleCalendarEventId: null,
    }))).rejects.toThrow('GOOGLE_CALENDAR_MIRROR_AMBIGUOUS');
    expect(await readCalendarJobs()).toEqual([]);
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({ googleCalendarSyncStatus: 'not_synced' }));
  });

  it('rejects a stale explicit event id instead of deleting beside the unique mirror', async () => {
    const [terminal] = await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
      canvasState: 'cancelled',
      googleCalendarEventId: 'stale_scalar_event',
      updatedAt: new Date(Date.now() + 1),
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
    await seedBidirectionalMirror({
      id: 'gce_unique_delete_identity',
      calendarId: 'destination_calendar',
      eventId: 'authoritative_mirror_event',
    });

    await expect(db.transaction(tx => enqueueGoogleCalendarDeleteInTx(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: terminal!.updatedAt,
      googleCalendarEventId: 'stale_scalar_event',
    }))).rejects.toThrow('GOOGLE_CALENDAR_EVENT_ID_CONFLICT');
    expect(await readCalendarJobs()).toEqual([]);
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
  });

  it('does not guess today\'s destination for an unattributed legacy event id', async () => {
    const [appointment] = await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: 'unattributed_legacy_event',
      updatedAt: new Date(Date.now() + 1),
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();

    await expect(db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: appointment!.updatedAt,
    }))).rejects.toThrow('GOOGLE_CALENDAR_TARGET_UNATTRIBUTED');
    expect(await readCalendarJobs()).toEqual([]);
    expect(externalEffects.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
  });

  it('reconciles equal Google event ids independently in each calendar', async () => {
    await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
      canvasState: 'cancelled',
      googleCalendarEventId: 'same_reconciliation_id',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_reconciliation_d1',
      calendarId: 'destination_calendar',
      eventId: 'same_reconciliation_id',
    });
    await seedBidirectionalMirror({
      id: 'gce_reconciliation_d2',
      calendarId: 'replacement_calendar',
      eventId: 'same_reconciliation_id',
    });

    expect(await processIntegrationOutbox(0)).toMatchObject({
      cancelledEventCandidates: 2,
      queuedCancelledEvents: 2,
      scanned: 0,
    });

    const deleteJobs = await readCalendarJobs();

    expect(deleteJobs).toHaveLength(2);
    expect(deleteJobs.map(job => (
      (job.payload as { targetCalendarId: string }).targetCalendarId
    )).sort()).toEqual(['destination_calendar', 'replacement_calendar']);
    expect(new Set(deleteJobs.map(job => job.dedupeKey)).size).toBe(2);
  });

  it('dispatches reconciliation for a tombstoned same-owner mirror and records the exact row', async () => {
    await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
      canvasState: 'cancelled',
      googleCalendarEventId: 'remote_tombstone_still_live',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_remote_tombstone_still_live',
      calendarId: 'destination_calendar',
      eventId: 'remote_tombstone_still_live',
    });
    await db.update(schema.googleCalendarEventSchema).set({
      deletedAt: new Date('2026-08-01T00:00:00.000Z'),
      googleStatus: 'cancelled',
    }).where(eq(
      schema.googleCalendarEventSchema.id,
      'gce_remote_tombstone_still_live',
    ));
    externalEffects.listGoogleCalendarEventsForSalon.mockResolvedValueOnce([{
      id: 'remote_tombstone_still_live',
      calendarId: 'destination_calendar',
      status: 'confirmed',
      summary: 'D5 appointment',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: new Date(Date.now() + 86_400_000),
      endTime: new Date(Date.now() + 90_000_000),
      updatedAt: new Date(),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
    }]);

    expect(await processIntegrationOutbox(1)).toMatchObject({
      remoteCancelledEventCandidates: 1,
      queuedCancelledEvents: 1,
    });

    const [job] = await readCalendarJobs();

    expect(job?.payload).toEqual(expect.objectContaining({
      reconciliationMirrorId: 'gce_remote_tombstone_still_live',
      reconciliationExpectedAppointmentId: APPOINTMENT_ID,
    }));

    externalEffects.listGoogleCalendarEventsForSalon.mockResolvedValue([]);
    externalEffects.deleteGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'deleted',
      eventId: 'remote_tombstone_still_live',
      calendarId: 'destination_calendar',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ googleCalendarEventId: 'remote_tombstone_still_live' }),
      expect.objectContaining({
        reconciliationMirrorId: 'gce_remote_tombstone_still_live',
        reconciliationExpectedAppointmentId: APPOINTMENT_ID,
      }),
    );
    expect((await db.select().from(schema.googleCalendarEventSchema).where(eq(
      schema.googleCalendarEventSchema.id,
      'gce_remote_tombstone_still_live',
    )))[0]).toEqual(expect.objectContaining({
      googleStatus: 'cancelled',
      deletedAt: expect.any(Date),
    }));
  });

  it('does not guess a configured destination for scalar-only or read-only mirrors', async () => {
    await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
      canvasState: 'cancelled',
      googleCalendarEventId: 'readonly_source_event',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.insert(schema.googleCalendarEventSchema).values({
      id: 'gce_readonly_reconciliation_source',
      salonId: SALON_ID,
      calendarId: 'readonly_source_calendar',
      googleEventId: 'readonly_source_event',
      appointmentId: APPOINTMENT_ID,
      sourceAccessRole: 'reader',
      syncMode: 'inbound_only',
      startTime: appointment!.startTime,
      endTime: appointment!.endTime,
      durationMinutes: appointment!.totalDurationMinutes,
      reviewStatus: 'appointment',
    });

    expect(await processIntegrationOutbox(0)).toMatchObject({
      cancelledEventCandidates: 0,
      queuedCancelledEvents: 0,
      scanned: 0,
    });
    expect(await readCalendarJobs()).toEqual([]);

    await db.delete(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, 'gce_readonly_reconciliation_source'));

    expect(await processIntegrationOutbox(0)).toMatchObject({
      cancelledEventCandidates: 0,
      queuedCancelledEvents: 0,
      scanned: 0,
    });
    expect(await readCalendarJobs()).toEqual([]);
  });

  it('keeps a reconciliation delete retryable when the provider is disabled', async () => {
    await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
      canvasState: 'cancelled',
      googleCalendarEventId: 'disabled_reconciliation_event',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_disabled_reconciliation',
      calendarId: 'destination_calendar',
      eventId: 'disabled_reconciliation_event',
    });

    expect(await processIntegrationOutbox(0)).toMatchObject({
      queuedCancelledEvents: 1,
      scanned: 0,
    });

    externalEffects.deleteGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      status: 'disabled',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, retried: 1 });
    expect((await readCalendarJobs())[0]).toEqual(expect.objectContaining({
      status: 'retry',
      lastError: 'GOOGLE_CALENDAR_RECONCILIATION_DISABLED',
    }));
  });

  it('cancels a reconciliation delete if its immutable mirror is claimed by another appointment', async () => {
    await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
      canvasState: 'cancelled',
      googleCalendarEventId: 'reconciliation_claim_race',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_reconciliation_claim_race',
      calendarId: 'destination_calendar',
      eventId: 'reconciliation_claim_race',
    });

    expect(await processIntegrationOutbox(0)).toMatchObject({ queuedCancelledEvents: 1 });
    expect((await readCalendarJobs())[0]?.payload).toEqual(expect.objectContaining({
      reconciliationMirrorId: 'gce_reconciliation_claim_race',
      reconciliationExpectedAppointmentId: APPOINTMENT_ID,
    }));

    const secondStart = new Date(Date.now() + 172_800_000);
    await db.insert(schema.appointmentSchema).values({
      id: 'appt_reconciliation_new_owner',
      salonId: SALON_ID,
      salonClientId: CLIENT_ID,
      clientEmail: 'client@example.com',
      clientName: 'D5 Client',
      clientPhone: '4165550100',
      startTime: secondStart,
      endTime: new Date(secondStart.getTime() + 3_600_000),
      status: 'confirmed',
      totalDurationMinutes: 60,
      totalPrice: 7500,
    });
    await db.update(schema.googleCalendarEventSchema).set({
      appointmentId: 'appt_reconciliation_new_owner',
    }).where(eq(
      schema.googleCalendarEventSchema.id,
      'gce_reconciliation_claim_race',
    ));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect((await readCalendarJobs())[0]).toEqual(expect.objectContaining({
      status: 'cancelled',
      lastError: 'SUPERSEDED',
    }));
    expect((await db.select().from(schema.googleCalendarEventSchema).where(eq(
      schema.googleCalendarEventSchema.id,
      'gce_reconciliation_claim_race',
    )))[0]).toEqual(expect.objectContaining({
      appointmentId: 'appt_reconciliation_new_owner',
      deletedAt: null,
    }));
  });

  it('converges a move-first and delayed confirmation child on one revision identity', async () => {
    const [before] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const mutationVersion = new Date(before!.updatedAt.getTime() + 1);
    const startB = new Date(before!.startTime.getTime() + 2 * 60 * 60_000);
    const endB = new Date(before!.endTime.getTime() + 2 * 60 * 60_000);
    await db.update(schema.appointmentSchema).set({
      startTime: startB,
      endTime: endB,
      updatedAt: mutationVersion,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      destinationCalendarId: 'replacement_calendar',
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    await enqueueGoogleCalendarUpsert(calendarInput(startB, endB), {
      cause: {
        kind: 'deposit_confirmation',
        parentJobId: 'delayed_parent_after_move',
      },
      mutationVersion,
    });
    const jobs = await readCalendarJobs();
    const mutationJob = jobs.find(job => job.operation === 'sync_appointment');
    const confirmationJob = jobs.find(job => job.operation === 'upsert_event');

    expect(mutationJob?.payload).toEqual(expect.objectContaining({
      targetCalendarId: 'destination_calendar',
    }));
    expect(confirmationJob?.payload).toEqual(expect.objectContaining({
      targetCalendarId: 'destination_calendar',
    }));

    await db.update(schema.integrationOutboxSchema).set({ availableAt: NOT_DUE })
      .where(eq(schema.integrationOutboxSchema.id, confirmationJob!.id));
    const providerKeys: string[] = [];
    externalEffects.syncGoogleCalendarEventForAppointment.mockImplementation(
      async (_input: unknown, options?: { idempotencyKey?: string }) => {
        providerKeys.push(options?.idempotencyKey ?? 'missing');
        if (providerKeys.length === 1) {
          return { status: 'failed', error: 'accepted but response lost' };
        }
        return {
          status: 'synced',
          eventId: 'google_event_shared_revision',
          calendarId: 'destination_calendar',
        };
      },
    );

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, retried: 1 });

    await db.update(schema.integrationOutboxSchema).set({ availableAt: NOT_DUE })
      .where(eq(schema.integrationOutboxSchema.id, mutationJob!.id));
    await db.update(schema.integrationOutboxSchema).set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, confirmationJob!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });

    await db.update(schema.integrationOutboxSchema).set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, mutationJob!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });

    expect(new Set(providerKeys)).toEqual(new Set(['appointment-lane:initial']));
    expect(providerKeys).toHaveLength(3);
    expect((await readCalendarJobs()).map(job => job.status).sort())
      .toEqual(['completed', 'completed']);
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        googleCalendarEventId: 'google_event_shared_revision',
        googleCalendarSyncStatus: 'synced',
        startTime: startB,
      }));
  });

  it('pins a never-attempted durable known-event row to its lifecycle lane before dispatch', async () => {
    const eventId = 'google_event_legacy_lane';
    await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: eventId,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_legacy_lane',
      calendarId: 'destination_calendar',
      eventId,
    });
    await enqueueCurrentAppointmentMutation();

    const [queued] = await readCalendarJobs();
    const {
      providerEventLane: _removedProviderEventLane,
      ...legacyPayload
    } = queued!.payload as Record<string, unknown>;
    await db.update(schema.integrationOutboxSchema).set({
      payload: legacyPayload,
    }).where(eq(schema.integrationOutboxSchema.id, queued!.id));

    externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      calendarId: 'destination_calendar',
      eventId,
      status: 'synced',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({
      scanned: 1,
      succeeded: 1,
    });
    expect(externalEffects.syncGoogleCalendarEventForAppointment)
      .toHaveBeenCalledWith(
        expect.objectContaining({ googleCalendarEventId: eventId }),
        expect.objectContaining({ idempotencyKey: 'appointment-lane:initial' }),
      );
    expect((await readCalendarJobs())[0]?.payload).toEqual(expect.objectContaining({
      providerEventIdentity: 'appointment-lane:initial',
      providerEventLane: 'initial',
    }));
  });

  it('preserves the old deterministic identity when an accepted pre-lane create retries', async () => {
    await enqueueCurrentAppointmentMutation();

    const [queued] = await readCalendarJobs();
    const {
      providerEventLane: _removedProviderEventLane,
      ...legacyPayload
    } = queued!.payload as Record<string, unknown>;
    const mutationVersion = String(legacyPayload.mutationVersion);
    const oldIdentity = `appointment-revision:${mutationVersion}`;
    const oldRemoteEventId = externalEffects.deterministicGoogleCalendarEventId({
      appointmentId: APPOINTMENT_ID,
      idempotencyKey: oldIdentity,
      salonId: SALON_ID,
    });
    const remoteEvents = new Map([[oldRemoteEventId, mutationVersion]]);
    await db.update(schema.integrationOutboxSchema).set({
      attempts: 1,
      lastError: 'accepted but response lost',
      payload: legacyPayload,
      status: 'retry',
    }).where(eq(schema.integrationOutboxSchema.id, queued!.id));

    externalEffects.syncGoogleCalendarEventForAppointment.mockImplementationOnce(
      async (_input: unknown, options?: { idempotencyKey?: string }) => {
        const candidate = externalEffects.deterministicGoogleCalendarEventId({
          appointmentId: APPOINTMENT_ID,
          idempotencyKey: options!.idempotencyKey!,
          salonId: SALON_ID,
        });
        remoteEvents.set(candidate, mutationVersion);
        return {
          calendarId: 'destination_calendar',
          eventId: candidate,
          status: 'synced',
        } as const;
      },
    );

    expect(await processIntegrationOutbox(1)).toMatchObject({
      scanned: 1,
      succeeded: 1,
    });
    expect(externalEffects.syncGoogleCalendarEventForAppointment)
      .toHaveBeenCalledWith(
        expect.objectContaining({ googleCalendarEventId: oldRemoteEventId }),
        expect.objectContaining({ idempotencyKey: oldIdentity }),
      );
    expect([...remoteEvents.entries()]).toEqual([[oldRemoteEventId, mutationVersion]]);
    expect((await readCalendarJobs())[0]).toEqual(expect.objectContaining({
      attempts: 2,
      status: 'completed',
    }));
    expect((await readCalendarJobs())[0]?.payload).toEqual(expect.objectContaining({
      googleCalendarEventId: oldRemoteEventId,
      providerEventIdentity: oldIdentity,
      providerEventLane: 'initial',
    }));
  });

  it('fails closed when a pre-lane known-event attempt has two possible remote identities', async () => {
    const linkedEventId = 'google_event_ambiguous_legacy_patch_target';

    await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: linkedEventId,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_ambiguous_legacy_patch_target',
      calendarId: 'destination_calendar',
      eventId: linkedEventId,
    });
    await enqueueCurrentAppointmentMutation();

    const [queued] = await readCalendarJobs();
    const {
      providerEventLane: _removedProviderEventLane,
      ...legacyPayload
    } = queued!.payload as Record<string, unknown>;

    await db.update(schema.integrationOutboxSchema).set({
      attempts: 1,
      lastError: 'response lost after unknown PATCH or fallback outcome',
      payload: legacyPayload,
      status: 'retry',
    }).where(eq(schema.integrationOutboxSchema.id, queued!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({
      retried: 1,
      scanned: 1,
    });
    expect(externalEffects.syncGoogleCalendarEventForAppointment)
      .not.toHaveBeenCalled();
    expect((await readCalendarJobs())[0]).toEqual(expect.objectContaining({
      attempts: 2,
      lastError: 'GOOGLE_CALENDAR_PROVIDER_IDENTITY_AMBIGUOUS',
      status: 'retry',
    }));
  });

  it('does not treat a completed pre-lane known-event row as remotely ambiguous', async () => {
    const linkedEventId = 'google_event_completed_pre_lane';

    await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: linkedEventId,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_completed_pre_lane',
      calendarId: 'destination_calendar',
      eventId: linkedEventId,
    });
    await enqueueCurrentAppointmentMutation();

    const [completedLegacy] = await readCalendarJobs();
    const {
      providerEventLane: _removedProviderEventLane,
      ...legacyPayload
    } = completedLegacy!.payload as Record<string, unknown>;

    await db.update(schema.integrationOutboxSchema).set({
      attempts: 1,
      payload: legacyPayload,
      processedAt: new Date(),
      status: 'completed',
    }).where(eq(schema.integrationOutboxSchema.id, completedLegacy!.id));

    const [before] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const nextVersion = new Date(before!.updatedAt.getTime() + 1);

    await db.update(schema.appointmentSchema).set({
      startTime: new Date(before!.startTime.getTime() + 60_000),
      endTime: new Date(before!.endTime.getTime() + 60_000),
      updatedAt: nextVersion,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();
    externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      calendarId: 'destination_calendar',
      eventId: linkedEventId,
      status: 'synced',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({
      scanned: 1,
      succeeded: 1,
    });
    expect(externalEffects.syncGoogleCalendarEventForAppointment)
      .toHaveBeenCalledWith(
        expect.objectContaining({ googleCalendarEventId: linkedEventId }),
        expect.objectContaining({ idempotencyKey: 'appointment-lane:initial' }),
      );
  });

  it('fails closed before provider I/O when two legacy identities are remotely ambiguous', async () => {
    await enqueueCurrentAppointmentMutation();
    const [firstLegacy] = await readCalendarJobs();
    const {
      providerEventLane: _removedProviderEventLane,
      ...firstLegacyPayload
    } = firstLegacy!.payload as Record<string, unknown>;
    const firstVersion = String(firstLegacyPayload.mutationVersion);
    const secondVersion = new Date(new Date(firstVersion).getTime() + 1).toISOString();
    const currentVersion = new Date(new Date(firstVersion).getTime() + 2);
    await db.update(schema.integrationOutboxSchema).set({
      attempts: 1,
      availableAt: NOT_DUE,
      lastError: 'first accepted response was lost',
      payload: firstLegacyPayload,
      status: 'retry',
    }).where(eq(schema.integrationOutboxSchema.id, firstLegacy!.id));
    await db.insert(schema.integrationOutboxSchema).values({
      id: 'second_ambiguous_legacy_identity',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'sync_appointment',
      dedupeKey: 'second_ambiguous_legacy_identity',
      payload: {
        ...firstLegacyPayload,
        mutationVersion: secondVersion,
      },
      attempts: 1,
      availableAt: NOT_DUE,
      lastError: 'second accepted response was lost',
      status: 'retry',
    });
    await db.update(schema.appointmentSchema).set({
      startTime: new Date('2099-08-01T17:00:00.000Z'),
      endTime: new Date('2099-08-01T18:00:00.000Z'),
      updatedAt: currentVersion,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();
    const before = await readCalendarJobs();
    const current = before.find(job => (
      (job.payload as { mutationVersion?: unknown }).mutationVersion
      === currentVersion.toISOString()
    ));
    await db.update(schema.integrationOutboxSchema).set({ attempts: 7 })
      .where(eq(schema.integrationOutboxSchema.id, current!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({
      failed: 1,
      scanned: 1,
    });
    expect(externalEffects.syncGoogleCalendarEventForAppointment)
      .not.toHaveBeenCalled();
    expect(externalEffects.deleteGoogleCalendarEventForAppointment)
      .not.toHaveBeenCalled();

    const after = await readCalendarJobs();

    expect(after.find(job => job.id === current!.id)).toEqual(expect.objectContaining({
      attempts: 8,
      lastError: 'GOOGLE_CALENDAR_PROVIDER_IDENTITY_AMBIGUOUS',
      status: 'failed',
    }));
    expect(after.every(job => (
      (job.payload as { providerEventIdentity?: unknown }).providerEventIdentity
      === undefined
    ))).toBe(true);
  });

  it('starts a fresh provider lane after a durable terminal boundary', async () => {
    const oldEventId = 'google_event_before_terminal_boundary';
    await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: oldEventId,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_before_terminal_boundary',
      calendarId: 'destination_calendar',
      eventId: oldEventId,
    });
    await enqueueCurrentAppointmentMutation();
    const [legacy] = await readCalendarJobs();
    const {
      providerEventLane: _removedProviderEventLane,
      ...legacyPayload
    } = legacy!.payload as Record<string, unknown>;
    const legacyVersion = new Date(String(legacyPayload.mutationVersion));
    await db.update(schema.integrationOutboxSchema).set({
      attempts: 1,
      availableAt: NOT_DUE,
      payload: legacyPayload,
      status: 'retry',
    }).where(eq(schema.integrationOutboxSchema.id, legacy!.id));

    const terminalVersion = new Date(legacyVersion.getTime() + 1);
    await db.transaction(async (tx) => {
      await tx.update(schema.appointmentSchema).set({
        canvasState: 'cancelled',
        status: 'cancelled',
        updatedAt: terminalVersion,
      }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
      await enqueueGoogleCalendarDeleteInTx(tx, {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: terminalVersion,
        googleCalendarEventId: oldEventId,
      });
    });
    const terminalDelete = (await readCalendarJobs())
      .find(job => job.operation === 'delete_event');
    await db.update(schema.integrationOutboxSchema).set({ availableAt: NOT_DUE })
      .where(eq(schema.integrationOutboxSchema.id, terminalDelete!.id));

    const reactivationVersion = new Date(terminalVersion.getTime() + 1);
    await db.transaction(async (tx) => {
      await tx.update(schema.appointmentSchema).set({
        canvasState: 'waiting',
        status: 'confirmed',
        updatedAt: reactivationVersion,
      }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
      await enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: reactivationVersion,
      });
    });
    externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      calendarId: 'destination_calendar',
      eventId: oldEventId,
      status: 'synced',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({
      scanned: 1,
      succeeded: 1,
    });

    const expectedIdentity = `appointment-lane:${terminalVersion.toISOString()}`;

    expect(externalEffects.syncGoogleCalendarEventForAppointment)
      .toHaveBeenCalledWith(
        expect.objectContaining({ googleCalendarEventId: oldEventId }),
        expect.objectContaining({ idempotencyKey: expectedIdentity }),
      );

    const reactivation = (await readCalendarJobs()).find(job => (
      (job.payload as { mutationVersion?: unknown }).mutationVersion
      === reactivationVersion.toISOString()
    ));

    expect(reactivation?.payload).toEqual(expect.objectContaining({
      providerEventIdentity: expectedIdentity,
      providerEventLane: terminalVersion.toISOString(),
    }));
    expect(reactivation?.payload).not.toEqual(expect.objectContaining({
      providerEventIdentity: `appointment-revision:${legacyVersion.toISOString()}`,
    }));
  });

  it('keeps a known-event snapshot on the same lifecycle lane as managed mutations', async () => {
    const eventId = 'google_event_snapshot_lane';
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: eventId,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_snapshot_lane',
      calendarId: 'destination_calendar',
      eventId,
    });

    await enqueueGoogleCalendarUpsert({
      ...calendarInput(appointment!.startTime, appointment!.endTime),
      googleCalendarEventId: eventId,
    }, {
      cause: {
        kind: 'deposit_confirmation',
        parentJobId: 'known_event_snapshot_lane',
      },
      mutationVersion: appointment!.updatedAt,
    });

    expect((await readCalendarJobs())[0]?.payload).toEqual(expect.objectContaining({
      googleCalendarEventId: eventId,
      providerEventLane: 'initial',
      targetCalendarId: 'destination_calendar',
    }));
  });

  it('lets an atomic reactivation supersede a queued reconciliation delete', async () => {
    const [before] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const terminalVersion = new Date(before!.updatedAt.getTime() + 1);
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      encryptedRefreshToken: 'encrypted-test-token',
      destinationCalendarId: 'destination_calendar',
      busyCalendarIds: ['destination_calendar'],
      status: 'active',
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
      canvasState: 'cancelled',
      googleCalendarEventId: 'google_event_reconciliation_old',
      updatedAt: terminalVersion,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedBidirectionalMirror({
      id: 'gce_reactivation_reconciliation_old',
      calendarId: 'destination_calendar',
      eventId: 'google_event_reconciliation_old',
    });

    expect(await processIntegrationOutbox(0)).toMatchObject({
      queuedCancelledEvents: 1,
      scanned: 0,
    });

    const [reconciliationDelete] = await readCalendarJobs();

    expect(reconciliationDelete).toEqual(expect.objectContaining({
      operation: 'delete_event',
      status: 'pending',
    }));
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();

    const reactivationVersion = new Date(terminalVersion.getTime() + 1);
    await db.transaction(async (tx) => {
      const [reactivated] = await tx.update(schema.appointmentSchema).set({
        status: 'confirmed',
        canvasState: 'waiting',
        updatedAt: reactivationVersion,
      }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
      await enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: reactivated!.id,
        salonId: reactivated!.salonId,
        mutationVersion: reactivated!.updatedAt,
      });
    });
    const reactivationSync = (await readCalendarJobs())
      .find(job => job.id !== reconciliationDelete!.id);
    await db.update(schema.integrationOutboxSchema).set({ availableAt: NOT_DUE })
      .where(eq(schema.integrationOutboxSchema.id, reactivationSync!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect((await readCalendarJobs()).find(job => job.id === reconciliationDelete!.id))
      .toEqual(expect.objectContaining({ status: 'cancelled', lastError: 'SUPERSEDED' }));

    persistSuccessfulCalendarSync();
    await db.update(schema.integrationOutboxSchema).set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, reactivationSync!.id));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        googleCalendarEventId: 'google_event_d5',
        googleCalendarSyncStatus: 'synced',
        status: 'confirmed',
      }));
  });

  it('runs admin copy only from the worker and adopts the destination atomically', async () => {
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      encryptedRefreshToken: 'encrypted-test-token',
      destinationCalendarId: 'destination_calendar',
      busyCalendarIds: ['destination_calendar'],
      status: 'active',
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    const [before] = await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: 'google_admin_copy_source',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
    await db.insert(schema.googleCalendarEventSchema).values({
      id: 'gce_admin_copy_source',
      salonId: SALON_ID,
      calendarId: 'inbound_calendar',
      googleEventId: 'google_admin_copy_source',
      appointmentId: APPOINTMENT_ID,
      sourceAccessRole: 'reader',
      syncMode: 'inbound_only',
      title: 'Imported appointment',
      startTime: before!.startTime,
      endTime: before!.endTime,
      durationMinutes: 60,
      reviewStatus: 'appointment',
    });
    const enqueueResult = await db.transaction(tx =>
      enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: before!.updatedAt,
        adminCopySourceEventId: 'gce_admin_copy_source',
      }));
    await db.insert(schema.integrationOutboxSchema).values({
      id: 'admin_copy_unrelated_cleanup',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'delete_event',
      dedupeKey: `google:${SALON_ID}:${APPOINTMENT_ID}:delete:test-cleanup`,
      payload: {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: null,
        googleCalendarEventId: 'obsolete_admin_copy_event',
        targetCalendarId: 'destination_calendar',
        cleanup: true,
      },
      availableAt: NOT_DUE,
    });

    expect(externalEffects.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();

    externalEffects.syncGoogleCalendarEventForAppointment.mockImplementation(async () => {
      await db.update(schema.salonGoogleCalendarConnectionSchema).set({
        destinationCalendarId: 'replacement_calendar',
      }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
      return {
        eventId: 'google_admin_copy_destination',
        status: 'synced',
        calendarId: 'destination_calendar',
      };
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: APPOINTMENT_ID,
        googleCalendarEventId: null,
      }),
      expect.objectContaining({
        idempotencyKey: `${enqueueResult.jobId}:admin-copy:0`,
        persistResult: false,
        signal: expect.any(AbortSignal),
        targetCalendarId: 'destination_calendar',
        useDestinationCalendar: true,
      }),
    );

    const job = (await readCalendarJobs()).find(row => row.id === enqueueResult.jobId);
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const events = await db.select().from(schema.googleCalendarEventSchema);
    const [connection] = await db.select()
      .from(schema.salonGoogleCalendarConnectionSchema)
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    expect(job).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(appointment).toEqual(expect.objectContaining({
      googleCalendarEventId: 'google_admin_copy_destination',
      googleCalendarSyncStatus: 'synced',
    }));
    expect(connection).toEqual(expect.objectContaining({
      destinationCalendarId: 'replacement_calendar',
    }));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'gce_admin_copy_source',
        appointmentId: null,
        syncMode: 'superseded',
        supersededByEventId: 'google_admin_copy_destination',
      }),
      expect.objectContaining({
        appointmentId: APPOINTMENT_ID,
        calendarId: 'destination_calendar',
        googleEventId: 'google_admin_copy_destination',
        syncMode: 'bidirectional',
      }),
    ]));
  });

  it('cancels a bypass-seeded admin copy for an awaiting-payment hold before provider dispatch', async () => {
    const [hold] = await db.update(schema.appointmentSchema).set({
      status: 'awaiting_payment',
      googleCalendarEventId: 'google_hold_source',
      googleCalendarSyncStatus: 'not_synced',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
    await db.insert(schema.googleCalendarEventSchema).values({
      id: 'gce_hold_source',
      salonId: SALON_ID,
      calendarId: 'inbound_calendar',
      googleEventId: 'google_hold_source',
      appointmentId: APPOINTMENT_ID,
      sourceAccessRole: 'reader',
      syncMode: 'inbound_only',
      title: 'Unpaid imported hold',
      startTime: hold!.startTime,
      endTime: hold!.endTime,
      durationMinutes: hold!.totalDurationMinutes,
      reviewStatus: 'appointment',
    });
    await db.insert(schema.integrationOutboxSchema).values({
      id: 'job_bypass_admin_copy_hold',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'sync_appointment',
      dedupeKey: `google:${SALON_ID}:${APPOINTMENT_ID}:sync:admin-copy:gce_hold_source`,
      payload: {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: hold!.updatedAt.toISOString(),
        adminCopySourceEventId: 'gce_hold_source',
        adminCopyGeneration: 0,
        targetCalendarId: 'destination_calendar',
      },
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({
      scanned: 1,
      succeeded: 1,
      retried: 0,
      failed: 0,
    });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect(externalEffects.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect((await readCalendarJobs())[0]).toEqual(expect.objectContaining({
      id: 'job_bypass_admin_copy_hold',
      status: 'cancelled',
      lastError: 'SUPERSEDED',
    }));
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        status: 'awaiting_payment',
        googleCalendarEventId: 'google_hold_source',
        googleCalendarSyncStatus: 'not_synced',
      }));
    expect(await db.select().from(schema.googleCalendarEventSchema))
      .toEqual([expect.objectContaining({
        id: 'gce_hold_source',
        appointmentId: APPOINTMENT_ID,
        syncMode: 'inbound_only',
      })]);
  });

  it('cleans up an admin-copy result when cancellation wins during provider I/O', async () => {
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      encryptedRefreshToken: 'encrypted-test-token',
      destinationCalendarId: 'destination_calendar',
      status: 'active',
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    const [before] = await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: 'google_admin_race_source',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
    await db.insert(schema.googleCalendarEventSchema).values({
      id: 'gce_admin_race_source',
      salonId: SALON_ID,
      calendarId: 'inbound_calendar',
      googleEventId: 'google_admin_race_source',
      appointmentId: APPOINTMENT_ID,
      sourceAccessRole: 'reader',
      syncMode: 'inbound_only',
      title: 'Imported appointment',
      startTime: before!.startTime,
      endTime: before!.endTime,
      durationMinutes: 60,
      reviewStatus: 'appointment',
    });
    await db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: before!.updatedAt,
      adminCopySourceEventId: 'gce_admin_race_source',
    }));

    let signalProviderEntered!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      signalProviderEntered = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    externalEffects.syncGoogleCalendarEventForAppointment.mockImplementation(async () => {
      signalProviderEntered();
      await providerRelease;
      return { eventId: 'google_admin_race_destination', status: 'synced' };
    });

    const copyWorker = processIntegrationOutbox(1);
    await providerEntered;
    await db.transaction(async (tx) => {
      const terminalVersion = new Date(before!.updatedAt.getTime() + 1);
      const [cancelled] = await tx.update(schema.appointmentSchema).set({
        status: 'cancelled',
        canvasState: 'cancelled',
        updatedAt: terminalVersion,
      }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
      await enqueueGoogleCalendarDeleteInTx(tx, {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: cancelled!.updatedAt,
        googleCalendarEventId: cancelled!.googleCalendarEventId,
      });
    });
    releaseProvider();

    expect(await copyWorker).toMatchObject({ scanned: 1, succeeded: 1 });

    const copyJob = (await readCalendarJobs())
      .find(job => job.operation === 'sync_appointment');

    expect(copyJob).toEqual(expect.objectContaining({
      status: 'cancelled',
      lastError: 'ADMIN_COPY_PRECONDITION_CHANGED',
    }));
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        googleCalendarEventId: 'google_admin_race_source',
        status: 'cancelled',
      }));

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.deleteGoogleCalendarEventForAppointment.mock.calls
      .map(([input]) => input.googleCalendarEventId))
      .toEqual(['google_admin_race_source', 'google_admin_race_destination']);
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        googleCalendarEventId: null,
        googleCalendarSyncStatus: 'deleted',
        status: 'cancelled',
      }));
  });

  it('keeps the current calendar intent authoritative across a bookkeeping-only updatedAt advance', async () => {
    const [before] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();
    const [intent] = await readCalendarJobs();
    const bookkeepingUpdatedAt = new Date(before!.updatedAt.getTime() + 60_000);

    await db.update(schema.appointmentSchema)
      .set({ updatedAt: bookkeepingUpdatedAt })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    persistSuccessfulCalendarSync();

    expect(await processIntegrationOutbox(1)).toMatchObject({
      scanned: 1,
      succeeded: 1,
    });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: APPOINTMENT_ID,
        endTime: before!.endTime,
        startTime: before!.startTime,
      }),
      expect.objectContaining({ persistResult: false, signal: expect.any(AbortSignal) }),
    );

    const [storedIntent] = await readCalendarJobs();
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    expect(storedIntent).toEqual(expect.objectContaining({
      id: intent!.id,
      status: 'completed',
    }));
    expect(appointment).toEqual(expect.objectContaining({
      googleCalendarEventId: 'google_event_d5',
      googleCalendarSyncError: null,
      googleCalendarSyncStatus: 'synced',
      updatedAt: bookkeepingUpdatedAt,
    }));
  });

  it('serializes overlapping A and B workers so a delayed A cannot overwrite B', async () => {
    const [appointmentAtA] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueGoogleCalendarUpsert(
      calendarInput(appointmentAtA!.startTime, appointmentAtA!.endTime),
      {
        cause: {
          kind: 'deposit_confirmation',
          parentJobId: 'parent_overlapping_workers',
        },
        mutationVersion: appointmentAtA!.updatedAt,
      },
    );
    const [intentA] = await readCalendarJobs();

    let signalProviderEntered!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      signalProviderEntered = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const providerWindows: Array<{ startTime: Date; endTime: Date }> = [];
    let activeProviderCalls = 0;
    let maximumProviderConcurrency = 0;
    externalEffects.syncGoogleCalendarEventForAppointment.mockImplementation(async (input: {
      appointmentId: string;
      startTime: Date;
      endTime: Date;
    }) => {
      activeProviderCalls += 1;
      maximumProviderConcurrency = Math.max(
        maximumProviderConcurrency,
        activeProviderCalls,
      );
      providerWindows.push({ startTime: input.startTime, endTime: input.endTime });
      if (providerWindows.length === 1) {
        signalProviderEntered();
        await providerRelease;
      }
      activeProviderCalls -= 1;
      return {
        eventId: providerWindows.length === 1
          ? 'google_event_overlap_a'
          : 'google_event_overlap_b',
        status: 'synced',
      };
    });

    const workerA = processIntegrationOutbox(1);
    try {
      await providerEntered;

      const startB = new Date(appointmentAtA!.startTime.getTime() + 4 * 60 * 60_000);
      const endB = new Date(appointmentAtA!.endTime.getTime() + 4 * 60 * 60_000);
      await db.update(schema.appointmentSchema)
        .set({ startTime: startB, endTime: endB })
        .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
      await enqueueCurrentAppointmentMutation();
      const legitimateB = (await readCalendarJobs())
        .find(job => job.operation === 'sync_appointment' && job.id !== intentA!.id);

      // A owns the durable per-appointment provider mutex. A concurrent worker
      // may see B, but it cannot claim or call the provider until A terminates.
      expect(await processIntegrationOutbox(1)).toMatchObject({
        scanned: 1,
        succeeded: 0,
        retried: 0,
        failed: 0,
      });
      expect(providerWindows).toEqual([{
        startTime: appointmentAtA!.startTime,
        endTime: appointmentAtA!.endTime,
      }]);
      expect((await readCalendarJobs()).map(job => job.status).sort())
        .toEqual(['pending', 'processing']);

      releaseProvider();

      expect(await workerA).toMatchObject({ scanned: 1, succeeded: 1 });

      const queuedCleanup = (await readCalendarJobs())
        .find(job => job.operation === 'delete_event');

      expect(queuedCleanup).toBeDefined();

      await db.update(schema.integrationOutboxSchema).set({ availableAt: NOT_DUE })
        .where(eq(schema.integrationOutboxSchema.id, queuedCleanup!.id));
      await db.update(schema.integrationOutboxSchema).set({ availableAt: DUE })
        .where(eq(schema.integrationOutboxSchema.id, legitimateB!.id));

      expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });

      await db.update(schema.integrationOutboxSchema).set({ availableAt: DUE })
        .where(eq(schema.integrationOutboxSchema.id, queuedCleanup!.id));

      expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });

      expect(maximumProviderConcurrency).toBe(1);
      expect(providerWindows).toEqual([
        { startTime: appointmentAtA!.startTime, endTime: appointmentAtA!.endTime },
        { startTime: startB, endTime: endB },
      ]);
      expect((await readCalendarJobs()).map(job => job.status).sort())
        .toEqual(['cancelled', 'completed', 'completed']);
      expect(externalEffects.deleteGoogleCalendarEventForAppointment)
        .toHaveBeenCalledWith(
          expect.objectContaining({
            appointmentId: APPOINTMENT_ID,
            googleCalendarEventId: 'google_event_overlap_a',
          }),
          expect.objectContaining({ persistResult: false, signal: expect.any(AbortSignal) }),
        );
      expect((await db.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
        .toEqual(expect.objectContaining({
          startTime: startB,
          endTime: endB,
          googleCalendarEventId: 'google_event_overlap_b',
          googleCalendarSyncStatus: 'synced',
        }));
    } finally {
      releaseProvider();
      await workerA;
    }
  });

  it('rechecks durable intent after lease acquisition and before provider dispatch', async () => {
    const [appointmentAtA] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();

    let signalPreDispatch!: () => void;
    let releasePreDispatch!: () => void;
    const preDispatch = new Promise<void>((resolve) => {
      signalPreDispatch = resolve;
    });
    const dispatchRelease = new Promise<void>((resolve) => {
      releasePreDispatch = resolve;
    });
    const workerA = processIntegrationOutbox(1, {
      beforeGoogleProviderDispatch: async () => {
        signalPreDispatch();
        await dispatchRelease;
      },
    });
    await preDispatch;

    const startB = new Date(appointmentAtA!.startTime.getTime() + 5 * 60 * 60_000);
    const endB = new Date(appointmentAtA!.endTime.getTime() + 5 * 60 * 60_000);
    await db.update(schema.appointmentSchema).set({
      startTime: startB,
      endTime: endB,
      updatedAt: new Date(appointmentAtA!.updatedAt.getTime() + 1),
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();
    releasePreDispatch();

    expect(await workerA).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect((await readCalendarJobs()).map(job => job.status).sort())
      .toEqual(['cancelled', 'pending']);

    externalEffects.syncGoogleCalendarEventForAppointment.mockResolvedValueOnce({
      eventId: 'google_event_pre_dispatch_b',
      status: 'synced',
      calendarId: 'destination_calendar',
    });

    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: startB, endTime: endB }),
      expect.objectContaining({ targetCalendarId: 'destination_calendar' }),
    );
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toEqual(expect.objectContaining({
        startTime: startB,
        endTime: endB,
        googleCalendarEventId: 'google_event_pre_dispatch_b',
        googleCalendarSyncStatus: 'synced',
      }));
  });

  it('heartbeats a live Google provider await before its reclaim horizon', async () => {
    vi.useFakeTimers();
    await enqueueCurrentAppointmentMutation();

    let signalProviderEntered!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      signalProviderEntered = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    externalEffects.syncGoogleCalendarEventForAppointment.mockImplementation(async () => {
      signalProviderEntered();
      await providerRelease;
      return { eventId: 'google_event_heartbeat', status: 'synced' };
    });

    const worker = processIntegrationOutbox(1);
    try {
      await providerEntered;
      const [claimed] = await readCalendarJobs();
      const claimedAt = claimed!.updatedAt;

      await vi.advanceTimersByTimeAsync(60_001);
      const [heartbeat] = await readCalendarJobs();

      expect(heartbeat).toEqual(expect.objectContaining({
        status: 'processing',
        attempts: 1,
      }));
      expect(heartbeat!.updatedAt.getTime()).toBeGreaterThan(claimedAt.getTime());
    } finally {
      releaseProvider();
      await worker;
    }
  });

  it('aborts provider work and retries when a recurring heartbeat write fails', async () => {
    vi.useFakeTimers();
    await enqueueCurrentAppointmentMutation();

    let providerSignal: AbortSignal | null = null;
    let signalProviderEntered!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      signalProviderEntered = resolve;
    });
    externalEffects.syncGoogleCalendarEventForAppointment.mockImplementation(
      async (_input: unknown, options?: { signal?: AbortSignal }) => {
        providerSignal = options?.signal ?? null;
        signalProviderEntered();
        return await new Promise((resolve) => {
          providerSignal?.addEventListener('abort', () => resolve({
            error: 'heartbeat aborted provider work',
            status: 'failed',
          }), { once: true });
        });
      },
    );

    const worker = processIntegrationOutbox(1);
    await providerEntered;
    await client.exec(`
      CREATE FUNCTION fail_recurring_google_heartbeat() RETURNS trigger AS $$
      BEGIN
        IF OLD.status = 'processing'
          AND NEW.status = 'processing'
          AND NEW.attempts = OLD.attempts
          AND NEW.payload IS NOT DISTINCT FROM OLD.payload
          AND NEW.updated_at IS DISTINCT FROM OLD.updated_at
        THEN
          RAISE EXCEPTION 'forced recurring heartbeat failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_recurring_google_heartbeat_trigger
        BEFORE UPDATE ON integration_outbox
        FOR EACH ROW EXECUTE FUNCTION fail_recurring_google_heartbeat();
    `);
    try {
      await vi.advanceTimersByTimeAsync(15_001);

      await expect(worker).resolves.toMatchObject({
        scanned: 1,
        succeeded: 0,
        retried: 1,
        failed: 0,
      });
      expect((providerSignal as AbortSignal | null)?.aborted).toBe(true);
      expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
      expect((await readCalendarJobs())[0]).toEqual(expect.objectContaining({
        status: 'retry',
        attempts: 1,
        lastError: 'GOOGLE_OUTBOX_HEARTBEAT_FAILED',
      }));
    } finally {
      await client.exec(`
        DROP TRIGGER fail_recurring_google_heartbeat_trigger ON integration_outbox;
        DROP FUNCTION fail_recurring_google_heartbeat();
      `);
    }
  });

  it('does not dispatch when the initial durable heartbeat write fails', async () => {
    await enqueueCurrentAppointmentMutation();
    await client.exec(`
      CREATE FUNCTION fail_google_outbox_heartbeat() RETURNS trigger AS $$
      BEGIN
        IF OLD.status = 'processing'
          AND NEW.status = 'processing'
          AND NEW.attempts = OLD.attempts
          AND NEW.payload IS NOT DISTINCT FROM OLD.payload
          AND NEW.updated_at IS DISTINCT FROM OLD.updated_at
        THEN
          RAISE EXCEPTION 'forced heartbeat failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_google_outbox_heartbeat_trigger
        BEFORE UPDATE ON integration_outbox
        FOR EACH ROW EXECUTE FUNCTION fail_google_outbox_heartbeat();
    `);
    try {
      expect(await processIntegrationOutbox(1)).toMatchObject({
        scanned: 1,
        succeeded: 0,
        retried: 1,
        failed: 0,
      });
      expect(externalEffects.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
      expect((await readCalendarJobs())[0]).toEqual(expect.objectContaining({
        status: 'retry',
        attempts: 1,
        lastError: 'GOOGLE_OUTBOX_HEARTBEAT_FAILED',
      }));
    } finally {
      await client.exec(`
        DROP TRIGGER fail_google_outbox_heartbeat_trigger ON integration_outbox;
        DROP FUNCTION fail_google_outbox_heartbeat();
      `);
    }
  });

  it('aborts a hung Google provider at the worker timeout and retries without provider bookkeeping', async () => {
    vi.useFakeTimers();
    await enqueueCurrentAppointmentMutation();

    let providerSignal: AbortSignal | null = null;
    let signalProviderEntered!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      signalProviderEntered = resolve;
    });
    externalEffects.syncGoogleCalendarEventForAppointment.mockImplementation(
      async (_input: unknown, options?: { signal?: AbortSignal; persistResult?: boolean }) => {
        providerSignal = options?.signal ?? null;
        signalProviderEntered();
        return await new Promise((resolve) => {
          providerSignal?.addEventListener('abort', () => resolve({
            error: 'Google provider request was aborted',
            status: 'failed',
          }), { once: true });
        });
      },
    );

    const worker = processIntegrationOutbox(1);
    await providerEntered;
    await vi.advanceTimersByTimeAsync(100_001);

    await expect(worker).resolves.toMatchObject({
      failed: 0,
      retried: 1,
      scanned: 1,
      succeeded: 0,
    });
    expect((providerSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        persistResult: false,
        signal: expect.any(AbortSignal),
      }),
    );

    const [job] = await readCalendarJobs();
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    expect(job).toEqual(expect.objectContaining({
      attempts: 1,
      lastError: 'GOOGLE_OUTBOX_PROVIDER_TIMEOUT',
      status: 'retry',
    }));
    expect(appointment).toEqual(expect.objectContaining({
      googleCalendarEventId: null,
      googleCalendarSyncStatus: 'failed',
      googleCalendarSyncError: 'GOOGLE_OUTBOX_PROVIDER_TIMEOUT',
    }));
  });

  it('retains the processing mutex when an aborted provider does not drain', async () => {
    vi.useFakeTimers();
    await enqueueCurrentAppointmentMutation();

    let signalProviderEntered!: () => void;
    let releaseProvider!: (result: { eventId: string; status: 'synced' }) => void;
    const providerEntered = new Promise<void>((resolve) => {
      signalProviderEntered = resolve;
    });
    const providerRelease = new Promise<{ eventId: string; status: 'synced' }>((resolve) => {
      releaseProvider = resolve;
    });
    externalEffects.syncGoogleCalendarEventForAppointment.mockImplementation(async () => {
      signalProviderEntered();
      return providerRelease;
    });

    const workerA = processIntegrationOutbox(1);
    await providerEntered;
    const [beforeB] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.update(schema.appointmentSchema).set({
      startTime: new Date(beforeB!.startTime.getTime() + 60_000),
      endTime: new Date(beforeB!.endTime.getTime() + 60_000),
      updatedAt: new Date(beforeB!.updatedAt.getTime() + 1),
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await enqueueCurrentAppointmentMutation();

    await vi.advanceTimersByTimeAsync(105_001);

    await expect(workerA).resolves.toMatchObject({
      failed: 0,
      retried: 0,
      scanned: 1,
      succeeded: 0,
    });

    const jobsBeforePeer = await readCalendarJobs();

    expect(jobsBeforePeer).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'processing', attempts: 1 }),
      expect.objectContaining({ status: 'pending', attempts: 0 }),
    ]));

    expect(await processIntegrationOutbox(1)).toMatchObject({
      failed: 0,
      retried: 0,
      scanned: 1,
      succeeded: 0,
    });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect((await readCalendarJobs()).find(job => job.status === 'processing'))
      .toEqual(expect.objectContaining({ attempts: 1 }));

    releaseProvider({ eventId: 'google_event_late_a', status: 'synced' });
    await vi.advanceTimersByTimeAsync(0);

    expect((await readCalendarJobs()).find(job => job.status === 'processing'))
      .toEqual(expect.objectContaining({ attempts: 1 }));
  });

  // PGlite has no independent physical sessions, so it cannot exercise the
  // production advisory-lock reclaim proof. Real PostgreSQL covers both races.
  it('preserves synced state when a retrying parent conflicts with its completed child', async () => {
    externalEffects.sendBookingConfirmationToClient.mockResolvedValue(undefined);
    externalEffects.sendBookingNotificationsForNewBooking
      .mockRejectedValueOnce(new Error('later booking effect failed'))
      .mockResolvedValue(undefined);
    await seedConfirmationJob(true);

    expect(await processIntegrationOutbox()).toMatchObject({ retried: 1, scanned: 1 });

    const [calendarChild] = await readCalendarJobs();
    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: NOT_DUE })
      .where(eq(schema.integrationOutboxSchema.id, 'job_outbox_d5'));
    persistSuccessfulCalendarSync();

    expect(await processIntegrationOutbox()).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0]?.googleCalendarSyncStatus)
      .toBe('synced');

    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: DUE })
      .where(eq(schema.integrationOutboxSchema.id, 'job_outbox_d5'));

    expect(await processIntegrationOutbox()).toMatchObject({ scanned: 1, succeeded: 1 });

    const children = await readCalendarJobs();

    expect(children).toEqual([expect.objectContaining({
      id: calendarChild!.id,
      status: 'completed',
    })]);
    expect(children.filter(job => ['pending', 'retry'].includes(job.status))).toHaveLength(0);
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0]?.googleCalendarSyncStatus)
      .toBe('synced');
    expect(externalEffects.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect(await processIntegrationOutbox()).toMatchObject({ scanned: 0, succeeded: 0 });
  });

  it('[T20] retries an unexpected SMS-boundary failure without resending the stable customer email', async () => {
    externalEffects.sendBookingConfirmationToClient
      .mockReset()
      // Production SMS absorbs an ordinary provider rejection. This synthetic
      // throw represents an unexpected dependency failure and forces the
      // aggregate retry whose per-effect replay posture this test exercises.
      .mockRejectedValueOnce(new Error('unexpected SMS boundary failure'))
      .mockResolvedValue(undefined);
    await seedConfirmationJob();

    const first = await processIntegrationOutbox();

    expect(first).toMatchObject({ failed: 0, retried: 1, scanned: 1 });
    expect(providerEmail).toHaveBeenCalledTimes(1);
    expect((await readJob())?.status).toBe('retry');

    await db.update(schema.integrationOutboxSchema).set({
      availableAt: new Date(Date.now() - 1_000),
    }).where(eq(schema.integrationOutboxSchema.id, 'job_outbox_d5'));

    const second = await processIntegrationOutbox();

    expect(second).toMatchObject({ failed: 0, retried: 0, scanned: 1, succeeded: 1 });
    expect(providerEmail).toHaveBeenCalledTimes(1);
    expect(externalEffects.sendBookingConfirmationToClient).toHaveBeenCalledTimes(2);
    expect((await readJob())?.status).toBe('completed');

    const deliveries = await db.select().from(schema.notificationDeliverySchema)
      .where(eq(schema.notificationDeliverySchema.appointmentId, APPOINTMENT_ID));

    expect(deliveries).toEqual([
      expect.objectContaining({
        purpose: 'booking_confirmation',
        status: 'sent',
      }),
    ]);
  });

  it('stops confirmation after an aborting customer-email leg and resumes the undispatched legs on aggregate retry', async () => {
    const controller = new AbortController();
    externalEffects.sendBookingConfirmationToClient.mockResolvedValue(undefined);
    providerEmail.mockImplementationOnce(async () => {
      controller.abort(new Error('WORKER_BUDGET_EXPIRED'));
      return new Response(JSON.stringify({ id: 'email_before_abort' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
    await seedConfirmationJob();

    await expect(processIntegrationOutbox(50, { signal: controller.signal }))
      .rejects.toThrow('WORKER_BUDGET_EXPIRED');
    expect((await readJob())?.status).toBe('retry');
    expect(providerEmail).toHaveBeenCalledTimes(1);
    expect(externalEffects.sendBookingConfirmationToClient).not.toHaveBeenCalled();
    expect(externalEffects.sendSalonNotificationEmail).not.toHaveBeenCalled();
    expect(externalEffects.sendBookingNotificationsForNewBooking).not.toHaveBeenCalled();

    await db.update(schema.integrationOutboxSchema).set({
      availableAt: DUE,
    }).where(eq(schema.integrationOutboxSchema.id, 'job_outbox_d5'));

    expect(await processIntegrationOutbox()).toMatchObject({
      retried: 0,
      scanned: 1,
      succeeded: 1,
    });
    // The stable customer claim suppresses a second provider send; only the
    // legs never dispatched by the expired attempt run on aggregate replay.
    expect(providerEmail).toHaveBeenCalledTimes(1);
    expect(externalEffects.sendBookingConfirmationToClient).toHaveBeenCalledTimes(1);
    expect(externalEffects.sendSalonNotificationEmail).toHaveBeenCalledTimes(1);
    expect(externalEffects.sendBookingNotificationsForNewBooking).toHaveBeenCalledTimes(1);
    expect((await readJob())?.status).toBe('completed');
  });

  it('replays best-effort SMS and internal delegates after a lost completion write while customer email stays single-claimed', async () => {
    externalEffects.sendBookingConfirmationToClient.mockResolvedValue(undefined);
    await seedConfirmationJob();

    expect(await processIntegrationOutbox()).toMatchObject({
      failed: 0,
      retried: 0,
      scanned: 1,
      succeeded: 1,
    });
    expect(providerEmail).toHaveBeenCalledTimes(1);
    expect(externalEffects.sendBookingConfirmationToClient).toHaveBeenCalledTimes(1);
    expect(externalEffects.sendBookingNotificationsForNewBooking).toHaveBeenCalledTimes(1);

    await simulateLostCompletionWrite('job_outbox_d5');

    expect(await processIntegrationOutbox()).toMatchObject({
      failed: 0,
      retried: 0,
      scanned: 1,
      succeeded: 1,
    });
    expect(providerEmail).toHaveBeenCalledTimes(1);
    expect(externalEffects.sendBookingConfirmationToClient).toHaveBeenCalledTimes(2);
    expect(externalEffects.sendBookingNotificationsForNewBooking).toHaveBeenCalledTimes(2);

    const deliveries = await db.select().from(schema.notificationDeliverySchema)
      .where(eq(schema.notificationDeliverySchema.appointmentId, APPOINTMENT_ID));

    expect(deliveries).toEqual([
      expect.objectContaining({
        dedupeKey: `email:booking-confirmation:${APPOINTMENT_ID}`,
        purpose: 'booking_confirmation',
        status: 'sent',
      }),
    ]);
  });

  it('replays the direct refund-owner email after a lost completion write while client email stays single-claimed', async () => {
    const refundJobId = 'job_refund_notice_replay';
    const refundId = 're_refund_notice_replay';
    await db.update(schema.salonSchema).set({
      ownerEmail: 'owner@example.com',
    }).where(eq(schema.salonSchema.id, SALON_ID));
    await db.update(schema.appointmentDepositSchema).set({
      status: 'refunded',
    }).where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
    await db.insert(schema.integrationOutboxSchema).values({
      id: refundJobId,
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'email',
      operation: 'deposit_refund_notices',
      dedupeKey: `deposit:${DEPOSIT_ID}:refund-notices:${refundId}`,
      payload: {
        depositId: DEPOSIT_ID,
        refundId,
        variant: 'slot_lost',
      },
    });

    expect(await processIntegrationOutbox()).toMatchObject({
      failed: 0,
      retried: 0,
      scanned: 1,
      succeeded: 1,
    });
    expect(providerEmail).toHaveBeenCalledTimes(2);

    await simulateLostCompletionWrite(refundJobId);

    expect(await processIntegrationOutbox()).toMatchObject({
      failed: 0,
      retried: 0,
      scanned: 1,
      succeeded: 1,
    });
    expect(providerEmail).toHaveBeenCalledTimes(3);

    const providerRequests = providerEmail.mock.calls.map(([, options]) =>
      JSON.parse(String((options as RequestInit).body)) as {
        subject: string;
        to: string[];
      });

    expect(providerRequests.filter(request =>
      request.subject === 'D5 Salon: your deposit has been refunded'
      && request.to[0] === 'client@example.com')).toHaveLength(1);
    expect(providerRequests.filter(request =>
      request.subject === 'D5 Salon: a client deposit was refunded'
      && request.to[0] === 'owner@example.com')).toHaveLength(2);

    const deliveries = await db.select().from(schema.notificationDeliverySchema)
      .where(eq(schema.notificationDeliverySchema.appointmentId, APPOINTMENT_ID));

    expect(deliveries).toEqual([
      expect.objectContaining({
        dedupeKey: `email:operational:client_deposit_refunded:${APPOINTMENT_ID}:${DEPOSIT_ID}:${refundId}`,
        purpose: 'client_deposit_refunded',
        status: 'sent',
      }),
    ]);
  });

  it('does not dispatch a refund owner notice after the client leg exhausts the worker budget', async () => {
    const refundJobId = 'job_refund_notice_abort';
    const refundId = 're_refund_notice_abort';
    const controller = new AbortController();
    await db.update(schema.salonSchema).set({
      ownerEmail: 'owner@example.com',
    }).where(eq(schema.salonSchema.id, SALON_ID));
    await db.update(schema.appointmentDepositSchema).set({
      status: 'refunded',
    }).where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
    await db.insert(schema.integrationOutboxSchema).values({
      id: refundJobId,
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'email',
      operation: 'deposit_refund_notices',
      dedupeKey: `deposit:${DEPOSIT_ID}:refund-notices:${refundId}`,
      payload: {
        depositId: DEPOSIT_ID,
        refundId,
        variant: 'slot_lost',
      },
    });
    providerEmail.mockImplementationOnce(async () => {
      controller.abort(new Error('WORKER_BUDGET_EXPIRED'));
      return new Response(JSON.stringify({ id: 'client_refund_before_abort' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await expect(processIntegrationOutbox(50, { signal: controller.signal }))
      .rejects.toThrow('WORKER_BUDGET_EXPIRED');
    expect(providerEmail).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(
      (providerEmail.mock.calls[0]?.[1] as RequestInit).body,
    ))).toEqual(expect.objectContaining({
      subject: 'D5 Salon: your deposit has been refunded',
      to: ['client@example.com'],
    }));

    await db.update(schema.integrationOutboxSchema).set({
      availableAt: DUE,
    }).where(eq(schema.integrationOutboxSchema.id, refundJobId));

    expect(await processIntegrationOutbox()).toMatchObject({
      retried: 0,
      scanned: 1,
      succeeded: 1,
    });

    const providerRequests = providerEmail.mock.calls.map(([, options]) =>
      JSON.parse(String((options as RequestInit).body)) as {
        subject: string;
        to: string[];
      });

    expect(providerRequests.filter(request =>
      request.subject === 'D5 Salon: your deposit has been refunded')).toHaveLength(1);
    expect(providerRequests.filter(request =>
      request.subject === 'D5 Salon: a client deposit was refunded'
      && request.to[0] === 'owner@example.com')).toHaveLength(1);
    expect((await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.id, refundJobId)))[0]?.status)
      .toBe('completed');
  });

  it('[T49][M31] alerts once and remains queryable when the eighth batch attempt fails', async () => {
    await seedConfirmationJob();

    for (let attempt = 1; attempt < 8; attempt += 1) {
      const retry = await processIntegrationOutbox();

      expect(retry).toMatchObject({ failed: 0, retried: 1, scanned: 1 });
      expect(await readJob()).toEqual(expect.objectContaining({
        attempts: attempt,
        status: 'retry',
      }));
      expect(Sentry.captureMessage).not.toHaveBeenCalled();

      await db.update(schema.integrationOutboxSchema).set({
        availableAt: new Date(Date.now() - 1_000),
      }).where(eq(schema.integrationOutboxSchema.id, 'job_outbox_d5'));
    }

    const terminal = await processIntegrationOutbox();

    expect(terminal).toMatchObject({ failed: 1, retried: 0, scanned: 1 });
    expect(await readJob()).toEqual(expect.objectContaining({
      attempts: 8,
      status: 'failed',
    }));
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'deposit_outbox_job_failed',
      {
        level: 'error',
        tags: { outbox_operation: 'booking_confirmed_side_effects' },
        extra: {
          appointmentId: APPOINTMENT_ID,
          depositId: DEPOSIT_ID,
          jobId: 'job_outbox_d5',
        },
      },
    );

    const runbookRows = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.status, 'failed'));

    expect(runbookRows.map(row => row.id)).toEqual(['job_outbox_d5']);

    const noReplay = await processIntegrationOutbox();

    expect(noReplay).toMatchObject({ failed: 0, scanned: 0 });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });
});
