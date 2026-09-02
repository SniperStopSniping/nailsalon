import { withoutFeaturedServicesRail } from '../booking/presentation';
import { normalizeDocument } from './normalize';
import {
  isLibrarySection,
  type SiteLibraryContext,
} from './section-library/registry';
import type { SitePlanOptionalToggles } from './site-plan';
import {
  createBookingSectionInstance,
  createLibrarySectionInstance,
  getSectionLabel,
} from './starters';
import type {
  IdFactory,
  LibrarySectionType,
  NavigationItem,
  OriginStarter,
  PageDocument,
  SectionInstance,
  SectionType,
  SiteBuilderDocument,
} from './types';

export const V1_STARTER_RECIPE_VERSION = 2 as const;
export const V1_STARTER_COMPILER_VERSION = 2 as const;

export type V1StarterRecipeMigrationResult =
  | 'fresh_v1'
  | 'migrated_legacy_recipe'
  | 'preserved_manual_edits';

export type V1StarterRecipeReconciliation = {
  compilerVersion: typeof V1_STARTER_COMPILER_VERSION;
  document: SiteBuilderDocument;
  migrationResult: V1StarterRecipeMigrationResult;
  recipeVersion: typeof V1_STARTER_RECIPE_VERSION;
};

export type V1StarterRecipeContext = {
  context: SiteLibraryContext;
  toggles: SitePlanOptionalToggles;
};

type DesiredSection = {
  label?: string;
  presetId?: string;
  type: LibrarySectionType | 'booking';
};

type DesiredPage = {
  name: string;
  sections: DesiredSection[];
  slug: string;
};

const V1_CORE_TYPES = new Set<SectionType>([
  'about',
  'booking',
  'gallery',
  'hero',
  'policies',
  'reviews',
  'team',
  'visit_us',
]);

const LEGACY_RECIPE_SHAPES: Record<OriginStarter, readonly {
  name: string;
  slug: string;
  types: readonly SectionType[];
}[]> = {
  quick_book: [{
    name: 'Home',
    slug: '',
    types: ['announcement_bar', 'hero', 'featured_services', 'booking', 'final_cta', 'footer'],
  }],
  one_page: [{
    name: 'Home',
    slug: '',
    types: [
      'announcement_bar',
      'hero',
      'quick_info',
      'section_navigation',
      'about',
      'featured_services',
      'gallery',
      'reviews',
      'deposits_cancellations',
      'policies',
      'visit_us',
      'booking',
      'final_cta',
      'footer',
    ],
  }],
  multi_page: [
    {
      name: 'Home',
      slug: '',
      types: [
        'announcement_bar',
        'hero',
        'quick_info',
        'featured_services',
        'gallery',
        'reviews',
        'final_cta',
        'footer',
      ],
    },
    {
      name: 'Services / Book',
      slug: 'services-book',
      types: ['booking', 'deposits_cancellations', 'policies', 'faq', 'footer'],
    },
    { name: 'Gallery', slug: 'gallery', types: ['gallery', 'final_cta', 'footer'] },
    { name: 'Team', slug: 'team', types: ['team', 'about', 'footer'] },
    { name: 'Contact', slug: 'contact', types: ['visit_us', 'hours', 'contact', 'footer'] },
  ],
};

const LEGACY_CUSTOM_SECTION_LABELS: Readonly<Record<string, readonly string[]>> = {
  'multi_page::1': ['Welcome'],
  'multi_page::4': ['Featured work'],
  'one_page::1': ['Welcome'],
  'quick_book::1': ['Salon intro'],
};

const isDefaultLegacyOnlySection = (section: SectionInstance): boolean => {
  if (V1_CORE_TYPES.has(section.sectionType) || section.sectionType === 'booking') {
    return true;
  }
  if (!isLibrarySection(section)) {
    return false;
  }
  const fresh = createLibrarySectionInstance(section.sectionType, () => 'legacy-default');
  if (!isLibrarySection(fresh)) {
    return false;
  }
  return JSON.stringify(section.settings) === JSON.stringify(fresh.settings);
};

