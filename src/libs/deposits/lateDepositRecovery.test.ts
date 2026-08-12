/**
 * Routine B — restore-or-refund, and the refund core.
 *
 * The refund core is the only place D5 moves money OUT, so the legs here are
 * about the two ways that goes wrong: refunding twice, and refunding something
 * that was not ours to refund.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

/**
 * Harness H4 — the Stripe SDK mocked at the MODULE boundary.
 *
 * Every call is recorded with its request options, so the tests can assert the
 * three things that make a deposit refund safe: it ran on the deposit's
 * snapshot account, it carried the column-derived idempotency key, and it
 * carried an explicit timeout (the shared client sets none).
 */
const stripeMock = vi.hoisted(() => ({
  refunds: {
    create: vi.fn(),
    list: vi.fn(),
    retrieve: vi.fn(),
  },
  checkout: {
    sessions: { retrieve: vi.fn() },
  },
}));

vi.mock('@/libs/stripe', () => ({
  stripe: stripeMock,
  EXPECTED_STRIPE_API_VERSION: '2024-06-20',
}));

/* eslint-disable import/first */
import {
  buildRefundIdempotencyKey,
  DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
  deriveRefundIntentIdentity,
  resolveAllowedSourceStatuses,
  runLateDepositRecovery,
} from './lateDepositRecovery';
/* eslint-enable import/first */

const SALON = 'salon_recovery';
const ACCOUNT = 'acct_recovery';
const SALON_CLIENT = 'sc_recovery';
const AMOUNT = 2500;

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let seq = 0;

function refund(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ref_1',
    status: 'succeeded',
    amount: AMOUNT,
    currency: 'cad',
    ...overrides,
  };
}

async function seedDeposit(input: {
  status: string;
  appointmentStatus?: string;
  cancelReason?: string | null;
  paymentIntentId?: string | null;
  refundId?: string | null;
  refundKeyEpoch?: number;
  refundTerminalFailureCount?: number;
  startTimeOffsetMs?: number;
  appliedRewardId?: string | null;
}) {
  seq += 1;
  const appointmentId = `appt_r_${seq}`;
  const depositId = `dep_r_${seq}`;
  const startTime = new Date(Date.now() + (input.startTimeOffsetMs ?? 86_400_000) + seq * 3_600_000);

  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId: SALON,
    clientPhone: '4165559999',
    clientName: 'Recovery Client',
    // A real canonical client, because the restore path locks it before it
    // reads the lineage gate — that lock is the reason the gate is safe.
    salonClientId: SALON_CLIENT,
    startTime,
    endTime: new Date(startTime.getTime() + 3_600_000),
    status: input.appointmentStatus ?? 'cancelled',
    cancelReason: input.cancelReason === undefined ? 'deposit_not_paid' : input.cancelReason,
    totalPrice: 9000,
    totalDurationMinutes: 60,
  });

  await db.insert(schema.appointmentDepositSchema).values({
    id: depositId,
    salonId: SALON,
    appointmentId,
    amountCents: AMOUNT,
    status: input.status,
    stripeAccountId: ACCOUNT,
    stripeCheckoutSessionId: `cs_r_${seq}`,
    stripePaymentIntentId: input.paymentIntentId === undefined ? 'pi_r' : input.paymentIntentId,
    stripeRefundId: input.refundId ?? null,
    refundKeyEpoch: input.refundKeyEpoch ?? 1,
    refundTerminalFailureCount: input.refundTerminalFailureCount ?? 0,
    appliedRewardId: input.appliedRewardId ?? null,
    appliedRewardClientId: input.appliedRewardId ? SALON_CLIENT : null,
    appliedRewardClientPhone: input.appliedRewardId ? '4165559999' : null,
  });

  return { appointmentId, depositId };
}

async function readDeposit(id: string) {
  const [row] = await db.select().from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, id));
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
  stripeMock.refunds.list.mockResolvedValue({ data: [] });
  stripeMock.refunds.create.mockResolvedValue(refund());
  stripeMock.refunds.retrieve.mockResolvedValue(refund());

  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.stripeWebhookEventSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonClientSchema);
  await db.delete(schema.salonSchema);

  await db.insert(schema.salonSchema).values({
    id: SALON,
    name: 'Recovery Salon',
    slug: 'recovery-salon',
    ownerEmail: 'owner@example.com',
  });

  await db.insert(schema.salonClientSchema).values({
    id: SALON_CLIENT,
    salonId: SALON,
    phone: '4165559999',
    fullName: 'Recovery Client',
  });
});

