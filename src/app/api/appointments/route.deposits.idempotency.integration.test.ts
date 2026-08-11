/**
 * §14 test 11 — THE IDEMPOTENT REPLAY CARRIES THE DEPOSIT OBJECT.
 *
 * The deposit object is built BEFORE the cache write, so the cached 201 and the
 * returned 201 are the same object. Attaching it after the cache write would
 * hand a replayed client a 201 with nowhere to pay — and the replay is exactly
 * the double-submit case this cache exists for.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
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
      ? {
          get: redisState.get,
          set: redisState.set,
          eval: vi.fn(async () => 1),
        }
      : null;
  },
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

const guards = vi.hoisted(() => ({ lockTechnicianAndAssertSlotFree: vi.fn() }));

vi.mock('@/libs/bookingConflictGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/bookingConflictGuard')>();
  return {
    ...actual,
    // Spied, not replaced: the real guard still runs. Test 12 asserts the hold
    // re-entry refuses BEFORE the technician advisory lock is taken.
    lockTechnicianAndAssertSlotFree: guards.lockTechnicianAndAssertSlotFree
      .mockImplementation(actual.lockTechnicianAndAssertSlotFree),
  };
});

vi.mock('@/libs/depositCheckout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/depositCheckout')>();
  return { ...actual, createDepositCheckoutSession: deposits.createDepositCheckoutSession };
});

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_idem';
const SALON_SLUG = 'idem-salon';
const TECH_ID = 'tech_idem';
const SERVICE_ID = 'srv_idem';
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
  return `416777${String(2000 + counter).padStart(4, '0')}`;
}

const ACTIVE_POLICY = { active: true, amountCents: 2500, currency: 'cad' } as const;

async function postBooking(idempotencyKey: string, startTime: string): Promise<Response> {
  return POST(new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      salonSlug: SALON_SLUG,
      baseServiceId: SERVICE_ID,
      technicianId: TECH_ID,
      startTime,
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
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
    name: 'Idem Salon',
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
  vi.clearAllMocks();
  holder.staffSalonId = null;
  redisState.available = true;
  redisState.store.clear();
  // Lock acquisition succeeds; the cache starts empty.
  redisState.set.mockResolvedValue('OK');
  redisState.get.mockResolvedValue(null);
  sendTransactionalEmailDetailed.mockResolvedValue({
    ok: true,
    errorCode: null,
    providerMessageId: 'msg_idem',
  });
  deposits.scopeRead = { ...ACTIVE_POLICY, readinessStale: false, readinessAgeMs: null };
  deposits.getDepositPolicyForSalon.mockResolvedValue(deposits.scopeRead);
  deposits.inTxPolicy = ACTIVE_POLICY;
  deposits.chargeOverride = null;
  deposits.refreshAccountReadiness.mockResolvedValue({
    chargeReady: true,
    status: 'charge_ready',
    payoutsPending: false,
    binding: {
      stripeAccountId: 'acct_live',
      chargesEnabled: true,
      revokedAt: null,
      lastSyncedAt: new Date('2099-01-01T00:00:00Z'),
      livemode: false,
    },
  });
  deposits.createDepositCheckoutSession.mockResolvedValue({
    ok: true,
    session: {
      id: 'cs_idem',
      url: 'https://checkout.stripe.com/c/pay/cs_idem',
      expires_at: 0,
      payment_intent: null,
    },
  });
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonClientSchema);
});

afterAll(async () => {
  await client.close();
});

describe('11 — idempotent replay carries the deposit object', () => {
  it('the cached payload round-trips the checkout URL, and Stripe is called ONCE', async () => {
    holder.clientSession = {
      normalizedPhone: freshPhone(),
      phoneVariants: ['x'],
    };
    const key = 'idem-key-1';
    const startTime = at(futureDate(90), '10:00').toISOString();

    const first = await postBooking(key, startTime);
    const firstBody = await first.json();

    expect(first.status).toBe(201);
    expect(firstBody.data.deposit.checkoutUrl)
      .toBe('https://checkout.stripe.com/c/pay/cs_idem');

    // Take the ACTUAL cached payload — not a hand-built one — so this proves the
    // deposit object was attached BEFORE the cache write.
    // Selected by PAYLOAD SHAPE, not by key or by the 'PX' flag: the lock write
    // uses 'PX' too and its value is an owner-token UUID.
    const cacheWrite = redisState.set.mock.calls.find((call) => {
      try {
        return typeof JSON.parse(String(call[1]))?.payloadHash === 'string';
      } catch {
        return false;
      }
    });

    expect(cacheWrite).toBeDefined();

    const cachedPayload = String(cacheWrite![1]);

    expect(cachedPayload).toContain('checkout.stripe.com/c/pay/cs_idem');

    // Replay: the cache now answers.
    redisState.get.mockResolvedValue(cachedPayload);
    deposits.createDepositCheckoutSession.mockClear();

    const replay = await postBooking(key, startTime);
    const replayBody = await replay.json();

    expect(replay.status).toBe(201);
    expect(replayBody.data.deposit.checkoutUrl)
      .toBe('https://checkout.stripe.com/c/pay/cs_idem');
    expect(replayBody.meta.cached).toBe(true);
    // No second Checkout Session, and no second hold.
    expect(deposits.createDepositCheckoutSession).not.toHaveBeenCalled();
    expect(await db.select().from(schema.appointmentDepositSchema)).toHaveLength(1);
  });

  it('still books, with the deposit, when Redis is unavailable', async () => {
    redisState.available = false;
    holder.clientSession = {
      normalizedPhone: freshPhone(),
      phoneVariants: ['x'],
    };

    const response = await postBooking('idem-key-2', at(futureDate(91), '10:00').toISOString());
    const body = await response.json();

    // Idempotency is an optimisation; losing it must not lose the deposit.
    expect(response.status).toBe(201);
    expect(body.data.deposit.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_idem');
    expect(await db.select().from(schema.appointmentDepositSchema)).toHaveLength(1);
  });
});
