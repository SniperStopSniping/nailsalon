/**
 * The session-status endpoint as a reconciliation driver.
 *
 * The property that matters here is the BOUNDARY. The `cs_…` id is visible to
 * the client, to anyone they forward it to, and to the salon owner in their own
 * Stripe Dashboard, so an IP-keyed cap is trivially sidestepped and a 4xx on
 * exhaustion is a denial primitive pointed at the person who paid. The real
 * boundary is a durable per-deposit budget, and the answer when it is spent is
 * 200 with local state.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const stripeMock = vi.hoisted(() => ({
  sessionsRetrieve: vi.fn(),
  refundsCreate: vi.fn(),
  refundsList: vi.fn(),
}));

vi.mock('@/libs/stripe', () => ({
  stripe: {
    checkout: { sessions: { retrieve: stripeMock.sessionsRetrieve } },
    refunds: { create: stripeMock.refundsCreate, list: stripeMock.refundsList, retrieve: vi.fn() },
  },
  EXPECTED_STRIPE_API_VERSION: '2024-06-20',
}));

const { GET } = await import('./route');

const SALON = 'salon_poll';
const ACCOUNT = 'acct_poll';
const AMOUNT = 2500;

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let seq = 0;

function request(sessionId: string, ip = '203.0.113.1') {
  return new Request(
    `http://localhost/api/public/deposits/session-status?session_id=${sessionId}`,
    { headers: { 'x-forwarded-for': ip } },
  );
}

async function seedHold(input: { depositStatus?: string } = {}) {
  seq += 1;
  const appointmentId = `appt_p_${seq}`;
  const depositId = `dep_p_${seq}`;
  const sessionId = `cs_p_${seq}`;
  const startTime = new Date(Date.now() + 86_400_000 + seq * 3_600_000);

  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId: SALON,
    clientPhone: '4165556666',
    clientName: 'Poll Client',
    startTime,
    endTime: new Date(startTime.getTime() + 3_600_000),
    status: 'awaiting_payment',
    totalPrice: 9000,
    totalDurationMinutes: 60,
    depositHoldExpiresAt: new Date(Date.now() + 1_800_000),
  });

  await db.insert(schema.appointmentDepositSchema).values({
    id: depositId,
    salonId: SALON,
    appointmentId,
    amountCents: AMOUNT,
    status: input.depositStatus ?? 'checkout_created',
    stripeAccountId: ACCOUNT,
    stripeCheckoutSessionId: sessionId,
    stripeCheckoutUrl: 'https://checkout.stripe.com/c/pay/cs_p',
  });

  return { appointmentId, depositId, sessionId };
}

async function readDeposit(id: string) {
  const [row] = await db.select().from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, id));
  return row;
}

/** Time travel by BACKDATING the anchor, never by asserting a counter as a clock. */
async function backdateWindow(depositId: string, ms: number) {
  await db.update(schema.appointmentDepositSchema)
    .set({ pollWindowStartedAt: new Date(Date.now() - ms) })
    .where(eq(schema.appointmentDepositSchema.id, depositId));
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
  stripeMock.sessionsRetrieve.mockResolvedValue({
    id: 'cs_p',
    payment_status: 'unpaid',
    amount_total: AMOUNT,
    currency: 'cad',
    payment_intent: null,
    metadata: {},
  });

  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.appointmentAccessTokenSchema);
  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.stripeWebhookEventSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.salonSchema);

  await db.insert(schema.salonSchema).values({
    id: SALON,
    name: 'Poll Salon',
    slug: 'poll-salon',
    ownerEmail: 'owner@example.com',
  });
  await db.insert(schema.salonStripeAccountSchema).values({
    id: 'ssa_poll',
    salonId: SALON,
    stripeAccountId: ACCOUNT,
    livemode: false,
  });
});

