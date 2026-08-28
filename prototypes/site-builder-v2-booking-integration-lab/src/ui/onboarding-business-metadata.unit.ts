import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../onboarding/fixtures';
import { createOnboardingClientBusinessMetadata } from './onboarding-business-metadata';

describe('Builder onboarding business metadata adapter', () => {
  it('projects the shared schedule and privacy-safe public metadata', () => {
    const state = createDanielaFixtureState();
    state.profile.location.exactAddress = '123 Example Avenue';
    const metadata = createOnboardingClientBusinessMetadata(state);

    expect(metadata.currentHoursStatusLabel).toBe('Open until 6:00 PM');
    expect(metadata.weeklyHours).toContainEqual({
      hours: 'Closed',
      label: 'Sunday',
      weekday: 'sunday',
    });
    expect(metadata.location).toEqual({
      detail: 'Exact address shared after booking.',
      directionsAvailable: false,
      primary: 'Scarborough, Ontario',
    });
    expect(JSON.stringify(metadata)).not.toContain('123 Example Avenue');
  });

  it('omits hidden hours and private contact details in Booking-only mode', () => {
    const state = createDanielaFixtureState();
    state.profile.hours.showOnSite = false;
    state.profile.location.addressVisibility = 'hidden';
    state.profile.location.allowGeneralAreaDirections = true;
    state.profile.clientContact.primaryNumber = '416-555-0100';
    state.profile.clientContact.callEnabled = true;
    state.profile.preferredContact = 'call';
    state.profile.bookingOnlyContact = true;
    const metadata = createOnboardingClientBusinessMetadata(state);

    expect(metadata.currentHoursStatusLabel).toBeUndefined();
    expect(metadata.weeklyHours).toEqual([]);
    expect(metadata.location.directionsAvailable).toBe(false);
    expect(metadata.contact).toEqual({
      actionLabel: 'Book now',
      detail: 'Booking is the best way to reach us',
    });
    expect(JSON.stringify(metadata)).not.toContain('416-555-0100');
  });
});
