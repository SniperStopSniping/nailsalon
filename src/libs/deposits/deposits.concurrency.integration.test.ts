/**
 * D5's genuine PostgreSQL race evidence.
 *
 * PGlite has one connection and cannot exercise PostgreSQL row/advisory locks,
 * EvalPlanQual, or the `btree_gist` exclusion constraint. This suite therefore
 * runs only against the repository's strongly-attested disposable PostgreSQL
 * target. With no target it skips explicitly for ordinary `vitest` runs; CI
 * sets `D5_CONCURRENCY_REQUIRED=true`, which turns a missing target into a hard
 * failure before a test can be reported as skipped.
 *
 * Local command (the container id/network evidence is load-bearing):
 *
 *   docker network create luster-d5-disposable
 *   docker run --detach --name luster-d5-postgres \
 *     --network luster-d5-disposable \
 *     --publish 127.0.0.1:55432:5432 \
 *     --env POSTGRES_DB=luster_e2e_ci_disposable \
 *     --env POSTGRES_USER=luster_e2e_ci \
 *     --env POSTGRES_PASSWORD=luster-e2e-ci-only-password \
 *     postgres:16-alpine
 *   until docker exec luster-d5-postgres \
 *     pg_isready -U luster_e2e_ci -d luster_e2e_ci_disposable; do sleep 1; done
 *   export DATABASE_URL="$(printf '%s%s' 'postgresql:' '//luster_e2e_ci:luster-e2e-ci-only-password@127.0.0.1:55432/luster_e2e_ci_disposable?application_name=luster-e2e-ci-disposable')"
 *   export CONCURRENCY_TEST_DATABASE_URL="$DATABASE_URL"
 *   export LUSTER_DISPOSABLE_DATABASE=true
 *   export LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID="$(docker inspect --format '{{.Id}}' luster-d5-postgres)"
 *   export LUSTER_DISPOSABLE_POSTGRES_NETWORK=luster-d5-disposable
 *   export D5_CONCURRENCY_REQUIRED=true
 *   npm run db:prepare:e2e:ci
 *   npm run test:deposits:pg
 */
import path from 'node:path';

import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  attestDisposableDatabaseSession,
  type DisposableDatabaseTarget,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
const REQUIRED = process.env.D5_CONCURRENCY_REQUIRED === 'true';

let disposableTarget: DisposableDatabaseTarget | null = null;
if (RAW_URL) {
  // A supplied-but-invalid URL always fails. Only a genuinely absent opt-in URL
  // may skip, and required CI mode turns even that absence into a hard failure.
  disposableTarget = requireDisposableDatabaseTarget({
    ...process.env,
    DATABASE_URL: RAW_URL,
  });
} else if (REQUIRED) {
  throw new Error(
    'D5 PostgreSQL concurrency is required, but CONCURRENCY_TEST_DATABASE_URL is absent.',
  );
}

vi.mock('server-only', () => ({}));
vi.mock('@/core/redis/redisClient', () => ({
  redis: null,
  isRedisAvailable: vi.fn(async () => false),
}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  checkoutCreate: vi.fn(),
  checkoutRetrieve: vi.fn(),
  recordGoogleEventReviewDecision: vi.fn(),
  refreshAccountReadiness: vi.fn(),
  refundsCreate: vi.fn(),
  refundsList: vi.fn(),
  refundsRetrieve: vi.fn(),
  requireAdmin: vi.fn(),
  requireAdminSalon: vi.fn(),
  requireAppointmentAccess: vi.fn(),
  requireAppointmentManagerAccess: vi.fn(),
  requireClientApiSession: vi.fn(),
  requireStaffAppointmentAccess: vi.fn(),
  requireStaffSession: vi.fn(),
  sendAppointmentReminder: vi.fn(),
  sendTransactionalEmail: vi.fn(),
  sendTransactionalEmailDetailed: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
}));

vi.mock('@/libs/stripe', () => ({
  EXPECTED_STRIPE_API_VERSION: '2024-06-20',
  stripe: {
    checkout: { sessions: { retrieve: mocks.checkoutRetrieve } },
    refunds: {
      create: mocks.refundsCreate,
      list: mocks.refundsList,
      retrieve: mocks.refundsRetrieve,
    },
  },
}));

vi.mock('@/libs/depositCheckout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/depositCheckout')>();
  return {
    ...actual,
    createDepositCheckoutSession: mocks.checkoutCreate,
  };
});

vi.mock('@/libs/stripeConnect/readiness', () => ({
  refreshAccountReadiness: mocks.refreshAccountReadiness,
}));

vi.mock('@/libs/email', () => ({
  sendTransactionalEmail: mocks.sendTransactionalEmail,
  sendTransactionalEmailDetailed: mocks.sendTransactionalEmailDetailed,
}));
vi.mock('@/libs/staffAuth', () => ({ requireStaffSession: mocks.requireStaffSession }));
vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: mocks.requireAdmin,
  requireAdminSalon: mocks.requireAdminSalon,
}));
vi.mock('@/libs/clientApiGuards', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/clientApiGuards')>()),
  requireClientApiSession: mocks.requireClientApiSession,
}));
vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentAccess: mocks.requireAppointmentAccess,
  requireAppointmentManagerAccess: mocks.requireAppointmentManagerAccess,
}));
vi.mock('@/libs/staffApiGuards', () => ({
  requireStaffAppointmentAccess: mocks.requireStaffAppointmentAccess,
}));
vi.mock('@/libs/SMS', () => ({
  sendAppointmentReminder: mocks.sendAppointmentReminder,
  sendBookingConfirmationToClient: vi.fn(),
  sendCancellationNotificationToTech: vi.fn(),
  sendRescheduleConfirmation: vi.fn(),
}));
vi.mock('@/libs/googleCalendar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/googleCalendar')>()),
  getGoogleCalendarBusyWindows: vi.fn(async () => []),
  hasGoogleCalendarConflict: vi.fn(async () => false),
}));
vi.mock('@/libs/googleEventReview', () => ({
  recordGoogleEventReviewDecision: mocks.recordGoogleEventReviewDecision,
}));