afterAll(async () => {
  await client.close();
});

// ===========================================================================
// THE ENTRY SET — ONE PRODUCER
// ===========================================================================

describe('resolveAllowedSourceStatuses', () => {
  it('returns a set CONTAINING the deposit status, for every status in the vocabulary', () => {
    // A set that excludes its own input means the entry gate admits a refund
    // the CAS then refuses: money with no arrow and a sweep that re-drives.
    for (const status of ['checkout_created', 'paid', 'expired', 'canceled', 'refunded', 'waived']) {
      const allowed = resolveAllowedSourceStatuses({ status });

      expect(allowed.length).toBeGreaterThan(0);
      expect(allowed).toContain(status);
    }
  });

  it('ADMITS an adopted external refund on an already-refunded deposit', () => {
    // Every adopted salon-Dashboard refund carries status='refunded'. An
    // `otherwise` arm handing back the system four rejects them, the sweep
    // re-drives forever, and an owner Retry becomes a no-op with zero provider
    // calls.
    const allowed = resolveAllowedSourceStatuses({ status: 'refunded', refundTrigger: 'external' });

    expect(allowed).toEqual(['paid', 'refunded']);
  });

  it('keeps `waived` in the system set', () => {
    // Drop it and the waived-plus-paid branch loops back to the top forever,
    // and the refund it promises never runs.
    expect(resolveAllowedSourceStatuses({ status: 'waived' })).toContain('waived');
  });

  it('gives an owner trigger the paid/refunded set', () => {
    expect(resolveAllowedSourceStatuses({ status: 'expired', refundTrigger: 'owner' }))
      .toEqual(['paid', 'refunded']);
  });
});

describe('deriveRefundIntentIdentity', () => {
  it('is the single producer of BOTH the type literal and the event id', () => {
    // The unique event id IS the dedupe, so one literal spelled at two call
    // sites is two dedupe namespaces and two concurrent refunds.
    expect(deriveRefundIntentIdentity('system', 'dep_1', 1)).toEqual({
      type: 'luster.refund_intent',
      eventId: 'luster:luster.refund_intent:dep_1:e1',
    });
    expect(deriveRefundIntentIdentity('owner', 'dep_1', 2)).toEqual({
      type: 'luster.owner_refund_intent',
      eventId: 'luster:luster.owner_refund_intent:dep_1:e2',
    });
  });

  it('changes the event id with the epoch, so a saved provider error cannot pin an attempt', () => {
    expect(deriveRefundIntentIdentity('system', 'dep_1', 1).eventId)
      .not.toBe(deriveRefundIntentIdentity('system', 'dep_1', 2).eventId);
  });
});

describe('buildRefundIdempotencyKey', () => {
  it('is byte-identical to the pre-epoch form at epoch 1, count 0', () => {
    expect(buildRefundIdempotencyKey({
      id: 'dep_1',
      refundKeyEpoch: 1,
      refundTerminalFailureCount: 0,
    })).toBe('deposit:dep_1:auto-refund:v1:0');
  });
});

// ===========================================================================
// DISPATCH ON A FRESH READ
// ===========================================================================

