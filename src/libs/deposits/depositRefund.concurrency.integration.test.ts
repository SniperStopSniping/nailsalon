/**
 * D6 refund concurrency evidence against genuine, disposable PostgreSQL.
 *
 * PGlite has one connection and cannot exercise PostgreSQL row locks,
 * EvalPlanQual, or a real 40P01. Ordinary Vitest runs therefore skip this
 * suite. The deposits PostgreSQL CI job sets D6_CONCURRENCY_REQUIRED=true;
 * in that mode a missing or rejected target is a hard failure before any test
 * can be reported as skipped.
 *
 * The Stripe boundary below is test-local. It is a stateful simulation, not
 * proof of Stripe's production idempotency replay behaviour.
 */
import path from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
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

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
const REQUIRED = process.env.D6_CONCURRENCY_REQUIRED === 'true';

let disposableTarget: DisposableDatabaseTarget | null = null;
if (RAW_URL) {
  // A supplied-but-invalid target never degrades to a skip.
  disposableTarget = requireDisposableDatabaseTarget({
    ...process.env,
    DATABASE_URL: RAW_URL,
  });
} else if (REQUIRED) {
  throw new Error(
    'D6 PostgreSQL concurrency is required, but CONCURRENCY_TEST_DATABASE_URL is absent.',
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
  enqueueClientStatsRefreshInTx: vi.fn(),
  enqueueDepositConfirmationSideEffects: vi.fn(),
  enqueueDepositRefundAlertInTx: vi.fn(),
  enqueueDepositRefundNotices: vi.fn(),
  enqueueGoogleCalendarDeleteInTx: vi.fn(),
  mintAppointmentManageCapability: vi.fn(),
  refundsCreate: vi.fn(),
  refundsList: vi.fn(),
  refundsRetrieve: vi.fn(),
  checkoutRetrieve: vi.fn(),
  requireAppointmentManagerAccess: vi.fn(),
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

vi.mock('@/libs/bookingCommitEffects', () => ({
  mintAppointmentManageCapability: mocks.mintAppointmentManageCapability,
}));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess: mocks.requireAppointmentManagerAccess,
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueClientStatsRefreshInTx: mocks.enqueueClientStatsRefreshInTx,
  enqueueDepositConfirmationSideEffects: mocks.enqueueDepositConfirmationSideEffects,
  enqueueDepositRefundAlertInTx: mocks.enqueueDepositRefundAlertInTx,
  enqueueDepositRefundNotices: mocks.enqueueDepositRefundNotices,
  enqueueGoogleCalendarDeleteInTx: mocks.enqueueGoogleCalendarDeleteInTx,
}));

const {
  applyRefundObservation,
  claimRefundReconcileLease,
  openSystemRefundIntent,
  reconcileDepositRefund,
  requestDepositRefund,
  retryFailedDepositRefund,
} = await import('./depositLifecycle');
const {
  createOrAdoptDepositRefund,
  resolveAllowedSourceStatuses,
} = await import('./depositRefund');
const { confirmDepositPayment } = await import('./confirmDepositPayment');
const { forfeitAppointmentDepositInTx } = await import('./depositForfeiture');
const { PATCH: completeAppointment } = await import(
  '@/app/api/appointments/[id]/complete/route'
);

const SALON_ID = 'salon_d6_refund_concurrency';
const SALON_SLUG = 'd6-refund-concurrency';
const TECH_ID = 'tech_d6_refund_concurrency';
const ACCOUNT_ID = 'acct_d6_refund_concurrency';
const OWNER_ID = 'admin_d6_refund_concurrency';
const EXPECTED_EXECUTED_TESTS = 10;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
type DepositRow = typeof schema.appointmentDepositSchema.$inferSelect;
type HeldLock = { pid: number; release: () => Promise<void> };
type ProviderRefund = {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  amount: number;
  currency: string;
  payment_intent: string;
  failure_reason: null;
  metadata: { luster_deposit_id: string };
};

let pool: pg.Pool;
let db: TestDb;
let executedTests = 0;
let seedOrdinal = 0;
let providerRefunds: ProviderRefund[] = [];
let createGate: { entered: Deferred; release: Deferred } | null = null;
const pendingLockReleases = new Set<() => Promise<void>>();

const suite = disposableTarget ? describe.sequential : describe.skip;

