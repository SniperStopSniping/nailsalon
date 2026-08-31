/**
 * Six complete website recipes composed entirely from registered sections.
 *
 * Recipes 1–3 ARE the three starters (one definition, zero drift). Recipes
 * 4–6 demonstrate the library's range for real salon archetypes. A recipe
 * builds a full, valid v2 document; when `siteContent` is supplied, the
 * content-bound sections (team/reviews/offers/faq) are bound to those record
 * ids so demonstration renders are populated.
 */

import type { SitePlanOptionalToggles } from '../site-plan';
import type {
  IdFactory,
  LibrarySectionType,
  OriginStarter,
  PageDocument,
  SectionInstance,
  SiteBuilderDocument,
} from '../types';
import { validateSiteBuilderDocument } from '../validation';
import {
  createBookingSectionInstance,
  createLibrarySectionInstance,
  initializeStarter,
} from '../starters';
import { getSectionRegistryEntry } from './registry';
import type { SiteContentCollections } from './site-content';
import { createEmptySiteContent } from './site-content';

export type WebsiteRecipeId =
  | 'quick_book'
  | 'signature_one_page'
  | 'the_collective'
  | 'solo_editorial'
  | 'promo_led'
  | 'gallery_forward';

type RecipeSectionSpec = {
  type: LibrarySectionType | 'booking';
  preset?: string;
  label?: string;
};

type RecipePageSpec = {
  name: string;
  slug: string;
  sections: RecipeSectionSpec[];
};

export type WebsiteRecipe = {
  id: WebsiteRecipeId;
  name: string;
  description: string;
  audience: string;
  /** Style/palette pairing the recipe was designed against (advisory only). */
  recommendedStyle: string;
  recommendedPalette: string;
  /** The starter whose chrome behavior (navigation mode) the document uses. */
  originStarter: OriginStarter;
  pages: RecipePageSpec[] | null;
};

export type BuildRecipeOptions = {
  idFactory?: IdFactory;
  siteContent?: SiteContentCollections;
};

const createRecipeIdFactory = (recipeId: string): IdFactory => {
  let counter = 0;
  return kind => `recipe-${recipeId}-${kind}-${counter++}`;
};

/** Record-binding overrides applied when demo/site content is supplied. */
const boundSettingsFor = (
  type: LibrarySectionType,
  siteContent: SiteContentCollections,
): Record<string, unknown> | null => {
  if (type === 'team') {
    return { memberIds: siteContent.staff.map(member => member.id) };
  }
  if (type === 'reviews') {
    return { reviewIds: siteContent.reviews.map(review => review.id) };
  }
  if (type === 'offers') {
    return { offerIds: siteContent.offers.map(offer => offer.id) };
  }
  if (type === 'faq') {
    return { itemIds: siteContent.faq.map(item => item.id) };
  }
  return null;
};

const bindSectionContent = (
  section: SectionInstance,
  siteContent: SiteContentCollections,
): SectionInstance => {
  if (
    section.sectionType !== 'team'
    && section.sectionType !== 'reviews'
    && section.sectionType !== 'offers'
    && section.sectionType !== 'faq'
  ) {
    return section;
  }
  const entry = getSectionRegistryEntry(section.sectionType);
  const bound = boundSettingsFor(section.sectionType, siteContent);
  if (!bound) return section;
  return {
    ...section,
    settings: entry.normalize({ ...section.settings, ...bound }),
  } as SectionInstance;
};

const buildRecipePages = (
  recipe: WebsiteRecipe,
  idFactory: IdFactory,
): PageDocument[] => {
  if (!recipe.pages) {
    throw new Error(`Recipe ${recipe.id} delegates to its starter.`);
  }
  return recipe.pages.map((pageSpec, pageOrder): PageDocument => ({
    id: idFactory('page'),
    isHome: pageOrder === 0,
    name: pageSpec.name,
    order: pageOrder,
    sections: pageSpec.sections.map((spec, order) =>
      spec.type === 'booking'
        ? createBookingSectionInstance(idFactory, { order })
        : createLibrarySectionInstance(spec.type, idFactory, {
            ...(spec.label !== undefined ? { label: spec.label } : {}),
            order,
            ...(spec.preset !== undefined ? { presetId: spec.preset } : {}),
          })),
    slug: pageSpec.slug,
    visible: true,
    visibleInNavigation: true,
  }));
};

