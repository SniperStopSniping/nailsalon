import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { lockSetupSalon, type SetupActor, type SetupTransaction } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { aiCreditAccountSchema as accounts, aiCreditLedgerSchema as ledger, aiCreditPurchaseSchema as purchases, aiCreditReservationSchema as reservations } from '@/models/Schema';

import { AI_CREDIT_PACKS, type AiCreditPackKey, type AiCreditPlanEnv } from './catalog';

export class AiCreditError extends Error {
  constructor(readonly code: 'INVALID' | 'INSUFFICIENT_CREDITS' | 'CHECKOUT_PENDING' | 'PAYMENT_MISMATCH' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'STALE', message: string) {
    super(message);
    this.name = 'AiCreditError';
  }
}

export type AiCreditBalance = { balanceMicroCad: number; reservedMicroCad: number; availableMicroCad: number; debtMicroCad: number };

/** Always lock the salon before the account; checkout, generation and refunds agree. */
export async function lockAiCreditAccount(tx: SetupTransaction, salonId: string, planEnv: AiCreditPlanEnv) {
  await tx.insert(accounts).values({ salonId, planEnv }).onConflictDoNothing();
  await tx.select().from(accounts).where(and(eq(accounts.salonId, salonId), eq(accounts.planEnv, planEnv))).for('update');
}

export async function readAiCreditBalance(tx: SetupTransaction, salonId: string, planEnv: AiCreditPlanEnv): Promise<AiCreditBalance> {
  const result = await tx.execute(sql`
    SELECT
      COALESCE((SELECT SUM(amount_micro_cad) FROM ai_credit_ledger WHERE salon_id = ${salonId} AND plan_env = ${planEnv}),0) AS balance,
      COALESCE((SELECT SUM(reserved_micro_cad) FROM ai_credit_reservation WHERE salon_id = ${salonId} AND plan_env = ${planEnv} AND status = 'held'),0) AS held
  `);
  const row = result.rows[0]!;
  const balanceMicroCad = Number(row.balance);
  const reservedMicroCad = Number(row.held);
  if (!Number.isSafeInteger(balanceMicroCad) || !Number.isSafeInteger(reservedMicroCad)) {
    throw new AiCreditError('INVALID', 'Your credit balance could not be read safely. Please contact support.');
  }
  return { balanceMicroCad, reservedMicroCad, availableMicroCad: Math.max(0, balanceMicroCad - reservedMicroCad), debtMicroCad: Math.max(0, -balanceMicroCad) };
}

export async function aiCreditOverview(actor: SetupActor, planEnv: AiCreditPlanEnv) {
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const balance = await readAiCreditBalance(tx, actor.salonId, planEnv);
    const history = await tx.select({ id: ledger.id, kind: ledger.kind, amountMicroCad: ledger.amountMicroCad, createdAt: ledger.createdAt })
      .from(ledger).where(and(eq(ledger.salonId, actor.salonId), eq(ledger.planEnv, planEnv))).orderBy(sql`${ledger.createdAt} DESC`, sql`${ledger.id} DESC`).limit(30);
    return { ...balance, currency: 'cad' as const, history };
  });
}

export async function beginAiCreditPurchase(actor: SetupActor, input: {
  planEnv: AiCreditPlanEnv;
  operationId: string;
  packKey: AiCreditPackKey;
  stripePriceId: string;
  stripeCustomerId: string;
}) {
  const pack = AI_CREDIT_PACKS[input.packKey];
  if (!pack || !input.operationId || !input.stripePriceId || !input.stripeCustomerId) {
    throw new AiCreditError('INVALID', 'Choose an available AI credit pack.');
  }
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    await lockAiCreditAccount(tx, actor.salonId, input.planEnv);
    const [previous] = await tx.select().from(purchases).where(and(eq(purchases.salonId, actor.salonId), eq(purchases.planEnv, input.planEnv), eq(purchases.operationId, input.operationId)));
    if (previous) {
      if (previous.packKey !== input.packKey || previous.actorId !== actor.adminId) {
        throw new AiCreditError('INVALID', 'This purchase request was already used.');
      }
      return previous;
    }
    const [active] = await tx.select().from(purchases).where(and(eq(purchases.salonId, actor.salonId), eq(purchases.planEnv, input.planEnv), inArray(purchases.status, ['creating', 'checkout_created'])));
    if (active) {
      // A clock timeout is not proof its Stripe session stopped being payable.
      if (active.packKey === input.packKey && active.actorId === actor.adminId) {
        return active;
      }
      throw new AiCreditError('CHECKOUT_PENDING', 'Finish or cancel your earlier credit purchase before choosing another pack.');
    }
    const [purchase] = await tx.insert(purchases).values({ id: randomUUID(), salonId: actor.salonId, planEnv: input.planEnv, actorId: actor.adminId, operationId: input.operationId, packKey: pack.key, amountCents: pack.priceCents, creditMicroCad: pack.creditMicroCad, stripePriceId: input.stripePriceId, stripeCustomerId: input.stripeCustomerId, status: 'creating', expiresAt: new Date(Date.now() + 3600_000) }).returning();
    return purchase!;
  });
}

