import fs from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyRefundObservation,
  checkDepositSnapshotAccount,
  DEPOSIT_HEALTH_COUNTER_KEYS,
  DEPOSIT_REFUND_ERROR_CODES,
  DEPOSIT_REFUND_FAILURE_REASONS,
  type DepositRow,
  filterDepositAuditMetadata,
  mapStripeRefundErrorCode,
  mapStripeRefundFailureReason,
  needsAttentionPredicate,
  resolveDepositActor,
  serializeDepositForRole,
  stampDepositRefund,
} from './depositLifecycle';

vi.mock('server-only', () => ({}));

const {
  db,
  enqueueClientStatsRefreshInTx,
  enqueueDepositRefundAlertInTx,
  resolveCheckoutActor,
  selectPlans,
  transactionTx,
  updatePlans,
  updateSalonClientStats,
} = vi.hoisted(() => {
  const selectPlans: unknown[][] = [];
  const updatePlans: unknown[][] = [];

  function plannedQuery(result: unknown[]) {
    const promise = Promise.resolve(result);
    return {
      for: vi.fn(() => ({ limit: vi.fn(async () => result) })),
      limit: vi.fn(async () => result),
      then: promise.then.bind(promise),
    };
  }

  const transactionTx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => plannedQuery(selectPlans.shift() ?? [])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => updatePlans.shift() ?? []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async () => undefined),
    })),
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => plannedQuery(selectPlans.shift() ?? [])),
      })),
    })),
    update: transactionTx.update,
    transaction: vi.fn(),
    execute: vi.fn(),
  };

  return {
    db,
    enqueueClientStatsRefreshInTx: vi.fn(async () => undefined),
    enqueueDepositRefundAlertInTx: vi.fn(async () => undefined),
    resolveCheckoutActor: vi.fn(() => ({
      recordedByType: 'admin',
      recordedById: 'admin_1',
      recordedByName: 'Admin One',
      performedBy: 'admin_1',
      performedByRole: 'admin',
      performedByName: 'Admin One',
    })),
    selectPlans,
    transactionTx,
    updatePlans,
    updateSalonClientStats: vi.fn(async () => undefined),
  };
});

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@/libs/appointmentCheckoutServer', () => ({ resolveCheckoutActor }));
vi.mock('@/libs/appointmentAudit', () => ({
  buildAppointmentAuditRow: vi.fn((value: unknown) => value),
}));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/depositCheckout', () => ({
  classifyStripeFailure: vi.fn(() => 'ambiguous'),
  DEPOSIT_HOLD_WINDOW_MINUTES: 35,
  getDepositStripeClient: vi.fn(),
}));
vi.mock('@/libs/environmentIsolation', () => ({
  resolveRuntimeEnvironment: vi.fn(() => 'test'),
}));
vi.mock('@/libs/integrationOutbox', () => ({
  enqueueClientStatsRefreshInTx,
  enqueueDepositRefundAlertInTx,
  enqueueGoogleCalendarDeleteInTx: vi.fn(),
}));
vi.mock('@/libs/queries', () => ({ updateSalonClientStats }));
vi.mock('@/libs/sentry/runtime', () => ({
  getPublicSentryRuntimeConfig: vi.fn(() => ({ enabled: false })),
}));
vi.mock('@/libs/stripeConnect/webhookEvents', () => ({
  finalizeRetryable: vi.fn(),
}));
vi.mock('./confirmDepositPayment', () => ({
  enqueueDepositConfirmationEffectsInTx: vi.fn(),
}));
vi.mock('./depositWebhookEvents', () => ({
  claimOrRearmPollEvidenceWorkRow: vi.fn(),
  pollEvidenceEventId: vi.fn((depositId: string) => `luster:poll_evidence:${depositId}`),
}));
vi.mock('./depositsTransaction', () => ({
  depositsTransaction: vi.fn(async (_database: unknown, operation: (tx: unknown) => unknown) => (
    operation(transactionTx)
  )),
}));

