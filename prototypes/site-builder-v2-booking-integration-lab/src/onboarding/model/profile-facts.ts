import type {
  BusinessProfileDraft,
  BusinessStructure,
  LocationType,
} from './types';

export type CustomerProfileFact = {
  id: 'business_structure' | 'service_location';
  label: string;
  value: string;
};

export const getBusinessStructureCustomerLabel = (
  structure: BusinessStructure | null,
): string | null => {
  switch (structure) {
    case 'solo': return 'Solo nail tech';
    case 'multi_tech': return 'Team salon';
    default: return null;
  }
};

export const getServiceLocationCustomerLabel = (
  locationType: LocationType | null,
): string | null => {
  switch (locationType) {
    case 'home_studio': return 'Private home studio';
    case 'salon_suite': return 'Salon suite';
    case 'traditional_salon': return 'Traditional salon';
    case 'mobile_service': return 'Mobile appointments';
    default: return null;
  }
};

/** Owner-friendly, public-safe facts derived from the shared Business Profile. */
export const getCustomerProfileFacts = (
  profile: BusinessProfileDraft,
): CustomerProfileFact[] => {
  const structure = getBusinessStructureCustomerLabel(profile.businessStructure);
  const serviceLocation = getServiceLocationCustomerLabel(profile.location.locationType);
  return [
    ...(structure
      ? [{ id: 'business_structure', label: 'Business', value: structure } as const]
      : []),
    ...(serviceLocation
      ? [{ id: 'service_location', label: 'Studio', value: serviceLocation } as const]
      : []),
  ];
};
