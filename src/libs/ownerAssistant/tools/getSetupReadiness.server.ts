import 'server-only';

import { loadSetupReadiness } from '@/libs/setupReadiness/readiness.server';

import type { SetupReadinessToolResult } from '../contracts';
import { OwnerAssistantSalonMissingError } from './getSalonOverview.server';

/**
 * `get_setup_readiness` (A1-3 Piece 2; docs/OWNER_ASSISTANT_CHAT.md §3).
 *
 * A thin adapter and nothing else. Every rule about what "ready" means lives
 * in `src/libs/setupReadiness/` — the same projection the Today screen and the
 * publish dialog will read — so the assistant can never tell an owner a
 * different story about their setup than the dashboard does.
 *
 * The four fields are handed over BY REFERENCE rather than rebuilt field by
 * field: the projection owns its frozen contract (and its own privacy test),
 * and a field added there must reach the model instead of being silently
 * dropped by a stale mapping here.
 */
export async function getSetupReadiness(
  salonId: string,
  options: { now?: Date } = {},
): Promise<SetupReadinessToolResult> {
  const readiness = await loadSetupReadiness(salonId, options.now ?? new Date());

  if (!readiness) {
    throw new OwnerAssistantSalonMissingError();
  }

  return {
    salon: readiness.salon,
    items: readiness.items,
    customersWillSee: readiness.customersWillSee,
    computedAt: readiness.computedAt,
  };
}
