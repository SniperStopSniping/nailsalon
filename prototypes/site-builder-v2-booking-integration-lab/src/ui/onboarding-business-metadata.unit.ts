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
      primary: 'Scarborough, Ontario',
    });
    expect(metadata.directions).toBeNull();
    expect(JSON.stringify(metadata)).not.toContain('123 Example Avenue');
  });

  it('omits hidden hours and private Call/Text details in Booking-only mode', () => {
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
    expect(metadata.directions).toBeNull();
    expect(metadata.contacts).toMatchObject([
      {
        actionLabel: 'Book now',
        detail: 'Booking is the best way to reach us',
        href: '#booking',
        method: 'booking',
      },
    ]);
    expect(JSON.stringify(metadata)).not.toContain('416-555-0100');
  });

  it('carries every resolved contact action and a privacy-safe Directions action', () => {
    const state = createDanielaFixtureState();
    state.profile.bookingOnlyContact = false;
    state.profile.clientContact = {
      callEnabled: true,
      differentTextNumber: '647-555-0199',
      primaryNumber: '416-555-0100',
      textEnabled: true,
      useDifferentTextNumber: true,
    };
    state.profile.preferredContact = 'text';
    state.profile.location.addressVisibility = 'public';
    state.profile.location.exactAddress = '123 Example Avenue';

    const metadata = createOnboardingClientBusinessMetadata(state);

    expect(metadata.contacts).toMatchObject([
      {
        actionLabel: 'Text',
        detail: '647-555-0199',
        href: 'sms:6475550199',
        preferred: true,
      },
      {
        actionLabel: 'Call',
        detail: '416-555-0100',
        href: 'tel:4165550100',
        preferred: false,
      },
      {
        actionLabel: 'Instagram',
        detail: '@islanail.studio',
        href: 'https://www.instagram.com/islanail.studio/',
        preferred: false,
      },
    ]);
    expect(metadata.directions).toEqual({
      accessibleLabel: 'Directions to 123 Example Avenue',
      href: 'https://www.google.com/maps/search/?api=1&query=123%20Example%20Avenue',
      rel: 'noopener noreferrer',
      target: '_blank',
    });
  });
});
