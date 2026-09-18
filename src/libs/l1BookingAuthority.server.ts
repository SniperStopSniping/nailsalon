import 'server-only';

import { and, eq } from 'drizzle-orm';

import { resolveCatalogDomainView } from '@/libs/bookingCatalog';
import type {
  CatalogResolutionResult,
  CatalogSelectionInput,
  CatalogSnapshotResult,
  PublicCatalogSnapshot,
  ResolvedCatalogSelection,
} from '@/libs/catalogDomain';
import {
  finalizeCatalogResolutionFingerprintNode,
  resolveCatalogSelectionForSalon,
  resolvePublicCatalogSnapshot,
} from '@/libs/catalogResolver.server';
import type { BookingDiscountReadContext } from '@/libs/firstVisitDiscount';
import {
  salonSchema,
  technicianSchema,
  technicianServicesSchema,
} from '@/models/Schema';

type L1ReadContext = Pick<BookingDiscountReadContext, 'database' | 'salonId'>;

export type L1BookingAuthority = {
  snapshot: PublicCatalogSnapshot;
  resolution: ResolvedCatalogSelection;
  fingerprint: string;
  eligibleTechnicianIds: string[];
};

export class L1BookingAuthorityError extends Error {
  constructor(
    readonly code: 'invalid_selection' | 'unsupported_technician' | 'unavailable',
    readonly recovery?: { snapshot: PublicCatalogSnapshot; resolution: ResolvedCatalogSelection },
  ) {
    super(`L1_BOOKING_AUTHORITY_${code.toUpperCase()}`);
    this.name = 'L1BookingAuthorityError';
  }
}

/**
 * Resolves the dark L1 catalog once for booking. It deliberately returns only
 * public catalog data and technician ids; capability rows never cross this
 * boundary. An any-artist request is evaluated against each concrete active,
 * service-assigned technician, never against the core's unevaluated null case.
 */
export async function resolveL1BookingAuthority(args: {
  salonId: string;
  selection: CatalogSelectionInput;
  readContext?: L1ReadContext;
}): Promise<L1BookingAuthority | null> {
  if (args.readContext && args.readContext.salonId !== args.salonId) {
    throw new Error('L1_BOOKING_READ_CONTEXT_SALON_MISMATCH');
  }
  const database = args.readContext?.database ?? (await import('@/libs/DB')).db;
  const [salon] = await database
    .select({ features: salonSchema.features })
    .from(salonSchema)
    .where(eq(salonSchema.id, args.salonId))
    .limit(1);
  if (!salon) {
    throw new L1BookingAuthorityError('unavailable');
  }
  if (resolveCatalogDomainView(salon.features) !== 'l1') {
    return null;
  }

  const snapshotResult: CatalogSnapshotResult = await resolvePublicCatalogSnapshot({
    salonId: args.salonId,
    requestedSource: 'live',
    readContext: { database, salonId: args.salonId },
  });
  if (!snapshotResult.ok) {
    throw new L1BookingAuthorityError('unavailable');
  }

  // Consultation is explicitly deferred by the service configuration contract.
  // Never reinterpret an unsupported stored/inherited mode as an instant booking.
  const selectedService = snapshotResult.snapshot.services.find(service => service.id === args.selection.serviceId);
  if (selectedService?.effectiveConfirmationMode === 'consultation') {
    throw new L1BookingAuthorityError('unavailable');
  }

  const assignments = await database
    .select({ technicianId: technicianSchema.id })
    .from(technicianSchema)
    .innerJoin(
      technicianServicesSchema,
      and(
        eq(technicianServicesSchema.technicianId, technicianSchema.id),
        eq(technicianServicesSchema.serviceId, args.selection.serviceId),
        eq(technicianServicesSchema.enabled, true),
      ),
    )
    .where(and(
      eq(technicianSchema.salonId, args.salonId),
      eq(technicianSchema.isActive, true),
    ));
  const candidateIds = assignments.map(row => row.technicianId);
  const requestedTechnicianId = args.selection.technicianId ?? null;
  const candidates = requestedTechnicianId === null
    ? candidateIds
    : candidateIds.filter(id => id === requestedTechnicianId);
  if (requestedTechnicianId !== null && candidates.length === 0) {
    throw new L1BookingAuthorityError('unsupported_technician');
  }

  const evaluated = await Promise.all(candidates.map(async technicianId => ({
    technicianId,
    result: await resolveCatalogSelectionForSalon({
      salonId: args.salonId,
      snapshot: snapshotResult.snapshot,
      selection: { ...args.selection, technicianId },
      readContext: { database, salonId: args.salonId },
    }),
  })));
  const eligible = evaluated.filter((item): item is typeof item & { result: Extract<CatalogResolutionResult, { ok: true }> } => (
    item.result.ok && !item.result.selection.blocksContinue
  ));
  const chosen = eligible[0];
  if (!chosen) {
    const selectedCandidate = requestedTechnicianId === null ? null : evaluated.find(item => item.technicianId === requestedTechnicianId);
    if (selectedCandidate?.result.ok
      && selectedCandidate.result.selection.violations.length > 0
      && selectedCandidate.result.selection.violations.every(violation => violation.code === 'capability_unavailable')) {
      throw new L1BookingAuthorityError(
        'unsupported_technician',
        { snapshot: snapshotResult.snapshot, resolution: selectedCandidate.result.selection },
      );
    }
    const fallback = await resolveCatalogSelectionForSalon({
      salonId: args.salonId,
      snapshot: snapshotResult.snapshot,
      // The core needs a concrete false result for any-artist when nobody is
      // eligible. Never pass null and accidentally leave capability unchecked.
      selection: { ...args.selection, technicianId: requestedTechnicianId ?? '__no_eligible_l1_technician__' },
      readContext: { database, salonId: args.salonId },
    });
    if (!fallback.ok) {
      throw new L1BookingAuthorityError('unavailable');
    }
    throw new L1BookingAuthorityError(
      candidateIds.length === 0 ? 'unavailable' : 'invalid_selection',
      { snapshot: snapshotResult.snapshot, resolution: fallback.selection },
    );
  }
  const finalized = await finalizeCatalogResolutionFingerprintNode(
    snapshotResult.snapshot,
    chosen.result.selection,
  );
  if (!finalized.revision.fingerprint) {
    throw new L1BookingAuthorityError('unavailable');
  }
  return {
    snapshot: snapshotResult.snapshot,
    resolution: chosen.result.selection,
    fingerprint: finalized.revision.fingerprint,
    eligibleTechnicianIds: eligible.map(item => item.technicianId),
  };
}