function deposit(overrides: Partial<DepositRow> = {}): DepositRow {
  const now = new Date('2026-08-14T12:00:00.000Z');
  return {
    id: 'dep_1',
    salonId: 'salon_1',
    appointmentId: 'appt_1',
    amountCents: 500,
    disclosedAmountCents: 500,
    currency: 'cad',
    status: 'paid',
    stripeAccountId: 'acct_1',
    stripeCheckoutSessionId: 'cs_1',
    stripePaymentIntentId: 'pi_1',
    collectedAt: null,
    stripeCheckoutUrl: null,
    checkoutSuccessUrl: null,
    checkoutCancelUrl: null,
    resolutionNote: null,
    stripeRefundId: null,
    refundedAt: null,
    lateCheckDoneAt: null,
    pollRetrievals: 0,
    pollWindowRetrievals: 0,
    pollWindowStartedAt: null,
    refundTerminalFailureCount: 0,
    refundKeyEpoch: 1,
    refundStatus: 'requested',
    refundStatusChangedAt: now,
    refundAmountCents: null,
    priorRefundIds: [],
    refundReconcileAttempts: 0,
    refundReconcileClaimedAt: null,
    refundRequestedAt: now,
    refundRequestedBy: 'admin_1',
    refundRequestedByRole: 'admin',
    refundTrigger: 'owner',
    refundRequestedEnv: 'test',
    refundLastErrorCode: null,
    refundFailureReason: null,
    externalRefundObservedCents: null,
    refundConflictFlag: false,
    refundRequestedImpersonated: false,
    waivedAt: null,
    waivedBy: null,
    waiverReason: null,
    forfeitedAt: null,
    forfeitureTaxSnapshot: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('deposit lifecycle closed vocabularies', () => {
  it('keeps the refund error and failure vocabularies exact', () => {
    expect(DEPOSIT_REFUND_ERROR_CODES).toEqual([
      'charge_disputed',
      'refund_disputed_payment',
      'charge_already_refunded',
      'rate_limit',
      'lock_timeout',
      'idempotency_key_in_use',
      'platform_api_key_expired',
      'account_invalid',
      'livemode_mismatch',
      'ACCOUNT_DISCONNECTED',
      'ACCOUNT_REBOUND',
      'UNKNOWN_PROVIDER_ERROR',
    ]);
    expect(DEPOSIT_REFUND_FAILURE_REASONS).toEqual([
      'charge_for_pending_refund_disputed',
      'declined',
      'expired_or_canceled_card',
      'insufficient_funds',
      'lost_or_stolen_card',
      'merchant_request',
      'unknown',
    ]);
    expect(DEPOSIT_HEALTH_COUNTER_KEYS).toHaveLength(17);
    expect(DEPOSIT_HEALTH_COUNTER_KEYS).not.toContain('sessionExpirePending');
    expect(DEPOSIT_HEALTH_COUNTER_KEYS).not.toContain('salonsAccountUnusable');
  });

  it('maps every unmapped provider code and shape to the sentinel', () => {
    expect(mapStripeRefundErrorCode({ code: 'rate_limit' })).toBe('rate_limit');
    expect(mapStripeRefundErrorCode({ code: 'balance_insufficient' }))
      .toBe('UNKNOWN_PROVIDER_ERROR');
    expect(mapStripeRefundErrorCode({ code: 'charge_not_refundable' }))
      .toBe('UNKNOWN_PROVIDER_ERROR');
    expect(mapStripeRefundErrorCode({ code: 'future_provider_code' }))
      .toBe('UNKNOWN_PROVIDER_ERROR');
    expect(mapStripeRefundErrorCode(new Error('provider prose')))
      .toBe('UNKNOWN_PROVIDER_ERROR');
    expect(mapStripeRefundErrorCode(null)).toBe('UNKNOWN_PROVIDER_ERROR');
    expect(mapStripeRefundFailureReason('declined')).toBe('declined');
    expect(mapStripeRefundFailureReason('future_reason')).toBe('unknown');
  });

  it('filters stored audit json to the typed allowlist', () => {
    expect(filterDepositAuditMetadata({
      depositId: 'dep_1',
      stripeErrorCode: 'rate_limit',
      providerMessage: 'must never leave the server',
      keyEpoch: 2,
    })).toEqual({
      depositId: 'dep_1',
      stripeErrorCode: 'rate_limit',
      keyEpoch: 2,
    });
    expect(filterDepositAuditMetadata({
      stripeErrorCode: 'provider_prose',
      failureReason: 'invented',
    })).toBeNull();
  });
});

describe('deposit account and actor invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectPlans.length = 0;
    updatePlans.length = 0;
  });

  it('classifies same-pair live, deauthorized, revoked-local, and rebound bindings', async () => {
    selectPlans.push([{ salonId: 'salon_1', revokedAt: null, revocationCause: null }]);

    await expect(checkDepositSnapshotAccount(deposit())).resolves.toBe('ready');

    selectPlans.push([{
      salonId: 'salon_1',
      revokedAt: new Date(),
      revocationCause: 'deauthorized',
    }]);

    await expect(checkDepositSnapshotAccount(deposit()))
      .resolves.toBe('ACCOUNT_DISCONNECTED');

    selectPlans.push([{
      salonId: 'salon_1',
      revokedAt: new Date(),
      revocationCause: 'revoked_local',
    }]);

    await expect(checkDepositSnapshotAccount(deposit())).resolves.toBe('ready');

    selectPlans.push([
      { salonId: 'salon_1', revokedAt: new Date(), revocationCause: 'revoked_local' },
      { salonId: 'salon_2', revokedAt: null, revocationCause: null },
    ]);

    await expect(checkDepositSnapshotAccount(deposit()))
      .resolves.toBe('ACCOUNT_REBOUND');

    selectPlans.push([
      { salonId: 'salon_1', revokedAt: new Date(), revocationCause: 'revoked_local' },
      { salonId: 'salon_2', revokedAt: new Date(), revocationCause: 'revoked_local' },
    ]);

    await expect(checkDepositSnapshotAccount(deposit()))
      .resolves.toBe('ACCOUNT_REBOUND');
  });

  it('requires matching impersonation context for super-admin actors', () => {
    const admin = {
      id: 'super_1',
      name: 'Super Admin',
      isSuperAdmin: true,
    } as Parameters<typeof resolveDepositActor>[0]['admin'];

    expect(() => resolveDepositActor({ admin, impersonation: null, salonId: 'salon_1' }))
      .toThrow('SUPER_ADMIN_IMPERSONATION_CONTEXT_REQUIRED');

    const actor = resolveDepositActor({
      admin,
      salonId: 'salon_1',
      impersonation: {
        salonId: 'salon_1',
        salonSlug: 'salon-one',
        salonName: 'Salon One',
        adminUserId: 'super_1',
        adminPhone: '+15550000000',
        startedAt: '2026-08-14T12:00:00.000Z',
      },
    });

    expect(actor).toMatchObject({
      requestedBy: 'super_1',
      requestedByImpersonated: true,
      impersonated: true,
      superAdminUserId: 'super_1',
      impersonatedSalonId: 'salon_1',
    });
  });

  it('exposes only the two admin serializer roles and keeps needs-attention tenant-scoped', () => {
    const row = deposit();

    expect(serializeDepositForRole('admin', row)).toEqual(row);
    expect(serializeDepositForRole('super_admin', row)).toEqual(row);
    expect(serializeDepositForRole('admin', row)).not.toBe(row);
    expect(needsAttentionPredicate('salon_1')).toBeDefined();
  });
});

