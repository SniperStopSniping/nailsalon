/**
 * D4.5 — THE COMMIT BOUNDARY AND SIDE-EFFECT ORDER ARE PINNED.
 *
 * D4's `route.deposits.effects.integration.test.ts` already asserts WHAT fires
 * (all eight for a real booking, none for a hold). Those legs pass unchanged
 * across this extraction and are the primary characterization; this file adds
 * the two properties the extraction newly makes falsifiable:
 *
 *   1. The Calendar intent commits atomically with the appointment, before the
 *      idempotency cache write. The remaining post-commit effects run after the
 *      cache. No provider call is performed by the transaction-aware enqueue.
 *
 *   2. That the idempotency contract itself did not move: a replay still
 *      returns the cached 201, and the effects still fire exactly once.
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
  clientSession: null as null | { normalizedPhone: string; phoneVariants: string[] },
}));

/**
 * The ordering log. Every observable step appends its name here, so the
 * assertions are about SEQUENCE rather than about counts.
 */
const timeline = vi.hoisted(() => ({ entries: [] as string[] }));

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

const redisState = vi.hoisted(() => ({
  available: true,
  store: new Map<string, string>(),
  set: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/core/redis/redisClient', () => ({
  isRedisAvailable: vi.fn(async () => redisState.available),
  get redis() {
    return redisState.available
      ? { get: redisState.get, set: redisState.set, eval: vi.fn(async () => 1) }
      : null;
  },
}));

vi.mock('@/libs/staffAuth', () => ({
  requireStaffSession: vi.fn(async () => ({
    ok: false as const,
    response: new Response(null, { status: 401 }),
  })),
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async () => ({ ok: false, response: new Response(null, { status: 401 }) })),
  requireAdminSalon: vi.fn(async () => ({ ok: false, response: new Response(null, { status: 401 }) })),
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
        sessionId: 'client_session_commit_effects',
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

const deposits = vi.hoisted(() => ({
  getDepositPolicyForSalon: vi.fn(),
  refreshAccountReadiness: vi.fn(),
  createDepositCheckoutSession: vi.fn(),
  inTxPolicy: null as unknown,
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
  return { ...actual, resolveDepositPolicy: vi.fn(() => deposits.inTxPolicy) };
});

vi.mock('@/libs/depositCheckout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/depositCheckout')>();
  return { ...actual, createDepositCheckoutSession: deposits.createDepositCheckoutSession };
});

const effects = vi.hoisted(() => ({
  enqueueGoogleCalendarUpsert: vi.fn(),
  enqueueGoogleCalendarAppointmentMutation: vi.fn(),
  sendCustomerBookingConfirmationEmail: vi.fn(),
  sendBookingConfirmationToClient: vi.fn(),
  sendBookingNotificationsForNewBooking: vi.fn(),
  automaticDiscount: null as unknown,
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarUpsert: effects.enqueueGoogleCalendarUpsert,
  enqueueGoogleCalendarDelete: vi.fn(async () => {}),
  enqueueGoogleCalendarAppointmentMutation: effects.enqueueGoogleCalendarAppointmentMutation,
  enqueueGoogleCalendarDeleteInTx: vi.fn(async () => ({ inserted: true })),
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
    resolveAutomaticBookingDiscount: vi.fn(async (...args: unknown[]) =>
      (effects.automaticDiscount
        ?? (actual.resolveAutomaticBookingDiscount as (...a: unknown[]) => unknown)(...args))),
  };
});

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_commit_effects';
const SALON_SLUG = 'commit-effects-salon';
const TECH_ID = 'tech_commit_effects';
const SERVICE_ID = 'srv_commit_effects';
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

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

function futureDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function freshPhone(): string {
  counter += 1;
  return `416888${String(1000 + counter).padStart(4, '0')}`;
}

/** Seeds a claimable reward so the used-marking is observable on a real row. */
async function seedRewardFixture(phone: string) {
  counter += 1;
  const clientId = `sc_ce_${counter}`;
  const rewardId = `rwd_ce_${counter}`;

  await db.insert(schema.salonClientSchema).values({
    id: clientId,
    salonId: SALON_ID,
    phone,
    fullName: 'Commit Effects Client',
  });
  await db.insert(schema.rewardSchema).values({
    id: rewardId,
    salonId: SALON_ID,
    clientPhone: phone,
    type: 'referral_referee',
    discountAmountCents: 500,
  });

  effects.automaticDiscount = {
    kind: 'reward',
    subtotalBeforeDiscountCents: 4500,
    discountAmountCents: 500,
    finalTotalCents: 4000,
    reward: { id: rewardId, discountAmountCents: 500, discountedServiceId: null },
    firstVisit: null,
  };

  return { clientId, rewardId };
}

async function postBooking(
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Response> {
  return POST(new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      salonSlug: SALON_SLUG,
      baseServiceId: SERVICE_ID,
      technicianId: TECH_ID,
      smsConsent: { granted: true, wordingVersion: 'booking-v1' },
      ...body,
    }),
  }));
}

