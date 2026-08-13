/**
 * `confirmDepositPayment` — the single writer of `deposit = paid` and of the
 * transition out of `awaiting_payment`.
 *
 * Every leg here is written against a specific wrong answer. The five gates and
 * the seven-way dispatch are where a deposit either becomes a booking, becomes
 * a manual decision, or waits — and each of those is a different way to lose
 * real money, so none of them is asserted by shape alone.
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

/* eslint-disable import/first */
import { confirmDepositPayment, type DepositEvidence } from './confirmDepositPayment';
/* eslint-enable import/first */

const SALON = 'salon_confirm';
const FREE_SOLO_SALON = 'salon_freesolo';
const OTHER_SALON = 'salon_other';
const ACCOUNT = 'acct_confirm';
const OTHER_ACCOUNT = 'acct_other';
const FREE_SOLO_ACCOUNT = 'acct_freesolo';
const AMOUNT = 2500;

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let seq = 0;

function evidence(overrides: Partial<DepositEvidence> = {}): DepositEvidence {
  return {
    source: 'webhook',
    connectedAccountId: ACCOUNT,
    sessionId: 'cs_1',
    paymentIntentId: 'pi_1',
    paymentStatus: 'paid',
    amountTotal: AMOUNT,
    currency: 'cad',
    metadataAppointmentId: null,
    metadataSalonId: null,
    metadataDepositId: null,
    ...overrides,
  };
}

async function seedBinding(input: {
  salonId: string;
  account: string;
  revocationCause?: 'revoked_local' | 'deauthorized';
}) {
  seq += 1;
  await db.insert(schema.salonStripeAccountSchema).values({
    id: `ssa_${seq}`,
    salonId: input.salonId,
    stripeAccountId: input.account,
    livemode: false,
    ...(input.revocationCause
      ? { revokedAt: new Date(), revocationCause: input.revocationCause }
      : {}),
  });
}

/** One hold: an appointment in `awaiting_payment` plus its `checkout_created` deposit. */
async function seedHold(input: {
  salonId?: string;
  account?: string;
  appointmentStatus?: string;
  depositStatus?: string;
  sessionId?: string;
  amountCents?: number;
  paymentIntentId?: string | null;
} = {}) {
  seq += 1;
  const salonId = input.salonId ?? SALON;
  const appointmentId = `appt_${seq}`;
  const depositId = `dep_${seq}`;
  const startTime = new Date(Date.now() + 86_400_000 + seq * 3_600_000);

  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    clientPhone: '4165551234',
    clientName: 'Confirm Client',
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
    amountCents: input.amountCents ?? AMOUNT,
    status: input.depositStatus ?? 'checkout_created',
    stripeAccountId: input.account ?? ACCOUNT,
    stripeCheckoutSessionId: input.sessionId ?? `cs_${seq}`,
    stripePaymentIntentId: input.paymentIntentId ?? null,
  });

  return { appointmentId, depositId, sessionId: input.sessionId ?? `cs_${seq}` };
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

async function outboxRows(appointmentId: string) {
  return db.select().from(schema.integrationOutboxSchema)
    .where(eq(schema.integrationOutboxSchema.appointmentId, appointmentId));
}

async function auditRows(appointmentId: string) {
  return db.select().from(schema.appointmentAuditLogSchema)
    .where(eq(schema.appointmentAuditLogSchema.appointmentId, appointmentId));
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
  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.appointmentAccessTokenSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.salonSchema);

  for (const [id, freeSolo] of [[SALON, false], [FREE_SOLO_SALON, true], [OTHER_SALON, false]] as const) {
    await db.insert(schema.salonSchema).values({
      id,
      name: id,
      slug: id.replaceAll('_', '-'),
      ownerEmail: `${id}@example.com`,
      freeSoloEnabled: freeSolo,
    });
  }
});

afterAll(async () => {
  await client.close();
});

// ===========================================================================
// GATE 1 — BINDINGS
// ===========================================================================

