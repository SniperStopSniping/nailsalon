import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
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

const provider = vi.hoisted(() => ({
  expire: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock('@/libs/depositCheckout', async () => {
  const actual = await vi.importActual<typeof import('@/libs/depositCheckout')>(
    '@/libs/depositCheckout',
  );
  return {
    ...actual,
    getDepositStripeClient: () => ({
      checkout: { sessions: { expire: provider.expire, retrieve: provider.retrieve } },
    }),
  };
});

vi.mock('@/libs/bookingCommitEffects', () => ({
  mintAppointmentManageCapability: vi.fn(async () => ({
    token: 'manage_test_token',
    tokenHash: 'manage_test_hash',
    expiresAt: new Date('2026-09-14T00:00:00.000Z'),
  })),
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueClientStatsRefreshInTx: vi.fn(async () => undefined),
  enqueueDepositConfirmationSideEffects: vi.fn(async () => undefined),
  enqueueDepositRefundAlertInTx: vi.fn(async () => undefined),
  enqueueDepositRefundNotices: vi.fn(async () => undefined),
  enqueueGoogleCalendarDeleteInTx: vi.fn(async () => undefined),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const runtimeEnvironment = vi.hoisted(() => ({ current: 'test' }));
vi.mock('@/libs/environmentIsolation', () => ({
  resolveRuntimeEnvironment: () => runtimeEnvironment.current,
}));

const refundCore = vi.hoisted(() => ({
  create: vi.fn(),
  discover: vi.fn(),
}));
vi.mock('./depositRefund', () => ({
  PARTIAL_REFUND_OBSERVED_NOTE: 'partial_refund_observed',
  createOrAdoptDepositRefund: refundCore.create,
  discoverAndAdoptDepositRefunds: refundCore.discover,
  resolveAllowedSourceStatuses: () => ['paid', 'refunded'],
}));

const {
  applyRefundObservation,
  claimRefundReconcileLease,
  DEPOSIT_HEALTH_COUNTER_KEYS,
  incrementRefundReconcileAttempts,
  loadDepositHealth,
  openSystemRefundIntent,
  releaseHold,
  requestDepositRefund,
  retryFailedDepositRefund,
  stampDepositRefund,
  waiveDeposit,
} = await import('./depositLifecycle');
const { claimWebhookEvent, finalizeTerminal } = await import('@/libs/stripeConnect/webhookEvents');

const AMOUNT = 2500;
const NOW = new Date('2026-08-14T12:00:00.000Z');
const EXPECTED_COUNTER_KEYS = [
  'paidDeposits',
  'staleHolds',
  'refundIntentsStuck',
  'refundsPendingOver7d',
  'refundsFailedRetryable',
  'refundsAbandoned',
  'paidOnDeadAppointment',
  'externalPartialRefunds',
  'refundConflicts',
  'moneyOnWaivedOrReleased',
  'depositsAccountDisconnected',
  'refundedWithoutRefundStatus',
  'webhookManualTerminals',
  'webhookLateRefundCriticals',
  'envMismatchSkipped',
  'refundBoundWithoutRefundedStatus',
  'depositsAccountRebound',
] as const;

const actor = {
  recordedByType: 'admin' as const,
  recordedById: 'admin_health',
  recordedByName: 'Health Admin',
  performedBy: 'admin_health',
  performedByRole: 'admin' as const,
  performedByName: 'Health Admin',
  requestedBy: 'admin_health',
  requestedByRole: 'admin' as const,
  requestedByImpersonated: false,
  impersonated: false,
  superAdminUserId: null,
  impersonatedSalonId: null,
};

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let seq = 0;

async function seedSalon(input: {
  id?: string;
  account?: string;
  name?: string;
} = {}) {
  seq += 1;
  const id = input.id ?? `salon_health_${seq}`;
  const account = input.account ?? `acct_health_${seq}`;
  await db.insert(schema.salonSchema).values({
    id,
    name: input.name ?? `Health Salon ${seq}`,
    slug: `${id.replaceAll('_', '-')}-${seq}`,
    ownerEmail: `${id}-${seq}@example.com`,
  });
  await db.insert(schema.salonStripeAccountSchema).values({
    id: `sacct_health_${seq}`,
    salonId: id,
    stripeAccountId: account,
    livemode: false,
  });
  return { id, account };
}

async function seedDeposit(input: {
  salonId: string;
  account: string;
  status?: string;
  appointmentStatus?: string;
  paymentIntentId?: string | null;
  holdExpiresAt?: Date | null;
  createdAt?: Date;
}) {
  seq += 1;
  const appointmentId = `appt_health_${seq}`;
  const depositId = `dep_health_${seq}`;
  const startTime = new Date(NOW.getTime() + seq * 3_600_000);
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId: input.salonId,
    clientPhone: `416555${String(seq).padStart(4, '0')}`,
    clientName: 'Health Client',
    startTime,
    endTime: new Date(startTime.getTime() + 3_600_000),
    status: input.appointmentStatus ?? 'confirmed',
    totalPrice: 9000,
    totalDurationMinutes: 60,
    depositHoldExpiresAt: input.holdExpiresAt,
  });
  await db.insert(schema.appointmentDepositSchema).values({
    id: depositId,
    salonId: input.salonId,
    appointmentId,
    amountCents: AMOUNT,
    status: input.status ?? 'paid',
    stripeAccountId: input.account,
    stripeCheckoutSessionId: `cs_health_${seq}`,
    stripePaymentIntentId: input.paymentIntentId === undefined
      ? `pi_health_${seq}`
      : input.paymentIntentId,
    ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
  });
  return { appointmentId, depositId };
}

async function readDeposit(id: string) {
  const [row] = await db
    .select()
    .from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, id));
  if (!row) {
    throw new Error(`Missing deposit fixture: ${id}`);
  }
  return row;
}

async function readStoredEvent(eventId: string) {
  const [row] = await db
    .select()
    .from(schema.stripeWebhookEventSchema)
    .where(eq(schema.stripeWebhookEventSchema.eventId, eventId));
  if (!row) {
    throw new Error(`Missing webhook event fixture: ${eventId}`);
  }
  return row;
}

async function driveEvent(
  outcome: 'poisoned' | 'refund_failed_unreconciled' | 'already_confirmed_late_refund',
  salonId: string | null,
  input: { type?: string; paymentIntentId?: string; account?: string } = {},
) {
  seq += 1;
  const eventId = `evt_health_${seq}`;
  const account = input.account ?? `acct_event_${seq}`;
  const claim = await claimWebhookEvent({
    eventId,
    type: input.type ?? 'checkout.session.completed',
    account,
    livemode: false,
    salonId,
    ...(input.paymentIntentId
      ? {
          projection: {
            sessionId: null,
            paymentIntentId: input.paymentIntentId,
            paymentStatus: null,
            amountTotal: null,
            currency: null,
            metadataAppointmentId: null,
            metadataSalonId: null,
            metadataDepositId: null,
            clientReferenceId: null,
            projectionStatus: 'ok' as const,
            rawPayload: null,
            payloadPurgeAfter: null,
          },
        }
      : {}),
  });
  if (!claim.claimed) {
    throw new Error('Expected a fresh webhook claim');
  }
  await finalizeTerminal({
    id: claim.id,
    attempts: claim.attempts,
    outcome,
  });
  return { eventId, account };
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
  runtimeEnvironment.current = 'test';
  provider.expire.mockResolvedValue({ id: 'cs_expired', status: 'expired' });
  provider.retrieve.mockResolvedValue({ id: 'cs_expired', status: 'expired' });
  refundCore.create.mockImplementation(async (deposit: { id: string }) => ({
    disposition: 'noop',
    depositId: deposit.id,
    note: 'provider_retryable',
  }));
  refundCore.discover.mockImplementation(async (deposit: { id: string }) => ({
    disposition: 'noop',
    depositId: deposit.id,
    note: 'no_adoptable_refund',
  }));

  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.appointmentAccessTokenSchema);
  await db.delete(schema.stripeWebhookEventSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.salonSchema);
});