const matchesLegacyRecipe = (document: SiteBuilderDocument): boolean => {
  const expected = LEGACY_RECIPE_SHAPES[document.originStarter];
  const pages = [...document.pages].sort((left, right) => left.order - right.order);
  if (document.unusedSections.length > 0 || document.removedPages.length > 0) {
    return false;
  }
  return pages.length === expected.length && expected.every((shape, index) => {
    const page = pages[index];
    if (
      !page
      || page.name !== shape.name
      || page.slug !== shape.slug
      || page.order !== index
      || page.isHome !== (index === 0)
      || !page.visible
      || !page.visibleInNavigation
    ) {
      return false;
    }
    const orderedSections = [...page.sections].sort((left, right) => left.order - right.order);
    if (orderedSections.some((section, sectionIndex) => (
      section.order !== sectionIndex || !section.visible
    ))) {
      return false;
    }
    // Custom Design is an onboarding-owned media surface and may sit on
    // either side of Booking. It does not make an otherwise untouched legacy
    // recipe a manual Builder composition.
    const sections = orderedSections.filter(section => section.sectionType !== 'custom_design');
    return sections.length === shape.types.length
      && sections.every((section, sectionIndex) => {
        const type = shape.types[sectionIndex];
        if (section.sectionType !== type) {
          return false;
        }
        const allowedLabels = new Set([
          getSectionLabel(section.sectionType),
          ...(LEGACY_CUSTOM_SECTION_LABELS[`${document.originStarter}:${shape.slug}:${sectionIndex}`]
            ?? []),
        ]);
        return allowedLabels.has(section.label) && isDefaultLegacyOnlySection(section);
      });
  });
};

const matchesOptionalProfile = (type: SectionType | undefined): boolean =>
  type === 'about' || type === 'team';

/**
 * Quick Book v1 spread the shared salon profile across About and Visit after
 * Booking. It is an onboarding-owned shape, so v2 can safely collapse those
 * duplicate presentation slots into the profile Hero while preserving their
 * shared profile data.
 */
const matchesQuickBookV1Types = (types: readonly SectionType[]): boolean => {
  let cursor = 0;
  if (types[cursor++] !== 'hero') {
    return false;
  }
  if (types[cursor] === 'gallery') {
    cursor += 1;
  }
  if (types[cursor++] !== 'booking') {
    return false;
  }
  if (matchesOptionalProfile(types[cursor])) {
    cursor += 1;
  }
  return types[cursor++] === 'visit_us' && cursor === types.length;
};

const matchesQuickBookV2Types = (types: readonly SectionType[]): boolean => {
  let cursor = 0;
  if (types[cursor++] !== 'hero' || types[cursor++] !== 'booking') {
    return false;
  }
  if (types[cursor] === 'gallery') {
    cursor += 1;
  }
  return cursor === types.length;
};

const matchesOnePageV1Types = (types: readonly SectionType[]): boolean => {
  let cursor = 0;
  if (types[cursor++] !== 'hero') {
    return false;
  }
  if (types[cursor] === 'gallery') {
    cursor += 1;
  }
  if (matchesOptionalProfile(types[cursor])) {
    cursor += 1;
  }
  if (types[cursor++] !== 'booking') {
    return false;
  }
  if (types[cursor] === 'reviews') {
    cursor += 1;
  }
  if (types[cursor] === 'policies') {
    cursor += 1;
  }
  return types[cursor++] === 'visit_us' && cursor === types.length;
};

const coreTypesOn = (page: PageDocument): SectionType[] => page.sections
  .filter(section => section.sectionType !== 'custom_design')
  .map(section => section.sectionType);

const matchesCompilerOwnedLabel = (
  document: SiteBuilderDocument,
  page: PageDocument,
  section: SectionInstance,
): boolean => {
  if (section.sectionType === 'custom_design') {
    return true;
  }
  if (section.sectionType === 'hero') {
    return section.label === (document.originStarter === 'quick_book'
      ? 'Salon intro'
      : 'Welcome');
  }
  if (section.sectionType === 'visit_us') {
    return section.label === 'Visit & Contact';
  }
  // Page identity is checked separately. All other compiler-owned sections
  // keep their canonical registry label; a changed label is a deliberate
  // Builder edit and must stop automatic recipe reconciliation.
  void page;
  return section.label === getSectionLabel(section.sectionType);
};

