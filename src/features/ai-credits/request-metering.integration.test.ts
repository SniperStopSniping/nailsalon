import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETUP_AI_PRODUCTION_BUDGET_ID } from '@/features/business-setup/ai-budget.server';
import { runSetupModel } from '@/features/business-setup/ai-trial.server';
import { runSetupConversation } from '@/features/business-setup/conversation.server';
import { editSetup, openSetup } from '@/features/business-setup/drafts.server';
import { applyOwnUpload, readOwnUpload } from '@/features/business-setup/read-upload.server';
import { uploadCustomAsset } from '@/features/custom-sites/assets.server';
import { generateCustomSite } from '@/features/custom-sites/generate.server';
import { ModelProviderError, type ModelProviderRequest, type ModelProviderResponse, type ModelProviderUsage } from '@/libs/ai/provider';
import sharp from '@/libs/safeSharp.server';
import * as schema from '@/models/Schema';

import { darkSource } from '../../../tests/browser/businessSetup/custom-design-fixtures';
import { AI_REQUEST_CREDIT_LIMIT } from './catalog';
import * as configuration from './config.server';
import { currentAiCreditExecution, withAiCreditExecution } from './context.server';
import { reconcileAiCreditRequests, runWithAiCredits } from './request-metering.server';
import { aiCreditOverview, beginAiCreditPurchase, fulfillAiCreditPurchase, settleAiCredits } from './wallet.server';

// Deterministic provider doubles exercise the real saved-draft and metering
// pipeline. These are not real-provider design or payment acceptance claims.
vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Env', () => ({ Env: { BILLING_PLAN_ENV: 'test' } }));
const client = new PGlite();
const database = drizzle(client, { schema });
const usage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50 };
const body = { reply: 'Your business name is saved in the draft.', operationsJson: JSON.stringify([{ type: 'business', values: { name: 'New name', city: 'Toronto', workMode: 'solo' } }]), designRequest: null, uploadFacts: null };
const answer = (value: unknown = body, tokens: ModelProviderUsage | null = usage): ModelProviderResponse => ({ status: 'completed', usage: tokens, items: [{ type: 'message', text: JSON.stringify(value) }] });
const provider = () => ({ countInputTokens: vi.fn(async (_request: ModelProviderRequest) => 1000), createResponse: vi.fn(async (_request: ModelProviderRequest) => answer()) });

beforeAll(async () => {
  await client.waitReady;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60_000);

beforeEach(() => {
  vi.stubEnv('APP_ENV', 'preview');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  vi.stubEnv('AI_CREDITS_ENABLED', 'true');
  vi.stubEnv('AI_CREDIT_METERING_ENABLED', 'true');
  vi.stubEnv('AI_CREDIT_USD_TO_CAD_MILLIONTHS', '1400000');
  vi.stubEnv('AI_CREDIT_PRICING_VERSION', 'metering-test-v1');
  vi.stubEnv('CUSTOM_SITE_PRODUCTION_BUDGET_CAD', '1');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
});

async function fixture(funded = true, service = false, planEnv: 'test' | 'prod' = 'test') {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Before', publicationStatus: 'draft', onlineBookingEnabled: false });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  if (service) {
    await database.insert(schema.serviceSchema).values({ id: randomUUID(), salonId: actor.salonId, name: 'BIAB', price: 6000, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 10, category: 'builder_gel', bookingCategory: 'manicure' });
  }
  await openSetup(actor);
  if (funded) {
    const purchase = await beginAiCreditPurchase(actor, { planEnv, operationId: randomUUID(), packKey: 'ai_10_cad_v1', stripePriceId: 'price_synthetic', stripeCustomerId: 'cus_synthetic' });
    await fulfillAiCreditPurchase({ purchaseId: purchase.id, salonId: actor.salonId, planEnv, packKey: purchase.packKey, sessionId: `cs_${randomUUID()}`, paymentIntentId: `pi_${randomUUID()}`, customerId: purchase.stripeCustomerId, priceId: purchase.stripePriceId, amountSubtotal: 1000, amountTotal: 1000, taxCents: 0, quantity: 1, currency: 'cad', paymentStatus: 'paid', livemode: planEnv === 'prod', amountRefundedCents: 0, disputed: false });
  }
  const input = { operationId: randomUUID(), expectedRevision: 1, scope: 'business_and_website' as 'business_and_website' | 'website' | 'service_price', message: 'My business name is New name. I work solo in Toronto.', referenceIds: [] as string[] };
  return { actor, input, model: provider() };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const execute = ({ actor, input, model }: Fixture, limit: number | undefined = AI_REQUEST_CREDIT_LIMIT) => runWithAiCredits(actor, 'conversation', input, limit, () => runSetupConversation(actor, input, model));
const holds = (actor: Fixture['actor']) => database.select().from(schema.aiCreditReservationSchema).where(eq(schema.aiCreditReservationSchema.salonId, actor.salonId));
const calls = (actor: Fixture['actor']) => database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.salonId, actor.salonId));

