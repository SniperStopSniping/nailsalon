// @vitest-environment jsdom

import type { AssetRepository } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets';
import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { ONBOARDING_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import { DEVICE_SETUPS_KEY, loadDeviceSetups, protectDeviceSetupAssets, switchDeviceSetup } from './device-setups';
import { ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY, ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY, ONBOARDING_INTEGRATION_RESUME_SESSION_KEY } from './flow-storage';

const keys = [ONBOARDING_STORAGE_KEY, SITE_BUILDER_STORAGE_KEY, ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY, ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY];
const seed = () => {
  keys.forEach(key => localStorage.setItem(key, JSON.stringify({ value: key, storageId: 'old-photo' })));
  sessionStorage.setItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY, 'old-authorization');
  localStorage.setItem('unrelated', 'keep');
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('kept device setups', () => {
  it('keeps every setup value before opening a clean setup, without touching other storage', () => {
    seed();
    const before = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));

    expect(switchDeviceSetup()).toEqual({ success: true });
    expect(loadDeviceSetups()[0]?.values).toEqual(before);

    keys.forEach(key => expect(localStorage.getItem(key)).toBeNull());

    expect(sessionStorage.getItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('restores exact previous content after reload and also keeps the newer setup', () => {
    seed();
    switchDeviceSetup();
    const old = loadDeviceSetups()[0]!;
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'new setup');

    expect(switchDeviceSetup({ restoreId: old.id })).toEqual({ success: true });

    keys.forEach(key => expect(localStorage.getItem(key)).toBe(old.values[key as keyof typeof old.values]));

    expect(loadDeviceSetups()).toHaveLength(2);
    expect(loadDeviceSetups()[1]?.values[ONBOARDING_STORAGE_KEY]).toBe('new setup');
    expect(sessionStorage.getItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY)).toBeNull();
  });

  it('does not duplicate an identical backup', () => {
    seed();
    switchDeviceSetup();
    switchDeviceSetup({ restoreId: loadDeviceSetups()[0]!.id });
    switchDeviceSetup();

    expect(loadDeviceSetups()).toHaveLength(1);
  });

  it('does not clear anything when the archive is corrupt or the requested setup is missing', () => {
    seed();

    expect(switchDeviceSetup({ restoreId: 'missing' }).success).toBe(false);

    localStorage.setItem(DEVICE_SETUPS_KEY, '{broken');

    expect(switchDeviceSetup().success).toBe(false);

    keys.forEach(key => expect(localStorage.getItem(key)).not.toBeNull());

    expect(sessionStorage.getItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY)).toBe('old-authorization');
  });

  it('fails closed if storage quota prevents a verified backup', () => {
    seed();
    const storage = { getItem: localStorage.getItem.bind(localStorage), removeItem: vi.fn(), setItem: vi.fn(() => {
      throw new Error('quota');
    }) };

    expect(switchDeviceSetup({ storage }).success).toBe(false);
    expect(storage.removeItem).not.toHaveBeenCalled();

    keys.forEach(key => expect(localStorage.getItem(key)).not.toBeNull());
  });

  it('rolls back a partial switch and retains the backup if removal fails', () => {
    seed();
    let failed = false;
    const storage = {
      getItem: localStorage.getItem.bind(localStorage),
      setItem: localStorage.setItem.bind(localStorage),
      removeItem: (key: string) => {
        if (key === SITE_BUILDER_STORAGE_KEY && !failed) {
          failed = true;
          throw new Error('blocked');
        }
        localStorage.removeItem(key);
      },
    };

    expect(switchDeviceSetup({ storage }).success).toBe(false);

    keys.forEach(key => expect(localStorage.getItem(key)).not.toBeNull());

    expect(loadDeviceSetups()).toHaveLength(1);
    expect(sessionStorage.getItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY)).toBe('old-authorization');
  });

  it('keeps profile and custom-design photos through delete, discard, clear and database cleanup', async () => {
    seed();
    localStorage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify({ sections: [{ image: { assetId: 'design-photo' } }] }));
    switchDeviceSetup();
    const repository = {
      delete: vi.fn().mockResolvedValue(true),
      discard: vi.fn().mockResolvedValue(true),
      deleteDatabase: vi.fn(),
      list: vi.fn().mockResolvedValue(['old-photo', 'design-photo', 'new-photo'].map(id => ({ metadata: { id } }))),
    } as unknown as AssetRepository;
    const protectedRepository = protectDeviceSetupAssets(repository);

    expect(await protectedRepository.delete('old-photo')).toBe(false);
    expect(await protectedRepository.discard('design-photo')).toBe(false);
    expect(await protectedRepository.clear()).toBe(1);

    await protectedRepository.deleteDatabase();

    expect(repository.delete).toHaveBeenCalledTimes(2);
    expect(repository.delete).toHaveBeenCalledWith('new-photo');
    expect(repository.discard).not.toHaveBeenCalled();
    expect(repository.deleteDatabase).not.toHaveBeenCalled();
  });

  it('refuses destructive cleanup when retained references cannot be read', async () => {
    localStorage.setItem(DEVICE_SETUPS_KEY, 'broken');
    const repository = { delete: vi.fn() } as unknown as AssetRepository;

    await expect(protectDeviceSetupAssets(repository).delete('any-photo')).rejects.toThrow();
    expect(repository.delete).not.toHaveBeenCalled();
  });
});
