import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));

/* eslint-disable import/first */
import {
  getEffectiveModuleEnabled,
  getEntitledModules,
  getResolvedModules,
  guardModuleOr403Sync,
  isModuleEntitled,
} from '@/libs/featureGating';
/* eslint-enable import/first */

describe('SMS module capability and owner preference', () => {
  it.each([null, {}, { smsReminders: false }, { marketing: { smsReminders: false } }, { marketing: { smsReminders: true } }])('includes SMS despite historical feature data %j', (features) => {
    expect(isModuleEntitled(features, 'smsReminders')).toBe(true);
    expect(getEntitledModules(features)).toMatchObject({ smsReminders: true, rewards: false, analyticsDashboard: false });
    expect(getEffectiveModuleEnabled({ features, settings: null, module: 'smsReminders' })).toBe(true);
    expect(guardModuleOr403Sync({ features, settings: null, module: 'smsReminders' })).toBeNull();
  });

  it('preserves an explicit owner module-off choice instead of reporting a plan restriction', async () => {
    const features = { marketing: { smsReminders: false } };
    const settings = { modules: { smsReminders: false }, communications: { sms: { enabled: false } } };

    expect(getEffectiveModuleEnabled({ features, settings, module: 'smsReminders' })).toBe(false);
    expect(getResolvedModules(settings).smsReminders).toBe(false);

    const denial = guardModuleOr403Sync({ features, settings, module: 'smsReminders' });

    expect(denial?.status).toBe(403);
    expect(await denial?.json()).toMatchObject({ error: { code: 'MODULE_DISABLED' } });
    expect(settings.communications.sms.enabled).toBe(false);
  });

  it('continues denying other paid modules even when an owner tries to enable them', async () => {
    const denial = guardModuleOr403Sync({ features: {}, settings: { modules: { analyticsDashboard: true } }, module: 'analyticsDashboard' });

    expect(denial?.status).toBe(403);
    expect(await denial?.json()).toMatchObject({ error: { code: 'UPGRADE_REQUIRED' } });
  });
});
