import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Env', () => ({ Env: { BILLING_IDENTITY_HMAC_SECRET: undefined, BILLING_IDENTITY_HMAC_VERSION: undefined } }));
vi.mock('@/libs/stripe', () => ({ stripe: { checkout: { sessions: { retrieve: vi.fn() } } } }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const NOW = new Date('2026-10-26T12:00:00Z');
const LATER = new Date('2026-10-26T13:00:00Z');

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

afterAll(async () => {
  await client?.close();
});

async function seed(key: string, spent = 100) {
  const salonId = `s_zero_${key}`;
  const purchaseId = `tp_zero_${key}`;
  const paymentIntentId = `pi_zero_${key}`;
  await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
  await db.insert(schema.smsTopupPurchaseSchema).values({ id: purchaseId, salonId, credits: 100, amountCents: 2000, topupOfferKey: 'topup_100_paid_2026_08', status: 'paid', stripeCheckoutSessionId: `cs_zero_${key}`, stripePaymentIntentId: paymentIntentId });
  await db.transaction(async tx => (await import('./creditGrants')).fulfillTopupPurchase(tx, { topupPurchaseId: purchaseId }));
  if (spent > 0) {
    const { reserveSmsCredits, settleReservationOnAccept } = await import('./creditReservation');
    const reserved = await reserveSmsCredits({ salonId, dedupeKey: `spent_zero_${key}`, segments: spent });
    if (!reserved.ok) {
      throw new Error('FIXTURE_RESERVATION_FAILED');
    }
    await settleReservationOnAccept({ reservationId: reserved.reservationId, providerSid: `SM_SYNTHETIC_${key}` });
  }
  return { salonId, purchaseId, paymentIntentId };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function snapshot(f: Fixture) {
  const [purchase] = await db.select().from(schema.smsTopupPurchaseSchema).where(eq(schema.smsTopupPurchaseSchema.id, f.purchaseId));
  const [account] = await db.select().from(schema.smsCreditAccountSchema).where(eq(schema.smsCreditAccountSchema.salonId, f.salonId));
  const ledger = await db.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, f.salonId));
  const audits = await db.select().from(schema.auditLogSchema).where(eq(schema.auditLogSchema.entityId, f.purchaseId));
  return { purchase: purchase!, account: account!, ledger, audits, rawBalance: ledger.reduce((sum, row) => sum + row.amount, 0) };
}
const refund = async (f: Fixture, refundId: string, cumulativeRefundedCents: number, now = NOW) => (await import('./topupFulfillment')).applyTopupChargeRefunded({ paymentIntentId: f.paymentIntentId, refundId, cumulativeRefundedCents, now });

it.each([{ label: 'partial', cents: 1000, target: 50, status: 'partially_reversed' }, { label: 'full', cents: 2000, target: 100, status: 'refunded' }])('fully spent $label refund persists adjustment without debt or zero ledger rows', async ({ label, cents, target, status }) => {
  const f = await seed(label);
  const before = await snapshot(f);

  expect(await refund(f, `re_zero_${label}`, cents)).toEqual({ reversed: 0, shortfall: target, anomaly: null });

  const after = await snapshot(f);

  expect(after.purchase).toMatchObject({ status, stripeRefundId: `re_zero_${label}`, refundedAt: NOW });
  expect(after.audits).toHaveLength(1);
  expect(after.audits[0]!.metadata).toMatchObject({ kind: 'refund', cumulativeRefundedCents: cents, targetCredits: target, reversedCredits: 0, shortfall: target, refundId: `re_zero_${label}`, grantId: after.purchase.grantLedgerId });
  expect(after.audits[0]!.metadata).toHaveProperty('observationKey');
  expect(after.ledger).toEqual(before.ledger);
  expect(after.rawBalance).toBe(0);
  expect(after.account).toEqual(before.account);
});

it('a positive-cent refund whose proportional target rounds to zero is recorded without changing balances', async () => {
  const f = await seed('rounding', 0);
  const before = await snapshot(f);

  expect(await refund(f, 're_zero_rounding', 1)).toEqual({ reversed: 0, shortfall: 0, anomaly: null });

  const after = await snapshot(f);

  expect(after.audits).toHaveLength(1);
  expect(after.audits[0]!.metadata).toMatchObject({ cumulativeRefundedCents: 1, targetCredits: 0, shortfall: 0 });
  expect(after.purchase.status).toBe('partially_reversed');
  expect(after.ledger).toEqual(before.ledger);
  expect(after.account).toEqual(before.account);
  expect(after.rawBalance).toBe(100);
});

it('same-refund and cross-event duplicates preserve the first observation, references and timestamps', async () => {
  const f = await seed('replay');
  await refund(f, 're_zero_first', 1000);
  const before = await snapshot(f);
  await refund(f, 're_zero_first', 1000, LATER);
  await refund(f, 're_zero_other_event', 1000, LATER);

  expect(await snapshot(f)).toEqual(before);
});

it('partial then full observations remain monotonic when a different older observation arrives', async () => {
  const f = await seed('monotonic');
  await refund(f, 're_zero_partial', 333);
  await refund(f, 're_zero_full', 2000, LATER);
  const full = await snapshot(f);
  await refund(f, 're_zero_stale', 1000, new Date('2026-10-26T14:00:00Z'));
  const stale = await snapshot(f);

  expect(stale.purchase).toEqual(full.purchase);
  expect(stale.ledger).toEqual(full.ledger);
  expect(stale.account).toEqual(full.account);
});

it('an already-disputed purchase remains disputed on a zero-debit refund', async () => {
  const f = await seed('disputed');
  await (await import('./topupFulfillment')).applyTopupDisputeCreated({ paymentIntentId: f.paymentIntentId, disputeId: 'dp_zero_disputed', now: NOW });
  const before = await snapshot(f);
  await refund(f, 're_zero_disputed', 2000, LATER);
  const after = await snapshot(f);

  expect(after.purchase.status).toBe('disputed');
  expect(after.ledger).toEqual(before.ledger);
  expect(after.account).toEqual(before.account);
  expect(after.rawBalance).toBe(-100);
});

it.each([false, true])('positive-shortfall refund replay is not a new zero-debit adjustment (legacy=%s)', async (legacy) => {
  const f = await seed(`positive_${legacy}`, 70);

  expect(await refund(f, 're_zero_positive', 1000)).toEqual({ reversed: 30, shortfall: 20, anomaly: null });

  if (legacy) {
    await db.update(schema.auditLogSchema).set({ metadata: { kind: 'refund', reversedCredits: 30, shortfall: 20 } }).where(eq(schema.auditLogSchema.entityId, f.purchaseId));
  }
  const before = await snapshot(f);
  await refund(f, 're_zero_positive', 1000, LATER);
  await refund(f, 're_zero_positive_other', 1000, LATER);

  expect(await snapshot(f)).toEqual(before);
});

it('blocking audit failure rolls back the zero-debit purchase projection', async () => {
  const f = await seed('rollback');
  const before = await snapshot(f);
  await db.execute(sql`CREATE FUNCTION fail_zero_refund_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id = 'tp_zero_rollback' THEN RAISE EXCEPTION 'ZERO_REFUND_AUDIT_REJECTED'; END IF; RETURN NEW; END $$`);
  await db.execute(sql`CREATE TRIGGER fail_zero_refund_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_zero_refund_audit()`);
  try {
    const failure = await refund(f, 're_zero_rollback', 1000).catch((error: unknown) => error);
    const messages: string[] = [];
    let cause: unknown = failure;
    for (let depth = 0; depth < 6 && cause instanceof Error; depth += 1) {
      messages.push(cause.message);
      cause = (cause as Error & { cause?: unknown }).cause;
    }

    expect(messages.some(message => message.includes('ZERO_REFUND_AUDIT_REJECTED'))).toBe(true);
    expect(await snapshot(f)).toEqual(before);
  } finally {
    await db.execute(sql`DROP TRIGGER fail_zero_refund_audit ON audit_log`);
    await db.execute(sql`DROP FUNCTION fail_zero_refund_audit()`);
  }
});

it('a novel older total cannot refresh a newer partial zero-debit projection', async () => {
  const f = await seed('partial_stale');
  await refund(f, 're_zero_newer_partial', 1000);
  const before = await snapshot(f);
  await refund(f, 're_zero_older_partial', 333, LATER);
  const after = await snapshot(f);

  expect(after.purchase).toEqual(before.purchase);
  expect(after.audits).toHaveLength(2);
  expect(after.audits[1]!.metadata).toMatchObject({ cumulativeRefundedCents: 333, targetCredits: 16, reversedCredits: 0, shortfall: 16 });
  expect(after.ledger).toEqual(before.ledger);
  expect(after.account).toEqual(before.account);
});

it('a floor-zero observation does not block a later positive canonical reversal', async () => {
  const f = await seed('round_then_positive', 0);
  await refund(f, 're_zero_round_first', 1);

  expect(await refund(f, 're_zero_positive_later', 333, LATER)).toEqual({ reversed: 16, shortfall: 0, anomaly: null });

  const after = await snapshot(f);

  expect(after.rawBalance).toBe(84);
  expect(after.audits).toHaveLength(2);
  expect(after.ledger.filter(row => row.entryType === 'purchase_reversal')).toHaveLength(1);
});

it('zero cumulative cents records no refund observation or purchase change', async () => {
  const f = await seed('zero_cents');
  const before = await snapshot(f);

  expect(await refund(f, 're_zero_no_refund', 0)).toEqual({ reversed: 0, shortfall: 0, anomaly: null });
  expect(await snapshot(f)).toEqual(before);
});
