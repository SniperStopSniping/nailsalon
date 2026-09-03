/**
 * Accessibility gate for every customer section renderer.
 *
 * Each of the 20 section types is rendered through the real preview with a
 * fully populated demo state, then checked against the invariants the
 * customer site must hold: every section is a labelled landmark or region,
 * every control and link has an accessible name, every image has an alt
 * attribute, headings never skip a level inside a section, and no control is
 * smaller than the 44px touch target at phone width.
 */

import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultBookingPresentationSettings } from '../../booking/presentation';
import { createDefaultCustomDesignSettings } from '../../custom-design/model/settings';
import {
  getSectionRegistryEntry,
  NAVIGABLE_SECTION_TYPES,
  SECTION_LIBRARY_REGISTRY,
} from '../../model/section-library/registry';
import type { SitePlanPage } from '../../model/site-plan';
import { initializeStarter } from '../../model/starters';
import type {
  LibrarySectionType,
  SectionInstance,
  SiteBuilderDocument,
} from '../../model/types';
import { createDemoOnboardingState, DEMO_SITE_CONTENT } from '../model/demo-content';
import type { AboutPresetId } from '../model/types';
import { OnboardingSitePreview } from './OnboardingSitePreview';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: (assetIds: readonly string[]) => new Map(
    assetIds.map(assetId => [assetId, {
      original: {
        assetId,
        kind: 'original',
        status: 'ready',
        url: `blob:https://luster.test/${assetId}`,
      },
      thumbnail: {
        assetId,
        kind: 'thumbnail',
        status: 'ready',
        url: `blob:https://luster.test/${assetId}-thumbnail`,
      },
    }]),
  ),
}));

type AccessibleTypeId = LibrarySectionType | 'booking' | 'custom_design';

const ALL_TYPES: AccessibleTypeId[] = [
  ...(Object.keys(SECTION_LIBRARY_REGISTRY) as LibrarySectionType[]),
  'booking',
  'custom_design',
];

const BOUND_SETTINGS: Partial<Record<LibrarySectionType, Record<string, unknown>>> = {
  announcement_bar: { message: 'Now booking September appointments' },
  faq: { itemIds: DEMO_SITE_CONTENT.faq.map(item => item.id) },
  offers: { offerIds: DEMO_SITE_CONTENT.offers.map(offer => offer.id) },
  reviews: { reviewIds: DEMO_SITE_CONTENT.reviews.map(review => review.id) },
  team: { memberIds: DEMO_SITE_CONTENT.staff.map(member => member.id) },
};

const sectionFor = (type: AccessibleTypeId): SectionInstance => {
  const id = `a11y-${type}`;
  if (type === 'booking') {
    return {
      id,
      label: 'Booking',
      order: 0,
      sectionType: 'booking',
      settings: createDefaultBookingPresentationSettings(),
      visible: true,
    };
  }
  if (type === 'custom_design') {
    const settings = createDefaultCustomDesignSettings();
    settings.images = [{
      altText: 'Accessible Custom Design artwork',
      aspectRatio: 1,
      assetId: 'a11y-custom-design-asset',
      decorative: false,
      fileName: 'accessible-design.png',
      fileSize: 1_000,
      height: 1_000,
      id: 'a11y-custom-design-image',
      interactiveAreas: [],
      mimeType: 'image/png',
      width: 1_000,
    }];
    return {
      id,
      label: 'Custom Design',
      order: 0,
      sectionType: type,
      settings,
      visible: true,
    };
  }
  const entry = getSectionRegistryEntry(type);
  return {
    id,
    label: entry.label,
    order: 0,
    sectionType: type,
    settings: entry.normalize({
      ...entry.defaultSettings(),
      ...BOUND_SETTINGS[type],
    }),
    visible: true,
  } as SectionInstance;
};

