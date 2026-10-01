import 'server-only';

import { sql } from 'drizzle-orm';

import type { BillingDbTransaction } from './creditLedger';

export type StarterAllowanceStatus = 'verified' | 'verification_required' | 'unclaimed';

/**
 * Persisted allowance evidence, independent of the remaining starter balance.
 * Reads only the requested salon's durable identity; never creates links or grants.
 */
export async function getStarterAllowanceStatus(
  tx: BillingDbTransaction,
  salonId: string,
): Promise<StarterAllowanceStatus> {
  const result = await tx.execute(sql`
    SELECT
      EXISTS (
        SELECT 1 FROM billing_starter_grant g
        WHERE g.salon_id = ${salonId}
          OR g.business_identity_id IN (
            SELECT business_identity_id FROM billing_business_identity_link
            WHERE link_type = 'salon' AND link_value = ${salonId}
          )
      ) AS claimed,
      EXISTS (
        SELECT 1 FROM billing_business_identity_link s
        JOIN billing_starter_grant g ON g.business_identity_id = s.business_identity_id
        WHERE s.link_type = 'salon' AND s.link_value = ${salonId}
          AND EXISTS (
            SELECT 1 FROM billing_business_identity_link e
            WHERE e.business_identity_id = s.business_identity_id AND e.link_type = 'email_hmac'
          )
          AND EXISTS (
            SELECT 1 FROM billing_business_identity_link p
            WHERE p.business_identity_id = s.business_identity_id AND p.link_type = 'phone_hmac'
          )
      ) AS verified
  `);
  const row = result.rows[0] as { claimed: boolean; verified: boolean };
  return row.verified ? 'verified' : row.claimed ? 'verification_required' : 'unclaimed';
}
