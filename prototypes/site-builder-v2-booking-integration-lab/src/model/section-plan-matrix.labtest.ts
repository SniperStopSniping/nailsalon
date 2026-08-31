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
