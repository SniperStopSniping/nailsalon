import { describe, expect, it } from 'vitest';

import { createDefaultOnboardingState } from '../model/defaults';
import { getReadinessItems } from './readiness';

describe('onboarding readiness contact metadata', () => {
  it('marks contact ready only for a coherent public method or Booking-only choice', () => {
    const state = createDefaultOnboardingState();
    state.profile.clientContact.primaryNumber = '416-555-0100';
    state.profile.preferredContact = 'call';
    expect(getReadinessItems(state, null).some((item) => item.id === 'contact')).toBe(false);

    state.profile.clientContact.callEnabled = true;
    expect(getReadinessItems(state, null)).toContainEqual({
      id: 'contact',
      label: 'Contact method added',
      status: 'ready',
    });

    state.profile.clientContact.callEnabled = false;
    state.profile.bookingOnlyContact = true;
    expect(getReadinessItems(state, null)).toContainEqual({
      id: 'contact',
      label: 'Contact method added',
      status: 'ready',
    });
  });
});
