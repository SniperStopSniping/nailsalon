/**
 * Machine-checked composition matrix: every ORDERED pair of the 20 section
 * types (400 pairs) is planned through `buildCustomerPagePlan` with a fully
 * populated context, and the shared adjacency invariants are asserted on the
 * result. These are invariants of the composition system, not re-derived
 * expectations — a violated pair names itself in the failure message.
 */

import { describe, expect, it } from 'vitest';

import { createDefaultBookingPresentationSettings } from '../booking/presentation';
import { createDefaultCustomDesignSettings } from '../custom-design/model/settings';
import {
  createDemoOnboardingState,
  DEMO_SITE_CONTENT,
} from '../onboarding/model/demo-content';
import { deriveSiteLibraryContext } from '../onboarding/model/site-library-context';
import { buildCustomerPagePlan } from './site-plan';
import {
  getSectionRegistryEntry,
  isLibrarySectionType,
  SECTION_LIBRARY_REGISTRY,
} from './section-library/registry';
import { createLibrarySectionInstance, initializeStarter } from './starters';
import type {
  LibrarySectionType,
  SectionInstance,
  SiteBuilderDocument,
} from './types';

type MatrixTypeId = LibrarySectionType | 'booking' | 'custom_design';

const ALL_TYPES: MatrixTypeId[] = [
  ...(Object.keys(SECTION_LIBRARY_REGISTRY) as LibrarySectionType[]),
  'booking',
  'custom_design',
];

const TOGGLES = {
  aboutEnabled: true,
  canvaEnabled: true,
  galleryEnabled: true,
  policiesEnabled: true,
};

/** Demo-record bindings so content-bound sections carry populated settings. */
const BOUND_SETTINGS: Partial<Record<LibrarySectionType, Record<string, unknown>>> = {
  announcement_bar: { message: 'Now booking September appointments' },
  faq: { itemIds: DEMO_SITE_CONTENT.faq.map(item => item.id) },
  offers: { offerIds: DEMO_SITE_CONTENT.offers.map(offer => offer.id) },
  reviews: { reviewIds: DEMO_SITE_CONTENT.reviews.map(review => review.id) },
  team: { memberIds: DEMO_SITE_CONTENT.staff.map(member => member.id) },
};

const instanceOf = (type: MatrixTypeId, id: string, order: number): SectionInstance => {
  if (type === 'booking') {
    return {
      id,
      label: 'Booking',
      order,
      sectionType: 'booking',
      settings: createDefaultBookingPresentationSettings(),
      visible: true,
    };
  }
  if (type === 'custom_design') {
    return {
      id,
      label: 'Custom Design',
      order,
      sectionType: 'custom_design',
      settings: createDefaultCustomDesignSettings(),
      visible: true,
    };
  }
  const entry = getSectionRegistryEntry(type);
  return {
    ...createLibrarySectionInstance(type, () => id, { order }),
    id,
    settings: entry.normalize({
      ...entry.defaultSettings(),
      ...BOUND_SETTINGS[type],
    }),
  } as SectionInstance;
};

const pairDocument = (first: MatrixTypeId, second: MatrixTypeId): SiteBuilderDocument => {
  let counter = 0;
  const base = initializeStarter('quick_book', {
    idFactory: kind => `matrix-${kind}-${counter++}`,
  });
  const home = base.pages[0]!;
  return {
    ...base,
    pages: [{
      ...home,
      sections: [
        instanceOf(first, 'matrix-first', 0),
        instanceOf(second, 'matrix-second', 1),
      ],
    }],
    siteContent: DEMO_SITE_CONTENT,
  };
};

