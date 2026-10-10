import type { AssetRepository } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets';
import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createSecureBrowserToken } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { ONBOARDING_STORAGE_KEY, type OnboardingStorage } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import {
  ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY,
  ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY,
  ONBOARDING_INTEGRATION_RESUME_SESSION_KEY,
} from './flow-storage';

export const DEVICE_SETUPS_KEY = 'luster:onboarding:v1:kept-device-setups';
const SETUP_KEYS = [ONBOARDING_STORAGE_KEY, SITE_BUILDER_STORAGE_KEY, ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY, ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY] as const;
type SetupValues = Record<(typeof SETUP_KEYS)[number], string | null>;
export type DeviceSetup = { id: string; keptAt: string; values: SetupValues };

export const loadDeviceSetups = (storage: OnboardingStorage = window.localStorage): DeviceSetup[] => {
  const raw = storage.getItem(DEVICE_SETUPS_KEY);
  if (!raw) {
    return [];
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(item => item && typeof item.id === 'string'
    && typeof item.keptAt === 'string' && item.values
    && SETUP_KEYS.every(key => item.values[key] === null || typeof item.values[key] === 'string'))) {
    throw new Error('The previous setups on this device could not be read. Nothing was replaced.');
  }
  return parsed;
};

const writeValue = (storage: OnboardingStorage, key: string, value: string | null) => {
  if (value === null) {
    storage.removeItem(key);
  } else {
    storage.setItem(key, value);
  }
};

/**
 * Keep every current setup value before switching. No server writes, token reuse,
 * or asset deletion. A failed backup must never turn into a destructive reset.
 */
export const switchDeviceSetup = (input: {
  restoreId?: string;
  storage?: OnboardingStorage;
  sessionStorage?: OnboardingStorage;
} = {}): { success: true } | { success: false; message: string } => {
  let prior: SetupValues | undefined;
  let resume: string | null = null;
  let storage: OnboardingStorage | undefined;
  let session: OnboardingStorage | undefined;
  try {
    storage = input.storage ?? window.localStorage;
    session = input.sessionStorage ?? window.sessionStorage;
    const kept = loadDeviceSetups(storage);
    const target = input.restoreId ? kept.find(item => item.id === input.restoreId) : undefined;
    if (input.restoreId && !target) {
      throw new Error('That setup is no longer available on this device.');
    }
    prior = Object.fromEntries(SETUP_KEYS.map(key => [key, storage!.getItem(key)])) as SetupValues;
    resume = session.getItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY);
    if (SETUP_KEYS.some(key => prior![key] !== null)
      && !kept.some(item => SETUP_KEYS.every(key => item.values[key] === prior![key]))) {
      kept.push({ id: createSecureBrowserToken('kept'), keptAt: new Date().toISOString(), values: prior });
      const serialized = JSON.stringify(kept);
      storage.setItem(DEVICE_SETUPS_KEY, serialized);
      if (storage.getItem(DEVICE_SETUPS_KEY) !== serialized) {
        throw new Error('The previous setup could not be kept on this device.');
      }
    }
    for (const key of SETUP_KEYS) {
      writeValue(storage, key, target?.values[key] ?? null);
    }
    // Same-browser revision authorization must be re-established on restore.
    session.removeItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY);
    return { success: true };
  } catch {
    if (prior && storage && session) {
      try {
        for (const key of SETUP_KEYS) {
          writeValue(storage, key, prior[key]);
        }
        writeValue(session, ONBOARDING_INTEGRATION_RESUME_SESSION_KEY, resume);
      } catch {
        // The verified backup remains under DEVICE_SETUPS_KEY if rollback is
        // interrupted by a browser storage failure. Never delete that backup.
      }
    }
    return { success: false, message: 'We couldn’t safely switch setups on this device. Your previous setup has not been discarded. Try again when browser storage is available.' };
  }
};

const retainedAssetIds = (): Set<string> => {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'storageId' || key === 'assetId') && typeof child === 'string') {
        ids.add(child);
      } else {
        visit(child);
      }
    }
  };
  for (const setup of loadDeviceSetups()) {
    for (const key of [ONBOARDING_STORAGE_KEY, SITE_BUILDER_STORAGE_KEY] as const) {
      if (setup.values[key]) {
        visit(JSON.parse(setup.values[key]!));
      }
    }
  }
  return ids;
};

/** Later edits and Start over must not delete photos referenced by a kept setup. */
export const protectDeviceSetupAssets = (repository: AssetRepository): AssetRepository => {
  const remove = async (id: string, discard = false) => retainedAssetIds().has(id)
    ? false
    : discard ? repository.discard(id) : repository.delete(id);
  const clear = async () => {
    const assets = await repository.list({ includeStaged: true });
    const results = await Promise.all(assets.map(asset => remove(asset.metadata.id)));
    return results.filter(Boolean).length;
  };
  return {
    clear,
    close: () => repository.close(),
    commit: id => repository.commit(id),
    commitBatch: ids => repository.commitBatch(ids),
    delete: id => remove(id),
    deleteDatabase: async () => {
      if (loadDeviceSetups().length > 0) {
        await clear();
      } else {
        await repository.deleteDatabase();
      }
    },
    discard: id => remove(id, true),
    get: (id, options) => repository.get(id, options),
    getMetadata: (id, options) => repository.getMetadata(id, options),
    getOriginal: (id, options) => repository.getOriginal(id, options),
    getThumbnail: (id, options) => repository.getThumbnail(id, options),
    has: (id, options) => repository.has(id, options),
    list: options => repository.list(options),
    stage: asset => repository.stage(asset),
  };
};
