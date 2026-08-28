import { CANONICAL_SERVICES, MOCK_ADD_ONS } from '../../booking/data';
import { createDefaultBusinessProfile } from './defaults';
import {
  CANONICAL_ONBOARDING_BOOKING_FIXTURE,
  createOnboardingBookingFixture,
  getOnboardingPreviewLocation,
} from './booking-preview';

describe('onboarding Booking preview adapter', () => {
  it('personalizes only salon metadata and preserves canonical Booking data', () => {
    const profile = createDefaultBusinessProfile();
    profile.businessName = 'Cedar Tips';
    profile.location.cityOrArea = 'Ottawa, Ontario';

    const fixture = createOnboardingBookingFixture(profile);

    expect(fixture.salon).toMatchObject({
      location: 'Ottawa, Ontario',
      name: 'Cedar Tips',
    });
    expect(fixture.services).toBe(CANONICAL_SERVICES);
    expect(fixture.addOns).toBe(MOCK_ADD_ONS);
    expect(fixture.categories).toBe(CANONICAL_ONBOARDING_BOOKING_FIXTURE.categories);
  });

  it('uses an exact address only when the profile marks it public', () => {
    const profile = createDefaultBusinessProfile();
    profile.location.cityOrArea = 'Scarborough, Ontario';
    profile.location.exactAddress = '123 Example Avenue';

    expect(getOnboardingPreviewLocation(profile)).toBe('Scarborough, Ontario');
    profile.location.addressVisibility = 'public';
    expect(getOnboardingPreviewLocation(profile)).toBe('123 Example Avenue');
  });

  it.each([
    ['Mia’s Nail Studio', 'Mia’s Nail Studio'],
    ['North Shore Nails', 'North Shore Nails'],
    ['A Very Long Independent Nail Studio Name for the North Shore', 'A Very Long Independent Nail Studio Name for the North Shore'],
    ['', 'Your nail studio'],
  ])('keeps live identity personalized for %j', (businessName, expected) => {
    const profile = createDefaultBusinessProfile();
    profile.businessName = businessName;
    const source = createOnboardingBookingFixture(profile);

    expect(source.salon.name).toBe(expected);
    if (businessName !== 'Isla Nail Studio') {
      expect(source.salon.name).not.toBe('Isla Nail Studio');
    }
    expect(source.services).toBe(CANONICAL_SERVICES);
  });
});
