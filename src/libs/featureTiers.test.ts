import { describe, expect, it } from 'vitest';

import { applyTierPreset, detectCurrentTier, getTierPreset } from '@/libs/featureTiers';

describe('universal legacy tier presets', () => {
  it.each(['starter', 'pro', 'elite'] as const)('includes built features in %s without losing unrelated data', (tier) => {
    const features = applyTierPreset({
      smsReminders: false,
      marketing: { smsReminders: false, referrals: true },
      booking: { onlineBooking: false },
    }, tier);

    expect(getTierPreset(tier)).toMatchObject({
      smsReminders: true,
      rewards: true,
      referrals: true,
      analyticsDashboard: true,
      multiLocation: true,
      customBranding: true,
    });
    expect(features.smsReminders).toBe(true);
    expect(features.marketing).toEqual({ smsReminders: true, referrals: true });
    expect(features.booking).toEqual({ onlineBooking: false });
  });

  it('keeps tier detection only as a legacy label', () => {
    expect(detectCurrentTier({ smsReminders: true })).toBe('starter');
    expect(detectCurrentTier(getTierPreset('starter'))).toBe('elite');
    expect(detectCurrentTier({ smsReminders: true, rewards: true })).toBe('pro');
    expect(detectCurrentTier({ smsReminders: true, apiAccess: true })).toBe('elite');
    expect(getTierPreset('starter')).toMatchObject({ rewards: true, referrals: true, analyticsDashboard: true, apiAccess: true });
  });
});
