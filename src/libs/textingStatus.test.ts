import { describe, expect, it } from 'vitest';

import { isNativeSmsCapableDevice, resolveAutomaticTextStatus } from './textingStatus';

const AVAILABLE = { availability: { twilio: true } };

describe('isNativeSmsCapableDevice', () => {
  it('is true for phones/tablets and false for desktop browsers', () => {
    expect(isNativeSmsCapableDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(true);
    expect(isNativeSmsCapableDevice('Mozilla/5.0 (Linux; Android 14)')).toBe(true);
    expect(isNativeSmsCapableDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false);
    expect(isNativeSmsCapableDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
  });
});

describe('resolveAutomaticTextStatus', () => {
  it('is Ready ONLY when a number is active AND the SMS module is enabled', () => {
    const ready = resolveAutomaticTextStatus(
      { ...AVAILABLE, twilio: { status: 'active', phoneNumber: '+16475550000' } },
      'ENABLED',
    );

    expect(ready.label).toBe('Ready');
    expect(ready.detail).toContain('+16475550000');
  });

  it('never claims Ready when any prerequisite is missing', () => {
    // Number active but module off / not entitled → incomplete, not Ready.
    expect(resolveAutomaticTextStatus(
      { ...AVAILABLE, twilio: { status: 'active', phoneNumber: '+16475550000' } },
      'MODULE_DISABLED',
    ).label).toBe('Setup incomplete');
    expect(resolveAutomaticTextStatus(
      { ...AVAILABLE, twilio: { status: 'active', phoneNumber: '+16475550000' } },
      'UPGRADE_REQUIRED',
    ).label).toBe('Setup incomplete');
    // Authorized without a number → incomplete.
    expect(resolveAutomaticTextStatus(
      { ...AVAILABLE, twilio: { status: 'pending' } },
      'ENABLED',
    ).label).toBe('Setup incomplete');
    // Deauthorized → Error.
    expect(resolveAutomaticTextStatus(
      { ...AVAILABLE, twilio: { status: 'deauthorized' } },
      'ENABLED',
    ).label).toBe('Error');
    // Environment does not offer Twilio at all.
    expect(resolveAutomaticTextStatus(
      { availability: { twilio: false }, twilio: { status: 'disconnected' } },
      null,
    ).label).toBe('Not available yet');
    // Nothing connected.
    expect(resolveAutomaticTextStatus(
      { ...AVAILABLE, twilio: { status: 'disconnected' } },
      null,
    ).label).toBe('Not connected');
  });

  it('treats missing or malformed health payloads as loading, never as a status claim', () => {
    expect(resolveAutomaticTextStatus(null, 'ENABLED').label).toBe('Loading…');
    expect(resolveAutomaticTextStatus({} as never, 'ENABLED').label).toBe('Loading…');
  });
});
