import 'server-only';

import { resolveCatalogDomainView } from '@/libs/bookingCatalog';
import type { CatalogSelectionInput } from '@/libs/catalogDomain';
import { finalizeCatalogResolutionFingerprintNode } from '@/libs/catalogResolver.server';
import type { CatalogAcknowledgmentInput, CatalogConflictPayload } from '@/libs/catalogSubmissionReconciliation.server';
import type { BookingDiscountReadContext } from '@/libs/firstVisitDiscount';
import { L1BookingAuthorityError, resolveL1BookingAuthority } from '@/libs/l1BookingAuthority.server';
import { projectPublicBookingCatalog } from '@/libs/publicBookingCatalog';
import type { SalonFeatures } from '@/types/salonPolicy';

export function projectL1ConflictPayload(payload: CatalogConflictPayload): CatalogConflictPayload {
  return {
    ...payload,
    // Keep the authority's original resolution/fingerprint: recomputing from
    // this redacted DTO would change the acknowledged material.
    snapshot: projectPublicBookingCatalog(payload.snapshot, new Set([payload.resolution.serviceId])),
  };
}

export class L1SelectionChangedError extends Error {
  constructor(readonly payload: CatalogConflictPayload | null) {
    super('CATALOG_SELECTION_CHANGED');
  }
}

/** The same original selection and acknowledged material cross every channel. */
export async function reconcileAuthoritativeL1Selection(args: {
  salonId: string;
  features: SalonFeatures | null | undefined;
  selection: CatalogSelectionInput | null;
  clientAcknowledgment?: CatalogAcknowledgmentInput;
  readContext?: Pick<BookingDiscountReadContext, 'database' | 'salonId'>;
}) {
  if (resolveCatalogDomainView(args.features) !== 'l1') {
    return { status: 'not_applicable' as const };
  }
  if (!args.selection) {
    return { status: 'unavailable' as const, failure: 'L1_SELECTION_REQUIRED' };
  }
  try {
    const result = await resolveL1BookingAuthority({ salonId: args.salonId, selection: args.selection, readContext: args.readContext });
    if (!result) {
      return { status: 'unavailable' as const, failure: null };
    }
    const acknowledgment = args.clientAcknowledgment;
    if (!acknowledgment || acknowledgment.serviceId !== args.selection.serviceId || acknowledgment.resolutionFingerprint !== result.fingerprint) {
      return { status: 'conflict' as const, payload: projectL1ConflictPayload({ reason: 'material_change', recovery: 'reload_catalog_and_reselect', snapshot: result.snapshot, resolution: result.resolution, resolutionFingerprint: result.fingerprint } satisfies CatalogConflictPayload) };
    }
    return { status: 'ok' as const, snapshot: result.snapshot, resolution: result.resolution, resolutionFingerprint: result.fingerprint, eligibleTechnicianIds: result.eligibleTechnicianIds };
  } catch (error) {
    if (error instanceof L1BookingAuthorityError && error.code === 'unavailable') {
      return { status: 'unavailable' as const, failure: null };
    }
    if (error instanceof L1BookingAuthorityError && error.recovery) {
      const fingerprint = await finalizeCatalogResolutionFingerprintNode(error.recovery.snapshot, error.recovery.resolution);
      return { status: 'conflict' as const, payload: projectL1ConflictPayload({ reason: 'selection_invalid', recovery: 'reload_catalog_and_reselect', ...error.recovery, resolutionFingerprint: fingerprint.revision.fingerprint! } satisfies CatalogConflictPayload) };
    }
    if (error instanceof L1BookingAuthorityError) {
      return { status: 'unavailable' as const, failure: null };
    }
    throw error;
  }
}
