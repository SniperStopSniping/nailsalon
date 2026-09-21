import 'server-only';

import { sql } from 'drizzle-orm';

import type { NetworkNoShowHandle } from '@/libs/networkNoShow.server';

/** Transaction-local context consumed by the source-revocation trigger; never persists across pooled requests. */
export async function setNetworkNoShowAuditActorInTx(tx: NetworkNoShowHandle, actorId: string | null | undefined, actorRole: string) {
  if (process.env.NETWORK_NO_SHOW_ENABLED !== 'true' || !actorId) {
    return;
  }
  await tx.execute(sql`select set_config('luster.network_no_show_actor_id', ${actorId}, true), set_config('luster.network_no_show_actor_role', ${actorRole}, true)`);
}
