import { describe, expect, it } from 'vitest';

import { applyTierPreset, detectCurrentTier, getTierPreset } from '@/libs/featureTiers';

describe('SMS access in legacy tier presets', () => {
  it.each(['starter', 'pro', 'elite'] as const)('includes SMS in %s without losing unrelated data', (tier) => {
    const features = applyTierPreset({
      smsReminders: false,
      marketing: { smsReminders: false, referrals: true },
      booking: { onlineBooking: false },
    }, tier);

    expect(getTierPreset(tier).smsReminders).toBe(true);
    expect(features.smsReminders).toBe(true);
    expect(features.marketing).toEqual({ smsReminders: true, referrals: true });
    expect(features.booking).toEqual({ onlineBooking: false });
  });

  it('does not classify included SMS access as a paid subscription', () => {
    expect(detectCurrentTier({ smsReminders: true })).toBe('starter');
    expect(detectCurrentTier(getTierPreset('starter'))).toBe('starter');
    expect(detectCurrentTier({ smsReminders: true, rewards: true })).toBe('pro');
    expect(detectCurrentTier({ smsReminders: true, apiAccess: true })).toBe('elite');
    expect(getTierPreset('starter')).toMatchObject({ rewards: false, referrals: false, analyticsDashboard: false, apiAccess: false });
  });
});