const { POST: createAppointment } = await import('@/app/api/appointments/route');
const { markAppliedRewardForBooking } = await import('@/libs/bookingCommitEffects');
const { confirmDepositPayment } = await import('./confirmDepositPayment');
const { runLateDepositRecovery } = await import('./lateDepositRecovery');
const {
  lockExactRewardForDepositAttribution,
} = await import('./rewardAttribution');
const {
  claimWebhookEvent,
  finalizeWebhookEvent,
  reclaimWebhookEvent,
} = await import('@/libs/stripeConnect/webhookEvents');

const SALON_ID = 'salon_d5_concurrency';
const SALON_SLUG = 'd5-concurrency-salon';
const TECH_ID = 'tech_d5_concurrency';
const SECOND_TECH_ID = 'tech_d5_concurrency_2';
const SERVICE_ID = 'svc_d5_concurrency';
const ACCOUNT_ID = 'acct_d5_concurrency';
const BOOKING_START = '2099-09-01T15:00:00.000Z';
const LINEAGE_PHONE = '4165553030';
const LINEAGE_EMAIL = 'lineage.d5@example.invalid';
const EXPECTED_EXECUTED_TESTS = 8;

const BASE_SETTINGS: SalonSettings = {
  booking: {
    timezone: 'America/Toronto',
    slotIntervalMinutes: 15,
    bufferMinutes: 10,
  },
};

const DEPOSIT_SETTINGS: SalonSettings = {
  ...BASE_SETTINGS,
  payments: {
    deposit: { enabled: true, amountCents: 2500 },
  },
};

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
type HeldLock = { pid: number; release: () => Promise<void> };

let pool: pg.Pool;
let db: TestDb;
let executedTests = 0;
const pendingLockReleases = new Set<() => Promise<void>>();

const suite = disposableTarget ? describe : describe.skip;

