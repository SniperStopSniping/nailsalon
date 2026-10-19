import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { AI_CREDIT_PACKS, retailAiCredits } from './catalog';
import { aiCreditOverview, type AiCreditPaymentEvidence, attachAiCreditCheckout, beginAiCreditPurchase, fulfillAiCreditPurchase, reserveAiCredits, reverseAiCreditPurchase, settleAiCredits } from './wallet.server';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
const client = new PGlite();
const database = drizzle(client, { schema });

beforeAll(async () => {
  await client.waitReady;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60_000);

afterAll(async () => {
  await client.close();
});

async function owner() {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'AI credits test' });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  return actor;
}

async function purchase(actor: Awaited<ReturnType<typeof owner>>, taxCents = 0, planEnv: 'test' | 'prod' = 'test') {
  const input = { operationId: randomUUID(), packKey: 'ai_10_cad_v1' as const, planEnv, stripePriceId: 'price_ai_fixture', stripeCustomerId: 'cus_ai_fixture' };
  const row = await beginAiCreditPurchase(actor, input);
  const evidence: AiCreditPaymentEvidence = { purchaseId: row.id, salonId: actor.salonId, planEnv, packKey: input.packKey, sessionId: `cs_${randomUUID()}`, paymentIntentId: `pi_${randomUUID()}`, customerId: input.stripeCustomerId, priceId: input.stripePriceId, amountSubtotal: 1000, amountTotal: 1000 + taxCents, taxCents, quantity: 1, currency: 'cad', paymentStatus: 'paid', livemode: planEnv === 'prod', amountRefundedCents: 0, disputed: false };
  return { row, input, evidence };
}