/**
 * A V1 document remains compiler-owned only while its exact product slots are
 * intact. Reorder, hide, remove, restore-bin, page-name, or page-structure
 * changes are deliberate Builder edits and therefore stop automatic recipe
 * reconciliation. Custom Design may remain around Booking because onboarding
 * owns that transactional placement separately.
 */
const matchesV1RecipeShape = (document: SiteBuilderDocument): boolean => {
  if (document.unusedSections.length > 0 || document.removedPages.length > 0) {
    return false;
  }
  const pages = [...document.pages].sort((left, right) => left.order - right.order);
  if (pages.some((page, index) => (
    page.order !== index
    || page.isHome !== (index === 0)
    || !page.visible
    || !page.visibleInNavigation
    || page.sections.some((section, sectionIndex) => (
      section.order !== sectionIndex
      || !section.visible
      || !matchesCompilerOwnedLabel(document, page, section)
      || (
        section.sectionType !== 'custom_design'
        && !V1_CORE_TYPES.has(section.sectionType)
      )
    ))
  ))) {
    return false;
  }

  if (document.originStarter === 'quick_book') {
    const home = pages[0];
    return pages.length === 1
      && home?.name === 'Home'
      && home.slug === ''
      && (
        matchesQuickBookV2Types(coreTypesOn(home))
        || matchesQuickBookV1Types(coreTypesOn(home))
      );
  }
  if (document.originStarter === 'one_page') {
    const home = pages[0];
    return pages.length === 1
      && home?.name === 'Home'
      && home.slug === ''
      && matchesOnePageV1Types(coreTypesOn(home));
  }

  const expectedPages = [
    { name: 'Home', slug: '', types: (types: readonly SectionType[]) => (
      types.length === 1 || (types.length === 2 && types[1] === 'reviews')
    ) && types[0] === 'hero' },
    { name: 'Services & Booking', slug: 'services-book', types: (types: readonly SectionType[]) => (
      types[0] === 'booking'
      && (types.length === 1 || (types.length === 2 && types[1] === 'policies'))
    ) },
    { name: 'Gallery', slug: 'gallery', types: (types: readonly SectionType[]) => (
      types.length === 1 && types[0] === 'gallery'
    ) },
    { name: 'About', slug: 'about', types: (types: readonly SectionType[]) => (
      types.length === 0 || (types.length === 1 && matchesOptionalProfile(types[0]))
    ) },
    { name: 'Contact', slug: 'contact', types: (types: readonly SectionType[]) => (
      types.length === 1 && types[0] === 'visit_us'
    ) },
  ] as const;
  return pages.length === expectedPages.length && expectedPages.every((expected, index) => {
    const page = pages[index];
    return page?.name === expected.name
      && page.slug === expected.slug
      && expected.types(coreTypesOn(page));
  });
};

const hasRealReviews = (
  document: SiteBuilderDocument,
  context: SiteLibraryContext,
): boolean => {
  const visibleIds = new Set(
    context.siteContent.reviews.filter(review => review.visible).map(review => review.id),
  );
  return document.pages.some(page => page.sections.some(section => (
    section.sectionType === 'reviews'
    && section.settings.reviewIds.some(id => visibleIds.has(id))
  )));
};