suite('D5 — genuine PostgreSQL concurrency', () => {
  beforeAll(async () => {
    if (!disposableTarget) {
      throw new Error('Disposable target unexpectedly absent inside active D5 suite.');
    }

    process.env.PUBLIC_APP_URL = 'https://app.luster.test';
    const expectedServer = resolveDisposableDatabaseServerExpectation(disposableTarget);
    pool = new pg.Pool({ connectionString: disposableTarget.connectionString, max: 12 });

    const attestationClient = await pool.connect();
    try {
      await attestDisposableDatabaseSession(
        attestationClient,
        disposableTarget,
        expectedServer,
      );
    } finally {
      attestationClient.release();
    }

    db = drizzle(pool, { schema });
    holder.db = db;
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

    await pool.query('TRUNCATE TABLE salon RESTART IDENTITY CASCADE');
    await seedBaseCatalog();
  }, 120_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.requireStaffSession.mockResolvedValue({ ok: false });
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    mocks.requireAdminSalon.mockResolvedValue({
      error: new Response(null, { status: 401 }),
      salon: null,
    });
    mocks.requireClientApiSession.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    mocks.requireAppointmentAccess.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    mocks.requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    mocks.requireStaffAppointmentAccess.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    mocks.sendTransactionalEmail.mockResolvedValue(true);
    mocks.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: true,
      errorCode: null,
      providerMessageId: 'd5-concurrency-message',
    });
    mocks.sendAppointmentReminder.mockResolvedValue(true);
    mocks.recordGoogleEventReviewDecision.mockResolvedValue(undefined);
    mocks.refundsRetrieve.mockResolvedValue(null);
    mocks.refundsList.mockResolvedValue({ data: [] });
    mocks.refundsCreate.mockResolvedValue({ id: 're_d5_concurrency', status: 'succeeded' });
    mocks.checkoutRetrieve.mockResolvedValue({ payment_intent: 'pi_d5_concurrency' });
    mocks.checkoutCreate.mockImplementation(async ({ deposit }: {
      deposit: { id: string; holdExpiresAt: Date };
    }) => ({
      ok: true,
      session: {
        id: `cs_${deposit.id}`,
        object: 'checkout.session',
        url: `https://checkout.stripe.test/${deposit.id}`,
        expires_at: Math.floor(deposit.holdExpiresAt.getTime() / 1000),
        payment_intent: null,
      },
    }));

    await dropTestBarriers();
    await pool.query(`TRUNCATE TABLE
      appointment_booking_policy_acknowledgment,
      appointment_access_token,
      appointment_add_on,
      appointment_services,
      notification_delivery,
      integration_outbox,
      google_calendar_event,
      appointment_deposit,
      reward,
      stripe_webhook_event,
      appointment,
      salon_client_contact_alias,
      salon_client,
      salon_stripe_account
      RESTART IDENTITY CASCADE`);

    await db.update(schema.salonSchema).set({
      settings: BASE_SETTINGS,
      features: null,
      freeSoloEnabled: false,
    }).where(eq(schema.salonSchema.id, SALON_ID));
  });

  afterEach(async () => {
    await dropTestBarriers();
    const releases = [...pendingLockReleases];
    pendingLockReleases.clear();
    await Promise.allSettled(releases.map(release => release()));
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (pool) {
      await dropTestBarriers().catch(() => {});
      const releases = [...pendingLockReleases];
      pendingLockReleases.clear();
      await Promise.allSettled(releases.map(release => release()));
      await pool.end();
    }

    expect(executedTests).toBe(EXPECTED_EXECUTED_TESTS);

    process.stdout.write(
      `D5_REAL_POSTGRES_TESTS_EXECUTED=${executedTests} D5_REAL_POSTGRES_TESTS_SKIPPED=0\n`,
    );
  });

  it('lets two workers claim one event exactly once and confirms exactly once', async () => {
    await seedBinding();
    const { appointmentId, depositId, sessionId } = await seedDepositPair({
      suffix: 'claim',
      appointmentStatus: 'awaiting_payment',
      depositStatus: 'checkout_created',
    });
    const eventId = 'evt_d5_two_workers';
    const barrierKey = 'd5-two-workers-insert';
    await installEventInsertBarrier(eventId, barrierKey);
    const held = await holdAdvisoryKey(barrierKey);

    const projection = {
      sessionId,
      paymentIntentId: 'pi_d5_claim',
      paymentStatus: 'paid',
      amountTotal: 2500,
      currency: 'cad',
      metadataAppointmentId: appointmentId,
      metadataSalonId: SALON_ID,
      metadataDepositId: depositId,
      clientReferenceId: appointmentId,
      projectionStatus: 'ok' as const,
      rawPayload: null,
      payloadPurgeAfter: null,
    };
    const claims = [
      claimWebhookEvent({ eventId, type: 'checkout.session.completed', account: ACCOUNT_ID, livemode: false, projection }),
      claimWebhookEvent({ eventId, type: 'checkout.session.completed', account: ACCOUNT_ID, livemode: false, projection }),
    ];

    await releaseAfterBlocked(held, 2, claims);
    const results = await Promise.all(claims);
    const winners = results.filter(result => result.claimed);

    expect(winners).toHaveLength(1);

    const winner = winners[0];
    if (!winner?.claimed) {
      throw new Error('The event claim race had no winner.');
    }

    const confirmation = await confirmDepositPayment(paidEvidence({
      sessionId,
      appointmentId,
      depositId,
      paymentIntentId: 'pi_d5_claim',
    }));

    expect(confirmation.disposition).toBe('confirmed');
    expect(await finalizeWebhookEvent({
      id: winner.id,
      attempts: winner.attempts,
      status: 'processed',
      outcome: 'confirmed',
      processedAt: new Date(),
    })).toBe(true);

    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId));
    const [deposit] = await db.select().from(schema.appointmentDepositSchema)
      .where(eq(schema.appointmentDepositSchema.id, depositId));
    const eventRows = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, eventId));
    const audits = await db.select().from(schema.appointmentAuditLogSchema)
      .where(eq(schema.appointmentAuditLogSchema.appointmentId, appointmentId));

    expect(appointment?.status).toBe('pending');
    expect(deposit?.status).toBe('paid');
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]).toMatchObject({ status: 'processed', attempts: 1, outcome: 'confirmed' });
    expect(audits.filter(row => row.reason === 'deposit_payment_confirmed')).toHaveLength(1);

    executedTests += 1;
  }, 30_000);

  it('serializes a confirmation driver against late recovery without duplicating money movement', async () => {
    await seedBinding();
    const clientId = 'client_d5_confirm_recovery';
    await seedClient(clientId, '4165553111', 'confirm.recovery@example.invalid');
    const pair = await seedDepositPair({
      suffix: 'confirm_recovery',
      appointmentStatus: 'cancelled',
      depositStatus: 'expired',
      clientId,
      clientPhone: '4165553111',
      clientEmail: 'confirm.recovery@example.invalid',
    });
    const held = await holdClientRow(clientId);

    const confirmationDriver = (async () => {
      const confirm = await confirmDepositPayment(paidEvidence({
        sessionId: pair.sessionId,
        appointmentId: pair.appointmentId,
        depositId: pair.depositId,
        paymentIntentId: 'pi_d5_confirm_recovery',
      }));
      if (confirm.disposition !== 'late_recovery_required' || !confirm.depositId || !confirm.salonId) {
        return confirm;
      }
      return runLateDepositRecovery({ depositId: confirm.depositId, salonId: confirm.salonId });
    })();
    const recoveryDriver = runLateDepositRecovery({
      depositId: pair.depositId,
      salonId: SALON_ID,
    });
    const operations = [confirmationDriver, recoveryDriver];

    await releaseAfterBlocked(held, 2, operations);
    const results = await Promise.all(operations);
    const dispositions = results.map(result => result.disposition);

    expect(dispositions).toContain('restored');
    expect(dispositions.every(value => value === 'restored' || value === 'already_confirmed')).toBe(true);

    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, pair.appointmentId));
    const [deposit] = await db.select().from(schema.appointmentDepositSchema)
      .where(eq(schema.appointmentDepositSchema.id, pair.depositId));

    expect(appointment?.status).toBe('pending');
    expect(deposit?.status).toBe('paid');
    expect(mocks.refundsCreate).not.toHaveBeenCalled();

    executedTests += 1;
  }, 30_000);

  it('allows exactly one of two simultaneous deposit bookings for one constrained slot', async () => {
    const readinessBinding = await seedBinding();
    await db.update(schema.salonSchema).set({
      settings: DEPOSIT_SETTINGS,
      features: { money: { deposits: true } },
    }).where(eq(schema.salonSchema.id, SALON_ID));
    mocks.refreshAccountReadiness.mockResolvedValue({
      chargeReady: true,
      status: 'charge_ready',
      payoutsPending: false,
      binding: readinessBinding,
    });

    const held = await holdTechnicianAdvisory(TECH_ID);
    const requests = [
      createAppointment(bookingRequest({
        clientName: 'Deposit Racer A',
        clientPhone: '4165553201',
        clientEmail: 'deposit.racer.a@example.invalid',
        expectedDepositFingerprint: 'deposit-v1:cad:2500',
      })),
      createAppointment(bookingRequest({
        clientName: 'Deposit Racer B',
        clientPhone: '4165553202',
        clientEmail: 'deposit.racer.b@example.invalid',
        expectedDepositFingerprint: 'deposit-v1:cad:2500',
      })),
    ];

    await releaseAfterBlocked(held, 2, requests);
    const responses = await Promise.all(requests);

    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);

    const loser = responses.find(response => response.status === 409);

    expect((await loser?.json() as { error?: { code?: string } } | undefined)?.error?.code)
      .toBe('TIME_CONFLICT');

    const appointments = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.status, 'awaiting_payment'));
    const deposits = await db.select().from(schema.appointmentDepositSchema);

    expect(appointments).toHaveLength(1);
    expect(deposits).toHaveLength(1);
    expect(deposits[0]).toMatchObject({
      appointmentId: appointments[0]?.id,
      status: 'checkout_created',
      amountCents: 2500,
      stripeAccountId: ACCOUNT_ID,
    });
    expect(mocks.checkoutCreate).toHaveBeenCalledTimes(1);

    executedTests += 1;
  }, 45_000);

  it('serializes two hold-time claims of the same exact reward to one attribution', async () => {
    const rewardId = 'reward_d5_rwd1_race';
    const clientPhone = '4165553299';
    await db.insert(schema.rewardSchema).values({
      id: rewardId,
      salonId: SALON_ID,
      clientPhone,
      type: 'referral_referee',
    });

    const appointmentIds = ['appt_d5_rwd1_a', 'appt_d5_rwd1_b'];
    for (const [index, appointmentId] of appointmentIds.entries()) {
      const startTime = new Date(`2099-11-0${index + 1}T15:00:00.000Z`);
      await db.insert(schema.appointmentSchema).values({
        id: appointmentId,
        salonId: SALON_ID,
        clientPhone,
        startTime,
        endTime: new Date(startTime.getTime() + 60 * 60_000),
        status: 'awaiting_payment',
        totalPrice: 6000,
        totalDurationMinutes: 60,
      });
    }

    const held = await holdRewardRow(rewardId);
    const claims = appointmentIds.map((appointmentId, index) => db.transaction(async (tx) => {
      const attributedReward = await lockExactRewardForDepositAttribution(tx, {
        rewardId,
        salonId: SALON_ID,
        clientPhones: [clientPhone],
      });
      await tx.insert(schema.appointmentDepositSchema).values({
        id: `dep_d5_rwd1_${index}`,
        salonId: SALON_ID,
        appointmentId,
        amountCents: 2500,
        status: 'checkout_created',
        stripeAccountId: ACCOUNT_ID,
        appliedRewardId: attributedReward.id,
        appliedRewardClientId: 'client_d5_rwd1_claims',
        appliedRewardClientPhone: attributedReward.clientPhone,
      });
      return appointmentId;
    }));

    await releaseAfterBlocked(held, 2, claims);
    const results = await Promise.allSettled(claims);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);

    const attributed = await db.select().from(schema.appointmentDepositSchema)
      .where(eq(schema.appointmentDepositSchema.appliedRewardId, rewardId));

    expect(attributed).toHaveLength(1);

    executedTests += 1;
  }, 30_000);

  it('confirms an attributed hold without deadlocking a competing new claim', async () => {
    await seedBinding();
    const rewardId = 'reward_d5_rwd1_confirm_claim_race';
    const clientId = 'client_d5_rwd1_confirm_claim_race';
    const clientPhone = '4165553296';
    await seedClient(clientId, clientPhone, 'confirm.claim@example.invalid');
    const original = await seedDepositPair({
      suffix: 'rwd1_confirm_claim_race',
      appointmentStatus: 'awaiting_payment',
      depositStatus: 'checkout_created',
      clientId,
      clientPhone,
      clientEmail: 'confirm.claim@example.invalid',
      appliedRewardId: rewardId,
    });
    const competingAppointmentId = 'appt_d5_rwd1_competing_claim';
    await db.insert(schema.appointmentSchema).values({
      id: competingAppointmentId,
      salonId: SALON_ID,
      clientPhone,
      startTime: new Date('2099-11-20T15:00:00.000Z'),
      endTime: new Date('2099-11-20T16:00:00.000Z'),
      status: 'awaiting_payment',
      totalPrice: 6000,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.rewardSchema).values({
      id: rewardId,
      salonId: SALON_ID,
      clientPhone,
      type: 'referral_referee',
    });

    const held = await holdRewardRow(rewardId);
    const confirmation = confirmDepositPayment(paidEvidence({
      sessionId: original.sessionId,
      appointmentId: original.appointmentId,
      depositId: original.depositId,
      paymentIntentId: 'pi_d5_rwd1_confirm_claim_race',
    }));
    const competingClaim = db.transaction(async (tx) => {
      const attributedReward = await lockExactRewardForDepositAttribution(tx, {
        rewardId,
        salonId: SALON_ID,
        clientPhones: [clientPhone],
      });
      await tx.insert(schema.appointmentDepositSchema).values({
        id: 'dep_d5_rwd1_competing_claim',
        salonId: SALON_ID,
        appointmentId: competingAppointmentId,
        amountCents: 2500,
        status: 'checkout_created',
        stripeAccountId: ACCOUNT_ID,
        appliedRewardId: attributedReward.id,
        appliedRewardClientId: clientId,
        appliedRewardClientPhone: attributedReward.clientPhone,
      });
    });

    await releaseAfterBlocked(held, 2, [confirmation, competingClaim]);
    const [confirmResult, claimResult] = await Promise.allSettled([
      confirmation,
      competingClaim,
    ] as const);

    expect(confirmResult.status).toBe('fulfilled');

    if (confirmResult.status !== 'fulfilled') {
      throw confirmResult.reason;
    }

    expect(confirmResult.value.disposition).toBe('confirmed');
    expect(claimResult.status).toBe('rejected');
    expect((await db.select().from(schema.appointmentDepositSchema)
      .where(eq(schema.appointmentDepositSchema.id, original.depositId)))[0]?.status)
      .toBe('paid');
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, rewardId)))[0]?.usedInAppointmentId)
      .toBe(original.appointmentId);

    executedTests += 1;
  }, 45_000);

  it('serializes late restore against ordinary consumption of its expired attribution', async () => {
    await seedBinding();
    const rewardId = 'reward_d5_rwd1_restore_consume_race';
    const clientId = 'client_d5_rwd1_restore_consume';
    const clientPhone = '4165553297';
    const consumingAppointmentId = 'appt_d5_rwd1_consuming';
    await seedClient(clientId, clientPhone, 'restore.consume@example.invalid');
    const pair = await seedDepositPair({
      suffix: 'rwd1_restore_consume',
      appointmentStatus: 'cancelled',
      depositStatus: 'expired',
      clientId,
      clientPhone,
      clientEmail: 'restore.consume@example.invalid',
      appliedRewardId: rewardId,
    });
    await db.insert(schema.appointmentSchema).values({
      id: consumingAppointmentId,
      salonId: SALON_ID,
      salonClientId: clientId,
      clientPhone,
      startTime: new Date('2099-08-01T15:00:00.000Z'),
      endTime: new Date('2099-08-01T16:00:00.000Z'),
      status: 'completed',
      totalPrice: 6000,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.rewardSchema).values({
      id: rewardId,
      salonId: SALON_ID,
      clientPhone,
      type: 'referral_referee',
    });

    const held = await holdRewardRow(rewardId);
    const consumption = markAppliedRewardForBooking({
      appliedRewardId: rewardId,
      appointment: {
        id: consumingAppointmentId,
        notes: null,
        googleCalendarEventId: null,
      },
      clientPhone,
      rewardAttributionDepositId: null,
      salon: {
        id: SALON_ID,
        name: 'D5 Concurrency Salon',
        ownerName: null,
        ownerPhone: null,
        ownerEmail: null,
        features: null,
        settings: null,
      },
    });
    const recovery = runLateDepositRecovery({
      depositId: pair.depositId,
      salonId: SALON_ID,
    });
    const operations = [consumption, recovery];

    await releaseAfterBlocked(held, 2, operations);
    const [consumptionResult, recoveryResult] = await Promise.allSettled([
      consumption,
      recovery,
    ] as const);

    expect(recoveryResult.status).toBe('fulfilled');

    if (recoveryResult.status !== 'fulfilled') {
      throw recoveryResult.reason;
    }

    const [reward] = await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, rewardId));
    const [deposit] = await db.select().from(schema.appointmentDepositSchema)
      .where(eq(schema.appointmentDepositSchema.id, pair.depositId));

    if (consumptionResult.status === 'fulfilled') {
      expect(recoveryResult.value.disposition).toBe('refunded');
      expect(deposit?.status).toBe('refunded');
      expect(reward?.usedInAppointmentId).toBe(consumingAppointmentId);
      expect(mocks.refundsCreate).toHaveBeenCalledTimes(1);
    } else {
      expect(recoveryResult.value.disposition).toBe('restored');
      expect(deposit?.status).toBe('paid');
      expect(reward?.usedInAppointmentId).toBe(pair.appointmentId);
      expect(mocks.refundsCreate).not.toHaveBeenCalled();
    }

    executedTests += 1;
  }, 45_000);

  it('has exactly one stale-claim winner without the 0065 updated_at trigger (M23)', async () => {
    const eventId = 'evt_d5_m23_reclaim';
    const rowId = 'swe_d5_m23_reclaim';
    const stale = new Date(Date.now() - 60 * 60_000);
    await db.insert(schema.stripeWebhookEventSchema).values({
      id: rowId,
      eventId,
      type: 'checkout.session.completed',
      account: ACCOUNT_ID,
      livemode: false,
      status: 'processing',
      attempts: 1,
      receivedAt: stale,
      updatedAt: stale,
    });

    // M23 must remain meaningful under OS-5(b), where there is no trigger. If
    // this trigger stayed enabled, removing the explicit SET would still pass
    // because 0065's trigger would hide the mutant.
    await pool.query(
      'ALTER TABLE stripe_webhook_event DISABLE TRIGGER stripe_webhook_event_set_updated_at',
    );
    try {
      await installM23ExplicitTimestampGuard(rowId);
      const held = await holdEventRow(rowId);
      const now = new Date();
      const reclaims = [
        reclaimWebhookEvent({ id: rowId, now, staleCutoff: new Date(now.getTime() - 15 * 60_000) }),
        reclaimWebhookEvent({ id: rowId, now, staleCutoff: new Date(now.getTime() - 15 * 60_000) }),
      ];
      await releaseAfterBlocked(held, 2, reclaims);
      const results = await Promise.all(reclaims);

      expect(results.filter(result => result !== null)).toEqual([2]);

      const [stored] = await db.select().from(schema.stripeWebhookEventSchema)
        .where(eq(schema.stripeWebhookEventSchema.id, rowId));

      expect(stored?.attempts).toBe(2);
      expect(stored?.updatedAt.getTime()).toBeGreaterThan(stale.getTime());
    } finally {
      await pool.query(
        'ALTER TABLE stripe_webhook_event ENABLE TRIGGER stripe_webhook_event_set_updated_at',
      );
    }

    const trigger = await pool.query<{ enabled: string }>(`
      SELECT tgenabled AS enabled
      FROM pg_trigger
      WHERE tgrelid = 'stripe_webhook_event'::regclass
        AND tgname = 'stripe_webhook_event_set_updated_at'
        AND NOT tgisinternal
    `);

    expect(trigger.rows).toEqual([{ enabled: 'O' }]);

    executedTests += 1;
  }, 30_000);

  it('preserves one-active lineage when booking races TX-C restore (M30)', async () => {
    const clientId = 'client_d5_m30';
    await seedClient(clientId, LINEAGE_PHONE, LINEAGE_EMAIL);
    const pair = await seedDepositPair({
      suffix: 'm30_restore',
      appointmentStatus: 'cancelled',
      depositStatus: 'expired',
      clientId,
      clientPhone: LINEAGE_PHONE,
      clientEmail: LINEAGE_EMAIL,
      technicianId: TECH_ID,
      startTime: '2099-10-01T15:00:00.000Z',
    });

    const barrierKey = 'd5-m30-after-lineage-read';
    await installLineageWriteBarrier(barrierKey);
    const held = await holdAdvisoryKey(barrierKey);
    const booking = createAppointment(bookingRequest({
      technicianId: SECOND_TECH_ID,
      startTime: '2099-10-02T18:00:00.000Z',
      clientName: 'Lineage Racer',
      clientPhone: LINEAGE_PHONE,
      clientEmail: LINEAGE_EMAIL,
    }));
    const recovery = runLateDepositRecovery({ depositId: pair.depositId, salonId: SALON_ID });

    await releaseAfterBlocked(held, 2, [booking, recovery]);
    const bookingResponse = await booking;
    const recoveryResult = await recovery;

    expect(['restored', 'refunded']).toContain(recoveryResult.disposition);

    const active = await db.select().from(schema.appointmentSchema).where(and(
      eq(schema.appointmentSchema.salonClientId, clientId),
      inArray(schema.appointmentSchema.status, ['pending', 'confirmed', 'in_progress', 'awaiting_payment']),
    ));
    const [deposit] = await db.select().from(schema.appointmentDepositSchema)
      .where(eq(schema.appointmentDepositSchema.id, pair.depositId));

    expect(active).toHaveLength(1);

    if (recoveryResult.disposition === 'restored') {
      expect(bookingResponse.status).toBe(409);
      expect(active[0]?.id).toBe(pair.appointmentId);
      expect(deposit?.status).toBe('paid');
      expect(mocks.refundsCreate).not.toHaveBeenCalled();
    } else {
      expect(bookingResponse.status).toBe(201);
      expect(active[0]?.id).not.toBe(pair.appointmentId);
      expect(deposit?.status).toBe('refunded');
      expect(mocks.refundsCreate).toHaveBeenCalledTimes(1);
    }
    executedTests += 1;
  }, 45_000);
});

