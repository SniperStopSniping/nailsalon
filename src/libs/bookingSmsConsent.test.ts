import {
  resolveBookingSmsConsentDecision,
  resolveBookingSmsMode,
  shouldRecordBookingSmsConsent,
} from './bookingSmsConsent';

describe('booking SMS reminder preference', () => {
  it('defaults new and malformed salon settings to default on', () => {
    expect(resolveBookingSmsMode(null)).toBe('default_on');
    expect(resolveBookingSmsMode({ communications: { sms: { bookingDefault: 'unexpected' } } })).toBe('default_on');
  });

  it('retains the selection provenance without treating the salon default as explicit consent', () => {
    const defaultDecision = resolveBookingSmsConsentDecision('default_on', {
      granted: true,
      wordingVersion: 'booking-sms-reminders-v1',
      selection: 'default_on',
    });

    expect(defaultDecision).toEqual({ status: 'granted', selection: 'default_on', isExplicit: false });

    expect(shouldRecordBookingSmsConsent({ decision: defaultDecision!, providerOptedOut: false })).toBe(true);
  });

  it('permits an explicit change but never records a provider-opted-out number as re-enabled', () => {
    const explicitOn = resolveBookingSmsConsentDecision('default_off', {
      granted: true,
      wordingVersion: 'booking-sms-reminders-v1',
      selection: 'explicit_on',
    });

    expect(explicitOn?.isExplicit).toBe(true);

    expect(shouldRecordBookingSmsConsent({ decision: explicitOn!, providerOptedOut: true })).toBe(false);
  });

  it('fails closed for a payload that misrepresents the displayed default', () => {
    expect(resolveBookingSmsConsentDecision('default_off', {
      granted: true,
      wordingVersion: 'booking-sms-reminders-v1',
      selection: 'default_on',
    })).toBeNull();
  });

  it('accepts a retired default-off payload without claiming an explicit choice', () => {
    expect(resolveBookingSmsConsentDecision('default_on', {
      granted: false,
      wordingVersion: 'booking-v2',
      selection: 'default_off',
      legacyDefaultOff: true,
    })).toMatchObject({ status: 'revoked', isExplicit: false });
  });
});
