/**
 * D5 confirmation-outbox delivery semantics.
 *
 * These tests use the real PGlite schema and real outbox/confirmation handler
 * dispatch. Only external side-effect modules are replaced. In particular,
 * the customer-email notification ledger is real: T20 would resend if its
 * persisted dedupe claim were removed.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
}));

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => sentry);

const externalEffects = vi.hoisted(() => ({
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
  deleteGoogleCalendarEventForAppointment:
    externalEffects.deleteGoogleCalendarEventForAppointment,
  listGoogleCalendarEventsForSalon: externalEffects.listGoogleCalendarEventsForSalon,
  syncGoogleCalendarEventForAppointment:
    externalEffects.syncGoogleCalendarEventForAppointment,
}));

/* eslint-disable import/first */
import { processIntegrationOutbox } from '@/libs/integrationOutbox';

import { confirmDepositPayment } from './confirmDepositPayment';
/* eslint-enable import/first */

const SALON_ID = 'salon_outbox_d5';
const CLIENT_ID = 'client_outbox_d5';
const APPOINTMENT_ID = 'appt_outbox_d5';
const DEPOSIT_ID = 'dep_outbox_d5';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const providerEmail = vi.fn();

async function seedConfirmationJob(appliedRewardId: string | null = null) {
  await db.insert(schema.integrationOutboxSchema).values({
    id: 'job_outbox_d5',
    salonId: SALON_ID,
    appointmentId: APPOINTMENT_ID,
    provider: 'email',
    operation: 'booking_confirmed_side_effects',
    dedupeKey: `deposit:${DEPOSIT_ID}:confirmed-side-effects`,
    payload: {
      appliedRewardId,
      depositId: DEPOSIT_ID,
      googleCalendarSyncEligible: false,
      manageUrl: 'https://app.luster.test/manage/d5-capability',
      smsConsentGranted: true,
    },
  });
}