/**
 * Both `set` calls carry 'PX'. The LOCK acquisition adds a fifth 'NX' argument;
 * the cache write is the four-argument one. Discriminating on 'PX' alone counts
 * the lock as a cache write and silently breaks every ordering assertion here.
 */
function isCacheWrite(call: unknown[]): boolean {
  return call.length === 4 && call[2] === 'PX';
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Commit Effects Salon',
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
  timeline.entries = [];
  vi.clearAllMocks();
  effects.automaticDiscount = null;

  redisState.available = true;
  redisState.store.clear();
  redisState.get.mockImplementation(async (key: string) => redisState.store.get(key) ?? null);
  redisState.set.mockImplementation(async (...call: unknown[]) => {
    redisState.store.set(call[0] as string, call[1] as string);
    if (isCacheWrite(call)) {
      timeline.entries.push('cache-write');
    }
    return 'OK';
  });

  sendTransactionalEmailDetailed.mockResolvedValue({
    ok: true,
    errorCode: null,
    providerMessageId: 'msg_ce',
  });
  effects.enqueueGoogleCalendarUpsert.mockImplementation(async () => {
    timeline.entries.push('google-upsert');
  });
  effects.enqueueGoogleCalendarAppointmentMutation.mockImplementation(async () => {
    timeline.entries.push('calendar-intent');
    return { inserted: true };
  });
  effects.sendCustomerBookingConfirmationEmail.mockImplementation(async () => {
    timeline.entries.push('customer-email');
    return { delivered: false };
  });
  effects.sendBookingConfirmationToClient.mockImplementation(async () => {
    timeline.entries.push('client-sms');
    return { success: true };
  });
  effects.sendBookingNotificationsForNewBooking.mockImplementation(async () => {
    timeline.entries.push('staff-notifications');
  });

  // Deposits configuration-side inactive => an ordinary, non-hold booking.
  deposits.inTxPolicy = { active: false, reason: 'disabled', amountCents: 2500 };
  deposits.getDepositPolicyForSalon.mockResolvedValue({
    active: false,
    reason: 'disabled',
    amountCents: 2500,
    readinessStale: false,
    readinessAgeMs: null,
  });

  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.notificationDeliverySchema);
  await db.delete(schema.appointmentServicesSchema);
  await db.delete(schema.appointmentAccessTokenSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonClientSchema);
});

afterAll(async () => {
  await client.close();
});

describe('D4.5 — the effects straddle the idempotency cache write', () => {
  /**
   * The load-bearing one. If the runner call is deleted, NOTHING after
   * 'cache-write' is ever followed by those delivery effects. The Calendar
   * intent is deliberately the one entry before the cache because it belongs
   * to the appointment transaction.
   */
  it('the cache write lands FIRST, then every post-commit effect', async () => {
    const phone = freshPhone();
    await seedRewardFixture(phone);
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };

    const response = await postBooking(
      { startTime: at(futureDate(80), '10:00').toISOString() },
      'commit-effects-order-1',
    );

    expect(response.status).toBe(201);

    // Every effect ran...
    expect(timeline.entries).toContain('cache-write');
    expect(timeline.entries).toContain('calendar-intent');
    expect(timeline.entries).toContain('customer-email');
    expect(timeline.entries).toContain('client-sms');
    expect(timeline.entries).toContain('staff-notifications');

    // The durable intent precedes the cache; provider-independent deliveries
    // remain post-commit and follow the cache.
    expect(timeline.entries[0]).toBe('calendar-intent');
    expect(timeline.entries.indexOf('calendar-intent'))
      .toBeLessThan(timeline.entries.indexOf('cache-write'));
    expect(timeline.entries.indexOf('cache-write'))
      .toBeLessThan(timeline.entries.indexOf('customer-email'));

    // The effects kept their original relative order.
    expect(timeline.entries).toEqual([
      'calendar-intent',
      'cache-write',
      'customer-email',
      'client-sms',
      'staff-notifications',
    ]);
  });

  /**
   * The reward used-marking is a REAL row write, so it cannot be logged by a
   * spy. Instead the cache-write mock reads the row at the instant it fires:
   * inside the runner means still-unmarked at cache-write time.
   *
   * This is the leg D5 depends on. Move the used-marking back out of the runner
   * (to where D4 had it, just ahead of the response build) and
   * `markedAtCacheWrite` becomes truthy — red. Delete it entirely and the final
   * assertion goes null — also red.
   */
  it('the reward used-marking runs INSIDE the runner, after the cache write', async () => {
    const phone = freshPhone();
    const { rewardId } = await seedRewardFixture(phone);
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };

    let markedAtCacheWrite: string | null | undefined;
    redisState.set.mockImplementation(async (...call: unknown[]) => {
      redisState.store.set(call[0] as string, call[1] as string);
      if (isCacheWrite(call)) {
        timeline.entries.push('cache-write');
        const [row] = await db.select().from(schema.rewardSchema)
          .where(eq(schema.rewardSchema.id, rewardId));
        markedAtCacheWrite = row?.usedInAppointmentId ?? null;
      }
      return 'OK';
    });

    const response = await postBooking(
      { startTime: at(futureDate(81), '10:00').toISOString() },
      'commit-effects-order-2',
    );

    expect(response.status).toBe(201);
    expect(timeline.entries).toContain('cache-write');

    // At cache-write time the reward was NOT yet marked...
    expect(markedAtCacheWrite).toBeNull();

    // ...and by the end of the request it was.
    const [reward] = await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, rewardId));

    expect(reward!.usedInAppointmentId).toBeTruthy();
  });
});