async function seedBaseCatalog(): Promise<void> {
  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'D5 Concurrency Salon',
    slug: SALON_SLUG,
    ownerEmail: 'owner.d5@example.invalid',
    isActive: true,
    status: 'active',
    publicationStatus: 'published',
    freeSoloEnabled: false,
    settings: BASE_SETTINGS,
  });
  await db.insert(schema.technicianSchema).values([
    {
      id: TECH_ID,
      salonId: SALON_ID,
      name: 'D5 Concurrency Tech',
      isActive: true,
      weeklySchedule: alwaysOpenSchedule(),
    },
    {
      id: SECOND_TECH_ID,
      salonId: SALON_ID,
      name: 'D5 Concurrency Tech 2',
      isActive: true,
      weeklySchedule: alwaysOpenSchedule(),
    },
  ]);
  await db.insert(schema.serviceSchema).values({
    id: SERVICE_ID,
    salonId: SALON_ID,
    name: 'D5 Concurrency Service',
    category: 'manicure',
    price: 6500,
    durationMinutes: 60,
    isActive: true,
  });
  await db.insert(schema.technicianServicesSchema).values([
    { technicianId: TECH_ID, serviceId: SERVICE_ID, enabled: true },
    { technicianId: SECOND_TECH_ID, serviceId: SERVICE_ID, enabled: true },
  ]);
}

