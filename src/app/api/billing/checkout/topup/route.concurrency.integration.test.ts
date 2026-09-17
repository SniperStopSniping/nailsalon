/**
 * Top-up checkout serialization under genuine PostgreSQL concurrency.
 *
 * PGlite cannot interleave route transactions over independent connections,
 * so this opt-in suite uses a disposable local/CI PostgreSQL server. It
 * refuses every other target before migrations or truncation run.
 *
 *   docker run -d --name luster-qa-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=qa \
 *     -e POSTGRES_DB=luster_qa -p 55432:5432 postgres:16
 *   CONCURRENCY_TEST_DATABASE_URL=postgres://qa@127.0.0.1:55432/luster_qa \
 *     SMS_CREDIT_LEDGER_DISPOSABLE_DATABASE_CONFIRMED=true \
 *     npx vitest run --no-file-parallelism src/app/api/billing/checkout/topup/route.concurrency.integration.test.ts
 */
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  BILLING_PLAN_ENV: 'test' as const,
  BILLING_TOPUPS_ENABLED: 'true' as string | undefined,
  NEXT_PUBLIC_APP_URL: 'https://app.test',
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// Y1/OP-1: the top-up checkout resolves through `requireAdminOwner`; this
// suite's concern is concurrency, so both guards simply admit the owner.
vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, admin: { clerkUserId: 'topup-concurrency-admin' } })),
  requireAdminOwner: vi.fn(async () => ({ ok: true, admin: { clerkUserId: 'topup-concurrency-admin' } })),
}));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const stripeMock = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
  // P3b: the route re-verifies the resolved price live before writing
  // anything — always resolved to the single price id this suite uses.
  prices: { retrieve: vi.fn() },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));

const fulfillmentGate = vi.hoisted(() => ({
  entered: null as (() => void) | null,
  wait: null as Promise<void> | null,
}));
vi.mock('@/libs/billing/creditGrants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/creditGrants')>();
  return {
    ...actual,
    fulfillTopupPurchase: async (...args: Parameters<typeof actual.fulfillTopupPurchase>) => {
      if (fulfillmentGate.wait !== null) {
        fulfillmentGate.entered?.();
        await fulfillmentGate.wait;
      }
      return actual.fulfillTopupPurchase(...args);
    },
  };
});

vi.mock('@/libs/billing/stripePriceMap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/stripePriceMap')>();
  return { ...actual, resolveStripePriceIdForTopup: () => 'price_topup_concurrency' };
});

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let parsedUrl: URL | null = null;
try {
  parsedUrl = RAW_URL ? new URL(RAW_URL) : null;
} catch {
  parsedUrl = null;
}
const databaseName = parsedUrl ? decodeURIComponent(parsedUrl.pathname).replace(/^\//, '') : '';
const disposableConfirmed
  = process.env.SMS_CREDIT_LEDGER_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  || (databaseName === 'luster_qa' && parsedUrl?.username === 'qa');
const isLocalThrowaway = parsedUrl !== null
  && ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)
  && databaseName.length > 0
  && disposableConfirmed
  && !RAW_URL.includes('neon.tech');
const suite = isLocalThrowaway ? describe : describe.skip;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

/**
 * Zero-skip proof: this suite must never silently degrade to a skip in CI.
 * The count is asserted in afterAll and grepped for by the workflow step.
 */
const EXPECTED_EXECUTED_TESTS = 3;
let executedTests = 0;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function postCheckout(salonId: string) {
  const { POST } = await import('./route');
  const { NextRequest } = await import('next/server');
  return POST(new NextRequest('http://localhost/api/billing/checkout/topup', {
    method: 'POST',
    body: JSON.stringify({ salonId, topupOfferKey: 'topup_100_paid_2026_08' }),
    headers: { 'content-type': 'application/json' },
  }));
}

