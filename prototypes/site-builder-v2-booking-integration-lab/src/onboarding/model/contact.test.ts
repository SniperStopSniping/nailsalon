import { describe, expect, it } from 'vitest';

import { createDefaultBusinessProfile } from './defaults';
import {
  contactMethodHasValue,
  getAvailableContactMethods,
  getCoherentPreferredContact,
  getPublicContactActions,
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
});
