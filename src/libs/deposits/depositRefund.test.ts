/**
 * D6 refund-core contract tests.
 *
 * OD6-D-9: the Stripe singleton below is a real SDK instance, but its injected
 * transport is test-local inside this existing module-mock boundary. This
 * proves SDK request construction, connected-account/API-version headers,
 * error parsing and pagination. Idempotency replay is SIMULATED, not proven
 * against Stripe, and remote-success/response-loss remains unprovable locally.
 */
import fs from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

type ScriptedRequest = {
  host: string;
  port: string | number;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
  requestData: string | null;
  protocol: string;
  timeout: number;
};

type ScriptedStep =
  | {
    status: number;
    body: Record<string, unknown>;
    headers?: Record<string, string>;
    beforeResponse?: () => Promise<void>;
  }
  | {
    error: Error & { code?: string };
    beforeResponse?: () => Promise<void>;
  };

const transport = vi.hoisted(() => ({
  requests: [] as ScriptedRequest[],
  steps: [] as ScriptedStep[],
}));

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

vi.mock('@/libs/stripe', async () => {
  const { default: Stripe } = await import('stripe');
  const httpClient = {
    getClientName: () => 'd6-scripted-test-transport',
    makeRequest: async (
      host: string,
      port: string | number,
      requestPath: string,
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      headers: object,
      requestData: string | null,
      protocol: string,
      timeout: number,
    ) => {
      transport.requests.push({
        host,
        port,
        path: requestPath,
        method,
        headers: headers as Record<string, string>,
        requestData,
        protocol,
        timeout,
      });
      const step = transport.steps.shift();
      if (!step) {
        throw new Error(`unscripted Stripe request: ${method} ${requestPath}`);
      }
      await step.beforeResponse?.();
      if ('error' in step) {
        throw step.error;
      }
      const responseHeaders = {
        'request-id': `req_d6_${transport.requests.length}`,
        ...step.headers,
      };
      return {
        getStatusCode: () => step.status,
        getHeaders: () => responseHeaders,
        getRawResponse: () => step.body,
        toStream: () => {
          throw new Error('streaming is outside the refund test contract');
        },
        toJSON: async () => step.body,
      };
    },
  };

  return {
    stripe: new Stripe('sk_test_d6_scripted_transport', {
      apiVersion: '2024-06-20',
      httpClient,
      maxNetworkRetries: 0,
      typescript: true,
    }),
    EXPECTED_STRIPE_API_VERSION: '2024-06-20',
  };
});

/* eslint-disable import/first */
import { runDepositReconcile } from '../depositReconcile';
import {
  applyRefundObservation,
  DEPOSIT_REFUND_ERROR_CODES,
  type DepositActor,
  mapStripeRefundErrorCode,
  reconcileDepositRefund,
  requestDepositRefund,
  retryFailedDepositRefund,
  stampDepositRefund,
} from './depositLifecycle';
import {
  buildRefundIdempotencyKey,
  createOrAdoptDepositRefund,
  DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
  deriveRefundIntentIdentity,
  discoverAndAdoptDepositRefunds,
  PARTIAL_REFUND_OBSERVED_NOTE,
  resolveAllowedSourceStatuses,
} from './depositRefund';
/* eslint-enable import/first */

const SALON = 'salon_refund';
const OTHER_SALON = 'salon_refund_other';
const ACCOUNT = 'acct_refund_snapshot';
const AMOUNT = 2500;
const CURRENCY = 'cad';
const PAYMENT_INTENT = 'pi_refund';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;

function queueJson(
  body: Record<string, unknown>,
  status = 200,
  headers?: Record<string, string>,
  beforeResponse?: () => Promise<void>,
) {
  transport.steps.push({ status, body, headers, beforeResponse });
}

function queueError(error: Error & { code?: string }) {
  transport.steps.push({ error });
}

function refund(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    object: 'refund',
    amount: AMOUNT,
    currency: CURRENCY,
    status: 'succeeded',
    failure_reason: null,
    metadata: {},
    payment_intent: PAYMENT_INTENT,
    ...overrides,
  };
}

function refundList(
  data: Record<string, unknown>[],
  hasMore = false,
): Record<string, unknown> {
  return {
    object: 'list',
    data,
    has_more: hasMore,
    url: '/v1/refunds',
  };
}

async function seedDeposit(overrides: Partial<typeof schema.appointmentDepositSchema.$inferInsert> = {}) {
  sequence += 1;
  const appointmentId = `appt_refund_${sequence}`;
  const depositId = `dep_refund_${sequence}`;
  const start = new Date(Date.now() + sequence * 3_600_000);

  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId: SALON,
    clientPhone: '4165550101',
    clientName: 'Refund Client',
    startTime: start,
    endTime: new Date(start.getTime() + 3_600_000),
    status: 'cancelled',
    cancelReason: 'client_request',
    totalPrice: 9000,
    totalDurationMinutes: 60,
  });
  await db.insert(schema.appointmentDepositSchema).values({
    id: depositId,
    salonId: SALON,
    appointmentId,
    amountCents: AMOUNT,
    currency: CURRENCY,
    status: 'paid',
    stripeAccountId: ACCOUNT,
    stripeCheckoutSessionId: `cs_refund_${sequence}`,
    stripePaymentIntentId: `${PAYMENT_INTENT}_${sequence}`,
    refundStatus: 'requested',
    refundStatusChangedAt: new Date(),
    refundRequestedAt: new Date(),
    refundRequestedBy: 'admin_refund',
    refundRequestedByRole: 'admin',
    refundTrigger: 'owner',
    refundRequestedEnv: 'test',
    ...overrides,
  });

  const [deposit] = await db.select().from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, depositId));
  if (!deposit) {
    throw new Error('seeded deposit was not readable');
  }
  return deposit;
}

async function readDeposit(id: string) {
  const [row] = await db.select().from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, id));
  return row;
}

async function readWork(depositId: string) {
  const [row] = await db.select().from(schema.stripeWebhookEventSchema)
    .where(eq(schema.stripeWebhookEventSchema.metadataDepositId, depositId));
  return row;
}

async function backdateDepositUpdatedAt(depositId: string, updatedAt: Date): Promise<void> {
  await client.exec(
    'ALTER TABLE appointment_deposit DISABLE TRIGGER appointment_deposit_set_updated_at',
  );
  try {
    await client.query(
      'UPDATE appointment_deposit SET updated_at = $1 WHERE id = $2',
      [updatedAt, depositId],
    );
  } finally {
    await client.exec(
      'ALTER TABLE appointment_deposit ENABLE TRIGGER appointment_deposit_set_updated_at',
    );
  }
}

function createRequests() {
  return transport.requests.filter(request => (
    request.method === 'POST' && request.path === '/v1/refunds'
  ));
}

function ownerActor(overrides: Partial<DepositActor> = {}): DepositActor {
  const actor: DepositActor = {
    recordedByType: 'admin',
    recordedById: 'admin_refund',
    recordedByName: 'Refund Admin',
    performedBy: 'admin_refund',
    performedByRole: 'admin',
    performedByName: 'Refund Admin',
    requestedBy: 'admin_refund',
    requestedByRole: 'admin',
    requestedByImpersonated: false,
    impersonated: false,
    superAdminUserId: null,
    impersonatedSalonId: null,
  };
  return Object.assign(actor, overrides);
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 60_000);