function alwaysOpenSchedule() {
  return Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      .map(day => [day, { start: '00:00', end: '23:45' }]),
  );
}

async function seedBinding() {
  const [row] = await db.insert(schema.salonStripeAccountSchema).values({
    id: `ssa_${crypto.randomUUID()}`,
    salonId: SALON_ID,
    stripeAccountId: ACCOUNT_ID,
    livemode: false,
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    requirementsDue: {},
    disabledReason: null,
    lastSyncedAt: new Date(),
  }).returning();
  if (!row) {
    throw new Error('Failed to seed the D5 Connect binding.');
  }
  return {
    id: row.id,
    salonId: row.salonId,
    stripeAccountId: row.stripeAccountId,
    livemode: row.livemode,
    chargesEnabled: row.chargesEnabled,
    payoutsEnabled: row.payoutsEnabled,
    detailsSubmitted: row.detailsSubmitted,
    requirements: {
      currentlyDue: [],
      eventuallyDue: [],
      pastDue: [],
      pendingVerification: [],
      currentDeadline: null,
      futureCurrentDeadline: null,
    },
    disabledReason: null,
    connectedAt: row.connectedAt,
    revokedAt: null,
    revocationCause: null,
    lastSyncedAt: row.lastSyncedAt,
  };
}

async function seedClient(id: string, phone: string, email: string): Promise<void> {
  await db.insert(schema.salonClientSchema).values({
    id,
    salonId: SALON_ID,
    phone,
    email,
    fullName: 'D5 Concurrency Client',
  });
}

