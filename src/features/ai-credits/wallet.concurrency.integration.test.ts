import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETUP_AI_PRODUCTION_BUDGET_ID } from '@/features/business-setup/ai-budget.server';
import { runSetupConversation } from '@/features/business-setup/conversation.server';
import { openSetup } from '@/features/business-setup/drafts.server';
import type { ModelProviderResponse } from '@/libs/ai/provider';
import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { AI_REQUEST_CREDIT_LIMIT } from './catalog';
import * as configuration from './config.server';
import { currentAiCreditExecution } from './context.server';
import { reconcileAiCreditRequests, runWithAiCredits } from './request-metering.server';
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

describe.skipIf(!target)('metered owner requests on attested PostgreSQL', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ENV', 'preview');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
    vi.stubEnv('AI_CREDITS_ENABLED', 'true');
    vi.stubEnv('AI_CREDIT_METERING_ENABLED', 'true');
    vi.stubEnv('AI_CREDIT_USD_TO_CAD_MILLIONTHS', '1400000');
    vi.stubEnv('AI_CREDIT_PRICING_VERSION', 'concurrency-v1');
    vi.stubEnv('CUSTOM_SITE_PRODUCTION_BUDGET_CAD', '1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const result = (): ModelProviderResponse => ({ status: 'completed', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'Saved in your draft.', operationsJson: JSON.stringify([{ type: 'business', values: { name: 'Metered new name' } }]), designRequest: null, uploadFacts: null }) }] });
  async function meteredFixture(planEnv: 'test' | 'prod' = 'test') {
    const f = await fixture(planEnv);
    await fulfillAiCreditPurchase(f.evidence);
    await openSetup(f.actor);
    const input = { operationId: randomUUID(), expectedRevision: 1, scope: 'business_and_website' as const, message: 'Change my business name to Metered new name.', referenceIds: [] };
    const model = { countInputTokens: vi.fn(async () => 1000), createResponse: vi.fn(async () => result()) };
    const execute = () => runWithAiCredits(f.actor, 'conversation', input, AI_REQUEST_CREDIT_LIMIT, () => runSetupConversation(f.actor, input, model));
    return { ...f, input, model, execute };
  }

  it('serializes different prepaid salons against the shared production expense cap without borrowing trial funds', async () => {
    vi.spyOn(configuration, 'aiCreditPlanEnv').mockReturnValue('prod');
    const first = await meteredFixture('prod');
    const second = await meteredFixture('prod');
    const history = await database.select().from(schema.setupAiCallSchema);
    const used = history.filter(c => c.budgetId === SETUP_AI_PRODUCTION_BUDGET_ID || c.budgetId === null).reduce((sum, c) => sum + c.chargedMicroCad, 0);
    const cap = used + 5000;
    // The new production-only SQL exception must not widen trial limits.
    await database.insert(schema.setupAiBudgetSchema).values({ id: SETUP_AI_PRODUCTION_BUDGET_ID, capMicroCad: 100_000_000 }).onConflictDoUpdate({ target: schema.setupAiBudgetSchema.id, set: { capMicroCad: 100_000_000 } });

    await expect(database.insert(schema.setupAiBudgetSchema).values({ id: `trial-${randomUUID()}`, capMicroCad: 80_000_001 })).rejects.toThrow();

    await database.insert(schema.setupAiBudgetSchema).values({ id: SETUP_AI_PRODUCTION_BUDGET_ID, capMicroCad: cap }).onConflictDoUpdate({ target: schema.setupAiBudgetSchema.id, set: { capMicroCad: cap } });
    // Unknown usage retains the conservative reservation even after completion.
    // A quick successful response therefore cannot hide this reservation race.
    for (const f of [first, second]) {
      f.model.createResponse.mockResolvedValue({ ...result(), usage: null });
    }
    try {
      const settled = await Promise.allSettled([first.execute(), second.execute()]);

      expect(settled.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter(r => r.status === 'rejected')).toHaveLength(1);
      expect(first.model.createResponse.mock.calls.length + second.model.createResponse.mock.calls.length).toBe(1);

      const after = await database.select().from(schema.setupAiCallSchema);

      expect(after.filter(c => c.budgetId === SETUP_AI_PRODUCTION_BUDGET_ID || c.budgetId === null).reduce((sum, c) => sum + c.chargedMicroCad, 0)).toBeLessThanOrEqual(cap);

      for (const f of [first, second]) {
        expect(await aiCreditOverview(f.actor, 'prod')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });
      }
    } finally {
      await database.update(schema.setupAiBudgetSchema).set({ capMicroCad: 1_000_000 }).where(eq(schema.setupAiBudgetSchema.id, SETUP_AI_PRODUCTION_BUDGET_ID));
    }
  });

  it('does not refund or rerun a duplicate request while its original provider call is active', async () => {
    const f = await meteredFixture();
    let complete!: (value: ModelProviderResponse) => void;
    f.model.createResponse.mockImplementationOnce(() => new Promise<ModelProviderResponse>((resolve) => {
      complete = resolve;
    }));
    const running = f.execute();
    await vi.waitFor(() => expect(f.model.createResponse).toHaveBeenCalledTimes(1));

    await expect(f.execute()).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ availableMicroCad: 8_000_000, reservedMicroCad: 2_000_000 });

    complete(result());
    await running;
    await f.execute();

    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 9_999_902, reservedMicroCad: 0 });
  });

  it('keeps simultaneous salons and their asynchronous provider contexts separate', async () => {
    const first = await meteredFixture();
    const second = await meteredFixture();
    for (const f of [first, second]) {
      f.model.createResponse.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(currentAiCreditExecution()?.salonId).toBe(f.actor.salonId);

        return result();
      });
    }
    await Promise.all([first.execute(), second.execute()]);
    const evidence = await database.select().from(schema.setupAiCallSchema);
    for (const f of [first, second]) {
      expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 9_999_902, reservedMicroCad: 0 });
      expect(evidence.filter(call => call.salonId === f.actor.salonId)).toHaveLength(1);
    }

    expect(currentAiCreditExecution()).toBeUndefined();
  });

  it('recovers a saved draft after PostgreSQL rejects its settlement, charging only once', async () => {
    const f = await meteredFixture();
    const name = `ai_settlement_failure_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.salon_id = '${f.actor.salonId}' AND NEW.kind = 'usage' THEN RAISE EXCEPTION 'synthetic settlement failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON ai_credit_ledger FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try {
      await expect(f.execute()).rejects.toThrow();

      expect((await openSetup(f.actor)).revision.document.business.name).toBe('Metered new name');
      expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ reservedMicroCad: AI_REQUEST_CREDIT_LIMIT });
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON ai_credit_ledger`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }
    await reconcileAiCreditRequests(f.actor, 'test');
    await f.execute();

    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 9_999_902, reservedMicroCad: 0 });
    expect((await database.select().from(schema.aiCreditLedgerSchema).where(eq(schema.aiCreditLedgerSchema.salonId, f.actor.salonId))).filter(row => row.kind === 'usage')).toHaveLength(1);
  });
});

async function fixture(planEnv: 'test' | 'prod' = 'test') {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Synthetic wallet concurrency', publicationStatus: 'draft', onlineBookingEnabled: false });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  const purchase = await beginAiCreditPurchase(actor, { planEnv, operationId: randomUUID(), packKey: 'ai_10_cad_v1', stripePriceId: 'price_concurrency_fixture', stripeCustomerId: `cus_${randomUUID()}` });
  const evidence: AiCreditPaymentEvidence = { purchaseId: purchase.id, salonId: actor.salonId, planEnv, packKey: purchase.packKey, sessionId: `cs_${randomUUID()}`, paymentIntentId: `pi_${randomUUID()}`, customerId: purchase.stripeCustomerId, priceId: purchase.stripePriceId, amountSubtotal: 1000, amountTotal: 1000, taxCents: 0, quantity: 1, currency: 'cad', paymentStatus: 'paid', livemode: planEnv === 'prod', amountRefundedCents: 0, disputed: false };
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
