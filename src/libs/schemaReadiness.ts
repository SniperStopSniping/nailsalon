import 'server-only';

import {
  DEFAULT_JOURNAL_ENTRIES,
  getSchemaTailReadiness,
  type JournalEntry,
  type SchemaReadinessSqlHandle,
  type SchemaTailReadiness,
  type SchemaTailState,
} from '@/libs/schemaReadinessCore';

const SUCCESS_CACHE_MILLISECONDS = 30_000;
const successfulProofs = new WeakMap<object, number>();

/**
 * Bounded public status. Deliberately NOT the raw `SchemaTailReadiness`
 * object: this codebase's public health surface never exposes migration
 * tags, counts, or Postgres detail (see route.ts's own header comment and
 * the leak-guard tests in route.test.ts). Callers that need the full
 * diagnostic — expected/applied counts, the expected tail, which of the six
 * states was hit — use `getSchemaTailReadiness` from schemaReadinessCore
 * directly (internal-only).
 *
 * `ahead` is broken out from the generic `not_ready` bucket on purpose (see
 * ADR 0007). It is still not ready semantically, but in this repository —
 * dev and production share one Neon database, and the safe deploy order is
 * manual migrate-then-deploy — a count-ahead reading is routinely produced
 * by normal, safe operation (mid-deploy-window, or a developer migrating the
 * shared database with no release involved at all). Route-level gating
 * excludes `ahead` from paging for exactly that reason, so this value has to
 * stay distinguishable from `not_ready` all the way out to the response
 * body, not just internally.
 */
export type SchemaDriftStatus = 'ready' | 'not_ready' | 'ahead' | 'unavailable';

function toPublicStatus(readiness: SchemaTailReadiness): SchemaDriftStatus {
  if (readiness.state === 'query_failed') {
    return 'unavailable';
  }
  if (readiness.state === 'ahead') {
    return 'ahead';
  }
  return readiness.ready ? 'ready' : 'not_ready';
}

/**
 * Public health consumes only this aggregate status. Only successful proofs
 * are cached (mirrors isDepositsSchemaReady / isClientLifecycleSchemaReady),
 * so a database that finishes a pending migration one second after a failed
 * probe reports ready on the very next call.
 */
export async function getSchemaDriftStatus(
  handle: SchemaReadinessSqlHandle,
): Promise<SchemaDriftStatus> {
  const cacheKey = handle as object;
  const now = Date.now();
  if ((successfulProofs.get(cacheKey) ?? 0) > now) {
    return 'ready';
  }

  const readiness = await getSchemaTailReadiness(handle);
  if (readiness.ready) {
    successfulProofs.set(cacheKey, now + SUCCESS_CACHE_MILLISECONDS);
  }
  return toPublicStatus(readiness);
}

export {
  DEFAULT_JOURNAL_ENTRIES,
  getSchemaTailReadiness,
  type JournalEntry,
  type SchemaReadinessSqlHandle,
  type SchemaTailReadiness,
  type SchemaTailState,
};