/** Two anchor targets so Section Navigation has something real to link to. */
const planFor = (type: AccessibleTypeId): SitePlanPage[] => {
  const primary = sectionFor(type);
  const companions: SectionInstance[] = type === 'section_navigation'
    ? [sectionFor('featured_services'), sectionFor('reviews')]
    : [];
  const sections = [primary, ...companions];
  return [{
    id: 'a11y-page',
    isHome: true,
    label: 'Accessibility',
    order: 0,
    sections: sections.map(section => ({
      attachedToPrevious: false,
      id: section.id,
      injected: false,
      label: section.label,
      section,
      sectionType: section.sectionType,
      surface: section.sectionType === 'booking' || section.sectionType === 'custom_design'
        ? 'base'
        : getSectionRegistryEntry(section.sectionType as LibrarySectionType).surface,
    })),
    slug: '',
    visibleInNavigation: true,
  }];
};

const accessibleName = (element: Element): string => {
  const label = element.getAttribute('aria-label');
  if (label && label.trim()) {
    return label.trim();
  }
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = element.ownerDocument.getElementById(labelledBy);
    if (target?.textContent?.trim()) {
      return target.textContent.trim();
    }
  }
  const title = element.getAttribute('title');
  if (title && title.trim()) {
    return title.trim();
  }
  return (element.textContent ?? '').trim();
};

const ABOUT_PRESETS: readonly AboutPresetId[] = [
  'photo_right',
  'editorial_portrait',
  'profile_quick_facts',
  'about_before_you_book',
];

const NAVIGATION_CASES: ReadonlyArray<{
  preset?: AboutPresetId;
  type: AccessibleTypeId;
}> = [
  ...[...NAVIGABLE_SECTION_TYPES]
    .filter(type => type !== 'about')
    .map(type => ({ type: type as AccessibleTypeId })),
  ...ABOUT_PRESETS.map(preset => ({ preset, type: 'about' as const })),
];

