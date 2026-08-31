import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import {
  ONBOARDING_SITE_MEDIA_LIMIT_MESSAGE,
  ONBOARDING_SITE_MEDIA_MAX_ITEMS,
} from './contracts';
import {
  collectInheritedCustomDesignMedia,
  resolveOnboardingCustomDesignSettings,
} from './custom-design-media';
import { createPersistableOnboardingDraft } from './snapshot';

const image = (id: string, assetId = id) => ({
  altText: `${id} artwork`,
  aspectRatio: 1,
  assetId,
  decorative: false,
  fileName: `${id}.png`,
  fileSize: 1,
  height: 1,
  id,
  interactiveAreas: [],
  mimeType: 'image/png' as const,
  width: 1,
});

const createAcceptedState = () => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Boundary Studio';
  state.profile.businessStructure = 'solo';
  state.profile.ownerName = 'Owner';
  state.recipe.starter = 'quick_book';
  return state;
};

const documentWithCustomImageCount = (count: number) => {
  const document = initializeStarter('quick_book', { siteName: 'Boundary Studio' });
  const defaults = createDefaultCustomDesignSettings();
  let imageIndex = 0;
  while (imageIndex < count) {
    const sectionIndex = document.pages[0]!.sections.length;
    const images = Array.from(
      { length: Math.min(10, count - imageIndex) },
      () => image(`boundary-image-${imageIndex++}`, `boundary-asset-${imageIndex}`),
    );
    document.pages[0]!.sections.push({
      id: `boundary-custom-${sectionIndex}`,
      label: 'Custom Design',
      order: sectionIndex,
      sectionType: 'custom_design',
      settings: { ...defaults, images },
      visible: true,
    });
  }
  return document;
};

describe('Custom Design onboarding media ownership', () => {
  it('resolves the selected settings from a removed/restorable section', () => {
    const document = initializeStarter('quick_book');
    const settings = {
      ...createDefaultCustomDesignSettings(),
      images: [image('restorable-image', 'restorable-local-asset')],
    };
    document.unusedSections.push({
      id: 'selected-restorable-custom',
      label: 'Custom Design',
      order: 0,
      sectionType: 'custom_design',
      settings,
      visible: true,
    });

    expect(resolveOnboardingCustomDesignSettings(
      document,
      'selected-restorable-custom',
    )).toEqual(settings);

    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Restorable Studio';
    state.profile.businessStructure = 'solo';
    state.profile.ownerName = 'Owner';
    state.recipe.canvaEnabled = true;
    state.recipe.starter = 'quick_book';
    state.canva.customDesignSectionId = 'selected-restorable-custom';
    state.canva.status = 'ready';

    expect(() => createPersistableOnboardingDraft(
      state,
      'luster_berry',
      resolveOnboardingCustomDesignSettings(
        document,
        state.canva.customDesignSectionId,
      ),
      document,
    )).not.toThrow();
  });

  it('carries unchanged account media but excludes a same-ID local replacement', () => {
    const document = initializeStarter('quick_book');
    const defaults = createDefaultCustomDesignSettings();
    document.pages[0]!.sections.push({
      id: 'active-custom',
      label: 'Custom Design',
      order: document.pages[0]!.sections.length,
      sectionType: 'custom_design',
      settings: { ...defaults, images: [image('active-image')] },
      visible: true,
    });
    document.unusedSections.push({
      id: 'restorable-custom',
      label: 'Custom Design',
      order: 0,
      sectionType: 'custom_design',
      settings: {
        ...defaults,
        images: [image('restorable-image', 'new-device-local-asset')],
      },
      visible: true,
    });

    expect(collectInheritedCustomDesignMedia(
      document,
      null,
      new Map([
        ['active-image', '11111111-1111-4111-8111-111111111111'],
        ['restorable-image', '22222222-2222-4222-8222-222222222222'],
      ]),
    )).toEqual(new Map([
      ['active-image', '11111111-1111-4111-8111-111111111111'],
    ]));
  });

  it('accepts 80 account media rows and rejects 81 before upload with owner guidance', () => {
    const state = createAcceptedState();
    const atLimit = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      documentWithCustomImageCount(ONBOARDING_SITE_MEDIA_MAX_ITEMS),
    );

    expect(atLimit.media).toHaveLength(ONBOARDING_SITE_MEDIA_MAX_ITEMS);
    expect(() => createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      documentWithCustomImageCount(ONBOARDING_SITE_MEDIA_MAX_ITEMS + 1),
    )).toThrow(ONBOARDING_SITE_MEDIA_LIMIT_MESSAGE);
  });
});