const desiredRecipe = (
  document: SiteBuilderDocument,
  input: V1StarterRecipeContext,
): DesiredPage[] => {
  const { context, toggles } = input;
  const profileType: LibrarySectionType = context.businessStructure === 'multi_tech'
    ? 'team'
    : 'about';
  const profile = toggles.aboutEnabled
    ? [{ type: profileType } satisfies DesiredSection]
    : [];
  const reviews = hasRealReviews(document, context)
    ? [{ type: 'reviews' as const }]
    : [];
  const policies = toggles.policiesEnabled && context.policiesMeaningful
    ? [{ type: 'policies' as const }]
    : [];

  if (document.originStarter === 'quick_book') {
    const gallery = toggles.galleryEnabled && context.galleryImageIds.length > 0
      ? [{ presetId: 'carousel', type: 'gallery' as const }]
      : [];
    return [{
      name: 'Home',
      sections: [
        { label: 'Salon intro', presetId: 'booking_first', type: 'hero' },
        { type: 'booking' },
        ...gallery,
      ],
      slug: '',
    }];
  }

  if (document.originStarter === 'one_page') {
    return [{
      name: 'Home',
      sections: [
        { label: 'Welcome', type: 'hero' },
        ...(toggles.galleryEnabled ? [{ type: 'gallery' as const }] : []),
        ...profile,
        { type: 'booking' },
        ...reviews,
        ...policies,
        { label: 'Visit & Contact', type: 'visit_us' },
      ],
      slug: '',
    }];
  }

  return [
    { name: 'Home', sections: [{ label: 'Welcome', type: 'hero' }, ...reviews], slug: '' },
    {
      name: 'Services & Booking',
      sections: [{ type: 'booking' }, ...policies],
      slug: 'services-book',
    },
    { name: 'Gallery', sections: [{ type: 'gallery' }], slug: 'gallery' },
    { name: 'About', sections: profile, slug: 'about' },
    {
      name: 'Contact',
      sections: [{ label: 'Visit & Contact', type: 'visit_us' }],
      slug: 'contact',
    },
  ];
};

const sectionCandidates = (document: SiteBuilderDocument): SectionInstance[] =>
  document.pages.flatMap(page => [...page.sections].sort((left, right) => left.order - right.order));

const reuseCandidatesFor = (
  desiredType: DesiredSection['type'],
  candidates: readonly SectionInstance[],
  preferredCandidates: readonly SectionInstance[],
  usedIds: ReadonlySet<string>,
): SectionInstance | null => {
  const findExact = (pool: readonly SectionInstance[]) => pool.find(section => (
    section.sectionType === desiredType && !usedIds.has(section.id)
  ));
  const exact = findExact(preferredCandidates) ?? findExact(candidates);
  if (exact) {
    return exact;
  }
  const compatibleTypes: Partial<Record<DesiredSection['type'], readonly SectionType[]>> = {
    about: ['team'],
    policies: ['deposits_cancellations'],
    team: ['about'],
    visit_us: ['contact'],
  };
  const findCompatible = (pool: readonly SectionInstance[]) => pool.find(section => (
    compatibleTypes[desiredType]?.includes(section.sectionType)
    && !usedIds.has(section.id)
  ));
  return findCompatible(preferredCandidates) ?? findCompatible(candidates) ?? null;
};

const createDesiredSection = (
  document: SiteBuilderDocument,
  pageSlug: string,
  desired: DesiredSection,
  order: number,
  candidates: readonly SectionInstance[],
  preferredCandidates: readonly SectionInstance[],
  usedIds: Set<string>,
): SectionInstance => {
  const candidate = reuseCandidatesFor(
    desired.type,
    candidates,
    preferredCandidates,
    usedIds,
  );
  const stableId = candidate?.id
    ?? `${document.siteId}:recipe-v${V1_STARTER_RECIPE_VERSION}:${pageSlug || 'home'}:${desired.type}`;
  usedIds.add(stableId);

  if (candidate?.sectionType === desired.type) {
    if (
      candidate.sectionType === 'booking'
      && candidate.settings.layout === 'visual_grid'
    ) {
      return {
        ...candidate,
        order,
        settings: withoutFeaturedServicesRail(candidate.settings),
        visible: true,
      };
    }
    return {
      ...candidate,
      ...(desired.label ? { label: desired.label } : {}),
      order,
      visible: true,
    } as SectionInstance;
  }

  const idFactory: IdFactory = () => stableId;
  if (desired.type === 'booking') {
    return createBookingSectionInstance(idFactory, { order, showFeatured: false });
  }
  return createLibrarySectionInstance(desired.type, idFactory, {
    ...(desired.type === 'gallery'
      ? { galleryPresentationOwner: 'onboarding' as const }
      : {}),
    ...(desired.label ? { label: desired.label } : {}),
    order,
    ...(desired.presetId ? { presetId: desired.presetId } : {}),
  });
};

const pageForDesired = (
  document: SiteBuilderDocument,
  slug: string,
): PageDocument | null => document.pages.find(page => (
  page.slug === slug
  || (slug === 'about' && page.slug === 'team')
)) ?? null;

