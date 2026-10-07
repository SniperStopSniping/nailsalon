import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { foundingLifetimeClaimSchema } from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';
import {
  FOUNDING_LIFETIME_OFFER_KEY,
  FOUNDING_LIFETIME_TERMS,
  FOUNDING_LIFETIME_TERMS_VERSION,
  type FoundingLifetimeAccess,
  isFoundingLifetimeOfferOpen,
} from './foundingLifetime';

function projectClaim(claim: typeof foundingLifetimeClaimSchema.$inferSelect): FoundingLifetimeAccess {
  return {
    status: 'active',
    offerKey: FOUNDING_LIFETIME_OFFER_KEY,
    claimedAt: claim.claimedAt.toISOString(),
    expiresAt: null,
    monthlySoftwarePriceCents: 0,
    usageBilledSeparately: true,
  };
}

/** Call only after authorizing access to this salon. This never touches Stripe. */
export async function getFoundingLifetimeAccess(
  salonId: string,
  database: Pick<BillingDbTransaction, 'select'> = db,
): Promise<FoundingLifetimeAccess | null> {
  const [claim] = await database.select().from(foundingLifetimeClaimSchema)
    .where(eq(foundingLifetimeClaimSchema.salonId, salonId)).limit(1);
  return claim ? projectClaim(claim) : null;
}

/**
 * The caller must hold the current site/salon/owner membership row locks in
 * the same transaction. A claim records pricing rights, never a subscription,
 * usage allowance or delivery permission. Old interest is not auto-enrolled.
 */
export async function grantFoundingLifetimeAccess(
  tx: BillingDbTransaction,
  input: { salonId: string; siteId: string; ownerAdminId: string; now?: Date },
): Promise<{ ok: true; access: FoundingLifetimeAccess } | { ok: false; reason: 'FOUNDING_OFFER_CLOSED' }> {
  const existing = await getFoundingLifetimeAccess(input.salonId, tx);
  // Lifetime rights and response-loss retries survive the acquisition window.
  if (existing) {
    return { ok: true, access: existing };
  }
  const now = input.now ?? new Date();
  if (!isFoundingLifetimeOfferOpen(now)) {
    return { ok: false, reason: 'FOUNDING_OFFER_CLOSED' };
  }
  const [claim] = await tx.insert(foundingLifetimeClaimSchema).values({
    id: `flc_${crypto.randomUUID()}`,
    salonId: input.salonId,
    sourceSiteId: input.siteId,
    claimedByAdminId: input.ownerAdminId,
    offerKey: FOUNDING_LIFETIME_OFFER_KEY,
    termsVersion: FOUNDING_LIFETIME_TERMS_VERSION,
    terms: FOUNDING_LIFETIME_TERMS,
    claimedAt: now,
  }).onConflictDoNothing({ target: foundingLifetimeClaimSchema.salonId }).returning();
  const access = claim ? projectClaim(claim) : await getFoundingLifetimeAccess(input.salonId, tx);
  if (!access) {
    throw new Error('The lifetime claim could not be saved.');
  }
  return { ok: true, access };
}