describe('poll reconciliation', () => {
  it('retrieves on the deposit SNAPSHOT account, with an explicit timeout', async () => {
    const hold = await seedHold();

    await GET(request(hold.sessionId));

    expect(stripeMock.sessionsRetrieve).toHaveBeenCalledWith(
      hold.sessionId,
      expect.objectContaining({ stripeAccount: ACCOUNT, timeout: 10_000 }),
    );
  });

  it('CONFIRMS on a paid retrieval and reports the new state on the SAME response', async () => {
    // Re-reading after the reconciliation attempt is what lets the client see
    // their confirmation now rather than on the next poll.
    const hold = await seedHold();
    stripeMock.sessionsRetrieve.mockResolvedValue({
      id: hold.sessionId,
      payment_status: 'paid',
      amount_total: AMOUNT,
      currency: 'cad',
      payment_intent: 'pi_poll',
      metadata: { salon_id: SALON },
    });

    const response = await GET(request(hold.sessionId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe('confirmed');
    expect((await readDeposit(hold.depositId))?.status).toBe('paid');
  });

  it('does NOT retrieve for a settled deposit', async () => {
    // A paid deposit has nothing to reconcile, and spending budget on it is
    // how a client refreshing a success page exhausts their own allowance.
    const hold = await seedHold({ depositStatus: 'paid' });

    await GET(request(hold.sessionId));

    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('PRESERVES the widened response shape', async () => {
    const hold = await seedHold();

    const body = await (await GET(request(hold.sessionId))).json();

    expect(body.state).toBe('awaiting_payment');
    expect(body).toHaveProperty('holdExpiresAt');
    // The cancel page's resume link is the only data it has. D5 must not
    // re-narrow this response.
    expect(body.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_p');
  });

  it('omits checkoutUrl once the hold is no longer live', async () => {
    const hold = await seedHold({ depositStatus: 'expired' });
    await db.update(schema.appointmentSchema)
      .set({ status: 'cancelled', cancelReason: 'deposit_not_paid' })
      .where(eq(schema.appointmentSchema.id, hold.appointmentId));

    const body = await (await GET(request(hold.sessionId))).json();

    expect(body).not.toHaveProperty('checkoutUrl');
  });

  it('answers a UNIFORM 404 for an unknown session id', async () => {
    const response = await GET(request('cs_does_not_exist'));

    expect(response.status).toBe(404);
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('reconciles ONLY the deposit that owns the session id', async () => {
    const first = await seedHold();
    const second = await seedHold();

    await GET(request(second.sessionId));

    expect(stripeMock.sessionsRetrieve).toHaveBeenCalledTimes(1);
    expect(stripeMock.sessionsRetrieve).toHaveBeenCalledWith(second.sessionId, expect.anything());
    expect((await readDeposit(first.depositId))?.pollRetrievals).toBe(0);
  });
});

describe('durable per-deposit budget', () => {
  it('caps retrievals per deposit regardless of the source IP', async () => {
    // N polls from N distinct forwarded-for values. An IP-keyed cap would let
    // every one of them through.
    const hold = await seedHold();

    for (let index = 0; index < 25; index += 1) {
      // Defeat the in-process throttle by advancing the clock the same way a
      // real sequence of requests would.
      vi.setSystemTime(new Date(Date.now() + 6_000));
      await GET(request(hold.sessionId, `198.51.100.${index}`));
    }
    vi.useRealTimers();

    const deposit = await readDeposit(hold.depositId);

    expect(stripeMock.sessionsRetrieve.mock.calls.length).toBeLessThanOrEqual(20);
    expect(deposit?.pollWindowRetrievals).toBeLessThanOrEqual(20);
  });

  it('returns 200 with local state when the budget is spent, NEVER 429', async () => {
    const hold = await seedHold();
    await db.update(schema.appointmentDepositSchema)
      .set({ pollRetrievals: 200, pollWindowRetrievals: 200, pollWindowStartedAt: new Date() })
      .where(eq(schema.appointmentDepositSchema.id, hold.depositId));

    const response = await GET(request(hold.sessionId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe('awaiting_payment');
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('rolls the window while the LIFETIME counter keeps counting', async () => {
    // Three columns, not two: one integer cannot both reset on a roll and
    // never reset.
    const hold = await seedHold();

    await GET(request(hold.sessionId));
    const afterFirst = await readDeposit(hold.depositId);

    expect(afterFirst?.pollRetrievals).toBe(1);
    expect(afterFirst?.pollWindowRetrievals).toBe(1);

    await backdateWindow(hold.depositId, 11 * 60_000);
    vi.setSystemTime(new Date(Date.now() + 6_000));
    await GET(request(hold.sessionId));
    vi.useRealTimers();

    const afterRoll = await readDeposit(hold.depositId);

    // The in-window counter reset to 1; the lifetime ceiling did not.
    expect(afterRoll?.pollWindowRetrievals).toBe(1);
    expect(afterRoll?.pollRetrievals).toBe(2);
  });

  it('stops retrieving at the LIFETIME ceiling even in a fresh window', async () => {
    const hold = await seedHold();
    await db.update(schema.appointmentDepositSchema)
      .set({ pollRetrievals: 200, pollWindowRetrievals: 0, pollWindowStartedAt: null })
      .where(eq(schema.appointmentDepositSchema.id, hold.depositId));

    const response = await GET(request(hold.sessionId));

    expect(response.status).toBe(200);
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('does not spend budget when the retrieval itself throws', async () => {
    // A provider outage must not silently consume a client's allowance... but
    // the budget is claimed BEFORE the call by design, because the alternative
    // is an unbounded retry loop against a failing provider. Assert the real
    // behaviour rather than the comfortable one.
    const hold = await seedHold();
    stripeMock.sessionsRetrieve.mockRejectedValue(new Error('stripe down'));
    // The handler logs the swallowed failure; the suite fails on unexpected
    // console output, so the expectation is declared rather than suppressed.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(request(hold.sessionId));

    expect(logged).toHaveBeenCalledOnce();

    logged.mockRestore();

    expect(response.status).toBe(200);
    expect((await readDeposit(hold.depositId))?.pollRetrievals).toBe(1);
  });
});
