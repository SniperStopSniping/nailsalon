/**
 * The reconcile sweep.
 *
 * Stripe abandons a delivery after roughly three days and never redelivers an
 * event the endpoint 2xx-acked, so the webhook is a fast path and not a
 * guarantee. The legs here are about the two STATE-driven drivers that still
 * work when no event ever arrived, and about the sweep not re-driving the same
 * unresolvable row at cron frequency forever.
 *
 * Time travel is by BACKDATING rows, never by asserting an attempt counter as
 * a proxy for a clock.
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

const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => sentry);

const stripeMock = vi.hoisted(() => ({
  sessionsRetrieve: vi.fn(),
  refundsCreate: vi.fn(),
  refundsList: vi.fn(),
  refundsRetrieve: vi.fn(),
}));

vi.mock('@/libs/stripe', () => ({
  stripe: {
    checkout: { sessions: { retrieve: stripeMock.sessionsRetrieve } },
    refunds: {
      create: stripeMock.refundsCreate,
      list: stripeMock.refundsList,
      retrieve: stripeMock.refundsRetrieve,
    },
  },
  EXPECTED_STRIPE_API_VERSION: '2024-06-20',
}));

/* eslint-disable import/first */
import { RECONCILE_BATCH, runDepositReconcile } from '@/libs/depositReconcile';
/* eslint-enable import/first */

const SALON = 'salon_sweep';
const ACCOUNT = 'acct_sweep';
const AMOUNT = 2500;

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let seq = 0;

function paidSession(sessionId: string) {
  return {
    id: sessionId,
    status: 'complete',
    payment_status: 'paid',
    amount_total: AMOUNT,
    currency: 'cad',
    payment_intent: `pi_${sessionId}`,
    metadata: { salon_id: SALON },
  };
}

async function seedExpiredHold(input: {
  depositStatus?: string;
  appointmentStatus?: string;
  expiredMinutesAgo?: number;
  lateCheckDone?: boolean;
} = {}) {
  seq += 1;
  const appointmentId = `appt_s_${seq}`;
  const depositId = `dep_s_${seq}`;
  const sessionId = `cs_s_${seq}`;
  const startTime = new Date(Date.now() + 86_400_000 + seq * 60_000);

  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId: SALON,
    clientPhone: '4165554444',
    clientName: 'Sweep Client',
    startTime,
    endTime: new Date(startTime.getTime() + 3_600_000),
    status: input.appointmentStatus ?? 'awaiting_payment',
    totalPrice: 9000,
    totalDurationMinutes: 60,
    // Backdated past the scan's grace window.
    depositHoldExpiresAt: new Date(Date.now() - (input.expiredMinutesAgo ?? 30) * 60_000),
  });

  await db.insert(schema.appointmentDepositSchema).values({
    id: depositId,
    salonId: SALON,
    appointmentId,
    amountCents: AMOUNT,
    status: input.depositStatus ?? 'checkout_created',
    stripeAccountId: ACCOUNT,
    stripeCheckoutSessionId: sessionId,
    ...(input.lateCheckDone ? { lateCheckDoneAt: new Date() } : {}),
  });

  return { appointmentId, depositId, sessionId };
}

async function seedEventRow(input: {
  depositId: string;
  sessionId: string;
  status: string;
  outcome?: string;
}) {
  seq += 1;
  await db.insert(schema.stripeWebhookEventSchema).values({
    id: `swe_s_${seq}`,
    eventId: `evt_s_${seq}`,
    type: 'checkout.session.completed',
    account: ACCOUNT,
    livemode: false,
    status: input.status,
    outcome: input.outcome ?? null,
    sessionId: input.sessionId,
    metadataDepositId: input.depositId,
  });
}

async function readDeposit(id: string) {
  const [row] = await db.select().from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, id));
  return row;
}

async function readAppointment(id: string) {
  const [row] = await db.select().from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, id));
  return row;
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
  stripeMock.refundsList.mockResolvedValue({ data: [] });
  stripeMock.refundsCreate.mockResolvedValue({
    id: 'ref_s',
    status: 'succeeded',
    amount: AMOUNT,
    currency: 'cad',
  });
  stripeMock.sessionsRetrieve.mockImplementation(async (id: string) => paidSession(id));

  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.appointmentAccessTokenSchema);
  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.stripeWebhookEventSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonClientSchema);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.salonSchema);

  await db.insert(schema.salonSchema).values({
    id: SALON,
    name: 'Sweep Salon',
    slug: 'sweep-salon',
    ownerEmail: 'owner@example.com',
  });
  await db.insert(schema.salonStripeAccountSchema).values({
    id: 'ssa_sweep',
    salonId: SALON,
    stripeAccountId: ACCOUNT,
    livemode: false,
  });
});

// ===========================================================================
// STEP 0
// ===========================================================================

