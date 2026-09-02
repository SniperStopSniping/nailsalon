import type {
  AddressVisibility,
  BusinessStructure,
  LocationType,
  OnboardingBusinessType,
} from './types';

export const LUSTER_SITE_HOST = 'lustergel.app';

export const BUSINESS_TYPE_OPTIONS: ReadonlyArray<{
  description: string;
  id: OnboardingBusinessType;
  label: string;
}> = [
  {
    description: 'I work independently from a salon, suite or studio.',
    id: 'independent_salon',
    label: 'Independent nail tech — salon/studio',
  },
  {
    description: 'I see clients from my home studio.',
    id: 'home_based',
    label: 'Home-based nail tech',
  },
  {
    description: 'I travel to my clients.',
    id: 'mobile',
    label: 'Mobile nail tech',
  },
  {
    description: 'We have multiple nail techs or staff.',
    id: 'salon_team',
    label: 'Salon / studio',
  },
];

export const isPersonalBusinessType = (
  businessType: OnboardingBusinessType | null,
): boolean => businessType !== null && businessType !== 'salon_team';

export const deriveLegacyBusinessFields = (
  businessType: OnboardingBusinessType,
): {
  addressVisibility?: AddressVisibility;
  businessStructure: BusinessStructure;
  locationType: LocationType;
} => {
  switch (businessType) {
    case 'home_based':
      return {
        addressVisibility: 'hidden',
        businessStructure: 'solo',
        locationType: 'home_studio',
      };
    case 'mobile':
      return {
        addressVisibility: 'hidden',
        businessStructure: 'solo',
        locationType: 'mobile_service',
      };
    case 'salon_team':
      return { businessStructure: 'multi_tech', locationType: 'traditional_salon' };
    case 'independent_salon':
      return { businessStructure: 'solo', locationType: 'salon_suite' };
  }
};

export const inferOnboardingBusinessType = (input: {
  businessStructure: BusinessStructure | null;
  locationType: LocationType | null;
}): OnboardingBusinessType | null => {
  if (input.businessStructure === 'multi_tech') return 'salon_team';
  if (input.locationType === 'home_studio') return 'home_based';
  if (input.locationType === 'mobile_service') return 'mobile';
  if (input.businessStructure === 'solo') return 'independent_salon';
  return null;
};

export const normalizeSiteSlug = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/gu, '')
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/gu, '-')
  .replace(/^-+|-+$/gu, '')
  .slice(0, 48)
  .replace(/-+$/gu, '');

export const normalizeSiteSlugInput = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/gu, '')
  .toLocaleLowerCase()
  .replace(/[^a-z0-9-]+/gu, '-')
  .replace(/-{2,}/gu, '-')
  .slice(0, 48);

const RESERVED_SITE_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'book',
  'dashboard',
  'help',
  'login',
  'onboarding',
  'settings',
  'signup',
  'support',
]);

export const validateSiteSlug = (value: string): string => {
  if (!value) return 'Add a web address.';
  if (value.length < 3) return 'Use at least 3 letters or numbers.';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(value)) {
    return 'Use lowercase letters, numbers and hyphens only.';
  }
  if (RESERVED_SITE_SLUGS.has(value)) return 'Choose a different web address.';
  return '';
};

export const siteUrlForSlug = (slug: string): string => `${LUSTER_SITE_HOST}/${slug}`;
