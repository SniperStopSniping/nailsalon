import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import { createDeterministicIdFactory } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/ids';
import {
  addSection,
  moveSectionToPage,
  removeSection,
  setSectionVisible,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/operations';
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

const addMeaningfulPolicy = (state: ReturnType<typeof acceptedState>) => {
  state.recipe.policiesEnabled = true;
  state.profile.policies.other.custom = 'Please arrive with bare nails.';
  state.profile.policies.copy.other.visible = true;
};

const addGalleryContent = (state: ReturnType<typeof acceptedState>) => {
  state.recipe.galleryEnabled = true;
  state.gallery.source = 'mock_luster';
  state.gallery.images = [{
    altText: 'Example manicure',
    fileName: 'example-manicure.webp',
    id: 'gallery-example-one',
    mimeType: 'image/webp',
    previewUrl: '/gallery/example-manicure.webp',
    source: 'fixture',
  }];
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

  it.each([
    {
      expectedCounts: {
        about: 1,
        booking: 1,
        contact: 1,
        gallery: 1,
        hero: 1,
        policies: 1,
      },
      starter: 'quick_book',
    },
    {
      expectedCounts: {
        about: 1,
        booking: 1,
        contact: 1,
        gallery: 1,
        hero: 1,
        policies: 1,
      },
      starter: 'one_page',
    },
    {
      expectedCounts: {
        about: 1,
        booking: 1,
        contact: 1,
        gallery: 1,
        hero: 1,
        policies: 1,
      },
      starter: 'multi_page',
    },
  ] as const)(
    'projects the untouched $starter starter into semantic sections without generic placeholders',
    ({ expectedCounts, starter }) => {
      const state = acceptedState(starter);
      state.recipe.aboutEnabled = true;
      state.profile.location.cityOrArea = 'Toronto';
      state.profile.location.locationType = 'salon_suite';
      addGalleryContent(state);
      addMeaningfulPolicy(state);
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`semantic-${starter}`),
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
      const sections = compiled.pages.flatMap(page => page.sections);
      const typeCounts = sections.reduce<Record<string, number>>((counts, item) => ({
        ...counts,
        [item.type]: (counts[item.type] ?? 0) + 1,
      }), {});

      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'content' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'reviews' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'services' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'visit' }));
      expect(sections.map(item => item.presentation.label))
        .not.toContainEqual(expect.stringMatching(/^Section \d+$/u));
      expect(typeCounts).toEqual(expectedCounts);
      expect(typeCounts.about).toBe(1);
      expect(typeCounts.policies).toBe(1);
      expect(typeCounts.gallery).toBe(1);

      if (starter === 'multi_page') {
        const gallerySource = source.pages.find(page => page.slug === 'gallery')?.sections[0];
        const contactSource = source.pages.find(page => page.slug === 'contact')?.sections[1];

        expect(sections.find(item => item.type === 'gallery')?.id).toBe(gallerySource?.id);
        expect(sections.find(item => item.type === 'contact')?.id).toBe(contactSource?.id);
      }
    },
  );

  it('keeps a moved starter section semantic, stable, and owner-labelled', () => {
    const state = acceptedState('multi_page');
    state.recipe.aboutEnabled = true;
    const source = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('moved-about'),
      siteId: 'site_multi_page',
      siteName: state.profile.businessName,
    });
    const home = source.pages.find(page => page.isHome)!;
    const aboutPage = source.pages.find(page => page.slug === 'about')!;
    const aboutSection = aboutPage.sections[0]!;
    const moved = moveSectionToPage(source, aboutSection.id, home.id);
    const movedAbout = moved.pages
      .flatMap(page => page.sections)
      .find(section => section.id === aboutSection.id)!;
    movedAbout.label = 'Daniela’s story';
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      moved,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: '11111111-1111-4111-8111-111111111111',
      snapshot,
    });
    const compiledAbout = compiled.pages
      .flatMap(page => page.sections)
      .filter(section => section.type === 'about');

    expect(compiledAbout).toHaveLength(1);
    expect(compiledAbout[0]).toMatchObject({
      id: aboutSection.id,
      presentation: { label: 'Daniela’s story' },
      source: 'business_profile',
      type: 'about',
    });
  });

  it('does not re-inject hidden or removed starter modules into the saved customer tree', () => {
    const state = acceptedState('one_page');
    state.recipe.aboutEnabled = true;
    addGalleryContent(state);
    const source = initializeStarter('one_page', {
      idFactory: createDeterministicIdFactory('hidden-optional'),
      siteId: 'site_one_page',
      siteName: state.profile.businessName,
    });
    const about = source.pages[0]!.sections.find(section => (
      section.sectionType !== 'booking'
      && section.sectionType !== 'custom_design'
      && section.starterSemanticRole === 'about'
    ))!;
    const gallery = source.pages[0]!.sections.find(section => (
      section.sectionType !== 'booking'
      && section.sectionType !== 'custom_design'
      && section.starterSemanticRole === 'gallery'
    ))!;
    const withHiddenAbout = setSectionVisible(source, about.id, false);
    const document = removeSection(withHiddenAbout, gallery.id);
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    );
    const types = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: '11111111-1111-4111-8111-111111111111',
      snapshot,
    }).pages.flatMap(page => page.sections.map(section => section.type));

    expect(types).not.toContain('about');
    expect(types).not.toContain('gallery');
  });

  it('does not let an owner-added duplicate catalogue section steal a starter role', () => {
    const state = acceptedState('multi_page');
    state.recipe.aboutEnabled = true;
    const ids = createDeterministicIdFactory('duplicate-about');
    const original = initializeStarter('multi_page', {
      idFactory: ids,
      siteId: 'site_multi_page',
      siteName: state.profile.businessName,
    });
    const home = original.pages.find(page => page.isHome)!;
    const originalAbout = original.pages.find(page => page.slug === 'about')!.sections[0]!;
    const withDuplicate = addSection(original, {
      label: 'About Daniela’s colours',
      pageId: home.id,
      position: 1,
      sectionType: originalAbout.sectionType === 'booking'
        || originalAbout.sectionType === 'custom_design'
        ? 'section_05'
        : originalAbout.sectionType,
    }, ids);
    const duplicate = withDuplicate.pages
      .find(page => page.id === home.id)!
      .sections.find(section => section.label === 'About Daniela’s colours')!;
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      withDuplicate,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: '11111111-1111-4111-8111-111111111111',
      snapshot,
    });
    const compiledAbout = compiled.pages
      .flatMap(page => page.sections)
      .filter(section => section.type === 'about');

    expect(duplicate).not.toHaveProperty('starterSemanticRole');
    expect(compiledAbout).toHaveLength(1);
    expect(compiledAbout[0]?.id).toBe(originalAbout.id);
    expect(compiled.pages.flatMap(page => page.sections).map(section => section.id))
      .not.toContain(duplicate.id);
  });

  it('keeps injected optional IDs stable when the target page slug changes', () => {
    const state = acceptedState('quick_book');
    state.recipe.aboutEnabled = true;
    state.profile.location.cityOrArea = 'Toronto';
    state.profile.location.locationType = 'salon_suite';
    addGalleryContent(state);
    addMeaningfulPolicy(state);
    const source = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('stable-optional'),
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });
    const compile = (document: SiteBuilderDocument) => {
      const { snapshot } = createPersistableOnboardingDraft(
        state,
        'luster_berry',
        null,
        document,
      );
      return compileOnboardingToSiteDocument({
        revision: 1,
        siteId: '11111111-1111-4111-8111-111111111111',
        snapshot,
      });
    };
    const originalIds = compile(source).pages
      .flatMap(page => page.sections)
      .filter(section => ['about', 'contact', 'gallery', 'policies'].includes(section.type))
      .map(section => section.id);
    source.pages[0]!.slug = 'daniela-home';
    const renamedIds = compile(source).pages
      .flatMap(page => page.sections)
      .filter(section => ['about', 'contact', 'gallery', 'policies'].includes(section.type))
      .map(section => section.id);

    expect(renamedIds).toEqual(originalIds);
    expect(originalIds).toEqual([
      '11111111-1111-4111-8111-111111111111:onboarding:about',
      '11111111-1111-4111-8111-111111111111:onboarding:gallery',
      '11111111-1111-4111-8111-111111111111:onboarding:policies',
      '11111111-1111-4111-8111-111111111111:onboarding:contact',
    ]);
  });

  it('never promotes an owner label to a native Policies section', () => {
    const state = acceptedState('quick_book');
    state.recipe.policiesEnabled = false;
    const ids = createDeterministicIdFactory('owner-policies-label');
    const source = initializeStarter('quick_book', {
      idFactory: ids,
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });
    const home = source.pages[0]!;
    const withLabel = addSection(source, {
      label: 'Policies',
      pageId: home.id,
      sectionType: 'section_08',
    }, ids);
    const ownerSectionId = withLabel.pages[0]!.sections.find(
      section => section.label === 'Policies',
    )!.id;
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      withLabel,
    );
    const sections = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: '11111111-1111-4111-8111-111111111111',
      snapshot,
    }).pages.flatMap(page => page.sections);

    expect(sections).not.toContainEqual(expect.objectContaining({ id: ownerSectionId }));
    expect(sections).not.toContainEqual(expect.objectContaining({ type: 'policies' }));
  });

  it('migrates an older starter document without semantic metadata', () => {
    const state = acceptedState('multi_page');
    state.recipe.aboutEnabled = true;
    state.profile.location.cityOrArea = 'Toronto';
    state.profile.location.locationType = 'salon_suite';
    addGalleryContent(state);
    const source = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('legacy-starter'),
      siteId: 'site_multi_page',
      siteName: state.profile.businessName,
    });
    for (const section of source.pages.flatMap(page => page.sections)) {
      if (section.sectionType !== 'booking' && section.sectionType !== 'custom_design') {
        delete section.starterSemanticRole;
      }
    }
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      source,
    );
    const sections = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: '11111111-1111-4111-8111-111111111111',
      snapshot,
    }).pages.flatMap(page => page.sections);

    expect(sections.map(section => section.type)).toEqual([
      'hero',
      'booking',
      'gallery',
      'about',
      'contact',
    ]);
  });

  it.each(['quick_book', 'one_page', 'multi_page'] as const)(
    'keeps exactly one truthful customer Contact section for public %s profile data',
    (starter) => {
      const state = acceptedState(starter);
      state.profile.location.cityOrArea = 'Toronto';
      state.profile.location.locationType = 'salon_suite';
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`public-contact-${starter}`),
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
      const contacts = compiled.pages
        .flatMap(page => page.sections)
        .filter(section => section.type === 'contact');

      expect(contacts).toHaveLength(1);

      if (starter === 'multi_page') {
        const sourceContact = source.pages
          .find(page => page.slug === 'contact')!
          .sections.find(section => (
            section.sectionType !== 'booking'
            && section.sectionType !== 'custom_design'
            && section.starterSemanticRole === 'contact'
          ));

        expect(contacts[0]?.id).toBe(sourceContact?.id);
      } else {
        expect(contacts[0]?.id).toBe(
          '11111111-1111-4111-8111-111111111111:onboarding:contact',
        );
      }
    },
  );

  it('does not compile Booking-only as a duplicate empty Contact section', () => {
    const state = acceptedState('quick_book');
    state.profile.bookingOnlyContact = true;
    const source = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('booking-only-contact'),
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      source,
    );
    const sections = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: '11111111-1111-4111-8111-111111111111',
      snapshot,
    }).pages.flatMap(page => page.sections);

    expect(sections.filter(section => section.type === 'booking')).toHaveLength(1);
    expect(sections).not.toContainEqual(expect.objectContaining({ type: 'contact' }));
  });

  it.each(['quick_book', 'one_page', 'multi_page'] as const)(
    'omits Contact and empty contact navigation for private %s profile data',
    (starter) => {
      const state = acceptedState(starter);
      state.profile.bookingOnlyContact = false;
      state.profile.preferredContact = null;
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`private-contact-${starter}`),
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

      expect(compiled.pages.flatMap(page => page.sections))
        .not.toContainEqual(expect.objectContaining({ type: 'contact' }));
      expect(compiled.navigation.map(item => item.label)).not.toContain('Contact');
      expect(compiled.pages.map(page => page.slug)).not.toContain('contact');
    },
  );

  it.each(['one_page', 'multi_page'] as const)(
    'omits Gallery and its empty navigation when %s has no gallery content',
    (starter) => {
      const state = acceptedState(starter);
      state.recipe.galleryEnabled = true;
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`empty-gallery-${starter}`),
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

      expect(compiled.pages.flatMap(page => page.sections))
        .not.toContainEqual(expect.objectContaining({ type: 'gallery' }));
      expect(compiled.navigation.map(item => item.label)).not.toContain('Gallery');
      expect(compiled.pages.map(page => page.slug)).not.toContain('gallery');
    },
  );

  it('retains every distinct Custom Design section by stable ID', () => {
    const state = acceptedState('quick_book');
    state.recipe.canvaEnabled = true;
    state.canva.status = 'ready';
    state.canva.customDesignSectionId = 'custom-one';
    const settings = createDefaultCustomDesignSettings();
    const source = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('multiple-custom'),
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });
    source.pages[0]!.sections.push(
      {
        id: 'custom-one',
        label: 'Custom Design',
        order: source.pages[0]!.sections.length,
        sectionType: 'custom_design',
        settings,
        visible: true,
      },
      {
        id: 'custom-two',
        label: 'Custom Design',
        order: source.pages[0]!.sections.length + 1,
        sectionType: 'custom_design',
        settings: { ...settings, displayMode: 'full_width' },
        visible: true,
      },
    );
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      settings,
      source,
    );
    const customSections = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: '11111111-1111-4111-8111-111111111111',
      snapshot,
    }).pages.flatMap(page => page.sections).filter(
      section => section.type === 'custom_design',
    );

    expect(customSections.map(section => section.id)).toEqual(['custom-one', 'custom-two']);
  });

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