describe('runLateDepositRecovery dispatch', () => {
  it('NEVER refunds a deposit that has since been confirmed', async () => {
    const seeded = await seedDeposit({ status: 'paid', appointmentStatus: 'confirmed' });

    const result = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(result.disposition).toBe('already_confirmed');
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it('is a no-op on an already-refunded deposit', async () => {
    const seeded = await seedDeposit({ status: 'refunded' });

    const result = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(result.disposition).toBe('noop');
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it('REFUNDS a waived deposit and alerts — never a silent no-op', async () => {
    const seeded = await seedDeposit({ status: 'waived', appointmentStatus: 'confirmed' });

    const result = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(result.disposition).toBe('refunded');
    expect((await readDeposit(seeded.depositId))?.status).toBe('refunded');
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'deposit_waived_with_payment',
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('sends the WAIVER copy variant, not the slot-lost one', async () => {
    // "The time is no longer available" is FALSE for a waiver — the booking
    // still stands — and sending it would talk a client out of an appointment
    // they still have.
    const seeded = await seedDeposit({ status: 'waived', appointmentStatus: 'confirmed' });

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    const [job] = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.operation, 'deposit_refund_notices'));

    expect((job?.payload as { variant?: string }).variant).toBe('waiver');
  });

  it('refunds an injected `canceled` deposit rather than restoring it', async () => {
    const seeded = await seedDeposit({ status: 'canceled' });

    const result = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(result.disposition).toBe('refunded');
  });

  it('refunds when the cancel was NOT the reaper', async () => {
    // An owner who reactivated a hold and then cancelled it deliberately must
    // not have that decision overridden by a late payment.
    const seeded = await seedDeposit({ status: 'expired', cancelReason: 'client_request' });

    const result = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(result.disposition).toBe('refunded');
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, seeded.appointmentId)))[0]?.status).toBe('cancelled');
  });

  it('refunds when the appointment start time has already passed', async () => {
    const seeded = await seedDeposit({ status: 'expired', startTimeOffsetMs: -86_400_000 });

    const result = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(result.disposition).toBe('refunded');
  });

  it('RESTORES a reaper-released hold whose slot is still free', async () => {
    const seeded = await seedDeposit({ status: 'expired' });

    const result = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(result.disposition).toBe('restored');
    expect((await readDeposit(seeded.depositId))?.status).toBe('paid');

    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, seeded.appointmentId));

    expect(appointment?.status).toBe('pending');
    expect(appointment?.cancelReason).toBeNull();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it('carries the exact reward attribution through a successful late restore', async () => {
    await db.insert(schema.rewardSchema).values({
      id: 'reward_restore_exact',
      salonId: SALON,
      clientPhone: '4165559999',
      type: 'referral_referee',
    });
    const seeded = await seedDeposit({
      status: 'expired',
      appliedRewardId: 'reward_restore_exact',
    });

    const result = await runLateDepositRecovery({
      depositId: seeded.depositId,
      salonId: SALON,
    });

    expect(result.disposition).toBe('restored');

    const [job] = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.operation, 'booking_confirmed_side_effects'));

    expect(job?.payload).toEqual(expect.objectContaining({
      depositId: seeded.depositId,
      appliedRewardId: 'reward_restore_exact',
    }));
    // The exact mark is atomic with the paid transition; the outbox only
    // verifies it on replay.
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_restore_exact')))[0]?.usedInAppointmentId)
      .toBe(seeded.appointmentId);
  });

  it('refunds instead of stealing a reward re-attributed after hold expiry', async () => {
    await db.insert(schema.rewardSchema).values({
      id: 'reward_restore_reassigned',
      salonId: SALON,
      clientPhone: '4165559999',
      type: 'referral_referee',
    });
    const original = await seedDeposit({
      status: 'expired',
      appliedRewardId: 'reward_restore_reassigned',
    });
    const competing = await seedDeposit({
      status: 'checkout_created',
      appointmentStatus: 'awaiting_payment',
      cancelReason: null,
      paymentIntentId: null,
      appliedRewardId: 'reward_restore_reassigned',
    });

    const result = await runLateDepositRecovery({
      depositId: original.depositId,
      salonId: SALON,
    });

    expect(result.disposition).toBe('refunded');
    expect((await readDeposit(original.depositId))?.status).toBe('refunded');
    expect((await readDeposit(competing.depositId))?.status).toBe('checkout_created');
    expect(await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.operation, 'booking_confirmed_side_effects')))
      .toHaveLength(0);
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_restore_reassigned')))[0]?.usedInAppointmentId)
      .toBeNull();
  });

  it('refunds when an ordinary booking consumed the reward after hold expiry', async () => {
    const consumingAppointmentId = 'appt_reward_consumed_after_expiry';
    await db.insert(schema.appointmentSchema).values({
      id: consumingAppointmentId,
      salonId: SALON,
      clientPhone: '4165559999',
      startTime: new Date('2026-01-01T10:00:00.000Z'),
      endTime: new Date('2026-01-01T11:00:00.000Z'),
      status: 'completed',
      totalPrice: 4000,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.rewardSchema).values({
      id: 'reward_restore_consumed',
      salonId: SALON,
      clientPhone: '4165559999',
      type: 'referral_referee',
      usedInAppointmentId: consumingAppointmentId,
    });
    const original = await seedDeposit({
      status: 'expired',
      appliedRewardId: 'reward_restore_consumed',
    });

    const result = await runLateDepositRecovery({
      depositId: original.depositId,
      salonId: SALON,
    });

    expect(result.disposition).toBe('refunded');
    expect((await readDeposit(original.depositId))?.status).toBe('refunded');
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_restore_consumed')))[0]?.usedInAppointmentId)
      .toBe(consumingAppointmentId);
    expect(await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.operation, 'booking_confirmed_side_effects')))
      .toHaveLength(0);
  });
});

