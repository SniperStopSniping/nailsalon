import 'server-only';

import { resolvePublicBookingSelection, type ResolvedPublicBookingSelection } from '@/libs/publicBookingSelection';
import {
  getPublicTechnicianCompatibility,
  technicianSupportsPublicLocation,
  type PublicTechnicianPreview,
} from '@/libs/publicTechnicianCompatibility';
import { getTechniciansBySalonId } from '@/libs/queries';
import { normalizePublicAvatarUrl } from '@/libs/technicianAvatar';

export type ResolvedPublicBookingTechnicianContext = {
  resolvedSelection: ResolvedPublicBookingSelection;
  activeTechnicians: PublicTechnicianPreview[];
  compatibleTechnicians: PublicTechnicianPreview[];
  compatibleCount: number;
  compatibleTechnicianIds: string[];
  soleCompatibleTechnician: PublicTechnicianPreview | null;
  requestedTechnicianId: string | null;
  hasValidExplicitTechnician: boolean;
  validExplicitTechnician: PublicTechnicianPreview | null;
  effectiveTechnicianId: string | null;
  effectiveTechnician: PublicTechnicianPreview | null;
  effectiveTechnicianSelectionSource: 'explicit' | 'auto' | null;
  shouldAutoSkipTech: boolean;
};

function mapPublicTechnician(technician: Awaited<ReturnType<typeof getTechniciansBySalonId>>[number]): PublicTechnicianPreview {
  return {
    id: technician.id,
    name: technician.name,
    imageUrl: normalizePublicAvatarUrl(technician.avatarUrl),
    specialties: technician.specialties ?? [],
    rating: technician.rating ? Number(technician.rating) : null,
    reviewCount: technician.reviewCount ?? 0,
    enabledServiceIds: technician.enabledServiceIds ?? [],
    serviceIds: technician.serviceIds ?? [],
    primaryLocationId: technician.primaryLocationId ?? null,
  };
}

export async function resolvePublicBookingTechnicianContext(args: {
  salonId: string;
  baseServiceId?: string | null;
  selectedAddOns?: Array<{ addOnId: string; quantity?: number }>;
  serviceIds?: string[];
  technicianId?: string | null;
  locationId?: string | null;
  clientPhone?: string | null;
  originalAppointmentId?: string | null;
  allowAutoSkip?: boolean;
}): Promise<ResolvedPublicBookingTechnicianContext> {
  const requestedTechnicianId = args.technicianId && args.technicianId !== 'any'
    ? args.technicianId
    : null;

  const [resolvedSelection, dbTechnicians] = await Promise.all([
    resolvePublicBookingSelection({
      salonId: args.salonId,
      baseServiceId: args.baseServiceId ?? null,
      selectedAddOns: args.selectedAddOns ?? [],
      serviceIds: args.serviceIds ?? [],
      clientPhone: args.clientPhone ?? null,
      originalAppointmentId: args.originalAppointmentId ?? null,
    }),
    getTechniciansBySalonId(args.salonId),
  ]);

  const activeTechnicians = dbTechnicians.map(mapPublicTechnician).filter(tech =>
    technicianSupportsPublicLocation({
      technician: tech,
      locationId: args.locationId ?? null,
    }),
  );

  const compatibleTechnicians = activeTechnicians.filter((technician) =>
    getPublicTechnicianCompatibility({
      selectionMode: resolvedSelection.mode,
      technician,
      requestedServices: resolvedSelection.requestedServices,
    }).bookable,
  );

  const validExplicitTechnician = requestedTechnicianId
    ? compatibleTechnicians.find(technician => technician.id === requestedTechnicianId) ?? null
    : null;
  const soleCompatibleTechnician = compatibleTechnicians.length === 1
    ? compatibleTechnicians[0] ?? null
    : null;
  const shouldAutoSkipTech = Boolean(args.allowAutoSkip && soleCompatibleTechnician);
  const effectiveTechnician = validExplicitTechnician ?? (shouldAutoSkipTech ? soleCompatibleTechnician : null);

  return {
    resolvedSelection,
    activeTechnicians,
    compatibleTechnicians,
    compatibleCount: compatibleTechnicians.length,
    compatibleTechnicianIds: compatibleTechnicians.map(technician => technician.id),
    soleCompatibleTechnician,
    requestedTechnicianId,
    hasValidExplicitTechnician: Boolean(validExplicitTechnician),
    validExplicitTechnician,
    effectiveTechnicianId: effectiveTechnician?.id ?? null,
    effectiveTechnician,
    effectiveTechnicianSelectionSource: validExplicitTechnician
      ? 'explicit'
      : effectiveTechnician
        ? 'auto'
        : null,
    shouldAutoSkipTech,
  };
}
