import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import { createDeterministicIdFactory } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/ids';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { compileOnboardingToSiteDocument } from './compiler';
import { onboardingDraftClaimRequestSchema } from './contracts';
import { createPersistableOnboardingDraft } from './snapshot';

const acceptedState = (starter: 'quick_book' | 'one_page' | 'multi_page') => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.businessStructure = 'solo';
  state.profile.ownerName = 'Daniela';
  state.recipe.starter = starter;
  state.recipe.starterDocumentSiteId = `site_${starter}`;
  return state;
};

describe('account-backed onboarding document compiler', () => {
  it.each(['quick_book', 'one_page', 'multi_page'] as const)(
    'preserves the exact accepted %s universal document and stable IDs',
    (starter) => {
      const state = acceptedState(starter);
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(starter),
        siteId: `site_${starter}`,
        siteName: state.profile.businessName,
      });
      const { snapshot } = createPersistableOnboardingDraft(
        state,
        'luster_berry',
        null,
        source,
      );
      const compiled = compileOnboardingToSiteDocument({
        revision: 1,
        siteId: '11111111-1111-4111-8111-111111111111',
        snapshot,
      });

      expect(compiled.builderDocument).toEqual(source);
      expect(compiled.builderDocument.pages.map(page => page.id))
        .toEqual(source.pages.map(page => page.id));
      expect(compiled.builderDocument.pages.flatMap(page => page.sections.map(section => section.id)))
        .toEqual(source.pages.flatMap(page => page.sections.map(section => section.id)));

      if (starter === 'multi_page') {
        expect(compiled.builderDocument.pages.map(page => page.name)).toEqual([
          'Home',
          'Services / Book',
          'Gallery',
          'About',
          'Contact',
        ]);
      }
    },
  );

  it('round-trips full Custom Design metadata and internal destinations using logical IDs only', () => {
    const state = acceptedState('multi_page');
    state.recipe.canvaEnabled = true;
    state.canva.status = 'ready';
    state.canva.customDesignSectionId = 'section_custom_design';
    const document = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('custom'),
      siteId: 'site_multi_page',
      siteName: state.profile.businessName,
    });
    const targetPage = document.pages[2]!;
    const targetSection = targetPage.sections[0]!;
    const settings: CustomDesignSettings = {
      ...createDefaultCustomDesignSettings(),
      background: { color: '#F4E4DE', mode: 'custom' },
      cta: {
        action: {
          destination: { pageId: targetPage.id, sectionId: targetSection.id },
          type: 'internal',
        },
        label: 'See my work',
        placement: { imageItemId: 'image_item_one', type: 'after_image' },
        type: 'custom',
      },
      displayMode: 'contained',
      gap: 'comfortable',
      images: [{
        accessibleSummary: 'A detailed design page with a booking call to action.',
        altText: 'Isla Nail Studio service guide',
        aspectRatio: 0.8,
        assetId: 'indexed_db_storage_key_must_not_persist',
        decorative: false,
        fileName: 'isla-guide.webp',
        fileSize: 4_000,
        height: 1_000,
        id: 'image_item_one',
        interactiveAreas: [{
          accessibleLabel: 'Open the Gallery',
          action: {
            destination: { pageId: targetPage.id, sectionId: targetSection.id },
            type: 'internal',
          },
          geometry: { height: 0.1, width: 0.3, x: 0.1, y: 0.7 },
          id: 'hotspot_gallery',
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
      id: 'section_custom_design',
      label: 'Custom Design',
      order: document.pages[0]!.sections.length,
      sectionType: 'custom_design',
      settings,
      visible: true,
    });

    const draft = createPersistableOnboardingDraft(
      state,
      'black_champagne',
      settings,
      document,
    );
    const request = onboardingDraftClaimRequestSchema.parse({
      anonymousDraftToken: 'draft_token_123456789012345678901234567890',
      idempotencyKey: 'claim_key_123456789012345678901234567890',
      ...draft,
    });
    const compiled = compileOnboardingToSiteDocument({
      revision: 3,
      siteId: '11111111-1111-4111-8111-111111111111',
      snapshot: request.snapshot,
    });
    const savedCustom = compiled.builderDocument.pages
      .flatMap(page => page.sections)
      .find(section => section.sectionType === 'custom_design');

    expect(request.media).toEqual([expect.objectContaining({
      imageItemId: 'image_item_one',
      localItemId: 'image_item_one',
      role: 'custom_design',
    })]);
    expect(JSON.stringify(request)).not.toContain('indexed_db_storage_key_must_not_persist');
    expect(savedCustom).toMatchObject({
      settings: {
        cta: { action: { destination: { pageId: targetPage.id, sectionId: targetSection.id } } },
        images: [{
          assetId: 'image_item_one',
          id: 'image_item_one',
          interactiveAreas: [{
            action: { destination: { pageId: targetPage.id, sectionId: targetSection.id } },
          }],
        }],
      },
    });
  });

  it('keeps built-in Gallery fixtures out of the upload manifest', () => {
    const state = acceptedState('one_page');
    state.recipe.galleryEnabled = true;
    state.gallery.source = 'mock_luster';
    state.gallery.images = [{
      altText: 'Example manicure',
      fileName: 'example.webp',
      id: 'gallery-example-one',
      mimeType: 'image/webp',
      previewUrl: '/gallery/example.webp',
      source: 'fixture',
    }];
    const document: SiteBuilderDocument = initializeStarter('one_page', {
      siteId: 'site_one_page',
      siteName: state.profile.businessName,
    });
    const draft = createPersistableOnboardingDraft(state, 'luster_berry', null, document);

    expect(draft.snapshot.gallery).toMatchObject({
      imageItemIds: ['gallery-example-one'],
      source: 'mock_luster',
    });
    expect(draft.media).toEqual([]);
  });

  it('rejects unknown or duplicate service IDs before persistence', () => {
    const state = acceptedState('quick_book');
    state.profile.serviceMenu.selectedServiceIds = ['svc-manicure-gel', 'svc-manicure-gel', 'not-canonical'];
    const document = initializeStarter('quick_book', {
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });

    expect(() => createPersistableOnboardingDraft(state, 'luster_berry', null, document))
      .toThrow(/Selected service/);
  });

  it('accepts overrides only for selected canonical menu items and bounds the map', () => {
    const state = acceptedState('quick_book');
    state.profile.serviceMenu.selectedServiceIds = ['svc-manicure-gel'];
    state.profile.serviceMenu.ownerOverridesByServiceId = {
      'svc-manicure-gel': { durationMinutes: 75, priceCents: 5_500 },
    };
    const document = initializeStarter('quick_book', {
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });

    expect(() => createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    )).not.toThrow();

    state.profile.serviceMenu.ownerOverridesByServiceId = {
      'svc-manicure-gel': { priceCents: 5_500 },
      'svc-pedicure-gel': { priceCents: 6_500 },
    };

    expect(() => createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    )).toThrow(/selected canonical service or add-on/);

    state.profile.serviceMenu.ownerOverridesByServiceId = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [
        `unselected-${index}`,
        { priceCents: 1_000 },
      ]),
    );

    expect(() => createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    )).toThrow(/at most 200/);
  });
});
