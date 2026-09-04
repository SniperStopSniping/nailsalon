// @vitest-environment jsdom

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import {
  parseSiteBuilderDocument,
  SITE_BUILDER_STORAGE_KEY,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import {
  loadOnboardingState,
  type OnboardingStorage,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import {
  canResumeVerifiedOnboardingSetup,
  loadOnboardingIntegrationRecoveryRecord,
  ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY,
  ONBOARDING_INTEGRATION_RESUME_SESSION_KEY,
} from './flow-storage';
import { fingerprintOnboardingPayload } from './payload-fingerprint';
import { hydrateInitialOnboardingResumeDraft } from './resume-client';
import type { InitialOnboardingResumeDraft } from './resume-draft';
import { createPersistableOnboardingDraft } from './snapshot';

const createMemoryStorage = (): OnboardingStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
    values,
  };
};

const createResumeDraft = (): InitialOnboardingResumeDraft => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.businessStructure = 'solo';
  state.profile.ownerName = 'Daniela';
  state.recipe.starter = 'one_page';
  state.recipe.starterDocumentSiteId = 'saved-builder-site';
  const serverMediaId = '33333333-3333-4333-8333-333333333333';
  state.profile.profilePhoto = {
    fileName: 'daniela.webp',
    id: 'profile-logical-id',
    mimeType: 'image/webp',
    previewUrl: `/api/onboarding/v1/media/${serverMediaId}`,
    source: 'fixture',
    storageId: serverMediaId,
  };
  const document = initializeStarter('one_page', {
    siteId: 'saved-builder-site',
    siteName: 'Isla Nail Studio',
  });
  const { snapshot } = createPersistableOnboardingDraft(
    state,
    state.recipe.palettePreset,
    null,
    document,
  );
  return {
    document,
    media: [],
    payloadFingerprint: fingerprintOnboardingPayload(snapshot),
    siteId: '22222222-2222-4222-8222-222222222222',
    state,
    verifiedRevision: 4,
  };
};

describe('cross-device onboarding setup hydration', () => {
  it('installs the exact saved document before runtime and rotates the anonymous draft', () => {
    const storage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();
    const draft = createResumeDraft();
    storage.setItem('unrelated-sentinel', 'keep-me');
    storage.setItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY, '{"phase":"plans"}');

    expect(hydrateInitialOnboardingResumeDraft(draft, {
      createDraftId: () => 'draft_cross_device_replacement_1234',
      sessionStorage,
      storage,
    })).toEqual({ success: true });

    const loaded = loadOnboardingState(storage);

    expect(loaded).toMatchObject({
      state: {
        anonymousDraftId: 'draft_cross_device_replacement_1234',
        profile: {
          profilePhoto: {
            source: 'fixture',
            storageId: '33333333-3333-4333-8333-333333333333',
          },
        },
        progress: {
          currentScreen: 'final_preview',
          lastActiveScreen: 'final_preview',
          sessionStatus: 'active',
        },
      },
      status: 'loaded',
    });
    expect(parseSiteBuilderDocument(storage.getItem(SITE_BUILDER_STORAGE_KEY) ?? ''))
      .toMatchObject({ success: true, document: { siteId: 'saved-builder-site' } });
    expect(loadOnboardingIntegrationRecoveryRecord(storage)).toMatchObject({
      payloadFingerprint: draft.payloadFingerprint,
      siteId: draft.siteId,
      verifiedRevision: 4,
    });
    expect(sessionStorage.getItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY))
      .toContain(draft.siteId);
    expect(canResumeVerifiedOnboardingSetup({
      sessionStorage,
      siteId: draft.siteId,
      storage,
      verifiedRevision: 4,
    })).toBe(true);
    expect(storage.getItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('unrelated-sentinel')).toBe('keep-me');
  });

  it('does not overwrite existing browser work when the persisted fingerprint is stale', () => {
    const storage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();
    storage.setItem(SITE_BUILDER_STORAGE_KEY, 'prior-document');
    storage.setItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY, 'prior-flow');
    storage.setItem('unrelated-sentinel', 'keep-me');
    const draft = { ...createResumeDraft(), payloadFingerprint: 'ffffffffffffffff' };

    expect(hydrateInitialOnboardingResumeDraft(draft, {
      sessionStorage,
      storage,
    })).toMatchObject({ success: false });

    expect(storage.getItem(SITE_BUILDER_STORAGE_KEY)).toBe('prior-document');
    expect(storage.getItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY)).toBe('prior-flow');
    expect(storage.getItem('unrelated-sentinel')).toBe('keep-me');
    expect(loadOnboardingState(storage).status).toBe('empty');
    expect(sessionStorage.getItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY)).toBeNull();
  });
});
