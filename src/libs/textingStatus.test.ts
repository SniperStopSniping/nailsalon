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
  it.each(['active', 'pending', 'deauthorized', 'degraded'])('never advertises historical %s Twilio as usable', (status) => {
    const result = resolveAutomaticTextStatus(
      { ...AVAILABLE, twilio: { status, phoneNumber: '+16475550000' } },
      'ENABLED',
    );

    expect(result.label).toBe('Setup incomplete');
    expect(result.detail).toContain('retired');
    expect(result.detail).not.toMatch(/connect Twilio|choose a phone/i);
  });

  it('requires canonical SMS readiness even if legacy configuration is present', () => {
    expect(resolveAutomaticTextStatus({ ...AVAILABLE, twilio: { status: 'disconnected' } }, 'ENABLED').label).toBe('Not available yet');
  });

  it('treats missing or malformed health payloads as loading, never as a status claim', () => {
    expect(resolveAutomaticTextStatus(null, 'ENABLED').label).toBe('Loading…');
    expect(resolveAutomaticTextStatus({} as never, 'ENABLED').label).toBe('Loading…');
  });
});