describe('T29 deposit health contract', () => {
  it('returns the exact top-level and 17-counter shape with both retired keys absent', async () => {
    const payload = await loadDepositHealth(null);

    expect(Object.keys(payload).sort()).toEqual([
      'generatedAt',
      'lastReconcileObservedAt',
      'salons',
      'salonsOmitted',
      'sentryDsnConfigured',
      'totals',
      'unattributed',
    ]);
    expect(DEPOSIT_HEALTH_COUNTER_KEYS).toEqual(EXPECTED_COUNTER_KEYS);
    expect(Object.keys(payload.totals)).toEqual(EXPECTED_COUNTER_KEYS);
    expect(payload.totals).not.toHaveProperty('sessionExpirePending');
    expect(payload.totals).not.toHaveProperty('salonsAccountUnusable');
    expect(payload).not.toHaveProperty('sentryEnabled');
    expect(typeof payload.sentryDsnConfigured).toBe('boolean');
    expect(payload.lastReconcileObservedAt).toBeNull();
    expect(payload.salons).toEqual([]);
    expect(payload.salonsOmitted).toBe(0);
    expect(Object.values(payload.totals).every(value => value === 0)).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/acct_|pi_|re_|cs_/);
  });

  it('reports DSN presence without claiming Sentry initialization', async () => {
    const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    try {
      process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@example.invalid/1';

      expect((await loadDepositHealth(null)).sentryDsnConfigured).toBe(true);

      delete process.env.NEXT_PUBLIC_SENTRY_DSN;

      expect((await loadDepositHealth(null)).sentryDsnConfigured).toBe(false);
    } finally {
      if (originalDsn === undefined) {
        delete process.env.NEXT_PUBLIC_SENTRY_DSN;
      } else {
        process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
      }
    }
  });

  it('counts unattributed manual and late-critical events exactly once and only cross-salon', async () => {
    const salon = await seedSalon();
    await driveEvent('poisoned', null);
    await driveEvent('already_confirmed_late_refund', null);

    const crossSalon = await loadDepositHealth(null);
    const salonScoped = await loadDepositHealth(salon.id);

    expect(crossSalon.unattributed).toEqual({
      webhookManualTerminals: 1,
      webhookLateRefundCriticals: 1,
    });
    expect(crossSalon.totals.webhookManualTerminals).toBe(1);
    expect(crossSalon.totals.webhookLateRefundCriticals).toBe(1);
    expect(crossSalon.salons).toEqual([]);
    expect(salonScoped.unattributed).toEqual({
      webhookManualTerminals: 0,
      webhookLateRefundCriticals: 0,
    });
    expect(salonScoped.totals.webhookManualTerminals).toBe(0);
    expect(salonScoped.totals.webhookLateRefundCriticals).toBe(0);
  });

  it('excludes Luster work rows and manual events whose retained payment is reconciled', async () => {
    const salon = await seedSalon();
    const fixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
      paymentIntentId: 'pi_health_reconciled',
    });
    await applyRefundObservation({
      deposit: await readDeposit(fixture.depositId),
      refund: {
        id: 're_health_reconciled',
        status: 'succeeded',
        amount: AMOUNT,
        currency: 'cad',
        metadata: {},
      },
      origin: 'external',
    });
    await driveEvent('refund_failed_unreconciled', null, {
      type: 'refund.failed',
      paymentIntentId: 'pi_health_reconciled',
    });
    await driveEvent('poisoned', salon.id, {
      type: 'luster.owner_refund_intent',
    });

    const reconciled = await loadDepositHealth(null);

    expect(reconciled.totals.webhookManualTerminals).toBe(0);
    expect(reconciled.unattributed.webhookManualTerminals).toBe(0);

    await driveEvent('refund_failed_unreconciled', null, {
      type: 'refund.failed',
      paymentIntentId: 'pi_health_unresolved',
    });
    const unresolved = await loadDepositHealth(null);

    expect(unresolved.totals.webhookManualTerminals).toBe(1);
    expect(unresolved.unattributed.webhookManualTerminals).toBe(1);
  });

  it('keeps an all-null historical terminal latched while an AMD-1-shaped terminal clears', async () => {
    const historicalSalon = await seedSalon({ account: 'acct_health_historical' });
    const retainedSalon = await seedSalon({ account: 'acct_health_amd_1' });
    const historicalFixture = await seedDeposit({
      salonId: historicalSalon.id,
      account: historicalSalon.account,
      paymentIntentId: 'pi_health_historical',
    });
    const retainedFixture = await seedDeposit({
      salonId: retainedSalon.id,
      account: retainedSalon.account,
      paymentIntentId: 'pi_health_retained',
    });

    const historicalRequest = await requestDepositRefund({
      depositId: historicalFixture.depositId,
      salonId: historicalSalon.id,
      actor,
    });
    const retainedRequest = await requestDepositRefund({
      depositId: retainedFixture.depositId,
      salonId: retainedSalon.id,
      actor,
    });

    expect(historicalRequest.ok).toBe(true);
    expect(retainedRequest.ok).toBe(true);

    const historicalDepositBeforeClaim = await readDeposit(historicalFixture.depositId);
    const historicalEvent = await driveEvent('refund_failed_unreconciled', null, {
      type: 'refund.failed',
      account: historicalSalon.account,
    });
    const retainedEvent = await driveEvent('refund_failed_unreconciled', null, {
      type: 'refund.failed',
      account: retainedSalon.account,
      paymentIntentId: 'pi_health_retained',
    });

    expect(await readDeposit(historicalFixture.depositId)).toEqual(historicalDepositBeforeClaim);
    expect((await loadDepositHealth(null)).unattributed.webhookManualTerminals).toBe(2);

    const historicalStoredBefore = await readStoredEvent(historicalEvent.eventId);
    const historicalEventSnapshot = {
      status: historicalStoredBefore.status,
      outcome: historicalStoredBefore.outcome,
      sessionId: historicalStoredBefore.sessionId,
      paymentIntentId: historicalStoredBefore.paymentIntentId,
      paymentStatus: historicalStoredBefore.paymentStatus,
      amountTotal: historicalStoredBefore.amountTotal,
      currency: historicalStoredBefore.currency,
      metadataAppointmentId: historicalStoredBefore.metadataAppointmentId,
      metadataSalonId: historicalStoredBefore.metadataSalonId,
      metadataDepositId: historicalStoredBefore.metadataDepositId,
      clientReferenceId: historicalStoredBefore.clientReferenceId,
      projectionStatus: historicalStoredBefore.projectionStatus,
      rawPayload: historicalStoredBefore.rawPayload,
      payloadPurgeAfter: historicalStoredBefore.payloadPurgeAfter,
    };

    expect(historicalEventSnapshot).toEqual({
      status: 'processed',
      outcome: 'refund_failed_unreconciled',
      sessionId: null,
      paymentIntentId: null,
      paymentStatus: null,
      amountTotal: null,
      currency: null,
      metadataAppointmentId: null,
      metadataSalonId: null,
      metadataDepositId: null,
      clientReferenceId: null,
      projectionStatus: null,
      rawPayload: null,
      payloadPurgeAfter: null,
    });
    expect((await readStoredEvent(retainedEvent.eventId)).paymentIntentId)
      .toBe('pi_health_retained');

    const historicalFailure = await applyRefundObservation({
      deposit: await readDeposit(historicalFixture.depositId),
      refund: null,
      origin: 'create_refused',
      errorCode: { code: 'future_terminal_code' },
    });
    const retainedFailure = await applyRefundObservation({
      deposit: await readDeposit(retainedFixture.depositId),
      refund: null,
      origin: 'create_refused',
      errorCode: { code: 'future_terminal_code' },
    });

    expect(historicalFailure.applied).toBe(true);
    expect(retainedFailure.applied).toBe(true);

    const historicalDepositAtTerminal = await readDeposit(historicalFixture.depositId);
    const retainedDepositAtTerminal = await readDeposit(retainedFixture.depositId);
    const historicalAccountRowsBeforeHealth = await db
      .select()
      .from(schema.appointmentDepositSchema)
      .where(eq(schema.appointmentDepositSchema.stripeAccountId, historicalSalon.account));
    const afterTerminal = await loadDepositHealth(null);
    const historicalStoredAfter = await readStoredEvent(historicalEvent.eventId);
    const historicalAccountRowsAfterHealth = await db
      .select()
      .from(schema.appointmentDepositSchema)
      .where(eq(schema.appointmentDepositSchema.stripeAccountId, historicalSalon.account));

    expect(afterTerminal.unattributed.webhookManualTerminals).toBe(1);
    expect(historicalDepositAtTerminal.refundStatus).toBe('failed');
    expect(historicalDepositAtTerminal.stripeRefundId).toBeNull();
    expect(retainedDepositAtTerminal.refundStatus).toBe('failed');
    expect(retainedDepositAtTerminal.stripeRefundId).toBeNull();
    expect(historicalAccountRowsBeforeHealth).toHaveLength(1);
    expect(historicalAccountRowsAfterHealth).toEqual(historicalAccountRowsBeforeHealth);
    expect({
      status: historicalStoredAfter.status,
      outcome: historicalStoredAfter.outcome,
      sessionId: historicalStoredAfter.sessionId,
      paymentIntentId: historicalStoredAfter.paymentIntentId,
      paymentStatus: historicalStoredAfter.paymentStatus,
      amountTotal: historicalStoredAfter.amountTotal,
      currency: historicalStoredAfter.currency,
      metadataAppointmentId: historicalStoredAfter.metadataAppointmentId,
      metadataSalonId: historicalStoredAfter.metadataSalonId,
      metadataDepositId: historicalStoredAfter.metadataDepositId,
      clientReferenceId: historicalStoredAfter.clientReferenceId,
      projectionStatus: historicalStoredAfter.projectionStatus,
      rawPayload: historicalStoredAfter.rawPayload,
      payloadPurgeAfter: historicalStoredAfter.payloadPurgeAfter,
    }).toEqual(historicalEventSnapshot);
  });

  it('drives pending, failed, abandoned, partial, and disconnected states into their counters', async () => {
    const salon = await seedSalon();

    const pendingFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
    });
    const pendingSource = await readDeposit(pendingFixture.depositId);
    const pendingTransition = await applyRefundObservation({
      deposit: pendingSource,
      refund: {
        id: 're_health_pending',
        status: 'pending',
        amount: AMOUNT,
        currency: 'cad',
        metadata: {},
      },
      origin: 'external',
    });

    expect(pendingTransition.applied).toBe(true);

    const agedPendingAt = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    await db
      .update(schema.appointmentDepositSchema)
      .set({ refundStatusChangedAt: agedPendingAt })
      .where(eq(schema.appointmentDepositSchema.id, pendingFixture.depositId));
    const agedPending = await readDeposit(pendingFixture.depositId);
    const duplicatePending = await applyRefundObservation({
      deposit: agedPending,
      refund: {
        id: 're_health_pending',
        status: 'pending',
        amount: AMOUNT,
        currency: 'cad',
        metadata: {},
      },
      origin: 'reconciler',
    });

    expect(duplicatePending.applied).toBe(false);
    expect((await readDeposit(pendingFixture.depositId)).refundStatusChangedAt)
      .toEqual(agedPendingAt);

    const failedFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
    });
    const failedSource = await readDeposit(failedFixture.depositId);
    await applyRefundObservation({
      deposit: failedSource,
      refund: {
        id: 're_health_failed',
        status: 'pending',
        amount: AMOUNT,
        currency: 'cad',
        metadata: {},
      },
      origin: 'external',
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await incrementRefundReconcileAttempts(await readDeposit(failedFixture.depositId));
    }
    await applyRefundObservation({
      deposit: await readDeposit(failedFixture.depositId),
      refund: {
        id: 're_health_failed',
        status: 'failed',
        amount: AMOUNT,
        currency: 'cad',
        failure_reason: 'declined',
        metadata: {},
      },
      origin: 'webhook',
    });

    const abandonedFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
      status: 'canceled',
      appointmentStatus: 'cancelled',
    });
    const opened = await openSystemRefundIntent(
      await readDeposit(abandonedFixture.depositId),
      ['canceled'],
    );

    expect(opened).not.toBeNull();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await incrementRefundReconcileAttempts(await readDeposit(abandonedFixture.depositId));
    }

    const partialFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
    });
    await applyRefundObservation({
      deposit: await readDeposit(partialFixture.depositId),
      refund: {
        id: 're_health_partial',
        status: 'succeeded',
        amount: AMOUNT - 500,
        currency: 'cad',
        metadata: {},
      },
      origin: 'external',
    });

    const disconnectedFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
      status: 'canceled',
      appointmentStatus: 'cancelled',
    });
    const disconnectedIntent = await openSystemRefundIntent(
      await readDeposit(disconnectedFixture.depositId),
      ['canceled'],
    );
    if (!disconnectedIntent) {
      throw new Error('Expected disconnected intent to open');
    }
    await applyRefundObservation({
      deposit: disconnectedIntent,
      refund: null,
      origin: 'account_preflight',
      accountRefusal: 'ACCOUNT_DISCONNECTED',
    });

    const epochFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
    });

    expect(await requestDepositRefund({
      depositId: epochFixture.depositId,
      salonId: salon.id,
      actor,
    })).toMatchObject({ ok: true });

    for (let epoch = 2; epoch <= 4; epoch += 1) {
      await db
        .update(schema.appointmentDepositSchema)
        .set({ refundStatusChangedAt: new Date(Date.now() - 2 * 60 * 60_000) })
        .where(eq(schema.appointmentDepositSchema.id, epochFixture.depositId));

      expect(await retryFailedDepositRefund({
        depositId: epochFixture.depositId,
        salonId: salon.id,
        actor,
      })).toMatchObject({ ok: true });
      expect((await readDeposit(epochFixture.depositId)).refundKeyEpoch).toBe(epoch);
    }
    await applyRefundObservation({
      deposit: await readDeposit(epochFixture.depositId),
      refund: null,
      origin: 'create_refused',
      errorCode: { code: 'future_terminal_code' },
    });

    const payload = await loadDepositHealth(salon.id);

    expect(payload.totals.refundsPendingOver7d).toBe(1);
    expect(payload.totals.refundsFailedRetryable).toBe(1);
    expect(payload.totals.refundsAbandoned).toBe(2);
    expect(payload.totals.externalPartialRefunds).toBe(1);
    expect(payload.totals.depositsAccountDisconnected).toBe(1);
    expect(payload.totals.envMismatchSkipped).toBe(0);
    expect(payload.lastReconcileObservedAt).toBeNull();
    expect(payload.salons).toHaveLength(1);
    expect(payload.salons[0]?.salonId).toBe(salon.id);
    expect(Object.keys(payload.salons[0]?.counters ?? {})).toEqual(EXPECTED_COUNTER_KEYS);

    refundCore.create.mockClear();

    expect(await retryFailedDepositRefund({
      depositId: epochFixture.depositId,
      salonId: salon.id,
      actor,
    })).toMatchObject({ ok: false, code: 'DEPOSIT_NOT_REFUNDABLE' });
    expect(refundCore.create).not.toHaveBeenCalled();

    const retry = await retryFailedDepositRefund({
      depositId: failedFixture.depositId,
      salonId: salon.id,
      actor,
    });

    expect(retry.ok).toBe(true);
    expect(refundCore.create).toHaveBeenCalledOnce();
  });

  it('resets a previously spent sweep budget when a new owner intent opens', async () => {
    const salon = await seedSalon();
    const fixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await incrementRefundReconcileAttempts(await readDeposit(fixture.depositId));
    }
    await claimRefundReconcileLease({
      depositId: fixture.depositId,
      salonId: salon.id,
      expectedStatus: null,
    });
    const claimedPayload = await loadDepositHealth(salon.id);

    expect(claimedPayload.lastReconcileObservedAt).not.toBeNull();

    const result = await requestDepositRefund({
      depositId: fixture.depositId,
      salonId: salon.id,
      actor,
    });
    const deposit = await readDeposit(fixture.depositId);
    const payload = await loadDepositHealth(salon.id);

    expect(result.ok).toBe(true);
    expect(deposit.refundStatus).toBe('requested');
    expect(deposit.refundReconcileAttempts).toBe(0);
    expect(deposit.refundReconcileClaimedAt).toBeNull();
    expect(payload.totals.refundsAbandoned).toBe(0);
    expect(payload.lastReconcileObservedAt).toBeNull();
    expect(refundCore.create).toHaveBeenCalledOnce();
  });

  it('counts only explicit environment mismatches and clears a disconnected marker on provider work', async () => {
    const salon = await seedSalon();
    const mismatchFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
      status: 'canceled',
      appointmentStatus: 'cancelled',
    });
    runtimeEnvironment.current = 'preview';
    const mismatchedIntent = await openSystemRefundIntent(
      await readDeposit(mismatchFixture.depositId),
      ['canceled'],
    );

    expect(mismatchedIntent).not.toBeNull();

    const nullEnvironmentFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
    });
    await applyRefundObservation({
      deposit: await readDeposit(nullEnvironmentFixture.depositId),
      refund: {
        id: 're_health_null_environment',
        status: 'pending',
        amount: AMOUNT,
        currency: 'cad',
        metadata: {},
      },
      origin: 'external',
    });

    const disconnectedFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
      status: 'canceled',
      appointmentStatus: 'cancelled',
    });
    runtimeEnvironment.current = 'test';
    const disconnectedIntent = await openSystemRefundIntent(
      await readDeposit(disconnectedFixture.depositId),
      ['canceled'],
    );
    if (!disconnectedIntent) {
      throw new Error('Expected disconnected intent to open');
    }
    await applyRefundObservation({
      deposit: disconnectedIntent,
      refund: null,
      origin: 'account_preflight',
      accountRefusal: 'ACCOUNT_DISCONNECTED',
    });

    const beforeProviderWork = await loadDepositHealth(salon.id);

    expect(beforeProviderWork.totals.envMismatchSkipped).toBe(1);
    expect(beforeProviderWork.totals.depositsAccountDisconnected).toBe(1);

    await incrementRefundReconcileAttempts(await readDeposit(disconnectedFixture.depositId));
    const afterProviderWork = await loadDepositHealth(salon.id);

    expect(afterProviderWork.totals.envMismatchSkipped).toBe(1);
    expect(afterProviderWork.totals.depositsAccountDisconnected).toBe(0);
  });

  it('drives release, conflict, retry clear-down, and account rebound visibility', async () => {
    const salon = await seedSalon({ account: 'acct_health_current' });

    const releaseFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
      status: 'checkout_created',
      appointmentStatus: 'awaiting_payment',
      paymentIntentId: 'pi_health_release_race',
    });
    let finishReleaseExpire!: () => void;
    provider.expire.mockImplementationOnce(() => new Promise((resolve) => {
      finishReleaseExpire = () => resolve({ id: 'cs_release_expired', status: 'expired' });
    }));
    const releasePromise = releaseHold({
      depositId: releaseFixture.depositId,
      salonId: salon.id,
      actor,
      reason: 'client declined deposit',
    });

    await vi.waitFor(() => expect(provider.expire).toHaveBeenCalledTimes(1));

    expect(await readDeposit(releaseFixture.depositId)).toMatchObject({
      status: 'checkout_created',
    });

    finishReleaseExpire();
    const release = await releasePromise;

    expect(release.ok).toBe(true);

    provider.expire.mockClear();
    const waiveSalon = await seedSalon({ account: 'acct_health_waive_order' });
    const waiveFixture = await seedDeposit({
      salonId: waiveSalon.id,
      account: waiveSalon.account,
      status: 'checkout_created',
      appointmentStatus: 'awaiting_payment',
    });
    let finishWaiveExpire!: () => void;
    provider.expire.mockImplementationOnce(() => new Promise((resolve) => {
      finishWaiveExpire = () => resolve({ id: 'cs_waive_expired', status: 'expired' });
    }));
    const waivePromise = waiveDeposit({
      depositId: waiveFixture.depositId,
      salonId: waiveSalon.id,
      actor,
      reason: 'owner waiver',
    });

    await vi.waitFor(() => expect(provider.expire).toHaveBeenCalledTimes(1));

    expect(await readDeposit(waiveFixture.depositId)).toMatchObject({
      status: 'checkout_created',
    });

    finishWaiveExpire();

    expect(await waivePromise).toMatchObject({ ok: true, disposition: 'waived' });

    provider.expire.mockClear();
    for (const operation of ['waive', 'release'] as const) {
      const blockedSalon = await seedSalon({ account: `acct_health_${operation}_deauthorized` });
      const blockedFixture = await seedDeposit({
        salonId: blockedSalon.id,
        account: blockedSalon.account,
        status: 'checkout_created',
        appointmentStatus: 'awaiting_payment',
      });
      await db
        .update(schema.salonStripeAccountSchema)
        .set({ revokedAt: NOW, revocationCause: 'deauthorized' })
        .where(eq(schema.salonStripeAccountSchema.salonId, blockedSalon.id));

      const result = operation === 'waive'
        ? await waiveDeposit({
          depositId: blockedFixture.depositId,
          salonId: blockedSalon.id,
          actor,
          reason: 'blocked waiver',
        })
        : await releaseHold({
          depositId: blockedFixture.depositId,
          salonId: blockedSalon.id,
          actor,
          reason: 'blocked release',
        });

      expect(result).toMatchObject({ ok: false, code: 'ACCOUNT_NOT_CHARGE_READY' });
      expect(await readDeposit(blockedFixture.depositId)).toMatchObject({
        status: 'checkout_created',
      });
    }

    expect(provider.expire).not.toHaveBeenCalled();

    const conflictFixture = await seedDeposit({
      salonId: salon.id,
      account: salon.account,
    });
    await applyRefundObservation({
      deposit: await readDeposit(conflictFixture.depositId),
      refund: {
        id: 're_health_bound',
        status: 'pending',
        amount: AMOUNT,
        currency: 'cad',
        metadata: {},
      },
      origin: 'external',
    });
    for (let delivery = 0; delivery < 3; delivery += 1) {
      await stampDepositRefund({
        deposit: await readDeposit(conflictFixture.depositId),
        refund: {
          id: 're_health_conflict',
          status: 'succeeded',
          amount: AMOUNT,
          currency: 'cad',
          metadata: {},
        },
        allowedSourceStatuses: ['paid', 'refunded'],
        variant: 'owner',
      });
    }
    const raised = await loadDepositHealth(salon.id);

    expect(raised.totals.refundConflicts).toBe(1);

    await applyRefundObservation({
      deposit: await readDeposit(conflictFixture.depositId),
      refund: {
        id: 're_health_bound',
        status: 'failed',
        amount: AMOUNT,
        currency: 'cad',
        failure_reason: 'declined',
        metadata: {},
      },
      origin: 'webhook',
    });
    const retried = await retryFailedDepositRefund({
      depositId: conflictFixture.depositId,
      salonId: salon.id,
      actor,
    });

    expect(retried.ok).toBe(true);

    await seedDeposit({
      salonId: salon.id,
      account: 'acct_health_old_snapshot',
    });
    const cleared = await loadDepositHealth(salon.id);
    const conflictAudits = await db
      .select()
      .from(schema.appointmentAuditLogSchema)
      .where(and(
        eq(schema.appointmentAuditLogSchema.appointmentId, conflictFixture.appointmentId),
        eq(schema.appointmentAuditLogSchema.reason, 'refund_conflict'),
      ));

    expect(cleared.totals.moneyOnWaivedOrReleased).toBe(1);
    expect(cleared.totals.refundConflicts).toBe(0);
    expect(cleared.totals.depositsAccountRebound).toBe(1);
    expect(cleared.totals.paidDeposits).toBe(1);
    expect(conflictAudits).toHaveLength(1);
    expect(JSON.stringify(cleared)).not.toMatch(/acct_health_old_snapshot/);
  });

  it('counts both explicit and fallback stale-hold expiry anchors', async () => {
    const salon = await seedSalon();
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    await seedDeposit({
      salonId: salon.id,
      account: salon.account,
      status: 'checkout_created',
      appointmentStatus: 'awaiting_payment',
      holdExpiresAt: new Date(Date.now() - 60 * 60_000),
      createdAt: old,
    });
    await seedDeposit({
      salonId: salon.id,
      account: salon.account,
      status: 'checkout_created',
      appointmentStatus: 'awaiting_payment',
      holdExpiresAt: null,
      createdAt: old,
    });

    const payload = await loadDepositHealth(salon.id);

    expect(payload.totals.staleHolds).toBe(2);
  });

  it('severity-orders, filters, and caps non-zero salon rows while preserving totals', async () => {
    let highestSeveritySalonId = '';
    for (let index = 0; index < 102; index += 1) {
      const salon = await seedSalon({
        id: `salon_health_cap_${String(index).padStart(3, '0')}`,
        name: `Cap Salon ${String(index).padStart(3, '0')}`,
      });
      const fixture = await seedDeposit({
        salonId: salon.id,
        account: salon.account,
        status: 'canceled',
        appointmentStatus: 'cancelled',
      });
      const opened = await openSystemRefundIntent(
        await readDeposit(fixture.depositId),
        ['canceled'],
      );
      if (!opened) {
        throw new Error('Expected capped health intent to open');
      }
      await db
        .update(schema.appointmentDepositSchema)
        .set({ refundStatusChangedAt: new Date(Date.now() - 20 * 60_000) })
        .where(eq(schema.appointmentDepositSchema.id, fixture.depositId));
      if (index === 101) {
        highestSeveritySalonId = salon.id;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await incrementRefundReconcileAttempts(await readDeposit(fixture.depositId));
        }
      }
    }

    const healthy = await seedSalon({ id: 'salon_health_all_zero' });
    const payload = await loadDepositHealth(null);

    expect(payload.salons).toHaveLength(100);
    expect(payload.salonsOmitted).toBe(2);
    expect(payload.salons[0]?.salonId).toBe(highestSeveritySalonId);
    expect(payload.salons.some(row => row.salonId === healthy.id)).toBe(false);
    expect(payload.totals.refundIntentsStuck).toBe(102);
    expect(payload.totals.refundsAbandoned).toBe(1);
  });
});
