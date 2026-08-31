/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const persistence = vi.hoisted(() => ({
  getClaimedOnboardingSite: vi.fn(),
}));

vi.mock('./persistence.server', () => persistence);

import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
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
import { compileOnboardingToSiteDocument } from './compiler';
import { collectOnboardingMediaReferences } from './media-claim-client';
import { fingerprintOnboardingPayload } from './payload-fingerprint';
import { loadInitialOnboardingResumeDraft } from './resume.server';
import { ResumedOnboardingAssetRepository } from './resume-assets';
import { hydrateInitialOnboardingResumeDraft } from './resume-client';
import { SavedPreviewAssetRepository } from './saved-preview-assets';
import { createPersistableOnboardingDraft } from './snapshot';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_MEDIA_ID = '33333333-3333-4333-8333-333333333333';
const LOGICAL_IMAGE_ID = 'custom-image-one';

const createMemoryStorage = (): OnboardingStorage => {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

const setupPersistedCustomDesign = () => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.businessStructure = 'solo';
  state.profile.ownerName = 'Daniela';
  state.recipe.canvaEnabled = true;
  state.recipe.aboutPreset = 'about_before_you_book';
  state.recipe.starter = 'one_page';
  state.recipe.starterDocumentSiteId = 'accepted-builder-site';
  state.gallery.layout = 'editorial';
  state.canva.customDesignSectionId = 'section-custom-design';
  state.canva.status = 'ready';
  state.canva.images = [{
    altText: 'Isla Nail Studio service guide',
    fileName: 'isla-guide.webp',
    height: 1_000,
    id: LOGICAL_IMAGE_ID,
    mimeType: 'image/webp',
    previewUrl: 'blob:accepted-custom-design',
    source: 'indexed_db',
    storageId: 'device-only-asset-id',
    width: 800,
  }];
  const document = initializeStarter('one_page', {
    siteId: 'accepted-builder-site',
    siteName: state.profile.businessName,
  });
  const booking = document.pages[0]!.sections.find(section => section.sectionType === 'booking')!;
  const settings: CustomDesignSettings = {
    ...createDefaultCustomDesignSettings(),
    cta: {
      action: {
        destination: { pageId: document.pages[0]!.id, sectionId: booking.id },
        type: 'internal',
      },
      label: 'Book this look',
      placement: { imageItemId: LOGICAL_IMAGE_ID, type: 'after_image' },
      type: 'custom',
    },
    images: [{
      accessibleSummary: 'A detailed service guide with an approved Booking hotspot.',
      altText: 'Isla Nail Studio service guide',
      aspectRatio: 0.8,
      assetId: 'device-only-asset-id',
      decorative: false,
      fileName: 'isla-guide.webp',
      fileSize: 4_000,
      height: 1_000,
      id: LOGICAL_IMAGE_ID,
      interactiveAreas: [{
        accessibleLabel: 'Book this service',
        action: {
          destination: { pageId: document.pages[0]!.id, sectionId: booking.id },
          type: 'internal',
        },
        geometry: { height: 0.1, width: 0.3, x: 0.1, y: 0.7 },
        id: 'hotspot-booking',
        labelConfirmed: true,
        reviewStatus: 'approved',
        semanticOrder: 0,
        validationStatus: 'valid',
      }],
      mimeType: 'image/webp',
      width: 800,
    }],
  };
  document.pages[0]!.sections.push({
    id: state.canva.customDesignSectionId,
    label: 'Custom Design',
    order: document.pages[0]!.sections.length,
    sectionType: 'custom_design',
    settings,
    visible: true,
  });
  const persisted = createPersistableOnboardingDraft(
    state,
    state.recipe.palettePreset,
    settings,
    document,
  );
  const compiled = compileOnboardingToSiteDocument({
    revision: 4,
    siteId: SITE_ID,
    snapshot: persisted.snapshot,
  });
  return { compiled, persisted };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('cross-device Custom Design editing resume', () => {
  it('retains logical document IDs while carrying server media forward without reupload', async () => {
    const { compiled, persisted } = setupPersistedCustomDesign();
    persistence.getClaimedOnboardingSite.mockResolvedValue({
      media: [{
        accessibleSummary: 'A detailed service guide with an approved Booking hotspot.',
        altText: 'Isla Nail Studio service guide',
        claimStatus: 'ready',
        decorative: false,
        displayMode: 'contain',
        fileName: 'isla-guide.webp',
        fileSize: 4_000,
        height: 1_000,
        id: SERVER_MEDIA_ID,
        imageItemId: LOGICAL_IMAGE_ID,
        localItemId: LOGICAL_IMAGE_ID,
        metadata: { byteSize: 4_000 },
        mimeType: 'image/webp',
        publicUrl: `/api/onboarding/v1/media/${SERVER_MEDIA_ID}`,
        role: 'custom_design',
        sortOrder: 0,
        storageKey: 'development/site/revision/custom-image.webp',
        width: 800,
      }],
      revision: {
        document: compiled,
        revision: 4,
        snapshot: persisted.snapshot,
      },
      site: { id: SITE_ID },
    });

    const resume = await loadInitialOnboardingResumeDraft({
      adminId: 'owner-admin',
      siteId: SITE_ID,
      verifiedRevision: 4,
    });

    expect(resume).not.toBeNull();

    if (!resume) {
      return;
    }

    const resumedCustom = resume.document.pages
      .flatMap(page => page.sections)
      .find(section => section.sectionType === 'custom_design');

    expect(resumedCustom?.sectionType).toBe('custom_design');

    if (resumedCustom?.sectionType !== 'custom_design') {
      return;
    }

    expect(resumedCustom.settings.images[0]).toMatchObject({
      assetId: LOGICAL_IMAGE_ID,
      id: LOGICAL_IMAGE_ID,
      interactiveAreas: [{
        action: {
          destination: expect.objectContaining({ sectionId: expect.any(String) }),
          type: 'internal',
        },
        id: 'hotspot-booking',
        reviewStatus: 'approved',
      }],
    });
    expect(resumedCustom.settings.cta).toMatchObject({
      action: { type: 'internal' },
      placement: { imageItemId: LOGICAL_IMAGE_ID },
    });

    const storage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();

    expect(hydrateInitialOnboardingResumeDraft(resume, {
      createDraftId: () => 'draft_append_revision_custom_design',
      sessionStorage,
      storage,
    })).toEqual({ success: true });

    const loaded = loadOnboardingState(storage);

    expect(loaded.status).toBe('loaded');

    const parsedDocument = parseSiteBuilderDocument(
      storage.getItem(SITE_BUILDER_STORAGE_KEY) ?? '',
    );
    if (!parsedDocument.success) {
      throw new Error(parsedDocument.issues.join(' '));
    }
    const hydratedCustom = parsedDocument.document.pages
      .flatMap(page => page.sections)
      .find(section => section.sectionType === 'custom_design');

    expect(hydratedCustom?.sectionType).toBe('custom_design');

    if (hydratedCustom?.sectionType !== 'custom_design') {
      return;
    }

    const replacement = createPersistableOnboardingDraft(
      loaded.state,
      loaded.state.recipe.palettePreset,
      hydratedCustom.settings,
      parsedDocument.document,
    );

    expect(fingerprintOnboardingPayload(replacement.snapshot))
      .toBe(fingerprintOnboardingPayload(persisted.snapshot));
    expect(replacement.media).toEqual([expect.objectContaining({
      existingMediaId: SERVER_MEDIA_ID,
      imageItemId: LOGICAL_IMAGE_ID,
      localItemId: LOGICAL_IMAGE_ID,
      role: 'custom_design',
    })]);
    expect(collectOnboardingMediaReferences(loaded.state)).toEqual([]);
    expect(hydratedCustom.settings.images[0]?.interactiveAreas)
      .toEqual(resumedCustom.settings.images[0]?.interactiveAreas);
    expect(hydratedCustom.settings.cta).toEqual(resumedCustom.settings.cta);
  });

  it('resolves only logical Custom Design IDs through the authorized server endpoint', async () => {
    const media = [{
      altText: 'Isla service guide',
      assetId: SERVER_MEDIA_ID,
      fileName: 'isla-guide.webp',
      fileSize: 4,
      height: 2,
      localItemId: LOGICAL_IMAGE_ID,
      mimeType: 'image/webp',
      publicUrl: `/api/onboarding/v1/media/${SERVER_MEDIA_ID}`,
      role: 'custom_design' as const,
      sortOrder: 0,
      width: 2,
    }];
    const fetcher = vi.fn(async () => new Response(
      new Blob(['safe'], { type: 'image/webp' }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetcher);
    const repository = new ResumedOnboardingAssetRepository(
      media,
      new SavedPreviewAssetRepository([]),
    );

    await expect(repository.getMetadata(LOGICAL_IMAGE_ID)).resolves.toMatchObject({
      id: LOGICAL_IMAGE_ID,
    });
    await expect(repository.getOriginal(LOGICAL_IMAGE_ID)).resolves.toBeInstanceOf(Blob);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/onboarding/v1/media/${SERVER_MEDIA_ID}`,
      { cache: 'no-store', credentials: 'same-origin' },
    );
    expect(await repository.list()).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ id: LOGICAL_IMAGE_ID }) }),
    ]);

    repository.close();

    const untrusted = new ResumedOnboardingAssetRepository([{
      ...media[0]!,
      publicUrl: 'https://example.invalid/remote-image.webp',
    }], new SavedPreviewAssetRepository([]));

    await expect(untrusted.getMetadata(LOGICAL_IMAGE_ID)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);

    untrusted.close();
  });
});