beforeEach(async () => {
  transport.requests.length = 0;
  transport.steps.length = 0;
  vi.clearAllMocks();

  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.stripeWebhookEventSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.salonSchema);

  await db.insert(schema.salonSchema).values([
    {
      id: SALON,
      name: 'Refund Salon',
      slug: 'refund-salon',
      ownerEmail: 'owner@example.com',
    },
    {
      id: OTHER_SALON,
      name: 'Other Refund Salon',
      slug: 'other-refund-salon',
      ownerEmail: 'other@example.com',
    },
  ]);
  await db.insert(schema.salonStripeAccountSchema).values({
    id: 'ssa_refund',
    salonId: SALON,
    stripeAccountId: ACCOUNT,
    livemode: false,
  });
});

afterAll(async () => {
  await client.close();
});

describe('D6 refund core — provider work and adoption', () => {
  it('T3/T23 opens the system intent and sends one bounded, account-scoped create', async () => {
    const deposit = await seedDeposit({
      status: 'canceled',
      refundStatus: null,
      refundStatusChangedAt: null,
      refundRequestedAt: null,
      refundRequestedBy: null,
      refundRequestedByRole: null,
      refundTrigger: null,
      refundRequestedEnv: null,
    });
    queueJson(refundList([]));
    queueJson(refund('re_created', {
      metadata: {
        luster_deposit_id: deposit.id,
        luster_key_epoch: '1',
      },
    }));

    const result = await createOrAdoptDepositRefund(deposit, 'slot_lost', {
      trigger: 'system',
      allowedSourceStatuses: resolveAllowedSourceStatuses(deposit),
    });

    expect(result).toMatchObject({ disposition: 'refunded', refundId: 're_created' });
    expect(createRequests()).toHaveLength(1);

    const request = createRequests()[0];

    expect(request?.headers['Stripe-Account']).toBe(ACCOUNT);
    expect(request?.headers['Stripe-Version']).toBe('2024-06-20');
    expect(request?.headers['Idempotency-Key'])
      .toBe(`deposit:${deposit.id}:auto-refund:v1:0`);
    expect(request?.timeout).toBe(DEPOSIT_STRIPE_CALL_TIMEOUT_MS);

    const form = new URLSearchParams(request?.requestData ?? '');

    expect(form.get('payment_intent')).toBe(deposit.stripePaymentIntentId);
    expect(form.get('amount')).toBeNull();
    expect(form.get('metadata[luster_deposit_id]')).toBe(deposit.id);
    expect(form.get('metadata[luster_key_epoch]')).toBe('1');

    const stored = await readDeposit(deposit.id);

    expect(stored).toMatchObject({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_created',
      refundTrigger: 'system_late_payment',
      refundRequestedBy: 'system',
      refundRequestedByRole: 'system',
      refundRequestedImpersonated: false,
      refundReconcileAttempts: 1,
    });

    await db
      .update(schema.appointmentDepositSchema)
      .set({ refundReconcileClaimedAt: new Date() })
      .where(eq(schema.appointmentDepositSchema.id, deposit.id));
    transport.requests.length = 0;
    transport.steps.length = 0;
    const sweepDeposit = await seedDeposit({
      status: 'paid',
      refundStatus: 'requested',
      refundStatusChangedAt: new Date(Date.now() - 20 * 60_000),
      refundTrigger: 'owner',
      refundReconcileAttempts: 0,
    });
    queueJson(refundList([]));
    queueJson(refund('re_sweep_created', {
      metadata: {
        luster_deposit_id: sweepDeposit.id,
        luster_key_epoch: '1',
      },
    }));

    const sweep = await runDepositReconcile();

    expect(sweep.refundPass1Processed).toBe(1);
    expect(transport.requests.filter(request => (
      request.method === 'GET' && request.path.startsWith('/v1/refunds?')
    ))).toHaveLength(1);
    expect(createRequests()).toHaveLength(1);
    expect(await readDeposit(sweepDeposit.id)).toMatchObject({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_sweep_created',
    });

    await db
      .update(schema.appointmentDepositSchema)
      .set({ refundReconcileClaimedAt: new Date() })
      .where(eq(schema.appointmentDepositSchema.id, sweepDeposit.id));
    transport.requests.length = 0;
    transport.steps.length = 0;
    await db
      .update(schema.salonStripeAccountSchema)
      .set({ revokedAt: new Date(), revocationCause: 'deauthorized' })
      .where(eq(schema.salonStripeAccountSchema.id, 'ssa_refund'));
    const refusalCeiling = await seedDeposit({
      status: 'paid',
      refundStatus: 'requested',
      refundStatusChangedAt: new Date(Date.now() - 15 * 24 * 60 * 60_000),
      refundTrigger: 'owner',
      refundLastErrorCode: 'ACCOUNT_DISCONNECTED',
      refundReconcileAttempts: 0,
    });

    const ceilingSweep = await runDepositReconcile();

    expect(ceilingSweep.refundPass1Processed).toBe(0);
    expect(transport.requests).toHaveLength(0);
    expect(await readDeposit(refusalCeiling.id)).toMatchObject({
      refundStatus: 'requested',
      refundReconcileClaimedAt: null,
      refundLastErrorCode: 'ACCOUNT_DISCONNECTED',
    });
  });

  it('T3/T7(d) recovers a remote success after the local first-stamp loses its status race', async () => {
    const deposit = await seedDeposit();
    const created = refund('re_remote_success', {
      metadata: {
        luster_deposit_id: deposit.id,
        luster_key_epoch: '1',
      },
    });
    queueJson(refundList([]));
    queueJson(created, 200, undefined, async () => {
      await db.update(schema.appointmentDepositSchema)
        .set({ status: 'canceled' })
        .where(eq(schema.appointmentDepositSchema.id, deposit.id));
    });

    const raced = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(raced).toMatchObject({
      disposition: 'already_confirmed_late_refund',
      refundId: 're_remote_success',
    });
    expect(createRequests()).toHaveLength(1);
    expect(await readDeposit(deposit.id)).toMatchObject({
      status: 'canceled',
      refundStatus: 'requested',
      stripeRefundId: null,
    });
    expect(await readWork(deposit.id)).toMatchObject({
      status: 'processed',
      outcome: 'already_confirmed_late_refund',
    });
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'deposit_already_confirmed_late_refund',
      expect.objectContaining({
        level: 'error',
        extra: expect.objectContaining({
          depositId: deposit.id,
          refundId: 're_remote_success',
        }),
      }),
    );

    transport.requests.length = 0;
    transport.steps.length = 0;
    const unstamped = await readDeposit(deposit.id);
    if (!unstamped) {
      throw new Error('unstamped deposit vanished');
    }
    queueJson(refundList([created]));

    const recovered = await discoverAndAdoptDepositRefunds(unstamped);

    expect(recovered).toMatchObject({
      disposition: 'refunded',
      refundId: 're_remote_success',
    });
    expect(transport.requests).toHaveLength(1);
    expect(createRequests()).toHaveLength(0);
    expect(await readDeposit(deposit.id)).toMatchObject({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_remote_success',
    });

    await db
      .update(schema.appointmentDepositSchema)
      .set({ refundReconcileClaimedAt: new Date() })
      .where(eq(schema.appointmentDepositSchema.id, deposit.id));
    transport.requests.length = 0;
    transport.steps.length = 0;
    const systemDrift = await seedDeposit({
      status: 'expired',
      refundStatus: null,
      refundStatusChangedAt: null,
      refundRequestedAt: null,
      refundRequestedBy: null,
      refundRequestedByRole: null,
      refundTrigger: null,
      refundRequestedEnv: null,
    });
    const driftRefund = refund('re_system_drift', {
      metadata: {
        luster_deposit_id: systemDrift.id,
        luster_key_epoch: '1',
      },
    });
    queueJson(refundList([]));
    queueJson(driftRefund, 200, undefined, async () => {
      await db
        .update(schema.appointmentDepositSchema)
        .set({ status: 'paid' })
        .where(eq(schema.appointmentDepositSchema.id, systemDrift.id));
    });

    expect(await createOrAdoptDepositRefund(systemDrift, 'slot_lost', {
      trigger: 'system',
      allowedSourceStatuses: resolveAllowedSourceStatuses(systemDrift),
    })).toMatchObject({ disposition: 'already_confirmed_late_refund' });
    expect(await readDeposit(systemDrift.id)).toMatchObject({
      status: 'paid',
      refundStatus: 'requested',
      stripeRefundId: null,
      refundTrigger: 'system_late_payment',
    });

    await backdateDepositUpdatedAt(
      systemDrift.id,
      new Date(Date.now() - 7 * 60 * 60_000),
    );
    transport.requests.length = 0;
    transport.steps.length = 0;
    queueJson(refundList([driftRefund]));

    const pass5 = await runDepositReconcile();

    expect(pass5.refundPass5Processed).toBe(1);
    expect(transport.requests).toHaveLength(1);
    expect(createRequests()).toHaveLength(0);
    expect(await readDeposit(systemDrift.id)).toMatchObject({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_system_drift',
      refundTrigger: 'system_late_payment',
    });
  });

  it('T4/T7 adopts one amount-and-currency-matched live refund and never creates', async () => {
    const deposit = await seedDeposit();
    queueJson(refundList([refund('re_existing', { status: 'pending' })]));

    const result = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(result).toMatchObject({ disposition: 'refunded', refundId: 're_existing' });
    expect(createRequests()).toHaveLength(0);
    expect(await readDeposit(deposit.id)).toMatchObject({
      stripeRefundId: 're_existing',
      refundStatus: 'pending',
      status: 'refunded',
    });
  });

  it('T5 commits listed corpses before deriving the sole persisted-column key', async () => {
    const deposit = await seedDeposit();
    queueJson(refundList([
      refund('re_dead_1', { status: 'failed' }),
      refund('re_dead_2', { status: 'canceled' }),
    ]));
    queueJson(refund('re_after_corpses'));

    await createOrAdoptDepositRefund(deposit, 'owner');

    expect(createRequests()).toHaveLength(1);
    expect(createRequests()[0]?.headers['Idempotency-Key'])
      .toBe(`deposit:${deposit.id}:auto-refund:v1:2`);
    expect((await readDeposit(deposit.id))?.refundTerminalFailureCount).toBe(2);
  });

  it('T7(partial) closes Luster action, finalizes its lease, and issues zero create calls', async () => {
    const deposit = await seedDeposit();
    queueJson(refundList([refund('re_partial', { amount: 500 })]));

    const result = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(result).toMatchObject({
      disposition: 'noop',
      note: PARTIAL_REFUND_OBSERVED_NOTE,
    });
    expect(createRequests()).toHaveLength(0);
    expect((await readDeposit(deposit.id))?.externalRefundObservedCents).toBe(500);
    expect(await readWork(deposit.id)).toMatchObject({
      status: 'processed',
      outcome: 'refund_failed_unreconciled',
      lastError: 'partial_refund_observed',
    });

    const observed = await readDeposit(deposit.id);
    if (!observed) {
      throw new Error('partial observation vanished');
    }
    const repeated = await applyRefundObservation({
      deposit: observed,
      refund: {
        id: 're_partial',
        status: 'succeeded',
        amount: 500,
        currency: CURRENCY,
        metadata: {},
      },
      origin: 'listing',
    });

    expect(repeated).toMatchObject({
      applied: false,
      outcome: 'ignored_same_state',
    });
  });

  it('T8 retires a stored corpse as a set member before creating a replacement', async () => {
    const deposit = await seedDeposit({
      status: 'refunded',
      refundStatus: 'failed',
      stripeRefundId: 're_dead_stored',
      refundAmountCents: AMOUNT,
      refundedAt: new Date(),
    });
    queueJson(refund('re_dead_stored', { status: 'failed' }));
    queueJson(refundList([]));
    queueJson(refund('re_replacement'));

    const result = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(sentry.captureException.mock.calls).toEqual([]);
    expect(result).toEqual({
      disposition: 'refunded',
      depositId: deposit.id,
      refundId: 're_replacement',
    });
    expect(createRequests()).toHaveLength(1);
    expect(await readDeposit(deposit.id)).toMatchObject({
      priorRefundIds: ['re_dead_stored'],
      stripeRefundId: 're_replacement',
      refundTerminalFailureCount: 1,
    });

    const replaced = await readDeposit(deposit.id);
    if (!replaced) {
      throw new Error('replacement deposit vanished');
    }
    const retiredReplay = await applyRefundObservation({
      deposit: replaced,
      refund: {
        id: 're_dead_stored',
        status: 'succeeded',
        amount: AMOUNT,
        currency: CURRENCY,
        metadata: {},
      },
      origin: 'webhook',
    });

    expect(retiredReplay).toMatchObject({
      applied: false,
      outcome: 'ignored_retired_refund',
    });
    expect(await readDeposit(deposit.id)).toMatchObject({
      priorRefundIds: ['re_dead_stored'],
      stripeRefundId: 're_replacement',
    });

    transport.requests.length = 0;
    transport.steps.length = 0;
    const duplicateGuard = await seedDeposit({
      status: 'refunded',
      refundStatus: 'failed',
      refundStatusChangedAt: new Date(Date.now() - 2 * 3_600_000),
      stripeRefundId: 're_duplicate_guard',
      refundAmountCents: AMOUNT,
      refundedAt: new Date(),
      priorRefundIds: ['re_duplicate_guard'],
      refundTerminalFailureCount: 1,
      refundLastErrorCode: 'UNKNOWN_PROVIDER_ERROR',
      refundTrigger: 'owner',
    });
    queueJson(refundList([]));
    queueJson(refund('re_after_duplicate_guard', {
      metadata: {
        luster_deposit_id: duplicateGuard.id,
        luster_key_epoch: '2',
      },
    }));

    expect(await retryFailedDepositRefund({
      depositId: duplicateGuard.id,
      salonId: SALON,
      actor: ownerActor(),
    })).toMatchObject({ ok: true });

    const duplicateGuardStored = await readDeposit(duplicateGuard.id);
    if (!duplicateGuardStored) {
      throw new Error('duplicate-guard deposit vanished');
    }

    expect(duplicateGuardStored.priorRefundIds).toEqual(['re_duplicate_guard']);
    expect(new Set(duplicateGuardStored.priorRefundIds).size)
      .toBe(duplicateGuardStored.priorRefundIds.length);
  });
});