async function readJob() {
  const [job] = await db.select().from(schema.integrationOutboxSchema)
    .where(eq(schema.integrationOutboxSchema.id, 'job_outbox_d5'));
  return job;
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
  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.appointmentAccessTokenSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentServicesSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.serviceSchema);
  await db.delete(schema.salonClientSchema);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.salonSchema);

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'D5 Salon',
    ownerEmail: null,
    slug: 'd5-outbox-salon',
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
  it('[T77] confirms and marks the exact hold reward once across every replay boundary', async () => {
    const rewardId = 'reward_outbox_exact';
    const decoyId = 'reward_outbox_decoy';
    const originalUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
    await db.insert(schema.rewardSchema).values([
      // Indistinguishable decoy first: amount/type/owner/ordering cannot be
      // used to reconstruct the selected reward.
      {
        id: decoyId,
        salonId: SALON_ID,
        clientPhone: '4165550100',
        type: 'referral_referee',
        discountAmountCents: 500,
      },
      {
        id: rewardId,
        salonId: SALON_ID,
        clientPhone: '4165550100',
        type: 'referral_referee',
        discountAmountCents: 500,
        updatedAt: originalUpdatedAt,
      },
    ]);
    await db.update(schema.appointmentSchema)
      .set({ status: 'awaiting_payment' })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.update(schema.appointmentDepositSchema)
      .set({
        status: 'checkout_created',
        stripePaymentIntentId: null,
        appliedRewardId: rewardId,
        appliedRewardClientId: CLIENT_ID,
        appliedRewardClientPhone: '4165550100',
      })
      .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));

    const evidence = {
      source: 'webhook' as const,
      connectedAccountId: 'acct_outbox_d5',
      sessionId: 'cs_outbox_d5',
      paymentIntentId: 'pi_outbox_d5',
      paymentStatus: 'paid',
      amountTotal: 2500,
      currency: 'cad',
      metadataAppointmentId: APPOINTMENT_ID,
      metadataSalonId: SALON_ID,
      metadataDepositId: DEPOSIT_ID,
    };

    expect(await confirmDepositPayment(evidence)).toMatchObject({ disposition: 'confirmed' });

    const [afterConfirm] = await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, rewardId));
    const [job] = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID));

    expect(afterConfirm?.usedInAppointmentId).toBe(APPOINTMENT_ID);
    expect(afterConfirm?.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
    expect(job?.payload).toEqual(expect.objectContaining({ appliedRewardId: rewardId }));

    // Duplicate webhook/poll/sweep evidence is a no-write confirmation replay.
    expect(await confirmDepositPayment(evidence)).toMatchObject({ disposition: 'already_confirmed' });
    expect(await db.select().from(schema.integrationOutboxSchema)).toHaveLength(1);
    expect(await db.select().from(schema.appointmentAuditLogSchema)).toHaveLength(1);

    // The first real worker run reaches verification, then fails on the last
    // external effect and leaves the whole batch retryable.
    externalEffects.sendBookingNotificationsForNewBooking
      .mockRejectedValueOnce(new Error('owner notification failed'));
    const first = await processIntegrationOutbox();

    expect(first).toMatchObject({ retried: 1, scanned: 1 });

    const [afterFirst] = await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, rewardId));

    expect(afterFirst?.usedInAppointmentId).toBe(APPOINTMENT_ID);
    expect(afterFirst?.updatedAt.getTime()).toBe(afterConfirm?.updatedAt.getTime());
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, decoyId)))[0]?.usedInAppointmentId).toBeNull();

    externalEffects.sendBookingNotificationsForNewBooking.mockResolvedValue(undefined);
    await db.update(schema.integrationOutboxSchema).set({
      availableAt: new Date(Date.now() - 1_000),
    }).where(eq(schema.integrationOutboxSchema.id, job!.id));

    const second = await processIntegrationOutbox();

    expect(second).toMatchObject({ succeeded: 1, scanned: 1 });

    const [afterReplay] = await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, rewardId));

    expect(afterReplay?.usedInAppointmentId).toBe(APPOINTMENT_ID);
    // Only TX-B performed the first mark. Confirmation redelivery and both
    // outbox attempts are exact verification-only replays.
    expect(afterReplay?.updatedAt.getTime()).toBe(afterConfirm?.updatedAt.getTime());
    expect(afterFirst?.updatedAt.getTime()).toBe(afterConfirm?.updatedAt.getTime());
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, decoyId)))[0]?.usedInAppointmentId).toBeNull();
    expect(await db.select().from(schema.integrationOutboxSchema)).toHaveLength(1);
    expect(await db.select().from(schema.appointmentAuditLogSchema)).toHaveLength(1);
  });

  it('rejects a payload reward that differs from the paid deposit attribution', async () => {
    await db.insert(schema.rewardSchema).values([
      {
        id: 'reward_persisted',
        salonId: SALON_ID,
        clientPhone: '4165550100',
        type: 'referral_referee',
      },
      {
        id: 'reward_payload_guess',
        salonId: SALON_ID,
        clientPhone: '4165550100',
        type: 'referral_referrer',
      },
    ]);
    await db.update(schema.appointmentDepositSchema)
      .set({
        appliedRewardId: 'reward_persisted',
        appliedRewardClientId: CLIENT_ID,
        appliedRewardClientPhone: '4165550100',
      })
      .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
    await seedConfirmationJob('reward_payload_guess');

    const result = await processIntegrationOutbox();

    expect(result).toMatchObject({ retried: 1, scanned: 1 });

    const rewards = await db.select().from(schema.rewardSchema);

    expect(rewards.every(reward => reward.usedInAppointmentId === null)).toBe(true);
    expect(externalEffects.sendBookingConfirmationToClient).not.toHaveBeenCalled();
    expect(externalEffects.sendBookingNotificationsForNewBooking).not.toHaveBeenCalled();
    expect(externalEffects.sendSalonNotificationEmail).not.toHaveBeenCalled();
    expect(providerEmail).not.toHaveBeenCalled();
  });

  it('never first-marks a paid attribution after the appointment was cancelled', async () => {
    const rewardId = 'reward_cancelled_before_worker';
    await db.insert(schema.rewardSchema).values({
      id: rewardId,
      salonId: SALON_ID,
      clientPhone: '4165550100',
      type: 'referral_referee',
    });
    await db.update(schema.appointmentDepositSchema)
      .set({
        appliedRewardId: rewardId,
        appliedRewardClientId: CLIENT_ID,
        appliedRewardClientPhone: '4165550100',
      })
      .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
    await db.update(schema.appointmentSchema)
      .set({ status: 'cancelled' })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await seedConfirmationJob(rewardId);

    const result = await processIntegrationOutbox();

    expect(result).toMatchObject({ scanned: 1, succeeded: 1 });
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, rewardId)))[0]?.usedInAppointmentId).toBeNull();
    expect(externalEffects.sendBookingConfirmationToClient).not.toHaveBeenCalled();
  });

  it.each(['expired', 'canceled', 'refunded', 'waived'])(
    'never marks or fires effects for an attributed %s deposit',
    async (depositStatus) => {
      const rewardId = `reward_terminal_${depositStatus}`;
      await db.insert(schema.rewardSchema).values({
        id: rewardId,
        salonId: SALON_ID,
        clientPhone: '4165550100',
        type: 'referral_referee',
      });
      await db.update(schema.appointmentDepositSchema)
        .set({
          status: depositStatus,
          appliedRewardId: rewardId,
          appliedRewardClientId: CLIENT_ID,
          appliedRewardClientPhone: '4165550100',
        })
        .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
      await seedConfirmationJob(rewardId);

      expect(await processIntegrationOutbox()).toMatchObject({ scanned: 1, succeeded: 1 });
      expect((await db.select().from(schema.rewardSchema)
        .where(eq(schema.rewardSchema.id, rewardId)))[0]?.usedInAppointmentId).toBeNull();
      expect(externalEffects.sendBookingConfirmationToClient).not.toHaveBeenCalled();
      expect(externalEffects.sendBookingNotificationsForNewBooking).not.toHaveBeenCalled();
      expect(externalEffects.sendSalonNotificationEmail).not.toHaveBeenCalled();
      expect(providerEmail).not.toHaveBeenCalled();
    },
  );

  it('does not reattach a reward released by cancellation between outbox attempts', async () => {
    const rewardId = 'reward_cancelled_between_retries';
    await db.insert(schema.rewardSchema).values({
      id: rewardId,
      salonId: SALON_ID,
      clientPhone: '4165550100',
      type: 'referral_referee',
      usedInAppointmentId: APPOINTMENT_ID,
    });
    await db.update(schema.appointmentDepositSchema)
      .set({
        appliedRewardId: rewardId,
        appliedRewardClientId: CLIENT_ID,
        appliedRewardClientPhone: '4165550100',
      })
      .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
    await seedConfirmationJob(rewardId);

    expect(await processIntegrationOutbox()).toMatchObject({ retried: 1, scanned: 1 });

    // Both cancellation writers perform this same terminal release in one
    // transaction. The retry must observe it and become a no-op, never a late
    // first mark or re-mark.
    await db.update(schema.appointmentSchema)
      .set({ status: 'cancelled' })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.update(schema.rewardSchema)
      .set({ usedInAppointmentId: null, status: 'active' })
      .where(eq(schema.rewardSchema.id, rewardId));
    await db.update(schema.integrationOutboxSchema)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.integrationOutboxSchema.id, 'job_outbox_d5'));

    expect(await processIntegrationOutbox()).toMatchObject({ succeeded: 1, scanned: 1 });
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, rewardId)))[0]?.usedInAppointmentId).toBeNull();
  });

  it('accepts a completed confirmation whose exact reward was already finalized', async () => {
    const rewardId = 'reward_completed_before_worker';
    const usedAt = new Date('2026-08-12T00:00:00.000Z');
    await db.insert(schema.rewardSchema).values({
      id: rewardId,
      salonId: SALON_ID,
      clientPhone: '4165550100',
      type: 'referral_referee',
      status: 'used',
      usedAt,
      usedInAppointmentId: APPOINTMENT_ID,
    });
    await db.update(schema.appointmentDepositSchema)
      .set({
        appliedRewardId: rewardId,
        appliedRewardClientId: CLIENT_ID,
        appliedRewardClientPhone: '4165550100',
      })
      .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
    await db.update(schema.appointmentSchema)
      .set({ status: 'completed' })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    externalEffects.sendBookingConfirmationToClient.mockResolvedValue(undefined);
    await seedConfirmationJob(rewardId);

    expect(await processIntegrationOutbox()).toMatchObject({ succeeded: 1, scanned: 1 });
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, rewardId)))[0]).toMatchObject({
      status: 'used',
      usedAt,
      usedInAppointmentId: APPOINTMENT_ID,
    });
  });

  it('repairs exact-link completion finalization without first-linking a reward', async () => {
    const rewardId = 'reward_completed_repair';
    await db.insert(schema.rewardSchema).values({
      id: rewardId,
      salonId: SALON_ID,
      clientPhone: '4165550100',
      type: 'referral_referee',
      status: 'active',
      usedInAppointmentId: APPOINTMENT_ID,
    });
    await db.update(schema.appointmentDepositSchema)
      .set({
        appliedRewardId: rewardId,
        appliedRewardClientId: CLIENT_ID,
        appliedRewardClientPhone: '4165550100',
      })
      .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
    await db.update(schema.appointmentSchema)
      .set({ status: 'completed' })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    externalEffects.sendBookingConfirmationToClient.mockResolvedValue(undefined);
    await seedConfirmationJob(rewardId);

    expect(await processIntegrationOutbox()).toMatchObject({ succeeded: 1, scanned: 1 });
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, rewardId)))[0]).toMatchObject({
      status: 'used',
      usedInAppointmentId: APPOINTMENT_ID,
    });
  });

  it('[T20] retries a failed batch without resending the succeeded customer email', async () => {
    externalEffects.sendBookingConfirmationToClient
      .mockReset()
      .mockRejectedValueOnce(new Error('SMS provider failed'))
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