describe('step 0 — the deposit-side driver', () => {
  it('confirms a paid deposit whose event never arrived', async () => {
    // The convergence path that does not depend on redelivery. Without it, an
    // event that was terminal-ignored or simply never delivered strands a real
    // payment forever.
    const hold = await seedExpiredHold();

    await runDepositReconcile();

    expect(stripeMock.sessionsRetrieve).toHaveBeenCalledWith(
      hold.sessionId,
      // The SNAPSHOT account, with an explicit timeout.
      expect.objectContaining({ stripeAccount: ACCOUNT, timeout: 10_000 }),
    );
    expect((await readDeposit(hold.depositId))?.status).toBe('paid');
    expect((await readAppointment(hold.appointmentId))?.status).toBe('pending');
  });

  it('rescues a deposit whose event was terminal-IGNORED', async () => {
    // `processed` and `ignored_*` deliberately do NOT exclude — rescuing them
    // is this scan's entire purpose.
    const hold = await seedExpiredHold();
    await seedEventRow({
      depositId: hold.depositId,
      sessionId: hold.sessionId,
      status: 'ignored_foreign_session',
      outcome: 'ignored_foreign_session',
    });

    await runDepositReconcile();

    expect((await readDeposit(hold.depositId))?.status).toBe('paid');
  });

  it('SKIPS a deposit a live event row already owns', async () => {
    // A live row means the event machinery owns this deposit on its own
    // schedule. Retrieving it here would duplicate provider work and race it.
    const hold = await seedExpiredHold();
    await seedEventRow({
      depositId: hold.depositId,
      sessionId: hold.sessionId,
      status: 'failed_retryable',
      outcome: 'deferred_no_deposit',
    });

    await runDepositReconcile();

    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
  });

  it('SKIPS a deposit parked on a MANUAL terminal, and keeps skipping it', async () => {
    // The machinery has concluded; re-entry is an operator decision. Without
    // this the sweep re-retrieves and re-alerts every five minutes forever.
    const hold = await seedExpiredHold();
    await seedEventRow({
      depositId: hold.depositId,
      sessionId: hold.sessionId,
      status: 'held_mismatch',
      outcome: 'held_mismatch',
    });

    await runDepositReconcile();
    await runDepositReconcile();
    await runDepositReconcile();

    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('PARKS an unpaid COMPLETE session instead of re-retrieving it forever', async () => {
    // "Leave it for the reaper" does not work here: the reaper never touches a
    // complete session, so this deposit would be re-retrieved every five
    // minutes for the rest of its life.
    const hold = await seedExpiredHold();
    stripeMock.sessionsRetrieve.mockResolvedValue({
      id: hold.sessionId,
      status: 'complete',
      payment_status: 'unpaid',
      amount_total: AMOUNT,
      currency: 'cad',
      payment_intent: null,
      metadata: {},
    });

    await runDepositReconcile();

    const [work] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.metadataDepositId, hold.depositId));

    expect(work?.type).toBe('luster.poll_evidence');
    expect(work?.outcome).toBe('awaiting_async_payment');
    // The work row carries BOTH join keys, or it fails to suppress the very
    // rescan it exists to suppress.
    expect(work?.sessionId).toBe(hold.sessionId);
    expect(work?.metadataDepositId).toBe(hold.depositId);

    stripeMock.sessionsRetrieve.mockClear();
    await runDepositReconcile();

    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('leaves an OPEN session alone for the reaper', async () => {
    const hold = await seedExpiredHold();
    stripeMock.sessionsRetrieve.mockResolvedValue({
      id: hold.sessionId,
      status: 'open',
      payment_status: 'unpaid',
      amount_total: AMOUNT,
      currency: 'cad',
      payment_intent: null,
      metadata: {},
    });

    await runDepositReconcile();

    const work = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.metadataDepositId, hold.depositId));

    expect(work).toHaveLength(0);
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
  });

  it('does NOT park a TRANSIENT retrieval failure', async () => {
    // A network blip must not consume the escalation ladder that exists for
    // real, permanent problems.
    await seedExpiredHold();
    stripeMock.sessionsRetrieve.mockRejectedValue(
      Object.assign(new Error('rate limited'), { statusCode: 429 }),
    );

    await runDepositReconcile();

    expect(await db.select().from(schema.stripeWebhookEventSchema)).toHaveLength(0);
  });

  it('parks a DEAUTH-class retrieval failure on the long schedule', async () => {
    const hold = await seedExpiredHold();
    stripeMock.sessionsRetrieve.mockRejectedValue(
      Object.assign(new Error('no longer authorized'), {
        code: 'application_not_authorized',
        statusCode: 403,
      }),
    );

    await runDepositReconcile();

    const [work] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.metadataDepositId, hold.depositId));

    expect(work?.outcome).toBe('unbound_account');
    expect(work?.status).toBe('failed_retryable');
  });

  it('respects the batch limit, oldest expiry first', async () => {
    for (let index = 0; index < RECONCILE_BATCH + 5; index += 1) {
      await seedExpiredHold({ expiredMinutesAgo: 100 - index });
    }

    await runDepositReconcile();

    expect(stripeMock.sessionsRetrieve.mock.calls.length).toBeLessThanOrEqual(RECONCILE_BATCH);
  });
});

