/**
 * The six website recipes are what an owner actually gets, so they are tested
 * as sites rather than as data. The visual matrix captures each recipe's home
 * page; nothing until now checked the pages behind it, and a multi-page
 * recipe whose Team or Gallery page publishes nothing would have shipped its
 * navigation entry pointing at an empty page.
 */

import { describe, expect, it } from 'vitest';

import { createDemoOnboardingState, DEMO_SITE_CONTENT } from '../../onboarding/model/demo-content';
import { deriveSiteLibraryContext } from '../../onboarding/model/site-library-context';
import { buildCustomerPagePlan } from '../site-plan';
import { validateSiteBuilderDocument } from '../validation';
import {
  buildWebsiteRecipeDocument,
  getRecipeRequiredToggles,
  WEBSITE_RECIPES,
} from './recipes';
import { getSectionRegistryEntry, isLibrarySection } from './registry';

const state = createDemoOnboardingState();

/** Sections that exist to compose a page, never to justify publishing one. */
const CHROME = new Set([
  'announcement_bar',
  'final_cta',
  'footer',
  'quick_info',
  'section_navigation',
]);

const planFor = (recipeId: (typeof WEBSITE_RECIPES)[number]['id']) => {
  const document = buildWebsiteRecipeDocument(recipeId, {
    siteContent: DEMO_SITE_CONTENT,
  });
  return {
    document,
    plan: buildCustomerPagePlan(document, {
      context: deriveSiteLibraryContext(state, document),
      // A recipe is applied with the toggles its own pages need; without
      // them, onboarding's optional-content gates drop the very pages the
      // recipe exists to lay out.
      toggles: getRecipeRequiredToggles(recipeId),
    }),
  };
};

describe('website recipes are complete sites', () => {
  it.each(WEBSITE_RECIPES.map(recipe => [recipe.id, recipe.name] as const))(
    '%s publishes every page it declares',
    (recipeId) => {
      const { document, plan } = planFor(recipeId);

      // Every page the recipe declares survives to the plan. A dropped page
      // is not a rendering detail: its navigation entry goes with it, and the
      // owner is left with a site that is missing a section of their story.
      expect(plan.map(page => page.slug).sort())
        .toEqual(document.pages.map(page => page.slug).sort());

      for (const page of plan) {
        const substantive = page.sections.filter(
          section => !CHROME.has(section.sectionType),
        );

        expect(
          substantive.length,
          `${recipeId} page "${page.label}" publishes only chrome`,
        ).toBeGreaterThan(0);
      }
    },
  );

  it.each(WEBSITE_RECIPES.map(recipe => [recipe.id] as const))(
    '%s carries no section that gates itself away',
    (recipeId) => {
      const { document } = planFor(recipeId);
      const context = deriveSiteLibraryContext(state, document);

      // The demo studio has filled in every shared authority, so a section a
      // recipe chose should have something to say. One that reports `empty`
      // here is a recipe asking for a section its own content cannot fill.
      // Sections whose copy is authored in the section itself start empty by
      // design — the owner writes the announcement, it is not derived from
      // anything the studio has already told us.
      const authoredInSection = new Set(['announcement_bar']);
      const empties = document.pages.flatMap(page => page.sections
        .filter(isLibrarySection)
        .filter(section => !authoredInSection.has(section.sectionType))
        .filter((section) => {
          const entry = getSectionRegistryEntry(section.sectionType);
          return entry.readiness(section.settings as never, context).level === 'empty';
        })
        .map(section => `${page.slug}/${section.sectionType}`));

      expect(empties).toEqual([]);
    },
  );

  it('every recipe builds a document the validator accepts', () => {
    for (const recipe of WEBSITE_RECIPES) {
      const document = buildWebsiteRecipeDocument(recipe.id, {
        siteContent: DEMO_SITE_CONTENT,
      });

      expect(
        validateSiteBuilderDocument(document).success,
        `${recipe.id} failed document validation`,
      ).toBe(true);
    }
  });

  it('marks explicitly-authored recipe Galleries as recipe-owned', () => {
    const document = buildWebsiteRecipeDocument('gallery_forward', {
      siteContent: DEMO_SITE_CONTENT,
    });
    const gallery = document.pages.flatMap(page => page.sections)
      .find(section => section.sectionType === 'gallery');

    expect(gallery).toMatchObject({
      galleryPresentationOwner: 'recipe',
      settings: { preset: 'editorial' },
    });
  });
});