async function seedDepositPair(input: {
  suffix: string;
  appointmentStatus: 'awaiting_payment' | 'cancelled';
  depositStatus: 'checkout_created' | 'expired';
  clientId?: string | null;
  clientPhone?: string;
  clientEmail?: string | null;
  technicianId?: string;
  startTime?: string;
  appliedRewardId?: string | null;
}) {
  const appointmentId = `appt_d5_${input.suffix}`;
  const depositId = `dep_d5_${input.suffix}`;
  const sessionId = `cs_d5_${input.suffix}`;
  const startTime = new Date(input.startTime ?? '2099-09-15T15:00:00.000Z');
  const endTime = new Date(startTime.getTime() + 60 * 60_000);

  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId: SALON_ID,
    salonClientId: input.clientId ?? null,
    technicianId: input.technicianId ?? TECH_ID,
    clientPhone: input.clientPhone ?? '4165553999',
    clientEmail: input.clientEmail ?? 'deposit.payer@example.invalid',
    clientName: 'D5 Deposit Payer',
    startTime,
    endTime,
    status: input.appointmentStatus,
    cancelReason: input.appointmentStatus === 'cancelled' ? 'deposit_not_paid' : null,
    canvasState: input.appointmentStatus === 'cancelled' ? 'cancelled' : 'waiting',
    canvasStateUpdatedAt: new Date(),
    depositHoldExpiresAt: input.appointmentStatus === 'awaiting_payment'
      ? new Date(Date.now() + 30 * 60_000)
      : null,
    totalPrice: 6500,
    totalDurationMinutes: 60,
    blockedDurationMinutes: 70,
    bufferMinutes: 10,
  });
  await db.insert(schema.appointmentDepositSchema).values({
    id: depositId,
    salonId: SALON_ID,
    appointmentId,
    amountCents: 2500,
    disclosedAmountCents: 2500,
    currency: 'cad',
    status: input.depositStatus,
    stripeAccountId: ACCOUNT_ID,
    stripeCheckoutSessionId: sessionId,
    stripePaymentIntentId: `pi_d5_${input.suffix}`,
    appliedRewardId: input.appliedRewardId ?? null,
    appliedRewardClientId: input.appliedRewardId ? (input.clientId ?? null) : null,
    appliedRewardClientPhone: input.appliedRewardId ? (input.clientPhone ?? '4165553999') : null,
  });
  return { appointmentId, depositId, sessionId };
}

