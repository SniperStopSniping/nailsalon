import 'server-only';

import { eq } from 'drizzle-orm';

import {
  isIdentityFingerprintingReady,
  normalizeEmailForHmac,
  normalizeVerifiedPhone,
  resolveOrCreateBusinessIdentity,
} from '@/libs/billing/businessIdentity';
import { grantStarterCredits } from '@/libs/billing/creditGrants';
import type { BillingDbTransaction } from '@/libs/billing/creditLedger';
import { Env } from '@/libs/Env';
import { billingStarterGrantSchema } from '@/models/Schema';

export type StarterClaimStatus = 'granted' | 'already_claimed' | 'verification_required' | 'identity_setup_required';

/** Only server-verified owner contacts may enter this boundary. Missing proof never blocks salon setup. */
export async function claimVerifiedStarterCredits(
  tx: BillingDbTransaction,
  input: {
    salonId: string;
    clerkUserId: string;
    verifiedEmail: string | null;
    verifiedPhone: string | null;
  },
): Promise<{ granted: boolean; status: StarterClaimStatus }> {
  if (!input.verifiedEmail || !normalizeEmailForHmac(input.verifiedEmail)
    || !input.verifiedPhone || !normalizeVerifiedPhone(input.verifiedPhone)) {
    return { granted: false, status: 'verification_required' };
  }
  if (!isIdentityFingerprintingReady()) {
    return { granted: false, status: 'identity_setup_required' };
  }
  const identity = await resolveOrCreateBusinessIdentity(tx, input);
  // Existing owners may attach their verified contacts during rollout without
  // receiving another allowance. Only new claims depend on the history gate.
  const [existing] = await tx.select({ id: billingStarterGrantSchema.id })
    .from(billingStarterGrantSchema)
    .where(eq(billingStarterGrantSchema.businessIdentityId, identity.businessIdentityId))
    .limit(1);
  if (existing) {
    return { granted: false, status: 'already_claimed' };
  }
  if (Env.BILLING_STARTER_IDENTITY_READY !== 'true') {
    return { granted: false, status: 'identity_setup_required' };
  }
  const result = await grantStarterCredits(tx, {
    salonId: input.salonId,
    businessIdentityId: identity.businessIdentityId,
  });
  return { granted: result.granted, status: result.granted ? 'granted' : 'already_claimed' };
}
