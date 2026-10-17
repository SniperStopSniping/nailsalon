import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { aiCreditOverview, type AiCreditPaymentEvidence, beginAiCreditPurchase, fulfillAiCreditPurchase, reserveAiCredits, reverseAiCreditPurchase, settleAiCredits } from './wallet.server';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
const raw = process.env.CONCURRENCY_TEST_DATABASE_URL;
const target = raw ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: raw }) : null;
if (!target && process.env.AI_CREDIT_CONCURRENCY_REQUIRED === 'true') {
  throw new Error('AI credit concurrency verification requires an attested disposable database.');
}
let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  if (!target) {
    return;
  }
  pool = new Pool({ connectionString: target.connectionString, max: 8 });
  const connection = await pool.connect();
  try {
    await attestDisposableDatabaseSession(connection, target, resolveDisposableDatabaseServerExpectation(target));
  } finally {
    connection.release();
  }
  database = drizzle(pool, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

async function fixture() {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Synthetic wallet concurrency', publicationStatus: 'draft', onlineBookingEnabled: false });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  const purchase = await beginAiCreditPurchase(actor, { planEnv: 'test', operationId: randomUUID(), packKey: 'ai_10_cad_v1', stripePriceId: 'price_concurrency_fixture', stripeCustomerId: `cus_${randomUUID()}` });
  const evidence: AiCreditPaymentEvidence = { purchaseId: purchase.id, salonId: actor.salonId, planEnv: 'test', packKey: purchase.packKey, sessionId: `cs_${randomUUID()}`, paymentIntentId: `pi_${randomUUID()}`, customerId: purchase.stripeCustomerId, priceId: purchase.stripePriceId, amountSubtotal: 1000, amountTotal: 1000, taxCents: 0, quantity: 1, currency: 'cad', paymentStatus: 'paid', livemode: false, amountRefundedCents: 0, disputed: false };
  return { actor, purchase, evidence };
}

describe.skipIf(!target)('AI wallet on attested disposable PostgreSQL', () => {
  it('admits only one simultaneous hold when two requests compete for the remaining balance', async () => {
    const { actor, evidence } = await fixture();
    await fulfillAiCreditPurchase(evidence);
    const results = await Promise.allSettled([1, 2].map(n => reserveAiCredits(actor, { planEnv: 'test', operationId: randomUUID(), requestHash: `race${n}`, maximumMicroCad: 6_000_000 })));

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'INSUFFICIENT_CREDITS' } });
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 6_000_000, availableMicroCad: 4_000_000 });
  });

  it('grants, reserves and settles once when duplicate requests arrive concurrently', async () => {
    const { actor, evidence } = await fixture();
    await Promise.all(Array.from({ length: 6 }, () => fulfillAiCreditPurchase(evidence)));
    const input = { planEnv: 'test' as const, operationId: randomUUID(), requestHash: 'same', maximumMicroCad: 1_000_000 };
    const held = await Promise.all(Array.from({ length: 6 }, () => reserveAiCredits(actor, input)));

    expect(new Set(held.map(result => result.reservation.id)).size).toBe(1);

    await Promise.all(Array.from({ length: 6 }, () => settleAiCredits(actor, { ...input, actualMicroCad: 12345, success: true })));

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ balanceMicroCad: 9_987_655, reservedMicroCad: 0 });
    expect(await database.select().from(schema.aiCreditLedgerSchema).where(eq(schema.aiCreditLedgerSchema.salonId, actor.salonId))).toHaveLength(2);
  });

  it('serializes a refund against admission and preserves an already admitted request', async () => {
    const { actor, evidence } = await fixture();
    await fulfillAiCreditPurchase(evidence);
    const operationId = randomUUID();
    const results = await Promise.allSettled([
      reserveAiCredits(actor, { planEnv: 'test', operationId, requestHash: 'refund-race', maximumMicroCad: 6_000_000 }),
      reverseAiCreditPurchase({ paymentIntentId: evidence.paymentIntentId, planEnv: 'test', amountRefundedCents: 1000, disputed: false }),
    ]);

    expect(results[1]?.status).toBe('fulfilled');
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ balanceMicroCad: 0, availableMicroCad: 0 });

    if (results[0]?.status === 'fulfilled') {
      await settleAiCredits(actor, { planEnv: 'test', operationId, actualMicroCad: 100, success: true });

      expect(await aiCreditOverview(actor, 'test')).toMatchObject({ balanceMicroCad: -100, debtMicroCad: 100 });
    } else {
      expect(results[0]).toMatchObject({ reason: { code: 'INSUFFICIENT_CREDITS' } });
    }

    await expect(reserveAiCredits(actor, { planEnv: 'test', operationId: randomUUID(), requestHash: 'next', maximumMicroCad: 1 })).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
  });

  it('rolls back fulfillment after a failed ledger write and safely retries', async () => {
    const { actor, evidence, purchase } = await fixture();
    const name = `ai_wallet_failure_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.salon_id = '${actor.salonId}' THEN RAISE EXCEPTION 'synthetic ledger failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON ai_credit_ledger FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try {
      await expect(fulfillAiCreditPurchase(evidence)).rejects.toThrow();

      const [unchanged] = await database.select().from(schema.aiCreditPurchaseSchema).where(eq(schema.aiCreditPurchaseSchema.id, purchase.id));

      expect(unchanged?.status).toBe('creating');
      expect(await aiCreditOverview(actor, 'test')).toMatchObject({ balanceMicroCad: 0 });
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON ai_credit_ledger`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }

    await fulfillAiCreditPurchase(evidence);
    await fulfillAiCreditPurchase(evidence);

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ balanceMicroCad: 10_000_000 });
  });
});