// ===========================================================================
// STEP 0b
// ===========================================================================

describe('step 0b — the one-shot late check', () => {
  it('recovers a reaper-expired deposit that turns out to be paid', async () => {
    const hold = await seedExpiredHold({
      depositStatus: 'expired',
      appointmentStatus: 'cancelled',
    });
    await db.update(schema.appointmentSchema)
      .set({ cancelReason: 'deposit_not_paid' })
      .where(eq(schema.appointmentSchema.id, hold.appointmentId));

    await runDepositReconcile();

    // Restored or refunded — both are "the money got an arrow". This deposit
    // has no canonical client, so the restore declines and the refund runs.
    const deposit = await readDeposit(hold.depositId);

    expect(['paid', 'refunded']).toContain(deposit?.status);
  });

  it('probes EXACTLY ONCE and never again', async () => {
    const hold = await seedExpiredHold({
      depositStatus: 'expired',
      appointmentStatus: 'cancelled',
    });
    stripeMock.sessionsRetrieve.mockResolvedValue({
      id: hold.sessionId,
      status: 'expired',
      payment_status: 'unpaid',
      amount_total: AMOUNT,
      currency: 'cad',
      payment_intent: null,
      metadata: {},
    });

    await runDepositReconcile();

    expect((await readDeposit(hold.depositId))?.lateCheckDoneAt).not.toBeNull();

    stripeMock.sessionsRetrieve.mockClear();
    await runDepositReconcile();

    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('still scans a row that is EIGHT DAYS old', async () => {
    // No recency horizon. `late_check_done_at` is the bound, on purpose: a
    // shared seven-day window would age a row out of this scan and out of the
    // manual runbook query at the same instant, so a sweep outage would
    // silently delete its own follow-up work.
    const hold = await seedExpiredHold({
      depositStatus: 'expired',
      appointmentStatus: 'cancelled',
    });
    await db.update(schema.appointmentDepositSchema)
      .set({ updatedAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(schema.appointmentDepositSchema.id, hold.depositId));

    await runDepositReconcile();

    expect(stripeMock.sessionsRetrieve).toHaveBeenCalled();
  });

  it('skips a deposit whose late check is already done', async () => {
    await seedExpiredHold({
      depositStatus: 'expired',
      appointmentStatus: 'cancelled',
      lateCheckDone: true,
    });

    await runDepositReconcile();

    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TRIPWIRE
// ===========================================================================

describe('stuck-deposit tripwire', () => {
  it('alerts EXACTLY ONCE across separate runs, via a durable marker', async () => {
    // Each cron invocation is a fresh process, so an in-memory set would alert
    // every five minutes forever.
    const hold = await seedExpiredHold({ expiredMinutesAgo: 180 });
    // Keep it in `checkout_created` by making the retrieval unpaid-and-open.
    stripeMock.sessionsRetrieve.mockResolvedValue({
      id: hold.sessionId,
      status: 'open',
      payment_status: 'unpaid',
      amount_total: AMOUNT,
      currency: 'cad',
      payment_intent: null,
      metadata: {},
    });

    await runDepositReconcile();
    await runDepositReconcile();

    const alerts = sentry.captureMessage.mock.calls
      .filter(call => call[0] === 'deposit_stuck_past_expiry');

    expect(alerts).toHaveLength(1);

    const [marker] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.type, 'luster.stuck_alert'));

    expect(marker?.eventId).toBe(`luster:stuck_alert:${hold.depositId}`);
  });
});

// ===========================================================================
// LIVENESS
// ===========================================================================

describe('liveness', () => {
  it('emits EXACTLY ONE check-in per run', async () => {
    await runDepositReconcile();

    const checkIns = sentry.captureMessage.mock.calls
      .filter(call => call[0] === 'deposit_reconcile_run');

    expect(checkIns).toHaveLength(1);
  });

  it('runs every pass even when one of them throws', async () => {
    // These are independent convergence mechanisms. Losing all of them because
    // one had a bad row is how a backlog becomes permanent.
    await seedExpiredHold();
    stripeMock.sessionsRetrieve.mockRejectedValue(new Error('boom'));

    const summary = await runDepositReconcile();

    expect(summary).toHaveProperty('eventsReclaimed');
    expect(sentry.captureMessage.mock.calls.filter(call => call[0] === 'deposit_reconcile_run'))
      .toHaveLength(1);
  });
});
