export type PublicRequestedService = {
  id: string;
  name?: string | null;
  category?: string | null;
};

export type PublicTechnicianPreview = {
  id: string;
  name: string;
  imageUrl: string | null;
  specialties?: string[] | null;
  rating: number | null;
  reviewCount: number;
  enabledServiceIds?: string[];
  serviceIds?: string[];
  primaryLocationId: string | null;
};

export type PublicTechnicianCapabilityMode =
  | 'service_assignments'
  | 'specialty_fallback'
  | 'unrestricted';

export type PublicTechnicianCompatibility =
  | { bookable: true; reason: null }
  | { bookable: false; reason: 'service_unsupported' };

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function specialtyMatchesService(specialty: string, service: PublicRequestedService): boolean {
  const normalizedSpecialty = normalizeText(specialty);
  const normalizedServiceName = normalizeText(service.name ?? '');
  const normalizedCategory = normalizeText(service.category ?? '');

  if (!normalizedSpecialty) {
    return false;
  }

  if (normalizedCategory && normalizedSpecialty === normalizedCategory) {
    return true;
  }

  if (normalizedServiceName) {
    return normalizedSpecialty === normalizedServiceName
      || normalizedSpecialty.includes(normalizedServiceName)
      || normalizedServiceName.includes(normalizedSpecialty);
  }

  return false;
}

export function resolvePublicTechnicianCapabilityMode(
  technicians: Array<Pick<PublicTechnicianPreview, 'enabledServiceIds' | 'serviceIds' | 'specialties'>>,
  requestedServices: PublicRequestedService[],
): PublicTechnicianCapabilityMode {
  if (requestedServices.length === 0) {
    return 'unrestricted';
  }

  const hasStructuredAssignments = technicians.some(
    tech => (tech.enabledServiceIds?.length ?? 0) > 0 || (tech.serviceIds?.length ?? 0) > 0,
  );

  if (hasStructuredAssignments) {
    return 'service_assignments';
  }

  const hasCompleteSpecialties = technicians.length > 0
    && technicians.every(tech => (tech.specialties?.length ?? 0) > 0);

  return hasCompleteSpecialties ? 'specialty_fallback' : 'unrestricted';
}

export function technicianSupportsPublicLocation(args: {
  technician: Pick<PublicTechnicianPreview, 'primaryLocationId'>;
  locationId?: string | null;
}): boolean {
  const { technician, locationId } = args;

  if (!locationId) {
    return true;
  }

  return !technician.primaryLocationId || technician.primaryLocationId === locationId;
}

export function publicTechnicianCanPerformServices(args: {
  technician: Pick<PublicTechnicianPreview, 'enabledServiceIds' | 'specialties'>;
  requestedServices: PublicRequestedService[];
  capabilityMode: PublicTechnicianCapabilityMode;
}): boolean {
  const { technician, requestedServices, capabilityMode } = args;

  if (requestedServices.length === 0 || capabilityMode === 'unrestricted') {
    return true;
  }

  if (capabilityMode === 'service_assignments') {
    const enabledServiceIds = new Set(technician.enabledServiceIds ?? []);
    return requestedServices.every(service => enabledServiceIds.has(service.id));
  }

  const specialties = technician.specialties ?? [];
  return requestedServices.every(service =>
    specialties.some(specialty => specialtyMatchesService(specialty, service)),
  );
}

export function getPublicTechnicianCompatibility(args: {
  selectionMode: 'base-service' | 'legacy';
  technician: Pick<PublicTechnicianPreview, 'enabledServiceIds' | 'serviceIds' | 'specialties'>;
  requestedServices: PublicRequestedService[];
}): PublicTechnicianCompatibility {
  if (args.requestedServices.length === 0) {
    return { bookable: true, reason: null };
  }

  if (args.selectionMode === 'base-service') {
    const enabledServiceIds = new Set(args.technician.enabledServiceIds ?? []);
    const bookable = args.requestedServices.every(service => enabledServiceIds.has(service.id));
    return bookable
      ? { bookable: true, reason: null }
      : { bookable: false, reason: 'service_unsupported' };
  }

  const capabilityMode = resolvePublicTechnicianCapabilityMode([args.technician], args.requestedServices);
  return publicTechnicianCanPerformServices({
    technician: args.technician,
    requestedServices: args.requestedServices,
    capabilityMode,
  })
    ? { bookable: true, reason: null }
    : { bookable: false, reason: 'service_unsupported' };
}