suite('D6 — genuine PostgreSQL refund concurrency', () => {
  beforeAll(async () => {
    if (!disposableTarget) {
      throw new Error('Disposable target unexpectedly absent inside active D6 suite.');
    }

    process.env.PUBLIC_APP_URL = 'https://app.luster.test';
    const expectedServer = resolveDisposableDatabaseServerExpectation(disposableTarget);
    pool = new pg.Pool({ connectionString: disposableTarget.connectionString, max: 16 });

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
  }, 120_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    seedOrdinal = 0;
    providerRefunds = [];
    createGate = null;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.mintAppointmentManageCapability.mockResolvedValue({
      token: 'd6-concurrency-manage-token',
      expiresAt: new Date('2100-01-01T00:00:00.000Z'),
    });
    mocks.enqueueClientStatsRefreshInTx.mockResolvedValue(undefined);
    mocks.enqueueDepositConfirmationSideEffects.mockResolvedValue(undefined);
    mocks.enqueueDepositRefundAlertInTx.mockResolvedValue(undefined);
    mocks.enqueueDepositRefundNotices.mockResolvedValue(undefined);
    mocks.enqueueGoogleCalendarDeleteInTx.mockResolvedValue(undefined);
    mocks.requireAppointmentManagerAccess.mockImplementation(async (appointmentId: string) => {
      const [appointment] = await db
        .select()
        .from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, appointmentId))
        .limit(1);
      if (!appointment) {
        return {
          ok: false as const,
          response: Response.json(
            { error: { code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' } },
            { status: 404 },
          ),
        };
      }
      return {
        ok: true as const,
        actorRole: 'admin' as const,
        admin: { id: OWNER_ID, name: 'D6.1 Concurrency Owner' },
        appointment,
      };
    });
    mocks.checkoutRetrieve.mockImplementation(async (
      _sessionId: string,
      options: { stripeAccount?: string },
    ) => {
      assertSnapshotAccount(options);
      return { payment_intent: 'pi_d6_refund_concurrency' };
    });
    mocks.refundsRetrieve.mockImplementation(async (
      refundId: string,
      options: { stripeAccount?: string },
    ) => {
      assertSnapshotAccount(options);
      return providerRefunds.find(refund => refund.id === refundId) ?? null;
    });
    mocks.refundsList.mockImplementation(async (
      params: { payment_intent?: string },
      options: { stripeAccount?: string },
    ) => {
      assertSnapshotAccount(options);
      return {
        data: providerRefunds.filter(refund => refund.payment_intent === params.payment_intent),
        has_more: false,
      };
    });
    mocks.refundsCreate.mockImplementation(async (
      params: { payment_intent?: string; metadata?: { luster_deposit_id?: string } },
      options: { stripeAccount?: string; idempotencyKey?: string },
    ) => {
      assertSnapshotAccount(options);
      const depositId = params.metadata?.luster_deposit_id;
      if (!depositId) {
        throw new Error('D6 refund create omitted its deposit identity metadata.');
      }
      const deposit = await loadDeposit(depositId);
      const expectedKey = `deposit:${depositId}:auto-refund:v${deposit.refundKeyEpoch}:${deposit.refundTerminalFailureCount}`;

      expect(options.idempotencyKey).toBe(expectedKey);

      if (createGate) {
        createGate.entered.resolve();
        await createGate.release.promise;
      }
      const existing = providerRefunds.find(refund => (
        refund.metadata.luster_deposit_id === depositId
      ));
      if (existing) {
        return existing;
      }
      const refund: ProviderRefund = {
        id: `re_${depositId}`,
        status: 'succeeded',
        amount: deposit.amountCents,
        currency: deposit.currency,
        payment_intent: params.payment_intent ?? deposit.stripePaymentIntentId ?? '',
        failure_reason: null,
        metadata: { luster_deposit_id: depositId },
      };
      providerRefunds.push(refund);
      return refund;
    });

    await dropTestObjects();
    // stripe_webhook_event.salon_id intentionally has no FK, so truncating the
    // salon graph does not clear provider-work leases by cascade.
    await pool.query(
      'TRUNCATE TABLE stripe_webhook_event, salon RESTART IDENTITY CASCADE',
    );
    await seedBase();
  });

  afterEach(async () => {
    createGate?.release.resolve();
    createGate = null;
    await dropTestObjects();
    const releases = [...pendingLockReleases];
    pendingLockReleases.clear();
    await Promise.allSettled(releases.map(release => release()));
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (pool) {
      await dropTestObjects().catch(() => {});
      const releases = [...pendingLockReleases];
      pendingLockReleases.clear();
      await Promise.allSettled(releases.map(release => release()));
      await pool.end();
    }

    expect(executedTests).toBe(EXPECTED_EXECUTED_TESTS);

    process.stdout.write(
      `D6_REAL_POSTGRES_TESTS_EXECUTED=${executedTests} D6_REAL_POSTGRES_TESTS_SKIPPED=0\n`,
    );
  });

  it('T2: has one pure database winner for two simultaneous system-intent CAS operations', async () => {
    const seeded = await seedDeposit({ suffix: 't2', status: 'canceled' });
    const held = await holdAppointmentRow(seeded.appointmentId);
    const snapshots = await Promise.all([loadDeposit(seeded.depositId), loadDeposit(seeded.depositId)]);
    const operations = snapshots.map(snapshot => openSystemRefundIntent(
      snapshot,
      ['expired', 'canceled', 'checkout_created', 'waived'],
    ));

    await releaseAfterBlocked(held, 2, operations);
    const winners = (await Promise.all(operations)).filter(Boolean);
    const [rowCount, auditCount] = await Promise.all([
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM appointment_deposit
          WHERE id = $1 AND refund_status = 'requested'`,
        [seeded.depositId],
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM appointment_audit_log
          WHERE appointment_id = $1 AND action = 'deposit_refund_requested'`,
        [seeded.appointmentId],
      ),
    ]);

    // Mutant (a): removing refund_status IS NULL admits both UPDATE RETURNING calls.
    expect(winners).toHaveLength(1);
    expect(rowCount.rows[0]?.count).toBe(1);
    expect(auditCount.rows[0]?.count).toBe(1);

    executedTests += 1;
  }, 30_000);

  it('T8(e)/mutant (ii): the SQL stamp CAS cannot rebind a retired refund identity', async () => {
    const seeded = await seedDeposit({
      suffix: 't8e_sql_cas',
      status: 'paid',
      refundStatus: 'requested',
      refundTrigger: 'owner',
    });
    const retiredRefundId = `re_${seeded.depositId}_corpse`;
    await db
      .update(schema.appointmentDepositSchema)
      .set({ priorRefundIds: [retiredRefundId] })
      .where(eq(schema.appointmentDepositSchema.id, seeded.depositId));

    const snapshots = await Promise.all([
      loadDeposit(seeded.depositId),
      loadDeposit(seeded.depositId),
    ]);
    const held = await holdAppointmentRow(seeded.appointmentId);
    const nativeIncludes = Array.prototype.includes;
    let retiredIdEligibilityChecks = 0;
    const includesSpy = vi
      .spyOn(Array.prototype, 'includes')
      .mockImplementation(function (
        this: unknown[],
        searchElement: unknown,
        fromIndex?: number,
      ) {
        if (
          searchElement === retiredRefundId
          && this.length === 1
          && this[0] === retiredRefundId
        ) {
          // Isolate the database predicate from the duplicated application
          // guards. PostgreSQL still contains the retired ID throughout.
          retiredIdEligibilityChecks += 1;
          return false;
        }
        return Reflect.apply(nativeIncludes, this, [searchElement, fromIndex]);
      });
    const operations = snapshots.map(snapshot => applyRefundObservation({
      deposit: snapshot,
      refund: {
        id: retiredRefundId,
        status: 'succeeded',
        amount: snapshot.amountCents,
        currency: snapshot.currency,
        metadata: { luster_deposit_id: snapshot.id },
        payment_intent: snapshot.stripePaymentIntentId ?? undefined,
      },
      origin: 'reconciler',
    }));

    let results: Awaited<ReturnType<typeof applyRefundObservation>>[];
    try {
      // Both operations have passed the snapshot guard before they queue on
      // the same real PostgreSQL appointment lock; neither can stamp early.
      await releaseAfterBlocked(held, 2, operations);
      results = await Promise.all(operations);
    } finally {
      includesSpy.mockRestore();
    }

    const stored = await loadDeposit(seeded.depositId);
    const auditCount = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM appointment_audit_log
        WHERE appointment_id = $1 AND action = 'deposit_refund_succeeded'`,
      [seeded.appointmentId],
    );
    const allRefundIdentities = [
      ...stored.priorRefundIds,
      ...(stored.stripeRefundId ? [stored.stripeRefundId] : []),
    ];

    expect(retiredIdEligibilityChecks).toBe(4);
    expect(results.filter(result => result.applied)).toHaveLength(0);
    expect(stored).toMatchObject({
      status: 'paid',
      refundStatus: 'requested',
      stripeRefundId: null,
      priorRefundIds: [retiredRefundId],
    });
    expect(new Set(allRefundIdentities).size).toBe(allRefundIdentities.length);
    expect(auditCount.rows[0]?.count).toBe(0);

    executedTests += 1;
  }, 30_000);

  it('T13: gives a simultaneous sweep lease to exactly one worker without spending attempt budget', async () => {
    const seeded = await seedDeposit({
      suffix: 't13',
      status: 'paid',
      refundStatus: 'requested',
      refundTrigger: 'owner',
    });
    const held = await holdDepositRow(seeded.depositId);
    const operations = [
      claimRefundReconcileLease({
        depositId: seeded.depositId,
        salonId: SALON_ID,
        expectedStatus: 'requested',
      }),
      claimRefundReconcileLease({
        depositId: seeded.depositId,
        salonId: SALON_ID,
        expectedStatus: 'requested',
      }),
    ];

    await releaseAfterBlocked(held, 2, operations);
    const winners = (await Promise.all(operations)).filter(Boolean);
    const stored = await loadDeposit(seeded.depositId);

    // Mutant (mm): removing the lease-free predicate returns two winners.
    expect(winners).toHaveLength(1);
    expect(stored.refundReconcileClaimedAt).not.toBeNull();
    expect(stored.refundReconcileAttempts).toBe(0);

    // Mutant (kk): an aged abandoned request is independently admissible even
    // before it spends the three-attempt budget.
    const aged = await seedDeposit({
      suffix: 't13_aged',
      status: 'paid',
      refundStatus: 'requested',
      refundTrigger: 'owner',
    });
    await db
      .update(schema.appointmentDepositSchema)
      .set({
        refundStatusChangedAt: new Date(Date.now() - 2 * 60 * 60_000),
        refundReconcileAttempts: 0,
      })
      .where(eq(schema.appointmentDepositSchema.id, aged.depositId));
    mocks.refundsCreate.mockClear();
    mocks.refundsList.mockClear();

    await expect(retryFailedDepositRefund({
      depositId: aged.depositId,
      salonId: SALON_ID,
      actor: ownerActor(),
    })).resolves.toMatchObject({ ok: true });
    expect(mocks.refundsCreate).toHaveBeenCalledTimes(1);

    // Mutant (mm): an account refusal restores the provider-work attempt and
    // parks the lease retryably; reactivation can reclaim that exact work row.
    const refused = await seedDeposit({
      suffix: 't13_refused',
      status: 'paid',
      refundStatus: 'requested',
      refundTrigger: 'owner',
    });
    await db
      .update(schema.salonStripeAccountSchema)
      .set({ revokedAt: new Date(), revocationCause: 'deauthorized' })
      .where(eq(schema.salonStripeAccountSchema.salonId, SALON_ID));
    mocks.refundsCreate.mockClear();
    mocks.refundsList.mockClear();

    await expect(createOrAdoptDepositRefund(
      await loadDeposit(refused.depositId),
      'owner',
    )).resolves.toMatchObject({
      disposition: 'noop',
      note: 'ACCOUNT_NOT_CHARGE_READY',
    });
    expect(mocks.refundsCreate).toHaveBeenCalledTimes(0);
    expect(mocks.refundsList).toHaveBeenCalledTimes(0);
    expect(await intentRows(refused.depositId)).toEqual([
      expect.objectContaining({ status: 'failed_retryable', attempts: 0 }),
    ]);

    await db
      .update(schema.salonStripeAccountSchema)
      .set({ revokedAt: null, revocationCause: null })
      .where(eq(schema.salonStripeAccountSchema.salonId, SALON_ID));
    await db
      .update(schema.stripeWebhookEventSchema)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.stripeWebhookEventSchema.metadataDepositId, refused.depositId));

    await expect(createOrAdoptDepositRefund(
      await loadDeposit(refused.depositId),
      'owner',
    )).resolves.toMatchObject({ disposition: 'refunded' });
    expect(mocks.refundsCreate).toHaveBeenCalledTimes(1);

    executedTests += 1;
  }, 30_000);

  it('T11(f): a losing owner retry neither finalizes nor mints a second write-ahead lease', async () => {
    const seeded = await seedDeposit({
      suffix: 't11f',
      status: 'paid',
      refundStatus: 'requested',
      refundTrigger: 'owner',
    });
    const entered = createDeferred();
    const release = createDeferred();
    createGate = { entered, release };
    const initial = await loadDeposit(seeded.depositId);
    const first = createOrAdoptDepositRefund(initial, 'owner', {
      trigger: 'owner',
      allowedSourceStatuses: resolveAllowedSourceStatuses(initial),
    });
    await entered.promise;

    const losingSnapshot = await loadDeposit(seeded.depositId);
    const loser = await createOrAdoptDepositRefund(losingSnapshot, 'owner', {
      trigger: 'owner',
      allowedSourceStatuses: resolveAllowedSourceStatuses(losingSnapshot),
    });
    const inFlight = await intentRows(seeded.depositId);

    // Mutant (b): finalizing conflict branch (i) changes this live owner's row.
    expect(loser).toMatchObject({ disposition: 'noop', note: 'write_ahead_busy' });
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0]).toMatchObject({ status: 'processing', attempts: 1 });
    expect(mocks.refundsCreate).toHaveBeenCalledTimes(1);

    release.resolve();

    await expect(first).resolves.toMatchObject({ disposition: 'refunded' });

    const finalRows = await intentRows(seeded.depositId);

    expect(finalRows).toHaveLength(1);
    expect(finalRows[0]).toMatchObject({ status: 'processed', attempts: 1 });
    expect(mocks.refundsCreate).toHaveBeenCalledTimes(1);

    const activelyLeased = await seedDeposit({
      suffix: 't11f_active_lease',
      status: 'paid',
      refundStatus: 'requested',
      refundTrigger: 'owner',
    });
    await db
      .update(schema.appointmentDepositSchema)
      .set({
        refundStatus: 'failed',
        refundStatusChangedAt: new Date(Date.now() - 2 * 60 * 60_000),
        refundTerminalFailureCount: 1,
        refundLastErrorCode: 'UNKNOWN_PROVIDER_ERROR',
        refundReconcileClaimedAt: new Date(),
      })
      .where(eq(schema.appointmentDepositSchema.id, activelyLeased.depositId));
    mocks.refundsCreate.mockClear();
    mocks.refundsList.mockClear();

    await expect(retryFailedDepositRefund({
      depositId: activelyLeased.depositId,
      salonId: SALON_ID,
      actor: ownerActor(),
    })).resolves.toMatchObject({
      ok: false,
      code: 'REFUND_RECONCILE_IN_FLIGHT',
    });
    expect(mocks.refundsCreate).toHaveBeenCalledTimes(0);
    expect(mocks.refundsList).toHaveBeenCalledTimes(0);
    expect(await loadDeposit(activelyLeased.depositId)).toMatchObject({
      refundStatus: 'failed',
      refundReconcileClaimedAt: expect.any(Date),
    });

    executedTests += 1;
  }, 30_000);

  it('T-STRUCT(a): owner request and sweep overlap behind one intent row and one create', async () => {
    const seeded = await seedDeposit({ suffix: 'struct_owner_sweep', status: 'paid' });
    const entered = createDeferred();
    const release = createDeferred();
    createGate = { entered, release };

    const owner = requestDepositRefund({
      depositId: seeded.depositId,
      salonId: SALON_ID,
      actor: ownerActor(),
    });
    await entered.promise;
    const requested = await loadDeposit(seeded.depositId);
    const lease = await claimRefundReconcileLease({
      depositId: seeded.depositId,
      salonId: SALON_ID,
      expectedStatus: 'requested',
    });

    expect(lease).not.toBeNull();

    const sweep = reconcileDepositRefund(requested);

    await expect(sweep).resolves.toMatchObject({ disposition: 'noop', note: 'write_ahead_busy' });

    release.resolve();

    await expect(owner).resolves.toMatchObject({ ok: true });

    // Mutant (c): deleting the TX-A2 insert leaves zero intent rows.
    expect(mocks.refundsCreate).toHaveBeenCalledTimes(1);
    expect(await intentRows(seeded.depositId)).toHaveLength(1);

    executedTests += 1;
  }, 30_000);

  it('T-STRUCT(b): D5 poll-originated and D6 owner drivers race to one intent and one create', async () => {
    const seeded = await seedDeposit({ suffix: 'struct_poll_owner', status: 'paid' });
    const held = await holdAppointmentRow(seeded.appointmentId);
    const startingSnapshot = await loadDeposit(seeded.depositId);
    const startTogether = createBarrier(2);
    const allowed = resolveAllowedSourceStatuses(startingSnapshot);

    const d5PollDriver = (async () => {
      await startTogether();
      return createOrAdoptDepositRefund(startingSnapshot, 'slot_lost', {
        trigger: 'system',
        allowedSourceStatuses: allowed,
      });
    })();
    const d6OwnerDriver = (async () => {
      await startTogether();
      return requestDepositRefund({
        depositId: seeded.depositId,
        salonId: SALON_ID,
        actor: ownerActor(),
      });
    })();
    const operations = [d5PollDriver, d6OwnerDriver];

    await releaseAfterBlocked(held, 2, operations);
    await Promise.all(operations);
    const rows = await intentRows(seeded.depositId);

    // Mutant (d): splitting the shared intent-opening CAS admits both namespaces.
    expect(rows).toHaveLength(1);
    expect(new Set(rows.map(row => row.type))).toHaveLength(1);
    expect(mocks.refundsCreate).toHaveBeenCalledTimes(1);

    executedTests += 1;
  }, 30_000);

  it('T18(b)(i) NEGATIVE CONTROL: opposing raw row-lock order produces exactly one 40P01', async () => {
    const seeded = await seedDeposit({ suffix: 't18_negative', status: 'paid' });
    const firstLocksReady = createBarrier(2);
    const retryableErrors: string[] = [];

    const runOpposing = async (first: 'appointment' | 'deposit') => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL deadlock_timeout = \'100ms\'');
        await client.query('SET LOCAL statement_timeout = \'5s\'');
        if (first === 'appointment') {
          await client.query('SELECT id FROM appointment WHERE id = $1 FOR UPDATE', [seeded.appointmentId]);
        } else {
          await client.query('SELECT id FROM appointment_deposit WHERE id = $1 FOR UPDATE', [seeded.depositId]);
        }
        await firstLocksReady();
        if (first === 'appointment') {
          await client.query('SELECT id FROM appointment_deposit WHERE id = $1 FOR UPDATE', [seeded.depositId]);
        } else {
          await client.query('SELECT id FROM appointment WHERE id = $1 FOR UPDATE', [seeded.appointmentId]);
        }
        await client.query('COMMIT');
      } catch (error) {
        const code = databaseErrorCode(error);
        if (code) {
          retryableErrors.push(code);
        }
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };

    const results = await Promise.allSettled([
      runOpposing('appointment'),
      runOpposing('deposit'),
    ]);

    // This leg proves the harness discriminates; "at least one" is forbidden.
    expect(retryableErrors.filter(code => code === '40P01')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);

    executedTests += 1;
  }, 30_000);

  it('T18(b)(ii): production refund observation and confirmation use canonical order with zero 40P01', async () => {
    const seeded = await seedDeposit({
      suffix: 't18_production',
      status: 'checkout_created',
      refundStatus: 'requested',
      refundTrigger: 'owner',
    });
    const snapshot = await loadDeposit(seeded.depositId);
    const held = await holdAppointmentRow(seeded.appointmentId);
    const startTogether = createBarrier(2);
    const observationMayQueue = createDeferred();
    const retryableErrors: string[] = [];

    const confirmation = captureDatabaseErrors(async () => {
      await startTogether();
      return confirmDepositPayment(paidEvidence(seeded));
    }, retryableErrors);
    const observation = captureDatabaseErrors(async () => {
      await startTogether();
      await observationMayQueue.promise;
      return applyRefundObservation({
        deposit: snapshot,
        refund: {
          id: `re_${seeded.depositId}_t18`,
          status: 'succeeded',
          amount: snapshot.amountCents,
          currency: snapshot.currency,
          metadata: { luster_deposit_id: snapshot.id },
          payment_intent: snapshot.stripePaymentIntentId,
        },
        origin: 'reconciler',
      });
    }, retryableErrors);
    const operations = [confirmation, observation];

    // The shared barrier starts both real production operations. Then the
    // external appointment lock lets us observe confirmation in PostgreSQL's
    // lock queue before admitting the observation, making the intended
    // canonical-order interleaving deterministic rather than scheduler luck.
    await waitForBlockedSessions(1, held.pid);
    observationMayQueue.resolve();
    await releaseAfterBlocked(held, 2, operations);
    const [confirmed, observed] = await Promise.all(operations);
    const audits = await db
      .select({ action: schema.appointmentAuditLogSchema.action })
      .from(schema.appointmentAuditLogSchema)
      .where(eq(schema.appointmentAuditLogSchema.appointmentId, seeded.appointmentId));
    const finalDeposit = await loadDeposit(seeded.depositId);

    expect(retryableErrors.filter(code => code === '40P01')).toHaveLength(0);
    expect(confirmed).toMatchObject({ disposition: 'healed_deposit' });
    expect(observed).toMatchObject({ applied: true });
    expect(audits.filter(row => row.action === 'payment_status_changed')).toHaveLength(1);
    expect(audits.filter(row => row.action === 'deposit_refund_succeeded')).toHaveLength(1);
    expect(finalDeposit).toMatchObject({ status: 'refunded', refundStatus: 'succeeded' });

    executedTests += 1;
  }, 30_000);

  it('D6.1: completion returns a clean retry conflict while tax settings are locked, then re-quotes the committed rate', async () => {
    const appointmentId = 'appt_d6_1_completion_settings_lock';
    const startTime = new Date('2099-11-15T15:00:00.000Z');
    await db.update(schema.salonSchema).set({
      settings: { payments: { tax: { enabled: true, name: 'HST', rateBps: 1300 } } },
    }).where(eq(schema.salonSchema.id, SALON_ID));
    await db.insert(schema.appointmentSchema).values({
      id: appointmentId,
      salonId: SALON_ID,
      technicianId: TECH_ID,
      clientPhone: '4165556161',
      clientName: 'D6.1 Completion Concurrency',
      startTime,
      endTime: new Date(startTime.getTime() + 60 * 60_000),
      status: 'confirmed',
      totalPrice: 10_000,
      totalDurationMinutes: 60,
      invoiceCurrency: 'CAD',
    });

    const settingsWriter = await pool.connect();
    try {
      await settingsWriter.query('BEGIN');
      await settingsWriter.query(
        'UPDATE salon SET settings = $2::jsonb WHERE id = $1',
        [
          SALON_ID,
          JSON.stringify({
            payments: { tax: { enabled: true, name: 'HST', rateBps: 1500 } },
          }),
        ],
      );

      const busy = await completeAppointment(
        new Request(`http://localhost/api/appointments/${appointmentId}/complete`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skipPhotoValidation: true,
            expectedTotalDueCents: 11_300,
          }),
        }),
        { params: { id: appointmentId } },
      );

      expect(busy.status).toBe(409);
      await expect(busy.json()).resolves.toMatchObject({
        error: { code: 'TAX_CONFIGURATION_BUSY' },
      });
      expect((await db.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, appointmentId)))[0]).toMatchObject({
        status: 'confirmed',
        finalTaxSnapshot: null,
      });

      await settingsWriter.query('COMMIT');
    } finally {
      await settingsWriter.query('ROLLBACK').catch(() => undefined);
      settingsWriter.release();
    }

    const reQuote = await completeAppointment(
      new Request(`http://localhost/api/appointments/${appointmentId}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skipPhotoValidation: true,
          expectedTotalDueCents: 11_300,
        }),
      }),
      { params: { id: appointmentId } },
    );

    expect(reQuote.status).toBe(409);
    await expect(reQuote.json()).resolves.toMatchObject({
      error: {
        code: 'TOTALS_MISMATCH',
        details: { totals: { taxAmountCents: 1500, totalDueCents: 11_500 } },
      },
    });

    executedTests += 1;
  }, 30_000);

  it('D6.1: forfeiture rolls back a NOWAIT conflict and freezes only the subsequently committed tax identity', async () => {
    await db.update(schema.salonSchema).set({
      settings: {
        payments: {
          tax: {
            enabled: true,
            name: 'HST',
            rateBps: 1300,
            forfeitureTaxEstimationEnabled: true,
            country: 'CA',
            region: 'ON',
          },
        },
      },
    }).where(eq(schema.salonSchema.id, SALON_ID));
    const seeded = await seedDeposit({ suffix: 'd6_1_forfeiture_settings_lock', status: 'paid' });
    await db.update(schema.appointmentSchema).set({
      status: 'no_show',
      invoiceCurrency: 'CAD',
    }).where(eq(schema.appointmentSchema.id, seeded.appointmentId));
    const forfeitedAt = new Date('2099-11-15T16:00:00.000Z');

    const settingsWriter = await pool.connect();
    try {
      await settingsWriter.query('BEGIN');
      await settingsWriter.query(
        'UPDATE salon SET settings = $2::jsonb WHERE id = $1',
        [
          SALON_ID,
          JSON.stringify({
            payments: {
              tax: {
                enabled: true,
                name: 'HST',
                rateBps: 1500,
                forfeitureTaxEstimationEnabled: true,
                country: 'CA',
                region: 'ON',
              },
            },
          }),
        ],
      );

      const blockedForfeiture = db.transaction(async (tx) => {
        await tx.select().from(schema.appointmentSchema)
          .where(eq(schema.appointmentSchema.id, seeded.appointmentId))
          .for('update')
          .limit(1);
        return forfeitAppointmentDepositInTx({
          tx,
          salonId: SALON_ID,
          appointmentId: seeded.appointmentId,
          invoiceCurrency: 'CAD',
          forfeitedAt,
          appointmentLockHeld: true,
        });
      });

      await expect(blockedForfeiture).rejects.toMatchObject({
        code: 'DEPOSIT_RECONCILIATION_REQUIRED',
        detail: expect.stringContaining('financial settings are being updated'),
      });
      expect(await loadDeposit(seeded.depositId)).toMatchObject({
        forfeitedAt: null,
        forfeitureTaxSnapshot: null,
      });

      await settingsWriter.query('COMMIT');
    } finally {
      await settingsWriter.query('ROLLBACK').catch(() => undefined);
      settingsWriter.release();
    }

    await expect(db.transaction(async (tx) => {
      await tx.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, seeded.appointmentId))
        .for('update')
        .limit(1);
      return forfeitAppointmentDepositInTx({
        tx,
        salonId: SALON_ID,
        appointmentId: seeded.appointmentId,
        invoiceCurrency: 'CAD',
        forfeitedAt,
        appointmentLockHeld: true,
      });
    })).resolves.toMatchObject({ disposition: 'forfeited', forfeitedCents: 2500 });
    expect(await loadDeposit(seeded.depositId)).toMatchObject({
      forfeitedAt,
      forfeitureTaxSnapshot: {
        taxEstimateApplied: true,
        configuration: { rateBps: 1500 },
      },
    });

    executedTests += 1;
  }, 30_000);
});

async function seedBase(): Promise<void> {
  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'D6 Refund Concurrency Salon',
    slug: SALON_SLUG,
    ownerEmail: 'owner.d6.refund@example.invalid',
    isActive: true,
    status: 'active',
    publicationStatus: 'published',
    freeSoloEnabled: false,
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'D6 Refund Concurrency Technician',
    isActive: true,
  });
  await db.insert(schema.salonStripeAccountSchema).values({
    id: 'ssa_d6_refund_concurrency',
    salonId: SALON_ID,
    stripeAccountId: ACCOUNT_ID,
    livemode: false,
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    requirementsDue: {},
    disabledReason: null,
    lastSyncedAt: new Date(),
  });
}

async function seedDeposit(input: {
  suffix: string;
  status: 'checkout_created' | 'paid' | 'expired' | 'canceled' | 'waived';
  refundStatus?: 'requested' | null;
  refundTrigger?: 'owner' | 'system_late_payment' | 'external' | null;
}) {
  const appointmentId = `appt_d6_${input.suffix}`;
  const depositId = `dep_d6_${input.suffix}`;
  const sessionId = `cs_d6_${input.suffix}`;
  const now = new Date();
  seedOrdinal += 1;
  const startTime = new Date(
    new Date('2099-09-15T15:00:00.000Z').getTime() + seedOrdinal * 2 * 60 * 60_000,
  );
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: '4165556060',
    clientEmail: 'payer.d6.refund@example.invalid',
    clientName: 'D6 Refund Payer',
    startTime,
    endTime: new Date(startTime.getTime() + 60 * 60_000),
    status: 'pending',
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
    status: input.status,
    stripeAccountId: ACCOUNT_ID,
    stripeCheckoutSessionId: sessionId,
    stripePaymentIntentId: `pi_d6_${input.suffix}`,
    refundStatus: input.refundStatus ?? null,
    refundStatusChangedAt: input.refundStatus ? now : null,
    refundRequestedAt: input.refundStatus ? now : null,
    refundRequestedBy: input.refundStatus ? OWNER_ID : null,
    refundRequestedByRole: input.refundStatus ? 'admin' : null,
    refundTrigger: input.refundTrigger ?? null,
  });
  return { appointmentId, depositId, sessionId };
}

async function loadDeposit(depositId: string): Promise<DepositRow> {
  const [deposit] = await db
    .select()
    .from(schema.appointmentDepositSchema)
    .where(and(
      eq(schema.appointmentDepositSchema.id, depositId),
      eq(schema.appointmentDepositSchema.salonId, SALON_ID),
    ))
    .limit(1);
  if (!deposit) {
    throw new Error(`Missing D6 concurrency deposit ${depositId}.`);
  }
  return deposit;
}

function ownerActor() {
  return {
    recordedByType: 'admin' as const,
    recordedById: OWNER_ID,
    recordedByName: 'D6 Refund Owner',
    performedBy: OWNER_ID,
    performedByRole: 'admin' as const,
    performedByName: 'D6 Refund Owner',
    requestedBy: OWNER_ID,
    requestedByRole: 'admin' as const,
    requestedByImpersonated: false,
    impersonated: false,
    superAdminUserId: null,
    impersonatedSalonId: null,
  };
}

function paidEvidence(input: { appointmentId: string; depositId: string; sessionId: string }) {
  return {
    source: 'webhook' as const,
    connectedAccountId: ACCOUNT_ID,
    sessionId: input.sessionId,
    paymentIntentId: `pi_d6_${input.depositId.replace(/^dep_d6_/, '')}`,
    paymentStatus: 'paid',
    amountTotal: 2500,
    currency: 'cad',
    metadataAppointmentId: input.appointmentId,
    metadataSalonId: SALON_ID,
    metadataDepositId: input.depositId,
  };
}

async function intentRows(depositId: string) {
  return db
    .select({
      id: schema.stripeWebhookEventSchema.id,
      type: schema.stripeWebhookEventSchema.type,
      status: schema.stripeWebhookEventSchema.status,
      attempts: schema.stripeWebhookEventSchema.attempts,
    })
    .from(schema.stripeWebhookEventSchema)
    .where(and(
      eq(schema.stripeWebhookEventSchema.metadataDepositId, depositId),
      sql`${schema.stripeWebhookEventSchema.type} LIKE 'luster.%refund_intent'`,
    ));
}

function assertSnapshotAccount(options: { stripeAccount?: string }): void {
  expect(options.stripeAccount).toBe(ACCOUNT_ID);
}

type Deferred = { promise: Promise<void>; resolve: () => void };

function createDeferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createBarrier(participants: number): () => Promise<void> {
  const released = createDeferred();
  let arrivals = 0;

  return async () => {
    arrivals += 1;
    if (arrivals === participants) {
      released.resolve();
    }
    await released.promise;
  };
}

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }
  return candidate.cause === error ? null : databaseErrorCode(candidate.cause);
}

async function captureDatabaseErrors<T>(
  operation: () => Promise<T>,
  retryableErrors: string[],
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = databaseErrorCode(error);
    if (code) {
      retryableErrors.push(code);
    }
    throw error;
  }
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

async function holdAppointmentRow(appointmentId: string): Promise<HeldLock> {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('SELECT id FROM appointment WHERE id = $1 FOR UPDATE', [appointmentId]);
    return await registerHeldLock(connection);
  } catch (error) {
    await connection.query('ROLLBACK');
    connection.release();
    throw error;
  }
}

async function holdDepositRow(depositId: string): Promise<HeldLock> {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('SELECT id FROM appointment_deposit WHERE id = $1 FOR UPDATE', [depositId]);
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

async function dropTestObjects(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(`
    DROP TABLE IF EXISTS d6_refund_concurrency_marker;
  `);
}