describe('refund transition alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectPlans.length = 0;
    updatePlans.length = 0;
  });

  it('enqueues the exact durable refundFailed alert only when requested enters failed', async () => {
    const requested = deposit();
    const failed = deposit({
      refundStatus: 'failed',
      refundLastErrorCode: 'charge_disputed',
      refundTerminalFailureCount: 1,
    });
    selectPlans.push([{ id: requested.appointmentId }], [requested], [failed]);
    updatePlans.push([failed]);

    const result = await applyRefundObservation({
      deposit: requested,
      refund: null,
      origin: 'create_refused',
      errorCode: { code: 'charge_disputed' },
    });

    expect(result).toMatchObject({ applied: true, deposit: failed });
    expect(enqueueDepositRefundAlertInTx).toHaveBeenCalledTimes(1);
    expect(enqueueDepositRefundAlertInTx).toHaveBeenCalledWith(transactionTx, {
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      event: 'refundFailed',
      refund: {
        errorCode: 'charge_disputed',
        failureReason: null,
        keyEpoch: 1,
        terminalFailureCount: 1,
      },
    });
    expect(enqueueClientStatsRefreshInTx).toHaveBeenCalledWith(
      transactionTx,
      expect.objectContaining({
        salonId: 'salon_1',
        appointmentId: 'appt_1',
        depositId: 'dep_1',
        stateVersion: expect.stringContaining(':paid:failed:'),
      }),
    );

    selectPlans.push([{ id: requested.appointmentId }], [failed], [failed]);
    updatePlans.push([]);
    await applyRefundObservation({
      deposit: failed,
      refund: null,
      origin: 'create_refused',
      errorCode: { code: 'charge_disputed' },
    });

    expect(enqueueDepositRefundAlertInTx).toHaveBeenCalledTimes(1);
  });

  it('enqueues the account alert only when row 4c changes the stored sentinel', async () => {
    const requested = deposit();
    const disconnected = deposit({ refundLastErrorCode: 'ACCOUNT_DISCONNECTED' });
    updatePlans.push([disconnected]);

    const result = await applyRefundObservation({
      deposit: requested,
      refund: null,
      origin: 'account_preflight',
      accountRefusal: 'ACCOUNT_DISCONNECTED',
    });

    expect(result.applied).toBe(true);
    expect(enqueueDepositRefundAlertInTx).toHaveBeenCalledWith(transactionTx, {
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      event: 'refundAccountDisconnected',
      refund: {
        errorCode: 'ACCOUNT_DISCONNECTED',
        failureReason: null,
        keyEpoch: 1,
        terminalFailureCount: 0,
      },
    });

    updatePlans.push([]);
    await applyRefundObservation({
      deposit: disconnected,
      refund: null,
      origin: 'account_preflight',
      accountRefusal: 'ACCOUNT_DISCONNECTED',
    });

    expect(enqueueDepositRefundAlertInTx).toHaveBeenCalledTimes(1);
  });
});

