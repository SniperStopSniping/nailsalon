import { type SQL, sql } from 'drizzle-orm';

/**
 * Migration-application probe for the deposits foundation (0065).
 *
 * Deploying D2 before 0065 has been applied does not break anything — Drizzle's
 * `pgTable` mapping is inert at import — but every D2 route must be able to
 * refuse cleanly instead of surfacing a raw "relation does not exist" to a
 * caller. This is that check, and it is the control the deployment ordering
 * actually rests on: the proof that 0065 is live is this probe, not a screenshot
 * of a migration command.
 *
 * NEVER THROWS. Any failure — missing tables, missing migration ledger, a dead
 * connection — resolves to `false`.
 */

export type DepositsReadinessSqlHandle = {
  execute: (query: SQL) => Promise<unknown>;
};

/**
 * `when` of the `0065_deposits_foundation` entry in `migrations/meta/_journal.json`.
 * The Drizzle migrator writes this value into `drizzle.__drizzle_migrations.created_at`,
 * so matching it proves *this* migration ran, not merely that tables of the same
 * name exist.
 */
export const DEPOSITS_MIGRATION_CREATED_AT = 1786297234998;

const SUCCESS_CACHE_MILLISECONDS = 30_000;
const successfulProofs = new WeakMap<object, number>();

function readRows(result: unknown): Record<string, unknown>[] {
  const resultWithRows = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(resultWithRows?.rows)) {
    return resultWithRows.rows;
  }
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

/**
 * Only successful proofs are cached, so a database that becomes ready one second
 * after a failed probe reports ready on the very next call.
 */
export async function isDepositsSchemaReady(
  handle: DepositsReadinessSqlHandle,
): Promise<boolean> {
  const cacheKey = handle as object;
  const now = Date.now();
  if ((successfulProofs.get(cacheKey) ?? 0) > now) {
    return true;
  }

  let ready = false;
  try {
    const result = await handle.execute(sql`
      select (
        to_regclass('public.salon_stripe_account') is not null
        and to_regclass('public.appointment_deposit') is not null
        and to_regclass('public.stripe_webhook_event') is not null
        and (
          select count(*)
          from drizzle.__drizzle_migrations
          where created_at = ${DEPOSITS_MIGRATION_CREATED_AT}
        ) = 1
      ) as ok
    `);
    ready = readRows(result)[0]?.ok === true;
  } catch {
    return false;
  }

  if (ready) {
    successfulProofs.set(cacheKey, now + SUCCESS_CACHE_MILLISECONDS);
  }
  return ready;
}