export async function attachAiCreditCheckout(actor: SetupActor, planEnv: AiCreditPlanEnv, id: string, sessionId: string) {
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    await lockAiCreditAccount(tx, actor.salonId, planEnv);
    const [purchase] = await tx.select().from(purchases).where(and(eq(purchases.id, id), eq(purchases.salonId, actor.salonId), eq(purchases.planEnv, planEnv)));
    if (!purchase || purchase.actorId !== actor.adminId) {
      throw new AiCreditError('NOT_FOUND', 'This credit purchase is unavailable.');
    }
    if (purchase.stripeSessionId && purchase.stripeSessionId !== sessionId) {
      throw new AiCreditError('PAYMENT_MISMATCH', 'This payment could not be matched to your purchase.');
    }
    const [updated] = await tx.update(purchases).set({ stripeSessionId: sessionId, ...(purchase.status === 'creating' ? { status: 'checkout_created' as const } : {}) }).where(eq(purchases.id, id)).returning();
    return updated!;
  });
}

/** Internal evidence retrieved from Stripe; never accepted from the browser. */
export type AiCreditPaymentEvidence = {
  purchaseId: string;
  salonId: string;
  planEnv: AiCreditPlanEnv;
  packKey: string;
  sessionId: string;
  paymentIntentId: string;
  customerId: string;
  priceId: string;
  amountSubtotal: number;
  amountTotal: number;
  taxCents: number;
  quantity: number;
  currency: string;
  paymentStatus: string;
  livemode: boolean;
  amountRefundedCents: number;
  disputed: boolean;
};

function refundCredits(credits: number, refundedCents: number, paidCents: number) {
  return Number((BigInt(credits) * BigInt(refundedCents) + BigInt(paidCents) - BigInt(1)) / BigInt(paidCents));
}

export async function fulfillAiCreditPurchase(evidence: AiCreditPaymentEvidence) {
  return db.transaction(async (tx) => {
    // Resolve local ownership first, independently of event metadata.
    const [local] = await tx.select().from(purchases).where(eq(purchases.id, evidence.purchaseId));
    if (!local) {
      throw new AiCreditError('NOT_FOUND', 'This credit purchase is unavailable.');
    }
    await tx.execute(sql`SELECT id FROM salon WHERE id = ${local.salonId} FOR UPDATE`);
    await lockAiCreditAccount(tx, local.salonId, local.planEnv);
    const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, local.id)).for('update');
    if (!purchase || purchase.salonId !== evidence.salonId || purchase.planEnv !== evidence.planEnv
      || purchase.packKey !== evidence.packKey || purchase.stripePriceId !== evidence.priceId
      || purchase.stripeCustomerId !== evidence.customerId || evidence.quantity !== 1
      || evidence.currency !== 'cad' || evidence.amountSubtotal !== purchase.amountCents
      || !Number.isSafeInteger(evidence.taxCents) || evidence.taxCents < 0
      || evidence.amountTotal !== evidence.amountSubtotal + evidence.taxCents
      || (purchase.paidAmountCents !== null && purchase.paidAmountCents !== evidence.amountTotal)
      || !Number.isSafeInteger(evidence.amountRefundedCents) || evidence.amountRefundedCents < 0 || evidence.amountRefundedCents > evidence.amountTotal
      || evidence.livemode !== (purchase.planEnv === 'prod') || (evidence.paymentStatus === 'paid' && !evidence.paymentIntentId)
      || (purchase.stripeSessionId !== null && purchase.stripeSessionId !== evidence.sessionId)
      || (purchase.stripePaymentIntentId !== null && purchase.stripePaymentIntentId !== evidence.paymentIntentId)) {
      throw new AiCreditError('PAYMENT_MISMATCH', 'The payment details do not match this credit purchase.');
    }
    if (evidence.paymentStatus !== 'paid') {
      return { fulfilled: false, purchaseId: purchase.id };
    }
    if (['expired', 'failed'].includes(purchase.status)) {
      throw new AiCreditError('PAYMENT_MISMATCH', 'This purchase needs a payment review before credits can be added.');
    }
    await tx.insert(ledger).values({ id: randomUUID(), salonId: purchase.salonId, planEnv: purchase.planEnv, entryKey: `purchase:${purchase.id}`, kind: 'purchase', amountMicroCad: purchase.creditMicroCad, purchaseId: purchase.id }).onConflictDoNothing();
    const refundedCents = Math.max(purchase.refundedCents, evidence.amountRefundedCents);
    // A stale paid-session delivery cannot undo a verified won dispute.
    const disputed = purchase.disputeResolution === 'won' ? false : purchase.disputed || evidence.disputed;
    const reversed = disputed ? purchase.creditMicroCad : refundCredits(purchase.creditMicroCad, refundedCents, evidence.amountTotal);
    const adjustmentVersion = purchase.adjustmentVersion + (reversed > purchase.reversedMicroCad ? 1 : 0);
    if (reversed > purchase.reversedMicroCad) {
      await tx.insert(ledger).values({ id: randomUUID(), salonId: purchase.salonId, planEnv: purchase.planEnv, entryKey: `adjustment:${purchase.id}:${adjustmentVersion}`, kind: 'reversal', amountMicroCad: purchase.reversedMicroCad - reversed, purchaseId: purchase.id });
    }
    await tx.update(purchases).set({ status: 'paid', stripeSessionId: evidence.sessionId, stripePaymentIntentId: evidence.paymentIntentId, paidAmountCents: evidence.amountTotal, taxCents: evidence.taxCents, refundedCents, disputed, reversedMicroCad: reversed, adjustmentVersion, paidAt: purchase.paidAt ?? new Date() }).where(eq(purchases.id, purchase.id));
    return { fulfilled: true, purchaseId: purchase.id };
  });
}