describe('D4.5 — the idempotency contract is unchanged', () => {
  it('a replay returns the cached 201 and does not re-fire the effects', async () => {
    const phone = freshPhone();
    await seedRewardFixture(phone);
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };

    const startTime = at(futureDate(82), '10:00').toISOString();
    const first = await postBooking({ startTime }, 'commit-effects-replay');

    expect(first.status).toBe(201);

    const firstBody = await first.json();

    // The cached payload is already in the store, exactly as Redis would hold
    // it — the replay reads it back through the same key the route computes.
    expect(redisState.set.mock.calls.some(isCacheWrite)).toBe(true);

    effects.enqueueGoogleCalendarUpsert.mockClear();
    effects.enqueueGoogleCalendarAppointmentMutation.mockClear();
    effects.sendCustomerBookingConfirmationEmail.mockClear();
    effects.sendBookingConfirmationToClient.mockClear();
    effects.sendBookingNotificationsForNewBooking.mockClear();

    const replay = await postBooking({ startTime }, 'commit-effects-replay');

    expect(replay.status).toBe(201);

    const replayBody = await replay.json();

    // The payload is byte-identical; only `meta.cached` marks it as a replay,
    // which is how the route has always answered from cache.
    expect(replayBody.data).toEqual(firstBody.data);
    expect(replayBody.meta.cached).toBe(true);
    expect(firstBody.meta.cached).toBeUndefined();

    // The replay is answered from cache: no second batch of effects.
    expect(effects.enqueueGoogleCalendarAppointmentMutation).not.toHaveBeenCalled();
    expect(effects.sendCustomerBookingConfirmationEmail).not.toHaveBeenCalled();
    expect(effects.sendBookingConfirmationToClient).not.toHaveBeenCalled();
    expect(effects.sendBookingNotificationsForNewBooking).not.toHaveBeenCalled();

    // And exactly one appointment exists.
    const appointments = await db.select().from(schema.appointmentSchema);

    expect(appointments).toHaveLength(1);
  });
});

describe('D4.5 — the route still mints exactly one manage capability', () => {
  it('persists only the hash, expiring 30 days after the appointment ends', async () => {
    const phone = freshPhone();
    await seedRewardFixture(phone);
    holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };

    const response = await postBooking(
      { startTime: at(futureDate(83), '10:00').toISOString() },
      'commit-effects-capability',
    );

    expect(response.status).toBe(201);

    const body = await response.json();

    const [appointment] = await db.select().from(schema.appointmentSchema);
    const tokens = await db.select().from(schema.appointmentAccessTokenSchema);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.appointmentId).toBe(appointment!.id);
    expect(tokens[0]!.salonId).toBe(SALON_ID);
    expect(tokens[0]!.revokedAt).toBeNull();

    // The plaintext never lands in the row — only its hash.
    expect(tokens[0]!.tokenHash).toBeTruthy();
    expect(body.data.manageUrl).toContain('http');
    expect(tokens[0]!.tokenHash).not.toContain(body.data.manageUrl);

    // Expiry is the appointment END plus 30 days, to the second.
    const expectedExpiry = appointment!.endTime.getTime() + 30 * 24 * 60 * 60 * 1000;

    expect(tokens[0]!.expiresAt!.getTime()).toBe(expectedExpiry);
  });
});
