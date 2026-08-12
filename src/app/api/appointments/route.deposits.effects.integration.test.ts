/**
 * §14 tests 7 and 8 — THE EIGHT SKIP GUARDS, IN BOTH DIRECTIONS.
 *
 * Test 7 is the one that matters most, and it is POSITIVE: for a NON-deposit
 * booking every one of the eight guarded effects must still fire. None of the
 * first three has a positive assertion anywhere else in this repository, so an
 * inverted guard (`if (isDepositHold)`) would silently kill referral
 * attribution, reward redemption and retention conversion for EVERY salon —
 * with a green suite.
 *
 * Test 8 is the mirror: a deposit hold fires none of them, and the client's
 * latest retention outreach is still `prepared`, not `converted`. That last one
 * is terminal and the reaper cannot undo it.
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
  /** Set for the one leg that books as STAFF from the public confirm page. */
  staffSalonId: null as string | null,
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
  requireStaffSession: vi.fn(async () => (holder.staffSalonId
    ? {
        ok: true as const,
        session: {
          salonId: holder.staffSalonId,
          technicianId: 'tech_deposits_post',
          technicianName: 'Daniela',
        },
      }
    : { ok: false as const, response: new Response(null, { status: 401 }) })),
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

vi.mock('@/libs/googleEventReview', () => ({
  recordGoogleEventReviewDecision: vi.fn(async () => {}),
}));

vi.mock('@/libs/publicUrl', () => ({
  buildSalonTenantPublicUrl: vi.fn(() => 'http://localhost:3101/manage/token'),
  getCanonicalAppOrigin: vi.fn(() => 'https://app.luster.test'),
}));

// ---------------------------------------------------------------------------
// Deposit-specific doubles
// ---------------------------------------------------------------------------

const deposits = vi.hoisted(() => ({
  /** What the PRE-TRANSACTION scope read resolves to for this leg. */
  scopeRead: null as unknown,
  /** What the IN-TRANSACTION pure resolver resolves to for this leg. */
  inTxPolicy: null as unknown,
  getDepositPolicyForSalon: vi.fn(),
  refreshAccountReadiness: vi.fn(),
  createDepositCheckoutSession: vi.fn(),
  /** Per-leg override for the charge resolver; null = use D3's real one. */
  chargeOverride: null as null | ((...args: unknown[]) => unknown),
}));

vi.mock('@/libs/depositPolicy.server', () => ({
  EXPECTED_LIVEMODE: false,
  getDepositPolicyForSalon: deposits.getDepositPolicyForSalon,
}));

vi.mock('@/libs/stripeConnect/readiness', () => ({
  refreshAccountReadiness: deposits.refreshAccountReadiness,
  StripeConnectUnavailableError: class StripeConnectUnavailableError extends Error {},
}));

vi.mock('@/libs/depositPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/depositPolicy')>();
  return {
    ...actual,
    // The fingerprint parser/builder, DEPOSIT_CURRENCY and MIN_DEPOSIT_CENTS all
    // stay REAL, so the magnitude rule and the currency literal are genuinely
    // exercised. resolveDepositChargeForTotal is real too UNLESS a leg installs
    // an override — two legs need a charge shape D3's resolver will never
    // produce on its own (a thrown TypeError, and a required amount below the
    // floor), and both are refusals that must be reachable.
    resolveDepositPolicy: vi.fn(() => deposits.inTxPolicy),
    resolveDepositChargeForTotal: vi.fn((...args: unknown[]) =>
      (deposits.chargeOverride
        ? deposits.chargeOverride(...args)
        : (actual.resolveDepositChargeForTotal as (...a: unknown[]) => unknown)(...args))),
  };
});

vi.mock('@/libs/depositCheckout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/depositCheckout')>();
  return { ...actual, createDepositCheckoutSession: deposits.createDepositCheckoutSession };
});

const effects = vi.hoisted(() => ({
  enqueueGoogleCalendarUpsert: vi.fn(async () => {}),
  sendCustomerBookingConfirmationEmail: vi.fn(async () => ({ delivered: false })),
  sendBookingConfirmationToClient: vi.fn(async () => ({ success: true })),
  sendBookingNotificationsForNewBooking: vi.fn(async () => {}),
  automaticDiscount: null as unknown,
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarUpsert: effects.enqueueGoogleCalendarUpsert,
  enqueueGoogleCalendarDelete: vi.fn(async () => {}),
}));