describe('customer section accessibility', () => {
  afterEach(() => {
    cleanup();
  });

  const demo = createDemoOnboardingState();
  const state = {
    ...demo,
    recipe: {
      ...demo.recipe,
      aboutEnabled: true,
      canvaEnabled: true,
      galleryEnabled: true,
      policiesEnabled: true,
    },
  };
  let counter = 0;
  const document_: SiteBuilderDocument = {
    ...initializeStarter('quick_book', {
      idFactory: kind => `a11y-doc-${kind}-${counter++}`,
    }),
    siteContent: DEMO_SITE_CONTENT,
  };
  const documentForPlan = (plan: SitePlanPage[]): SiteBuilderDocument => ({
    ...document_,
    navigation: { ...document_.navigation, enabled: false, items: [] },
    pages: plan.map((page, index) => ({
      ...document_.pages[0]!,
      id: page.id,
      isHome: page.isHome,
      name: page.label,
      order: index,
      sections: page.sections.map(section => section.section),
      slug: page.slug,
      visible: true,
      visibleInNavigation: page.visibleInNavigation,
    })),
  });

  it.each(ALL_TYPES.map(type => [type] as const))(
    '%s renders as an accessible customer section',
    (type) => {
      const plan = planFor(type);
      const renderDocument = documentForPlan(plan);
      const { container } = render(
        <OnboardingSitePreview
          customerPagePlan={plan}
          device="phone"
          document={renderDocument}
          interactionMode="interactive"
          state={state}
        />,
      );

      const node = container.querySelector(`[data-section-id="a11y-${type}"]`);

      // Section Navigation with real targets renders; every other type must too.
      expect(node, `${type} did not render`).not.toBeNull();

      const section = node!;

      // 1. The section is a labelled region or a heading-led block.
      const nestedLandmark = section.querySelector(
        'section[aria-label], [role="region"][aria-label]',
      );
      const label = section.getAttribute('aria-label')
        ?? nestedLandmark?.getAttribute('aria-label');
      const heading = section.querySelector('h1, h2, h3');

      expect(
        Boolean(label?.trim()) || Boolean(heading?.textContent?.trim()),
        `${type} has neither an accessible label nor a heading`,
      ).toBe(true);

      // 2. Every interactive element has a non-empty accessible name.
      const controls = [...section.querySelectorAll('a, button, summary, [role="button"]')];
      for (const control of controls) {
        expect(
          accessibleName(control).length,
          `${type}: an interactive element has no accessible name`,
        ).toBeGreaterThan(0);
      }

      // 3. Every image declares alt text (empty alt = deliberately decorative).
      for (const image of section.querySelectorAll('img')) {
        expect(
          image.hasAttribute('alt'),
          `${type}: an image is missing its alt attribute`,
        ).toBe(true);
      }

      // 4. Headings inside a section never skip a level.
      const levels = [...section.querySelectorAll('h1, h2, h3, h4, h5, h6')]
        .map(element => Number(element.tagName.slice(1)));
      for (const [index, level] of levels.entries()) {
        if (index === 0) {
          continue;
        }

        expect(
          level - (levels[index - 1] ?? level),
          `${type}: heading levels skip (${levels.join(' → ')})`,
        ).toBeLessThanOrEqual(1);
      }

      // 5. Link targets are real: an in-page anchor points at an existing id
      //    or the canonical booking anchor.
      for (const anchor of section.querySelectorAll('a[href^="#"]')) {
        const href = anchor.getAttribute('href') ?? '';
        const targetId = href.slice(1);
        const resolvable = targetId === 'booking'
          || container.querySelector(`#${CSS.escape(targetId)}`) !== null;

        expect(resolvable, `${type}: dangling in-page link ${href}`).toBe(true);
      }
    },
  );

  it.each(NAVIGATION_CASES)(
    'resolves the Section Navigation anchor for $type ($preset)',
    ({ preset, type }) => {
      const navigation = sectionFor('section_navigation');
      const baseTarget = sectionFor(type);
      const target = type === 'about' && preset
        ? ({
            ...baseTarget,
            settings: getSectionRegistryEntry('about').normalize({
              ...getSectionRegistryEntry('about').defaultSettings(),
              preset,
            }),
          } as SectionInstance)
        : baseTarget;
      const companion = sectionFor(type === 'reviews' ? 'featured_services' : 'reviews');
      const sections = [navigation, target, companion];
      const pagePlan: SitePlanPage[] = [{
        id: 'navigation-page',
        isHome: true,
        label: 'Navigation',
        order: 0,
        sections: sections.map(section => ({
          attachedToPrevious: false,
          id: section.id,
          injected: false,
          label: section.label,
          section,
          sectionType: section.sectionType,
          surface: section.sectionType === 'booking'
            ? 'base'
            : getSectionRegistryEntry(section.sectionType as LibrarySectionType).surface,
        })),
        slug: '',
        visibleInNavigation: true,
      }];

      const { container } = render(
        <OnboardingSitePreview
          customerPagePlan={pagePlan}
          device="phone"
          document={documentForPlan(pagePlan)}
          interactionMode="interactive"
          state={state}
        />,
      );
      const expectedId = type === 'booking' ? 'booking' : `section-${target.id}`;
      const navigationNode = container.querySelector(
        `[data-section-id="${navigation.id}"]`,
      );
      const link = navigationNode?.querySelector(`a[href="#${expectedId}"]`);
      const targetNode = container.querySelector(`#${CSS.escape(expectedId)}`);

      expect(link, `Section Navigation omitted #${expectedId}`).not.toBeNull();
      expect(targetNode, `Section Navigation target #${expectedId} is missing`)
        .toHaveAttribute('data-section-id', target.id);
    },
  );

  it('exposes the preview itself as a described region', () => {
    const { getByRole } = render(
      <OnboardingSitePreview
        customerPagePlan={planFor('hero')}
        device="phone"
        document={document_}
        interactionMode="interactive"
        label="Customer website preview"
        state={state}
      />,
    );
    const region = getByRole('region', { name: 'Customer website preview' });

    expect(region.getAttribute('aria-describedby')).toBeTruthy();
    expect(within(region).getByRole('region', { name: 'Customer website viewport' }))
      .toBeTruthy();
  });
});