function paidEvidence(input: {
  sessionId: string;
  appointmentId: string;
  depositId: string;
  paymentIntentId: string;
}) {
  return {
    source: 'webhook' as const,
    connectedAccountId: ACCOUNT_ID,
    sessionId: input.sessionId,
    paymentIntentId: input.paymentIntentId,
    paymentStatus: 'paid',
    amountTotal: 2500,
    currency: 'cad',
    metadataAppointmentId: input.appointmentId,
    metadataSalonId: SALON_ID,
    metadataDepositId: input.depositId,
  };
}

function bookingRequest(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      salonSlug: SALON_SLUG,
      baseServiceId: SERVICE_ID,
      technicianId: TECH_ID,
      startTime: BOOKING_START,
      clientName: 'D5 Racer',
      clientEmail: 'd5.racer@example.invalid',
      clientPhone: '4165553001',
      ...overrides,
    }),
  });
}

async function registerHeldLock(connection: pg.PoolClient): Promise<HeldLock> {
  const result = await connection.query<{ pid: number }>('SELECT pg_backend_pid()::int AS pid');
  let released = false;
  const release = async () => {
    if (released) {
      return;
    }
    released = true;
    pendingLockReleases.delete(release);
    try {
      await connection.query('ROLLBACK');
    } finally {
      connection.release();
    }
  };
  pendingLockReleases.add(release);
  return { pid: result.rows[0]!.pid, release };
}

async function holdAdvisoryKey(key: string): Promise<HeldLock> {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [key],
    );
    return await registerHeldLock(connection);
  } catch (error) {
    await connection.query('ROLLBACK');
    connection.release();
    throw error;
  }
}

async function holdTechnicianAdvisory(technicianId: string): Promise<HeldLock> {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [SALON_ID, technicianId],
    );
    return await registerHeldLock(connection);
  } catch (error) {
    await connection.query('ROLLBACK');
    connection.release();
    throw error;
  }
}

async function holdClientRow(clientId: string): Promise<HeldLock> {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      'SELECT id FROM salon_client WHERE salon_id = $1 AND id = $2 FOR UPDATE',
      [SALON_ID, clientId],
    );
    return await registerHeldLock(connection);
  } catch (error) {
    await connection.query('ROLLBACK');
    connection.release();
    throw error;
  }
}

