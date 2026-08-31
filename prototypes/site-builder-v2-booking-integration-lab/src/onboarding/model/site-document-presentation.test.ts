import { createDeterministicIdFactory } from '../../model/ids';
import { addSection } from '../../model/operations';
import { buildWebsiteRecipeDocument } from '../../model/section-library/recipes';
import { upgradeSiteBuilderDocument } from '../../model/section-library/upgrade';
import { initializeStarter } from '../../model/starters';
import { parseSiteBuilderDocument } from '../../model/validation';
import { applyOnboardingSitePresentation } from './site-document-presentation';

describe('onboarding site presentation ownership', () => {
  it.each(['one_page', 'multi_page'] as const)(
    'immutably stamps non-default About and Gallery choices into %s',
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
        .toEqual(starter === 'one_page'
          ? ['about_before_you_book']
          : ['about_before_you_book']);

      const galleries = result.pages.flatMap(page => page.sections)
        .filter(section => section.sectionType === 'gallery');

      expect(galleries.find(
        section => section.galleryPresentationOwner === 'recipe',
      )?.settings.preset)
        .toBe(starter === 'multi_page' ? 'editorial' : undefined);
      expect(galleries.filter(
        section => section.galleryPresentationOwner === 'onboarding',
      )
        .map(section => section.settings.preset))
        .toEqual(['carousel']);
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
        .find(section => section.galleryPresentationOwner === 'onboarding')
        ?.settings.preset)
        .toBe('editorial');
      expect(changedChoice.pages.flatMap(page => page.sections)
        .filter(section => section.sectionType === 'gallery')
        .find(section => section.galleryPresentationOwner === 'recipe')
        ?.settings.preset)
        .toBe(starter === 'multi_page' ? 'editorial' : undefined);
    },
  );

  it('uses stable provenance when Gallery labels are renamed or exchanged', () => {
    const source = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('renamed-gallery'),
    });
    const galleries = source.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');
    const supporting = galleries.find(
      section => section.galleryPresentationOwner === 'recipe',
    );
    const primary = galleries.find(
      section => section.galleryPresentationOwner === 'onboarding',
    );
    if (!supporting || !primary) {
      throw new Error('Missing starter Galleries.');
    }
    supporting.label = 'Portfolio';
    primary.label = 'Featured work';

    const result = applyOnboardingSitePresentation(source, {
      aboutPreset: 'photo_right',
      galleryLayout: 'carousel',
    });
    const resultGalleries = result.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');

    expect(resultGalleries.find(section => section.id === supporting.id))
      .toMatchObject({ label: 'Portfolio', settings: { preset: 'editorial' } });
    expect(resultGalleries.find(section => section.id === primary.id))
      .toMatchObject({ label: 'Featured work', settings: { preset: 'carousel' } });
  });

  it('normalizes untouched legacy-v2 starter ownership without label inference', () => {
    const legacy = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('legacy-gallery-owner'),
    });
    const galleries = legacy.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');
    const homeGallery = galleries[0];
    const pageGallery = galleries[1];
    if (!homeGallery || !pageGallery) {
      throw new Error('Missing starter Galleries.');
    }
    delete homeGallery.galleryPresentationOwner;
    delete pageGallery.galleryPresentationOwner;
    homeGallery.label = 'Portfolio';
    pageGallery.label = 'Featured work';

    const imported = parseSiteBuilderDocument(JSON.stringify(legacy));

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

    expect(resultGalleries.find(section => section.id === homeGallery.id))
      .toMatchObject({
        galleryPresentationOwner: 'recipe',
        label: 'Portfolio',
        settings: { preset: 'editorial' },
      });
    expect(resultGalleries.find(section => section.id === pageGallery.id))
      .toMatchObject({
        galleryPresentationOwner: 'onboarding',
        label: 'Featured work',
        settings: { preset: 'carousel' },
      });
  });

  it('normalizes the intact active starter despite unrelated recoverable records', () => {
    const legacy = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('legacy-gallery-recoverable'),
    });
    const galleries = legacy.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');
    const homeGallery = galleries[0];
    const pageGallery = galleries[1];
    const about = legacy.pages.flatMap(page => page.sections)
      .find(section => section.sectionType === 'about');
    if (!homeGallery || !pageGallery || !about) {
      throw new Error('Missing starter sections.');
    }
    delete homeGallery.galleryPresentationOwner;
    delete pageGallery.galleryPresentationOwner;

    const restorableSection = {
      ...structuredClone(about),
      id: 'legacy-unrelated-restorable-section',
      order: 0,
    };
    legacy.unusedSections.push(restorableSection);
    legacy.removedPages.push({
      navigationItem: {
        id: 'legacy-unrelated-removed-navigation',
        label: 'Archived notes',
        order: legacy.navigation.items.length,
        pageId: 'legacy-unrelated-removed-page',
      },
      page: {
        id: 'legacy-unrelated-removed-page',
        isHome: false,
        name: 'Archived notes',
        order: legacy.pages.length,
        slug: 'archived-notes',
        visible: true,
        visibleInNavigation: true,
      },
      removedAtOrder: legacy.pages.length,
      sectionIds: [restorableSection.id],
    });

    const imported = parseSiteBuilderDocument(JSON.stringify(legacy));

    expect(imported.success).toBe(true);

    if (!imported.success) {
      throw new Error(imported.issues.join(' '));
    }

    const importedGalleries = imported.document.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');

    expect(importedGalleries.map(section => ({
      id: section.id,
      owner: section.galleryPresentationOwner,
    }))).toEqual([
      { id: homeGallery.id, owner: 'recipe' },
      { id: pageGallery.id, owner: 'onboarding' },
    ]);
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
