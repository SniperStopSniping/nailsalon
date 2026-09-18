import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { appointmentDepositSchema } from '@/models/Schema';

/** In-window retrievals allowed per deposit. */
const POLL_WINDOW_CAP = 20;
/** Lifetime retrievals allowed per deposit. NEVER reset. */
const POLL_LIFETIME_CAP = 200;
/** How long a retrieval window lasts before it rolls. */
const POLL_WINDOW_MS = 10 * 60_000;

/**
 * ONE conditional UPDATE that reads and writes all three counters ATOMICALLY.
 *
 * Three columns, not two, and that is not redundancy: one integer cannot both
 * reset on a window roll and never reset. `poll_window_retrievals` is the
 * in-window counter, `poll_retrievals` is the lifetime ceiling, and
 * `poll_window_started_at` is the anchor that decides which of them moves.
 *
 * Returns false when the budget is spent. THE CALLER ANSWERS 200 WITH LOCAL
 * STATE, never 429: the session id is visible to several parties by design, so
 * a 4xx on budget exhaustion is a denial primitive pointed at the payer.
 */
export async function authorizeDepositRecoveryRetrieval(depositId: string, salonId: string): Promise<boolean> {
  const windowCutoff = new Date(Date.now() - POLL_WINDOW_MS);
  const rows = await db
    .update(appointmentDepositSchema)
    .set({
      pollWindowStartedAt: sql`CASE
        WHEN ${appointmentDepositSchema.pollWindowStartedAt} IS NULL
          OR ${appointmentDepositSchema.pollWindowStartedAt} < ${windowCutoff}
        THEN now()
        ELSE ${appointmentDepositSchema.pollWindowStartedAt}
      END`,
      pollWindowRetrievals: sql`CASE
        WHEN ${appointmentDepositSchema.pollWindowStartedAt} IS NULL
          OR ${appointmentDepositSchema.pollWindowStartedAt} < ${windowCutoff}
        THEN 1
        ELSE ${appointmentDepositSchema.pollWindowRetrievals} + 1
      END`,
      pollRetrievals: sql`${appointmentDepositSchema.pollRetrievals} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(appointmentDepositSchema.id, depositId),
      eq(appointmentDepositSchema.salonId, salonId),
      sql`${appointmentDepositSchema.pollRetrievals} < ${POLL_LIFETIME_CAP}`,
      sql`(${appointmentDepositSchema.pollWindowStartedAt} IS NULL
        OR ${appointmentDepositSchema.pollWindowStartedAt} < ${windowCutoff}
        OR ${appointmentDepositSchema.pollWindowRetrievals} < ${POLL_WINDOW_CAP})`,
    ))
    .returning();

  return rows.length > 0;
}
