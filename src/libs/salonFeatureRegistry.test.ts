import { describe, expect, it } from 'vitest';

import { resolveEntitlement } from '@/libs/featureEntitlements';
import {
  applySalonFeaturePreset,
  CORE_SALON_FEATURES,
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
    ]));
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
    expect(features.marketing?.smsReminders).toBe(false);
    expect(features.analytics?.dashboard).toBe(false);
  });
});