suite('top-up checkout — real-lock concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({
      connectionString: RAW_URL,
      max: 12,
      application_name: 'gate-c3-topup-checkout-concurrency-test',
    });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    holder.db = db;
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE salon CASCADE');
    await db.insert(schema.salonSchema).values([
      { id: 'topup-s1', name: 'Top-up S1', slug: 'topup-s1', plan: 'single_salon' },
      { id: 'topup-s2', name: 'Top-up S2', slug: 'topup-s2', plan: 'single_salon' },
    ]);
    envHolder.BILLING_TOPUPS_ENABLED = 'true';
    fulfillmentGate.entered = null;
    fulfillmentGate.wait = null;
    stripeMock.checkout.sessions.create.mockReset();
    stripeMock.checkout.sessions.retrieve.mockReset();
    stripeMock.prices.retrieve.mockReset();
    // P3b: every suite fixture buys 'topup_100_paid_2026_08' (599¢) — a
    // live, ACTIVE, one-time, cad price matching it every time.
    stripeMock.prices.retrieve.mockImplementation(async () => ({
      active: true,
      type: 'one_time',
      currency: 'cad',
      unit_amount: 599,
    }));
  });

  afterAll(async () => {
    await pool?.end();

    expect(executedTests).toBe(EXPECTED_EXECUTED_TESTS);

    process.stdout.write(
      `BILLING_TOPUP_CHECKOUT_POSTGRES_TESTS_EXECUTED=${executedTests} BILLING_TOPUP_CHECKOUT_POSTGRES_TESTS_SKIPPED=0\n`,
    );
  });

  it('serializes simultaneous initial reservations behind one salon row lock', async () => {
    executedTests += 1;
    let createNumber = 0;
    stripeMock.checkout.sessions.create.mockImplementation(async () => {
      createNumber += 1;
      return {
        id: `cs_topup_initial_race_${createNumber}`,
        url: `https://checkout.stripe.test/topup/${createNumber}`,
      };
    });
    const fixture = await pool.connect();
    await fixture.query('SET application_name = \'topup-initial-reservation-fixture\'');
    await fixture.query('BEGIN');
    await fixture.query('SELECT id FROM salon WHERE id = \'topup-s1\' FOR NO KEY UPDATE');
    try {
      const racers = Array.from({ length: 8 }, () => postCheckout('topup-s1'));
      await vi.waitFor(async () => {
        const waiting = await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM pg_stat_activity
          WHERE application_name = 'gate-c3-topup-checkout-concurrency-test'
            AND wait_event_type = 'Lock'
            AND query ILIKE '%salon%'
        `);

        expect(Number(waiting.rows[0].count)).toBeGreaterThan(0);
      });

      await fixture.query('COMMIT');
      const responses = await Promise.all(racers);

      expect(responses.filter(response => response.status === 200)).toHaveLength(1);
      expect(responses.filter(response => response.status === 409)).toHaveLength(7);
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);

      const attempts = await pool.query(`
        SELECT COUNT(*)::int AS count FROM billing_checkout_attempt
        WHERE salon_id = 'topup-s1' AND purpose = 'sms_topup'
      `);
      const purchases = await pool.query(`
        SELECT COUNT(*)::int AS count FROM sms_topup_purchase WHERE salon_id = 'topup-s1'
      `);

      expect(Number(attempts.rows[0].count)).toBe(1);
      expect(Number(purchases.rows[0].count)).toBe(1);
    } finally {
      try {
        await fixture.query('ROLLBACK');
      } catch {
        // The committed fixture transaction has no rollback work left.
      }
      fixture.release();
    }
  });

  it('serializes one salon while another salon can independently reserve a checkout', async () => {
    executedTests += 1;
    const firstCreateEntered = deferred<void>();
    const releaseCreates = deferred<void>();
    let createNumber = 0;
    stripeMock.checkout.sessions.create.mockImplementation(async () => {
      createNumber += 1;
      const sessionNumber = createNumber;
      if (sessionNumber === 1) {
        firstCreateEntered.resolve();
      }
      await releaseCreates.promise;
      return {
        id: `cs_topup_concurrency_${sessionNumber}`,
        url: `https://checkout.stripe.test/topup/${sessionNumber}`,
      };
    });

    const first = postCheckout('topup-s1');
    await firstCreateEntered.promise;

    // The first route has committed its reservation but is still blocked in
    // Stripe. Every same-salon racer must observe that durable reservation.
    const sameSalonRacers = await Promise.all(Array.from({ length: 6 }, () => postCheckout('topup-s1')));

    expect(sameSalonRacers.map(response => response.status)).toEqual([409, 409, 409, 409, 409, 409]);

    await vi.waitFor(() => expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1));

    // A different salon has its own lock and reaches Stripe even while S1 is
    // blocked, proving the serialization is tenant-scoped rather than global.
    const otherSalon = postCheckout('topup-s2');
    await vi.waitFor(() => expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(2));

    releaseCreates.resolve();
    const [firstResponse, otherSalonResponse] = await Promise.all([first, otherSalon]);

    expect(firstResponse.status).toBe(200);
    expect(otherSalonResponse.status).toBe(200);

    const attempts = await pool.query(`
      SELECT salon_id, COUNT(*)::int AS count
      FROM billing_checkout_attempt
      WHERE purpose = 'sms_topup'
      GROUP BY salon_id
      ORDER BY salon_id
    `);

    expect(attempts.rows).toEqual([
      { salon_id: 'topup-s1', count: 1 },
      { salon_id: 'topup-s2', count: 1 },
    ]);

    const purchases = await pool.query(`
      SELECT salon_id, COUNT(*)::int AS count
      FROM sms_topup_purchase
      GROUP BY salon_id
      ORDER BY salon_id
    `);

    expect(purchases.rows).toEqual([
      { salon_id: 'topup-s1', count: 1 },
      { salon_id: 'topup-s2', count: 1 },
    ]);
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });

  it('allows paid fulfillment past an expiry holding the salon lock for its ledger foreign key', async () => {
    executedTests += 1;
    const sessionId = 'cs_topup_expiry_completion_race';
    await db.insert(schema.billingCheckoutAttemptSchema).values({
      id: 'bca_topup_expiry_completion_race',
      salonId: 'topup-s1',
      purpose: 'sms_topup',
      topupOfferKey: 'topup_100_paid_2026_08',
      status: 'checkout_created',
      stripeIdempotencyKey: 'billing-attempt:bca_topup_expiry_completion_race',
      stripeCheckoutSessionId: sessionId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(schema.smsTopupPurchaseSchema).values({
      id: 'stp_topup_expiry_completion_race',
      salonId: 'topup-s1',
      topupOfferKey: 'topup_100_paid_2026_08',
      credits: 100,
      amountCents: 599,
      status: 'checkout_created',
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: 'pi_topup_expiry_completion_race',
    });
    await db.insert(schema.smsCreditAccountSchema).values({ salonId: 'topup-s1' });

    const fulfillmentEntered = deferred<void>();
    const releaseFulfillment = deferred<void>();
    fulfillmentGate.entered = () => fulfillmentEntered.resolve();
    fulfillmentGate.wait = releaseFulfillment.promise;
    const { applyTopupSessionCompleted, applyTopupSessionExpired } = await import('@/libs/billing/topupFulfillment');
    const completion = applyTopupSessionCompleted({
      sessionId,
      paymentStatus: 'paid',
      paymentIntentId: 'pi_topup_expiry_completion_race',
    });
    await fulfillmentEntered.promise;

    // Completion owns the purchase. Expiry now owns the salon lock and waits
    // for that purchase. Releasing fulfillment requires its ledger insert to
    // take KEY SHARE on salon; FOR UPDATE here would form a deadlock cycle.
    const expiry = applyTopupSessionExpired(sessionId);
    try {
      // Reaching the purchase-row lock wait can take well over vi.waitFor's
      // 1 s default on a loaded CI runner; the assertion itself is unchanged.
      await vi.waitFor(async () => {
        const waiting = await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM pg_stat_activity
          WHERE application_name = 'gate-c3-topup-checkout-concurrency-test'
            AND wait_event_type = 'Lock'
            AND query ILIKE '%sms_topup_purchase%'
        `);

        expect(Number(waiting.rows[0].count)).toBeGreaterThan(0);
      }, { timeout: 15_000, interval: 50 });
    } finally {
      // Always let the gated fulfillment finish, otherwise a failed wait
      // leaves it blocked and afterAll's pool.end() hangs past the hook budget.
      releaseFulfillment.resolve();
    }
    const [expiryResult, completionResult] = await Promise.race([
      Promise.all([expiry, completion]),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('TOPUP_EXPIRY_COMPLETION_DEADLOCK')), 3_000)),
    ]);

    expect(completionResult.fulfilled).toBe(true);
    expect(expiryResult.expired).toBe(false);

    const [attempt] = await db.select().from(schema.billingCheckoutAttemptSchema)
      .where(eq(schema.billingCheckoutAttemptSchema.id, 'bca_topup_expiry_completion_race'));
    const purchasedLedger = await pool.query(`
      SELECT COUNT(*)::int AS count FROM sms_credit_ledger
      WHERE salon_id = 'topup-s1' AND bucket = 'purchased'
    `);

    expect(attempt?.status).toBe('completed');
    expect(Number(purchasedLedger.rows[0].count)).toBe(1);
  });
});
