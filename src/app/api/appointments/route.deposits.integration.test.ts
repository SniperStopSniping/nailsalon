/**
 * §14 test 28 (and 27, and 4) — THE DEPOSIT-BRANCH SCOPE PREDICATE.
 *
 * Real SQL on a dedicated PGlite through the ACTUAL route handler, so "no
 * appointment row at all" and "no appointment_deposit row" are assertions about
 * committed state rather than about a mock.
 *
 * WHY D3's PURE RESOLVER IS STUBBED HERE. `DEPOSIT_COLLECTION_LIVE` is `false`
 * at this head — it is D5's to flip (§9), not D4's — so the real
 * `resolveDepositPolicy` returns `collection_not_live` for every salon and the
 * deposit WRITE path is unreachable by construction. Stubbing the pure resolver
 * is the only way to exercise it without flipping a constant this PR does not
 * own. Everything else is real: the reason partition, the fingerprint parser and
 * its magnitude rule, the transaction, and both INSERTs.
 *
 * THE ENTER/SKIP DISCRIMINATOR IS THE `refreshAccountReadiness` SPY, NEVER an
 * `accounts.retrieve` count: D2 resolves not_connected / revoked / mode_mismatch
 * LOCALLY with no provider call, so a retrieve count cannot tell ENTER from SKIP
 * at 'account_not_connected'.
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
    // The ONLY stub. The fingerprint parser/builder, DEPOSIT_CURRENCY,
    // MIN_DEPOSIT_CENTS and resolveDepositChargeForTotal all stay REAL, so the
    // magnitude rule and the currency literal are genuinely exercised.
    resolveDepositPolicy: vi.fn(() => deposits.inTxPolicy),
  };
});

vi.mock('@/libs/depositCheckout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/depositCheckout')>();
  return { ...actual, createDepositCheckoutSession: deposits.createDepositCheckoutSession };
});

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_deposits_post';
const SALON_SLUG = 'deposits-post-salon';
const TECH_ID = 'tech_deposits_post';
const SERVICE_ID = 'srv_deposits_post';
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
  return `416888${String(1000 + counter).padStart(4, '0')}`;
}

function setClientSession(phone: string) {
  holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };
}

/** Seed the PRE-TRANSACTION read; the in-tx resolver mirrors it unless overridden. */
function seedPolicy(scope: Record<string, unknown>, inTx?: Record<string, unknown>) {
  deposits.scopeRead = { ...scope, readinessStale: false, readinessAgeMs: null };
  deposits.getDepositPolicyForSalon.mockResolvedValue(deposits.scopeRead);
  deposits.inTxPolicy = inTx ?? scope;
}

const ACTIVE_POLICY = { active: true, amountCents: 2500, currency: 'cad' } as const;

function seedChargeReady(ready: boolean) {
  deposits.refreshAccountReadiness.mockResolvedValue(
    ready
      ? {
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
        }
      : {
          chargeReady: false,
          status: 'not_charge_ready',
          binding: {
            stripeAccountId: 'acct_live',
            chargesEnabled: false,
            revokedAt: null,
            lastSyncedAt: new Date('2099-01-01T00:00:00Z'),
            livemode: false,
          },
        },
  );
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

async function appointmentRows() {
  return db.select().from(schema.appointmentSchema);
}

async function depositRows() {
  return db.select().from(schema.appointmentDepositSchema);
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Deposits Salon',
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
  vi.clearAllMocks();
  sendTransactionalEmailDetailed.mockResolvedValue({
    ok: true,
    errorCode: null,
    providerMessageId: 'msg_deposits',
  });
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  seedChargeReady(false);
  deposits.createDepositCheckoutSession.mockResolvedValue({
    ok: true,
    session: {
      id: 'cs_test_dep',
      url: 'https://checkout.stripe.com/c/pay/cs_test_dep',
      expires_at: 0,
      payment_intent: 'pi_dep',
    },
  });
});

afterAll(async () => {
  await client.close();
});

