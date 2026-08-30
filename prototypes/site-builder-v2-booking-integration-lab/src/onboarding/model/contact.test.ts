import { describe, expect, it } from 'vitest';

import { createDefaultBusinessProfile } from './defaults';
import {
  contactMethodHasValue,
  getAvailableContactMethods,
  getCoherentPreferredContact,
  getInstagramInputError,
  getPublicContactActions,
  getPublicContactPreview,
  resolveInstagramUsername,
} from './contact';

describe('client contact model', () => {
  it('uses one number for enabled Call and Text methods', () => {
    const profile = createDefaultBusinessProfile();
    profile.bookingOnlyContact = false;
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
    expect(getPublicContactActions(profile)).toMatchObject([
      {
        actionLabel: 'Text',
        href: 'sms:4165550100',
        preferred: true,
      },
      {
        actionLabel: 'Call',
        href: 'tel:4165550100',
        preferred: false,
      },
    ]);
  });

  it('uses the disclosed text number and keeps the preferred method coherent', () => {
    const profile = createDefaultBusinessProfile();
    profile.bookingOnlyContact = false;
    profile.clientContact = {
      callEnabled: true,
      differentTextNumber: '647-555-0199',
      primaryNumber: '416-555-0100',
      textEnabled: true,
      useDifferentTextNumber: true,
    };
    profile.preferredContact = 'text';
    expect(getPublicContactPreview(profile)?.detail).toBe('647-555-0199');
    expect(getPublicContactActions(profile)[0]).toMatchObject({
      detail: '647-555-0199',
      href: 'sms:6475550199',
    });

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
    expect(getPublicContactActions(profile)).toMatchObject([
      { actionLabel: 'Book now', href: '#booking', preferred: true },
    ]);
  });

  it('publishes every permitted safe channel and emphasizes only the preferred one', () => {
    const profile = createDefaultBusinessProfile();
    profile.bookingOnlyContact = false;
    profile.clientContact.primaryNumber = '416-555-0100';
    profile.clientContact.callEnabled = true;
    profile.clientContact.textEnabled = true;
    profile.instagram = '@your_nail_studio';
    profile.email = 'hello@example.com';
    profile.preferredContact = 'call';

    expect(getPublicContactActions(profile).map((action) => ({
      label: action.actionLabel,
      preferred: action.preferred,
    }))).toEqual([
      { label: 'Call', preferred: true },
      { label: 'Text', preferred: false },
      { label: 'Instagram', preferred: false },
      { label: 'Email', preferred: false },
    ]);
  });

  it.each([
    ['islanailstudio', 'islanailstudio'],
    ['@islanailstudio', 'islanailstudio'],
    ['instagram.com/islanailstudio', 'islanailstudio'],
    ['www.instagram.com/islanailstudio', 'islanailstudio'],
    ['https://instagram.com/islanailstudio', 'islanailstudio'],
    ['https://www.instagram.com/islanailstudio/', 'islanailstudio'],
    ['  @Isla.Nails_Studio  ', 'Isla.Nails_Studio'],
  ])('normalizes the accepted Instagram owner input %s', (input, username) => {
    expect(resolveInstagramUsername(input)).toEqual({
      status: 'resolved',
      username,
    });
    expect(getInstagramInputError(input)).toBeUndefined();
  });

  it.each([
    ['isla nail studio', 'Enter only your Instagram username'],
    ['isla-nails', 'Enter only your Instagram username'],
    ['https://instagram.com/islanailstudio/reels', 'Enter only your Instagram username'],
    ['http://instagram.com/islanailstudio', 'Enter only your Instagram username'],
    ['instagram.com/', 'Enter only your Instagram username'],
    ['abcdefghijklmnopqrstuvwxyz12345', 'Instagram usernames can be up to 30 characters'],
  ])('rejects invalid Instagram owner input %s', (input, message) => {
    expect(resolveInstagramUsername(input).status).toBe('invalid');
    expect(getInstagramInputError(input)).toContain(message);
  });

  it('excludes an invalid Instagram value from completeness, preference, and public actions', () => {
    const profile = createDefaultBusinessProfile();
    profile.bookingOnlyContact = false;
    profile.instagram = 'instagram.com/isla/reels';
    profile.preferredContact = 'instagram';

    expect(contactMethodHasValue(profile, 'instagram')).toBe(false);
    expect(getCoherentPreferredContact(profile)).toBeNull();
    expect(getPublicContactActions(profile)).toEqual([]);

    profile.instagram = 'https://www.instagram.com/islanailstudio/';
    expect(contactMethodHasValue(profile, 'instagram')).toBe(true);
    expect(getCoherentPreferredContact(profile)).toBe('instagram');
    expect(getPublicContactActions(profile)[0]).toMatchObject({
      detail: 'islanailstudio',
      href: 'https://www.instagram.com/islanailstudio/',
      preferred: true,
    });
  });
});