describe('D6 refund core — fail-closed and lease boundaries', () => {
  it('T6 parses a Stripe API error through the real SDK and fails closed before create', async () => {
    const deposit = await seedDeposit();
    queueJson({
      error: {
        type: 'invalid_request_error',
        code: 'charge_not_refundable',
        message: 'The charge is not refundable.',
      },
    }, 400);

    const result = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(result).toMatchObject({ disposition: 'noop', note: 'provider_retryable' });
    expect(createRequests()).toHaveLength(0);
    expect(await readDeposit(deposit.id)).toMatchObject({
      refundStatus: 'requested',
      refundLastErrorCode: 'UNKNOWN_PROVIDER_ERROR',
      refundReconcileAttempts: 1,
      refundTerminalFailureCount: 0,
    });
    expect(await readWork(deposit.id)).toMatchObject({
      status: 'failed_retryable',
      attempts: 1,
      lastError: 'UNKNOWN_PROVIDER_ERROR',
    });
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'StripeInvalidRequestError',
        code: 'charge_not_refundable',
      }),
      expect.anything(),
    );
  });

  it('T6 transport failure and API refusal take distinct retryable/terminal paths', async () => {
    const transportDeposit = await seedDeposit();
    queueJson(refundList([]));
    const timeout = Object.assign(new TypeError('ETIMEDOUT'), { code: 'ETIMEDOUT' });
    queueError(timeout);

    const transportResult = await createOrAdoptDepositRefund(transportDeposit, 'owner');

    expect(transportResult).toMatchObject({ disposition: 'noop', note: 'provider_retryable' });
    expect(await readDeposit(transportDeposit.id)).toMatchObject({
      refundStatus: 'requested',
      refundReconcileAttempts: 0,
      refundTerminalFailureCount: 0,
    });
    expect(await readWork(transportDeposit.id)).toMatchObject({
      status: 'failed_retryable',
      attempts: 0,
    });

    transport.requests.length = 0;
    transport.steps.length = 0;
    const refusalDeposit = await seedDeposit();
    queueJson(refundList([]));
    queueJson({
      error: {
        type: 'invalid_request_error',
        code: 'charge_disputed',
        message: 'The charge is disputed.',
      },
    }, 400);

    const refusalResult = await createOrAdoptDepositRefund(refusalDeposit, 'owner');

    expect(refusalResult).toMatchObject({
      disposition: 'refund_failed_unreconciled',
      note: 'DEPOSIT_CHARGE_DISPUTED',
    });
    expect(await readWork(refusalDeposit.id)).toMatchObject({
      status: 'processed',
      attempts: 1,
      outcome: 'refund_create_refused',
      lastError: 'charge_disputed',
    });
    expect(await readDeposit(refusalDeposit.id)).toMatchObject({
      refundStatus: 'failed',
      refundReconcileAttempts: 1,
      refundTerminalFailureCount: 1,
    });
  });

  it('T6 treats a real-SDK HTTP 5xx create failure as API-transient and spends the attempt', async () => {
    const deposit = await seedDeposit();
    queueJson(refundList([]));
    queueJson({
      error: {
        type: 'api_error',
        message: 'Stripe is temporarily unavailable.',
      },
    }, 503);

    const result = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(result).toMatchObject({ disposition: 'noop', note: 'provider_retryable' });
    expect(createRequests()).toHaveLength(1);
    expect(await readDeposit(deposit.id)).toMatchObject({
      refundStatus: 'requested',
      refundLastErrorCode: 'UNKNOWN_PROVIDER_ERROR',
      refundReconcileAttempts: 1,
      refundTerminalFailureCount: 0,
    });
    expect(await readWork(deposit.id)).toMatchObject({
      status: 'failed_retryable',
      attempts: 1,
      lastError: 'UNKNOWN_PROVIDER_ERROR',
    });
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'StripeAPIError',
        statusCode: 503,
      }),
      expect.anything(),
    );
  });

  it('T6 platform key rotation is transient when the snapshot binding remains usable', async () => {
    const deposit = await seedDeposit();
    queueJson(refundList([]));
    queueJson({
      error: {
        type: 'invalid_request_error',
        code: 'platform_api_key_expired',
        message: 'The platform API key expired.',
      },
    }, 401);

    const result = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(result).toMatchObject({ disposition: 'noop', note: 'provider_retryable' });
    expect(createRequests()).toHaveLength(1);
    expect(await readDeposit(deposit.id)).toMatchObject({
      refundStatus: 'requested',
      refundLastErrorCode: 'platform_api_key_expired',
      refundReconcileAttempts: 1,
      refundTerminalFailureCount: 0,
    });
    expect(await readWork(deposit.id)).toMatchObject({
      status: 'failed_retryable',
      attempts: 1,
      lastError: 'platform_api_key_expired',
    });

    const alerts = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.operation, 'deposit_refund_alert'));

    expect(alerts).toHaveLength(0);
  });

  it('T6 platform key expiry becomes row 4c only when the pair deauthorizes', async () => {
    const deposit = await seedDeposit();
    const changedAt = deposit.refundStatusChangedAt;
    queueJson(refundList([]));
    queueJson({
      error: {
        type: 'invalid_request_error',
        code: 'platform_api_key_expired',
        message: 'The platform API key expired.',
      },
    }, 401, undefined, async () => {
      await db.update(schema.salonStripeAccountSchema)
        .set({
          revokedAt: new Date(),
          revocationCause: 'deauthorized',
        })
        .where(eq(schema.salonStripeAccountSchema.id, 'ssa_refund'));
    });

    const result = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(result).toMatchObject({ disposition: 'noop', note: 'ACCOUNT_NOT_CHARGE_READY' });
    expect(createRequests()).toHaveLength(1);
    expect(await readDeposit(deposit.id)).toMatchObject({
      refundStatus: 'requested',
      refundStatusChangedAt: changedAt,
      refundLastErrorCode: 'ACCOUNT_DISCONNECTED',
      refundReconcileAttempts: 0,
      refundTerminalFailureCount: 0,
    });
    expect(await readWork(deposit.id)).toMatchObject({
      status: 'failed_retryable',
      attempts: 0,
      lastError: 'ACCOUNT_DISCONNECTED',
    });

    const alerts = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.operation, 'deposit_refund_alert'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.payload).toMatchObject({
      event: 'refundAccountDisconnected',
      refund: {
        errorCode: 'ACCOUNT_DISCONNECTED',
        keyEpoch: 1,
        terminalFailureCount: 0,
      },
    });
  });

  it('T11(f) leaves a fresh competing write-ahead lease entirely untouched', async () => {
    const deposit = await seedDeposit();
    const identity = deriveRefundIntentIdentity('owner', deposit.id, deposit.refundKeyEpoch);
    await db.insert(schema.stripeWebhookEventSchema).values({
      id: 'swe_busy',
      eventId: identity.eventId,
      type: identity.type,
      account: ACCOUNT,
      livemode: false,
      salonId: SALON,
      status: 'processing',
      attempts: 2,
      metadataDepositId: deposit.id,
      projectionStatus: 'ok',
      receivedAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(result).toMatchObject({ disposition: 'noop', note: 'write_ahead_busy' });
    expect(transport.requests).toHaveLength(0);
    expect(await readWork(deposit.id)).toMatchObject({
      status: 'processing',
      attempts: 2,
      processedAt: null,
    });
  });

  it('T3(d)/T24 rejects a rebound snapshot before provider work and spends no budget', async () => {
    const deposit = await seedDeposit();
    const changedAt = deposit.refundStatusChangedAt;
    await db.delete(schema.salonStripeAccountSchema);
    await db.insert(schema.salonStripeAccountSchema).values({
      id: 'ssa_rebound',
      salonId: OTHER_SALON,
      stripeAccountId: ACCOUNT,
      livemode: false,
    });

    const result = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(result).toMatchObject({ disposition: 'noop', note: 'ACCOUNT_NOT_CHARGE_READY' });
    expect(transport.requests).toHaveLength(0);
    expect(await readDeposit(deposit.id)).toMatchObject({
      refundStatus: 'requested',
      refundLastErrorCode: 'ACCOUNT_REBOUND',
      refundReconcileAttempts: 0,
      refundKeyEpoch: 1,
      refundStatusChangedAt: changedAt,
    });
    expect(await readWork(deposit.id)).toMatchObject({
      status: 'failed_retryable',
      attempts: 0,
    });

    await db.delete(schema.salonStripeAccountSchema);
    await db.insert(schema.salonStripeAccountSchema).values({
      id: 'ssa_resumed',
      salonId: SALON,
      stripeAccountId: ACCOUNT,
      livemode: false,
    });
    await db.update(schema.stripeWebhookEventSchema)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.stripeWebhookEventSchema.metadataDepositId, deposit.id));
    const resumable = await readDeposit(deposit.id);
    if (!resumable) {
      throw new Error('resumable deposit vanished');
    }
    queueJson(refundList([]));
    queueJson(refund('re_after_rebind', {
      metadata: {
        luster_deposit_id: deposit.id,
        luster_key_epoch: '1',
      },
    }));

    const resumed = await createOrAdoptDepositRefund(resumable, 'owner');

    expect(resumed).toMatchObject({ disposition: 'refunded', refundId: 're_after_rebind' });
    expect(transport.requests).toHaveLength(2);
    expect(createRequests()).toHaveLength(1);
    expect(await readDeposit(deposit.id)).toMatchObject({
      refundStatus: 'succeeded',
      refundLastErrorCode: null,
      refundReconcileAttempts: 1,
      refundKeyEpoch: 1,
    });
    expect(await readWork(deposit.id)).toMatchObject({
      status: 'processed',
      attempts: 1,
      outcome: 'refunded',
    });
  });
});

