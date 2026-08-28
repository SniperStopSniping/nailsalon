import { describe, expect, it, vi } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultOnboardingState } from '../model/defaults';
import {
  clearOnboardingState,
  loadOnboardingState,
  ONBOARDING_STORAGE_KEY,
  parseOnboardingState,
  saveOnboardingState,
  type OnboardingStorage,
} from './storage';

const createMemoryStorage = (
  initial: Record<string, string> = {},
): OnboardingStorage & { values: Map<string, string> } => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    values,
  };
};

const createLegacySavedState = (
  options: {
    businessType?: 'solo' | 'home_studio' | 'salon_suite' | 'traditional_salon' | 'mobile' | 'multi_tech';
    depositPreference?: 'yes' | 'no' | 'depends_on_service';
    edited?: boolean;
    locationType?: 'home_studio' | 'salon_suite' | 'traditional_salon' | 'mobile_service' | null;
    phone?: string;
    policyRequired?: boolean | null;
    preferredContact?: 'text' | 'call' | 'instagram' | 'email' | null;
    schemaVersion?: 1 | 2 | 3 | 4;
    skipped?: boolean;
    textPhone?: string;
  } = {},
): Record<string, unknown> => {
  const state = createDefaultOnboardingState();
  const days = Object.fromEntries(
    (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const)
      .map((day) => [day, {
        close: day === 'saturday' ? '16:00' : '17:00',
        closed: day === 'sunday',
        open: day === 'saturday' ? '10:00' : '09:00',
      }]),
  );
  if (options.edited) {
    days.monday = { close: '19:00', closed: false, open: '11:00' };
  }
  const profile: Record<string, unknown> = {
    ...state.profile,
    bookingPreferences: {
      ...state.profile.bookingPreferences,
      depositPreference: options.depositPreference ?? 'yes',
    },
    businessType: options.businessType ?? 'salon_suite',
    location: {
      ...state.profile.location,
      locationType: options.locationType ?? null,
    },
    phone: options.phone ?? '',
    policies: {
      ...state.profile.policies,
      deposits: {
        ...state.profile.policies.deposits,
        required: options.policyRequired ?? null,
      },
    },
    preferredContact: options.preferredContact ?? null,
    textPhone: options.textPhone ?? '',
  };
  delete profile.businessStructure;
  delete profile.clientContact;
  delete (profile.policies as { deposits: Record<string, unknown> }).deposits.mode;
  const location = profile.location as Record<string, unknown>;
  delete location.allowGeneralAreaDirections;
  const schemaVersion = options.schemaVersion ?? 1;
  return {
    ...state,
    profile: {
      ...profile,
      hours: schemaVersion === 1
        ? { days, skipped: options.skipped ?? false }
        : state.profile.hours,
    },
    reviewOptions: schemaVersion === 1
      ? {
          appliedFixtureId: null,
          reducedMotion: false,
          viewportFixture: null,
        }
      : {
          ...state.reviewOptions,
          previewTimestamp: '2026-09-01T15:00:00.000Z',
        },
    schemaVersion,
  };
};

