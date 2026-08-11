import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/libs/DB';
import type { DepositAccountSnapshot } from '@/libs/depositPolicy';
import { salonStripeAccountSchema } from '@/models/Schema';

/**
 * ONE salon-scoped, PURE LOCAL read of the cached Connect binding — no Stripe
 * call, no write, no lock. The four fields the read-time gate consumes and
 * nothing else; `stripe_account_id` is deliberately not carried, because this
 * value reaches a public page's render graph.
 *
 * This lives in its own file so `confirm/page.test.tsx` can mock the binding
 * SOURCE without mocking the module under test — which is what keeps the
 * darkness test falsifiable.
 *
 * `revoked_at IS NULL` selects the live binding; a partial unique index makes
 * that at most one row. A revoked-only history therefore returns `null`, which
 * the gate reports as `account_not_connected`.
 */
export async function readDepositAccountSnapshot(
  salonId: string,
): Promise<DepositAccountSnapshot> {
  const [row] = await db
    .select({
      chargesEnabled: salonStripeAccountSchema.chargesEnabled,
      revokedAt: salonStripeAccountSchema.revokedAt,
      lastSyncedAt: salonStripeAccountSchema.lastSyncedAt,
      livemode: salonStripeAccountSchema.livemode,
    })
    .from(salonStripeAccountSchema)
    .where(and(
      eq(salonStripeAccountSchema.salonId, salonId),
      isNull(salonStripeAccountSchema.revokedAt),
    ))
    .limit(1);

  return row ?? null;
}