// ===========================================================================
// THE REFUND CORE
// ===========================================================================

describe('refund core', () => {
  it('calls Stripe on the SNAPSHOT account with an explicit timeout', async () => {
    // The shared client sets no timeout by an explicit unsigned sign-off, so
    // without a per-call value the sweep is bounded only by the platform
    // function timeout. And `stripeAccount: undefined` would execute on the
    // PLATFORM account — refunding Luster's money instead of the salon's.
    const seeded = await seedDeposit({ status: 'canceled' });

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_r' },
      expect.objectContaining({
        stripeAccount: ACCOUNT,
        timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
      }),
    );
    expect(stripeMock.refunds.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stripeAccount: ACCOUNT, timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS }),
    );
  });

  it('omits `amount` — full refunds only', async () => {
    const seeded = await seedDeposit({ status: 'canceled' });

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(stripeMock.refunds.create.mock.calls[0]?.[0]).not.toHaveProperty('amount');
  });

  it('writes the WRITE-AHEAD intent row BEFORE any provider call', async () => {
    // Without it, a crash between `refunds.create` and TX-D leaves a live
    // refund with nothing local pointing at it, and no sweep able to find it.
    let intentRowsAtCreateTime = -1;
    stripeMock.refunds.create.mockImplementation(async () => {
      intentRowsAtCreateTime = (await db.select().from(schema.stripeWebhookEventSchema)).length;
      return refund();
    });

    const seeded = await seedDeposit({ status: 'canceled' });
    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(intentRowsAtCreateTime).toBe(1);

    const [row] = await db.select().from(schema.stripeWebhookEventSchema);

    expect(row?.type).toBe('luster.refund_intent');
    expect(row?.eventId).toBe(`luster:luster.refund_intent:${seeded.depositId}:e1`);
    expect(row?.metadataDepositId).toBe(seeded.depositId);
  });

  it('ADOPTS an existing live refund of the full amount instead of creating a second', async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [refund({ id: 'ref_existing' })] });
    const seeded = await seedDeposit({ status: 'canceled' });

    const result = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(result.refundId).toBe('ref_existing');
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it('does NOT adopt a partial refund on the same payment intent', async () => {
    // A salon's own CA$5 goodwill refund must never discharge a CA$25 deposit.
    stripeMock.refunds.list.mockResolvedValue({ data: [refund({ id: 'ref_partial', amount: 500 })] });
    const seeded = await seedDeposit({ status: 'canceled' });

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(stripeMock.refunds.create).toHaveBeenCalled();
  });

  it('does NOT adopt a refund in a different currency', async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [refund({ id: 'ref_usd', currency: 'usd' })] });
    const seeded = await seedDeposit({ status: 'canceled' });

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(stripeMock.refunds.create).toHaveBeenCalled();
  });

  it('does NOT re-adopt a CORPSE, and bumps the persisted failure count', async () => {
    // A refund that reached `failed` discharges nothing. Re-adopting it every
    // run is a permanent trap: the money never goes back and nothing escalates.
    stripeMock.refunds.list.mockResolvedValue({
      data: [refund({ id: 'ref_dead', status: 'failed' })],
    });
    const seeded = await seedDeposit({ status: 'canceled' });

    const result = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(stripeMock.refunds.create).toHaveBeenCalled();
    expect(result.refundId).toBe('ref_1');
    expect((await readDeposit(seeded.depositId))?.refundTerminalFailureCount).toBe(1);
  });

  it('derives the idempotency key from the COLUMNS, not from the listing', async () => {
    // T74's direction, and the only one that discriminates: the persisted count
    // is 2 while the current listing shows ONE corpse (the second aged out of a
    // paginated listing). A listing-derived key mints `v1:1`; a
    // column-derived one mints `v1:2`.
    stripeMock.refunds.list.mockResolvedValue({
      data: [refund({ id: 'ref_dead', status: 'failed' })],
    });
    const seeded = await seedDeposit({ status: 'canceled', refundTerminalFailureCount: 2 });

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: `deposit:${seeded.depositId}:auto-refund:v1:2`,
      }),
    );
    // GREATEST(2, 1) = 2 — a no-op in value, but a real committed statement.
    expect((await readDeposit(seeded.depositId))?.refundTerminalFailureCount).toBe(2);
  });

  it('COMMITS the count before the create reads it', async () => {
    let countAtCreateTime = -1;
    stripeMock.refunds.list.mockResolvedValue({
      data: [refund({ id: 'ref_dead', status: 'failed' })],
    });
    stripeMock.refunds.create.mockImplementation(async () => {
      const [row] = await db.select().from(schema.appointmentDepositSchema);
      countAtCreateTime = row?.refundTerminalFailureCount ?? -1;
      return refund();
    });

    const seeded = await seedDeposit({ status: 'canceled' });
    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(countAtCreateTime).toBe(1);
  });

  it('carries the epoch into the key', async () => {
    const seeded = await seedDeposit({ status: 'canceled', refundKeyEpoch: 3 });

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: `deposit:${seeded.depositId}:auto-refund:v3:0`,
      }),
    );
  });

  it('issues EXACTLY ONE refund across two sequential runs', async () => {
    const seeded = await seedDeposit({ status: 'canceled' });

    const first = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });
    const second = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(first.disposition).toBe('refunded');
    expect(second.disposition).toBe('noop');
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
  });

  it('stamps `refunded_at` ONCE and keeps the first instant', async () => {
    const seeded = await seedDeposit({ status: 'canceled' });

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });
    const firstStamp = (await readDeposit(seeded.depositId))?.refundedAt;

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect((await readDeposit(seeded.depositId))?.refundedAt?.getTime()).toBe(firstStamp?.getTime());
  });

  it('writes one audit row and enqueues the notices INSIDE the refund transaction', async () => {
    const seeded = await seedDeposit({ status: 'canceled' });

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    const audits = await db.select().from(schema.appointmentAuditLogSchema)
      .where(eq(schema.appointmentAuditLogSchema.appointmentId, seeded.appointmentId));

    expect(audits).toHaveLength(1);
    expect(audits[0]?.reason).toBe('deposit_refunded');

    const jobs = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.operation, 'deposit_refund_notices'));

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.dedupeKey).toBe(`deposit:${seeded.depositId}:refund-notices:ref_1`);
  });

  it('retrieves the payment intent from the session when the column is null', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ payment_intent: 'pi_from_session' });
    const seeded = await seedDeposit({ status: 'canceled', paymentIntentId: null });

    await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ stripeAccount: ACCOUNT, timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS }),
    );
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_from_session' },
      expect.anything(),
    );
  });

  it('adopts on `charge_already_refunded` rather than failing', async () => {
    stripeMock.refunds.create.mockRejectedValue(
      Object.assign(new Error('already refunded'), { code: 'charge_already_refunded' }),
    );
    stripeMock.refunds.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [refund({ id: 'ref_outofband' })] });

    const seeded = await seedDeposit({ status: 'canceled' });
    const result = await runLateDepositRecovery({ depositId: seeded.depositId, salonId: SALON });

    expect(result.disposition).toBe('refunded');
    expect(result.refundId).toBe('ref_outofband');
  });
});