describe('D6 owner retry bounds', () => {
  it('T11 admits a failed system intent without a deposit-status clause and mints epoch 2', async () => {
    const failedRequestedAt = new Date(Date.now() - 3 * 60 * 60_000);
    const deposit = await seedDeposit({
      status: 'expired',
      refundStatus: 'failed',
      refundStatusChangedAt: new Date(Date.now() - 2 * 3_600_000),
      refundRequestedAt: failedRequestedAt,
      refundRequestedBy: 'admin_old_failed',
      refundRequestedByRole: 'super_admin',
      refundRequestedImpersonated: true,
      refundTrigger: 'system_late_payment',
      refundLastErrorCode: 'UNKNOWN_PROVIDER_ERROR',
      refundTerminalFailureCount: 1,
    });
    queueJson(refundList([]));
    queueJson(refund('re_retry_system', {
      metadata: {
        luster_deposit_id: deposit.id,
        luster_key_epoch: '2',
      },
    }));

    const result = await retryFailedDepositRefund({
      depositId: deposit.id,
      salonId: SALON,
      actor: ownerActor({
        requestedBy: 'admin_retry',
        performedBy: 'admin_retry',
      }),
    });

    expect(result).toMatchObject({ ok: true, disposition: 'refund_retried' });
    expect(createRequests()).toHaveLength(1);
    expect(createRequests()[0]?.headers['Idempotency-Key'])
      .toBe(`deposit:${deposit.id}:auto-refund:v2:1`);
    expect(await readDeposit(deposit.id)).toMatchObject({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_retry_system',
      refundKeyEpoch: 2,
      refundTerminalFailureCount: 1,
      refundRequestedBy: 'admin_retry',
      refundRequestedByRole: 'admin',
      refundRequestedImpersonated: false,
      refundTrigger: 'system_late_payment',
    });
    expect((await readDeposit(deposit.id))?.refundRequestedAt?.getTime())
      .toBeGreaterThan(failedRequestedAt.getTime());

    transport.requests.length = 0;
    transport.steps.length = 0;
    const ownerDeposit = await seedDeposit({
      status: 'paid',
      refundStatus: null,
      refundStatusChangedAt: null,
      refundRequestedAt: null,
      refundRequestedBy: null,
      refundRequestedByRole: null,
      refundTrigger: null,
      refundRequestedEnv: null,
    });
    queueJson(refundList([]));
    queueJson(refund('re_owner_modal', {
      metadata: {
        luster_deposit_id: ownerDeposit.id,
        luster_key_epoch: '1',
      },
    }), 200, undefined, async () => {
      await db
        .update(schema.appointmentDepositSchema)
        .set({ status: 'refunded' })
        .where(eq(schema.appointmentDepositSchema.id, ownerDeposit.id));
    });

    const ownerResult = await requestDepositRefund({
      depositId: ownerDeposit.id,
      salonId: SALON,
      actor: ownerActor(),
    });

    expect(ownerResult).toMatchObject({ ok: true, disposition: 'refunded' });
    expect(transport.requests.filter(request => (
      request.method === 'GET' && request.path.startsWith('/v1/refunds?')
    ))).toHaveLength(1);
    expect(createRequests()).toHaveLength(1);
    expect(await readDeposit(ownerDeposit.id)).toMatchObject({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_owner_modal',
      refundTrigger: 'owner',
    });

    const ownerNotices = await db
      .select({ payload: schema.integrationOutboxSchema.payload })
      .from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.operation, 'deposit_refund_notices'));
    const ownerNotice = ownerNotices.find((notice) => {
      const payload = notice.payload as { depositId?: string } | null;
      return payload?.depositId === ownerDeposit.id;
    });

    expect(ownerNotice?.payload).toMatchObject({ variant: 'owner' });

    transport.requests.length = 0;
    transport.steps.length = 0;
    const abandonedRequestedAt = new Date(Date.now() - 2 * 60 * 60_000);
    const abandoned = await seedDeposit({
      status: 'paid',
      refundStatus: 'requested',
      refundStatusChangedAt: abandonedRequestedAt,
      refundRequestedAt: abandonedRequestedAt,
      refundRequestedBy: 'admin_old',
      refundRequestedByRole: 'super_admin',
      refundRequestedImpersonated: true,
      refundTrigger: 'owner',
      refundReconcileAttempts: 0,
    });
    queueJson(refundList([]));
    queueJson(refund('re_abandoned_retry', {
      metadata: {
        luster_deposit_id: abandoned.id,
        luster_key_epoch: '2',
      },
    }));

    expect(await retryFailedDepositRefund({
      depositId: abandoned.id,
      salonId: SALON,
      actor: ownerActor({
        requestedBy: 'admin_abandoned',
        performedBy: 'admin_abandoned',
      }),
    })).toMatchObject({ ok: true, disposition: 'refund_retried' });
    expect(await readDeposit(abandoned.id)).toMatchObject({
      status: 'refunded',
      refundStatus: 'succeeded',
      refundRequestedBy: 'admin_abandoned',
      refundRequestedByRole: 'admin',
      refundRequestedImpersonated: false,
      refundKeyEpoch: 2,
    });
    expect((await readDeposit(abandoned.id))?.refundRequestedAt?.getTime())
      .toBeGreaterThan(abandonedRequestedAt.getTime());

    for (const settledId of [deposit.id, ownerDeposit.id, abandoned.id]) {
      await db
        .update(schema.appointmentDepositSchema)
        .set({ refundReconcileClaimedAt: new Date() })
        .where(eq(schema.appointmentDepositSchema.id, settledId));
    }
    transport.requests.length = 0;
    transport.steps.length = 0;
    const systemRouted = await seedDeposit({
      status: 'canceled',
      refundStatus: 'requested',
      refundStatusChangedAt: new Date(),
      refundTrigger: 'system_late_payment',
      refundReconcileClaimedAt: new Date(),
    });
    const systemIdentity = deriveRefundIntentIdentity('system', systemRouted.id, 1);
    await db.insert(schema.stripeWebhookEventSchema).values({
      id: 'swe_system_routing',
      eventId: systemIdentity.eventId,
      type: systemIdentity.type,
      account: ACCOUNT,
      livemode: false,
      salonId: SALON,
      status: 'failed_retryable',
      attempts: 0,
      availableAt: new Date(Date.now() - 1_000),
      metadataDepositId: systemRouted.id,
      paymentIntentId: systemRouted.stripePaymentIntentId,
      projectionStatus: 'ok',
    });
    queueJson(refundList([]));
    queueJson(refund('re_system_routed', {
      metadata: {
        luster_deposit_id: systemRouted.id,
        luster_key_epoch: '1',
      },
    }));

    const routedSweep = await runDepositReconcile();

    expect(routedSweep.eventsRedispatched).toBe(1);
    expect(transport.requests.filter(request => request.method === 'GET')).toHaveLength(1);
    expect(createRequests()).toHaveLength(1);
    expect(await readDeposit(systemRouted.id)).toMatchObject({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_system_routed',
      refundTrigger: 'system_late_payment',
    });
  });

  it('T12 permits exactly three terminal creates, then blocks every further logical retry', async () => {
    const deposit = await seedDeposit();

    const queueTerminalUnknown = () => {
      queueJson(refundList([]));
      queueJson({
        error: {
          type: 'invalid_request_error',
          code: 'future_terminal_code',
          message: 'A future terminal provider rejection.',
        },
      }, 400);
    };

    queueTerminalUnknown();
    const first = await createOrAdoptDepositRefund(deposit, 'owner');

    expect(first).toMatchObject({
      disposition: 'refund_failed_unreconciled',
      note: 'provider_terminal',
    });

    queueTerminalUnknown();
    const second = await retryFailedDepositRefund({
      depositId: deposit.id,
      salonId: SALON,
      actor: ownerActor(),
    });

    expect(second).toMatchObject({ ok: false, code: 'DEPOSIT_NOT_REFUNDABLE' });

    queueTerminalUnknown();
    const third = await retryFailedDepositRefund({
      depositId: deposit.id,
      salonId: SALON,
      actor: ownerActor(),
    });

    expect(third).toMatchObject({ ok: false, code: 'DEPOSIT_NOT_REFUNDABLE' });

    const blocked = await retryFailedDepositRefund({
      depositId: deposit.id,
      salonId: SALON,
      actor: ownerActor(),
    });

    expect(blocked).toMatchObject({ ok: false, code: 'DEPOSIT_NOT_REFUNDABLE' });
    expect(createRequests()).toHaveLength(3);
    expect(createRequests().map(request => request.headers['Idempotency-Key'])).toEqual([
      `deposit:${deposit.id}:auto-refund:v1:0`,
      `deposit:${deposit.id}:auto-refund:v2:1`,
      `deposit:${deposit.id}:auto-refund:v3:2`,
    ]);
    expect(await readDeposit(deposit.id)).toMatchObject({
      refundStatus: 'failed',
      refundTerminalFailureCount: 3,
      refundKeyEpoch: 3,
      refundReconcileAttempts: 1,
    });

    transport.requests.length = 0;
    transport.steps.length = 0;
    const epochCapped = await seedDeposit({
      status: 'refunded',
      refundStatus: 'failed',
      refundStatusChangedAt: new Date(Date.now() - 2 * 3_600_000),
      stripeRefundId: null,
      refundAmountCents: null,
      refundedAt: null,
      refundTrigger: 'owner',
      refundLastErrorCode: 'UNKNOWN_PROVIDER_ERROR',
      refundTerminalFailureCount: 1,
      refundKeyEpoch: 4,
    });
    queueJson(refundList([]));
    queueJson(refund('re_epoch_five_forbidden'));

    const cappedRetry = await retryFailedDepositRefund({
      depositId: epochCapped.id,
      salonId: SALON,
      actor: ownerActor(),
    });

    expect(cappedRetry).toMatchObject({ ok: false, code: 'DEPOSIT_NOT_REFUNDABLE' });
    expect(transport.requests).toHaveLength(0);
    expect(createRequests()).toHaveLength(0);
    expect(await readDeposit(epochCapped.id)).toMatchObject({
      refundStatus: 'failed',
      refundKeyEpoch: 4,
    });
  });
});

