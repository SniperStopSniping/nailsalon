import { describe, expect, it } from 'vitest';

import { createDefaultBusinessProfile } from './defaults';
import {
  contactMethodHasValue,
  getAvailableContactMethods,
  getCoherentPreferredContact,
  getPublicContactPreview,
} from './contact';

describe('client contact model', () => {
  it('uses one number for enabled Call and Text methods', () => {
    const profile = createDefaultBusinessProfile();
    profile.clientContact = {
      callEnabled: true,
      differentTextNumber: '',
      primaryNumber: '416-555-0100',
      textEnabled: true,
      useDifferentTextNumber: false,
    };
    profile.preferredContact = 'text';

    expect(getAvailableContactMethods(profile)).toEqual(['text', 'call']);
    expect(contactMethodHasValue(profile, 'call')).toBe(true);
    expect(getPublicContactPreview(profile)).toEqual({
      actionLabel: 'Text',
      detail: '416-555-0100',
      method: 'text',
    });
  });

  it('uses the disclosed text number and keeps the preferred method coherent', () => {
    const profile = createDefaultBusinessProfile();
    profile.clientContact = {
      callEnabled: true,
      differentTextNumber: '647-555-0199',
      primaryNumber: '416-555-0100',
      textEnabled: true,
      useDifferentTextNumber: true,
    };
    profile.preferredContact = 'text';
    expect(getPublicContactPreview(profile)?.detail).toBe('647-555-0199');

    profile.clientContact.textEnabled = false;
    expect(getCoherentPreferredContact(profile)).toBe('call');
  });

  it('keeps saved contact details private in Booking-only mode', () => {
    const profile = createDefaultBusinessProfile();
    profile.clientContact.primaryNumber = '416-555-0100';
    profile.clientContact.callEnabled = true;
    profile.preferredContact = 'call';
    profile.bookingOnlyContact = true;

    expect(getPublicContactPreview(profile)).toEqual({
      actionLabel: 'Book now',
      detail: 'Booking is the best way to reach us',
      method: 'booking',
    });
    expect(JSON.stringify(getPublicContactPreview(profile))).not.toContain('416-555-0100');
  });
});