async function holdEventRow(eventRowId: string): Promise<HeldLock> {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      'SELECT id FROM stripe_webhook_event WHERE id = $1 FOR UPDATE',
      [eventRowId],
    );
    return await registerHeldLock(connection);
  } catch (error) {
    await connection.query('ROLLBACK');
    connection.release();
    throw error;
  }
}

async function holdRewardRow(rewardId: string): Promise<HeldLock> {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      'SELECT id FROM reward WHERE salon_id = $1 AND id = $2 FOR UPDATE',
      [SALON_ID, rewardId],
    );
    return await registerHeldLock(connection);
  } catch (error) {
    await connection.query('ROLLBACK');
    connection.release();
    throw error;
  }
}

async function waitForBlockedSessions(expectedCount: number, blockerPid: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await pool.query<{ count: number }>(`
      WITH RECURSIVE blocking_tree(waiting_pid, blocker_pid) AS (
        SELECT activity.pid, blocker.pid
        FROM pg_stat_activity AS activity
        CROSS JOIN LATERAL unnest(pg_blocking_pids(activity.pid)) AS blocker(pid)
        WHERE activity.datname = current_database()
          AND activity.pid <> pg_backend_pid()
          AND activity.state = 'active'
          AND activity.wait_event_type = 'Lock'

        UNION

        SELECT tree.waiting_pid, blocker.pid
        FROM blocking_tree AS tree
        CROSS JOIN LATERAL unnest(pg_blocking_pids(tree.blocker_pid)) AS blocker(pid)
      )
      SELECT count(DISTINCT waiting_pid)::int AS count
      FROM blocking_tree
      WHERE blocker_pid = $1
    `, [blockerPid]);
    if ((result.rows[0]?.count ?? 0) >= expectedCount) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${expectedCount} PostgreSQL sessions behind blocker ${blockerPid}.`);
}

async function releaseAfterBlocked(
  held: HeldLock,
  expectedCount: number,
  operations: Array<Promise<unknown>>,
): Promise<void> {
  try {
    await waitForBlockedSessions(expectedCount, held.pid);
  } catch (error) {
    await held.release();
    await Promise.allSettled(operations);
    throw error;
  }
  await held.release();
}

async function installEventInsertBarrier(eventId: string, barrierKey: string): Promise<void> {
  await pool.query(`
    CREATE FUNCTION d5_event_insert_barrier() RETURNS trigger
    LANGUAGE plpgsql AS $body$
    BEGIN
      IF NEW.event_id = '${eventId}' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('${barrierKey}', 0));
      END IF;
      RETURN NEW;
    END
    $body$;
    CREATE TRIGGER d5_event_insert_barrier_trigger
      BEFORE INSERT ON stripe_webhook_event
      FOR EACH ROW EXECUTE FUNCTION d5_event_insert_barrier();
  `);
}

async function installLineageWriteBarrier(barrierKey: string): Promise<void> {
  await pool.query(`
    CREATE FUNCTION d5_lineage_write_barrier() RETURNS trigger
    LANGUAGE plpgsql AS $body$
    BEGIN
      IF NEW.salon_id = '${SALON_ID}'
         AND NEW.client_phone = '${LINEAGE_PHONE}'
         AND NEW.status IN ('pending', 'confirmed') THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('${barrierKey}', 0));
      END IF;
      RETURN NEW;
    END
    $body$;
    CREATE TRIGGER d5_lineage_write_barrier_trigger
      BEFORE INSERT OR UPDATE ON appointment
      FOR EACH ROW EXECUTE FUNCTION d5_lineage_write_barrier();
  `);
}

/**
 * Drizzle's schema-level `$onUpdate` would otherwise hide M23 just as surely
 * as migration 0065's trigger: omitting `updatedAt` still sends a client-side
 * timestamp. Keep that fallback from moving this one fixture row, while still
 * accepting the production CAS's database-owned `now()` value. A client-side
 * timestamp predates PostgreSQL's transaction timestamp; `now()` equals it.
 */
async function installM23ExplicitTimestampGuard(eventRowId: string): Promise<void> {
  await pool.query(`
    CREATE FUNCTION d5_m23_explicit_timestamp_guard() RETURNS trigger
    LANGUAGE plpgsql AS $body$
    BEGIN
      IF NEW.id = '${eventRowId}'
         AND NEW.updated_at IS DISTINCT FROM transaction_timestamp() THEN
        NEW.updated_at := OLD.updated_at;
      END IF;
      RETURN NEW;
    END
    $body$;
    CREATE TRIGGER d5_m23_explicit_timestamp_guard_trigger
      BEFORE UPDATE ON stripe_webhook_event
      FOR EACH ROW EXECUTE FUNCTION d5_m23_explicit_timestamp_guard();
  `);
}

async function dropTestBarriers(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(`
    DROP TRIGGER IF EXISTS d5_m23_explicit_timestamp_guard_trigger ON stripe_webhook_event;
    DROP FUNCTION IF EXISTS d5_m23_explicit_timestamp_guard();
    DROP TRIGGER IF EXISTS d5_event_insert_barrier_trigger ON stripe_webhook_event;
    DROP FUNCTION IF EXISTS d5_event_insert_barrier();
    DROP TRIGGER IF EXISTS d5_lineage_write_barrier_trigger ON appointment;
    DROP FUNCTION IF EXISTS d5_lineage_write_barrier();
  `);
}