vi.mock('@/libs/customerBookingEmail', () => ({
  sendCustomerBookingConfirmationEmail: effects.sendCustomerBookingConfirmationEmail,
}));

vi.mock('@/libs/SMS', () => ({
  sendBookingConfirmationToClient: effects.sendBookingConfirmationToClient,
  sendRescheduleConfirmation: vi.fn(async () => ({ success: true })),
  sendCancellationNotificationToTech: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForNewBooking: effects.sendBookingNotificationsForNewBooking,
}));

vi.mock('@/libs/firstVisitDiscount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/firstVisitDiscount')>();
  return {
    ...actual,
    // Overridden so a reward is genuinely APPLIED and the guarded
    // `used_in_appointment_id` write becomes observable on a real row. Reward
    // RESOLUTION is not what these tests are about; the guard is.
    resolveAutomaticBookingDiscount: vi.fn(async (...args: unknown[]) =>
      (effects.automaticDiscount
        ?? (actual.resolveAutomaticBookingDiscount as (...a: unknown[]) => unknown)(...args))),
  };
});

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_effects_post';
const SALON_SLUG = 'effects-post-salon';
const TECH_ID = 'tech_effects_post';
const SERVICE_ID = 'srv_effects_post';
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
  return `416999${String(1000 + counter).padStart(4, '0')}`;
}

const ACTIVE_POLICY = { active: true, amountCents: 2500, currency: 'cad' } as const;

function seedPolicy(scope: Record<string, unknown>) {
  deposits.scopeRead = { ...scope, readinessStale: false, readinessAgeMs: null };
  deposits.getDepositPolicyForSalon.mockResolvedValue(deposits.scopeRead);
  deposits.inTxPolicy = scope;
}

function seedChargeReady(ready: boolean) {
  deposits.refreshAccountReadiness.mockResolvedValue({
    chargeReady: ready,
    status: ready ? 'charge_ready' : 'not_charge_ready',
    payoutsPending: false,
    binding: {
      stripeAccountId: 'acct_live',
      chargesEnabled: ready,
      revokedAt: null,
      lastSyncedAt: new Date('2099-01-01T00:00:00Z'),
      livemode: false,
    },
  });
}

/**
 * Seed everything the three DB-backed effects need, so each one is observable
 * as a real row change rather than as a spy on a mock.
 */
async function seedEffectFixtures(phone: string) {
  counter += 1;
  const clientId = `sc_fx_${counter}`;
  const rewardId = `rwd_fx_${counter}`;
  const decoyRewardId = `rwd_fx_decoy_${counter}`;
  const referralId = `ref_fx_${counter}`;
  const communicationId = `comm_fx_${counter}`;

  await db.insert(schema.salonClientSchema).values({
    id: clientId,
    salonId: SALON_ID,
    phone,
    fullName: 'Effects Client',
  });
  await db.insert(schema.clientCommunicationSchema).values({
    id: communicationId,
    salonId: SALON_ID,
    salonClientId: clientId,
    kind: 'rebook',
    status: 'prepared',
  });
  await db.insert(schema.referralSchema).values({
    id: referralId,
    salonId: SALON_ID,
    referrerPhone: '4165550000',
    refereePhone: phone,
    status: 'claimed',
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
  // Insert an indistinguishable decoy first. Persisting the expected id must
  // come from the resolver's exact selection, never a first-row/type/amount
  // reconstruction inside the hold transaction.
  await db.insert(schema.rewardSchema).values({
    id: decoyRewardId,
    salonId: SALON_ID,
    clientPhone: phone,
    type: 'referral_referee',
    discountAmountCents: 500,
  });
  await db.insert(schema.rewardSchema).values({
    id: rewardId,
    salonId: SALON_ID,
    clientPhone: phone,
    type: 'referral_referee',
    discountAmountCents: 500,
  });

  // Make that reward the applied discount, so the guarded write is exercised.
  effects.automaticDiscount = {
    kind: 'reward',
    subtotalBeforeDiscountCents: 4500,
    discountAmountCents: 500,
    finalTotalCents: 4000,
    reward: { id: rewardId, discountAmountCents: 500, discountedServiceId: null },
    firstVisit: null,
  };

  return { clientId, rewardId, decoyRewardId, referralId, communicationId };
}

async function postBooking(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      salonSlug: SALON_SLUG,
      baseServiceId: SERVICE_ID,
      technicianId: TECH_ID,
      smsConsent: { granted: true, wordingVersion: 'booking-v1' },
      ...body,
    }),
  }));
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Effects Salon',
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
  holder.staffSalonId = null;
  vi.clearAllMocks();
  effects.automaticDiscount = null;
  sendTransactionalEmailDetailed.mockResolvedValue({
    ok: true,
    errorCode: null,
    providerMessageId: 'msg_fx',
  });
  effects.enqueueGoogleCalendarUpsert.mockResolvedValue(undefined);
  effects.sendCustomerBookingConfirmationEmail.mockResolvedValue({ delivered: false });
  effects.sendBookingConfirmationToClient.mockResolvedValue({ success: true });
  effects.sendBookingNotificationsForNewBooking.mockResolvedValue(undefined);
  deposits.createDepositCheckoutSession.mockResolvedValue({
    ok: true,
    session: {
      id: 'cs_fx',
      url: 'https://checkout.stripe.com/c/pay/cs_fx',
      expires_at: 0,
      payment_intent: null,
    },
  });
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.notificationDeliverySchema);
  await db.delete(schema.appointmentServicesSchema);
  await db.delete(schema.clientCommunicationSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.referralSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonClientSchema);
});