describe('D6 list-only discovery and state ordering', () => {
  it('T23 skips a non-null environment mismatch before lease or provider work', async () => {
    const deposit = await seedDeposit({ refundRequestedEnv: 'production' });

    const result = await reconcileDepositRefund(deposit);

    expect(result).toMatchObject({ disposition: 'noop', note: 'environment_mismatch' });
    expect(transport.requests).toHaveLength(0);
    expect(await readWork(deposit.id)).toBeUndefined();
    expect(await readDeposit(deposit.id)).toMatchObject({
      refundStatus: 'requested',
      refundRequestedEnv: 'production',
      refundReconcileAttempts: 0,
    });
  });

  it('T25/T26 follows real SDK pagination, adopts the later full refund, and cannot create', async () => {
    const deposit = await seedDeposit({
      refundStatus: null,
      refundStatusChangedAt: null,
      refundRequestedAt: null,
      refundRequestedBy: null,
      refundRequestedByRole: null,
      refundTrigger: null,
      refundRequestedEnv: null,
    });
    queueJson(refundList([refund('re_page_1_dead', { status: 'failed' })], true));
    queueJson(refundList([refund('re_page_2_live')], false));

    const result = await discoverAndAdoptDepositRefunds(deposit);

    expect(transport.requests.map(request => `${request.method} ${request.path}`)).toEqual([
      `GET /v1/refunds?payment_intent=${deposit.stripePaymentIntentId}&limit=100`,
      `GET /v1/refunds?payment_intent=${deposit.stripePaymentIntentId}&limit=100&starting_after=re_page_1_dead`,
    ]);
    expect(result).toEqual({
      disposition: 'refunded',
      depositId: deposit.id,
      refundId: 're_page_2_live',
    });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests.every(request => request.method === 'GET')).toBe(true);
    expect(transport.requests[1]?.path).toContain('starting_after=re_page_1_dead');
    expect(createRequests()).toHaveLength(0);
  });

  it('T26(d2/e3) sweep discovery adopts failed refunds and never creates', async () => {
    const deposit = await seedDeposit({
      status: 'waived',
      refundStatus: 'failed',
      refundTrigger: 'system_late_payment',
      refundTerminalFailureCount: 1,
    });
    await backdateDepositUpdatedAt(
      deposit.id,
      new Date(Date.now() - 7 * 60 * 60_000),
    );
    queueJson(refundList([refund('re_system_discovered')]));

    const result = await runDepositReconcile();

    expect(result.refundPass5Processed).toBe(1);
    expect(transport.requests).toHaveLength(1);
    expect(createRequests()).toHaveLength(0);
    expect(await readDeposit(deposit.id)).toMatchObject({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_system_discovered',
      refundTrigger: 'external',
    });

    transport.requests.length = 0;
    transport.steps.length = 0;
    const terminalFailed = await seedDeposit({
      status: 'refunded',
      refundStatus: 'failed',
      refundTrigger: 'owner',
      stripeRefundId: null,
      refundTerminalFailureCount: 3,
      refundLastErrorCode: 'charge_disputed',
    });
    const spentRequested = await seedDeposit({
      status: 'refunded',
      refundStatus: 'requested',
      refundTrigger: 'owner',
      stripeRefundId: null,
      refundReconcileAttempts: 3,
    });
    await backdateDepositUpdatedAt(
      terminalFailed.id,
      new Date(Date.now() - 8 * 60 * 60_000),
    );
    await backdateDepositUpdatedAt(
      spentRequested.id,
      new Date(Date.now() - 7 * 60 * 60_000),
    );
    queueJson(refundList([]));
    queueJson(refundList([]));

    const noCreateSweep = await runDepositReconcile();

    expect(noCreateSweep.refundPass5Processed).toBe(2);
    expect(transport.requests.filter(request => request.method === 'GET')).toHaveLength(2);
    expect(createRequests()).toHaveLength(0);
    expect(await readDeposit(terminalFailed.id)).toMatchObject({
      refundStatus: 'failed',
      refundKeyEpoch: 1,
      refundTerminalFailureCount: 3,
      refundLastErrorCode: 'charge_disputed',
    });
    expect(await readDeposit(spentRequested.id)).toMatchObject({
      refundStatus: 'requested',
      refundKeyEpoch: 1,
      refundReconcileAttempts: 3,
    });
  });

  it('T7 zero-row re-read recognizes the same bound object before source-status drift', async () => {
    const deposit = await seedDeposit({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_webhook_won',
      refundAmountCents: AMOUNT,
      refundedAt: new Date(),
      refundTrigger: 'system_late_payment',
    });

    const result = await stampDepositRefund({
      deposit,
      refund: {
        id: 're_webhook_won',
        status: 'succeeded',
        amount: AMOUNT,
        currency: CURRENCY,
        metadata: { luster_deposit_id: deposit.id },
      },
      allowedSourceStatuses: ['expired', 'canceled', 'checkout_created', 'waived'],
      variant: 'slot_lost',
    });

    expect(result).toMatchObject({
      ok: true,
      disposition: 'refunded',
      refundId: 're_webhook_won',
    });
    expect(sentry.captureMessage).not.toHaveBeenCalledWith(
      'deposit_already_confirmed_late_refund',
      expect.anything(),
    );
  });

  it('repairs completed payment status when a credited deposit is refunded', async () => {
    const depositOnly = await seedDeposit();
    await db.insert(schema.salonClientSchema).values({
      id: 'client_deposit_refund_stats',
      salonId: SALON,
      phone: '4165550101',
      fullName: 'Refund Client',
      totalSpent: 9000,
      loyaltyPoints: 777,
    });
    await db
      .update(schema.appointmentSchema)
      .set({
        salonClientId: 'client_deposit_refund_stats',
        status: 'completed',
        finalPriceCents: 9000,
        taxAmountCents: 1170,
        tipCents: 500,
        amountPaidCents: 0,
        paymentStatus: 'paid',
      })
      .where(eq(schema.appointmentSchema.id, depositOnly.appointmentId));

    await applyRefundObservation({
      deposit: depositOnly,
      refund: {
        id: 're_deposit_only',
        status: 'succeeded',
        amount: AMOUNT,
        currency: CURRENCY,
        metadata: {},
      },
      origin: 'webhook',
    });

    const [depositOnlyAppointment] = await db
      .select({ paymentStatus: schema.appointmentSchema.paymentStatus })
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, depositOnly.appointmentId));

    expect(depositOnlyAppointment?.paymentStatus).toBe('pending');

    const [refreshedClient] = await db
      .select({
        totalSpent: schema.salonClientSchema.totalSpent,
        loyaltyPoints: schema.salonClientSchema.loyaltyPoints,
      })
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, 'client_deposit_refund_stats'));

    expect(refreshedClient).toEqual({ totalSpent: 0, loyaltyPoints: 777 });

    const independentlyPaid = await seedDeposit();
    const invoiceCents = 10_670;
    await db
      .update(schema.appointmentSchema)
      .set({
        status: 'completed',
        finalPriceCents: 9000,
        taxAmountCents: 1170,
        tipCents: 500,
        amountPaidCents: invoiceCents,
        paymentStatus: 'paid',
      })
      .where(eq(schema.appointmentSchema.id, independentlyPaid.appointmentId));
    await db.insert(schema.appointmentPaymentSchema).values({
      id: 'pay_independent_after_refund',
      salonId: SALON,
      appointmentId: independentlyPaid.appointmentId,
      amountCents: invoiceCents,
      method: 'cash',
      recordedByType: 'admin',
      recordedById: 'admin_refund',
    });

    await applyRefundObservation({
      deposit: independentlyPaid,
      refund: {
        id: 're_independently_paid',
        status: 'succeeded',
        amount: AMOUNT,
        currency: CURRENCY,
        metadata: {},
      },
      origin: 'webhook',
    });

    const [independentlyPaidAppointment] = await db
      .select({ paymentStatus: schema.appointmentSchema.paymentStatus })
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, independentlyPaid.appointmentId));

    expect(independentlyPaidAppointment?.paymentStatus).toBe('paid');
  });

  it('never lets a historical cross-tenant payment keep a refunded invoice paid', async () => {
    const deposit = await seedDeposit();
    const invoiceCents = 10_670;
    await db
      .update(schema.appointmentSchema)
      .set({
        status: 'completed',
        finalPriceCents: 9000,
        taxAmountCents: 1170,
        tipCents: 500,
        amountPaidCents: invoiceCents,
        paymentStatus: 'paid',
      })
      .where(eq(schema.appointmentSchema.id, deposit.appointmentId));

    // 0068 protects every new row with a composite tenant FK, but deliberately
    // leaves a dirty historical cohort possible via NOT VALID. Recreate that
    // pre-constraint row locally and prove refund synchronization scopes the
    // ledger itself rather than relying on the migration being clean.
    await client.exec(`
      ALTER TABLE "appointment_payment"
      DROP CONSTRAINT "appointment_payment_appointment_tenant_fk"
    `);
    try {
      await db.insert(schema.appointmentPaymentSchema).values({
        id: 'pay_cross_tenant_after_refund',
        salonId: OTHER_SALON,
        appointmentId: deposit.appointmentId,
        amountCents: invoiceCents,
        method: 'cash',
        recordedByType: 'admin',
        recordedById: 'admin_other',
      });

      await applyRefundObservation({
        deposit,
        refund: {
          id: 're_cross_tenant',
          status: 'succeeded',
          amount: AMOUNT,
          currency: CURRENCY,
          metadata: {},
        },
        origin: 'webhook',
      });

      const [appointment] = await db
        .select({ paymentStatus: schema.appointmentSchema.paymentStatus })
        .from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, deposit.appointmentId));

      expect(appointment?.paymentStatus).toBe('pending');
    } finally {
      await db
        .delete(schema.appointmentPaymentSchema)
        .where(eq(schema.appointmentPaymentSchema.id, 'pay_cross_tenant_after_refund'));
      await client.exec(`
        ALTER TABLE "appointment_payment"
        ADD CONSTRAINT "appointment_payment_appointment_tenant_fk"
        FOREIGN KEY ("salon_id", "appointment_id")
        REFERENCES "appointment"("salon_id", "id")
        ON DELETE CASCADE
      `);
    }
  });

  it('T9/T10 permits succeeded→pending→failed for the same object without rebinding', async () => {
    const deposit = await seedDeposit({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_async',
      refundAmountCents: AMOUNT,
      refundedAt: new Date(),
    });

    await applyRefundObservation({
      deposit,
      refund: {
        id: 're_async',
        status: 'pending',
        amount: AMOUNT,
        currency: CURRENCY,
        metadata: {},
      },
      origin: 'webhook',
    });
    const pending = await readDeposit(deposit.id);
    if (!pending) {
      throw new Error('pending deposit vanished');
    }
    await applyRefundObservation({
      deposit: pending,
      refund: {
        id: 're_async',
        status: 'failed',
        amount: AMOUNT,
        currency: CURRENCY,
        failure_reason: 'declined',
        metadata: {},
      },
      origin: 'webhook',
    });

    expect(await readDeposit(deposit.id)).toMatchObject({
      status: 'refunded',
      stripeRefundId: 're_async',
      refundStatus: 'failed',
      refundFailureReason: 'declined',
    });

    const reverse = await seedDeposit({
      status: 'refunded',
      refundStatus: 'succeeded',
      stripeRefundId: 're_async_reverse',
      refundAmountCents: AMOUNT,
      refundedAt: new Date(),
    });
    await applyRefundObservation({
      deposit: reverse,
      refund: {
        id: 're_async_reverse',
        status: 'failed',
        amount: AMOUNT,
        currency: CURRENCY,
        failure_reason: 'declined',
        metadata: {},
      },
      origin: 'webhook',
    });
    const failed = await readDeposit(reverse.id);
    if (!failed) {
      throw new Error('reverse-order deposit vanished');
    }
    const stalePending = await applyRefundObservation({
      deposit: failed,
      refund: {
        id: 're_async_reverse',
        status: 'pending',
        amount: AMOUNT,
        currency: CURRENCY,
        metadata: {},
      },
      origin: 'webhook',
    });

    expect(stalePending).toMatchObject({
      applied: false,
      outcome: 'ignored_object_mismatch',
    });
    expect(await readDeposit(reverse.id)).toMatchObject({
      status: 'refunded',
      stripeRefundId: 're_async_reverse',
      refundStatus: 'failed',
      refundFailureReason: 'declined',
    });
  });
});