describe('gate 1 — account bindings', () => {
  it('is RETRYABLE, not terminal, when the account has no binding rows at all', async () => {
    // The window between `accounts.create` returning and the binding INSERT
    // landing. A terminal here loses a real deposit permanently, because
    // Stripe never redelivers an acked event.
    const hold = await seedHold();

    const result = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

    expect(result.disposition).toBe('unbound_account');
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
    expect((await readAppointment(hold.appointmentId))?.status).toBe('awaiting_payment');
  });

  it('PROCEEDS through a `revoked_local` pair row', async () => {
    // A local UI unlink must not freeze money the client has already paid.
    // Authorization comes from the deposit snapshot and legs (b)/(c), not from
    // the link state.
    await seedBinding({ salonId: SALON, account: ACCOUNT, revocationCause: 'revoked_local' });
    const hold = await seedHold();

    const result = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

    expect(result.disposition).toBe('confirmed');
    expect((await readDeposit(hold.depositId))?.status).toBe('paid');
  });

  it('holds off on a `deauthorized` pair row, retryably and with zero writes', async () => {
    await seedBinding({ salonId: SALON, account: ACCOUNT, revocationCause: 'deauthorized' });
    const hold = await seedHold();

    const result = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

    expect(result.disposition).toBe('unbound_account');
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
  });

  it('is TERMINAL account_mismatch when the pair row is ABSENT — the cross-salon leg', async () => {
    // The account has rows, but none — live or revoked — for this deposit's
    // salon. That is two different tenants, so it is an alert, not a three-day
    // retry that re-alerts up to 72 times.
    await seedBinding({ salonId: OTHER_SALON, account: ACCOUNT });
    const hold = await seedHold({ salonId: SALON });

    const result = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

    expect(result.disposition).toBe('account_mismatch');
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'deposit_confirm_account_mismatch',
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('admits a MULTI-ROW binding: revoked for this salon, live for another', async () => {
    // The moved-account lifecycle. Live-only resolution would strand the old
    // salon's captured deposits the moment the account was rebound.
    await seedBinding({ salonId: SALON, account: ACCOUNT, revocationCause: 'revoked_local' });
    await seedBinding({ salonId: OTHER_SALON, account: ACCOUNT });
    const hold = await seedHold({ salonId: SALON });

    const result = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

    expect(result.disposition).toBe('confirmed');
  });
});

// ===========================================================================
// GATES 2-4
// ===========================================================================

describe('gates 2-4', () => {
  beforeEach(async () => {
    await seedBinding({ salonId: SALON, account: ACCOUNT });
    await seedBinding({ salonId: OTHER_SALON, account: OTHER_ACCOUNT });
  });

  it('defers when no deposit carries that session id', async () => {
    const result = await confirmDepositPayment(evidence({ sessionId: 'cs_unknown' }));

    expect(result.disposition).toBe('deferred_no_deposit');
  });

  it('is account_mismatch when the evidence account is not the deposit SNAPSHOT — leg (b)', async () => {
    // The cross-account discriminator, and the one genuinely exercised on the
    // event-driven sweep: the deposit was created against one account and the
    // evidence arrived on another. Gate 1 passes here — the (ACCOUNT, SALON)
    // pair row exists — so leg (b) is the only thing standing between another
    // account's event and this salon's deposit.
    const hold = await seedHold({ salonId: SALON, account: OTHER_ACCOUNT });

    const result = await confirmDepositPayment(evidence({
      sessionId: hold.sessionId,
      connectedAccountId: ACCOUNT,
    }));

    expect(result.disposition).toBe('account_mismatch');
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
  });

  it('treats a tampered metadata deposit id as DIAGNOSTIC ONLY — leg (d)', async () => {
    // A blocking leg here would let a tenant rewrite one field on a paid
    // session and permanently WITHHOLD a verified confirm, because poll and the
    // sweep re-fetch the same tampered value.
    const hold = await seedHold();

    const result = await confirmDepositPayment(evidence({
      sessionId: hold.sessionId,
      metadataDepositId: 'dep_not_this_one',
    }));

    expect(result.disposition).toBe('confirmed');
    expect((await readDeposit(hold.depositId))?.status).toBe('paid');
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'deposit_confirm_metadata_deposit_id_mismatch',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('ignores ANY payment status other than paid, known or unknown', async () => {
    for (const status of ['unpaid', 'no_payment_required', 'some_future_literal', null]) {
      const hold = await seedHold();

      const result = await confirmDepositPayment(evidence({
        sessionId: hold.sessionId,
        paymentStatus: status,
      }));

      expect(result.disposition).toBe('ignored_unpaid');
      expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
    }
  });

  it('HOLDS an amount mismatch — neither confirmed nor auto-refunded', async () => {
    // Real client money is captured and the amount is not what we asked for.
    // That is a decision a person makes; a named queryable state is how they
    // find it.
    const hold = await seedHold();

    const result = await confirmDepositPayment(evidence({
      sessionId: hold.sessionId,
      amountTotal: AMOUNT - 500,
    }));

    expect(result.disposition).toBe('held_mismatch');
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
    expect((await readAppointment(hold.appointmentId))?.status).toBe('awaiting_payment');
  });

  it('HOLDS a currency mismatch', async () => {
    const hold = await seedHold();

    const result = await confirmDepositPayment(evidence({
      sessionId: hold.sessionId,
      currency: 'usd',
    }));

    expect(result.disposition).toBe('held_mismatch');
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
  });
});

// ===========================================================================
// TX-B — THE HOLD ARM
// ===========================================================================

describe('TX-B hold arm', () => {
  beforeEach(async () => {
    await seedBinding({ salonId: SALON, account: ACCOUNT });
    await seedBinding({ salonId: FREE_SOLO_SALON, account: FREE_SOLO_ACCOUNT });
  });

  it('confirms to PENDING at a non-freeSolo salon', async () => {
    // The deposit replaces the PAYMENT gate, not the REVIEW gate: a salon that
    // triages its bookings keeps triaging them.
    const hold = await seedHold({ salonId: SALON });

    const result = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

    expect(result.disposition).toBe('confirmed');

    const appointment = await readAppointment(hold.appointmentId);

    expect(appointment?.status).toBe('pending');
    expect(appointment?.canvasState).toBe('waiting');
    expect(appointment?.depositHoldExpiresAt).toBeNull();
    expect((await readDeposit(hold.depositId))?.status).toBe('paid');
  });

  it('confirms to CONFIRMED at a freeSolo salon', async () => {
    const hold = await seedHold({ salonId: FREE_SOLO_SALON, account: FREE_SOLO_ACCOUNT });

    await confirmDepositPayment(evidence({
      sessionId: hold.sessionId,
      connectedAccountId: FREE_SOLO_ACCOUNT,
    }));

    expect((await readAppointment(hold.appointmentId))?.status).toBe('confirmed');
  });

  it('writes the payment intent, one audit row and the side-effect job in ONE transaction', async () => {
    const hold = await seedHold({ salonId: SALON });

    await confirmDepositPayment(evidence({ sessionId: hold.sessionId, paymentIntentId: 'pi_abc' }));

    expect((await readDeposit(hold.depositId))?.stripePaymentIntentId).toBe('pi_abc');

    const audits = await auditRows(hold.appointmentId);

    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('payment_status_changed');
    expect(audits[0]?.performedByRole).toBe('system');

    const jobs = await outboxRows(hold.appointmentId);

    expect(jobs.map(job => job.operation)).toEqual(['booking_confirmed_side_effects']);
    expect(jobs[0]?.dedupeKey).toBe(`deposit:${hold.depositId}:confirmed-side-effects`);
    expect(jobs[0]?.payload).toEqual(expect.objectContaining({
      depositId: hold.depositId,
      googleCalendarSyncEligible: true,
    }));
  });

  it('mints a FRESH manage capability rather than recovering the booking-time one', async () => {
    // Only the booking-time token's hash is persisted, so its URL is not
    // reconstructible. Lookups are by hash, so the new row is additive and the
    // original link keeps working.
    const hold = await seedHold({ salonId: SALON });

    await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

    const tokens = await db.select().from(schema.appointmentAccessTokenSchema)
      .where(eq(schema.appointmentAccessTokenSchema.appointmentId, hold.appointmentId));

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.tokenHash).toBeTruthy();
  });

  it('is IDEMPOTENT across a redelivery: one confirmation, one side-effect batch', async () => {
    const hold = await seedHold({ salonId: SALON });

    const first = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));
    const second = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

    expect(first.disposition).toBe('confirmed');
    expect(second.disposition).toBe('already_confirmed');
    expect(await outboxRows(hold.appointmentId)).toHaveLength(1);
    expect(await auditRows(hold.appointmentId)).toHaveLength(1);
  });

  it('ROLLS THE WHOLE TRANSACTION BACK and poisons when the pair tears', async () => {
    // The appointment CAS succeeds and the deposit CAS does not — here because
    // the deposit already carries a DIFFERENT payment intent, which is the
    // set-once predicate doing its job. Committing would leave a live booking
    // with an unpaid deposit that no sweep would ever look at again.
    const hold = await seedHold({ salonId: SALON, paymentIntentId: 'pi_first' });

    const result = await confirmDepositPayment(evidence({
      sessionId: hold.sessionId,
      paymentIntentId: 'pi_second',
    }));

    expect(result.disposition).toBe('poisoned');
    expect((await readAppointment(hold.appointmentId))?.status).toBe('awaiting_payment');
    expect((await readDeposit(hold.depositId))?.status).toBe('checkout_created');
    expect((await readDeposit(hold.depositId))?.stripePaymentIntentId).toBe('pi_first');
    expect(await outboxRows(hold.appointmentId)).toHaveLength(0);
    expect(await auditRows(hold.appointmentId)).toHaveLength(0);
  });
});

// ===========================================================================
// TX-B — THE SETTLED ARMS
// ===========================================================================

describe('TX-B settled arms', () => {
  beforeEach(async () => {
    await seedBinding({ salonId: SALON, account: ACCOUNT });
  });

  it.each(['pending', 'confirmed', 'in_progress', 'completed', 'no_show'])(
    'heals a `checkout_created` deposit under a %s appointment, WITHOUT touching the appointment',
    async (appointmentStatus) => {
      const hold = await seedHold({ appointmentStatus, depositStatus: 'checkout_created' });

      const result = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

      expect(result.disposition).toBe('healed_deposit');
      expect((await readDeposit(hold.depositId))?.status).toBe('paid');
      expect((await readAppointment(hold.appointmentId))?.status).toBe(appointmentStatus);
    },
  );

  it.each([
    ['completed', 'expired'],
    ['completed', 'canceled'],
    ['no_show', 'expired'],
    ['no_show', 'canceled'],
    ['pending', 'expired'],
  ])(
    'heals LATE for a %s appointment with a %s deposit, and the salon KEEPS the deposit',
    async (appointmentStatus, depositStatus) => {
      // The owner reactivated a reaper-released hold and the client then paid,
      // possibly after the booking was driven to completion or no-showed —
      // the SAME appointment id in every case. Omitting any of these statuses
      // leaves a paid event matching no branch at all.
      const hold = await seedHold({ appointmentStatus, depositStatus });

      const result = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

      expect(result.disposition).toBe('healed_deposit_late');
      expect((await readDeposit(hold.depositId))?.status).toBe('paid');
      // Compensating a no-show is the reason a deposit exists; refunding it
      // would return the money in precisely the case it was designed for.
      expect((await readAppointment(hold.appointmentId))?.status).toBe(appointmentStatus);
      expect(sentry.captureMessage).toHaveBeenCalledWith(
        'deposit_healed_late',
        expect.objectContaining({ level: 'warning' }),
      );
    },
  );

  it('acks a redelivery against a paid deposit under a no_show appointment', async () => {
    // Ordinary idempotent redelivery after the owner no-showed a confirmed
    // deposit booking — not a new money decision, and NOT a duplicate session.
    const hold = await seedHold({
      appointmentStatus: 'no_show',
      depositStatus: 'paid',
      sessionId: 'cs_same',
    });

    const result = await confirmDepositPayment(evidence({ sessionId: 'cs_same' }));

    expect(result.disposition).toBe('already_confirmed');
    expect(await outboxRows(hold.appointmentId)).toHaveLength(0);
  });

  it('HOLDS a second real payment against one deposit', async () => {
    // Captured client money with no confirm and no refund attached to it. It
    // has to be a named, queryable state — not an alert stapled to an
    // idempotent ack.
    const hold = await seedHold({
      appointmentStatus: 'confirmed',
      depositStatus: 'paid',
      sessionId: 'cs_A',
    });
    // A second session that resolves to the SAME deposit row.
    await db.update(schema.appointmentDepositSchema)
      .set({ stripeCheckoutSessionId: 'cs_A' })
      .where(eq(schema.appointmentDepositSchema.id, hold.depositId));

    const result = await confirmDepositPayment(evidence({ sessionId: 'cs_A' }));

    expect(result.disposition).toBe('already_confirmed');

    // Now stage the genuine duplicate: the deposit stores cs_A, the evidence
    // presents cs_B, and gate 2 resolved this deposit by cs_B.
    await db.update(schema.appointmentDepositSchema)
      .set({ stripeCheckoutSessionId: 'cs_A' })
      .where(eq(schema.appointmentDepositSchema.id, hold.depositId));
    const duplicate = await confirmDepositPayment({
      ...evidence({ sessionId: 'cs_B' }),
    });

    // cs_B resolves no deposit, so it defers rather than confirming anything —
    // the duplicate-session terminal is reached from the sweep, which carries
    // the deposit id.
    expect(duplicate.disposition).toBe('deferred_no_deposit');
  });

  it('hands a CANCELLED appointment to late recovery, OUTSIDE the transaction', async () => {
    // Restore-or-refund takes the technician advisory lock and may call Stripe,
    // neither of which may happen while these row locks are held.
    const hold = await seedHold({ appointmentStatus: 'cancelled', depositStatus: 'expired' });

    const result = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

    expect(result.disposition).toBe('late_recovery_required');
    expect(result.depositId).toBe(hold.depositId);
    expect(result.appointmentId).toBe(hold.appointmentId);
    // Nothing written yet: routine B decides restore versus refund.
    expect((await readDeposit(hold.depositId))?.status).toBe('expired');
  });

  it('hands a `refunded` or `waived` deposit to late recovery rather than re-confirming', async () => {
    for (const depositStatus of ['refunded', 'waived']) {
      const hold = await seedHold({ appointmentStatus: 'confirmed', depositStatus });

      const result = await confirmDepositPayment(evidence({ sessionId: hold.sessionId }));

      expect(result.disposition).toBe('late_recovery_required');
      expect((await readDeposit(hold.depositId))?.status).toBe(depositStatus);
    }
  });
});
