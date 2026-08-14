/**
 * The deposit money path on the Connect endpoint.
 *
 * Signature verification uses the REAL `stripe.webhooks` HMAC. Stubbing
 * `constructEvent` would let every assertion below pass against a handler that
 * authenticated nothing, which for a money path is worse than having no test.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
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
  refundsCreate: vi.fn(),
  refundsList: vi.fn(),
  refundsRetrieve: vi.fn(),
  sessionsRetrieve: vi.fn(),
}));

vi.mock('@/libs/stripe', async () => {
  const { default: RealStripe } = await vi.importActual<typeof import('stripe')>('stripe');
  const unpinned = new RealStripe('sk_test_placeholder');
  const actualModule = await vi.importActual<typeof import('@/libs/stripe')>('@/libs/stripe');
  return {
    stripe: {
      accounts: { create: vi.fn(), retrieve: vi.fn() },
      accountLinks: { create: vi.fn() },
      refunds: {
        create: stripeMock.refundsCreate,
        list: stripeMock.refundsList,
        retrieve: stripeMock.refundsRetrieve,
      },
      checkout: { sessions: { retrieve: stripeMock.sessionsRetrieve } },
      // REAL HMAC — never stub.
      webhooks: unpinned.webhooks,
    },
    EXPECTED_STRIPE_API_VERSION: actualModule.EXPECTED_STRIPE_API_VERSION,
  };
});

const { POST } = await import('./route');

const SECRET = 'ci-placeholder-not-a-secret';
const BILLING_SECRET = 'whsec_a_different_billing_secret_value';
const SALON_ID = 'salon_dep_webhook';
const OTHER_SALON_ID = 'salon_dep_other';
const ACCOUNT_ID = 'acct_dep_webhook';
const OTHER_ACCOUNT_ID = 'acct_dep_other';
const AMOUNT = 2500;

const signer = new Stripe('sk_test_placeholder');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let seq = 0;

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_dep_1',
    object: 'checkout.session',
    payment_intent: 'pi_dep_1',
    payment_status: 'paid',
    amount_total: AMOUNT,
    currency: 'cad',
    client_reference_id: null,
    metadata: {},
    ...overrides,
  };
}

function refundPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 're_dep_1',
    object: 'refund',
    amount: AMOUNT,
    currency: 'cad',
    status: 'pending',
    payment_intent: 'pi_dep_refund',
    failure_reason: null,
    metadata: {},
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `evt_dep_${seq}`,
    object: 'event',
    api_version: '2024-06-20',
    created: 1786300000,
    type: 'checkout.session.completed',
    account: ACCOUNT_ID,
    livemode: false,
    data: { object: sessionPayload() },
    ...overrides,
  };
}

function signedRequest(event: Record<string, unknown>, opts?: { secret?: string }) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({
    payload,
    secret: opts?.secret ?? SECRET,
  });
  return new Request('http://localhost/api/webhooks/stripe-connect', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': header },
  }) as unknown as NextRequest;
}

async function seedBinding(input: {
  salonId?: string;
  account?: string;
  revocationCause?: 'revoked_local' | 'deauthorized';
} = {}) {
  seq += 1;
  await db.insert(schema.salonStripeAccountSchema).values({
    id: `sacct_${seq}`,
    salonId: input.salonId ?? SALON_ID,
    stripeAccountId: input.account ?? ACCOUNT_ID,
    livemode: false,
    ...(input.revocationCause
      ? { revokedAt: new Date(), revocationCause: input.revocationCause }
      : {}),
  });
}

async function seedHold(input: {
  salonId?: string;
  account?: string;
  sessionId?: string;
  depositStatus?: string;
  appointmentStatus?: string;
} = {}) {
  seq += 1;
  const salonId = input.salonId ?? SALON_ID;
  const appointmentId = `appt_dw_${seq}`;
  const depositId = `dep_dw_${seq}`;
  const startTime = new Date(Date.now() + 86_400_000 + seq * 3_600_000);

  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    clientPhone: '4165557777',
    clientName: 'Webhook Client',
    startTime,
    endTime: new Date(startTime.getTime() + 3_600_000),
    status: input.appointmentStatus ?? 'awaiting_payment',
    totalPrice: 9000,
    totalDurationMinutes: 60,
    depositHoldExpiresAt: new Date(Date.now() + 1_800_000),
  });

  await db.insert(schema.appointmentDepositSchema).values({
    id: depositId,
    salonId,
    appointmentId,
    amountCents: AMOUNT,
    status: input.depositStatus ?? 'checkout_created',
    stripeAccountId: input.account ?? ACCOUNT_ID,
    stripeCheckoutSessionId: input.sessionId ?? 'cs_dep_1',
  });

  return { appointmentId, depositId };
}

async function readEvent(eventId: string) {
  const [row] = await db.select().from(schema.stripeWebhookEventSchema)
    .where(eq(schema.stripeWebhookEventSchema.eventId, eventId));
  return row;
}

async function readDeposit(id: string) {
  const [row] = await db.select().from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, id));
  return row;
}

async function primeRefundDeposit(input: {
  paymentIntentId?: string;
  sessionId?: string;
  refundId?: string | null;
  refundStatus?: 'requested' | 'pending' | 'succeeded' | 'failed' | null;
  depositStatus?: string;
  trigger?: 'owner' | 'system_late_payment' | 'external' | null;
} = {}) {
  const refundStatus = input.refundStatus === undefined ? 'requested' : input.refundStatus;
  const hold = await seedHold({
    depositStatus: input.depositStatus ?? 'paid',
    appointmentStatus: 'confirmed',
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  await db
    .update(schema.appointmentDepositSchema)
    .set({
      stripePaymentIntentId: input.paymentIntentId ?? 'pi_dep_refund',
      stripeRefundId: input.refundId ?? null,
      refundStatus,
      refundStatusChangedAt: refundStatus === null ? null : new Date(),
      refundTrigger: input.trigger === undefined ? 'owner' : input.trigger,
      refundRequestedAt: new Date(),
      refundRequestedBy: 'owner_webhook_test',
      refundRequestedByRole: 'admin',
      refundRequestedEnv: 'test',
    })
    .where(eq(schema.appointmentDepositSchema.id, hold.depositId));
  return hold;
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
    id: 'ref_w',
    status: 'succeeded',
    amount: AMOUNT,
    currency: 'cad',
  });

  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.appointmentAccessTokenSchema);
  await db.delete(schema.stripeWebhookEventSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.salonSchema);

  for (const id of [SALON_ID, OTHER_SALON_ID]) {
    await db.insert(schema.salonSchema).values({
      id,
      name: id,
      slug: id.replaceAll('_', '-'),
      ownerEmail: `${id}@example.com`,
    });
  }
});

// ===========================================================================
// CONTRACT
// ===========================================================================

describe('webhook contract (H3, real HMAC)', () => {
  it('rejects a body signed with the BILLING secret, and records NO row', async () => {
    // The two endpoints must not share a secret. If they did, a connected-account
    // event could reach the billing handler, which resolves its tenant from
    // `session.metadata.salonId` and never reads `event.account` — a
    // cross-tenant billing takeover.
    const event = makeEvent();

    const response = await POST(signedRequest(event, { secret: BILLING_SECRET }));

    expect(response.status).toBe(400);
    expect(await readEvent(event.id)).toBeUndefined();
  });

  it('records a row and finalizes on a valid signature', async () => {
    await seedBinding();
    const hold = await seedHold();
    const event = makeEvent({
      data: { object: sessionPayload({ metadata: { salon_id: SALON_ID } }) },
    });

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);
    expect((await readEvent(event.id))?.status).toBe('processed');
    expect((await readDeposit(hold.depositId))?.status).toBe('paid');
  });

  it('stores the normalized projection on the claim', async () => {
    await seedBinding();
    await seedHold();
    const event = makeEvent();

    await POST(signedRequest(event));
    const row = await readEvent(event.id);

    expect(row?.sessionId).toBe('cs_dep_1');
    expect(row?.paymentIntentId).toBe('pi_dep_1');
    expect(row?.amountTotal).toBe(AMOUNT);
    expect(row?.currency).toBe('cad');
    expect(row?.projectionStatus).toBe('ok');
  });

  it('stores a NULL projection and no payload for an account.* delivery', async () => {
    // TYPE SCOPE. The projection is only meaningful for session-shaped
    // payloads, and an account payload is not one.
    await seedBinding();
    const event = makeEvent({
      type: 'account.updated',
      data: { object: { id: ACCOUNT_ID, object: 'account' } },
    });

    await POST(signedRequest(event));
    const row = await readEvent(event.id);

    expect(row?.sessionId).toBeNull();
    expect(row?.rawPayload).toBeNull();
    expect(row?.projectionStatus).toBe('ok');
  });
});

// ===========================================================================
// PROVENANCE
// ===========================================================================

describe('provenance gate', () => {
  it('terminates a FOREIGN session on the FIRST delivery, with zero Stripe calls', async () => {
    // A salon's own Checkout Session on their connected account, with nothing
    // of Luster's on it. Not ours to act on — and above all, never refunded:
    // `client_reference_id` is a documented Payment-Link URL parameter, so
    // anything reachable from here is remotely triggerable by a stranger.
    await seedBinding();
    const event = makeEvent();

    const response = await POST(signedRequest(event));
    const row = await readEvent(event.id);

    expect(response.status).toBe(200);
    expect(row?.status).toBe('ignored_foreign_session');
    expect(row?.outcome).toBe('ignored_foreign_session');
    expect(row?.attempts).toBe(1);
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
    expect(stripeMock.refundsList).not.toHaveBeenCalled();
    expect(stripeMock.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it('terminates when the asserted salon is bound to NO row of this account', async () => {
    await seedBinding({ salonId: SALON_ID, account: ACCOUNT_ID });
    const event = makeEvent({
      data: { object: sessionPayload({ metadata: { salon_id: OTHER_SALON_ID } }) },
    });

    await POST(signedRequest(event));

    expect((await readEvent(event.id))?.status).toBe('ignored_foreign_session');
  });

  it('ADMITS on client_reference_id when metadata is empty', async () => {
    // The immutable leg. Session metadata is connected-account-writable after
    // creation; `client_reference_id` is not.
    await seedBinding();
    const hold = await seedHold();
    const event = makeEvent({
      data: { object: sessionPayload({ client_reference_id: hold.appointmentId }) },
    });

    await POST(signedRequest(event));

    expect((await readEvent(event.id))?.outcome).toBe('confirmed');
    expect((await readDeposit(hold.depositId))?.status).toBe('paid');
  });

  it('ADMITS per leg: garbage metadata plus a correct client_reference_id', async () => {
    await seedBinding();
    const hold = await seedHold();
    const event = makeEvent({
      data: {
        object: sessionPayload({
          metadata: { salon_id: 'salon_that_does_not_exist' },
          client_reference_id: hold.appointmentId,
        }),
      },
    });

    await POST(signedRequest(event));

    expect((await readEvent(event.id))?.outcome).toBe('confirmed');
  });

  it('does NOT terminal-ignore an account with no bindings at all', async () => {
    // The window between `accounts.create` returning and the binding INSERT
    // landing. Terminal-ignoring it loses a real deposit permanently.
    await seedHold();
    const event = makeEvent({
      data: { object: sessionPayload({ metadata: { salon_id: SALON_ID } }) },
    });

    const response = await POST(signedRequest(event));
    const row = await readEvent(event.id);

    expect(response.status).toBe(500);
    expect(row?.status).toBe('failed_retryable');
    expect(row?.outcome).toBe('unbound_account');
  });
});

// ===========================================================================
// TERMINALS AND THE STATUS/OUTCOME MIRROR
// ===========================================================================

describe('terminals', () => {
  it('mirrors each D5 terminal into BOTH status and outcome', async () => {
    // A cross-route disposition query reads `outcome`, because this route's
    // account handlers land every disposition on `status='processed'`. The
    // mirror is what keeps that query complete.
    await seedBinding();
    const hold = await seedHold();
    const event = makeEvent({
      data: {
        object: sessionPayload({
          metadata: { salon_id: SALON_ID },
          amount_total: AMOUNT - 100,
        }),
      },
    });

    await POST(signedRequest(event));
    const row = await readEvent(event.id);

    expect(row?.status).toBe('held_mismatch');
    expect(row?.outcome).toBe('held_mismatch');
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
  });

  it('records `ignored_unpaid` for an unpaid completed session', async () => {
    await seedBinding();
    await seedHold();
    const event = makeEvent({
      data: {
        object: sessionPayload({ metadata: { salon_id: SALON_ID }, payment_status: 'unpaid' }),
      },
    });

    await POST(signedRequest(event));

    expect((await readEvent(event.id))?.status).toBe('ignored_unpaid');
  });

  it('treats an unpaid `checkout.session.expired` as informational', async () => {
    // `no_payment_required` is what a salon's own expired setup, trial and
    // Payment-Link sessions carry. They must never enter the retry pipeline.
    await seedBinding();
    const event = makeEvent({
      type: 'checkout.session.expired',
      data: { object: sessionPayload({ payment_status: 'no_payment_required' }) },
    });

    const response = await POST(signedRequest(event));
    const row = await readEvent(event.id);

    expect(response.status).toBe(200);
    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('session_expired');
    expect(sentry.captureMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('critical'),
      expect.anything(),
    );
  });

  it('routes a PAID `checkout.session.expired` through the gate to routine A', async () => {
    await seedBinding();
    const hold = await seedHold();
    const event = makeEvent({
      type: 'checkout.session.expired',
      data: { object: sessionPayload({ metadata: { salon_id: SALON_ID } }) },
    });

    await POST(signedRequest(event));

    expect((await readDeposit(hold.depositId))?.status).toBe('paid');
  });

  it('records `account_mismatch` when the deposit snapshot is another account', async () => {
    await seedBinding({ salonId: SALON_ID, account: ACCOUNT_ID });
    const hold = await seedHold({ account: OTHER_ACCOUNT_ID });
    const event = makeEvent({
      data: { object: sessionPayload({ metadata: { salon_id: SALON_ID } }) },
    });

    await POST(signedRequest(event));
    const row = await readEvent(event.id);

    expect(row?.status).toBe('account_mismatch');
    expect(row?.outcome).toBe('account_mismatch');
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
  });

  it('keeps the event retryable when late recovery cannot resolve a PaymentIntent yet', async () => {
    await seedBinding();
    await seedHold({ depositStatus: 'canceled', appointmentStatus: 'cancelled' });
    stripeMock.sessionsRetrieve.mockResolvedValue({ payment_intent: null });
    const event = makeEvent({
      data: { object: sessionPayload({ metadata: { salon_id: SALON_ID } }) },
    });

    const response = await POST(signedRequest(event));
    const row = await readEvent(event.id);

    expect(response.status).toBe(500);
    expect(row?.status).toBe('failed_retryable');
    expect(row?.outcome).toBe('deferred_no_deposit');
    expect(row?.lastError).toBe('payment_intent_unresolved');
    expect(row?.processedAt).toBeNull();
    expect(row?.availableAt).not.toBeNull();
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
  });

  it('terminalizes a non-retryable recovery noop without storing a retry-lane outcome', async () => {
    await seedBinding();
    await seedHold({ depositStatus: 'refunded', appointmentStatus: 'confirmed' });
    const event = makeEvent({
      data: { object: sessionPayload({ metadata: { salon_id: SALON_ID } }) },
    });

    const response = await POST(signedRequest(event));
    const row = await readEvent(event.id);

    expect(response.status).toBe(200);
    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('refunded');
    expect(row?.processedAt).not.toBeNull();
    expect(row?.availableAt).toBeNull();
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();

    const redelivery = await POST(signedRequest(event));
    const rows = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, event.id));

    expect(redelivery.status).toBe(200);
    expect(rows).toHaveLength(1);
  });
});

// ===========================================================================
// REFUND EVENT STATE MACHINE
// ===========================================================================

describe('refund event dispatch', () => {
  it('routes refund.created through the state machine and preserves owner attribution', async () => {
    await seedBinding();
    const hold = await primeRefundDeposit();
    const event = makeEvent({
      type: 'refund.created',
      data: {
        object: refundPayload({
          id: 're_created',
          metadata: { luster_deposit_id: hold.depositId },
        }),
      },
    });

    const response = await POST(signedRequest(event));
    const deposit = await readDeposit(hold.depositId);
    const storedEvent = await readEvent(event.id);

    expect(response.status).toBe(200);
    expect(storedEvent?.status).toBe('processed');
    expect(storedEvent?.outcome).toBe('refunded');
    expect(storedEvent?.paymentIntentId).toBe('pi_dep_refund');
    expect(deposit?.stripeRefundId).toBe('re_created');
    expect(deposit?.refundStatus).toBe('pending');
    expect(deposit?.status).toBe('refunded');
    expect(deposit?.refundTrigger).toBe('owner');
    expect(deposit?.priorRefundIds).toEqual([]);
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
    expect(stripeMock.refundsList).not.toHaveBeenCalled();
  });

  it('routes refund.updated through the state machine to succeeded', async () => {
    await seedBinding();
    const hold = await primeRefundDeposit({
      refundId: 're_updated',
      refundStatus: 'pending',
      depositStatus: 'refunded',
      trigger: 'external',
    });
    const event = makeEvent({
      type: 'refund.updated',
      data: {
        object: refundPayload({ id: 're_updated', status: 'succeeded' }),
      },
    });

    const response = await POST(signedRequest(event));
    const deposit = await readDeposit(hold.depositId);
    const storedEvent = await readEvent(event.id);

    expect(response.status).toBe(200);
    expect(storedEvent?.outcome).toBe('refunded');
    expect(storedEvent?.paymentIntentId).toBe('pi_dep_refund');
    expect(deposit?.stripeRefundId).toBe('re_updated');
    expect(deposit?.refundStatus).toBe('succeeded');
    expect(deposit?.status).toBe('refunded');
    expect(sentry.captureMessage).not.toHaveBeenCalledWith(
      'deposit_refund_failed_unreconciled',
      expect.anything(),
    );
  });

  it('routes refund.failed through the state machine and proves succeeded is not absorbing', async () => {
    await seedBinding();
    const hold = await primeRefundDeposit({
      refundId: 're_failed',
      refundStatus: 'succeeded',
      depositStatus: 'refunded',
      trigger: 'external',
    });
    const event = makeEvent({
      type: 'refund.failed',
      data: {
        object: refundPayload({
          id: 're_failed',
          status: 'failed',
          failure_reason: 'declined',
        }),
      },
    });

    const response = await POST(signedRequest(event));
    const deposit = await readDeposit(hold.depositId);
    const storedEvent = await readEvent(event.id);

    expect(response.status).toBe(200);
    expect(storedEvent?.outcome).toBe('refunded');
    expect(storedEvent?.paymentIntentId).toBe('pi_dep_refund');
    expect(deposit?.refundStatus).toBe('failed');
    expect(deposit?.refundFailureReason).toBe('declined');
    expect(deposit?.status).toBe('refunded');
    expect(sentry.captureMessage).not.toHaveBeenCalledWith(
      'deposit_refund_failed_unreconciled',
      expect.anything(),
    );
  });

  it('converges when refund.updated{failed} and refund.failed arrive in either order', async () => {
    await seedBinding();
    const first = await primeRefundDeposit({
      paymentIntentId: 'pi_failure_order_a',
      sessionId: 'cs_failure_order_a',
      refundId: 're_failure_order_a',
      refundStatus: 'pending',
      depositStatus: 'refunded',
      trigger: 'external',
    });
    const second = await primeRefundDeposit({
      paymentIntentId: 'pi_failure_order_b',
      sessionId: 'cs_failure_order_b',
      refundId: 're_failure_order_b',
      refundStatus: 'pending',
      depositStatus: 'refunded',
      trigger: 'external',
    });

    const firstUpdated = makeEvent({
      type: 'refund.updated',
      data: {
        object: refundPayload({
          id: 're_failure_order_a',
          payment_intent: 'pi_failure_order_a',
          status: 'failed',
          failure_reason: 'declined',
        }),
      },
    });
    const firstFailed = makeEvent({
      type: 'refund.failed',
      data: {
        object: refundPayload({
          id: 're_failure_order_a',
          payment_intent: 'pi_failure_order_a',
          status: 'failed',
          failure_reason: 'declined',
        }),
      },
    });
    const secondUpdated = makeEvent({
      type: 'refund.updated',
      data: {
        object: refundPayload({
          id: 're_failure_order_b',
          payment_intent: 'pi_failure_order_b',
          status: 'failed',
          failure_reason: 'declined',
        }),
      },
    });
    const secondFailed = makeEvent({
      type: 'refund.failed',
      data: {
        object: refundPayload({
          id: 're_failure_order_b',
          payment_intent: 'pi_failure_order_b',
          status: 'failed',
          failure_reason: 'declined',
        }),
      },
    });

    for (const event of [firstUpdated, firstFailed, secondFailed, secondUpdated]) {
      expect((await POST(signedRequest(event))).status).toBe(200);
      expect((await readEvent(event.id))?.outcome).toBe('refunded');
    }

    const firstDeposit = await readDeposit(first.depositId);
    const secondDeposit = await readDeposit(second.depositId);

    expect(firstDeposit?.refundStatus).toBe('failed');
    expect(secondDeposit?.refundStatus).toBe('failed');
    expect(firstDeposit?.refundTerminalFailureCount).toBe(1);
    expect(secondDeposit?.refundTerminalFailureCount).toBe(1);
    expect(firstDeposit?.priorRefundIds).toEqual([]);
    expect(secondDeposit?.priorRefundIds).toEqual([]);

    const firstAlerts = await db
      .select()
      .from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, first.appointmentId));
    const secondAlerts = await db
      .select()
      .from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, second.appointmentId));

    expect(firstAlerts).toHaveLength(1);
    expect(secondAlerts).toHaveLength(1);
    expect(sentry.captureMessage).not.toHaveBeenCalledWith(
      'deposit_refund_failed_unreconciled',
      expect.anything(),
    );
  });

  it('treats an id-bearing event for a retired refund as a benign no-op without re-binding it', async () => {
    await seedBinding();
    const hold = await primeRefundDeposit();
    await db
      .update(schema.appointmentDepositSchema)
      .set({ priorRefundIds: ['re_retired'] })
      .where(eq(schema.appointmentDepositSchema.id, hold.depositId));
    const event = makeEvent({
      type: 'refund.created',
      data: {
        object: refundPayload({ id: 're_retired', status: 'succeeded' }),
      },
    });

    const response = await POST(signedRequest(event));
    const deposit = await readDeposit(hold.depositId);

    expect(response.status).toBe(200);
    expect((await readEvent(event.id))?.outcome).toBe('refunded');
    expect(deposit?.stripeRefundId).toBeNull();
    expect(deposit?.refundStatus).toBe('requested');
    expect(deposit?.status).toBe('paid');
    expect(deposit?.priorRefundIds).toEqual(['re_retired']);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('keeps an unmatched refund ignored_unhandled with no alert', async () => {
    await seedBinding();
    const event = makeEvent({
      type: 'refund.updated',
      data: {
        object: refundPayload({
          id: 're_foreign',
          payment_intent: 'pi_not_a_luster_deposit',
          status: 'succeeded',
        }),
      },
    });

    const response = await POST(signedRequest(event));
    const storedEvent = await readEvent(event.id);

    expect(response.status).toBe(200);
    expect(storedEvent?.status).toBe('processed');
    expect(storedEvent?.outcome).toBe('ignored_unhandled');
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
    expect(stripeMock.refundsList).not.toHaveBeenCalled();
  });

  it('retains the money-dark terminal and emits exactly one alert when a matched event is unappliable', async () => {
    await seedBinding();
    const hold = await primeRefundDeposit({
      refundId: 're_bound',
      refundStatus: 'pending',
      depositStatus: 'refunded',
      trigger: 'external',
    });
    const event = makeEvent({
      type: 'refund.updated',
      data: {
        object: refundPayload({ id: 're_other', status: 'succeeded' }),
      },
    });

    const response = await POST(signedRequest(event));
    const storedEvent = await readEvent(event.id);
    const deposit = await readDeposit(hold.depositId);

    expect(response.status).toBe(200);
    expect(storedEvent?.status).toBe('processed');
    expect(storedEvent?.outcome).toBe('refund_failed_unreconciled');
    expect(storedEvent?.paymentIntentId).toBe('pi_dep_refund');
    expect(deposit?.stripeRefundId).toBe('re_bound');
    expect(deposit?.refundStatus).toBe('pending');
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'deposit_refund_failed_unreconciled',
      expect.objectContaining({
        level: 'error',
        extra: expect.objectContaining({
          eventId: event.id,
          depositId: hold.depositId,
        }),
      }),
    );
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
    expect(stripeMock.refundsList).not.toHaveBeenCalled();
    expect(stripeMock.refundsRetrieve).not.toHaveBeenCalled();
  });
});

describe('charge.refunded configuration-drift fallback', () => {
  it('lists to adopt without creating and retains the money-dark terminal when discovery cannot adopt', async () => {
    await seedBinding();
    const hold = await primeRefundDeposit({
      paymentIntentId: 'pi_charge_refunded',
      refundStatus: null,
      trigger: null,
    });
    stripeMock.refundsList.mockResolvedValue({
      data: [{
        id: 're_charge_refunded',
        object: 'refund',
        amount: AMOUNT,
        currency: 'cad',
        status: 'succeeded',
        failure_reason: null,
        metadata: {},
      }],
      has_more: false,
    });
    const event = makeEvent({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_refunded',
          object: 'charge',
          payment_intent: 'pi_charge_refunded',
        },
      },
    });

    const response = await POST(signedRequest(event));
    const deposit = await readDeposit(hold.depositId);
    const storedEvent = await readEvent(event.id);

    expect(response.status).toBe(200);
    expect(storedEvent?.outcome).toBe('refunded');
    expect(storedEvent?.paymentIntentId).toBe('pi_charge_refunded');
    expect(stripeMock.refundsList).toHaveBeenCalledTimes(1);
    expect(stripeMock.refundsList).toHaveBeenCalledWith(
      { payment_intent: 'pi_charge_refunded', limit: 100 },
      { stripeAccount: ACCOUNT_ID, timeout: 10_000 },
    );
    expect(stripeMock.refundsRetrieve).not.toHaveBeenCalled();
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
    expect(deposit?.stripeRefundId).toBe('re_charge_refunded');
    expect(deposit?.refundStatus).toBe('succeeded');
    expect(deposit?.status).toBe('refunded');
    expect(deposit?.refundTrigger).toBe('external');

    const moneyDarkHold = await primeRefundDeposit({
      paymentIntentId: 'pi_charge_refunded_money_dark',
      sessionId: 'cs_charge_refunded_money_dark',
      refundStatus: null,
      trigger: null,
    });
    stripeMock.refundsList.mockResolvedValue({ data: [], has_more: false });
    const moneyDarkEvent = makeEvent({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_refunded_money_dark',
          object: 'charge',
          payment_intent: 'pi_charge_refunded_money_dark',
        },
      },
    });

    const moneyDarkResponse = await POST(signedRequest(moneyDarkEvent));
    const moneyDarkStoredEvent = await readEvent(moneyDarkEvent.id);
    const moneyDarkDeposit = await readDeposit(moneyDarkHold.depositId);

    expect(moneyDarkResponse.status).toBe(200);
    expect(moneyDarkStoredEvent?.outcome).toBe('refund_failed_unreconciled');
    expect(moneyDarkStoredEvent?.paymentIntentId).toBe('pi_charge_refunded_money_dark');
    expect(moneyDarkDeposit?.stripeRefundId).toBeNull();
    expect(moneyDarkDeposit?.refundStatus).toBeNull();
    expect(moneyDarkDeposit?.status).toBe('paid');
    expect(stripeMock.refundsList).toHaveBeenCalledTimes(2);
    expect(stripeMock.refundsList).toHaveBeenNthCalledWith(
      2,
      { payment_intent: 'pi_charge_refunded_money_dark', limit: 100 },
      { stripeAccount: ACCOUNT_ID, timeout: 10_000 },
    );
    expect(stripeMock.refundsRetrieve).not.toHaveBeenCalled();
    expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// REDELIVERY
// ===========================================================================

describe('redelivery of a guard-terminal event', () => {
  it('acks the SAME event id a second time with zero new rows and no 500', async () => {
    // The leg that distinguishes fused-first from guards-first. Recording a
    // guard terminal with a plain INSERT would raise 23505 on this second
    // delivery and turn it into a three-day redelivery loop.
    await seedBinding();
    const event = makeEvent({ account: undefined });

    const first = await POST(signedRequest(event));
    const second = await POST(signedRequest(event));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // The scope guard is the SIBLING route's, and it lands every disposition on
    // `status='processed'` with the classification in `outcome`. That asymmetry
    // is exactly why a cross-route disposition query keys on `outcome`: keyed
    // on `status`, this row is invisible.
    const row = await readEvent(event.id);

    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('ignored_non_connect_scope');

    const rows = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.eventId, event.id));

    expect(rows).toHaveLength(1);
  });

  it('acks an idempotent redelivery of a CONFIRMED deposit without a second batch', async () => {
    await seedBinding();
    const hold = await seedHold();
    const first = makeEvent({
      data: { object: sessionPayload({ metadata: { salon_id: SALON_ID } }) },
    });
    const second = makeEvent({
      data: { object: sessionPayload({ metadata: { salon_id: SALON_ID } }) },
    });

    await POST(signedRequest(first));
    await POST(signedRequest(second));

    expect((await readEvent(second.id))?.outcome).toBe('already_confirmed');

    const jobs = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, hold.appointmentId));

    expect(jobs).toHaveLength(1);
  });
});