/** Only called with cumulative refund/dispute evidence retrieved from Stripe. */
export async function reverseAiCreditPurchase(input: { paymentIntentId: string; planEnv: AiCreditPlanEnv; amountRefundedCents: number; disputed: boolean; disputeId?: string; disputeResolution?: 'won' | 'lost' }) {
  if (!Number.isSafeInteger(input.amountRefundedCents) || input.amountRefundedCents < 0) {
    throw new AiCreditError('PAYMENT_MISMATCH', 'Invalid refund evidence.');
  }
  if (input.disputeResolution && !input.disputeId) {
    throw new AiCreditError('PAYMENT_MISMATCH', 'A dispute resolution needs verified payment evidence.');
  }
  return db.transaction(async (tx) => {
    const [local] = await tx.select().from(purchases).where(and(eq(purchases.stripePaymentIntentId, input.paymentIntentId), eq(purchases.planEnv, input.planEnv)));
    if (!local) {
      return { matched: false };
    }
    await tx.execute(sql`SELECT id FROM salon WHERE id = ${local.salonId} FOR UPDATE`);
    await lockAiCreditAccount(tx, local.salonId, local.planEnv);
    const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, local.id)).for('update');
    if (!purchase || purchase.status !== 'paid' || !purchase.paidAmountCents || input.amountRefundedCents > purchase.paidAmountCents) {
      throw new AiCreditError('PAYMENT_MISMATCH', 'This refund needs a payment review.');
    }
    if ((purchase.disputeId && input.disputeId && purchase.disputeId !== input.disputeId)
      || (purchase.disputeResolution && input.disputeResolution && purchase.disputeResolution !== input.disputeResolution)) {
      throw new AiCreditError('PAYMENT_MISMATCH', 'This dispute needs a payment review.');
    }
    // Refund totals are monotonic. Only a retrieved terminal won dispute can
    // restore its hold, and an older open/paid event cannot reapply that hold.
    const refundedCents = Math.max(purchase.refundedCents, input.amountRefundedCents);
    const disputeResolution = purchase.disputeResolution ?? input.disputeResolution ?? null;
    const disputed = disputeResolution === 'won' ? false : disputeResolution === 'lost' || purchase.disputed || input.disputed;
    const target = disputed ? purchase.creditMicroCad : refundCredits(purchase.creditMicroCad, refundedCents, purchase.paidAmountCents);
    const delta = target - purchase.reversedMicroCad;
    const adjustmentVersion = purchase.adjustmentVersion + (delta ? 1 : 0);
    if (delta) {
      await tx.insert(ledger).values({ id: randomUUID(), salonId: purchase.salonId, planEnv: purchase.planEnv, entryKey: `adjustment:${purchase.id}:${adjustmentVersion}`, kind: delta > 0 ? 'reversal' : 'recovery', amountMicroCad: -delta, purchaseId: purchase.id });
    }
    await tx.update(purchases).set({ refundedCents, disputed, reversedMicroCad: target, adjustmentVersion, disputeId: purchase.disputeId ?? input.disputeId ?? null, disputeResolution }).where(eq(purchases.id, purchase.id));
    return { matched: true, reversedMicroCad: target };
  });
}