describe('onboarding browser-local storage', () => {
  it('uses one namespaced key and round-trips the complete state', () => {
    const storage = createMemoryStorage({ unrelated: 'keep me' });
    const state = createDanielaFixtureState();
    state.recipe.aboutEnabled = false;
    state.planOffer.fixtureState = 'expiring';

    const saved = saveOnboardingState(state, {
      storage,
      timestamp: '2026-08-27T14:00:00.000Z',
    });
    expect(saved.success).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      'luster:onboarding-v1-lab',
      expect.any(String),
    );
    expect(ONBOARDING_STORAGE_KEY).toBe('luster:onboarding-v1-lab');

    const loaded = loadOnboardingState(storage);
    expect(loaded.status).toBe('loaded');
    expect(loaded.state.profile.about.shortBio).toBe(state.profile.about.shortBio);
    expect(loaded.state.recipe.aboutEnabled).toBe(false);
    expect(loaded.state.planOffer.fixtureState).toBe('expiring');
    expect(loaded.state.progress.lastSavedAt).toBe('2026-08-27T14:00:00.000Z');
    expect(storage.values.get('unrelated')).toBe('keep me');
  });

  it('fails visibly for malformed or unsupported saved state', () => {
    expect(parseOnboardingState('{bad').status).toBe('error');
    expect(parseOnboardingState(JSON.stringify({
      ...createDefaultOnboardingState(),
      schemaVersion: 999,
    })).status).toBe('error');
  });

  it('migrates legacy hours without treating the old seeded schedule as owner-provided', () => {
    const untouched = parseOnboardingState(JSON.stringify(createLegacySavedState({
      phone: '416-555-0100',
      preferredContact: 'call',
      textPhone: '416-555-0100',
    })));
    expect(untouched.status).toBe('loaded');
    expect(untouched.state.profile.hours).toMatchObject({
      setupState: 'unset',
      showOnSite: true,
    });
    expect(untouched.state.profile.hours.days.monday).toMatchObject({ close: '', open: '' });
    expect(untouched.state.profile.hours.days.sunday.closed).toBe(false);
    expect(untouched.state.profile.businessStructure).toBe('solo');
    expect(untouched.state.profile.location.locationType).toBe('salon_suite');
    expect(untouched.state.profile.clientContact).toEqual({
      callEnabled: true,
      differentTextNumber: '',
      primaryNumber: '416-555-0100',
      textEnabled: true,
      useDifferentTextNumber: false,
    });
    expect(untouched.state.reviewOptions.previewTimestamp)
      .toBe('2026-08-27T18:30:00.000Z');

    const edited = parseOnboardingState(JSON.stringify(createLegacySavedState({ edited: true })));
    expect(edited.state.profile.hours).toMatchObject({
      setupState: 'configured',
      showOnSite: true,
    });
    expect(edited.state.profile.hours.days.monday).toMatchObject({
      close: '19:00',
      open: '11:00',
    });

    const skipped = parseOnboardingState(JSON.stringify(createLegacySavedState({ skipped: true })));
    expect(skipped.state.profile.hours).toMatchObject({
      setupState: 'skipped',
      showOnSite: false,
    });
  });

  it('losslessly migrates mixed business and separate phone/text data from v2', () => {
    const result = parseOnboardingState(JSON.stringify(createLegacySavedState({
      businessType: 'home_studio',
      phone: '416-555-0100',
      preferredContact: 'text',
      schemaVersion: 2,
      textPhone: '647-555-0199',
    })));

    expect(result.status).toBe('loaded');
    expect(result.state.schemaVersion).toBe(5);
    expect(result.state.profile.businessStructure).toBe('solo');
    expect(result.state.profile.location).toMatchObject({
      allowGeneralAreaDirections: false,
      locationType: 'home_studio',
    });
    expect(result.state.profile.clientContact).toEqual({
      callEnabled: true,
      differentTextNumber: '647-555-0199',
      primaryNumber: '416-555-0100',
      textEnabled: true,
      useDifferentTextNumber: true,
    });
    expect(result.state.profile.preferredContact).toBe('text');
    expect(result.state.reviewOptions.previewTimestamp).toBe('2026-09-01T15:00:00.000Z');
    expect(result.state.profile.policies.deposits.mode).toBe('generally_required');
    expect(result.state.profile.bookingPreferences).not.toHaveProperty('depositPreference');
    expect(result.state.profile.policies.deposits).not.toHaveProperty('required');
  });

  it('migrates v3 Canva drafts and persists a typed partial-upload result', () => {
    const legacy = createDefaultOnboardingState() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 3;
    const legacyCanva = legacy.canva as Record<string, unknown>;
    delete legacyCanva.uploadResult;

    const migrated = parseOnboardingState(JSON.stringify(legacy));
    expect(migrated.status).toBe('loaded');
    expect(migrated.state.schemaVersion).toBe(5);
    expect(migrated.state.canva.uploadResult).toBeNull();

    migrated.state.canva.uploadResult = {
      addedCount: 2,
      failures: [{
        code: 'decode_failed',
        fileName: 'broken-page.png',
        message: 'This image couldn’t be opened.',
      }],
      summary: '2 images were added. 1 file could not be processed.',
    };
    const roundTrip = parseOnboardingState(JSON.stringify(migrated.state));
    expect(roundTrip.status).toBe('loaded');
    expect(roundTrip.state.canva.uploadResult).toEqual(migrated.state.canva.uploadResult);
  });

  it('migrates v4 Canva pages into a deduplicated ownership ledger', () => {
    const legacy = createDefaultOnboardingState() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 4;
    const legacyCanva = legacy.canva as Record<string, unknown>;
    legacyCanva.images = [
      {
        fileName: 'first.png',
        id: 'image-first',
        mimeType: 'image/png',
        source: 'indexed_db',
        storageId: 'asset-first',
      },
      {
        fileName: 'duplicate-reference.png',
        id: 'image-duplicate',
        mimeType: 'image/png',
        source: 'indexed_db',
        storageId: 'asset-first',
      },
      {
        fileName: 'second.webp',
        id: 'image-second',
        mimeType: 'image/webp',
        source: 'indexed_db',
        storageId: 'asset-second',
      },
    ];
    delete legacyCanva.ownedAssetIds;

    const migrated = parseOnboardingState(JSON.stringify(legacy));

    expect(migrated.status).toBe('loaded');
    expect(migrated.state.schemaVersion).toBe(5);
    expect(migrated.state.canva.ownedAssetIds).toEqual([
      'asset-first',
      'asset-second',
    ]);
    expect(parseOnboardingState(JSON.stringify(migrated.state)).state.canva.ownedAssetIds)
      .toEqual(['asset-first', 'asset-second']);
  });

  it('normalizes legacy deposit answers into one non-contradictory policy source', () => {
    const explicitPolicy = parseOnboardingState(JSON.stringify(createLegacySavedState({
      depositPreference: 'yes',
      policyRequired: false,
      schemaVersion: 2,
    })));
    expect(explicitPolicy.state.profile.policies.deposits.mode).toBe('none');

    const serviceDefined = parseOnboardingState(JSON.stringify(createLegacySavedState({
      depositPreference: 'depends_on_service',
      policyRequired: null,
      schemaVersion: 3,
    })));
    expect(serviceDefined.status).toBe('loaded');
    expect(serviceDefined.state.profile.policies.deposits).toMatchObject({
      amountType: 'service_defined',
      mode: 'depends_on_service',
    });
    expect(serviceDefined.state.profile.bookingPreferences).not.toHaveProperty('depositPreference');
    expect(serviceDefined.state.profile.policies.deposits).not.toHaveProperty('required');
  });

  it('preserves an explicit Screen 4 location and a text-only number during v2 migration', () => {
    const result = parseOnboardingState(JSON.stringify(createLegacySavedState({
      businessType: 'multi_tech',
      locationType: 'traditional_salon',
      preferredContact: 'call',
      schemaVersion: 2,
      textPhone: '647-555-0112',
    })));

    expect(result.state.profile.businessStructure).toBe('multi_tech');
    expect(result.state.profile.location.locationType).toBe('traditional_salon');
    expect(result.state.profile.clientContact).toEqual({
      callEnabled: true,
      differentTextNumber: '',
      primaryNumber: '647-555-0112',
      textEnabled: true,
      useDifferentTextNumber: false,
    });
    expect(result.state.profile.preferredContact).toBe('call');
  });

  it.each([
    ['solo', 'solo', null],
    ['home_studio', 'solo', 'home_studio'],
    ['salon_suite', 'solo', 'salon_suite'],
    ['traditional_salon', 'solo', 'traditional_salon'],
    ['mobile', 'solo', 'mobile_service'],
    ['multi_tech', 'multi_tech', null],
  ] as const)('maps legacy %s without mixing structure and location', (
    businessType,
    businessStructure,
    locationType,
  ) => {
    const result = parseOnboardingState(JSON.stringify(createLegacySavedState({
      businessType,
      schemaVersion: 2,
    })));
    expect(result.state.profile.businessStructure).toBe(businessStructure);
    expect(result.state.profile.location.locationType).toBe(locationType);
  });

  it('reports storage failures without discarding in-memory state', () => {
    const state = createDefaultOnboardingState();
    const failingStorage: OnboardingStorage = {
      getItem: () => {
        throw new Error('read blocked');
      },
      removeItem: () => {
        throw new Error('remove blocked');
      },
      setItem: () => {
        throw new Error('quota full');
      },
    };

    expect(loadOnboardingState(failingStorage)).toMatchObject({
      message: 'read blocked',
      status: 'error',
    });
    expect(saveOnboardingState(state, { storage: failingStorage })).toEqual({
      message: 'quota full',
      success: false,
    });
    expect(clearOnboardingState(failingStorage)).toEqual({
      message: 'remove blocked',
      success: false,
    });
  });

  it('reset removes only onboarding state', () => {
    const storage = createMemoryStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify(createDefaultOnboardingState()),
      unrelated: 'preserved',
    });
    expect(clearOnboardingState(storage)).toEqual({ success: true });
    expect(storage.values.has(ONBOARDING_STORAGE_KEY)).toBe(false);
    expect(storage.values.get('unrelated')).toBe('preserved');
  });
});
