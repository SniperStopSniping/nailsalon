import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { cancelAiCreditCheckout, createAiCreditCheckout, reconcileAiCreditDispute, reconcileAiCreditSession } from './checkout.server';
import { aiCreditOverview } from './wallet.server';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Env', () => ({ Env: { BILLING_PLAN_ENV: 'test', NEXT_PUBLIC_APP_URL: 'https://isolated.example.invalid', BILLING_DEPLOYMENT_MARKER: 'ai-credits-test' } }));
const provider = vi.hoisted(() => ({ price: vi.fn(), create: vi.fn(), retrieve: vi.fn(), list: vi.fn(), expire: vi.fn(), customer: vi.fn(), charge: vi.fn(), dispute: vi.fn(), disputeList: vi.fn() }));
vi.mock('@/libs/stripe', () => ({ stripe: { prices: { retrieve: provider.price }, checkout: { sessions: { create: provider.create, retrieve: provider.retrieve, list: provider.list, expire: provider.expire } }, charges: { retrieve: provider.charge }, disputes: { retrieve: provider.dispute, list: provider.disputeList } } }));
vi.mock('@/libs/billing/billingCustomer', () => ({ resolveOrCreateBillingCustomer: provider.customer }));
const client = new PGlite();
const database = drizzle(client, { schema });

beforeAll(async () => {
  await client.waitReady;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_ENV', 'preview');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('AI_CREDITS_ENABLED', 'true');
  vi.stubEnv('AI_CREDIT_PURCHASES_ENABLED', 'true');
  vi.stubEnv('AI_CREDIT_STRIPE_PRICE_IDS', JSON.stringify({ env: 'test', packs: { ai_10_cad_v1: 'price_aifixture10', ai_20_cad_v1: 'price_aifixture20', ai_50_cad_v1: 'price_aifixture50' } }));
  provider.price.mockResolvedValue({ active: true, type: 'one_time', currency: 'cad', unit_amount: 1000, livemode: false });
  provider.customer.mockResolvedValue({ stripeCustomerId: 'cus_ai_fixture' });
  provider.create.mockResolvedValue({ id: `cs_${randomUUID()}`, url: 'https://checkout.stripe.com/fixture', status: 'open' });
  provider.retrieve.mockReset();
  provider.expire.mockReset();
  provider.list.mockResolvedValue({ data: [], has_more: false });
  provider.charge.mockReset();
  provider.dispute.mockReset();
  provider.disputeList.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
});

async function fixture() {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Payment test' });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  return { actor, input: { packKey: 'ai_10_cad_v1' as const, operationId: randomUUID(), locale: 'en' as const } };
}