afterAll(async () => {
  await client.close();
});

async function readEffects(ids: { rewardId: string; referralId: string; communicationId: string }) {
  const [reward] = await db.select().from(schema.rewardSchema)
    .where(eq(schema.rewardSchema.id, ids.rewardId));
  const [referral] = await db.select().from(schema.referralSchema)
    .where(eq(schema.referralSchema.id, ids.referralId));
  const [communication] = await db.select().from(schema.clientCommunicationSchema)
    .where(eq(schema.clientCommunicationSchema.id, ids.communicationId));
  const deliveries = await db.select().from(schema.notificationDeliverySchema);
  return { reward, referral, communication, deliveries };
}

/**
 * §14 test 7 — POSITIVE. Every one of the eight still fires for a normal
 * booking. Inverting any single guard must redden this.
 */
describe('7 — the skip guards disabled nothing for real bookings', () => {
  it('all eight guarded effects fire on a non-deposit booking', async () => {
    // Deposits configuration-side inactive => SKIP => an ordinary booking.
    seedPolicy({ active: false, reason: 'disabled', amountCents: 2500 });
    const phone = freshPhone();
    const ids = await seedEffectFixtures(phone);
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };

    const response = await postBooking({
      startTime: at(futureDate(70), '10:00').toISOString(),
    });

    expect(response.status).toBe(201);

    const after = await readEffects(ids);

    // 1/8 retention outreach conversion — TERMINAL, and unasserted anywhere else.
    expect(after.communication!.status).toBe('converted');
    // 2/8 reward marked used against this appointment.
    expect(after.reward!.usedInAppointmentId).toBeTruthy();
    // 3/8 referral flipped claimed -> booked.
    expect(after.referral!.status).toBe('booked');
    // 4/8 Google Calendar upsert enqueued.
    expect(effects.enqueueGoogleCalendarUpsert).toHaveBeenCalledTimes(1);
    // 5/8 customer confirmation email.
    expect(effects.sendCustomerBookingConfirmationEmail).toHaveBeenCalledTimes(1);
    // 6/8 client SMS.
    expect(effects.sendBookingConfirmationToClient).toHaveBeenCalledTimes(1);
    // 7/8 salon-facing booking alert.
    expect(after.deliveries.filter(row => row.purpose === 'salon_new_booking')).toHaveLength(1);
    // 8/8 staff notifications.
    expect(effects.sendBookingNotificationsForNewBooking).toHaveBeenCalledTimes(1);
  });
});

