import { describe, expect, it } from 'vitest';

import { createDefaultBusinessProfile } from './defaults';
import {
  getBusinessStructureCustomerLabel,
  getCustomerProfileFacts,
  getServiceLocationCustomerLabel,
} from './profile-facts';

describe('customer-facing Business Profile facts', () => {
  it('uses owner-friendly structure and service-location language', () => {
    expect(getBusinessStructureCustomerLabel('solo')).toBe('Solo nail tech');
    expect(getBusinessStructureCustomerLabel('multi_tech')).toBe('Team salon');
    expect(getServiceLocationCustomerLabel('home_studio')).toBe('Private home studio');
    expect(getServiceLocationCustomerLabel('salon_suite')).toBe('Salon suite');
    expect(getServiceLocationCustomerLabel('traditional_salon')).toBe('Traditional salon');
    expect(getServiceLocationCustomerLabel('mobile_service')).toBe('Mobile appointments');
  });

  it('omits empty facts and never exposes technical enum labels', () => {
    const profile = createDefaultBusinessProfile();
    expect(getCustomerProfileFacts(profile)).toEqual([]);

    profile.businessStructure = 'multi_tech';
    profile.location.locationType = 'home_studio';
    const facts = getCustomerProfileFacts(profile);
    expect(facts).toEqual([
      { id: 'business_structure', label: 'Business', value: 'Team salon' },
      { id: 'service_location', label: 'Appointments', value: 'Private home studio' },
    ]);
    expect(JSON.stringify(facts)).not.toMatch(/multi_tech|home_studio/u);
  });
});