describe('T12/T34/T-STRUCT closed producers and vocabularies', () => {
  it('T12 derives the one key from only epoch and monotone persisted count', () => {
    expect(buildRefundIdempotencyKey({
      id: 'dep_key',
      refundKeyEpoch: 3,
      refundTerminalFailureCount: 2,
    })).toBe('deposit:dep_key:auto-refund:v3:2');
  });

  it('T34(a)/(b) maps every supported shape totally and defaults unknown codes', () => {
    const native = DEPOSIT_REFUND_ERROR_CODES.slice(0, 9);
    const luster = DEPOSIT_REFUND_ERROR_CODES.slice(9);
    const cases: unknown[] = [
      ...native.map(code => ({ code })),
      ...luster.map(code => ({ code })),
      { code: 'balance_insufficient' },
      { code: 'charge_not_refundable' },
      { code: 'future_stripe_code' },
      undefined,
      null,
      {},
      'rate_limit',
      new Error('no code'),
    ];

    for (const value of cases) {
      expect(() => mapStripeRefundErrorCode(value)).not.toThrow();
      expect(DEPOSIT_REFUND_ERROR_CODES).toContain(mapStripeRefundErrorCode(value));
    }

    expect(mapStripeRefundErrorCode({ code: 'future_stripe_code' }))
      .toBe('UNKNOWN_PROVIDER_ERROR');
    expect(mapStripeRefundErrorCode({ code: 'balance_insufficient' }))
      .toBe('UNKNOWN_PROVIDER_ERROR');
    expect(mapStripeRefundErrorCode({ code: 'charge_not_refundable' }))
      .toBe('UNKNOWN_PROVIDER_ERROR');
  });

  it('T-STRUCT has one creator, key producer and intent identity producer with no default arm', () => {
    const source = fs.readFileSync(new URL('./depositRefund.ts', import.meta.url), 'utf8');

    expect(source.match(/stripe\.refunds\.create\(/g)).toHaveLength(1);
    expect(source.match(/export function buildRefundIdempotencyKey\(/g)).toHaveLength(1);
    expect(source.match(/export function deriveRefundIntentIdentity\(/g)).toHaveLength(1);

    const resolver = source.slice(
      source.indexOf('export function resolveAllowedSourceStatuses'),
      source.indexOf('function isKnownPersistedRefundTrigger'),
    );

    expect(resolver).not.toMatch(/default\s*:/);
  });
});
