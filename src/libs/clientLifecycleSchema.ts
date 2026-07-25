import 'server-only';

import {
  getClientLifecycleSchemaReadiness,
  type LifecycleReadinessSqlHandle,
} from '@/libs/clientLifecycleSchemaCore';

const SUCCESS_CACHE_MILLISECONDS = 30_000;
const successfulProofs = new WeakMap<object, number>();

/**
 * Public health consumes only this aggregate readiness result. The complete
 * catalog and bounded-behavior proof remains private to the server.
 *
 * Only successful proofs are cached. A failed migration can therefore become
 * healthy on the next probe immediately after a clean retry commits.
 */
export async function isClientLifecycleSchemaReady(
  handle: LifecycleReadinessSqlHandle,
): Promise<boolean> {
  const cacheKey = handle as object;
  const now = Date.now();
  if ((successfulProofs.get(cacheKey) ?? 0) > now) {
    return true;
  }

  const readiness = await getClientLifecycleSchemaReadiness(handle);
  if (readiness.ready) {
    successfulProofs.set(cacheKey, now + SUCCESS_CACHE_MILLISECONDS);
  }
  return readiness.ready;
}

export {
  CLIENT_LIFECYCLE_CAPABILITY_VERSION,
  CLIENT_LIFECYCLE_MIGRATION_CREATED_AT,
  type ClientLifecycleReadinessCategory,
  type ClientLifecycleSchemaReadiness,
  getClientLifecycleSchemaReadiness,
} from '@/libs/clientLifecycleSchemaCore';
