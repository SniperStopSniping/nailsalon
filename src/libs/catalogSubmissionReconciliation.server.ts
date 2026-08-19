import 'server-only';

import { resolveCatalogDomainView } from '@/libs/bookingCatalog';
import type {
  CatalogCorruptionFailure,
  CatalogSelectionInput,
  PublicCatalogSnapshot,
  ResolvedCatalogSelection,
} from '@/libs/catalogDomain';
import {
  finalizeCatalogResolutionFingerprintNode,
  resolveCatalogSelectionForSalon,
  resolvePublicCatalogSnapshot,
} from '@/libs/catalogResolver.server';
import type { SalonFeatures } from '@/types/salonPolicy';

/**
 * Luster L1 PR4 — §13, the FIRST step of the pinned reconciliation order
 * (`bookingSubmissionOrder.ts`). The only step of PR4's new plumbing that is
 * actually wired into `POST /api/appointments` (`route.ts`) — see that
 * module's doc comment and the PR4 report for why §14/§15 stop short of
 * being wired.
 *
 * WHAT THIS MODULE DOES: at submission, loads the salon's FRESH, live,
 * tenant-authorized catalog through the PR3 server/core boundary
 * (`catalogResolver.server.ts`), resolves the client's requested selection
 * against it, and compares the resulting MATERIAL fingerprint — never the
 * coarser `catalogRevision` — against whatever fingerprint the client
 * acknowledged. See ADR 0005: a changed `catalogRevision` alone (e.g. an
 * owner editing a description) must NOT interrupt a booking in progress;
 * only a material change to THIS customer's resolved selection may.
 *
 * WHAT THIS MODULE DOES NOT DO: it never influences price, duration, tax,
 * deposit, or appointment status. `bookingQuote.ts` /
 * `validatePublicBookingSelection` remain the sole authority for what gets
 * charged and persisted, exactly as before this PR. This module can only
 * ever produce two outcomes: "proceed, nothing changed" (the caller's
 * EXISTING flow continues completely unchanged) or "stop, here is a
 * public-safe conflict payload" (zero persistence/payment/deposit side
 * effects follow) — see `CatalogReconciliationOutcome`.
 *
 * GATED, NOT ALWAYS-ON: `resolveCatalogDomainView` (`bookingCatalog.ts`)
 * returns `'l1'` only when a salon has explicitly opted into one of the
 * three dark `catalog.*` feature keys — unreachable by any preset, off for
 * every salon in this database today (`l1CatalogFeatureKeys.test.ts`). For
 * every real salon, `reconcileCatalogSelection` returns `{ status:
 * 'not_applicable' }` immediately, with no DB read at all — this is what
 * makes wiring this into `route.ts` provably a no-op for current production
 * traffic, not merely an assumption.
 */

export type CatalogAcknowledgmentInput = {
  /** The service the client believes it is booking. A mismatch here is itself a stale acknowledgment, independent of the fingerprint. */
  serviceId: string;
  /** The `CatalogResolutionFingerprint.fingerprint` (SHA-256 hex) the client computed/displayed for its current selection. */
  resolutionFingerprint: string;
};

export type CatalogConflictReason =
  /** The fresh resolution disagrees with what the client acknowledged for the identical selection. */
  | 'material_change'
  /** The fresh resolution is not bookable AS SUBMITTED (violations present), independent of any prior acknowledgment. */
  | 'selection_invalid';

/**
 * Everything a caller may show a client on conflict. Every field here is
 * already a `Public*`/allowlisted PR3 type (`PublicCatalogSnapshot`,
 * `ResolvedCatalogSelection` — both structurally incapable of carrying a
 * rule id, priority, note, raw params, or capability id; see
 * `catalogDomain.ts`'s own doc comments and
 * `catalogSubmissionReconciliation.server.test.ts`'s own denylist/allowlist
 * scan of this exact payload shape) plus two bounded, typed strings.
 */
export type CatalogConflictPayload = {
  reason: CatalogConflictReason;
  /** A fixed, non-localized recovery instruction code — never free text derived from server internals. */
  recovery: 'reload_catalog_and_reselect';
  snapshot: PublicCatalogSnapshot;
  resolution: ResolvedCatalogSelection;
  resolutionFingerprint: string;
};

export type CatalogReconciliationOutcome =
  /** `resolveCatalogDomainView !== 'l1'`, or the request has no single resolvable base service (legacy multi-service basket). Every real salon today. */
  | { status: 'not_applicable' }
  | { status: 'ok'; snapshot: PublicCatalogSnapshot; resolution: ResolvedCatalogSelection; resolutionFingerprint: string }
  | { status: 'conflict'; payload: CatalogConflictPayload }
  /** Fail-closed: the catalog data itself is corrupt (see `CatalogCorruptionFailure`). Never surfaced to the client verbatim — the caller logs it and returns a generic 503. */
  | { status: 'unavailable'; failure: CatalogCorruptionFailure };

export type ReconcileCatalogSelectionArgs = {
  salonId: string;
  features: SalonFeatures | null | undefined;
  /** Null when the request used the legacy `serviceIds[]` basket rather than a single `baseServiceId` — the L1 catalog model has no multi-service concept, so reconciliation is `not_applicable` in that shape. */
  selection: CatalogSelectionInput | null;
  clientAcknowledgment?: CatalogAcknowledgmentInput;
  now?: Date;
};

export async function reconcileCatalogSelection(
  args: ReconcileCatalogSelectionArgs,
): Promise<CatalogReconciliationOutcome> {
  if (resolveCatalogDomainView(args.features) !== 'l1' || args.selection === null) {
    return { status: 'not_applicable' };
  }

  const snapshotResult = await resolvePublicCatalogSnapshot({
    salonId: args.salonId,
    requestedSource: 'live',
    now: args.now,
  });
  if (!snapshotResult.ok) {
    return { status: 'unavailable', failure: snapshotResult.failure };
  }

  const resolutionResult = await resolveCatalogSelectionForSalon({
    salonId: args.salonId,
    snapshot: snapshotResult.snapshot,
    selection: args.selection,
  });
  if (!resolutionResult.ok) {
    return { status: 'unavailable', failure: resolutionResult.failure };
  }

  const { revision } = await finalizeCatalogResolutionFingerprintNode(
    snapshotResult.snapshot,
    resolutionResult.selection,
  );
  // `finalizeCatalogResolutionFingerprintNode` always sets `fingerprint` —
  // it is the one function on this path whose entire job is to compute it.
  const resolutionFingerprint = revision.fingerprint!;

  if (resolutionResult.selection.blocksContinue) {
    return {
      status: 'conflict',
      payload: {
        reason: 'selection_invalid',
        recovery: 'reload_catalog_and_reselect',
        snapshot: snapshotResult.snapshot,
        resolution: resolutionResult.selection,
        resolutionFingerprint,
      },
    };
  }

  const ack = args.clientAcknowledgment;
  const materialChange = ack !== undefined
    && (ack.serviceId !== args.selection.serviceId || ack.resolutionFingerprint !== resolutionFingerprint);
  if (materialChange) {
    return {
      status: 'conflict',
      payload: {
        reason: 'material_change',
        recovery: 'reload_catalog_and_reselect',
        snapshot: snapshotResult.snapshot,
        resolution: resolutionResult.selection,
        resolutionFingerprint,
      },
    };
  }

  return {
    status: 'ok',
    snapshot: snapshotResult.snapshot,
    resolution: resolutionResult.selection,
    resolutionFingerprint,
  };
}