/** §14 test 8 — the mirror: a hold leaks nothing. */
describe('8 — a deposit booking leaks nothing', () => {
  it('none of the eight fire, and the outreach row is still prepared', async () => {
    seedPolicy(ACTIVE_POLICY);
    seedChargeReady(true);
    const phone = freshPhone();
    const ids = await seedEffectFixtures(phone);
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };

    const response = await postBooking({
      startTime: at(futureDate(71), '10:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.deposit.required).toBe(true);

    const after = await readEffects(ids);
    const [persistedDeposit] = await db.select().from(schema.appointmentDepositSchema);

    // The one the reaper could never undo.
    expect(after.communication!.status).toBe('prepared');
    expect(after.reward!.usedInAppointmentId).toBeFalsy();
    // D5-RWD-1: persist the resolver's exact id before returning the hold. The
    // same-client decoy proves this is not reconstructed from ownership,
    // discount amount or another plausible reward.
    expect(persistedDeposit?.appliedRewardId).toBe(ids.rewardId);
    expect(persistedDeposit?.appliedRewardId).not.toBe(ids.decoyRewardId);
    expect(persistedDeposit?.appliedRewardClientId).toBe(ids.clientId);
    expect(persistedDeposit?.appliedRewardClientPhone).toBe(phone);
    expect(after.referral!.status).toBe('claimed');
    expect(effects.enqueueGoogleCalendarUpsert).not.toHaveBeenCalled();
    expect(effects.sendCustomerBookingConfirmationEmail).not.toHaveBeenCalled();
    expect(effects.sendBookingConfirmationToClient).not.toHaveBeenCalled();
    expect(after.deliveries).toHaveLength(0);
    expect(effects.sendBookingNotificationsForNewBooking).not.toHaveBeenCalled();
  });

  it('rejects a stale foreign-client reward without substituting another reward', async () => {
    seedPolicy(ACTIVE_POLICY);
    seedChargeReady(true);
    const phone = freshPhone();
    const ids = await seedEffectFixtures(phone);
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };

    await db.update(schema.rewardSchema)
      .set({ clientPhone: '4165550009' })
      .where(eq(schema.rewardSchema.id, ids.rewardId));

    const response = await postBooking({
      startTime: at(futureDate(72), '10:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('REWARD_UNAVAILABLE');
    expect(await db.select().from(schema.appointmentDepositSchema)).toHaveLength(0);
    expect(await db.select().from(schema.appointmentSchema)).toHaveLength(0);
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, ids.decoyRewardId)))[0]?.usedInAppointmentId)
      .toBeNull();
  });

  it.each(['used_status', 'already_linked', 'expired', 'foreign_salon'])(
    'revalidates an exact reward that became %s before the hold transaction',
    async (mutation) => {
      seedPolicy(ACTIVE_POLICY);
      seedChargeReady(true);
      const phone = freshPhone();
      const ids = await seedEffectFixtures(phone);
      holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };

      if (mutation === 'used_status') {
        await db.update(schema.rewardSchema)
          .set({ status: 'used' })
          .where(eq(schema.rewardSchema.id, ids.rewardId));
      } else if (mutation === 'already_linked') {
        const linkedAppointmentId = `appt_linked_reward_${counter}`;
        const start = at(futureDate(110 + counter), '09:00');
        await db.insert(schema.appointmentSchema).values({
          id: linkedAppointmentId,
          salonId: SALON_ID,
          clientPhone: '4165559991',
          startTime: start,
          endTime: new Date(start.getTime() + 3_600_000),
          status: 'completed',
          totalPrice: 5000,
          totalDurationMinutes: 60,
        });
        await db.update(schema.rewardSchema)
          .set({ usedInAppointmentId: linkedAppointmentId })
          .where(eq(schema.rewardSchema.id, ids.rewardId));
      } else if (mutation === 'expired') {
        await db.update(schema.rewardSchema)
          .set({ expiresAt: new Date('2000-01-01T00:00:00.000Z') })
          .where(eq(schema.rewardSchema.id, ids.rewardId));
      } else {
        const foreignSalonId = `salon_reward_foreign_${counter}`;
        await db.insert(schema.salonSchema).values({
          id: foreignSalonId,
          name: 'Foreign Reward Salon',
          slug: `foreign-reward-salon-${counter}`,
          ownerEmail: `foreign-${counter}@example.invalid`,
        });
        await db.update(schema.rewardSchema)
          .set({ salonId: foreignSalonId })
          .where(eq(schema.rewardSchema.id, ids.rewardId));
      }

      const response = await postBooking({
        startTime: at(futureDate(80 + counter), '10:00').toISOString(),
        expectedDepositFingerprint: 'deposit-v1:cad:2500',
      });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.code).toBe('REWARD_UNAVAILABLE');
      expect(await db.select().from(schema.appointmentDepositSchema)).toHaveLength(0);
      expect((await db.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.clientPhone, phone)))).toHaveLength(0);
      expect((await db.select().from(schema.rewardSchema)
        .where(eq(schema.rewardSchema.id, ids.decoyRewardId)))[0]?.usedInAppointmentId)
        .toBeNull();
    },
  );
});
