import { describe, expect, it } from 'vitest';

import { isNativeSmsCapableDevice, resolveAutomaticTextStatus, resolveManualTextStatus, type SmsOperationalHealth } from './textingStatus';

const AVAILABLE = { availability: { twilio: true } };

const SMS_READY: SmsOperationalHealth = {
  providerReady: true,
  senderMode: 'shared_luster',
  senderLabel: 'Luster shared texting number',
  phoneNumber: null,
  blockingReason: null,
  detail: 'Texting is ready.',
  smsEnabled: true,
  automaticEnabled: true,
  manualAvailable: true,
  remindersEnabled: true,
  quietHours: { enabled: true, start: '21:00', end: '09:00' },
  availableCredits: 100,
  workerConfigured: true,
};

describe('isNativeSmsCapableDevice', () => {
  it('is true for phones/tablets and false for desktop browsers', () => {
    expect(isNativeSmsCapableDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(true);
    expect(isNativeSmsCapableDevice('Mozilla/5.0 (Linux; Android 14)')).toBe(true);
    expect(isNativeSmsCapableDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false);
    expect(isNativeSmsCapableDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
  });
});

describe('resolveAutomaticTextStatus', () => {
  it.each([
    ['GLOBAL_SMS_DISABLED', 'Paused'],
    ['PILOT_NOT_ENABLED', 'Not available yet'],
    ['SENDER_NOT_READY', 'Setup incomplete'],
  ])('distinguishes %s from a plan restriction', (blockingReason, label) => {
    const health = {
      ...AVAILABLE,
      twilio: { status: 'disconnected' },
      sms: { ...SMS_READY, providerReady: false, automaticEnabled: false, manualAvailable: false, blockingReason, detail: 'Current server-resolved reason.' },
    };

    expect(resolveAutomaticTextStatus(health, 'UPGRADE_REQUIRED')).toMatchObject({ label, detail: health.sms.detail });
    expect(resolveManualTextStatus(health)).toMatchObject({ label, detail: health.sms.detail });
  });

  it('keeps a paused manual channel distinct from ready automatic texts', () => {
    const health = {
      ...AVAILABLE,
      twilio: { status: 'disconnected' },
      sms: { ...SMS_READY, manualAvailable: false, detail: 'Manual texting is temporarily paused by support.' },
    };

    expect(resolveAutomaticTextStatus(health, null).label).toBe('Ready');
    expect(resolveManualTextStatus(health).label).toBe('Paused');
    expect(resolveManualTextStatus({ ...health, sms: SMS_READY }).label).toBe('Ready');
    expect(resolveManualTextStatus(null).label).toBe('Loading…');
  });

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
