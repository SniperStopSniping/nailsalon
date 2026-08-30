import { describe, expect, it, vi } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import {
  createDefaultOnboardingState,
  DEFAULT_PREVIEW_TIMESTAMP,
} from '../model/defaults';
import { isDepositsAndCancellationsComplete } from '../model/policies';
import { ONBOARDING_SCHEMA_VERSION } from '../model/types';
import {
  clearOnboardingState,
  loadOnboardingState,
  ONBOARDING_STORAGE_KEY,
  parseOnboardingState,
  saveOnboardingState,
  serializeOnboardingState,
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
    schemaVersion?: 1 | 2 | 3 | 4 | 5 | 6;
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
    state.planOffer.foundingMode = 'locked_monthly';

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
    expect(loaded.state.planOffer.foundingMode).toBe('locked_monthly');
    expect(loaded.state.progress.lastSavedAt).toBe('2026-08-27T14:00:00.000Z');
    expect(storage.values.get('unrelated')).toBe('keep me');
  });

  it('preserves separate saved cancellation and deposit records for the combined policy', () => {
    const storage = createMemoryStorage();
    const state = createDefaultOnboardingState();
    state.profile.policies.cancellations = {
      consequence: 'deposit_lost',
      customConsequence: 'Retained hidden custom consequence.',
      customNotice: '',
      notice: '24_hours',
    };
    state.profile.policies.deposits = {
      amountCents: 1_500,
      mode: 'fixed',
      refundable: false,
      transferable: false,
      wordingOverride: 'Exact legacy deposit override.',
    };
    state.profile.policies.copy.cancellations = {
      suggestedWording: 'Legacy cancellation suggestion.',
      useSuggestedWording: false,
      visible: false,
      wordingOverride: 'Exact legacy cancellation override.',
    };
    state.profile.policies.copy.deposits = {
      suggestedWording: 'Legacy deposit suggestion.',
      useSuggestedWording: false,
      visible: true,
      wordingOverride: 'Retained legacy copy-slot override.',
    };

    expect(saveOnboardingState(state, { storage }).success).toBe(true);
    const loaded = loadOnboardingState(storage);

    expect(loaded.status).toBe('loaded');
    expect(isDepositsAndCancellationsComplete(loaded.state.profile.policies)).toBe(true);
    expect(loaded.state.profile.policies.cancellations).toEqual(
      state.profile.policies.cancellations,
    );
    expect(loaded.state.profile.policies.deposits.wordingOverride)
      .toBe('Exact legacy deposit override.');
    expect(loaded.state.profile.policies.copy.cancellations).toEqual(
      state.profile.policies.copy.cancellations,
    );
    expect(loaded.state.profile.policies.copy.deposits).toEqual(
      state.profile.policies.copy.deposits,
    );
  });

  it('fails visibly for malformed or unsupported saved state', () => {
    expect(parseOnboardingState('{bad').status).toBe('error');
    expect(parseOnboardingState(JSON.stringify({
      ...createDefaultOnboardingState(),
      schemaVersion: 999,
    })).status).toBe('error');
  });

  it('normalizes absent or malformed current milestone state to known deduplicated ids', () => {
    const absent = createDefaultOnboardingState();
    delete absent.reviewOptions.feedbackMilestones;
    expect(parseOnboardingState(JSON.stringify(absent))).toMatchObject({
      state: { reviewOptions: { feedbackMilestones: [] } },
      status: 'loaded',
    });

    const malformed = createDefaultOnboardingState() as unknown as {
      reviewOptions: Record<string, unknown>;
    };
    malformed.reviewOptions.feedbackMilestones = [
      'stage_basics',
      'stage_basics',
      'unknown_milestone',
      42,
      null,
    ];
    expect(parseOnboardingState(JSON.stringify(malformed))).toMatchObject({
      state: { reviewOptions: { feedbackMilestones: ['stage_basics'] } },
      status: 'loaded',
    });
  });

  it('normalizes a valid saved Instagram profile URL without hiding invalid owner input', () => {
    const valid = createDefaultOnboardingState();
    valid.profile.instagram = 'https://www.instagram.com/islanailstudio/';
    valid.profile.bookingOnlyContact = false;
    valid.profile.preferredContact = 'instagram';
    const normalized = parseOnboardingState(JSON.stringify(valid));
    expect(normalized.state.profile.instagram).toBe('islanailstudio');
    expect(normalized.state.profile.preferredContact).toBe('instagram');

    const invalid = createDefaultOnboardingState();
    invalid.profile.instagram = 'instagram.com/isla/reels';
    invalid.profile.bookingOnlyContact = false;
    invalid.profile.preferredContact = 'instagram';
    const preserved = parseOnboardingState(JSON.stringify(invalid));
    expect(preserved.state.profile.instagram).toBe('instagram.com/isla/reels');
    expect(preserved.state.profile.preferredContact).toBeNull();
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
      .toBe(DEFAULT_PREVIEW_TIMESTAMP);

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
    expect(result.state.schemaVersion).toBe(ONBOARDING_SCHEMA_VERSION);
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
    expect(result.state.profile.policies.deposits.mode).toBe('fixed');
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
    expect(migrated.state.schemaVersion).toBe(ONBOARDING_SCHEMA_VERSION);
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
    expect(migrated.state.schemaVersion).toBe(ONBOARDING_SCHEMA_VERSION);
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
      legacyV5Archive: {
        amountType: 'service_defined',
        mode: 'depends_on_service',
      },
      mode: 'none',
    });
    expect(serviceDefined.state.profile.bookingPreferences).not.toHaveProperty('depositPreference');
    expect(serviceDefined.state.profile.policies.deposits).not.toHaveProperty('required');
  });

  it('losslessly migrates v5 notice, fixed deposit, plan, services, and dashboard defaults', () => {
    const legacy = createDefaultOnboardingState() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 5;
    delete legacy.dashboardHandoff;
    const profile = legacy.profile as Record<string, unknown>;
    delete profile.serviceMenu;
    profile.bookingPreferences = {
      advanceNotice: 'custom',
      customAdvanceNotice: '5 days',
      newClientStatus: 'yes',
      visitMode: 'appointment_only',
    };
    const policies = profile.policies as Record<string, unknown>;
    const copy = policies.copy as Record<string, Record<string, unknown>>;
    copy.deposits!.wordingOverride = 'A $25 deposit reserves your appointment.';
    policies.deposits = {
      amount: '25',
      amountType: 'fixed',
      mode: 'generally_required',
      refundable: false,
      transferable: true,
    };
    (legacy.planOffer as Record<string, unknown>).planIntent = 'lifetime';

    const migrated = parseOnboardingState(JSON.stringify(legacy));

    expect(migrated.status).toBe('loaded');
    expect(migrated.state.schemaVersion).toBe(ONBOARDING_SCHEMA_VERSION);
    expect(migrated.state.profile.bookingPreferences).toMatchObject({
      legacyV5Archive: {
        advanceNotice: 'custom',
        customAdvanceNotice: '5 days',
      },
      minimumNoticeMinutes: 7_200,
    });
    expect(migrated.state.profile.policies.deposits).toMatchObject({
      amountCents: 2_500,
      legacyV5Archive: {
        amount: '25',
        amountType: 'fixed',
        mode: 'generally_required',
      },
      mode: 'fixed',
      refundable: false,
      transferable: true,
      wordingOverride: 'A $25 deposit reserves your appointment.',
    });
    expect(migrated.state.profile.serviceMenu.selectedServiceIds.length).toBeGreaterThan(0);
    expect(migrated.state.dashboardHandoff).toEqual({
      checklistFixtures: {
        googleCalendar: 'not_connected',
        payments: 'not_connected',
        shareBookingLink: 'not_connected',
      },
      tourCompleted: false,
    });
    expect(migrated.state.planOffer.planIntent).toBe('founding');
  });

  it('migrates legacy profile, logo, and Gallery bytes to truthful metadata-only missing state', () => {
    const legacy = createDefaultOnboardingState() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 5;
    const profile = legacy.profile as Record<string, unknown>;
    profile.profilePhoto = {
      altText: 'Owner portrait',
      fileName: 'owner.png',
      height: 900,
      id: 'legacy-profile',
      mimeType: 'image/png',
      previewUrl: 'data:image/png;base64,PROFILE_BYTES',
      source: 'data_url',
      width: 600,
    };
    profile.logo = {
      fileName: 'logo.webp',
      id: 'legacy-logo',
      mimeType: 'image/webp',
      previewUrl: 'blob:legacy-logo-object-url',
      source: 'fixture',
    };
    legacy.gallery = {
      images: [{
        fileName: 'nails.jpg',
        height: 800,
        id: 'legacy-gallery',
        mimeType: 'image/jpeg',
        previewUrl: 'data:image/jpeg;base64,GALLERY_BYTES',
        source: 'data_url',
        width: 800,
      }, {
        fileName: 'stored.png',
        id: 'stored-gallery',
        mimeType: 'image/png',
        previewUrl: 'data:image/png;base64,STALE_PREVIEW_BYTES',
        source: 'indexed_db',
        storageId: 'gallery-asset-stored',
      }],
      layout: 'carousel',
      source: 'uploads',
    };

    const migrated = parseOnboardingState(JSON.stringify(legacy));

    expect(migrated.status).toBe('loaded');
    expect(migrated.state.profile.profilePhoto).toEqual({
      altText: 'Owner portrait',
      fileName: 'owner.png',
      height: 900,
      id: 'legacy-profile',
      mimeType: 'image/png',
      source: 'missing',
      width: 600,
    });
    expect(migrated.state.profile.logo).toEqual({
      fileName: 'logo.webp',
      id: 'legacy-logo',
      mimeType: 'image/webp',
      source: 'missing',
    });
    expect(migrated.state.gallery.images).toEqual([
      expect.objectContaining({
        fileName: 'nails.jpg',
        source: 'missing',
        width: 800,
      }),
      expect.objectContaining({
        fileName: 'stored.png',
        source: 'indexed_db',
        storageId: 'gallery-asset-stored',
      }),
    ]);
    const serialized = serializeOnboardingState(migrated.state);
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain('blob:');
    expect(serialized).not.toContain('PROFILE_BYTES');
    expect(serialized).not.toContain('GALLERY_BYTES');
    expect(parseOnboardingState(serialized).status).toBe('loaded');
  });

  it('saves and reloads Profile and Logo references without swapping their roles', () => {
    const state = createDefaultOnboardingState();
    state.profile.profilePhoto = {
      fileName: 'daniela-portrait.png',
      id: 'profile-profile-asset',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'profile-asset',
    };
    state.profile.logo = {
      fileName: 'isla-wordmark.png',
      id: 'logo-logo-asset',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'logo-asset',
    };
    const storage = createMemoryStorage();

    const saved = saveOnboardingState(state, {
      storage,
      timestamp: '2026-08-29T20:00:00.000Z',
    });
    expect(saved.success).toBe(true);

    const loaded = loadOnboardingState(storage);
    expect(loaded.status).toBe('loaded');
    expect(loaded.state.profile.profilePhoto).toMatchObject({
      fileName: 'daniela-portrait.png',
      id: 'profile-profile-asset',
      storageId: 'profile-asset',
    });
    expect(loaded.state.profile.logo).toMatchObject({
      fileName: 'isla-wordmark.png',
      id: 'logo-logo-asset',
      storageId: 'logo-asset',
    });
    expect(loaded.state.profile.profilePhoto?.storageId)
      .not.toBe(loaded.state.profile.logo?.storageId);
  });

  it('retains only same-origin account media IDs on fixture references', () => {
    const state = createDefaultOnboardingState();
    const serverMediaId = '33333333-3333-4333-8333-333333333333';
    state.profile.profilePhoto = {
      fileName: 'saved-owner.webp',
      id: 'profile-logical-id',
      mimeType: 'image/webp',
      previewUrl: `/api/onboarding/v1/media/${serverMediaId}`,
      source: 'fixture',
      storageId: serverMediaId,
    };
    state.profile.logo = {
      fileName: 'remote-logo.webp',
      id: 'logo-logical-id',
      mimeType: 'image/webp',
      previewUrl: 'https://untrusted.example/media/logo.webp',
      source: 'fixture',
      storageId: '44444444-4444-4444-8444-444444444444',
    };
    const storage = createMemoryStorage();

    expect(saveOnboardingState(state, { storage }).success).toBe(true);
    const loaded = loadOnboardingState(storage);

    expect(loaded.status).toBe('loaded');
    expect(loaded.state.profile.profilePhoto).toMatchObject({
      previewUrl: `/api/onboarding/v1/media/${serverMediaId}`,
      source: 'fixture',
      storageId: serverMediaId,
    });
    expect(loaded.state.profile.logo).toMatchObject({
      previewUrl: 'https://untrusted.example/media/logo.webp',
      source: 'fixture',
    });
    expect(loaded.state.profile.logo).not.toHaveProperty('storageId');
  });

  it('normalizes contaminated v6 image references before validation and every current save', () => {
    const legacyV6 = createDefaultOnboardingState() as unknown as Record<string, unknown>;
    legacyV6.schemaVersion = 6;
    const legacyPlanOffer = legacyV6.planOffer as Record<string, unknown>;
    delete legacyPlanOffer.foundingMode;
    const legacyProfile = legacyV6.profile as Record<string, unknown>;
    legacyProfile.profilePhoto = {
      fileName: 'legacy-owner.png',
      id: 'legacy-owner',
      mimeType: 'image/png',
      previewUrl: 'data:image/png;base64,DO_NOT_SAVE',
      source: 'data_url',
    };
    legacyV6.gallery = {
      images: [{
        fileName: 'legacy-gallery.png',
        id: 'legacy-gallery-current',
        mimeType: 'image/png',
        previewUrl: 'blob:stale-gallery-preview',
        source: 'fixture',
      }],
      layout: 'grid',
      source: 'uploads',
    };
    const migrated = parseOnboardingState(JSON.stringify(legacyV6));
    expect(migrated).toMatchObject({
      state: {
        gallery: { images: [expect.objectContaining({ source: 'missing' })] },
        profile: { profilePhoto: expect.objectContaining({ source: 'missing' }) },
      },
      status: 'loaded',
    });

    const state = migrated.state;
    state.profile.logo = {
      fileName: 'legacy-logo.png',
      id: 'legacy-logo-current',
      mimeType: 'image/png',
      previewUrl: 'data:image/png;base64,CURRENT_BYTES',
      source: 'data_url',
    };
    const storage = createMemoryStorage();

    const saved = saveOnboardingState(state, {
      storage,
      timestamp: '2026-08-29T18:00:00.000Z',
    });

    expect(saved.success).toBe(true);
    if (!saved.success) throw new Error('Expected the normalized state to save.');
    expect(saved.state.profile.profilePhoto?.source).toBe('missing');
    expect(saved.state.profile.logo?.source).toBe('missing');
    expect(saved.state.gallery.images[0]?.source).toBe('missing');
    const json = storage.values.get(ONBOARDING_STORAGE_KEY) ?? '';
    expect(json).not.toContain('DO_NOT_SAVE');
    expect(json).not.toContain('CURRENT_BYTES');
    expect(json).not.toContain('data:image');
    expect(json).not.toContain('blob:');
    expect(loadOnboardingState(storage)).toMatchObject({
      state: {
        gallery: { images: [expect.objectContaining({ source: 'missing' })] },
        profile: { profilePhoto: expect.objectContaining({ source: 'missing' }) },
      },
      status: 'loaded',
    });
  });

  it('normalizes removed structural About visibility while preserving optional choices and data', () => {
    const legacy = createDanielaFixtureState() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 6;
    const profile = legacy.profile as Record<string, unknown>;
    const about = profile.about as Record<string, unknown>;
    about.visibility = {
      ...(about.visibility as Record<string, boolean>),
      bio: false,
      book_button: false,
      certifications: false,
      owner_name: false,
      profile_photo: false,
      salon_name: false,
      specialties: false,
    };
    (legacy.recipe as Record<string, unknown>).aboutPreset = 'editorial_portrait';
    (legacy.dashboardHandoff as Record<string, unknown>).tourCompleted = true;
    delete (legacy.planOffer as Record<string, unknown>).foundingMode;

    const migrated = parseOnboardingState(JSON.stringify(legacy));

    expect(migrated.status).toBe('loaded');
    expect(migrated.state.profile.about.visibility).toMatchObject({
      bio: true,
      book_button: true,
      certifications: false,
      owner_name: true,
      profile_photo: true,
      salon_name: true,
      specialties: false,
    });
    expect(migrated.state.profile.about.shortBio).toBe(
      createDanielaFixtureState().profile.about.shortBio,
    );
    expect(migrated.state.recipe.aboutPreset).toBe('editorial_portrait');
    expect(migrated.state.planOffer.foundingMode).toBe('lifetime');
    expect(migrated.state.dashboardHandoff.tourCompleted).toBe(true);
    expect(migrated.state.schemaVersion).toBe(ONBOARDING_SCHEMA_VERSION);
  });

  it('adds one opaque draft identity and default palette when migrating schema v7', () => {
    const legacy = createDanielaFixtureState() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 7;
    delete legacy.anonymousDraftId;
    const recipe = legacy.recipe as Record<string, unknown>;
    delete recipe.paletteConfirmed;
    delete recipe.palettePreset;

    const migrated = parseOnboardingState(JSON.stringify(legacy));

    expect(migrated.status).toBe('loaded');
    expect(migrated.state.anonymousDraftId).toMatch(/^draft_[a-z0-9_-]{12,100}$/iu);
    expect(migrated.state.recipe).toMatchObject({
      paletteConfirmed: false,
      palettePreset: 'luster_berry',
    });
    expect(migrated.state.schemaVersion).toBe(ONBOARDING_SCHEMA_VERSION);
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