/**
 * 28(f) — PRE-TRANSACTION 'undetermined' -> R0. MANDATORY; no other leg covers it.
 *
 * Mutation: restore a composite-verdict predicate (enter only when the pre-read
 * verdict is `active`) -> RED, because the booking then commits: an appointment
 * row exists with no deposit row and no 503.
 */
describe('28(f) — the pre-transaction undetermined refusal', () => {
  it('503s with NO appointment row and never calls refreshAccountReadiness', async () => {
    seedPolicy({ active: false, reason: 'undetermined', amountCents: 2500 });
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(futureDate(20), '10:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('DEPOSITS_TEMPORARILY_UNAVAILABLE');
    // The whole point: a composite-verdict gate books FREE here.
    expect(await appointmentRows()).toHaveLength(0);
    expect(await depositRows()).toHaveLength(0);
    expect(deposits.refreshAccountReadiness).not.toHaveBeenCalled();
  });
});

/**
 * 28(g) — THE ACCOUNT-SIDE ARM, PER LITERAL, both fingerprint directions.
 *
 * Three seeds, each with both sub-legs, deliberately NOT parameterised into a
 * single assertion: a suite that seeds only 'account_not_charge_ready' leaves
 * M-g1 green, and that implementation silently commits FREE BOOKINGS for every
 * client shown a deposit at a deauthorized or never-synced salon.
 */
const ACCOUNT_SIDE_LITERALS = [
  ['g-A', 'account_not_charge_ready'],
  ['g-B', 'account_not_connected'],
  ['g-C', 'readiness_never_synced'],
] as const;

describe.each(ACCOUNT_SIDE_LITERALS)('28(%s) — %s', (_label, reason) => {
  it('(i) a DISCLOSED deposit ENTERS, the live proof fails closed -> 503, no rows', async () => {
    seedPolicy({ active: false, reason, amountCents: 2500 });
    seedChargeReady(false);
    setClientSession(freshPhone());

    // Assert the seed really resolves the literal it claims, before asserting
    // anything about the response — a seed that lands elsewhere is vacuous.
    expect((deposits.scopeRead as { reason: string }).reason).toBe(reason);

    const response = await postBooking({
      startTime: at(futureDate(21), '11:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('DEPOSITS_TEMPORARILY_UNAVAILABLE');
    expect(await appointmentRows()).toHaveLength(0);
    expect(await depositRows()).toHaveLength(0);
    // ENTER is proven on the readiness spy, not on a retrieve count.
    expect(deposits.refreshAccountReadiness).toHaveBeenCalledTimes(1);
  });

  it('(ii) the deposit-v1:none SENTINEL SKIPS -> 201 free, no deposit object', async () => {
    seedPolicy({ active: false, reason, amountCents: 2500 });
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(futureDate(22), '12:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:none',
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    // Policy is NOT active, so the object is absent entirely — contrast with the
    // outside-the-branch case, where `{ required:false }` is never omitted.
    expect(body.data.deposit).toBeUndefined();
    expect(await depositRows()).toHaveLength(0);
    expect(deposits.refreshAccountReadiness).not.toHaveBeenCalled();
  });
});

/**
 * The SKIP set has THREE members, not one. (g-ii) exercises only the sentinel,
 * so the two null-parse members are legs of their own. Carried on seed (g-A)
 * only: the null-arm computation is a single shared site by construction, and
 * M-g1 already pins the per-literal condition from the sentinel side.
 */
describe('28(g-A) — the two NULL-PARSE members of the skip set', () => {
  it('(g-A-ii-b) an ABSENT field skips -> 201 free (the pre-D3 client bundle)', async () => {
    seedPolicy({ active: false, reason: 'account_not_charge_ready', amountCents: 2500 });
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(futureDate(23), '13:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.deposit).toBeUndefined();
    expect(await depositRows()).toHaveLength(0);
    expect(deposits.refreshAccountReadiness).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong version', 'deposit-v2:cad:2500'],
    ['truncated', 'deposit-v1:cad:'],
  ])('(g-A-ii-c) a malformed token (%s) skips -> 201 free', async (_label, token) => {
    seedPolicy({ active: false, reason: 'account_not_charge_ready', amountCents: 2500 });
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(futureDate(24), '14:00').toISOString(),
      expectedDepositFingerprint: token,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.deposit).toBeUndefined();
    expect(await depositRows()).toHaveLength(0);
    expect(deposits.refreshAccountReadiness).not.toHaveBeenCalled();
  });
});

/**
 * 28(g-iii) — STALE STORED ROW, LIVE-READY -> the honest path COLLECTS.
 *
 * Proves the stored row is a routing hint only and that server-authoritative
 * recomputation is decisive. It is also the executable statement of the
 * accepted residual's ONE exception: the same request with a forged
 * 'deposit-v1:none' takes (g-A-ii) and commits free, forfeiting a deposit that
 * really was collectable.
 */
describe('28(g-iii) — stale stored row, live account healthy', () => {
  it('201 WITH a deposit: hold created, both amounts persisted', async () => {
    seedPolicy({ active: false, reason: 'account_not_charge_ready', amountCents: 2500 }, ACTIVE_POLICY);
    seedChargeReady(true);
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(futureDate(25), '15:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.deposit.required).toBe(true);
    expect(body.data.deposit.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_dep');
    expect(body.data.deposit.currency).toBe('cad');

    const [appointment] = await appointmentRows();

    expect(appointment!.status).toBe('awaiting_payment');
    expect(appointment!.depositHoldExpiresAt).not.toBeNull();

    // 35 minutes after created_at, give or take clock granularity.
    const heldMinutes = (appointment!.depositHoldExpiresAt!.getTime()
      - appointment!.createdAt.getTime()) / 60_000;

    expect(Math.round(heldMinutes)).toBe(35);

    const [deposit] = await depositRows();

    expect(deposit!.status).toBe('checkout_created');
    expect(deposit!.amountCents).toBe(2500);
    expect(deposit!.disclosedAmountCents).toBe(2500);
    // The lowercase literal really reached the real 0065 CHECK (§14 test 2b).
    expect(deposit!.currency).toBe('cad');
    expect(deposit!.stripeCheckoutSessionId).toBe('cs_test_dep');
    expect(deposit!.checkoutSuccessUrl).toBeTruthy();
    expect(deposit!.checkoutCancelUrl).toBeTruthy();
  });
});

/**
 * 28(g-iv) — CONFIGURATION-SIDE MEMBERSHIP, pinned from the other side.
 * The fingerprint is deliberately INERT on this arm: no disclosure can drag a
 * decided-off salon into the branch.
 */
describe('28(g-iv) — a configuration-side reason ignores the disclosure', () => {
  it('\'disabled\' + a disclosed deposit -> 201 free, readiness never called', async () => {
    seedPolicy({ active: false, reason: 'disabled', amountCents: 2500 });
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(futureDate(26), '16:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.deposit).toBeUndefined();
    expect(await depositRows()).toHaveLength(0);
    expect(deposits.refreshAccountReadiness).not.toHaveBeenCalled();
  });
});

/**
 * §14 test 27 — THE DISCLOSURE FINGERPRINT IS BINDING, BOTH DIRECTIONS.
 *
 * A plain equality implementation passes (a) and FAILS (b), and (b) is a hard
 * rejection of a client who now owes LESS.
 */
describe('27 — the fingerprint magnitude rule at an ACTIVE salon', () => {
  beforeEach(() => {
    seedPolicy(ACTIVE_POLICY);
    seedChargeReady(true);
  });

  it('(a) UPWARD blocks: disclosed 2500, authoritative 4000 -> 409, no rows', async () => {
    // Both figures sit UNDER the 4500 booking total, so this leg tests the
    // magnitude rule rather than the resolver's cap.
    deposits.inTxPolicy = { active: true, amountCents: 4000, currency: 'cad' };
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(futureDate(27), '10:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DEPOSIT_CHANGED');
    expect(body.error.details.deposit).toEqual({
      required: true,
      amountCents: 4000,
      fingerprint: 'deposit-v1:cad:4000',
    });
    expect(await appointmentRows()).toHaveLength(0);
    expect(await depositRows()).toHaveLength(0);
    expect(deposits.createDepositCheckoutSession).not.toHaveBeenCalled();
  });

  it('(b) DOWNWARD PASSES: disclosed 2500, authoritative 1800 -> 201, both persisted', async () => {
    deposits.inTxPolicy = { active: true, amountCents: 1800, currency: 'cad' };
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(futureDate(28), '10:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
    });

    expect(response.status).toBe(201);

    const [deposit] = await depositRows();

    // amount_cents <= disclosed_amount_cents is the invariant; equality is NOT.
    expect(deposit!.amountCents).toBe(1800);
    expect(deposit!.disclosedAmountCents).toBe(2500);
  });

  it('(c) an ABSENT field with required:true -> 409 DEPOSIT_CHANGED', async () => {
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(futureDate(29), '10:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DEPOSIT_CHANGED');
    expect(await appointmentRows()).toHaveLength(0);
  });

  it('(e) the SENTINEL at an ACTIVE salon -> 409, never a silent charge', async () => {
    setClientSession(freshPhone());

    const response = await postBooking({
      startTime: at(futureDate(30), '10:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:none',
    });
    const body = await response.json();

    // parse('deposit-v1:none') is 0 and 2500 > 0, so the magnitude rule blocks.
    // A `disclosed === 0` special case here would charge CA$25 to a client who
    // was disclosed nothing.
    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DEPOSIT_CHANGED');
    expect(body.error.details.deposit.amountCents).toBe(2500);
    expect(await appointmentRows()).toHaveLength(0);
    expect(await depositRows()).toHaveLength(0);
  });
});

/**
 * §14 test 20 — PROVIDER-CALL PLACEMENT. Three legs, and all three are required.
 *
 * The readiness proof is hoisted ABOVE `runSerializedBookingTransaction`, not
 * merely "before the transaction". That runner is a retry loop nested inside a
 * 2-iteration identity loop, so a call placed within it re-issues per attempt —
 * and a test written WITHOUT the ordering leg would then FLAKE instead of
 * failing, which is the worst possible shape for a money-path test.
 */
describe('20 — provider-call placement', () => {
  /**
   * (a) NEGATIVE. Nothing may touch Stripe — or check out a SECOND pooled DB
   * connection — while `db.transaction` is open. The advisory lock
   * pg_advisory_xact_lock(salonId, technicianId) is held for the whole
   * transaction, so a second pool checkout there deadlocks under load and reads
   * outside the transaction snapshot.
   */
  it('(a) issues no provider call and no second pool checkout inside the transaction', async () => {
    seedPolicy(ACTIVE_POLICY);
    seedChargeReady(true);
    setClientSession(freshPhone());

    let insideTransaction = false;
    const violations: string[] = [];

    // Wrap the REAL transaction so the body still runs against PGlite; the flag
    // just records the window during which nothing may reach out.
    const originalTransaction = db.transaction.bind(db);
    const transactionSpy = vi
      .spyOn(db, 'transaction')
      .mockImplementation((async (...args: Parameters<typeof originalTransaction>) => {
        insideTransaction = true;
        try {
          return await originalTransaction(...args);
        } finally {
          insideTransaction = false;
        }
      }) as typeof db.transaction);

    deposits.refreshAccountReadiness.mockImplementation(async () => {
      if (insideTransaction) {
        violations.push('refreshAccountReadiness called inside db.transaction');
      }
      return {
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
      };
    });
    deposits.createDepositCheckoutSession.mockImplementation(async () => {
      if (insideTransaction) {
        violations.push('Stripe Checkout create called inside db.transaction');
      }
      return {
        ok: true,
        session: {
          id: 'cs_place',
          url: 'https://checkout.stripe.com/c/pay/cs_place',
          expires_at: 0,
          payment_intent: null,
        },
      };
    });
    // A second pooled checkout is exactly what calling getDepositPolicyForSalon
    // inside the transaction would do — it holds no `tx` handle.
    deposits.getDepositPolicyForSalon.mockImplementation(async () => {
      if (insideTransaction) {
        violations.push('getDepositPolicyForSalon called inside db.transaction');
      }
      return deposits.scopeRead;
    });

    const response = await postBooking({
      startTime: at(futureDate(40), '10:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
    });

    transactionSpy.mockRestore();

    expect(response.status).toBe(201);
    expect(violations).toEqual([]);
  });

  /**
   * (b) POSITIVE — call COUNT *and* invocation ORDER. The count alone is what
   * flakes when the call migrates into the retry loop.
   */
  it('(b) calls readiness exactly once, BEFORE the first db.transaction', async () => {
    seedPolicy(ACTIVE_POLICY);
    seedChargeReady(true);
    setClientSession(freshPhone());

    const transactionSpy = vi.spyOn(db, 'transaction');

    const response = await postBooking({
      startTime: at(futureDate(41), '10:00').toISOString(),
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
    });

    expect(response.status).toBe(201);
    expect(deposits.refreshAccountReadiness).toHaveBeenCalledTimes(1);
    expect(transactionSpy).toHaveBeenCalled();

    const readinessOrder = deposits.refreshAccountReadiness.mock.invocationCallOrder[0]!;
    const firstTransactionOrder = transactionSpy.mock.invocationCallOrder[0]!;

    expect(readinessOrder).toBeLessThan(firstTransactionOrder);

    transactionSpy.mockRestore();
  });

  /**
   * (c) SCOPE. The ~100% traffic path must never acquire a Stripe round trip.
   * Asserted on the readiness SPY, not on a retrieve count: D2 resolves
   * not_connected / revoked / mode_mismatch LOCALLY with no provider call, so a
   * retrieve count cannot distinguish SKIP from ENTER at 'account_not_connected'.
   */
  describe('(c) every outcome that does not reach the readiness proof', () => {
    it.each([
      ['collection_not_live'],
      ['not_entitled'],
      ['not_configured'],
      ['disabled'],
      ['currency_unsupported'],
    ])('configuration-side %s issues zero readiness calls', async (reason) => {
      seedPolicy({ active: false, reason, amountCents: 2500 });
      setClientSession(freshPhone());

      const response = await postBooking({
        startTime: at(futureDate(42), '10:00').toISOString(),
        expectedDepositFingerprint: 'deposit-v1:cad:2500',
      });

      expect(response.status).toBe(201);
      expect(deposits.refreshAccountReadiness).not.toHaveBeenCalled();
    });

    it.each([
      ['account_not_charge_ready'],
      ['account_not_connected'],
      ['readiness_never_synced'],
    ])('account-side %s with the none sentinel issues zero readiness calls', async (reason) => {
      seedPolicy({ active: false, reason, amountCents: 2500 });
      setClientSession(freshPhone());

      const response = await postBooking({
        startTime: at(futureDate(43), '10:00').toISOString(),
        expectedDepositFingerprint: 'deposit-v1:none',
      });

      expect(response.status).toBe(201);
      expect(deposits.refreshAccountReadiness).not.toHaveBeenCalled();
    });

    it('an undetermined pre-read refuses BEFORE the readiness call', async () => {
      seedPolicy({ active: false, reason: 'undetermined', amountCents: 2500 });
      setClientSession(freshPhone());

      const response = await postBooking({
        startTime: at(futureDate(44), '10:00').toISOString(),
        expectedDepositFingerprint: 'deposit-v1:cad:2500',
      });

      expect(response.status).toBe(503);
      expect(deposits.refreshAccountReadiness).not.toHaveBeenCalled();
    });

    // The remaining member of this leg set — `isNewPublicBooking === false` on a
    // request that actually COMMITS — is covered by test 5(a) below, against a
    // real reschedule. Asserting it here with an unauthenticated request would
    // pass vacuously: that request 400s before the deposit branch is reached,
    // so it proves nothing about the scope predicate.
  });
});