describe('AI checkout with isolated provider boundary', () => {
  it('does not start a payment while the new purchase flag is off', async () => {
    const { actor, input } = await fixture();
    vi.stubEnv('AI_CREDIT_PURCHASES_ENABLED', 'false');

    await expect(createAiCreditCheckout(actor, input)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(provider.price).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
  });

  it.each([{ unit_amount: 1 }, { currency: 'usd' }, { livemode: true }, { active: false }, { type: 'recurring' }])('checks configured Stripe price evidence before writing a purchase: %j', async (difference) => {
    const { actor, input } = await fixture();
    provider.price.mockResolvedValue({ active: true, type: 'one_time', currency: 'cad', unit_amount: 1000, livemode: false, ...difference });

    await expect(createAiCreditCheckout(actor, input)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(provider.create).not.toHaveBeenCalled();
    expect(await database.select().from(schema.aiCreditPurchaseSchema).where(eq(schema.aiCreditPurchaseSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('creates a one-time, owner-bound, fixed-pack checkout and grants no credits on redirect alone', async () => {
    const { actor, input } = await fixture();
    const result = await createAiCreditCheckout(actor, input);

    expect(result.status).toBe('ready');

    const [args, options] = provider.create.mock.calls[0]!;

    expect(args).toMatchObject({ mode: 'payment', customer: 'cus_ai_fixture', payment_method_types: ['card'], line_items: [{ price: 'price_aifixture10', quantity: 1 }], automatic_tax: { enabled: false }, metadata: { purpose: 'ai_credit_topup', salonId: actor.salonId, planEnv: 'test', packKey: input.packKey, luster_deployment: 'ai-credits-test' } });
    expect(options.idempotencyKey).toContain(`ai-credit-checkout:test:${result.purchaseId}`);
    expect(args.success_url).toContain('https://isolated.example.invalid/en/admin/business-setup?');
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 0 });
  });

  it('reuses the same purchase and Stripe idempotency key after an uncertain create response', async () => {
    const { actor, input } = await fixture();
    provider.create.mockRejectedValueOnce(new Error('response lost'));

    await expect(createAiCreditCheckout(actor, input)).rejects.toThrow('response lost');
    expect((await createAiCreditCheckout(actor, input)).status).toBe('ready');
    expect(provider.create.mock.calls[0]![1].idempotencyKey).toBe(provider.create.mock.calls[1]![1].idempotencyKey);
    expect(provider.create.mock.calls[0]![0]).toEqual(provider.create.mock.calls[1]![0]);
    expect(await database.select().from(schema.aiCreditPurchaseSchema).where(eq(schema.aiCreditPurchaseSchema.salonId, actor.salonId))).toHaveLength(1);
  });

  it('keeps an older unknown payment held rather than creating another payable session', async () => {
    const { actor, input } = await fixture();
    provider.create.mockRejectedValueOnce(new Error('response lost'));

    await expect(createAiCreditCheckout(actor, input)).rejects.toThrow();

    await database.update(schema.aiCreditPurchaseSchema).set({ createdAt: new Date(Date.now() - 24 * 3600_000), expiresAt: new Date(Date.now() - 23 * 3600_000) }).where(eq(schema.aiCreditPurchaseSchema.salonId, actor.salonId));

    expect((await createAiCreditCheckout(actor, input)).status).toBe('pending');
    expect(provider.create).toHaveBeenCalledTimes(1);
  });

  it('recovers a paid checkout after a lost create response without creating a second session', async () => {
    const { actor, input } = await fixture();
    provider.create.mockRejectedValueOnce(new Error('response lost'));

    await expect(createAiCreditCheckout(actor, input)).rejects.toThrow();

    const [args] = provider.create.mock.calls[0]!;
    const session = { id: `cs_${randomUUID()}`, metadata: args.metadata, livemode: false, customer: 'cus_ai_fixture', status: 'complete', currency: 'cad', payment_status: 'paid', amount_subtotal: 1000, amount_total: 1000, total_details: { amount_tax: 0 }, payment_intent: { id: `pi_${randomUUID()}`, latest_charge: { id: `ch_${randomUUID()}`, amount_refunded: 0, disputed: false } }, line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_aifixture10' } }] } };
    provider.list.mockResolvedValue({ data: [session], has_more: false });
    provider.retrieve.mockResolvedValue(session);
    await database.update(schema.aiCreditPurchaseSchema).set({ createdAt: new Date(Date.now() - 24 * 3600_000), expiresAt: new Date(Date.now() - 23 * 3600_000) }).where(eq(schema.aiCreditPurchaseSchema.salonId, actor.salonId));

    expect((await createAiCreditCheckout(actor, input)).status).toBe('paid');
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 10_000_000 });
  });

  it('does not attach an ambiguous recovered payment or mint a new session', async () => {
    const { actor, input } = await fixture();
    provider.create.mockRejectedValueOnce(new Error('response lost'));

    await expect(createAiCreditCheckout(actor, input)).rejects.toThrow();

    const [args] = provider.create.mock.calls[0]!;
    provider.list.mockResolvedValue({ data: [{ id: 'cs_first', metadata: args.metadata }, { id: 'cs_second', metadata: args.metadata }], has_more: false });
    await database.update(schema.aiCreditPurchaseSchema).set({ createdAt: new Date(Date.now() - 24 * 3600_000), expiresAt: new Date(Date.now() - 23 * 3600_000) }).where(eq(schema.aiCreditPurchaseSchema.salonId, actor.salonId));

    await expect(createAiCreditCheckout(actor, input)).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 0 });
  });

  it('retrieves current dispute and charge evidence instead of trusting a closed event', async () => {
    provider.dispute.mockResolvedValue({ id: 'dp_fixture', charge: 'ch_fixture', payment_intent: 'pi_expected', livemode: false, status: 'won' });
    provider.charge.mockResolvedValue({ id: 'ch_fixture', payment_intent: 'pi_foreign', livemode: false, amount_refunded: 0 });

    await expect(reconcileAiCreditDispute('dp_fixture', 'test')).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    expect(provider.dispute).toHaveBeenCalledWith('dp_fixture');
    expect(provider.charge).toHaveBeenCalledWith('ch_fixture');
  });

  it('reconciles a retrieved paid session once and honors later refunds before returning credits', async () => {
    const { actor, input } = await fixture();
    const result = await createAiCreditCheckout(actor, input);
    const [args] = provider.create.mock.calls[0]!;
    const sessionId = (await provider.create.mock.results[0]!.value).id;
    const session = { id: sessionId, metadata: args.metadata, livemode: false, customer: 'cus_ai_fixture', status: 'complete', currency: 'cad', payment_status: 'paid', amount_subtotal: 1000, amount_total: 1000, total_details: { amount_tax: 0 }, payment_intent: { id: `pi_${randomUUID()}`, latest_charge: { id: `ch_${randomUUID()}`, amount_refunded: 0, disputed: false } }, line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_aifixture10' } }] } };
    provider.retrieve.mockResolvedValue(session);

    expect((await reconcileAiCreditSession(result.purchaseId!, 'test')).status).toBe('paid');
    expect((await reconcileAiCreditSession(result.purchaseId!, 'test')).status).toBe('paid');
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 10_000_000 });

    provider.retrieve.mockResolvedValue({ ...session, payment_intent: { ...session.payment_intent, latest_charge: { ...session.payment_intent.latest_charge, amount_refunded: 1000 } } });
    await reconcileAiCreditSession(result.purchaseId!, 'test');

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 0 });
  });

  it('cancels only its own verified open session without charging or granting credits', async () => {
    const { actor, input } = await fixture();
    const result = await createAiCreditCheckout(actor, input);
    const sessionId = (await provider.create.mock.results[0]!.value).id;
    provider.retrieve.mockResolvedValue({ id: sessionId, status: 'open' });
    provider.expire.mockResolvedValue({ id: sessionId, status: 'expired' });

    expect((await cancelAiCreditCheckout(actor, result.purchaseId!, 'test')).status).toBe('expired');
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 0 });
    expect(await database.select({ status: schema.aiCreditPurchaseSchema.status }).from(schema.aiCreditPurchaseSchema).where(eq(schema.aiCreditPurchaseSchema.id, result.purchaseId!))).toEqual([{ status: 'expired' }]);
  });

  it('recovers a dispute that was already won before checkout fulfillment arrived', async () => {
    const { actor, input } = await fixture();
    const result = await createAiCreditCheckout(actor, input);
    const [args] = provider.create.mock.calls[0]!;
    const sessionId = (await provider.create.mock.results[0]!.value).id;
    const charge = { id: `ch_${randomUUID()}`, payment_intent: `pi_${randomUUID()}`, livemode: false, amount_refunded: 0, disputed: true };
    const dispute = { id: `dp_${randomUUID()}`, charge: charge.id, payment_intent: charge.payment_intent, livemode: false, status: 'won' };
    provider.retrieve.mockResolvedValue({ id: sessionId, metadata: args.metadata, livemode: false, customer: 'cus_ai_fixture', status: 'complete', currency: 'cad', payment_status: 'paid', amount_subtotal: 1000, amount_total: 1000, total_details: { amount_tax: 0 }, payment_intent: { id: charge.payment_intent, latest_charge: charge }, line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_aifixture10' } }] } });
    provider.charge.mockResolvedValue(charge);
    provider.disputeList.mockResolvedValue({ data: [dispute], has_more: false });
    provider.dispute.mockResolvedValue(dispute);

    expect((await reconcileAiCreditSession(result.purchaseId!, 'test')).status).toBe('paid');
    expect((await reconcileAiCreditSession(result.purchaseId!, 'test')).status).toBe('paid');
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 10_000_000 });
    expect(await database.select().from(schema.aiCreditLedgerSchema).where(eq(schema.aiCreditLedgerSchema.salonId, actor.salonId))).toHaveLength(3);
  });
});