describe('separate prepaid AI wallet', () => {
  it('prices packs at their retail value and meters sub-cent usage with integer FX arithmetic', () => {
    expect(Object.values(AI_CREDIT_PACKS).map(p => p.priceCents)).toEqual([1000, 2000, 5000]);
    expect(retailAiCredits(1_000_000, 1_400_000)).toBe(2_800_000);
    expect(retailAiCredits(1, 1_400_000)).toBe(3);
    expect(() => retailAiCredits(1, 0)).toThrow('INVALID_AI_PRICE');
    expect(() => retailAiCredits(-1, 1_400_000)).toThrow('INVALID_AI_PRICE');
  });

  it('adds nothing for creating, abandoned, or unpaid checkout', async () => {
    const actor = await owner();
    const p = await purchase(actor);

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ balanceMicroCad: 0 });

    await attachAiCreditCheckout(actor, 'test', p.row.id, p.evidence.sessionId);

    expect(await fulfillAiCreditPurchase({ ...p.evidence, paymentStatus: 'unpaid' })).toMatchObject({ fulfilled: false });
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 0 });
  });

  it('exposes a resumable purchase only inside its salon and distinguishes the initiating owner', async () => {
    const actor = await owner();
    const p = await purchase(actor);
    const second = await owner();
    await database.insert(schema.adminSalonMembershipSchema).values({ salonId: actor.salonId, adminId: second.adminId, role: 'owner' });

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ pendingPurchase: { id: p.row.id, packKey: p.row.packKey, canManage: true } });
    expect(await aiCreditOverview({ salonId: actor.salonId, adminId: second.adminId }, 'test')).toMatchObject({ pendingPurchase: { id: p.row.id, packKey: p.row.packKey, canManage: false } });
    expect(await aiCreditOverview(second, 'test')).toMatchObject({ pendingPurchase: null });
    expect(await aiCreditOverview(actor, 'prod')).toMatchObject({ pendingPurchase: null });

    await fulfillAiCreditPurchase(p.evidence);

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ pendingPurchase: null });
  });

  it('fulfills a paid purchase once even when the webhook arrives before session attachment', async () => {
    const actor = await owner();
    const p = await purchase(actor);
    await fulfillAiCreditPurchase(p.evidence);
    await fulfillAiCreditPurchase(p.evidence);
    await attachAiCreditCheckout(actor, 'test', p.row.id, p.evidence.sessionId);

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 10_000_000 });
    expect(await database.select().from(schema.aiCreditLedgerSchema).where(eq(schema.aiCreditLedgerSchema.salonId, actor.salonId))).toHaveLength(1);
  });

  it('reuses a purchase attempt and refuses changing its pack or opening another payable checkout', async () => {
    const actor = await owner();
    const p = await purchase(actor);

    expect((await beginAiCreditPurchase(actor, p.input)).id).toBe(p.row.id);
    expect((await beginAiCreditPurchase(actor, { ...p.input, operationId: randomUUID() })).id).toBe(p.row.id);
    await expect(beginAiCreditPurchase(actor, { ...p.input, packKey: 'ai_20_cad_v1' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(beginAiCreditPurchase(actor, { ...p.input, operationId: randomUUID(), packKey: 'ai_20_cad_v1' })).rejects.toMatchObject({ code: 'CHECKOUT_PENDING' });
  });

  it.each(['salonId', 'planEnv', 'packKey', 'priceId', 'customerId', 'currency', 'amountSubtotal', 'quantity', 'livemode'] as const)('rejects mismatched payment %s without granting credits', async (field) => {
    const actor = await owner();
    const p = await purchase(actor);
    const value = typeof p.evidence[field] === 'number' ? 2 : typeof p.evidence[field] === 'boolean' ? true : 'foreign';

    await expect(fulfillAiCreditPurchase({ ...p.evidence, [field]: value })).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 0 });
  });

  it('keeps development/test purchases away from the production balance', async () => {
    const actor = await owner();
    const p = await purchase(actor);
    await fulfillAiCreditPurchase(p.evidence);

    expect(await aiCreditOverview(actor, 'prod')).toMatchObject({ availableMicroCad: 0 });
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 10_000_000 });
  });

  it('rejects staff, unrelated owners, foreign holds and foreign purchases', async () => {
    const actor = await owner();
    const foreign = await owner();
    const p = await purchase(actor);
    await database.update(schema.adminSalonMembershipSchema).set({ role: 'staff' }).where(and(eq(schema.adminSalonMembershipSchema.salonId, foreign.salonId), eq(schema.adminSalonMembershipSchema.adminId, foreign.adminId)));

    await expect(aiCreditOverview(foreign, 'test')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(aiCreditOverview({ salonId: actor.salonId, adminId: foreign.adminId }, 'test')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(attachAiCreditCheckout({ salonId: actor.salonId, adminId: foreign.adminId }, 'test', p.row.id, p.evidence.sessionId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('holds credits before AI starts, prevents overspend and settles only actual successful work once', async () => {
    const actor = await owner();
    const p = await purchase(actor);
    await fulfillAiCreditPurchase(p.evidence);
    const input = { planEnv: 'test' as const, operationId: randomUUID(), requestHash: 'first', maximumMicroCad: 6_000_000 };

    expect(await reserveAiCredits(actor, input)).toMatchObject({ reused: false });
    expect(await reserveAiCredits(actor, input)).toMatchObject({ reused: true });
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 4_000_000, reservedMicroCad: 6_000_000 });
    await expect(reserveAiCredits(actor, { ...input, operationId: randomUUID(), requestHash: 'second' })).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    await expect(reserveAiCredits(actor, { ...input, requestHash: 'changed' })).rejects.toMatchObject({ code: 'INVALID' });

    const settlement = { planEnv: 'test' as const, operationId: input.operationId, actualMicroCad: 1234, success: true };
    await settleAiCredits(actor, settlement);
    await settleAiCredits(actor, settlement);

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 9_998_766, reservedMicroCad: 0 });
  });

  it('returns the entire hold on platform failure and cannot charge a released request later', async () => {
    const actor = await owner();
    const p = await purchase(actor);
    await fulfillAiCreditPurchase(p.evidence);
    const operationId = randomUUID();
    await reserveAiCredits(actor, { planEnv: 'test', operationId, requestHash: 'failure', maximumMicroCad: 500_000 });
    await settleAiCredits(actor, { planEnv: 'test', operationId, actualMicroCad: 0, success: false });
    await settleAiCredits(actor, { planEnv: 'test', operationId, actualMicroCad: 0, success: false });

    await expect(settleAiCredits(actor, { planEnv: 'test', operationId, actualMicroCad: 100, success: true })).rejects.toMatchObject({ code: 'STALE' });
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 10_000_000 });
  });

  it('does not silently expire an uncertain in-flight generation hold', async () => {
    const actor = await owner();
    const p = await purchase(actor);
    await fulfillAiCreditPurchase(p.evidence);
    await reserveAiCredits(actor, { planEnv: 'test', operationId: randomUUID(), requestHash: 'unknown', maximumMicroCad: 500_000 });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 7 * 86400_000);

      expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 9_500_000, reservedMicroCad: 500_000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses spending more than the quoted hold', async () => {
    const actor = await owner();
    const p = await purchase(actor);
    await fulfillAiCreditPurchase(p.evidence);
    const operationId = randomUUID();
    await reserveAiCredits(actor, { planEnv: 'test', operationId, requestHash: 'quote', maximumMicroCad: 200 });

    await expect(settleAiCredits(actor, { planEnv: 'test', operationId, actualMicroCad: 201, success: true })).rejects.toMatchObject({ code: 'INVALID' });
    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ reservedMicroCad: 200 });
  });

  it('reverses tax-inclusive refunds proportionally, handles duplicates/order and preserves existing work', async () => {
    const actor = await owner();
    const p = await purchase(actor, 130);
    await fulfillAiCreditPurchase(p.evidence);
    const input = { paymentIntentId: p.evidence.paymentIntentId, planEnv: 'test' as const, disputed: false };
    await reverseAiCreditPurchase({ ...input, amountRefundedCents: 565 });
    await reverseAiCreditPurchase({ ...input, amountRefundedCents: 565 });
    await reverseAiCreditPurchase({ ...input, amountRefundedCents: 100 });

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 5_000_000 });

    await reverseAiCreditPurchase({ ...input, amountRefundedCents: 1130 });

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 0 });
    expect(await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId))).toHaveLength(1);
  });

  it('does not grant spendable credits when a refund preceded checkout fulfillment', async () => {
    const actor = await owner();
    const p = await purchase(actor, 130);
    await fulfillAiCreditPurchase({ ...p.evidence, amountRefundedCents: 1130 });

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 0 });
  });

  it('blocks future AI spending after a chargeback without touching SMS credits or the website', async () => {
    const actor = await owner();
    const p = await purchase(actor);
    await fulfillAiCreditPurchase(p.evidence);
    const operationId = randomUUID();
    await reserveAiCredits(actor, { planEnv: 'test', operationId, requestHash: 'used', maximumMicroCad: 1_000_000 });
    await settleAiCredits(actor, { planEnv: 'test', operationId, actualMicroCad: 1_000_000, success: true });
    await reverseAiCreditPurchase({ paymentIntentId: p.evidence.paymentIntentId, planEnv: 'test', amountRefundedCents: 0, disputed: true });
    await fulfillAiCreditPurchase(p.evidence); // Older success events cannot restore reversed credits.

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ availableMicroCad: 0, debtMicroCad: 1_000_000 });
    expect(await database.select().from(schema.smsCreditAccountSchema).where(eq(schema.smsCreditAccountSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('restores a won dispute once, preserves refunds and ignores older dispute events', async () => {
    const actor = await owner();
    const p = await purchase(actor);
    await fulfillAiCreditPurchase(p.evidence);
    const input = { paymentIntentId: p.evidence.paymentIntentId, planEnv: 'test' as const, amountRefundedCents: 250, disputed: true, disputeId: `dp_${randomUUID()}` };
    await reverseAiCreditPurchase(input);

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ balanceMicroCad: 0 });

    await reverseAiCreditPurchase({ ...input, disputed: false, disputeResolution: 'won' });
    await reverseAiCreditPurchase({ ...input, disputed: false, disputeResolution: 'won' });
    await reverseAiCreditPurchase(input);
    await fulfillAiCreditPurchase({ ...p.evidence, disputed: true });

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ balanceMicroCad: 7_500_000 });

    // A subsequent full refund must reverse the restored credits, even when
    // that total previously existed as the original dispute hold.
    await reverseAiCreditPurchase({ ...input, disputed: false, amountRefundedCents: 1000 });
    await reverseAiCreditPurchase({ ...input, disputed: false, amountRefundedCents: 1000 });

    expect(await aiCreditOverview(actor, 'test')).toMatchObject({ balanceMicroCad: 0 });
    expect((await database.select().from(schema.aiCreditLedgerSchema).where(eq(schema.aiCreditLedgerSchema.salonId, actor.salonId))).map(row => row.amountMicroCad)).toEqual([10_000_000, -10_000_000, 7_500_000, -7_500_000]);
    await expect(reverseAiCreditPurchase({ ...input, disputeResolution: 'lost' })).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    await expect(reverseAiCreditPurchase({ ...input, disputeId: 'dp_unrelated' })).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
  });
});