describe('ordered adjacency matrix (400 pairs)', () => {
  const state = createDemoOnboardingState();

  it.each(ALL_TYPES.map(type => [type] as const))(
    'plans every ordered pair starting with %s without violating composition invariants',
    (first) => {
      for (const second of ALL_TYPES) {
        const document = pairDocument(first, second);
        const context = deriveSiteLibraryContext(state, document);
        const plan = buildCustomerPagePlan(document, {
          context,
          includeOptionalSections: true,
          toggles: TOGGLES,
        });

        for (const page of plan) {
          for (const [index, section] of page.sections.entries()) {
            const label = `${first}→${second} (${section.sectionType} at ${index})`;
            const previous = index > 0 ? page.sections[index - 1] : undefined;

            // Invariant 1: two visible neighbours never both sit on 'tint'.
            if (previous) {
              expect(
                previous.surface === 'tint' && section.surface === 'tint',
                `tint seam at ${label}`,
              ).toBe(false);
            }

            // Invariant 2: attachment only ever comes from the previous
            // section's chrome or a contrast-band merge.
            if (section.attachedToPrevious) {
              const previousAttaches = previous !== undefined
                && isLibrarySectionType(previous.sectionType)
                && getSectionRegistryEntry(previous.sectionType).attachesToNext === true;
              const contrastMerge = previous !== undefined
                && previous.surface === 'contrast'
                && section.surface === 'contrast';
              expect(
                previousAttaches || contrastMerge,
                `unexplained attachment at ${label}`,
              ).toBe(true);
            }

            // Invariant 3: the first section of a page is never attached.
            if (index === 0) {
              expect(section.attachedToPrevious, `first-attached at ${label}`).toBe(false);
            }
          }

          // Invariant 4: rendered order preserves document order.
          const renderedIds = page.sections
            .filter(section => !section.injected)
            .map(section => section.id);
          const documentOrder = ['matrix-first', 'matrix-second']
            .filter(id => renderedIds.includes(id));
          expect(renderedIds.filter(id => id.startsWith('matrix-'))).toEqual(documentOrder);
        }
      }
    },
  );

  it('keeps readiness honest: a deposit amount alone does not publish', () => {
    // A fixed deposit with no visible wording renders nothing, so readiness
    // must not claim the section is ready to publish. `policiesMeaningful` is
    // deliberately true throughout: it is satisfied by policy topics this
    // section cannot draw, so it must not be what decides this.
    const entry = SECTION_LIBRARY_REGISTRY.deposits_cancellations;
    const withAmountOnly = {
      ...deriveSiteLibraryContext(state, pairDocument('hero', 'booking')),
      depositMode: 'fixed' as const,
      depositsSummaryPublishable: false,
      depositsWordingPublishable: false,
      policiesMeaningful: true,
    };
    expect(entry.readiness(entry.defaultSettings(), withAmountOnly).level)
      .toBe('empty');

    // Either wording the renderer can choose is enough on its own, and each
    // is only honoured in the mode that actually uses it.
    const summarySettings = entry.normalize({
      ...entry.defaultSettings(),
      wordingMode: 'summary',
    });
    const fullSettings = entry.normalize({
      ...entry.defaultSettings(),
      wordingMode: 'full',
    });
    const withSummary = { ...withAmountOnly, depositsSummaryPublishable: true };
    const withWording = { ...withAmountOnly, depositsWordingPublishable: true };

    expect(entry.readiness(summarySettings, withSummary).level).toBe('ready');
    expect(entry.readiness(fullSettings, withSummary).level).toBe('empty');
    expect(entry.readiness(fullSettings, withWording).level).toBe('ready');
    expect(entry.readiness(summarySettings, withWording).level).toBe('ready');
  });

  it('keeps Before You Book honest: only ticked topics with wording publish', () => {
    const entry = SECTION_LIBRARY_REGISTRY.policies;
    const base = {
      ...deriveSiteLibraryContext(state, pairDocument('hero', 'booking')),
      policiesMeaningful: true,
    };
    const settings = entry.normalize({
      ...entry.defaultSettings(),
      includedSections: ['repairs'],
    });

    // The topic the owner ticked is the only one that counts, even when
    // another topic has wording — the renderer draws exactly the ticked set.
    expect(entry.readiness(settings, {
      ...base,
      availablePolicyTopics: ['late_arrivals'],
    }).level).toBe('empty');
    expect(entry.readiness(settings, {
      ...base,
      availablePolicyTopics: ['late_arrivals', 'repairs'],
    }).level).toBe('ready');
    expect(entry.readiness(settings, { ...base, availablePolicyTopics: [] }).level)
      .toBe('empty');
  });

  it('keeps Quick Info honest: selected facts with no content do not publish', () => {
    const entry = SECTION_LIBRARY_REGISTRY.quick_info;
    const base = deriveSiteLibraryContext(state, pairDocument('hero', 'booking'));
    const settings = entry.normalize({
      ...entry.defaultSettings(),
      facts: ['visit_mode', 'new_clients'],
    });

    expect(entry.readiness(settings, base).level).toBe('ready');
    expect(entry.readiness(settings, { ...base, availableQuickFacts: [] }).level)
      .toBe('empty');
    // A fact the owner did not select cannot rescue the section either.
    expect(entry.readiness(settings, {
      ...base,
      availableQuickFacts: ['open_status'],
    }).level).toBe('empty');
  });

  it('drops an anchor menu that has fewer than two places to go', () => {
    // The renderer draws nothing under two targets, and only the plan can
    // count them: the count has to be taken after injections and readiness
    // gating, which no single section's readiness rule can see.
    // Injections supply navigable targets of their own, so they are turned
    // off here to make the count on the page itself the thing under test.
    const noInjections = {
      aboutEnabled: false,
      canvaEnabled: false,
      galleryEnabled: false,
      policiesEnabled: false,
    };
    const planTypesFor = (document: SiteBuilderDocument) => buildCustomerPagePlan(document, {
      context: {
        ...deriveSiteLibraryContext(state, document),
        hasContactSectionContent: false,
      },
      toggles: noInjections,
    }).flatMap(page => page.sections).map(section => section.sectionType);

    const lonely = pairDocument('section_navigation', 'reviews');
    expect(planTypesFor(lonely)).toEqual(['reviews']);

    // Give it a second target and the menu earns its place.
    const home = lonely.pages[0]!;
    const withTeam: SiteBuilderDocument = {
      ...lonely,
      pages: [{
        ...home,
        sections: [...home.sections, instanceOf('team', 'matrix-third', 2)],
      }],
    };
    expect(planTypesFor(withTeam))
      .toEqual(['section_navigation', 'reviews', 'team']);
  });

  it('counts only gallery images that can actually paint', () => {
    // Storage read-back deliberately turns unreachable images into `missing`,
    // which keeps the id and resolves to no URL. Counting those ids would
    // report a gallery ready that renders an empty section.
    const document = pairDocument('gallery', 'booking');
    const entry = SECTION_LIBRARY_REGISTRY.gallery;
    const unreachable = {
      ...state,
      gallery: {
        ...state.gallery,
        images: state.gallery.images.map(image => ({
          ...image,
          previewUrl: undefined,
          source: 'missing' as const,
        })),
      },
    };
    const context = deriveSiteLibraryContext(unreachable, document);

    expect(context.galleryImageIds).toEqual([]);
    expect(entry.readiness(entry.defaultSettings(), context).level).toBe('empty');
    expect(buildCustomerPagePlan(document, { context, toggles: TOGGLES })
      .flatMap(page => page.sections)
      .map(section => section.sectionType))
      .not.toContain('gallery');
  });

  it('never mutates the document it plans from', () => {
    const document = pairDocument('reviews', 'reviews');
    const before = JSON.stringify(document);
    buildCustomerPagePlan(document, {
      context: deriveSiteLibraryContext(state, document),
      toggles: TOGGLES,
    });
    expect(JSON.stringify(document), 'the plan mutated its input').toBe(before);
  });

  it('resolves adjacency from the resolved neighbour, not the raw one', () => {
    // Three tinted sections in a row must alternate tint → base → tint,
    // which only holds if each decision reads the previous RESOLVED surface.
    const document = pairDocument('reviews', 'reviews');
    const home = document.pages[0]!;
    const third = instanceOf('reviews', 'matrix-third', 2);
    const withThree: SiteBuilderDocument = {
      ...document,
      pages: [{ ...home, sections: [...home.sections, third] }],
    };
    const plan = buildCustomerPagePlan(withThree, {
      context: deriveSiteLibraryContext(state, withThree),
      toggles: TOGGLES,
    });
    const surfaces = plan.flatMap(page => page.sections)
      .filter(section => section.id.startsWith('matrix-'))
      .map(section => section.surface);
    expect(surfaces).toEqual(['tint', 'base', 'tint']);
  });

  it('renders every populated library type for the demo context (no silent blanks)', () => {
    for (const type of ALL_TYPES) {
      const document = pairDocument(type, 'booking');
      const context = deriveSiteLibraryContext(state, document);
      const plan = buildCustomerPagePlan(document, {
        context,
        toggles: TOGGLES,
      });
      const rendered = plan.flatMap(page => page.sections).some(
        section => section.id === 'matrix-first',
      );
      // The demo context populates every shared authority, so every type must
      // survive readiness gating.
      expect(rendered, `demo-populated ${type} was dropped from the plan`).toBe(true);
    }
  });
});
