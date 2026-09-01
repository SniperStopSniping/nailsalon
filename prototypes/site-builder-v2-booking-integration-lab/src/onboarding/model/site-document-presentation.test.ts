import { createDeterministicIdFactory } from '../../model/ids';
import { addSection } from '../../model/operations';
import { buildWebsiteRecipeDocument } from '../../model/section-library/recipes';
import { upgradeSiteBuilderDocument } from '../../model/section-library/upgrade';
import { initializeStarter } from '../../model/starters';
import { parseSiteBuilderDocument } from '../../model/validation';
import { applyOnboardingSitePresentation } from './site-document-presentation';

describe('onboarding site presentation ownership', () => {
  it.each(['one_page', 'multi_page'] as const)(
    'immutably stamps choices into the one authoritative About and Gallery in %s',
    (starter) => {
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`presentation-${starter}`),
      });
      const sourceJson = JSON.stringify(source);
      const result = applyOnboardingSitePresentation(source, {
        aboutPreset: 'about_before_you_book',
        galleryLayout: 'carousel',
      });

      expect(JSON.stringify(source)).toBe(sourceJson);
      expect(result.pages.flatMap(page => page.sections)
        .filter(section => section.sectionType === 'about')
        .map(section => section.settings.preset))
        .toEqual(['about_before_you_book']);

      const galleries = result.pages.flatMap(page => page.sections)
        .filter(section => section.sectionType === 'gallery');

      expect(galleries).toHaveLength(1);
      expect(galleries[0]).toMatchObject({
        galleryPresentationOwner: 'onboarding',
        settings: { preset: 'carousel' },
      });
      expect(galleries.some(
        section => section.galleryPresentationOwner === 'recipe',
      )).toBe(false);
      expect(result.pages.map(page => ({
        name: page.name,
        sectionTypes: page.sections.map(section => section.sectionType),
      }))).toEqual(starter === 'one_page'
        ? [{
            name: 'Home',
            sectionTypes: [
              'hero',
              'gallery',
              'about',
              'booking',
              'reviews',
              'policies',
              'visit_us',
            ],
          }]
        : [
            { name: 'Home', sectionTypes: ['hero', 'reviews'] },
            { name: 'Services & Booking', sectionTypes: ['booking', 'policies'] },
            { name: 'Gallery', sectionTypes: ['gallery'] },
            { name: 'About', sectionTypes: ['about'] },
            { name: 'Contact', sectionTypes: ['visit_us'] },
          ]);
      expect(result.pages.flatMap(page => page.sections.map(section => section.id)))
        .toEqual(source.pages.flatMap(page => page.sections.map(section => section.id)));
      expect(applyOnboardingSitePresentation(result, {
        aboutPreset: 'about_before_you_book',
        galleryLayout: 'carousel',
      })).toBe(result);

      const changedChoice = applyOnboardingSitePresentation(result, {
        aboutPreset: 'about_before_you_book',
        galleryLayout: 'editorial',
      });

      expect(changedChoice.pages.flatMap(page => page.sections)
        .filter(section => section.sectionType === 'gallery')
        .map(section => ({
          owner: section.galleryPresentationOwner,
          preset: section.settings.preset,
        })))
        .toEqual([{ owner: 'onboarding', preset: 'editorial' }]);
    },
  );

  it('uses stable provenance when the authoritative Gallery is renamed', () => {
    const source = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('renamed-gallery'),
    });
    const galleries = source.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');
    const gallery = galleries[0];
    if (!gallery) {
      throw new Error('Missing authoritative starter Gallery.');
    }
    expect(galleries).toHaveLength(1);
    expect(gallery.galleryPresentationOwner).toBe('onboarding');
    gallery.label = 'Portfolio';

    const result = applyOnboardingSitePresentation(source, {
      aboutPreset: 'photo_right',
      galleryLayout: 'carousel',
    });
    const resultGalleries = result.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');

    expect(resultGalleries).toEqual([
      expect.objectContaining({
        galleryPresentationOwner: 'onboarding',
        id: gallery.id,
        label: 'Portfolio',
        settings: expect.objectContaining({ preset: 'carousel' }),
      }),
    ]);
  });

  it('round-trips the exact multi-page recipe with one persisted Gallery owner', () => {
    const source = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('persisted-gallery-owner'),
    });
    const galleries = source.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');
    const gallery = galleries[0];
    if (!gallery) {
      throw new Error('Missing authoritative starter Gallery.');
    }
    expect(galleries).toHaveLength(1);
    gallery.label = 'Featured work';

    const imported = parseSiteBuilderDocument(JSON.stringify(source));

    expect(imported.success).toBe(true);

    if (!imported.success) {
      throw new Error(imported.issues.join(' '));
    }

    const result = applyOnboardingSitePresentation(imported.document, {
      aboutPreset: 'photo_right',
      galleryLayout: 'carousel',
    });
    const resultGalleries = result.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');

    expect(resultGalleries).toEqual([
      expect.objectContaining({
        galleryPresentationOwner: 'onboarding',
        id: gallery.id,
        label: 'Featured work',
        settings: expect.objectContaining({ preset: 'carousel' }),
      }),
    ]);
    expect(imported.document.pages.find(page => page.name === 'Gallery')?.sections)
      .toHaveLength(1);
  });

  it('preserves the sole active Gallery owner beside unrelated recoverable records', () => {
    const source = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('gallery-recoverable'),
    });
    const galleries = source.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');
    const gallery = galleries[0];
    const about = source.pages.flatMap(page => page.sections)
      .find(section => section.sectionType === 'about');
    if (!gallery || !about) {
      throw new Error('Missing starter sections.');
    }
    expect(galleries).toHaveLength(1);

    const restorableSection = {
      ...structuredClone(about),
      id: 'legacy-unrelated-restorable-section',
      order: 0,
    };
    source.unusedSections.push(restorableSection);
    source.removedPages.push({
      navigationItem: {
        id: 'legacy-unrelated-removed-navigation',
        label: 'Archived notes',
        order: source.navigation.items.length,
        pageId: 'legacy-unrelated-removed-page',
      },
      page: {
        id: 'legacy-unrelated-removed-page',
        isHome: false,
        name: 'Archived notes',
        order: source.pages.length,
        slug: 'archived-notes',
        visible: true,
        visibleInNavigation: true,
      },
      removedAtOrder: source.pages.length,
      sectionIds: [restorableSection.id],
    });

    const imported = parseSiteBuilderDocument(JSON.stringify(source));

    expect(imported.success).toBe(true);

    if (!imported.success) {
      throw new Error(imported.issues.join(' '));
    }

    const importedGalleries = imported.document.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');

    expect(importedGalleries.map(section => ({
      id: section.id,
      owner: section.galleryPresentationOwner,
    }))).toEqual([{ id: gallery.id, owner: 'onboarding' }]);
    expect(imported.document.unusedSections).toEqual([
      expect.objectContaining({
        id: restorableSection.id,
        sectionType: 'about',
      }),
    ]);
    expect(imported.document.unusedSections.some(section => (
      'galleryPresentationOwner' in section
    ))).toBe(false);
    expect(imported.document.removedPages).toEqual([
      expect.objectContaining({
        page: expect.objectContaining({ id: 'legacy-unrelated-removed-page' }),
        sectionIds: [restorableSection.id],
      }),
    ]);
  });

  it('carries frozen v1 Gallery roles through the placeholder upgrade', () => {
    const placeholder = (
      id: string,
      label: string,
      order: number,
      sectionType: 'section_02' | 'section_04',
    ) => ({
      id,
      label,
      order,
      placeholderSettings: {},
      sectionType,
      size: 'medium',
      visible: true,
    });
    const upgraded = upgradeSiteBuilderDocument({
      originStarter: 'multi_page',
      pages: [
        {
          sections: [placeholder('supporting', 'Portfolio', 1, 'section_02')],
          slug: '',
        },
        {
          sections: [placeholder('primary', 'Featured work', 0, 'section_04')],
          slug: 'gallery',
        },
      ],
      schemaVersion: 1,
      unusedSections: [],
    }) as {
      pages: Array<{
        sections: Array<{
          galleryPresentationOwner?: string;
          id: string;
          label: string;
          sectionType: string;
        }>;
      }>;
    };
    const galleries = upgraded.pages.flatMap(page => page.sections);

    // Historical v1 imported two Gallery responsibilities. This upgrade is
    // backward-compatible only; the current starter itself owns one Gallery.
    expect(initializeStarter('multi_page').pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery'))
      .toHaveLength(1);

    expect(galleries).toEqual([
      expect.objectContaining({
        galleryPresentationOwner: 'recipe',
        id: 'supporting',
        label: 'Portfolio',
        sectionType: 'gallery',
      }),
      expect.objectContaining({
        galleryPresentationOwner: 'onboarding',
        id: 'primary',
        label: 'Featured work',
        sectionType: 'gallery',
      }),
    ]);
  });

  it('preserves owner-added and authored-recipe Gallery layouts', () => {
    const ids = createDeterministicIdFactory('gallery-provenance');
    const starter = initializeStarter('one_page', { idFactory: ids });
    const home = starter.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }
    const withOwnerGallery = addSection(
      starter,
      { pageId: home.id, sectionType: 'gallery' },
      ids,
    );
    const ownerGallery = withOwnerGallery.pages[0]?.sections
      .filter(section => section.sectionType === 'gallery')
      .find(section => section.galleryPresentationOwner === undefined);
    if (!ownerGallery) {
      throw new Error('Missing owner-added Gallery.');
    }
    ownerGallery.settings.preset = 'editorial';

    const presentedStarter = applyOnboardingSitePresentation(withOwnerGallery, {
      aboutPreset: 'photo_right',
      galleryLayout: 'carousel',
    });

    expect(presentedStarter.pages[0]?.sections.find(
      section => section.id === ownerGallery.id,
    )).toMatchObject({ settings: { preset: 'editorial' } });

    const recipe = buildWebsiteRecipeDocument('gallery_forward');
    const presentedRecipe = applyOnboardingSitePresentation(recipe, {
      aboutPreset: 'photo_right',
      galleryLayout: 'carousel',
    });

    expect(presentedRecipe.pages[0]?.sections.find(
      section => section.sectionType === 'gallery',
    )).toMatchObject({
      galleryPresentationOwner: 'recipe',
      settings: { preset: 'editorial' },
    });
  });
});
