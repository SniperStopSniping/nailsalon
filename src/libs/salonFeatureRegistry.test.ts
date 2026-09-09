import { describe, expect, it } from 'vitest';

import { resolveEntitlement } from '@/libs/featureEntitlements';
import {
  applySalonFeaturePreset,
  CORE_SALON_FEATURES,
  OPTIONAL_SALON_FEATURES,
  setOptionalSalonFeature,
} from '@/libs/salonFeatureRegistry';

describe('salon feature registry', () => {
  it('keeps the operational workspace in the non-toggleable core catalog', () => {
    expect(CORE_SALON_FEATURES.map(feature => feature.key)).toEqual(expect.arrayContaining([
      'workspace',
      'appointments',
      'clients',
      'services',
      'googleCalendar',
      'smsReminders',
    ]));
    expect(OPTIONAL_SALON_FEATURES.map(feature => feature.key)).not.toContain('smsReminders');
  });

  it('writes nested and legacy-compatible optional entitlements', () => {
    const features = setOptionalSalonFeature({}, 'analyticsDashboard', true);

    expect(features.analytics?.dashboard).toBe(true);
    expect(features.analyticsDashboard).toBe(true);
    expect(resolveEntitlement(features, 'analytics', 'dashboard')).toBe(true);
  });

  it('applies Free Solo without removing unknown feature data', () => {
    const features = applySalonFeaturePreset({ customBranding: true }, 'free_solo');

    expect(features.customBranding).toBe(true);
    expect(features.marketing?.smsReminders).toBe(true);
    expect(features.smsReminders).toBe(true);
    expect(features.analytics?.dashboard).toBe(false);
  });

  it.each(['free_solo', 'pro', 'all_available'] as const)('keeps credit-funded SMS in the %s preset', (preset) => {
    const features = applySalonFeaturePreset({ smsReminders: false, marketing: { smsReminders: false }, customBranding: true }, preset);

    expect(features.smsReminders).toBe(true);
    expect(features.marketing?.smsReminders).toBe(true);
    expect(features.customBranding).toBe(true);
    expect(features.catalog).toMatchObject({ variantsV1: false, addOnGroupsV1: false, bookingModesV1: false });
  });
});
