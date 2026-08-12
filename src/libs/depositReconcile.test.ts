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

vi.mock('@/core/redis/redisClient', () => ({
  isRedisAvailable: vi.fn(async () => false),
  redis: null,
}));

const stripeMock = vi.hoisted(() => ({
  accountsRetrieve: vi.fn(),
  sessionsRetrieve: vi.fn(),
  refundsCreate: vi.fn(),
  refundsList: vi.fn(),
  refundsRetrieve: vi.fn(),
}));

vi.mock('@/libs/stripe', () => ({
  stripe: {
    checkout: { sessions: { retrieve: stripeMock.sessionsRetrieve } },
    accounts: { retrieve: stripeMock.accountsRetrieve },
    refunds: {
      create: stripeMock.refundsCreate,
      list: stripeMock.refundsList,
      retrieve: stripeMock.refundsRetrieve,
    },
  },
  EXPECTED_STRIPE_API_VERSION: '2024-06-20',
}));

/* eslint-disable import/first */
import { reapExpiredDepositHolds } from '@/libs/depositHoldReaper';
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

function readyAccount() {
  return {
    id: ACCOUNT,
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    requirements: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
      current_deadline: null,
      disabled_reason: null,
    },
    metadata: { salonId: SALON },
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

async function seedDueWorkRow(input: {
  eventId: string;
  type: string;
  account?: string | null;
  salonId?: string | null;
  status?: string;
  outcome?: string | null;
  attempts?: number;
  receivedAt?: Date;
  sessionId?: string | null;
  depositId?: string | null;
  metadataSalonId?: string | null;
  metadataAppointmentId?: string | null;
  clientReferenceId?: string | null;
  projectionStatus?: string | null;
  livemode?: boolean;
  updatedAt?: Date;
  paymentIntentId?: string | null;
  paymentStatus?: string | null;
  amountTotal?: number | null;
  currency?: string | null;
}) {
  seq += 1;
  await db.insert(schema.stripeWebhookEventSchema).values({
    id: `swe_due_${seq}`,
    eventId: input.eventId,
    type: input.type,
    account: input.account === undefined ? ACCOUNT : input.account,
    livemode: input.livemode ?? false,
    salonId: input.salonId ?? null,
    status: input.status ?? 'failed_retryable',
    outcome: input.outcome ?? null,
    attempts: input.attempts ?? 1,
    availableAt: new Date(Date.now() - 60_000),
    receivedAt: input.receivedAt ?? new Date(),
    sessionId: input.sessionId ?? null,
    metadataDepositId: input.depositId ?? null,
    metadataSalonId: input.metadataSalonId ?? null,
    metadataAppointmentId: input.metadataAppointmentId ?? null,
    clientReferenceId: input.clientReferenceId ?? null,
    projectionStatus: input.projectionStatus ?? 'ok',
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    paymentIntentId: input.paymentIntentId ?? null,
    paymentStatus: input.paymentStatus ?? null,
    amountTotal: input.amountTotal ?? null,
    currency: input.currency ?? null,
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
  stripeMock.accountsRetrieve.mockResolvedValue(readyAccount());

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

  it('parks a TRANSIENT retrieval failure so repeated cron runs cannot form a provider loop', async () => {
    const hold = await seedExpiredHold();
    stripeMock.sessionsRetrieve.mockRejectedValue(
      Object.assign(new Error('rate limited'), { statusCode: 429 }),
    );

    await runDepositReconcile();

    const eventId = `luster:poll_evidence:${hold.depositId}`;
    const [parked] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, eventId));

    expect(parked).toMatchObject({
      attempts: 1,
      lastError: 'provider_transient',
      outcome: 'deferred_no_deposit',
      status: 'failed_retryable',
    });
    expect(parked?.availableAt?.getTime()).toBeGreaterThan(Date.now());

    stripeMock.sessionsRetrieve.mockClear();
    await runDepositReconcile();

    // The live, not-yet-due lease excludes Step 0 and event redispatch, so the
    // next five-minute cron cannot retrieve from Stripe again.
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();

    const [unchanged] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, eventId));

    expect(unchanged?.attempts).toBe(1);
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

  it('T48 — two reconcile runs drain 30 complete paid holds before one reaper releases the 31st open unpaid hold', async () => {
    const stuckCompletePaid = [];
    for (let index = 0; index < 30; index += 1) {
      stuckCompletePaid.push(await seedExpiredHold({ expiredMinutesAgo: 180 + index }));
    }
    const freshExpiredUnpaid = await seedExpiredHold({ expiredMinutesAgo: 30 });

    stripeMock.sessionsRetrieve.mockImplementation(async (sessionId: string) => (
      sessionId === freshExpiredUnpaid.sessionId
        ? {
            id: sessionId,
            status: 'open',
            payment_status: 'unpaid',
            amount_total: AMOUNT,
            currency: 'cad',
            payment_intent: null,
            metadata: {},
          }
        : paidSession(sessionId)
    ));

    // PINNED: Step 0's batch is 25, so the paid blockers drain 25 then 5.
    const firstSweep = await runDepositReconcile();
    const secondSweep = await runDepositReconcile();

    expect(firstSweep.step0Confirmed).toBe(25);
    expect(secondSweep.step0Confirmed).toBe(5);

    for (const hold of stuckCompletePaid) {
      expect((await readDeposit(hold.depositId))?.status).toBe('paid');
    }

    expect((await readAppointment(freshExpiredUnpaid.appointmentId))?.status)
      .toBe('awaiting_payment');
    expect((await readDeposit(freshExpiredUnpaid.depositId))?.status)
      .toBe('checkout_created');

    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reaperClient = {
        checkout: {
          sessions: {
            create: vi.fn(async () => {
              throw new Error('the seeded hold already has a session');
            }),
            expire: vi.fn(async () => ({
              id: freshExpiredUnpaid.sessionId,
              status: 'expired',
            })),
            retrieve: vi.fn(async () => ({
              id: freshExpiredUnpaid.sessionId,
              status: 'expired',
            })),
          },
        },
      } as never;

      // PINNED: one reaper run comes only after both reconcile runs.
      const reaped = await reapExpiredDepositHolds({ client: reaperClient });

      expect(reaped.finalized).toBe(1);
      expect((await readAppointment(freshExpiredUnpaid.appointmentId))?.status).toBe('cancelled');
      expect((await readDeposit(freshExpiredUnpaid.depositId))?.status).toBe('expired');
    } finally {
      consoleWarn.mockRestore();
    }
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
// STORED-TYPE ROUTING / POISON CARVE-OUTS / POLL LEASES
// ===========================================================================

describe('event-row redispatch', () => {
  it('[D5-REV-6-RECLAIM] reclaims a stale processing row and redispatches it in the same sweep', async () => {
    const staleUpdatedAt = new Date(Date.now() - 16 * 60_000);
    await seedDueWorkRow({
      eventId: 'evt_stale_account',
      type: 'account.updated',
      status: 'processing',
      attempts: 1,
      updatedAt: staleUpdatedAt,
    });

    const summary = await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_stale_account'));

    expect(summary.eventsReclaimed).toBe(1);
    expect(stripeMock.accountsRetrieve).toHaveBeenCalledTimes(1);
    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('processed');
    expect(row?.attempts).toBe(2);
    expect(row?.updatedAt.getTime()).toBeGreaterThan(staleUpdatedAt.getTime());
  });

  it('[D5-REV-6-FAIR-SHARE] selects a newer account despite an older account filling the global batch', async () => {
    const noisyAccount = ACCOUNT;
    const quietAccount = 'acct_fair_share_quiet';
    const oldest = Date.now() - 2 * 60 * 60_000;

    for (let index = 0; index < RECONCILE_BATCH; index += 1) {
      await seedDueWorkRow({
        eventId: `evt_fair_noisy_${index}`,
        type: 'checkout.session.completed',
        account: noisyAccount,
        receivedAt: new Date(oldest + index),
      });
    }
    await seedDueWorkRow({
      eventId: 'evt_fair_quiet',
      type: 'checkout.session.completed',
      account: quietAccount,
      receivedAt: new Date(oldest + 60_000),
    });

    await runDepositReconcile();

    const [quiet] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_fair_quiet'));
    const noisy = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.account, noisyAccount));

    expect(quiet?.attempts).toBe(2);
    expect(quiet?.status).toBe('failed_retryable');
    expect(noisy.filter(row => row.attempts === 2)).toHaveLength(13);
    expect(noisy.filter(row => row.attempts === 1)).toHaveLength(12);
  });

  it('T59 — an injected sweep event uses its stored account and ends account_mismatch', async () => {
    const movedAccount = 'acct_sweep_moved_live';
    await db.update(schema.salonStripeAccountSchema)
      .set({
        revokedAt: new Date(),
        revocationCause: 'revoked_local',
      })
      .where(eq(schema.salonStripeAccountSchema.stripeAccountId, ACCOUNT));
    await db.insert(schema.salonStripeAccountSchema).values({
      id: 'ssa_sweep_moved_live',
      salonId: SALON,
      stripeAccountId: movedAccount,
      livemode: false,
    });

    const hold = await seedExpiredHold();
    await seedDueWorkRow({
      eventId: 'evt_t59_stored_account',
      type: 'checkout.session.completed',
      account: movedAccount,
      salonId: SALON,
      sessionId: hold.sessionId,
      depositId: hold.depositId,
      metadataSalonId: SALON,
      paymentIntentId: 'pi_t59_stored_account',
      paymentStatus: 'paid',
      amountTotal: AMOUNT,
      currency: 'cad',
    });

    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_t59_stored_account'));

    expect(row?.status).toBe('account_mismatch');
    expect(row?.outcome).toBe('account_mismatch');
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'deposit_confirm_account_mismatch',
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('routes a due account.updated through D2 and preserves D2 transient backoff', async () => {
    const transient = Object.assign(new Error('network down'), { type: 'StripeConnectionError' });
    stripeMock.accountsRetrieve.mockRejectedValueOnce(transient);
    await seedDueWorkRow({
      eventId: 'evt_due_account',
      type: 'account.updated',
      // The next claim reaches deposit routine A's generic poison threshold.
      // Stored account ownership must bypass that threshold and keep D2's lane.
      attempts: 7,
    });

    const before = Date.now();
    await runDepositReconcile();

    const [retry] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_due_account'));

    expect(stripeMock.accountsRetrieve).toHaveBeenCalledTimes(1);
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
    expect(retry?.attempts).toBe(8);
    expect(retry?.status).toBe('failed_retryable');
    expect(retry?.outcome).toBeNull();
    expect(retry?.lastError).toBe('provider_unreachable');
    // D2's capped exponential wait is one hour here, not routine A's poison.
    expect(retry?.availableAt?.getTime()).toBeGreaterThanOrEqual(before + 59 * 60_000);

    stripeMock.accountsRetrieve.mockResolvedValueOnce(readyAccount());
    await db.update(schema.stripeWebhookEventSchema)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_due_account'));

    await runDepositReconcile();

    const [done] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_due_account'));

    expect(done?.status).toBe('processed');
    expect(done?.outcome).toBe('processed');
    expect(stripeMock.accountsRetrieve).toHaveBeenCalledTimes(2);
  });

  it('applies D2 event-livemode gating before stored account readiness dispatch', async () => {
    await seedDueWorkRow({
      eventId: 'evt_due_account_wrong_mode',
      type: 'account.updated',
      attempts: 1,
      livemode: true,
    });
    await seedDueWorkRow({
      eventId: 'evt_due_account_wrong_mode_2',
      type: 'account.updated',
      attempts: 1,
      livemode: true,
    });

    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_due_account_wrong_mode'));
    const [second] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_due_account_wrong_mode_2'));

    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('ignored_livemode');
    expect(second?.status).toBe('processed');
    expect(second?.outcome).toBe('ignored_livemode');
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();
    expect(sentry.captureMessage.mock.calls
      .filter(call => call[0] === 'stripe_connect_ignored_livemode'))
      .toHaveLength(1);
  });

  it('keeps an unexpected stored account type in D2 after the safe-disable lane', async () => {
    await seedDueWorkRow({
      eventId: 'evt_due_account_unhandled',
      type: 'account.external_account.updated',
      outcome: 'disabled_by_flag',
    });

    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_due_account_unhandled'));

    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('ignored_unhandled');
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('applies D2 scope handling to an account row parked before scope validation', async () => {
    await seedDueWorkRow({
      eventId: 'evt_due_account_without_scope',
      type: 'account.updated',
      account: null,
      outcome: 'disabled_by_flag',
    });

    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_due_account_without_scope'));

    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('ignored_non_connect_scope');
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('T56 admission by a real client reference never authorizes an orphan outflow', async () => {
    const startTime = new Date(Date.now() + 4 * 86_400_000);
    await db.insert(schema.appointmentSchema).values({
      id: 'appt_orphan_reference',
      salonId: SALON,
      clientPhone: '4165553131',
      clientName: 'Orphan Reference Client',
      startTime,
      endTime: new Date(startTime.getTime() + 3_600_000),
      status: 'pending',
      totalPrice: 9000,
      totalDurationMinutes: 60,
    });
    await seedDueWorkRow({
      eventId: 'evt_orphan_luster',
      type: 'checkout.session.completed',
      outcome: 'deferred_no_deposit',
      attempts: 7,
      receivedAt: new Date(Date.now() - 2 * 60 * 60_000),
      sessionId: 'cs_orphan_luster',
      paymentIntentId: 'pi_orphan_luster',
      clientReferenceId: 'appt_orphan_reference',
    });

    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_orphan_luster'));

    expect(row?.status).toBe('orphan_unresolved');
    expect(row?.outcome).toBe('orphan_unresolved');
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
    expect(stripeMock.refundsList).not.toHaveBeenCalled();
    expect(sentry.captureMessage.mock.calls.filter(call => call[0] === 'deposit_orphan_unresolved'))
      .toHaveLength(1);
  });

  it('T56 metadata-only sibling reaches the same manual orphan terminal', async () => {
    await seedDueWorkRow({
      eventId: 'evt_orphan_metadata',
      type: 'checkout.session.completed',
      outcome: 'deferred_no_deposit',
      attempts: 7,
      receivedAt: new Date(Date.now() - 2 * 60 * 60_000),
      sessionId: 'cs_orphan_metadata',
      metadataSalonId: SALON,
    });

    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_orphan_metadata'));

    expect(row?.status).toBe('orphan_unresolved');
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
    expect(stripeMock.refundsList).not.toHaveBeenCalled();
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('carves a foreign exhausted row out of poison with no money-dark critical', async () => {
    await seedDueWorkRow({
      eventId: 'evt_orphan_foreign',
      type: 'checkout.session.completed',
      outcome: 'deferred_no_deposit',
      attempts: 7,
      receivedAt: new Date(Date.now() - 2 * 60 * 60_000),
      sessionId: 'cs_orphan_foreign',
    });

    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_orphan_foreign'));

    expect(row?.status).toBe('ignored_foreign_session');
    expect(row?.outcome).toBe('ignored_foreign_session');
    expect(sentry.captureMessage).not.toHaveBeenCalledWith(
      'deposit_orphan_unresolved',
      expect.anything(),
    );
    expect(sentry.captureMessage).not.toHaveBeenCalledWith(
      'deposit_event_poisoned',
      expect.anything(),
    );
  });

  it('does not make the orphan terminal reachable before the 90-minute horizon', async () => {
    await seedDueWorkRow({
      eventId: 'evt_orphan_too_young',
      type: 'checkout.session.completed',
      outcome: 'deferred_no_deposit',
      attempts: 7,
      receivedAt: new Date(Date.now() - 60 * 60_000),
      sessionId: 'cs_orphan_too_young',
      metadataSalonId: SALON,
    });

    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_orphan_too_young'));

    expect(row?.status).toBe('failed_retryable');
    expect(row?.outcome).toBe('deferred_no_deposit');
    expect(row?.lastError).toBe('orphan_horizon_pending');
    expect(row?.availableAt?.getTime()).toBeGreaterThan(Date.now() + 20 * 60_000);
    expect(sentry.captureMessage).not.toHaveBeenCalledWith(
      'deposit_orphan_unresolved',
      expect.anything(),
    );
  });

  it('T39(ii) never adopts a cross-tenant metadata-nominated orphan candidate', async () => {
    const otherSalon = 'salon_orphan_other';
    await db.insert(schema.salonSchema).values({
      id: otherSalon,
      name: 'Other Orphan Salon',
      slug: 'other-orphan-salon',
    });
    const otherStart = new Date(Date.now() + 3 * 86_400_000);
    await db.insert(schema.appointmentSchema).values({
      id: 'appt_orphan_other',
      salonId: otherSalon,
      clientPhone: '4165558888',
      clientName: 'Other Client',
      startTime: otherStart,
      endTime: new Date(otherStart.getTime() + 3_600_000),
      status: 'awaiting_payment',
      totalPrice: 9000,
      totalDurationMinutes: 60,
      depositHoldExpiresAt: new Date(Date.now() + 30 * 60_000),
    });
    await db.insert(schema.appointmentDepositSchema).values({
      id: 'dep_orphan_other',
      salonId: otherSalon,
      appointmentId: 'appt_orphan_other',
      amountCents: AMOUNT,
      status: 'checkout_created',
      stripeAccountId: 'acct_orphan_other',
      stripeCheckoutSessionId: 'cs_orphan_other_real',
    });
    await seedDueWorkRow({
      eventId: 'evt_orphan_substitution',
      type: 'checkout.session.completed',
      outcome: 'deferred_no_deposit',
      attempts: 7,
      receivedAt: new Date(Date.now() - 2 * 60 * 60_000),
      sessionId: 'cs_orphan_missing',
      depositId: 'dep_orphan_other',
      metadataSalonId: SALON,
    });

    await runDepositReconcile();

    const [foreignDeposit] = await db.select().from(schema.appointmentDepositSchema)
      .where(eq(schema.appointmentDepositSchema.id, 'dep_orphan_other'));

    expect(foreignDeposit?.status).toBe('checkout_created');
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();

    const orphanAlert = sentry.captureMessage.mock.calls
      .find(call => call[0] === 'deposit_orphan_unresolved');

    expect(orphanAlert?.[1]?.extra).not.toHaveProperty('candidateDepositId');
  });

  it('keeps the generic poison path for genuinely poisoned work', async () => {
    await seedDueWorkRow({
      eventId: 'evt_genuine_poison',
      type: 'checkout.session.completed',
      outcome: null,
      attempts: 7,
      sessionId: 'cs_poison',
      projectionStatus: 'failed',
    });

    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, 'evt_genuine_poison'));

    expect(row?.status).toBe('poisoned');
    expect(row?.outcome).toBe('poisoned');
    expect(sentry.captureMessage.mock.calls.filter(call => call[0] === 'deposit_event_poisoned'))
      .toHaveLength(1);
  });

  it('reuses one poll lease and retrieves fresh evidence on a later due run', async () => {
    const hold = await seedExpiredHold();
    stripeMock.sessionsRetrieve.mockResolvedValueOnce({
      id: hold.sessionId,
      status: 'complete',
      payment_status: 'unpaid',
      amount_total: AMOUNT,
      currency: 'cad',
      payment_intent: null,
      metadata: {},
    });

    await runDepositReconcile();
    const eventId = `luster:poll_evidence:${hold.depositId}`;
    await db.update(schema.stripeWebhookEventSchema)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.stripeWebhookEventSchema.eventId, eventId));
    stripeMock.sessionsRetrieve.mockResolvedValueOnce(paidSession(hold.sessionId));

    await runDepositReconcile();

    const rows = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, eventId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempts).toBe(2);
    expect(rows[0]?.status).toBe('processed');
    expect((await readDeposit(hold.depositId))?.status).toBe('paid');
    expect(stripeMock.sessionsRetrieve).toHaveBeenCalledTimes(2);
  });

  it('re-arms a consumed processed poll identity instead of looping every cron', async () => {
    const hold = await seedExpiredHold();
    await seedDueWorkRow({
      eventId: `luster:poll_evidence:${hold.depositId}`,
      type: 'luster.poll_evidence',
      salonId: SALON,
      status: 'processed',
      outcome: 'ignored_unpaid',
      attempts: 2,
      sessionId: hold.sessionId,
      depositId: hold.depositId,
    });
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
    await runDepositReconcile();

    const rows = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, `luster:poll_evidence:${hold.depositId}`));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('failed_retryable');
    expect(rows[0]?.outcome).toBe('awaiting_async_payment');
    expect(rows[0]?.attempts).toBe(3);
    // Run two is not due, and the live lease excludes Step 0.
    expect(stripeMock.sessionsRetrieve).toHaveBeenCalledTimes(1);
  });

  it('bounds a classified poll retrieval failure and stays silent after poison', async () => {
    const hold = await seedExpiredHold();
    const missing = Object.assign(new Error('missing'), {
      code: 'resource_missing',
      statusCode: 404,
    });
    stripeMock.sessionsRetrieve.mockRejectedValue(missing);

    await runDepositReconcile();
    const eventId = `luster:poll_evidence:${hold.depositId}`;
    await db.update(schema.stripeWebhookEventSchema)
      .set({ attempts: 7, availableAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.stripeWebhookEventSchema.eventId, eventId));

    stripeMock.sessionsRetrieve.mockClear();
    await runDepositReconcile();
    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, eventId));

    expect(row?.status).toBe('poisoned');
    // The cap is checked before another provider call, then the terminal excludes
    // every later discovery pass.
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
    expect(sentry.captureMessage.mock.calls.filter(call => call[0] === 'deposit_event_poisoned'))
      .toHaveLength(1);
  });

  it('keeps a refund-intent retry driver after payment_intent_unresolved', async () => {
    const hold = await seedExpiredHold({
      depositStatus: 'canceled',
      appointmentStatus: 'cancelled',
    });
    stripeMock.sessionsRetrieve.mockResolvedValue({ payment_intent: null });
    await seedDueWorkRow({
      eventId: `luster:luster.refund_intent:${hold.depositId}:e1`,
      type: 'luster.refund_intent',
      salonId: SALON,
      attempts: 1,
      sessionId: hold.sessionId,
      depositId: hold.depositId,
    });

    await runDepositReconcile();

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(
        schema.stripeWebhookEventSchema.eventId,
        `luster:luster.refund_intent:${hold.depositId}:e1`,
      ));

    expect(row?.status).toBe('failed_retryable');
    expect(row?.outcome).toBe('deferred_no_deposit');
    expect(row?.lastError).toBe('payment_intent_unresolved');
    expect(row?.processedAt).toBeNull();
    expect(row?.availableAt).not.toBeNull();
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
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