/**
 * Reconciles only untouched legacy starter shapes or documents already using
 * the V1 core vocabulary. An advanced/manually composed document is returned
 * byte-for-byte so onboarding never silently deletes deliberate Builder work.
 */
export const reconcileV1StarterDocument = (
  document: SiteBuilderDocument,
  input: V1StarterRecipeContext,
): V1StarterRecipeReconciliation => {
  const legacy = matchesLegacyRecipe(document);
  const quickBookHome = document.pages.find(page => page.isHome);
  const quickBookV1 = document.originStarter === 'quick_book'
    && matchesV1RecipeShape(document)
    && quickBookHome !== undefined
    && matchesQuickBookV1Types(coreTypesOn(quickBookHome));
  if (!legacy && !matchesV1RecipeShape(document)) {
    return {
      compilerVersion: V1_STARTER_COMPILER_VERSION,
      document,
      migrationResult: 'preserved_manual_edits',
      recipeVersion: V1_STARTER_RECIPE_VERSION,
    };
  }

  const candidates = sectionCandidates(document);
  const usedIds = new Set<string>();
  const desiredPages = desiredRecipe(document, input);
  const pages = desiredPages.map((desiredPage, pageOrder): PageDocument => {
    const existing = pageForDesired(document, desiredPage.slug);
    const defaultPageId = `${document.siteId}:recipe-v${V1_STARTER_RECIPE_VERSION}:${desiredPage.slug || 'home'}:page`;
    const desiredSections = desiredPage.sections.map((desired, order) =>
      createDesiredSection(
        document,
        desiredPage.slug,
        desired,
        order,
        candidates,
        existing?.sections ?? [],
        usedIds,
      ));
    const customDesignSections = existing?.sections
      .filter(section => section.sectionType === 'custom_design')
      .filter(section => !usedIds.has(section.id)) ?? [];
    const previousBookingOrder = existing?.sections.find(
      section => section.sectionType === 'booking',
    )?.order ?? Number.POSITIVE_INFINITY;
    for (const custom of customDesignSections) {
      usedIds.add(custom.id);
    }
    const bookingIndex = desiredSections.findIndex(section => section.sectionType === 'booking');
    const beforeBooking = customDesignSections.filter(section => section.order < previousBookingOrder);
    const afterBooking = customDesignSections.filter(section => section.order >= previousBookingOrder);
    const sections = bookingIndex < 0
      ? [...desiredSections, ...customDesignSections]
      : [
          ...desiredSections.slice(0, bookingIndex),
          ...beforeBooking,
          desiredSections[bookingIndex] as SectionInstance,
          ...afterBooking,
          ...desiredSections.slice(bookingIndex + 1),
        ];
    return {
      id: existing?.id ?? defaultPageId,
      isHome: pageOrder === 0,
      name: desiredPage.name,
      order: pageOrder,
      sections: sections.map((section, order) => ({ ...section, order } as SectionInstance)),
      slug: desiredPage.slug,
      visible: true,
      visibleInNavigation: true,
    };
  });
  const navigationItems: NavigationItem[] = pages.map((page, order) => {
    const existing = document.navigation.items.find(item => item.pageId === page.id);
    return {
      id: existing?.id
        ?? `${document.siteId}:recipe-v${V1_STARTER_RECIPE_VERSION}:${page.slug || 'home'}:navigation`,
      label: page.name,
      order,
      pageId: page.id,
    };
  });
  const preservedUnused = document.unusedSections.filter(section => (
    section.sectionType === 'custom_design' || V1_CORE_TYPES.has(section.sectionType)
  ));
  const reconciled = normalizeDocument({
    ...document,
    navigation: {
      enabled: document.originStarter !== 'quick_book',
      items: navigationItems,
      style: 'simple',
    },
    pages,
    unusedSections: preservedUnused,
  });
  return {
    compilerVersion: V1_STARTER_COMPILER_VERSION,
    document: reconciled,
    migrationResult: legacy || quickBookV1 ? 'migrated_legacy_recipe' : 'fresh_v1',
    recipeVersion: V1_STARTER_RECIPE_VERSION,
  };
};
