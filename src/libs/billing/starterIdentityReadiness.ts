import 'server-only';

import { sql } from 'drizzle-orm';

import { isIdentityFingerprintingReady } from '@/libs/billing/businessIdentity';
import type { BillingDbTransaction } from '@/libs/billing/creditLedger';
import { Env } from '@/libs/Env';

/** Read-only rollout evidence. No contact values or fingerprints leave this module. */
export async function inspectStarterIdentityReadiness(tx: BillingDbTransaction) {
  const keysReady = isIdentityFingerprintingReady();
  const version = Env.BILLING_IDENTITY_HMAC_VERSION ?? 0;
  const result = await tx.execute(sql`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM billing_business_identity_link l
        WHERE l.business_identity_id = g.business_identity_id
          AND l.link_type = 'email_hmac' AND l.hmac_key_version = ${version}
      ))::int AS missing_email,
      COUNT(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM billing_business_identity_link l
        WHERE l.business_identity_id = g.business_identity_id
          AND l.link_type = 'phone_hmac' AND l.hmac_key_version = ${version}
      ))::int AS missing_phone,
      COUNT(*) FILTER (WHERE g.salon_id IS NULL)::int AS purged_claims
    FROM billing_starter_grant g
  `);
  const row = result.rows[0] as Record<string, unknown>;
  const totalClaims = Number(row.total);
  const missingEmail = Number(row.missing_email);
  const missingPhone = Number(row.missing_phone);
  return {
    keysReady,
    totalClaims,
    missingEmail,
    missingPhone,
    purgedClaims: Number(row.purged_claims),
    ready: keysReady && missingEmail === 0 && missingPhone === 0,
    newClaimsEnabled: Env.BILLING_STARTER_IDENTITY_READY === 'true',
  };
}
