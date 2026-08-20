import 'server-only';

// VALUE import from the catalog module set — this file is an authorized
// edge in `architecturalInvariants.test.ts` (invariant 5). This is the
// hard constraint from the PR6 brief made concrete in code: an owner
// preview MUST resolve through the SAME two functions booking would use,
// never a second price/duration engine. Nothing below performs arithmetic
// of its own — it only calls `resolvePublicCatalogSnapshot` /
// `resolveCatalogSelectionForSalon` and reshapes their ALREADY-COMPUTED
// result for the response.
import type { CatalogSelectionInput, ResolvedCatalogSelection } from '@/libs/catalogDomain';
import {
  resolveCatalogSelectionForSalon,
  resolvePublicCatalogSnapshot,
} from '@/libs/catalogResolver.server';

export type CatalogPreviewOutcome =
  | { ok: true; selection: ResolvedCatalogSelection }
  | { ok: false; code: string };

/**
 * Resolves ONE selection against the salon's CURRENT live catalog, through
 * the exact same two functions `catalogSubmissionReconciliation.server.ts`
 * (booking's own reconciliation step) calls. `requestedSource: 'live'` is
 * hardcoded — there is no draft catalog to preview (see
 * `catalogResolver.server.ts`'s own module doc comment) — so an owner
 * always sees exactly what a client booking right now would compute.
 */
export async function previewCatalogSelection(
  salonId: string,
  selection: CatalogSelectionInput,
): Promise<CatalogPreviewOutcome> {
  const snapshotResult = await resolvePublicCatalogSnapshot({ salonId, requestedSource: 'live' });
  if (!snapshotResult.ok) {
    return { ok: false, code: snapshotResult.failure.code };
  }

  const resolutionResult = await resolveCatalogSelectionForSalon({
    salonId,
    snapshot: snapshotResult.snapshot,
    selection,
  });
  if (!resolutionResult.ok) {
    return { ok: false, code: resolutionResult.failure.code };
  }

  return { ok: true, selection: resolutionResult.selection };
}
