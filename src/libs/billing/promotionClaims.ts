/**
 * Founding-promotion claims — reserve-before-checkout lifecycle.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §7.3.
 *
 * Eligibility is transactionally RESERVED before any Stripe checkout
 * session exists: once-per-business holds via the partial unique on
 * (promotion_key, business_identity_id) over live statuses, and the
 * redemption cap is enforced under SELECT ... FOR UPDATE on the dedicated
 * billing_promotion_counter lock row (a count-then-insert without that
 * lock is a cap race). Cancel/resubscribe cannot re-reserve a redeemed
 * claim; released/expired claims free the once-per-business slot only.
 */

import 'server-only';

import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import { getPromotion, type PromotionDefinition } from '@/libs/billing/promotions';
import { billingPromotionClaimSchema, billingPromotionCounterSchema } from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';

export const PROMOTION_CLAIM_TTL_MS = 60 * 60 * 1000;

export type ReserveClaimResult =
  | { ok: true; claimId: string; reused: boolean }
  | { ok: false; reason: 'PROMOTION_UNKNOWN' | 'ALREADY_CLAIMED' | 'REDEMPTION_CAP_REACHED' };

export async function reservePromotionClaim(
  tx: BillingDbTransaction,
  input: {
    promotionKey: string;
    businessIdentityId: string;
    salonId: string;
    checkoutAttemptId?: string | null;
    now?: Date;
    /** Test seam: overrides the catalogue definition (e.g. a finite cap). */
    promotionOverride?: PromotionDefinition;
  },
): Promise<ReserveClaimResult> {
  const now = input.now ?? new Date();
  const promotion = input.promotionOverride ?? getPromotion(input.promotionKey);
  if (promotion === null) {
    return { ok: false, reason: 'PROMOTION_UNKNOWN' };
  }

  // Serialize all reservations for this promotion on the counter lock row.
  await tx
    .insert(billingPromotionCounterSchema)
    .values({ promotionKey: input.promotionKey })
    .onConflictDoNothing();
  await tx
    .select({ promotionKey: billingPromotionCounterSchema.promotionKey })
    .from(billingPromotionCounterSchema)
    .where(eq(billingPromotionCounterSchema.promotionKey, input.promotionKey))
    .for('update');

  const existing = await tx
    .select({
      id: billingPromotionClaimSchema.id,
      status: billingPromotionClaimSchema.status,
      salonId: billingPromotionClaimSchema.salonId,
    })
    .from(billingPromotionClaimSchema)
    .where(and(
      eq(billingPromotionClaimSchema.promotionKey, input.promotionKey),
      eq(billingPromotionClaimSchema.businessIdentityId, input.businessIdentityId),
      inArray(billingPromotionClaimSchema.status, ['reserved', 'redeemed']),
    ))
    .limit(1);
  if (existing.length > 0) {
    // Reuse is SAME-SALON only. A reserved claim held by a DIFFERENT salon
    // of the same business must refuse: reusing it would hand every salon of
    // one business its own founding-priced session inside the reservation
    // window, defeating once-per-business (§3.3/§7.3 — adversarial review
    // finding 1). The business identity holds ONE slot, whoever finishes it.
    if (existing[0]!.status === 'reserved' && existing[0]!.salonId === input.salonId) {
      return { ok: true, claimId: existing[0]!.id, reused: true };
    }
    return { ok: false, reason: 'ALREADY_CLAIMED' };
  }

  if (promotion.maximumRedemptions !== null) {
    const live = await tx.execute(sql`
      SELECT COUNT(*)::int AS live FROM billing_promotion_claim
      WHERE promotion_key = ${input.promotionKey} AND status IN ('reserved', 'redeemed')
    `);
    const liveCount = Number((live.rows[0] as Record<string, unknown>).live);
    if (liveCount >= promotion.maximumRedemptions) {
      return { ok: false, reason: 'REDEMPTION_CAP_REACHED' };
    }
  }

  const claimId = `bpc_${crypto.randomUUID()}`;
  await tx.insert(billingPromotionClaimSchema).values({
    id: claimId,
    promotionKey: input.promotionKey,
    businessIdentityId: input.businessIdentityId,
    salonId: input.salonId,
    billingCheckoutAttemptId: input.checkoutAttemptId ?? null,
    status: 'reserved',
    reservedAt: now,
    expiresAt: new Date(now.getTime() + PROMOTION_CLAIM_TTL_MS),
  });
  return { ok: true, claimId, reused: false };
}

export async function redeemPromotionClaim(
  tx: BillingDbTransaction,
  input: { claimId: string; stripeCheckoutSessionId: string; now?: Date },
): Promise<{ redeemed: boolean }> {
  const now = input.now ?? new Date();
  const updated = await tx
    .update(billingPromotionClaimSchema)
    .set({ status: 'redeemed', redeemedAt: now, stripeCheckoutSessionId: input.stripeCheckoutSessionId })
    .where(and(
      eq(billingPromotionClaimSchema.id, input.claimId),
      eq(billingPromotionClaimSchema.status, 'reserved'),
    ))
    .returning();
  if (updated.length === 1) {
    return { redeemed: true };
  }
  const already = await tx
    .select({ status: billingPromotionClaimSchema.status })
    .from(billingPromotionClaimSchema)
    .where(eq(billingPromotionClaimSchema.id, input.claimId))
    .limit(1);
  return { redeemed: already[0]?.status === 'redeemed' };
}

export async function releasePromotionClaim(
  tx: BillingDbTransaction,
  input: { claimId: string; now?: Date },
): Promise<{ released: boolean }> {
  const now = input.now ?? new Date();
  const updated = await tx
    .update(billingPromotionClaimSchema)
    .set({ status: 'released', releasedAt: now })
    .where(and(
      eq(billingPromotionClaimSchema.id, input.claimId),
      eq(billingPromotionClaimSchema.status, 'reserved'),
    ))
    .returning();
  return { released: updated.length === 1 };
}

/** Abandoned reserved claims past their TTL free the once-per-business slot. */
export async function expireStaleClaims(
  tx: BillingDbTransaction,
  now = new Date(),
): Promise<{ expired: number }> {
  const updated = await tx
    .update(billingPromotionClaimSchema)
    .set({ status: 'expired', releasedAt: now })
    .where(and(
      eq(billingPromotionClaimSchema.status, 'reserved'),
      lt(billingPromotionClaimSchema.expiresAt, now),
    ))
    .returning();
  return { expired: updated.length };
}
