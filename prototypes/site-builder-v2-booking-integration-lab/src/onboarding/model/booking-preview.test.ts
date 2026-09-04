import { CANONICAL_SERVICES, MOCK_ADD_ONS } from '../../booking/data';
import {
  CANONICAL_ONBOARDING_BOOKING_FIXTURE,
  createOnboardingBookingFixture,
  getOnboardingPreviewLocation,
} from './booking-preview';
import { createDefaultBusinessProfile } from './defaults';

describe('onboarding Booking preview adapter', () => {
  it('personalizes salon metadata and filters the canonical Booking data by selected IDs', () => {
    const profile = createDefaultBusinessProfile();
    profile.businessName = 'Cedar Tips';
    profile.location.cityOrArea = 'Ottawa, Ontario';

    const fixture = createOnboardingBookingFixture(profile);

    expect(fixture.salon).toMatchObject({
      location: 'Ottawa, Ontario',
      name: 'Cedar Tips',
    });
    expect(fixture.services.map(({ id }) => id))
      .toEqual(profile.serviceMenu.selectedServiceIds);
    expect(fixture.services.every(service => CANONICAL_SERVICES.includes(service))).toBe(true);
    expect(fixture.addOns.map(({ id }) => id)).toEqual([
      'addon-french',
      'addon-chrome',
      'addon-simple-art',
      'addon-detailed-art',
    ]);
    expect(fixture.categories).toBe(CANONICAL_ONBOARDING_BOOKING_FIXTURE.categories);
    expect(fixture.labAvailability.minimumNoticeMinutes).toBe(120);
  });

  it('uses an exact address only when the profile marks it public', () => {
    const profile = createDefaultBusinessProfile();
    profile.location.cityOrArea = 'Scarborough, Ontario';
    profile.location.exactAddress = '123 Example Avenue';
    profile.location.addressVisibility = 'after_booking';

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

    expect(source.services.map(({ id }) => id))
      .toEqual(profile.serviceMenu.selectedServiceIds);
  });

  it('updates the Booking preview after canonical services are removed or added', () => {
    const profile = createDefaultBusinessProfile();
    profile.serviceMenu.selectedServiceIds = [
      'svc-manicure-gel',
      'svc-pedicure-classic',
    ];
    profile.bookingPreferences.minimumNoticeMinutes = 720;

    const fixture = createOnboardingBookingFixture(profile);

    expect(fixture.services.map(({ id }) => id)).toEqual([
      'svc-manicure-gel',
      'svc-pedicure-classic',
    ]);
    expect(fixture.labAvailability.minimumNoticeMinutes).toBe(720);
  });

  it('publishes only the canonical add-ons selected through the shared menu port', () => {
    const profile = createDefaultBusinessProfile();
    profile.serviceMenu.selectedAddOnIds = ['addon-french', 'unknown-addon'];

    const fixture = createOnboardingBookingFixture(profile);

    expect(fixture.addOns).toEqual([
      MOCK_ADD_ONS.find(({ id }) => id === 'addon-french'),
    ]);
    expect(fixture.addOns[0]).toBe(
      MOCK_ADD_ONS.find(({ id }) => id === 'addon-french'),
    );
  });
});