export const WEBSITE_RECIPES: readonly WebsiteRecipe[] = [
  {
    audience: 'Solo tech who wants clients booking in under a minute.',
    description: 'The conversion-first one-pager: announcement, intro, featured services, the full booking engine, and a closing call to action.',
    id: 'quick_book',
    name: 'Quick Book',
    originStarter: 'quick_book',
    pages: null,
    recommendedPalette: 'luster_berry',
    recommendedStyle: 'modern',
  },
  {
    audience: 'Established studio that wants the full story on one page.',
    description: 'The flagship one-pager: every trust surface — about, gallery, reviews, policies, visit details — arranged around the booking engine.',
    id: 'signature_one_page',
    name: 'Signature',
    originStarter: 'one_page',
    pages: null,
    recommendedPalette: 'blush_cocoa',
    recommendedStyle: 'editorial',
  },
  {
    audience: 'Multi-tech salon with a team worth introducing.',
    description: 'The five-page studio site: home, services & booking, gallery, team, and contact — with page navigation.',
    id: 'the_collective',
    name: 'The Collective',
    originStarter: 'multi_page',
    pages: null,
    recommendedPalette: 'sage_stone',
    recommendedStyle: 'minimal',
  },
  {
    audience: 'Solo artist with a quiet, editorial sensibility.',
    description: 'A restrained single page: editorial hero and portrait, a curated service list, one standout quote, and compact practical details.',
    id: 'solo_editorial',
    name: 'Solo Editorial',
    originStarter: 'one_page',
    pages: [
      {
        name: 'Home',
        sections: [
          { preset: 'editorial_split', type: 'hero' },
          { preset: 'editorial_portrait', type: 'about' },
          { preset: 'editorial', type: 'featured_services' },
          { type: 'booking' },
          { preset: 'editorial_quote', type: 'reviews' },
          { type: 'faq' },
          { preset: 'compact_info', type: 'visit_us' },
          { preset: 'editorial_cta', type: 'final_cta' },
          { preset: 'compact', type: 'footer' },
        ],
        slug: '',
      },
    ],
    recommendedPalette: 'monochrome',
    recommendedStyle: 'editorial',
  },
  {
    audience: 'Salon that runs offers and wants urgency up front.',
    description: 'A promotion-led page: announcement with a booking action, current offers ahead of the menu, swipeable social proof, and clear deposit terms.',
    id: 'promo_led',
    name: 'Promo Led',
    originStarter: 'one_page',
    pages: [
      {
        name: 'Home',
        sections: [
          { type: 'announcement_bar' },
          { preset: 'booking_first', type: 'hero' },
          { preset: 'cards', type: 'offers' },
          { preset: 'carousel', type: 'featured_services' },
          { type: 'booking' },
          { preset: 'carousel', type: 'reviews' },
          { type: 'deposits_cancellations' },
          { type: 'hours' },
          { preset: 'action_row', type: 'contact' },
          { type: 'final_cta' },
          { type: 'footer' },
        ],
        slug: '',
      },
    ],
    recommendedPalette: 'terracotta_cream',
    recommendedStyle: 'bold',
  },
  {
    audience: 'Artist whose work sells itself — the site leads with imagery.',
    description: 'A gallery-forward page: full-bleed hero, editorial gallery, quick facts, curated services, the team, and an image-led closing CTA.',
    id: 'gallery_forward',
    name: 'Gallery Forward',
    originStarter: 'one_page',
    pages: [
      {
        name: 'Home',
        sections: [
          { preset: 'full_bleed', type: 'hero' },
          { preset: 'editorial', type: 'gallery' },
          { type: 'quick_info' },
          { preset: 'editorial', type: 'featured_services' },
          { type: 'booking' },
          { preset: 'swipeable', type: 'team' },
          { preset: 'map_details', type: 'visit_us' },
          { type: 'policies' },
          { preset: 'image_cta', type: 'final_cta' },
          { preset: 'columns', type: 'footer' },
        ],
        slug: '',
      },
    ],
    recommendedPalette: 'black_champagne',
    recommendedStyle: 'luxury',
  },
];

export const WEBSITE_RECIPE_BY_ID: Readonly<Record<WebsiteRecipeId, WebsiteRecipe>>
  = Object.fromEntries(WEBSITE_RECIPES.map(recipe => [recipe.id, recipe])) as
  Record<WebsiteRecipeId, WebsiteRecipe>;

/**
 * The optional-content toggles a recipe needs turned on to publish every page
 * it declares. Onboarding gates About, Gallery, Canva, and policies with
 * their own toggles in addition to readiness, so a recipe that lays out a
 * Gallery page while the owner's gallery toggle is off would lose that page
 * and its navigation entry without saying so.
 *
 * Derived from the recipe's own sections rather than declared beside them,
 * so it cannot drift from what the recipe actually contains.
 */
export const getRecipeRequiredToggles = (
  recipeId: WebsiteRecipeId,
): SitePlanOptionalToggles => {
  const recipe = WEBSITE_RECIPE_BY_ID[recipeId];
  const types = new Set<string>(
    recipe.pages === null
      ? initializeStarter(recipe.originStarter, { idFactory: createRecipeIdFactory(recipeId) })
        .pages.flatMap(page => page.sections.map(section => section.sectionType))
      : recipe.pages.flatMap(page => page.sections.map(section => section.type)),
  );
  return {
    aboutEnabled: types.has('about'),
    canvaEnabled: types.has('custom_design'),
    galleryEnabled: types.has('gallery'),
    policiesEnabled: types.has('policies') || types.has('deposits_cancellations'),
  };
};

export const buildWebsiteRecipeDocument = (
  recipeId: WebsiteRecipeId,
  options: BuildRecipeOptions = {},
): SiteBuilderDocument => {
  const recipe = WEBSITE_RECIPE_BY_ID[recipeId];
  const idFactory = options.idFactory ?? createRecipeIdFactory(recipeId);
  const siteContent = options.siteContent ?? createEmptySiteContent();

  const base = recipe.pages === null
    ? initializeStarter(recipe.originStarter, { idFactory })
    : {
        ...initializeStarter(recipe.originStarter, { idFactory }),
        pages: buildRecipePages(recipe, idFactory),
      };

  const withNavigation: SiteBuilderDocument = recipe.pages === null
    ? base
    : {
        ...base,
        navigation: {
          ...base.navigation,
          items: base.pages
            .filter(page => page.visibleInNavigation)
            .map((page, order) => ({
              id: idFactory('navigation_item'),
              label: page.name,
              order,
              pageId: page.id,
            })),
        },
      };

  const document: SiteBuilderDocument = {
    ...withNavigation,
    pages: withNavigation.pages.map(page => ({
      ...page,
      sections: page.sections.map(section =>
        bindSectionContent(section, siteContent)),
    })),
    siteContent,
    siteName: 'Isla Nail Studio',
  };

  const validated = validateSiteBuilderDocument(document);
  if (!validated.success) {
    throw new Error(
      `Recipe ${recipeId} built an invalid document: ${validated.issues.join(' ')}`,
    );
  }
  return validated.document;
};