describe('TX-B first-stamp source-status fence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectPlans.length = 0;
    updatePlans.length = 0;
  });

  it('does not attempt a first-stamp update from a stale source status', async () => {
    const stale = deposit({ status: 'canceled' });
    selectPlans.push([{ id: stale.appointmentId }], [stale], [stale], [stale]);

    const result = await stampDepositRefund({
      deposit: stale,
      refund: {
        id: 're_1',
        status: 'succeeded',
        amount: stale.amountCents,
        currency: stale.currency,
        metadata: { luster_deposit_id: stale.id },
      },
      allowedSourceStatuses: ['paid', 'refunded'],
      variant: 'owner',
    });

    expect(transactionTx.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      disposition: 'already_confirmed_late_refund',
    });
  });

  it('treats a zero-row first-stamp caused by a status race as late-confirmed', async () => {
    const requested = deposit({ status: 'paid' });
    const raced = deposit({ status: 'canceled' });
    selectPlans.push([{ id: requested.appointmentId }], [requested], [raced], [raced]);
    updatePlans.push([]);

    const result = await stampDepositRefund({
      deposit: requested,
      refund: {
        id: 're_1',
        status: 'succeeded',
        amount: requested.amountCents,
        currency: requested.currency,
        metadata: { luster_deposit_id: requested.id },
      },
      allowedSourceStatuses: ['paid', 'refunded'],
      variant: 'owner',
    });

    expect(transactionTx.update).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      disposition: 'already_confirmed_late_refund',
    });
  });
});

describe('charter structural constraints', () => {
  it('keeps appointment-first locking and excludes retry/reward additions', () => {
    const source = fs.readFileSync(new URL('./depositLifecycle.ts', import.meta.url), 'utf8');
    const lockHelper = source.slice(
      source.indexOf('async function withAppointmentFirstDepositLock'),
      source.indexOf('/** TX-A0'),
    );
    const serializer = source.slice(
      source.indexOf('export function serializeDepositForRole'),
      source.indexOf('const terminalRefundCodesSql'),
    );
    const clientAppointmentRoute = fs.readFileSync(
      new URL('../../app/api/appointments/[id]/route.ts', import.meta.url),
      'utf8',
    );

    expect(lockHelper.indexOf('.from(appointmentSchema)'))
      .toBeLessThan(lockHelper.indexOf('.from(appointmentDepositSchema)'));
    expect(source).not.toContain('withClientLifecycleTransactionRetry');
    expect(source).not.toContain(['reward', 'Attribution'].join(''));
    expect(source).not.toContain(['reward', 'Release'].join(''));
    expect(serializer).toMatch(/role:\s*'admin'\s*\|\s*'super_admin'/);
    expect(serializer).not.toMatch(/if\s*\(\s*role|switch\s*\(\s*role/);
    expect(serializer).toMatch(/void role;\s*return \{ \.\.\.deposit \};/);
    expect(clientAppointmentRoute).not.toContain('serializeDepositForRole');
    expect(clientAppointmentRoute).not.toContain('appointmentDepositSchema');
    expect(source.match(/function mapStripeRefundErrorCode/g)).toHaveLength(1);
    expect(source).toMatch(
      /inArray\(\s*appointmentDepositSchema\.status,\s*\[\.\.\.args\.allowedSourceStatuses\],/,
    );
  });
});
