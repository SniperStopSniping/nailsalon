/**
 * Held top-up reconciliation (G06, plan P4) — every transition applied here
 * is one of the SAME idempotent functions the stripe-billing webhook calls;
 * this suite proves the candidate query, the evidence cross-check reuse,
 * and every PR #195 invariant (age never clears an unbound attempt; an
 * `open` session is never touched).
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
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

vi.mock('@/libs/Env', () => ({
  Env: {
    BILLING_IDENTITY_HMAC_SECRET: undefined,
    BILLING_IDENTITY_HMAC_VERSION: undefined,
  },
}));

const stripeMock = vi.hoisted(() => ({
  checkout: { sessions: { retrieve: vi.fn() } },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));

const sentryHolder = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => sentryHolder);

// The real reverse lookup is all-placeholder-null pre-activation; keep it
// that way so the offer/price cross-check inside applyTopupSessionCompleted
// stays inert unless a test explicitly configures it.
vi.mock('@/libs/billing/stripePriceMap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/stripePriceMap')>();
  return { ...actual, resolveTopupOfferFromStripePriceId: () => null };
});

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(async () => {
  stripeMock.checkout.sessions.retrieve.mockReset();
  sentryHolder.captureMessage.mockClear();
  // Each test seeds its own candidates; reconcileHeldTopups has no salon
  // filter, so leftover rows from a previous test would otherwise pollute
  // the candidate query.
  await db.execute(sql`TRUNCATE billing_checkout_attempt, sms_topup_purchase, sms_credit_ledger, sms_credit_account, salon CASCADE`);
});

let counter = 0;
async function seedHeldAttempt(input: {
  salonId: string;
  sessionId: string | null;
  amountCents?: number;
  expired?: boolean;
  attemptStatus?: 'creating' | 'checkout_created';
}): Promise<{ attemptId: string; purchaseId: string | null }> {
  counter += 1;
  const salonExists = await db.select({ id: schema.salonSchema.id }).from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, input.salonId));
  if (salonExists.length === 0) {
    await db.insert(schema.salonSchema).values({ id: input.salonId, name: input.salonId, slug: input.salonId });
  }
  const attemptId = `bca_topupq_${counter}`;
  const expiresAt = input.expired === false
    ? new Date(Date.now() + 60 * 60 * 1000)
    : new Date(Date.now() - 60 * 1000);
  await db.insert(schema.billingCheckoutAttemptSchema).values({
    id: attemptId,
    salonId: input.salonId,
    purpose: 'sms_topup',
    topupOfferKey: 'topup_100_paid_2026_08',
    status: input.attemptStatus ?? 'checkout_created',
    stripeIdempotencyKey: `billing-attempt:${attemptId}`,
    stripeCheckoutSessionId: input.sessionId,
    expiresAt,
  });
  let purchaseId: string | null = null;
  if (input.sessionId !== null) {
    purchaseId = `stp_topupq_${counter}`;
    await db.insert(schema.smsTopupPurchaseSchema).values({
      id: purchaseId,
      salonId: input.salonId,
      topupOfferKey: 'topup_100_paid_2026_08',
      credits: 100,
      amountCents: input.amountCents ?? 599,
      currency: 'cad',
      status: 'checkout_created',
      stripeCheckoutSessionId: input.sessionId,
    });
  }
  return { attemptId, purchaseId };
}

function paidSession(
  sessionId: string,
  salonId: string,
  purchaseId: string,
  attemptId: string,
  amountCents = 599,
) {
  return {
    id: sessionId,
    payment_status: 'paid',
    status: 'complete',
    amount_total: amountCents,
    currency: 'cad',
    metadata: { salonId, purchaseId, attemptId },
    payment_intent: `pi_${sessionId}`,
    line_items: { data: [] },
  };
}

describe('reconcileHeldTopups (G06)', () => {
  it('fulfils a held purchase with a verified paid session exactly once', async () => {
    const { reconcileHeldTopups } = await import('./topupReconciliation');
    const { attemptId, purchaseId } = await seedHeldAttempt({ salonId: 'topupq-s1', sessionId: 'cs_topupq_paid' });
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(
      paidSession('cs_topupq_paid', 'topupq-s1', purchaseId!, attemptId),
    );

    const first = await reconcileHeldTopups({});

    expect(first.examined).toBe(1);
    expect(first.fulfilled).toBe(1);
    expect(first.anomalies).toHaveLength(0);

    const [purchase] = await db.select().from(schema.smsTopupPurchaseSchema)
      .where(eq(schema.smsTopupPurchaseSchema.id, purchaseId!));

    expect(purchase!.status).toBe('fulfilled');
    expect(purchase!.grantLedgerId).not.toBeNull();

    const [attempt] = await db.select().from(schema.billingCheckoutAttemptSchema)
      .where(eq(schema.billingCheckoutAttemptSchema.id, attemptId));

    expect(attempt!.status).toBe('completed');

    const ledgerRows = await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, 'topupq-s1'));

    expect(ledgerRows.filter(row => row.bucket === 'purchased')).toHaveLength(1);

    // Second pass: the attempt is no longer `creating`/`checkout_created`,
    // so it is not even a candidate — proving "exactly once" end to end.
    const second = await reconcileHeldTopups({});

    expect(second.examined).toBe(0);
    expect(second.fulfilled).toBe(0);

    const ledgerRowsAfter = await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, 'topupq-s1'));

    expect(ledgerRowsAfter.filter(row => row.bucket === 'purchased')).toHaveLength(1);
  });

  it('expires a held purchase and its attempt together for an expired session', async () => {
    const { reconcileHeldTopups } = await import('./topupReconciliation');
    const { attemptId, purchaseId } = await seedHeldAttempt({ salonId: 'topupq-s2', sessionId: 'cs_topupq_expired' });
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_topupq_expired',
      payment_status: 'unpaid',
      status: 'expired',
      amount_total: 599,
      currency: 'cad',
      metadata: { salonId: 'topupq-s2', purchaseId: purchaseId!, attemptId: undefined },
      payment_intent: null,
      line_items: { data: [] },
    });

    const result = await reconcileHeldTopups({});

    expect(result.examined).toBe(1);
    expect(result.expired).toBe(1);

    const [purchase] = await db.select().from(schema.smsTopupPurchaseSchema)
      .where(eq(schema.smsTopupPurchaseSchema.id, purchaseId!));

    expect(purchase!.status).toBe('expired');

    const [attempt] = await db.select().from(schema.billingCheckoutAttemptSchema)
      .where(eq(schema.billingCheckoutAttemptSchema.id, attemptId));

    expect(attempt!.status).toBe('expired');
  });

  it('leaves an open session untouched', async () => {
    const { reconcileHeldTopups } = await import('./topupReconciliation');
    const { attemptId, purchaseId } = await seedHeldAttempt({ salonId: 'topupq-s3', sessionId: 'cs_topupq_open' });
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_topupq_open',
      payment_status: 'unpaid',
      status: 'open',
      amount_total: 599,
      currency: 'cad',
      metadata: { salonId: 'topupq-s3', purchaseId: purchaseId!, attemptId: undefined },
      payment_intent: null,
      line_items: { data: [] },
    });

    const result = await reconcileHeldTopups({});

    expect(result.examined).toBe(1);
    expect(result.left_open).toBe(1);
    expect(result.fulfilled).toBe(0);
    expect(result.expired).toBe(0);

    const [purchase] = await db.select().from(schema.smsTopupPurchaseSchema)
      .where(eq(schema.smsTopupPurchaseSchema.id, purchaseId!));

    expect(purchase!.status).toBe('checkout_created');

    const [attempt] = await db.select().from(schema.billingCheckoutAttemptSchema)
      .where(eq(schema.billingCheckoutAttemptSchema.id, attemptId));

    expect(attempt!.status).toBe('checkout_created');
  });

  it('lists an unbound attempt (no session id) without ever clearing it by age', async () => {
    const { reconcileHeldTopups } = await import('./topupReconciliation');
    const { attemptId } = await seedHeldAttempt({ salonId: 'topupq-s4', sessionId: null, attemptStatus: 'creating' });

    const result = await reconcileHeldTopups({});

    expect(result.examined).toBe(1);
    expect(result.unbound).toHaveLength(1);
    expect(result.unbound[0]).toMatchObject({ attemptId, salonId: 'topupq-s4' });
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();

    const [attempt] = await db.select().from(schema.billingCheckoutAttemptSchema)
      .where(eq(schema.billingCheckoutAttemptSchema.id, attemptId));

    expect(attempt!.status).toBe('creating');
  });

  it('reports a held_anomaly and changes nothing when verified evidence disagrees', async () => {
    const { reconcileHeldTopups } = await import('./topupReconciliation');
    const { attemptId, purchaseId } = await seedHeldAttempt({
      salonId: 'topupq-s5',
      sessionId: 'cs_topupq_mismatch',
      amountCents: 599,
    });
    // amount_total disagrees with the locked purchase's amountCents.
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(
      paidSession('cs_topupq_mismatch', 'topupq-s5', purchaseId!, attemptId, 100),
    );

    const result = await reconcileHeldTopups({});

    expect(result.examined).toBe(1);
    expect(result.fulfilled).toBe(0);
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0]).toMatchObject({ attemptId, reason: 'TOPUP_AMOUNT_MISMATCH' });
    expect(sentryHolder.captureMessage).toHaveBeenCalledWith(
      'billing.topup_reconciliation_anomaly',
      expect.objectContaining({ level: 'warning' }),
    );

    const [purchase] = await db.select().from(schema.smsTopupPurchaseSchema)
      .where(eq(schema.smsTopupPurchaseSchema.id, purchaseId!));

    expect(purchase!.status).toBe('checkout_created');
    expect(purchase!.grantLedgerId).toBeNull();

    const [attempt] = await db.select().from(schema.billingCheckoutAttemptSchema)
      .where(eq(schema.billingCheckoutAttemptSchema.id, attemptId));

    expect(attempt!.status).toBe('checkout_created');
  });
});