describe('owner-request metering with real draft persistence', () => {
  it('charges measured usage only after saving, releases the unused hold and replays without another paid call', async () => {
    const f = await fixture();
    const result = await execute(f);

    expect(result.head.revision.document.business.name).toBe('New name');
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 9_999_902, reservedMicroCad: 0 });

    const [hold] = await holds(f.actor);
    const [call] = await calls(f.actor);

    expect(hold).toMatchObject({ status: 'settled', settledMicroCad: 98, acceptedLimitMicroCad: AI_REQUEST_CREDIT_LIMIT, pricing: { version: 'metering-test-v1', usdToCadMillionths: 1400000 }, resolution: 'completed' });
    expect(call).toMatchObject({ creditReservationId: hold!.id, creditCostMicroCad: 98, budgetId: 'initial-custom-website-trial', chargedMicroCad: 70 });
    expect(f.model.createResponse.mock.calls[0]![0].serviceTier).toBe('default');

    vi.stubEnv('AI_CREDIT_USD_TO_CAD_MILLIONTHS', '2000000');
    await execute(f);

    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 9_999_902 });
    expect((await holds(f.actor))[0]!.pricing?.usdToCadMillionths).toBe(1400000);
    expect((await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, f.actor.salonId)))[0]).toMatchObject({ name: 'Before', publicationStatus: 'draft', onlineBookingEnabled: false });
  });

  it('binds intake, child design and bounded automatic repair to one accepted request', async () => {
    const f = await fixture();
    f.input.message = 'Create my website with a dark premium design.';
    f.model.createResponse.mockResolvedValueOnce(answer({ reply: 'Creating your draft.', operationsJson: '[]', designRequest: 'A dark premium custom website', uploadFacts: null }))
      .mockResolvedValueOnce(answer({ ...darkSource, html: '<script>unsafe()</script>' }))
      .mockResolvedValueOnce(answer(darkSource));
    const result = await execute(f);
    const evidence = await calls(f.actor);

    expect(result.head.revision.document.website.config.customFrontendId).toBeTruthy();
    expect(f.model.createResponse).toHaveBeenCalledTimes(3);
    expect(new Set(evidence.map(call => call.creditReservationId)).size).toBe(1);
    expect(new Set(evidence.map(call => call.operationId)).size).toBe(2);
    expect(evidence.some(call => call.rawOutput?.includes('unsafe()'))).toBe(true);
    expect(evidence.some(call => call.validation === 'passed')).toBe(true);
    expect((await holds(f.actor))[0]).toMatchObject({ status: 'settled', settledMicroCad: evidence.reduce((sum, call) => sum + call.creditCostMicroCad!, 0) });
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, f.actor.salonId))).toHaveLength(0);
  });

  it('requires the displayed spending limit and a funded balance before calling a provider', async () => {
    const f = await fixture(false);

    await expect(execute(f)).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    await expect(runWithAiCredits(f.actor, 'conversation', f.input, undefined, () => runSetupConversation(f.actor, f.input, f.model))).rejects.toMatchObject({ code: 'INVALID' });
    expect(f.model.countInputTokens).not.toHaveBeenCalled();
    expect(f.model.createResponse).not.toHaveBeenCalled();
    expect(await holds(f.actor)).toHaveLength(0);
  });

  it('blocks a provider entry that does not have a server-admitted parent request', async () => {
    const f = await fixture();

    await expect(runSetupModel(f.actor, { operationId: f.input.operationId, ordinal: 0, expectedRevision: 1, request: { model: 'gpt-6-luna', input: [{ role: 'user', content: 'Hello' }], tools: [], maxOutputTokens: 100, timeoutMs: 1000, jsonMode: 'prompt' } }, f.model)).rejects.toMatchObject({ code: 'INVALID' });
    expect(f.model.countInputTokens).not.toHaveBeenCalled();
    expect(f.model.createResponse).not.toHaveBeenCalled();
  });

  it('does not reuse an accepted operation for altered text or another scope', async () => {
    const f = await fixture();
    await execute(f);
    f.input.message = 'Actually use another business name.';

    await expect(execute(f)).rejects.toMatchObject({ code: 'INVALID' });
    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
  });

  it('returns customer credits for provider failures while retaining measured operator expense', async () => {
    const f = await fixture();
    f.model.createResponse.mockRejectedValue(new ModelProviderError('provider_error', 502, usage));

    await expect(execute(f)).rejects.toThrow();
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });
    expect((await holds(f.actor))[0]).toMatchObject({ status: 'released', resolution: 'platform_failure' });
    expect((await calls(f.actor))[0]).toMatchObject({ status: 'failed', costMicroUsd: 35, chargedMicroCad: 70 });
    await expect(execute(f)).rejects.toMatchObject({ code: 'STALE' });
    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
  });

  it('keeps missing or invalid provider usage unknown and never invents a customer charge', async () => {
    const f = await fixture();
    f.model.createResponse.mockResolvedValue(answer(body, null));
    await execute(f);

    expect((await holds(f.actor))[0]).toMatchObject({ status: 'settled', settledMicroCad: 0, resolution: 'unknown_usage' });
    expect((await calls(f.actor))[0]).toMatchObject({ costMicroUsd: null, creditCostMicroCad: null });
    expect((await calls(f.actor))[0]!.chargedMicroCad).toBeGreaterThan(0);
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 10_000_000 });
  });

  it('releases a tiny remaining balance before a call that cannot fit, without taking it', async () => {
    const f = await fixture();
    await database.insert(schema.aiCreditLedgerSchema).values({ id: randomUUID(), salonId: f.actor.salonId, planEnv: 'test', entryKey: randomUUID(), kind: 'usage', amountMicroCad: -9_999_999 });

    await expect(execute(f)).rejects.toThrow();
    expect(f.model.createResponse).not.toHaveBeenCalled();
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ availableMicroCad: 1, reservedMicroCad: 0 });
  });

  it('does not refund or rerun an active request when its duplicate arrives', async () => {
    const f = await fixture();
    let complete!: (value: ModelProviderResponse) => void;
    f.model.createResponse.mockImplementationOnce(() => new Promise(resolve => complete = resolve));
    const running = execute(f);
    await vi.waitFor(() => expect(f.model.createResponse).toHaveBeenCalledTimes(1));

    await expect(execute(f)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ reservedMicroCad: AI_REQUEST_CREDIT_LIMIT });
    await expect(settleAiCredits(f.actor, { planEnv: 'test', operationId: f.input.operationId, actualMicroCad: 0, success: false })).rejects.toMatchObject({ code: 'INVALID' });

    complete(answer());
    await running;

    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 9_999_902, reservedMicroCad: 0 });
  });

  it('preserves a concurrent manual draft edit and refunds the stale AI attempt', async () => {
    const f = await fixture();
    let complete!: (value: ModelProviderResponse) => void;
    f.model.createResponse.mockImplementationOnce(() => new Promise(resolve => complete = resolve));
    const running = execute(f).then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(f.model.createResponse).toHaveBeenCalledTimes(1));
    await editSetup(f.actor, { expectedRevision: 1, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'Manual name' } }] });
    complete(answer());

    expect(await running).toHaveProperty('error');
    expect((await openSetup(f.actor)).revision.document.business.name).toBe('Manual name');
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });
  });

  it('returns a failed operation’s hold when owner permission was revoked during the provider call', async () => {
    const f = await fixture();
    let complete!: (value: ModelProviderResponse) => void;
    f.model.createResponse.mockImplementationOnce(() => new Promise(resolve => complete = resolve));
    const running = execute(f).then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(f.model.createResponse).toHaveBeenCalledTimes(1));
    await database.update(schema.adminSalonMembershipSchema).set({ role: 'staff' }).where(and(eq(schema.adminSalonMembershipSchema.salonId, f.actor.salonId), eq(schema.adminSalonMembershipSchema.adminId, f.actor.adminId)));
    complete(answer());

    expect(await running).toHaveProperty('error');
    expect((await holds(f.actor))[0]).toMatchObject({ status: 'released', settledMicroCad: 0 });
    expect((await database.select().from(schema.aiCreditLedgerSchema).where(eq(schema.aiCreditLedgerSchema.salonId, f.actor.salonId))).map(row => row.kind)).toEqual(['purchase']);
  });

  it('recovers post-save settlement failures from the durable receipt without charging or calling twice', async () => {
    const f = await fixture();
    const trigger = `test_credit_settlement_${randomUUID().replaceAll('-', '')}`;
    await client.exec(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.salon_id = '${f.actor.salonId}' AND NEW.kind = 'usage' THEN RAISE EXCEPTION 'synthetic settlement failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON ai_credit_ledger FOR EACH ROW EXECUTE FUNCTION ${trigger}();`);
    try {
      await expect(execute(f)).rejects.toThrow();

      expect((await openSetup(f.actor)).revision.document.business.name).toBe('New name');
      expect((await holds(f.actor))[0]?.status).toBe('held');
    } finally {
      await client.exec(`DROP TRIGGER ${trigger} ON ai_credit_ledger; DROP FUNCTION ${trigger}();`);
    }
    await reconcileAiCreditRequests(f.actor, 'test');
    await execute(f);

    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 9_999_902, reservedMicroCad: 0 });
  });

  it.each(['conversation', 'design'] as const)('recovers a saved conversation revision when its later completed marker fails (%s entry)', async (kind) => {
    const f = await fixture();
    const run = () => runWithAiCredits(f.actor, kind, f.input, AI_REQUEST_CREDIT_LIMIT, () => runSetupConversation(f.actor, f.input, f.model));
    const trigger = `test_completed_marker_${randomUUID().replaceAll('-', '')}`;
    await client.exec(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.salon_id = '${f.actor.salonId}' AND NEW.status = 'completed' THEN RAISE EXCEPTION 'synthetic completed marker failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE UPDATE ON business_setup_turn FOR EACH ROW EXECUTE FUNCTION ${trigger}();`);
    try {
      await expect(run()).rejects.toThrow();

      expect((await openSetup(f.actor)).revision.document.business.name).toBe('New name');
      expect((await holds(f.actor))[0]?.status).toBe('held');
    } finally {
      await client.exec(`DROP TRIGGER ${trigger} ON business_setup_turn; DROP FUNCTION ${trigger}();`);
    }
    await reconcileAiCreditRequests(f.actor, 'test');
    const replay = await run();

    expect(replay.head.revision.revision).toBe(2);
    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 9_999_902, reservedMicroCad: 0 });
    expect((await database.select().from(schema.aiCreditLedgerSchema).where(eq(schema.aiCreditLedgerSchema.salonId, f.actor.salonId))).filter(row => row.kind === 'usage')).toHaveLength(1);
  });

  it('recovers the exact applied child design if its post-commit job marker fails', async () => {
    const f = await fixture();
    f.input.message = 'Create my website with a dark premium design.';
    f.model.createResponse.mockResolvedValueOnce(answer({ reply: 'Creating your draft.', operationsJson: '[]', designRequest: 'A dark premium custom website', uploadFacts: null }))
      .mockResolvedValueOnce(answer(darkSource));
    const trigger = `test_design_marker_${randomUUID().replaceAll('-', '')}`;
    await client.exec(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.salon_id = '${f.actor.salonId}' AND NEW.status = 'completed' THEN RAISE EXCEPTION 'synthetic design marker failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE UPDATE ON custom_site_generation FOR EACH ROW EXECUTE FUNCTION ${trigger}();`);
    let artifactId: string | undefined;
    try {
      await expect(execute(f)).rejects.toThrow();

      artifactId = (await openSetup(f.actor)).revision.document.website.config.customFrontendId;

      expect(artifactId).toBeTruthy();
      expect((await holds(f.actor))[0]?.status).toBe('held');
    } finally {
      await client.exec(`DROP TRIGGER ${trigger} ON custom_site_generation; DROP FUNCTION ${trigger}();`);
    }
    await reconcileAiCreditRequests(f.actor, 'test');
    const replay = await execute(f);

    expect(replay.head.revision.document.website.config.customFrontendId).toBe(artifactId);
    expect(f.model.createResponse).toHaveBeenCalledTimes(2);
    expect((await holds(f.actor))[0]).toMatchObject({ status: 'settled', settledMicroCad: (await calls(f.actor)).reduce((total, call) => total + call.creditCostMicroCad!, 0) });
    expect((await database.select().from(schema.customSiteGenerationSchema).where(eq(schema.customSiteGenerationSchema.salonId, f.actor.salonId)))[0]).toMatchObject({ status: 'completed', artifactId });
    expect((await database.select().from(schema.aiCreditLedgerSchema).where(eq(schema.aiCreditLedgerSchema.salonId, f.actor.salonId))).filter(row => row.kind === 'usage')).toHaveLength(1);
  });

  it('does not mistake saved partial intake for a completed website after generation fails', async () => {
    const f = await fixture();
    f.input.message = 'My business name is New name. Create my website with a dark premium design.';
    f.model.createResponse.mockResolvedValueOnce(answer({ ...body, designRequest: 'A dark premium custom website' }))
      .mockRejectedValueOnce(new ModelProviderError('provider_error', 503));

    await expect(execute(f)).rejects.toThrow();

    expect((await openSetup(f.actor)).revision.document.business.name).toBe('New name');
    expect((await openSetup(f.actor)).revision.document.website.config.customFrontendId).toBeUndefined();
    expect((await holds(f.actor))[0]).toMatchObject({ status: 'released', settledMicroCad: 0, resolution: 'platform_failure' });
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });
    expect(f.model.createResponse).toHaveBeenCalledTimes(2);
  });

  it('does not bill a manual revision forged with the active AI operation identity', async () => {
    const f = await fixture();
    let complete!: (value: ModelProviderResponse) => void;
    f.model.createResponse.mockImplementationOnce(() => new Promise(resolve => complete = resolve));
    const running = execute(f).then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(f.model.createResponse).toHaveBeenCalledTimes(1));
    await editSetup(f.actor, { expectedRevision: 1, operationId: f.input.operationId, operations: [{ type: 'business', values: { name: 'Manual name' } }] });
    complete(answer());

    expect(await running).toHaveProperty('error');
    expect((await openSetup(f.actor)).revision.document.business.name).toBe('Manual name');
    expect((await holds(f.actor))[0]).toMatchObject({ status: 'released', settledMicroCad: 0 });
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });
  });

  it('revokes an interrupted execution before releasing its hold and rejects late draft writes', async () => {
    const f = await fixture();
    let complete!: (value: ModelProviderResponse) => void;
    f.model.createResponse.mockImplementationOnce(() => new Promise(resolve => complete = resolve));
    const running = execute(f).then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(f.model.createResponse).toHaveBeenCalledTimes(1));
    const [pending] = await calls(f.actor);
    const designId = randomUUID();
    await database.insert(schema.customSiteGenerationSchema).values({ id: designId, salonId: f.actor.salonId, actorId: f.actor.adminId, requestHash: 'synthetic-interrupted-chain', expectedRevision: 1, message: 'Synthetic interrupted design', reservedMicroUsd: 1000, status: 'pending', phase: 'generating' });
    await database.update(schema.businessSetupTurnSchema).set({ designOperationId: designId, status: 'generated' }).where(eq(schema.businessSetupTurnSchema.id, f.input.operationId));
    await database.update(schema.aiCreditReservationSchema).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.aiCreditReservationSchema.salonId, f.actor.salonId));
    await reconcileAiCreditRequests(f.actor, 'test');

    expect((await calls(f.actor))[0]).toMatchObject({ status: 'failed', validation: 'interrupted_unknown_usage', costMicroUsd: null, chargedMicroCad: pending!.chargedMicroCad, reservedMicroUsd: pending!.reservedMicroUsd });
    expect((await database.select().from(schema.customSiteGenerationSchema).where(eq(schema.customSiteGenerationSchema.id, designId)))[0]).toMatchObject({ status: 'failed', phase: 'failed' });

    complete(answer());

    expect(await running).toHaveProperty('error');
    expect((await openSetup(f.actor)).revision.revision).toBe(1);
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });
    expect((await calls(f.actor))[0]).toMatchObject({ status: 'completed', costMicroUsd: expect.any(Number) });
  });

  it('converges an older refunded orphan through normal receipt reads without releasing unknown provider expense', async () => {
    const f = await fixture();
    const other = await fixture();
    await execute(other);
    const otherEvidence = await calls(other.actor);
    let complete!: (value: ModelProviderResponse) => void;
    f.model.createResponse.mockImplementationOnce(() => new Promise(resolve => complete = resolve));
    const running = execute(f).then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(f.model.createResponse).toHaveBeenCalledTimes(1));
    const [pending] = await calls(f.actor);
    const designId = randomUUID();
    await database.insert(schema.customSiteGenerationSchema).values({ id: designId, salonId: f.actor.salonId, actorId: f.actor.adminId, requestHash: 'synthetic-legacy-orphan', expectedRevision: 1, message: 'Synthetic older interrupted design', reservedMicroUsd: 1000, status: 'pending', phase: 'generating' });
    await database.update(schema.businessSetupTurnSchema).set({ designOperationId: designId, status: 'failed' }).where(eq(schema.businessSetupTurnSchema.id, f.input.operationId));
    // Historical fixture: older recovery refunded the customer but left the
    // linked provider call/job pending. No actual provider or payment ran.
    await database.update(schema.aiCreditReservationSchema).set({ status: 'released', settledMicroCad: 0, resolution: 'platform_failure', resolvedAt: new Date() }).where(eq(schema.aiCreditReservationSchema.salonId, f.actor.salonId));
    await reconcileAiCreditRequests(other.actor, 'test');

    expect((await calls(f.actor))[0]?.status).toBe('pending');

    await reconcileAiCreditRequests(f.actor, 'test');
    await reconcileAiCreditRequests(f.actor, 'test');

    expect((await calls(f.actor))[0]).toMatchObject({ status: 'failed', validation: 'interrupted_unknown_usage', costMicroUsd: null, chargedMicroCad: pending!.chargedMicroCad, reservedMicroUsd: pending!.reservedMicroUsd });
    expect((await database.select().from(schema.customSiteGenerationSchema).where(eq(schema.customSiteGenerationSchema.id, designId)))[0]).toMatchObject({ status: 'failed', phase: 'failed' });
    expect(await calls(other.actor)).toEqual(otherEvidence);
    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });

    complete(answer());

    expect(await running).toHaveProperty('error');
    expect((await openSetup(f.actor)).revision.revision).toBe(1);
  });

  it('does not let a server execution context read another salon or meter its provider call', async () => {
    const f = await fixture();
    const other = await fixture();
    await execute(f);
    const [hold] = await holds(f.actor);
    const request = { operationId: randomUUID(), ordinal: 0, expectedRevision: 1, request: { model: 'gpt-6-luna', input: [{ role: 'user' as const, content: 'Hello' }], tools: [], maxOutputTokens: 100, timeoutMs: 1000, jsonMode: 'prompt' as const } };

    await expect(withAiCreditExecution({ reservationId: hold!.id, operationId: hold!.operationId, salonId: f.actor.salonId, adminId: f.actor.adminId, planEnv: 'test', token: hold!.executionToken!, pricing: hold!.pricing! }, () => runSetupModel(other.actor, request, other.model))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(other.model.countInputTokens).not.toHaveBeenCalled();
    expect(currentAiCreditExecution()).toBeUndefined();
  });

  it('keeps manual draft changes, reviews and account reads available without an AI balance', async () => {
    const f = await fixture(false);
    await editSetup(f.actor, { expectedRevision: 1, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'Manual free edit' } }] });

    expect((await openSetup(f.actor)).revision.document.business.name).toBe('Manual free edit');
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 0 });
    expect(await holds(f.actor)).toHaveLength(0);
  });

  it('meters menu reading once, retains missing details for review and applies accepted information without another charge', async () => {
    const f = await fixture();
    vi.stubEnv('CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES', 'true');
    const bytes = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#eeeeee' } }).png().toBuffer();
    const asset = await uploadCustomAsset(f.actor, new File([new Uint8Array(bytes)], 'synthetic-menu.png', { type: 'image/png' }), 'reference');
    f.model.createResponse.mockResolvedValue(answer({ websiteDetails: null, businessName: 'Menu studio', city: 'Toronto', address: null, homeBased: null, currency: 'CAD', hoursJson: [], servicesJson: [{ name: 'BIAB', description: null, priceKind: 'fixed', priceCents: 6500, durationMinutes: null, kind: 'base', category: 'builder_gel', bookingCategory: 'manicure' }], notes: [] }));
    const request = { operationId: f.input.operationId, expectedRevision: 1, referenceIds: [asset.id], source: 'my_business' as const };
    const extract = () => runWithAiCredits(f.actor, 'extract', request, AI_REQUEST_CREDIT_LIMIT, () => readOwnUpload(f.actor, request, f.model));
    const review = await extract();

    expect(review.status).toBe('upload_review');
    expect((await openSetup(f.actor)).revision.revision).toBe(1);

    const applied = await applyOwnUpload(f.actor, request.operationId);

    expect(applied.revision.document.services[0]).toMatchObject({ name: 'BIAB', priceCents: 6500, durationMinutes: null, confirmed: false });
    expect(applied.revision.document.business.locationDisplayMode).toBe('city_only');

    await extract();

    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
    expect(f.model.createResponse.mock.calls[0]?.[0]).toMatchObject({ model: 'gpt-6.1-sol' });
    expect((await calls(f.actor))[0]).toMatchObject({ model: 'gpt-6.1-sol', costMicroUsd: 700, creditCostMicroCad: 1960 });
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 9_998_040 });
  });

  it('uses the existing service-setting draft for a paid price edit and leaves live prices and the design unchanged', async () => {
    const f = await fixture(true, true);
    const before = (await openSetup(f.actor)).revision.document;
    const service = before.services[0]!;
    f.input.scope = 'website';
    f.input.message = 'Keep the design, but change BIAB to $65.';
    f.model.createResponse.mockResolvedValue(answer({ reply: 'BIAB is proposed at $65.', operationsJson: JSON.stringify([{ type: 'service', values: { id: service.id, name: service.name, description: service.description, priceCents: 6500, durationMinutes: service.durationMinutes, preparationBufferMinutes: service.preparationBufferMinutes, cleanupBufferMinutes: service.cleanupBufferMinutes, category: service.category, bookingCategory: service.bookingCategory } }]), designRequest: null, uploadFacts: null }));
    const result = await execute(f);

    expect(result.head.revision.document.services[0]).toMatchObject({ id: service.id, priceCents: 6500, durationMinutes: 60, confirmed: false });
    expect(result.head.revision.document.website).toEqual(before.website);
    expect((await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, service.id)))[0]).toMatchObject({ price: 6000, durationMinutes: 60 });
    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
  });

  it('allows paid editing beyond the old 200-turn pilot limit while keeping bounded conversation context', async () => {
    const f = await fixture();
    const head = await openSetup(f.actor);
    await database.insert(schema.businessSetupTurnSchema).values(Array.from({ length: 200 }, () => ({ id: randomUUID(), salonId: f.actor.salonId, workspaceId: head.workspace.id, actorId: f.actor.adminId, expectedRevision: 1, requestHash: 'synthetic-history', message: 'Earlier update', reply: 'Earlier response', status: 'completed' as const, leaseExpiresAt: new Date() })));
    await execute(f);

    expect(f.model.createResponse).toHaveBeenCalledTimes(1);

    const request = f.model.countInputTokens.mock.calls[0]![0];

    expect(request.input.length).toBeLessThanOrEqual(20);
  });

  it('funds production work from prepaid credits with a separate fixed operator expense cap', async () => {
    const f = await fixture(false);
    vi.spyOn(configuration, 'aiCreditPlanEnv').mockReturnValue('prod');
    const purchase = await beginAiCreditPurchase(f.actor, { planEnv: 'prod', operationId: randomUUID(), packKey: 'ai_10_cad_v1', stripePriceId: 'price_prod_synthetic', stripeCustomerId: 'cus_prod_synthetic' });
    await fulfillAiCreditPurchase({ purchaseId: purchase.id, salonId: f.actor.salonId, planEnv: 'prod', packKey: purchase.packKey, sessionId: `cs_${randomUUID()}`, paymentIntentId: `pi_${randomUUID()}`, customerId: purchase.stripeCustomerId, priceId: purchase.stripePriceId, amountSubtotal: 1000, amountTotal: 1000, taxCents: 0, quantity: 1, currency: 'cad', paymentStatus: 'paid', livemode: true, amountRefundedCents: 0, disputed: false });
    await execute(f);

    expect((await calls(f.actor))[0]).toMatchObject({ budgetId: SETUP_AI_PRODUCTION_BUDGET_ID, creditCostMicroCad: 98 });
    expect(await aiCreditOverview(f.actor, 'prod')).toMatchObject({ balanceMicroCad: 9_999_902 });
    expect(await aiCreditOverview(f.actor, 'test')).toMatchObject({ balanceMicroCad: 0 });
  });

  it('fails closed without a production expense cap before sending a paid call or charging the owner', async () => {
    vi.spyOn(configuration, 'aiCreditPlanEnv').mockReturnValue('prod');
    const f = await fixture(true, false, 'prod');
    vi.stubEnv('CUSTOM_SITE_PRODUCTION_BUDGET_CAD', '');

    await expect(execute(f)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(f.model.createResponse).not.toHaveBeenCalled();
    expect(await calls(f.actor)).toHaveLength(0);
    expect(await aiCreditOverview(f.actor, 'prod')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });
  });

  it('retains refunded unknown provider expense and legacy production calls, and an env increase cannot reset the cap', async () => {
    vi.spyOn(configuration, 'aiCreditPlanEnv').mockReturnValue('prod');
    const first = await fixture(true, false, 'prod');
    first.model.createResponse.mockRejectedValue(new ModelProviderError('provider_error', 502, null));

    await expect(execute(first)).rejects.toThrow();

    const [interrupted] = await calls(first.actor);

    expect(interrupted).toMatchObject({ budgetId: SETUP_AI_PRODUCTION_BUDGET_ID, status: 'failed', costMicroUsd: null });
    expect(await aiCreditOverview(first.actor, 'prod')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });

    await database.insert(schema.setupAiCallSchema).values({ id: randomUUID(), budgetId: null, creditReservationId: interrupted!.creditReservationId, salonId: first.actor.salonId, actorId: first.actor.adminId, operationId: randomUUID(), ordinal: 0, model: 'gpt-6-luna', provider: 'test-double', requestHash: 'legacy-production', reservedMicroUsd: 500, chargedMicroCad: 1000, status: 'failed' });
    const history = await database.select().from(schema.setupAiCallSchema);
    const used = history.filter(c => c.budgetId === SETUP_AI_PRODUCTION_BUDGET_ID || c.budgetId === null).reduce((s, c) => s + c.chargedMicroCad, 0);
    await database.update(schema.setupAiBudgetSchema).set({ capMicroCad: used + 1 }).where(eq(schema.setupAiBudgetSchema.id, SETUP_AI_PRODUCTION_BUDGET_ID));
    try {
      vi.stubEnv('CUSTOM_SITE_PRODUCTION_BUDGET_CAD', '100');
      const second = await fixture(true, false, 'prod');

      await expect(execute(second)).rejects.toMatchObject({ code: 'NOT_READY' });
      expect(second.model.createResponse).not.toHaveBeenCalled();
      expect(await calls(second.actor)).toHaveLength(0);
      expect((await calls(first.actor)).find(c => c.id === interrupted!.id)?.chargedMicroCad).toBe(interrupted!.chargedMicroCad);
      expect(await aiCreditOverview(second.actor, 'prod')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });
    } finally {
      await database.update(schema.setupAiBudgetSchema).set({ capMicroCad: 1_000_000 }).where(eq(schema.setupAiBudgetSchema.id, SETUP_AI_PRODUCTION_BUDGET_ID));
    }
  });

  it('allows paid design revisions beyond the old 30-design pilot limit', async () => {
    const f = await fixture();
    await database.insert(schema.customSiteGenerationSchema).values(Array.from({ length: 30 }, () => ({ id: randomUUID(), salonId: f.actor.salonId, actorId: f.actor.adminId, expectedRevision: 1, requestHash: 'synthetic-old-design', message: 'Earlier design', status: 'completed' as const, reservedMicroUsd: 0, createdAt: new Date(Date.now() - 86400_000) })));
    const input = { operationId: randomUUID(), expectedRevision: 1, message: 'Create a dark premium design.', referenceIds: [], startOver: false };
    f.model.createResponse.mockResolvedValue(answer(darkSource));
    await runWithAiCredits(f.actor, 'design', input, AI_REQUEST_CREDIT_LIMIT, () => generateCustomSite(f.actor, input, f.model));

    expect(f.model.createResponse).toHaveBeenCalledTimes(1);
    expect((await holds(f.actor))[0]).toMatchObject({ status: 'settled', requestKind: 'design' });
    expect((await openSetup(f.actor)).revision.document.website.config.customFrontendId).toBeTruthy();
  });

  it('bounds repeated refunded provider failures and allows work again after the failure window', async () => {
    vi.spyOn(configuration, 'aiCreditPlanEnv').mockReturnValue('prod');
    const f = await fixture(true, false, 'prod');
    f.model.createResponse.mockRejectedValue(new ModelProviderError('provider_error', 502, usage));
    for (let index = 0; index < 10; index++) {
      f.input.operationId = randomUUID();

      await expect(execute(f)).rejects.toThrow();
    }
    f.input.operationId = randomUUID();

    await expect(execute(f)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(f.model.countInputTokens).toHaveBeenCalledTimes(10);
    expect(f.model.createResponse).toHaveBeenCalledTimes(10);
    expect(await aiCreditOverview(f.actor, 'prod')).toMatchObject({ balanceMicroCad: 10_000_000, reservedMicroCad: 0 });

    await database.update(schema.aiCreditReservationSchema).set({ resolvedAt: new Date(Date.now() - 25 * 60 * 60_000) }).where(eq(schema.aiCreditReservationSchema.salonId, f.actor.salonId));
    f.model.createResponse.mockResolvedValue(answer());
    await execute(f);

    expect(f.model.createResponse).toHaveBeenCalledTimes(11);
    expect(await aiCreditOverview(f.actor, 'prod')).toMatchObject({ balanceMicroCad: 9_999_902 });
  });
});