/** Stripe has authoritatively expired this exact session, not just a local clock. */
export async function expireAiCreditPurchase(purchaseId: string, sessionId: string, planEnv: AiCreditPlanEnv) {
  return db.transaction(async (tx) => {
    const [local] = await tx.select().from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.planEnv, planEnv)));
    if (!local) {
      return false;
    }
    await tx.execute(sql`SELECT id FROM salon WHERE id = ${local.salonId} FOR UPDATE`);
    await lockAiCreditAccount(tx, local.salonId, local.planEnv);
    const [updated] = await tx.update(purchases).set({ status: 'expired', stripeSessionId: sessionId })
      .where(and(eq(purchases.id, local.id), inArray(purchases.status, ['creating', 'checkout_created']), sql`(${purchases.stripeSessionId} IS NULL OR ${purchases.stripeSessionId} = ${sessionId})`)).returning();
    return Boolean(updated);
  });
}

export async function reserveAiCredits(actor: SetupActor, input: { planEnv: AiCreditPlanEnv; operationId: string; requestHash: string; maximumMicroCad: number }) {
  if (!Number.isSafeInteger(input.maximumMicroCad) || input.maximumMicroCad <= 0 || input.maximumMicroCad > 100_000_000 || !input.operationId || !input.requestHash) {
    throw new AiCreditError('INVALID', 'This AI request could not be priced safely.');
  }
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    await lockAiCreditAccount(tx, actor.salonId, input.planEnv);
    const [prior] = await tx.select().from(reservations).where(and(eq(reservations.salonId, actor.salonId), eq(reservations.planEnv, input.planEnv), eq(reservations.operationId, input.operationId)));
    if (prior) {
      if (prior.requestHash !== input.requestHash || prior.actorId !== actor.adminId || prior.reservedMicroCad !== input.maximumMicroCad) {
        throw new AiCreditError('INVALID', 'This request was already used for another AI change.');
      }
      return { reservation: prior, reused: true };
    }
    const balance = await readAiCreditBalance(tx, actor.salonId, input.planEnv);
    if (balance.availableMicroCad < input.maximumMicroCad) {
      throw new AiCreditError('INSUFFICIENT_CREDITS', 'Add AI credits to continue. Your saved website and bookings are safe.');
    }
    const [reservation] = await tx.insert(reservations).values({ id: randomUUID(), salonId: actor.salonId, planEnv: input.planEnv, actorId: actor.adminId, operationId: input.operationId, requestHash: input.requestHash, reservedMicroCad: input.maximumMicroCad, status: 'held' }).returning();
    return { reservation: reservation!, reused: false };
  });
}

export async function settleAiCredits(actor: SetupActor, input: { planEnv: AiCreditPlanEnv; operationId: string; actualMicroCad: number; success: boolean }) {
  if (!Number.isSafeInteger(input.actualMicroCad) || input.actualMicroCad < 0 || (!input.success && input.actualMicroCad !== 0)) {
    throw new AiCreditError('INVALID', 'Invalid AI usage settlement.');
  }
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    await lockAiCreditAccount(tx, actor.salonId, input.planEnv);
    const [hold] = await tx.select().from(reservations).where(and(eq(reservations.salonId, actor.salonId), eq(reservations.planEnv, input.planEnv), eq(reservations.operationId, input.operationId))).for('update');
    if (!hold || hold.actorId !== actor.adminId) {
      throw new AiCreditError('NOT_FOUND', 'This AI request is unavailable.');
    }
    if (input.actualMicroCad > hold.reservedMicroCad) {
      throw new AiCreditError('INVALID', 'AI usage exceeded the amount agreed for this request.');
    }
    if (hold.status !== 'held') {
      if ((hold.status === 'settled') !== input.success || hold.settledMicroCad !== input.actualMicroCad) {
        throw new AiCreditError('STALE', 'This AI request has already been resolved.');
      }
      return hold;
    }
    if (input.actualMicroCad > 0) {
      await tx.insert(ledger).values({ id: randomUUID(), salonId: actor.salonId, planEnv: input.planEnv, entryKey: `usage:${hold.id}`, kind: 'usage', amountMicroCad: -input.actualMicroCad, operationId: input.operationId });
    }
    const [resolved] = await tx.update(reservations).set({ status: input.success ? 'settled' : 'released', settledMicroCad: input.actualMicroCad, resolvedAt: new Date() }).where(eq(reservations.id, hold.id)).returning();
    return resolved!;
  });
}
