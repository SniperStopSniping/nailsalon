/* eslint-disable playwright/no-conditional-expect, playwright/no-conditional-in-test */
import {
  devices,
  expect,
  type FrameLocator,
  type Locator,
  type Page,
  type Route,
  test,
} from '@playwright/test';
import { Client, type QueryResultRow } from 'pg';

import {
  BOOKING_PAGE_PRESET_IDS,
  BOOKING_PAGE_PRESET_RECIPE_VERSION,
  type BookingPagePresetId,
  type BookingPagePresetReference,
  getBookingPagePresentationSignature,
  resolveBookingPagePresetRecipe,
} from '../../src/libs/bookingPagePresetRecipes';
import {
  attestDisposableDatabaseSession,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '../../src/libs/disposableDatabaseTarget';
import { formatDuration } from '../../src/utils/Helpers';
import {
  appPath,
  authStatePaths,
  e2eConfig,
  usingExternalBaseUrl,
} from './support/config';

const SYNTHETIC_SALON_ID = 'salon_nail-salon-no5';
const SYNTHETIC_SALON_SLUG = 'nail-salon-no5';
const SYNTHETIC_CI_CLERK_BOOTSTRAP_URL
  = 'https://ci.luster.invalid/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
const SYNTHETIC_ACCESSIBLE_ADD_ON_ID = 'addon_e2e_nail-repair';

const STAGE7_PRESET_LABELS = {
  quick_book: 'Quick Book',
  signature: 'Signature',
  menu: 'Menu',
  collective: 'Collective',
} as const satisfies Record<BookingPagePresetId, string>;

const SECTION_ORDER = [
  'salonProfile',
  'featuredServices',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
] as const;

const ALL_PRESENTATION_SECTION_ORDER = [
  'salonProfile',
  'technicianProfile',
  'featuredServices',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
] as const;

// These are the current supported editorial flow sections that produce a
// durable `data-public-surface` root. The service menu is intentionally not
// included: it is the canonical booking engine host rather than a wrapper
// introduced solely for test observability.
const STAGE6_FLOW_ORDER_PROOF_IDS = [
  'technicianProfile',
  'featuredServices',
  'hoursLocation',
  'policies',
] as const;

const VIEWPORT_SCENARIOS = [
  { label: '320px', viewport: { width: 320, height: 700 }, zoom: 1 },
  { label: '375x600', viewport: { width: 375, height: 600 }, zoom: 1 },
  // Matches the existing public-booking Chromium accessibility approximation
  // in mobile-service-layout.e2e.ts: a desktop viewport with 200% CSS zoom.
  { label: '200% zoom', viewport: { width: 1280, height: 800 }, zoom: 2 },
] as const;

const OWNER_PREVIEW_VIEWPORT_SCENARIOS = [
  { label: '320x700', viewport: { width: 320, height: 700 }, zoom: 1 },
  { label: '375x600', viewport: { width: 375, height: 600 }, zoom: 1 },
  { label: 'iPhone 13', viewport: { width: 390, height: 664 }, zoom: 1 },
  { label: '200% zoom', viewport: { width: 1280, height: 800 }, zoom: 2 },
] as const;

type Layout = 'editorial' | 'quick_book';

type FixtureOptions = {
  businessMode?: 'solo' | 'team';
  hiddenSections?: readonly string[];
  presetBase?: BookingPagePresetReference | null;
  sectionOrder?: readonly string[];
  sectionVariants?: Readonly<Record<string, string>>;
};

// Kept deliberately independent from the production recipe catalog. The
// recipes supply the fixture configuration; this table states the observable
// DOM contract that each named product experience must satisfy.
const STAGE7_PRESET_DOM_EXPECTATIONS = {
  quick_book: {
    present: [
      'booking-step-header',
      'featured-services-scroll',
      'service-menu-list',
      'booking-policy',
      'booking-social-links',
    ],
    absent: [
      'editorial-hero',
      'editorial-about',
      'technician-profile-cards',
      'editorial-featured-services',
      'service-menu-grouped-categories',
      'editorial-visit',
      'location-cards',
      'editorial-policies',
      'booking-social-links-labeled',
    ],
  },
  signature: {
    present: [
      'editorial-hero',
      'editorial-about',
      'editorial-featured-services',
      'service-menu-list',
      'editorial-visit',
      'editorial-policies',
      'booking-social-links',
    ],
    absent: [
      'booking-step-header',
      'technician-profile-cards',
      'featured-services-scroll',
      'service-menu-grouped-categories',
      'location-cards',
      'booking-policy',
      'booking-social-links-labeled',
    ],
  },
  menu: {
    present: [
      'editorial-hero',
      'featured-services-scroll',
      'service-menu-grouped-categories',
      'editorial-policies',
      'booking-social-links',
    ],
    absent: [
      'booking-step-header',
      'editorial-about',
      'technician-profile-cards',
      'editorial-featured-services',
      'service-menu-list',
      'editorial-visit',
      'location-cards',
      'booking-policy',
      'booking-social-links-labeled',
    ],
  },
  collective: {
    present: [
      'editorial-hero',
      'technician-profile-cards',
      'editorial-featured-services',
      'service-menu-list',
      'location-cards',
      'editorial-policies',
      'booking-social-links-labeled',
    ],
    absent: [
      'booking-step-header',
      'editorial-about',
      'featured-services-scroll',
      'service-menu-grouped-categories',
      'editorial-visit',
      'booking-policy',
      'booking-social-links',
    ],
  },
} as const satisfies Record<BookingPagePresetId, {
  absent: readonly string[];
  present: readonly string[];
}>;

type SalonFixtureRow = QueryResultRow & {
  id: string;
  name: string;
  settings: unknown;
};

type ServiceFixtureRow = QueryResultRow & {
  duration_minutes: number;
  id: string;
  name: string;
  price: number;
  price_display_text: string | null;
};

type TechnicianFixtureRow = QueryResultRow & {
  email: string | null;
  id: string;
  name: string;
  phone: string | null;
};

type AddOnFixtureRow = QueryResultRow & {
  duration_minutes: number;
  name: string;
  price_cents: number;
};

type FeaturedServiceSnapshot = {
  id: string;
  text: string;
};

type Stage7PresetSnapshot = {
  policyText: string;
  serviceText: string;
  socialHref: string;
  structure: string;
  technicianNames: string[];
};

type BuilderOperation =
  | {
    type: 'move_section';
    sectionId: string;
    targetSectionId: string;
    direction: 'up' | 'down';
  }
  | { type: 'set_variant'; sectionId: string; variant: string | null }
  | {
    type: 'reset_all';
    expectedPresentationSignature: string;
  }
  | {
    type: 'apply_preset';
    presetId: BookingPagePresetId;
    presetVersion: typeof BOOKING_PAGE_PRESET_RECIPE_VERSION;
    expectedPresentationSignature: string;
  };

type BuilderApiState = {
  config: {
    draft: {
      hiddenSections: string[];
      layout: Layout;
      sectionOrder: string[];
      sectionVariants: Record<string, string>;
    };
    live: unknown;
    draftPresetBase: BookingPagePresetReference | null;
    livePresetBase: BookingPagePresetReference | null;
  };
  content: unknown;
};

const STAGE7_STRUCTURAL_MARKERS = [
  'booking-step-header',
  'editorial-hero',
  'editorial-about',
  'technician-profile-cards',
  'featured-services-scroll',
  'editorial-featured-services',
  'service-menu-list',
  'service-menu-grouped-categories',
  'editorial-visit',
  'location-cards',
  'booking-policy',
  'editorial-policies',
  'booking-social-links',
  'booking-social-links-labeled',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertLocalSyntheticTarget(baseURL: string | undefined): asserts baseURL is string {
  if (!baseURL || usingExternalBaseUrl()) {
    throw new Error('Booking layout variant evidence may run only against the local disposable E2E server.');
  }

  const hostname = new URL(baseURL).hostname;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error('Booking layout variant evidence refuses external or hosted browser targets.');
  }
  if (e2eConfig.salonSlug !== SYNTHETIC_SALON_SLUG) {
    throw new Error('Booking layout variant evidence may mutate only the canonical synthetic E2E salon.');
  }
}

function buildFixtureSettings(
  originalSettings: unknown,
  layout: Layout,
  heroImageUrl: string,
  options: FixtureOptions = {},
): Record<string, unknown> {
  const base = isRecord(originalSettings) ? originalSettings : {};
  const editorial = layout === 'editorial';
  const defaultSectionVariants = editorial
    ? {
        salonProfile: 'hero_image',
        featuredServices: 'signature',
        serviceMenu: 'list',
        policies: 'inline',
        socialLinks: 'icons',
        bookingCta: 'sticky',
      }
    : {
        salonProfile: 'compact',
        featuredServices: 'carousel',
        serviceMenu: 'list',
        policies: 'card',
        socialLinks: 'icons',
        bookingCta: 'sticky',
      };
  const side = {
    layout,
    stylePack: 'default',
    tokenOverrides: null,
    sectionOrder: [...(options.sectionOrder ?? SECTION_ORDER)],
    sectionVariants: options.sectionVariants
      ? { ...options.sectionVariants }
      : defaultSectionVariants,
    // Keep a content-ready section in the order but hidden, so the browser
    // proves Stage 2 admission survives the Stage 4 presentation variants.
    hiddenSections: [...(options.hiddenSections ?? ['hoursLocation'])],
    businessMode: options.businessMode ?? 'solo',
    startMode: 'services_first',
  };
  const contentSide = {
    heroImageUrl,
    specialtyLine: 'Synthetic layout parity fixture',
    bio: null,
    locationDisplayMode: 'full_address',
  };

  return {
    ...base,
    bookingExperience: {
      primaryColor: null,
      bookingMessage: 'Synthetic booking layout parity fixture',
      policy: {
        enabled: true,
        title: 'Synthetic booking policy',
        text: 'Please arrive five minutes before your synthetic appointment.',
        showOnServicePage: true,
        showBeforeConfirmation: false,
        showAfterConfirmation: false,
        showInConfirmationEmail: false,
        acknowledgment: {
          required: false,
          text: null,
        },
      },
      quickFacts: {
        appointmentOnly: {
          enabled: true,
          label: 'Synthetic appointment only',
        },
        depositNotice: {
          enabled: false,
          label: null,
        },
        cancellationNotice: {
          enabled: false,
          label: null,
        },
      },
      socialLinks: {
        instagram: 'https://www.instagram.com/luster-stage4-fixture',
        facebook: null,
        tiktok: null,
      },
      confirmationMessage: null,
    },
    bookingPage: {
      version: 1,
      draft: side,
      live: side,
      ...(options.presetBase === undefined
        ? {}
        : {
            draftPresetBase: options.presetBase,
            livePresetBase: options.presetBase,
          }),
    },
    bookingPageContent: {
      version: 1,
      draft: contentSide,
      live: contentSide,
    },
  };
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));

  expect(overflow.documentScrollWidth, 'document must not scroll horizontally').toBeLessThanOrEqual(
    overflow.documentClientWidth,
  );
  expect(overflow.bodyScrollWidth, 'body must not scroll horizontally').toBeLessThanOrEqual(
    overflow.bodyClientWidth,
  );
}

async function expectBuilderTargetsAtLeast44px(page: Page): Promise<void> {
  const inspection = await page
    .getByTestId('booking-page-builder')
    .locator('button, select')
    .evaluateAll((elements) => {
      const visible = elements
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            height: bounds.height,
            label: element.getAttribute('aria-label')
              ?? element.getAttribute('data-testid')
              ?? element.textContent?.replace(/\s+/g, ' ').trim()
              ?? element.tagName,
            width: bounds.width,
          };
        })
        .filter(target => target.width > 0 && target.height > 0);

      return {
        count: visible.length,
        // Chromium can report a CSS 44px DOMRect just below 44 due to
        // fractional device-pixel conversion. Rounding proves the declared
        // practical target without lowering the 44px product threshold.
        tooSmall: visible.filter(target => (
          Math.round(target.width) < 44 || Math.round(target.height) < 44
        )),
      };
    });

  expect(inspection.count, 'the owner builder must expose usable controls').toBeGreaterThan(0);
  expect(inspection.tooSmall, 'every visible builder control must provide a practical 44px target').toEqual([]);
}

async function readBuilderFlowOrder(page: Page): Promise<string[]> {
  const order = await page
    .getByTestId('booking-page-builder-section-list')
    .locator('[data-section-id]')
    .evaluateAll(elements => elements.map(element => element.getAttribute('data-section-id')));
  const proofIds = new Set<string>(STAGE6_FLOW_ORDER_PROOF_IDS);

  return order.filter((sectionId): sectionId is string => (
    sectionId !== null && proofIds.has(sectionId)
  ));
}

async function readDraftPreviewFlowOrder(page: Page): Promise<string[] | null> {
  let order: Array<string | null>;

  try {
    order = await page
      .frameLocator('iframe[title="Live booking page preview"]')
      .locator('[data-public-surface]')
      .evaluateAll(elements => elements.map(element => element.getAttribute('data-public-surface')));
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('Execution context was destroyed')
      || error.message.includes('Frame was detached')
    )) {
      // A successful builder write intentionally replaces the draft-preview
      // document. Return a non-matching snapshot so expect.poll samples the
      // replacement frame instead of treating that navigation instant as the
      // final DOM-order result.
      return null;
    }

    throw error;
  }
  const proofIds = new Set<string>(STAGE6_FLOW_ORDER_PROOF_IDS);

  return order.filter((sectionId): sectionId is string => (
    sectionId !== null && proofIds.has(sectionId)
  ));
}

async function expectBuilderAndDraftPreviewOrder(
  page: Page,
  expectedOrder: readonly string[],
): Promise<void> {
  await expect.poll(() => readBuilderFlowOrder(page)).toEqual(expectedOrder);
  await expect.poll(() => readDraftPreviewFlowOrder(page)).toEqual(expectedOrder);
}

async function applyBuilderOperationFromPage(
  page: Page,
  operation: BuilderOperation,
  action: () => Promise<void>,
): Promise<BuilderApiState> {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'PATCH'
      && url.pathname === '/api/admin/booking-page';
  });

  await action();

  const response = await responsePromise;
  const responseText = await response.text();

  expect(response.ok(), responseText).toBe(true);
  expect(response.request().postDataJSON()).toEqual({ builderOperation: operation });
  await expect(page.locator('div[role="status"][aria-live="polite"]')).toHaveText('Saved');

  return JSON.parse(responseText) as BuilderApiState;
}

async function fetchBuilderApiState(
  page: Page,
): Promise<BuilderApiState> {
  const response = await page.request.get(
    `/api/admin/booking-page?salonSlug=${encodeURIComponent(SYNTHETIC_SALON_SLUG)}`,
  );
  const responseText = await response.text();

  expect(response.ok(), responseText).toBe(true);

  return JSON.parse(responseText) as BuilderApiState;
}

async function expectDocumentOrder(page: Page, selectors: string[]): Promise<void> {
  const result = await page.locator('body').evaluate((_body, orderedSelectors) => {
    const elements = orderedSelectors.map(selector => document.querySelector(selector));
    const missing = orderedSelectors.filter((_selector, index) => !elements[index]);
    const ordered = elements.every((element, index) => {
      if (!element || index === 0) {
        return Boolean(element);
      }
      const previous = elements[index - 1];
      if (!previous) {
        return false;
      }
      return Boolean(previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
    });

    return { missing, ordered };
  }, selectors);

  expect(result.missing, 'every ordered layout marker must exist').toEqual([]);
  expect(result.ordered, `layout markers must follow ${selectors.join(' -> ')}`).toBe(true);
}

async function expectNoDuplicateOrEmptyPublicSurfaces(page: Page): Promise<void> {
  const inspection = await page.locator('[data-public-surface]').evaluateAll((elements) => {
    const counts = new Map<string, number>();
    const empty: string[] = [];

    for (const element of elements) {
      const surface = element.getAttribute('data-public-surface') ?? 'unnamed';
      counts.set(surface, (counts.get(surface) ?? 0) + 1);

      const bounds = element.getBoundingClientRect();
      const hasDurableContent = Boolean(
        element.textContent?.trim()
        || element.querySelector('a, button, img, input, svg'),
      );
      if (bounds.width <= 0 || bounds.height <= 0 || !hasDurableContent) {
        empty.push(surface);
      }
    }

    return {
      duplicates: [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([surface, count]) => `${surface}:${count}`),
      empty,
    };
  });

  expect(inspection.duplicates, 'each admitted public section must render at most once').toEqual([]);
  expect(inspection.empty, 'public section frames must contain durable visible output').toEqual([]);
}

async function expectCommonBookingSpine(page: Page): Promise<void> {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main main')).toHaveCount(0);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('main h1')).toHaveCount(1);

  await expect(page.getByTestId('service-category-scroll')).toHaveCount(1);
  await expect(page.getByTestId('service-category-scroll')).toBeVisible();
  await expect(page.getByTestId(`service-card-${e2eConfig.serviceId}`)).toHaveCount(1);
  await expect(page.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();
  await expect(page.getByTestId('booking-experience-intro')).toHaveCount(1);
  await expect(page.getByTestId('booking-appointment-only')).toHaveText('Synthetic appointment only');

  await expect(page.locator('[data-public-surface="hoursLocation"]')).toHaveCount(0);
  await expect(page.getByTestId('editorial-visit')).toHaveCount(0);
  await expect(page.getByTestId('booking-social-links')).toHaveCount(1);

  await expectNoDuplicateOrEmptyPublicSurfaces(page);
  await expectNoHorizontalOverflow(page);
}

async function expectLayoutStructure(
  page: Page,
  layout: Layout,
  salonName: string,
): Promise<FeaturedServiceSnapshot[]> {
  await expectCommonBookingSpine(page);

  if (layout === 'quick_book') {
    await expect(page.getByTestId('booking-step-header')).toHaveCount(1);
    await expect(page.getByTestId('booking-step-header')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose Your Service');
    await expect(page.getByTestId('editorial-hero')).toHaveCount(0);
    await expect(page.getByTestId('featured-services-scroll')).toHaveCount(1);
    await expect(page.getByTestId('editorial-featured-services')).toHaveCount(0);
    await expect(page.getByTestId('booking-policy')).toHaveCount(1);
    await expect(page.getByTestId('editorial-policies')).toHaveCount(0);

    await expectDocumentOrder(page, [
      '[data-testid="booking-step-header"]',
      '[data-testid="featured-services-scroll"]',
      '[data-testid="service-category-scroll"]',
      '[data-testid="booking-policy"]',
      '[data-testid="booking-social-links"]',
    ]);

    return page.locator('button[data-testid^="featured-service-card-"]').evaluateAll(elements => (
      elements.map(element => ({
        id: (element.getAttribute('data-testid') ?? '').replace('featured-service-card-', ''),
        text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      }))
    ));
  }

  await expect(page.getByTestId('editorial-hero')).toHaveCount(1);
  await expect(page.getByTestId('editorial-hero')).toBeVisible();
  await expect(page.getByTestId('booking-step-header')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(salonName);
  await expect(page.getByTestId('editorial-hero-image')).toBeVisible();
  await expect(page.getByTestId('editorial-hero-image')).toHaveAttribute('alt', `${salonName} salon`);
  await expect.poll(() => page.getByTestId('editorial-hero-image').evaluate(
    image => image instanceof HTMLImageElement && image.naturalWidth > 0,
  )).toBe(true);
  await expect(page.getByTestId('editorial-featured-services')).toHaveCount(1);
  await expect(page.getByTestId('featured-services-scroll')).toHaveCount(0);
  await expect(page.getByTestId('editorial-policies')).toHaveCount(1);
  await expect(page.getByTestId('booking-policy')).toHaveCount(0);

  await expectDocumentOrder(page, [
    '[data-testid="editorial-hero"]',
    '[data-testid="editorial-featured-services"]',
    '[data-testid="service-category-scroll"]',
    '[data-testid="booking-social-links"]',
    '[data-testid="editorial-policies"]',
  ]);

  return page.locator('div[data-testid^="editorial-featured-service-"]').evaluateAll(elements => (
    elements.map(element => ({
      id: (element.getAttribute('data-testid') ?? '').replace('editorial-featured-service-', ''),
      text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    }))
  ));
}

async function expectStage7PresetStructure(
  page: Page,
  presetId: BookingPagePresetId,
  salonName: string,
  technicians: TechnicianFixtureRow[],
): Promise<Stage7PresetSnapshot> {
  const expectation = STAGE7_PRESET_DOM_EXPECTATIONS[presetId];

  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main main')).toHaveCount(0);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('main h1')).toHaveCount(1);
  await expect(page.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();
  await expect(page.getByTestId('booking-experience-intro')).toHaveCount(1);
  await expect(page.getByTestId('booking-appointment-only')).toHaveText('Synthetic appointment only');

  for (const testId of expectation.present) {
    await expect(page.getByTestId(testId), `${presetId} must render ${testId} exactly once`).toHaveCount(1);
    await expect(page.getByTestId(testId), `${presetId} must visibly render ${testId}`).toBeVisible();
  }
  for (const testId of expectation.absent) {
    await expect(page.getByTestId(testId), `${presetId} must not render ${testId}`).toHaveCount(0);
  }

  await expect(page.locator('[data-public-surface="socialLinks"]')).toHaveCount(1);

  if (presetId !== 'quick_book') {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(salonName);
    await expect(page.getByTestId('editorial-hero-image')).toHaveAttribute('alt', `${salonName} salon`);
  }

  if (presetId === 'menu') {
    await expect(page.getByTestId('service-category-scroll')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Services' })).toHaveCount(1);

    for (const [category, label] of [
      ['manicure', 'Manicure'],
      ['pedicure', 'Pedicure'],
      ['combo', 'Combos'],
    ] as const) {
      const group = page.getByTestId(`service-category-group-${category}`);

      await expect(group).toHaveCount(1);
      await expect(group).toHaveAttribute('aria-labelledby', `service-category-heading-${category}`);
      await expect(group.getByRole('heading', { level: 3, name: label })).toHaveCount(1);
    }
  } else {
    await expect(page.getByTestId('service-category-scroll')).toHaveCount(1);
  }

  if (presetId === 'signature' || presetId === 'collective') {
    for (const technician of technicians) {
      const profileSurface = presetId === 'collective'
        ? page.getByTestId(`technician-profile-card-${technician.id}`)
        : page.getByTestId(`editorial-technician-${technician.id}`);

      await expect(profileSurface).toHaveCount(1);
      await expect(profileSurface).toContainText(technician.name);
    }
  } else {
    await expect(page.locator('[data-public-surface="technicianProfile"]')).toHaveCount(0);
  }

  if (presetId === 'collective') {
    await expect(page.getByTestId('technician-profile-cards').getByRole('listitem')).toHaveCount(technicians.length);
    await expect(page.getByTestId('location-cards').getByRole('listitem')).not.toHaveCount(0);

    const labeledSocialLink = page.getByRole('link', { name: `Visit ${salonName} on Instagram` });
    const socialTarget = await labeledSocialLink.boundingBox();

    await expect(labeledSocialLink).toContainText('Instagram');
    await expect(labeledSocialLink).toHaveAttribute('href', 'https://www.instagram.com/luster-stage4-fixture');
    expect(socialTarget).not.toBeNull();
    expect(socialTarget!.height).toBeGreaterThanOrEqual(44);
  }

  const publicText = await page.locator('body').textContent() ?? '';
  for (const technician of technicians) {
    if (technician.email) {
      expect(publicText).not.toContain(technician.email);
    }
    if (technician.phone) {
      expect(publicText).not.toContain(technician.phone);
    }
  }

  await expectNoDuplicateOrEmptyPublicSurfaces(page);
  await expectNoHorizontalOverflow(page);

  const actualMarkers: string[] = [];
  for (const testId of STAGE7_STRUCTURAL_MARKERS) {
    if (await page.getByTestId(testId).count()) {
      actualMarkers.push(testId);
    }
  }

  const policy = presetId === 'quick_book'
    ? page.getByTestId('booking-policy').locator('p')
    : page.getByTestId('editorial-policies').locator('p');
  const social = presetId === 'collective'
    ? page.getByTestId('booking-social-links-labeled').getByRole('link').first()
    : page.getByTestId('booking-social-links').getByRole('link').first();

  return {
    policyText: (await policy.textContent() ?? '').replace(/\s+/g, ' ').trim(),
    serviceText: (await page.getByTestId(`service-card-${e2eConfig.serviceId}`).textContent() ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    socialHref: await social.getAttribute('href') ?? '',
    structure: actualMarkers.join('|'),
    technicianNames: presetId === 'signature' || presetId === 'collective'
      ? technicians.map(technician => technician.name)
      : [],
  };
}

async function expectOpaquePreviewServiceCard(
  preview: FrameLocator,
  serviceId: string,
  evidenceLabel: string,
): Promise<void> {
  const serviceCard = preview.getByTestId(`service-card-${serviceId}`);

  await expect(serviceCard).toBeVisible();
  await expect.poll(
    () => serviceCard.evaluate(element => getComputedStyle(element).opacity),
    { message: `${evidenceLabel} must reveal real renderer pixels without iframe scripts` },
  ).toBe('1');
  await expect(serviceCard).not.toHaveText('');
}

type PreviewViewportMetrics = Readonly<{
  bodyScrollTop: number;
  documentScrollTop: number;
  footerIntersects: boolean;
  scrollY: number;
  topIntersects: boolean;
}>;

async function readPreviewViewportMetrics(
  preview: FrameLocator,
  topMarkerTestId: string,
): Promise<PreviewViewportMetrics> {
  return preview.locator('html').evaluate((_root, markerTestId) => {
    const topMarker = document.querySelector(`[data-testid="${markerTestId}"]`);
    const footer = document.querySelector('[data-testid="public-salon-footer"]');
    const topRect = topMarker?.getBoundingClientRect() ?? null;
    const footerRect = footer?.getBoundingClientRect() ?? null;
    const viewportHeight = window.innerHeight;

    return {
      bodyScrollTop: document.body.scrollTop,
      documentScrollTop: document.documentElement.scrollTop,
      footerIntersects: Boolean(
        footerRect && footerRect.bottom > 0 && footerRect.top < viewportHeight,
      ),
      scrollY: window.scrollY,
      topIntersects: Boolean(
        topRect && topRect.bottom > 0 && topRect.top < viewportHeight,
      ),
    };
  }, topMarkerTestId);
}

async function expectPreviewStartsAtTop(
  preview: FrameLocator,
  topMarkerTestId: string,
  evidenceLabel: string,
): Promise<void> {
  await expect.poll(
    () => readPreviewViewportMetrics(preview, topMarkerTestId),
    { message: `${evidenceLabel} must begin with real top-of-page content in view` },
  ).toEqual({
    bodyScrollTop: 0,
    documentScrollTop: 0,
    footerIntersects: false,
    scrollY: 0,
    topIntersects: true,
  });
}

async function expectPreviewDocumentMatchesFrameSource(
  iframe: Locator,
  preview: FrameLocator,
  baseURL: string,
): Promise<void> {
  const frameSource = await iframe.evaluate(element => element.getAttribute('src'));

  expect(frameSource).toBeTruthy();
  await expect.poll(() => preview.locator('html').evaluate(() => window.location.href))
    .toBe(new URL(frameSource!, baseURL).href);
}

async function expectRestoredPreviewScrollIsNormalized({
  evidenceLabel,
  iframe,
  preview,
  topMarkerTestId,
}: {
  evidenceLabel: string;
  iframe: Locator;
  preview: FrameLocator;
  topMarkerTestId: string;
}): Promise<void> {
  // Let the load handler's bounded normalization finish before deliberately
  // reproducing a later browser-restored child-frame position.
  await iframe.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => resolve(), 100);
        });
      });
    });
  }));

  await preview.locator('html').evaluate(() => {
    window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
  });

  await expect.poll(
    async () => {
      const metrics = await readPreviewViewportMetrics(preview, topMarkerTestId);

      return {
        footerIntersects: metrics.footerIntersects,
        restoredScrollPresent: metrics.scrollY > 0,
      };
    },
    { message: `${evidenceLabel} fixture must reproduce a bottom-restored frame state` },
  ).toEqual({ footerIntersects: true, restoredScrollPresent: true });

  // Replay the browser's child-frame load boundary after parking it at the
  // restored position. The real parent handler must normalize this state;
  // DOM-existence/opacity assertions alone cannot detect the regression.
  await iframe.dispatchEvent('load');
  await expectPreviewStartsAtTop(preview, topMarkerTestId, evidenceLabel);
}

async function expectViewOnlyPreviewScrollsWithoutActivation({
  evidenceLabel,
  iframe,
  page,
  preview,
  scrollInput,
  topMarkerTestId,
}: {
  evidenceLabel: string;
  iframe: Locator;
  page: Page;
  preview: FrameLocator;
  scrollInput: 'engine' | 'wheel';
  topMarkerTestId: string;
}): Promise<void> {
  await expect(iframe).toHaveAttribute('aria-hidden', 'true');
  await expect(iframe).toHaveAttribute('tabindex', '-1');
  await expect(iframe).toHaveCSS('pointer-events', 'auto');

  const previewUrl = await preview.locator('html').evaluate(() => window.location.href);
  const navigableLink = preview.locator('a[href]').first();

  await expect(navigableLink, `${evidenceLabel} must exercise a real canonical link`).toHaveCount(1);

  await navigableLink.scrollIntoViewIfNeeded();
  const linkBox = await navigableLink.boundingBox();

  expect(linkBox, `${evidenceLabel} must expose a real canonical-link viewport box`).not.toBeNull();

  if (scrollInput === 'engine') {
    await page.touchscreen.tap(
      linkBox!.x + linkBox!.width / 2,
      linkBox!.y + linkBox!.height / 2,
    );
  } else {
    await page.mouse.click(
      linkBox!.x + linkBox!.width / 2,
      linkBox!.y + linkBox!.height / 2,
    );
  }

  await expect.poll(
    () => preview.locator('html').evaluate(() => window.location.href),
    { message: `${evidenceLabel} view-only links must not replace the preview` },
  ).toBe(previewUrl);

  await iframe.dispatchEvent('load');
  await expectPreviewStartsAtTop(preview, topMarkerTestId, evidenceLabel);
  await iframe.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }));

  if (scrollInput === 'wheel') {
    await iframe.scrollIntoViewIfNeeded();
    const frameBox = await iframe.boundingBox();

    expect(frameBox, `${evidenceLabel} must expose a real scrollable viewport`).not.toBeNull();

    await preview.locator('body').hover({ position: { x: 8, y: 120 } });
    await page.mouse.wheel(0, 600);
  } else {
    // Playwright's mobile WebKit driver does not expose a swipe or wheel API.
    // Exercise the actual child-frame scroll owner without claiming a physical
    // iOS touch gesture; Chromium supplies the real wheel-input proof.
    await preview.locator('html').evaluate(() => window.scrollBy(0, 600));
  }

  await expect.poll(
    () => preview.locator('html').evaluate(() => window.scrollY),
    { message: `${evidenceLabel} must remain wheel/touchpad scrollable` },
  ).toBeGreaterThan(0);

  await iframe.dispatchEvent('load');
  await expectPreviewStartsAtTop(preview, topMarkerTestId, evidenceLabel);
}

async function expectPreAttestationPreviewCannotActivate({
  baseURL,
  iframe,
  page,
  preview,
  refreshButton,
  touch,
}: {
  baseURL: string;
  iframe: Locator;
  page: Page;
  preview: FrameLocator;
  refreshButton: Locator;
  touch: boolean;
}): Promise<void> {
  let interceptNextPreview = true;
  let releaseSlowResource = () => {};
  let reportSlowResource = () => {};
  const slowResourceGate = new Promise<void>((resolve) => {
    releaseSlowResource = resolve;
  });
  const slowResourceStarted = new Promise<void>((resolve) => {
    reportSlowResource = resolve;
  });
  const previewRoute = /\/book\/service\?.*builderPreview=/;
  const slowResourceRoute = /\/__luster-preview-preload-probe\.svg$/;
  const handlePreviewRoute = async (route: Route) => {
    if (!interceptNextPreview) {
      await route.continue();
      return;
    }

    interceptNextPreview = false;
    await route.fulfill({
      body: `<!doctype html>
        <html>
          <body style="margin:0">
            <a data-testid="pre-attestation-link" href="/should-not-leave-preview"
              style="display:block;width:240px;height:120px">Must remain inert</a>
            <img src="/__luster-preview-preload-probe.svg" alt="">
          </body>
        </html>`,
      contentType: 'text/html',
      status: 200,
    });
  };
  const handleSlowResource = async (route: Route) => {
    reportSlowResource();
    await slowResourceGate;
    await route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      contentType: 'image/svg+xml',
      status: 200,
    });
  };

  await page.route(previewRoute, handlePreviewRoute);
  await page.route(slowResourceRoute, handleSlowResource);

  try {
    await refreshButton.click();
    await slowResourceStarted;

    const pendingLink = preview.getByTestId('pre-attestation-link');

    await expect(pendingLink).toBeVisible();
    await expect(iframe).toHaveCSS('pointer-events', 'none');

    const pendingUrl = await preview.locator('html').evaluate(() => window.location.href);
    const linkBox = await pendingLink.boundingBox();

    expect(linkBox, 'the pre-attestation link must have visible hit-test geometry').not.toBeNull();

    if (touch) {
      await page.touchscreen.tap(
        linkBox!.x + linkBox!.width / 2,
        linkBox!.y + linkBox!.height / 2,
      );
    } else {
      await page.mouse.click(
        linkBox!.x + linkBox!.width / 2,
        linkBox!.y + linkBox!.height / 2,
      );
    }

    await expect.poll(
      () => preview.locator('html').evaluate(() => window.location.href),
      { message: 'visible pre-load content must remain inert until exact preview attestation' },
    ).toBe(pendingUrl);
  } finally {
    releaseSlowResource();
    await page.unroute(previewRoute, handlePreviewRoute);
    await page.unroute(slowResourceRoute, handleSlowResource);
  }

  // The deliberately partial document fails canonical attestation and stays
  // inert. A subsequent real refresh can become interactive only after its
  // exact authorized document is loaded and guarded.
  await expect(iframe).toHaveCSS('pointer-events', 'none');

  await refreshButton.click();
  await expectPreviewDocumentMatchesFrameSource(iframe, preview, baseURL);

  await expect(iframe).toHaveCSS('pointer-events', 'auto');

  const expiredSessionRoute = /\/__luster-preview-expired-session$/;
  const handleExpiredSession = async (route: Route) => {
    await route.fulfill({
      body: `<!doctype html>
        <html>
          <body style="margin:0">
            <a data-testid="expired-session-link" href="/should-not-leave-expired-preview"
              style="display:block;width:240px;height:120px">Owner sign in</a>
          </body>
        </html>`,
      contentType: 'text/html',
      status: 200,
    });
  };

  await page.route(expiredSessionRoute, handleExpiredSession);

  try {
    // Bypass the child activation guard to reproduce a browser/session-driven
    // replacement on the same previously attested iframe element.
    await preview.locator('html').evaluate(() => {
      window.location.assign('/__luster-preview-expired-session');
    });

    const expiredLink = preview.getByTestId('expired-session-link');

    await expect(expiredLink).toBeVisible();
    await expect(iframe).toHaveCSS('pointer-events', 'none');

    const expiredUrl = await preview.locator('html').evaluate(() => window.location.href);
    const expiredLinkBox = await expiredLink.boundingBox();

    expect(expiredLinkBox, 'the expired-session frame must expose visible hit-test geometry')
      .not.toBeNull();

    if (touch) {
      await page.touchscreen.tap(
        expiredLinkBox!.x + expiredLinkBox!.width / 2,
        expiredLinkBox!.y + expiredLinkBox!.height / 2,
      );
    } else {
      await page.mouse.click(
        expiredLinkBox!.x + expiredLinkBox!.width / 2,
        expiredLinkBox!.y + expiredLinkBox!.height / 2,
      );
    }

    await expect.poll(
      () => preview.locator('html').evaluate(() => window.location.href),
      { message: 'a same-frame expired-session replacement must remain inert' },
    ).toBe(expiredUrl);
  } finally {
    await page.unroute(expiredSessionRoute, handleExpiredSession);
  }

  await refreshButton.click();
  await expectPreviewDocumentMatchesFrameSource(iframe, preview, baseURL);

  await expect(iframe).toHaveCSS('pointer-events', 'auto');
}

async function expectSelectedServiceSummary({
  addOn,
  page,
  presetId,
  service,
}: {
  addOn: AddOnFixtureRow;
  page: Page;
  presetId: BookingPagePresetId;
  service: ServiceFixtureRow;
}): Promise<void> {
  const serviceCard = page.getByTestId(`service-card-${service.id}`);
  const stickyBar = page.getByTestId('service-sticky-bar');
  const formatPrice = (cents: number) => new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

  await expect.poll(
    () => serviceCard.evaluate(element => !(element as HTMLButtonElement).disabled),
  ).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 0));

  if (presetId === 'quick_book') {
    await expect(page.getByTestId('editorial-sticky-cta')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('editorial-sticky-cta')).toBeVisible();
  }

  await expect(stickyBar).toHaveCount(0);

  // Trigger the real hydrated service-card handler without scrolling the
  // Editorial anchor into its handoff position. This discriminates the Fable
  // regression: selection itself must outrank the marketing jump CTA.
  await serviceCard.evaluate(element => (element as HTMLButtonElement).click());

  await expect(page.getByTestId('editorial-sticky-cta')).toHaveCount(0);
  await expect(stickyBar).toBeVisible();
  await expect(stickyBar).toContainText('1 service');
  await expect(stickyBar).toContainText(formatPrice(service.price));
  await expect(stickyBar).toContainText(formatDuration(service.duration_minutes));
  await expect(page.getByTestId('service-continue-button')).toBeVisible();

  const increaseAddOn = page.getByRole('button', {
    name: `Increase ${addOn.name} quantity`,
  });

  await expect(increaseAddOn).toBeEnabled();

  await increaseAddOn.click();

  await expect(stickyBar).toContainText('1 service + 1 add-on');
  await expect(stickyBar).toContainText(formatPrice(service.price + addOn.price_cents));
  await expect(stickyBar).toContainText(formatDuration(
    service.duration_minutes + addOn.duration_minutes,
  ));
  await expect.poll(() => new URL(page.url()).searchParams.get('baseServiceId'))
    .toBe(service.id);
  await expect.poll(() => new URL(page.url()).searchParams.get('selectedAddOns'))
    .toContain(SYNTHETIC_ACCESSIBLE_ADD_ON_ID);
}

test.describe.configure({ mode: 'serial' });

test('Quick Book and Editorial keep one canonical booking spine across mobile and 200% zoom @mobile-layout', async ({
  baseURL,
  browser,
}) => {
  test.slow();

  assertLocalSyntheticTarget(baseURL);

  const target = requireDisposableDatabaseTarget();
  const expectedServer = resolveDisposableDatabaseServerExpectation(target);
  const client = new Client({ connectionString: target.connectionString });
  let originalSettings: unknown = null;
  let fixtureLoaded = false;

  await client.connect();

  try {
    // Static target rejection is not enough: attest the connected PostgreSQL
    // session before the first fixture read or mutation.
    await attestDisposableDatabaseSession(client, target, expectedServer);

    const fixtureResult = await client.query<SalonFixtureRow>(
      'SELECT id, name, settings FROM salon WHERE slug = $1',
      [SYNTHETIC_SALON_SLUG],
    );

    expect(fixtureResult.rows).toHaveLength(1);
    expect(fixtureResult.rows[0]?.id).toBe(SYNTHETIC_SALON_ID);

    const salonName = fixtureResult.rows[0]?.name;

    expect(salonName).toBeTruthy();

    originalSettings = fixtureResult.rows[0]?.settings ?? null;
    fixtureLoaded = true;

    const layoutSnapshots = new Map<Layout, FeaturedServiceSnapshot[]>();

    for (const layout of ['quick_book', 'editorial'] as const) {
      const heroImageUrl = new URL('/assets/images/nextjs-starter-banner.png', baseURL).toString();
      const fixtureSettings = buildFixtureSettings(originalSettings, layout, heroImageUrl);
      const updateResult = await client.query(
        'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
        [JSON.stringify(fixtureSettings), SYNTHETIC_SALON_ID],
      );

      expect(updateResult.rowCount).toBe(1);

      for (const scenario of VIEWPORT_SCENARIOS) {
        const context = await browser.newContext({
          baseURL,
          reducedMotion: 'reduce',
          viewport: scenario.viewport,
        });

        if (scenario.zoom === 2) {
          await context.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => {
              document.documentElement.style.zoom = '2';
            });
          });
        }

        const attemptedWrites: string[] = [];
        const externalRequests: string[] = [];

        try {
          const page = await context.newPage();
          const expectedOrigin = new URL(baseURL).origin;

          await page.route('**/*', async (route) => {
            const request = route.request();
            const method = request.method();
            const requestUrl = request.url();

            if (method !== 'GET' && method !== 'HEAD') {
              attemptedWrites.push(`${method} ${requestUrl}`);
              await route.abort('blockedbyclient');
              return;
            }
            if (new URL(requestUrl).origin !== expectedOrigin) {
              externalRequests.push(requestUrl);
              await route.abort('blockedbyclient');
              return;
            }

            await route.continue();
          });

          const response = await page.goto(
            `${appPath(`/${SYNTHETIC_SALON_SLUG}/book/service`)}?layoutEvidence=${layout}-${scenario.label}`,
            { waitUntil: 'domcontentloaded' },
          );

          expect(response?.ok(), await response?.text()).toBe(true);
          await expect(page.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();

          const snapshot = await expectLayoutStructure(page, layout, salonName!);

          expect(snapshot.length, `${layout} must render real featured service content`).toBeGreaterThan(0);

          const baseline = layoutSnapshots.get(layout);
          if (baseline) {
            expect(snapshot, `${layout} structure/content must remain stable at ${scenario.label}`).toEqual(baseline);
          } else {
            layoutSnapshots.set(layout, snapshot);
          }

          expect(attemptedWrites, 'The layout parity browser walk must not create appointments or payments.').toEqual([]);
          expect(externalRequests, 'The deterministic browser lane must not depend on hosted resources.').toEqual([]);
        } finally {
          await context.close();
        }
      }
    }

    const quickBookSnapshot = layoutSnapshots.get('quick_book') ?? [];
    const editorialSnapshot = layoutSnapshots.get('editorial') ?? [];

    expect(editorialSnapshot.map(service => service.id)).toEqual(
      quickBookSnapshot.map(service => service.id),
    );

    const featuredIds = quickBookSnapshot.map(service => service.id);
    const serviceResult = await client.query<ServiceFixtureRow>(
      'SELECT id, name FROM service WHERE salon_id = $1 AND id = ANY($2::text[]) ORDER BY id',
      [SYNTHETIC_SALON_ID, featuredIds],
    );
    const canonicalNames = new Map(serviceResult.rows.map(service => [service.id, service.name]));

    expect(canonicalNames.size).toBe(featuredIds.length);

    for (const service of quickBookSnapshot) {
      const canonicalName = canonicalNames.get(service.id);

      expect(canonicalName).toBeTruthy();
      expect(service.text).toContain(canonicalName);
      expect(editorialSnapshot.find(item => item.id === service.id)?.text).toContain(canonicalName);
    }
  } finally {
    try {
      if (fixtureLoaded) {
        await client.query(
          'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
          [originalSettings === null ? null : JSON.stringify(originalSettings), SYNTHETIC_SALON_ID],
        );
      }
    } finally {
      await client.end();
    }
  }
});

test('Stage 7 production recipes express four curated structures with one canonical content truth across mobile and zoom @mobile-layout', async ({
  baseURL,
  browser,
}) => {
  test.slow();

  assertLocalSyntheticTarget(baseURL);

  const target = requireDisposableDatabaseTarget();
  const expectedServer = resolveDisposableDatabaseServerExpectation(target);
  const client = new Client({ connectionString: target.connectionString });
  let originalSettings: unknown = null;
  let fixtureLoaded = false;

  await client.connect();

  try {
    await attestDisposableDatabaseSession(client, target, expectedServer);

    const fixtureResult = await client.query<SalonFixtureRow>(
      'SELECT id, name, settings FROM salon WHERE slug = $1',
      [SYNTHETIC_SALON_SLUG],
    );

    expect(fixtureResult.rows).toHaveLength(1);
    expect(fixtureResult.rows[0]?.id).toBe(SYNTHETIC_SALON_ID);

    const salonName = fixtureResult.rows[0]?.name;

    expect(salonName).toBeTruthy();

    originalSettings = fixtureResult.rows[0]?.settings ?? null;
    fixtureLoaded = true;

    const serviceResult = await client.query<ServiceFixtureRow>(
      'SELECT id, name, price, price_display_text, duration_minutes FROM service WHERE salon_id = $1 AND id = $2',
      [SYNTHETIC_SALON_ID, e2eConfig.serviceId],
    );
    const addOnResult = await client.query<AddOnFixtureRow>(
      `SELECT name, price_cents, duration_minutes
       FROM add_on
       WHERE salon_id = $1 AND id = $2 AND is_active = true`,
      [SYNTHETIC_SALON_ID, SYNTHETIC_ACCESSIBLE_ADD_ON_ID],
    );
    const technicianResult = await client.query<TechnicianFixtureRow>(
      `SELECT id, name, email, phone
       FROM technician
       WHERE salon_id = $1
         AND is_active = true
         AND (NULLIF(BTRIM(bio), '') IS NOT NULL OR NULLIF(BTRIM(avatar_url), '') IS NOT NULL)
       ORDER BY id`,
      [SYNTHETIC_SALON_ID],
    );

    expect(serviceResult.rows).toHaveLength(1);
    expect(addOnResult.rows).toHaveLength(1);
    expect(technicianResult.rows.length).toBeGreaterThan(0);

    const canonicalServiceName = serviceResult.rows[0]!.name;
    const canonicalDuration = formatDuration(serviceResult.rows[0]!.duration_minutes);
    const canonicalPrice = serviceResult.rows[0]!.price_display_text ?? new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: serviceResult.rows[0]!.price % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(serviceResult.rows[0]!.price / 100);
    const presetSnapshots = new Map<BookingPagePresetId, Stage7PresetSnapshot>();

    for (const presetId of BOOKING_PAGE_PRESET_IDS) {
      const recipe = resolveBookingPagePresetRecipe({
        presetId,
        recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
      });

      expect(recipe, `${presetId} must resolve through the production recipe contract`).not.toBeNull();

      const heroImageUrl = new URL('/assets/images/nextjs-starter-banner.png', baseURL).toString();
      const fixtureSettings = buildFixtureSettings(
        originalSettings,
        recipe!.layout,
        heroImageUrl,
        {
          businessMode: 'team',
          hiddenSections: recipe!.hiddenSections,
          presetBase: recipe!.presetBase,
          sectionOrder: recipe!.sectionOrder,
          sectionVariants: recipe!.sectionVariants,
        },
      );
      const updateResult = await client.query(
        'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
        [JSON.stringify(fixtureSettings), SYNTHETIC_SALON_ID],
      );

      expect(updateResult.rowCount).toBe(1);

      for (const scenario of VIEWPORT_SCENARIOS) {
        const context = await browser.newContext({
          baseURL,
          reducedMotion: 'reduce',
          viewport: scenario.viewport,
        });

        if (scenario.zoom === 2) {
          await context.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => {
              document.documentElement.style.zoom = '2';
            });
          });
        }

        const attemptedWrites: string[] = [];
        const externalRequests: string[] = [];

        try {
          const page = await context.newPage();
          const expectedOrigin = new URL(baseURL).origin;

          await page.route('**/*', async (route) => {
            const request = route.request();
            const method = request.method();
            const requestUrl = request.url();

            if (method !== 'GET' && method !== 'HEAD') {
              attemptedWrites.push(`${method} ${requestUrl}`);
              await route.abort('blockedbyclient');
              return;
            }
            if (new URL(requestUrl).origin !== expectedOrigin) {
              externalRequests.push(requestUrl);
              await route.abort('blockedbyclient');
              return;
            }

            await route.continue();
          });

          const response = await page.goto(
            `${appPath(`/${SYNTHETIC_SALON_SLUG}/book/service`)}?stage7Evidence=${presetId}-${scenario.label}`,
            { waitUntil: 'domcontentloaded' },
          );

          expect(response?.ok(), await response?.text()).toBe(true);
          await expect(page.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();

          const snapshot = await expectStage7PresetStructure(
            page,
            presetId,
            salonName!,
            technicianResult.rows,
          );

          expect(snapshot.serviceText).toContain(canonicalServiceName);
          expect(snapshot.serviceText).toContain(canonicalDuration);
          expect(snapshot.serviceText).toContain(canonicalPrice);
          expect(snapshot.policyText).toBe('Please arrive five minutes before your synthetic appointment.');
          expect(snapshot.socialHref).toBe('https://www.instagram.com/luster-stage4-fixture');

          await expectSelectedServiceSummary({
            addOn: addOnResult.rows[0]!,
            page,
            presetId,
            service: serviceResult.rows[0]!,
          });

          const baseline = presetSnapshots.get(presetId);
          if (baseline) {
            expect(snapshot, `${presetId} must remain stable at ${scenario.label}`).toEqual(baseline);
          } else {
            presetSnapshots.set(presetId, snapshot);
          }

          expect(attemptedWrites, 'The Stage 7 browser walk must not create appointments or payments.').toEqual([]);
          expect(externalRequests, 'The deterministic Stage 7 lane must not depend on hosted resources.').toEqual([]);
        } finally {
          await context.close();
        }
      }
    }

    expect(presetSnapshots.size).toBe(4);
    expect(new Set([...presetSnapshots.values()].map(snapshot => snapshot.structure)).size).toBe(4);
    expect(new Set([...presetSnapshots.values()].map(snapshot => snapshot.serviceText)).size).toBe(1);
    expect(new Set([...presetSnapshots.values()].map(snapshot => snapshot.policyText)).size).toBe(1);
    expect(new Set([...presetSnapshots.values()].map(snapshot => snapshot.socialHref)).size).toBe(1);
    expect(presetSnapshots.get('signature')?.technicianNames).toEqual(
      presetSnapshots.get('collective')?.technicianNames,
    );
  } finally {
    try {
      if (fixtureLoaded) {
        const restoreResult = await client.query(
          'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
          [originalSettings === null ? null : JSON.stringify(originalSettings), SYNTHETIC_SALON_ID],
        );

        expect(restoreResult.rowCount).toBe(1);

        const restoredResult = await client.query<SalonFixtureRow>(
          'SELECT id, name, settings FROM salon WHERE id = $1',
          [SYNTHETIC_SALON_ID],
        );

        expect(restoredResult.rows).toHaveLength(1);
        expect(restoredResult.rows[0]?.settings ?? null).toEqual(originalSettings);
      }
    } finally {
      await client.end();
    }
  }
});

test('owner preset previews start at the real page top and refresh from authoritative draft state @owner-preview-webkit', async ({
  baseURL,
  browser,
}, testInfo) => {
  test.setTimeout(3 * 60 * 1000);

  assertLocalSyntheticTarget(baseURL);

  const target = requireDisposableDatabaseTarget();
  const expectedServer = resolveDisposableDatabaseServerExpectation(target);
  const client = new Client({ connectionString: target.connectionString });
  let originalSettings: unknown = null;
  let fixtureLoaded = false;

  await client.connect();

  try {
    await attestDisposableDatabaseSession(client, target, expectedServer);

    const fixtureResult = await client.query<SalonFixtureRow>(
      'SELECT id, name, settings FROM salon WHERE slug = $1',
      [SYNTHETIC_SALON_SLUG],
    );

    expect(fixtureResult.rows).toHaveLength(1);
    expect(fixtureResult.rows[0]?.id).toBe(SYNTHETIC_SALON_ID);

    originalSettings = fixtureResult.rows[0]?.settings ?? null;
    fixtureLoaded = true;

    for (const scenario of OWNER_PREVIEW_VIEWPORT_SCENARIOS) {
      const heroImageUrl = new URL('/assets/images/nextjs-starter-banner.png', baseURL).toString();
      const fixtureSettings = buildFixtureSettings(
        originalSettings,
        'editorial',
        heroImageUrl,
        {
          businessMode: 'team',
          hiddenSections: [],
          sectionOrder: ALL_PRESENTATION_SECTION_ORDER,
          sectionVariants: {
            salonProfile: 'compact',
            technicianProfile: 'full',
            featuredServices: 'carousel',
            serviceMenu: 'list',
            hoursLocation: 'full',
            policies: 'card',
            socialLinks: 'icons',
            bookingCta: 'sticky',
          },
        },
      );
      const fixtureUpdate = await client.query(
        'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
        [JSON.stringify(fixtureSettings), SYNTHETIC_SALON_ID],
      );

      expect(fixtureUpdate.rowCount).toBe(1);

      const iphone = devices['iPhone 13'];
      const mobileWebKitOptions = testInfo.project.name === 'mobile-webkit'
        ? {
            deviceScaleFactor: iphone.deviceScaleFactor,
            hasTouch: iphone.hasTouch,
            isMobile: iphone.isMobile,
            userAgent: iphone.userAgent,
          }
        : {};
      const context = await browser.newContext({
        ...mobileWebKitOptions,
        baseURL,
        reducedMotion: 'reduce',
        storageState: authStatePaths.superAdmin,
        viewport: scenario.viewport,
      });
      let impersonating = false;

      if (scenario.zoom === 2) {
        await context.addInitScript(() => {
          document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.style.zoom = '2';
          });
        });
      }

      try {
        const impersonation = await context.request.post('/api/super-admin/impersonate', {
          data: { salonId: SYNTHETIC_SALON_ID },
        });

        expect(impersonation.ok(), await impersonation.text()).toBe(true);

        impersonating = true;

        const page = await context.newPage();
        const exerciseViewOnlyInput = testInfo.project.name === 'mobile-webkit'
          || scenario === OWNER_PREVIEW_VIEWPORT_SCENARIOS[0];
        const response = await page.goto(
          `${appPath('/admin/booking-page')}?salon=${encodeURIComponent(SYNTHETIC_SALON_SLUG)}&ownerPreviewEvidence=${encodeURIComponent(scenario.label)}`,
          { waitUntil: 'domcontentloaded' },
        );

        expect(response?.ok(), await response?.text()).toBe(true);

        const previewIframe = page.locator('iframe[title="Live booking page preview"]');
        const preview = page.frameLocator('iframe[title="Live booking page preview"]');

        await expect(page.getByTestId('booking-page-builder')).toBeVisible();
        await expect(previewIframe).toHaveAttribute('sandbox', 'allow-same-origin');

        await expectPreviewDocumentMatchesFrameSource(previewIframe, preview, baseURL);

        await expectPreviewStartsAtTop(
          preview,
          'booking-step-header',
          `${scenario.label} initial embedded preview`,
        );
        await expectRestoredPreviewScrollIsNormalized({
          evidenceLabel: `${scenario.label} initial embedded preview`,
          iframe: previewIframe,
          preview,
          topMarkerTestId: 'booking-step-header',
        });
        if (exerciseViewOnlyInput) {
          await expectViewOnlyPreviewScrollsWithoutActivation({
            evidenceLabel: `${scenario.label} initial embedded preview`,
            iframe: previewIframe,
            page,
            preview,
            scrollInput: testInfo.project.name === 'mobile-webkit' ? 'engine' : 'wheel',
            topMarkerTestId: 'booking-step-header',
          });
          await expectPreAttestationPreviewCannotActivate({
            baseURL,
            iframe: previewIframe,
            page,
            preview,
            refreshButton: page.getByTestId('booking-page-preview-refresh'),
            touch: testInfo.project.name === 'mobile-webkit',
          });
        }
        if (testInfo.project.name !== 'mobile-webkit' && exerciseViewOnlyInput) {
          await page.getByTestId('booking-page-preview-link').focus();
          await page.keyboard.press('Tab');

          await expect(page.getByTestId('booking-page-preview-refresh')).toBeFocused();
        }

        for (const presetId of BOOKING_PAGE_PRESET_IDS) {
          const presetLabel = STAGE7_PRESET_LABELS[presetId];
          const beforeState = await fetchBuilderApiState(page);
          const beforePreviewSrc = await previewIframe.getAttribute('src');

          await page.getByRole('button', {
            name: `${presetLabel} starting design`,
          }).click();

          let reviewDialog = page.getByRole('alertdialog', {
            name: `Switch to ${presetLabel}?`,
          });

          await expect(reviewDialog).toBeVisible();

          let reviewIframe = reviewDialog.locator(`iframe[title="${presetLabel} design preview"]`);
          let reviewPreview = page.frameLocator(`iframe[title="${presetLabel} design preview"]`);
          const topMarkerTestId = STAGE7_PRESET_DOM_EXPECTATIONS[presetId].present[0];

          await expect(reviewIframe).toHaveAttribute('sandbox', 'allow-same-origin');
          await expect(reviewIframe).toHaveAttribute('aria-hidden', 'true');
          await expect(reviewIframe).toHaveAttribute('tabindex', '-1');

          await expectPreviewDocumentMatchesFrameSource(reviewIframe, reviewPreview, baseURL);

          await expectPreviewStartsAtTop(
            reviewPreview,
            topMarkerTestId,
            `${scenario.label} ${presetLabel} review preview`,
          );
          await expectRestoredPreviewScrollIsNormalized({
            evidenceLabel: `${scenario.label} ${presetLabel} review preview`,
            iframe: reviewIframe,
            preview: reviewPreview,
            topMarkerTestId,
          });
          if (exerciseViewOnlyInput) {
            await expectViewOnlyPreviewScrollsWithoutActivation({
              evidenceLabel: `${scenario.label} ${presetLabel} review preview`,
              iframe: reviewIframe,
              page,
              preview: reviewPreview,
              scrollInput: testInfo.project.name === 'mobile-webkit' ? 'engine' : 'wheel',
              topMarkerTestId,
            });
          }
          if (testInfo.project.name !== 'mobile-webkit' && exerciseViewOnlyInput) {
            await reviewDialog.getByRole('button', { name: 'Cancel' }).focus();
            await page.keyboard.press('Shift+Tab');

            await expect(reviewDialog.getByRole('button', { name: `Use ${presetLabel}` }))
              .toBeFocused();
          }

          const beforeCancelState = await fetchBuilderApiState(page);

          await reviewDialog.getByRole('button', { name: 'Cancel' }).click();

          await expect(reviewDialog).toHaveCount(0);
          expect(await fetchBuilderApiState(page)).toEqual(beforeCancelState);

          await page.getByRole('button', {
            name: `${presetLabel} starting design`,
          }).click();
          reviewDialog = page.getByRole('alertdialog', {
            name: `Switch to ${presetLabel}?`,
          });
          reviewIframe = reviewDialog.locator(`iframe[title="${presetLabel} design preview"]`);
          reviewPreview = page.frameLocator(`iframe[title="${presetLabel} design preview"]`);

          await expectPreviewDocumentMatchesFrameSource(reviewIframe, reviewPreview, baseURL);

          await expectPreviewStartsAtTop(
            reviewPreview,
            topMarkerTestId,
            `${scenario.label} reopened ${presetLabel} review preview`,
          );

          const operation = {
            type: 'apply_preset',
            presetId,
            presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
            expectedPresentationSignature: getBookingPagePresentationSignature({
              ...beforeState.config.draft,
              presetBase: beforeState.config.draftPresetBase,
            }),
          } as const;

          const appliedState = await applyBuilderOperationFromPage(
            page,
            operation,
            () => reviewDialog.getByRole('button', { name: `Use ${presetLabel}` }).click(),
          );

          expect(appliedState.config.draftPresetBase).toEqual({
            presetId,
            recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
          });
          expect(appliedState.config.live).toEqual(beforeState.config.live);
          expect(appliedState.config.livePresetBase).toEqual(beforeState.config.livePresetBase);
          await expect(page.getByTestId('booking-page-preset-state')).toHaveText(presetLabel);
          await expect(page.getByTestId('booking-page-preset-picker').getByRole('status')).toContainText(
            'Starting design applied to your draft. Review the preview, then publish when you’re ready.',
          );
          await expect.poll(() => previewIframe.getAttribute('src')).not.toBe(beforePreviewSrc);

          await expectPreviewDocumentMatchesFrameSource(previewIframe, preview, baseURL);

          await expectPreviewStartsAtTop(
            preview,
            topMarkerTestId,
            `${scenario.label} applied ${presetLabel} embedded preview`,
          );
          await expectRestoredPreviewScrollIsNormalized({
            evidenceLabel: `${scenario.label} applied ${presetLabel} embedded preview`,
            iframe: previewIframe,
            preview,
            topMarkerTestId,
          });
        }

        await expectNoHorizontalOverflow(page);
      } finally {
        if (impersonating) {
          const stopImpersonation = await context.request.delete('/api/super-admin/impersonate');

          expect(stopImpersonation.ok(), await stopImpersonation.text()).toBe(true);
        }

        await context.close();
      }
    }
  } finally {
    try {
      if (fixtureLoaded) {
        const restoreResult = await client.query(
          'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
          [originalSettings === null ? null : JSON.stringify(originalSettings), SYNTHETIC_SALON_ID],
        );

        expect(restoreResult.rowCount).toBe(1);
      }
    } finally {
      await client.end();
    }
  }
});

test('owner preset draft, full-page preview, publish, and fresh public state stay synchronized @mobile-chrome', async ({
  baseURL,
  browser,
}) => {
  test.setTimeout(3 * 60 * 1000);

  assertLocalSyntheticTarget(baseURL);

  const target = requireDisposableDatabaseTarget();
  const expectedServer = resolveDisposableDatabaseServerExpectation(target);
  const client = new Client({ connectionString: target.connectionString });
  let originalSettings: unknown = null;
  let fixtureLoaded = false;

  await client.connect();

  try {
    await attestDisposableDatabaseSession(client, target, expectedServer);

    const fixtureResult = await client.query<SalonFixtureRow>(
      'SELECT id, name, settings FROM salon WHERE slug = $1',
      [SYNTHETIC_SALON_SLUG],
    );

    expect(fixtureResult.rows).toHaveLength(1);
    expect(fixtureResult.rows[0]?.id).toBe(SYNTHETIC_SALON_ID);

    const salonName = fixtureResult.rows[0]?.name;

    expect(salonName).toBeTruthy();

    const technicianResult = await client.query<TechnicianFixtureRow>(
      `SELECT id, name, email, phone
       FROM technician
       WHERE salon_id = $1
         AND is_active = true
         AND (NULLIF(BTRIM(bio), '') IS NOT NULL OR NULLIF(BTRIM(avatar_url), '') IS NOT NULL)
       ORDER BY id`,
      [SYNTHETIC_SALON_ID],
    );

    expect(technicianResult.rows.length).toBeGreaterThan(0);

    originalSettings = fixtureResult.rows[0]?.settings ?? null;
    fixtureLoaded = true;

    const startingRecipe = resolveBookingPagePresetRecipe({
      presetId: 'collective',
      recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
    });

    expect(startingRecipe).not.toBeNull();

    const heroImageUrl = new URL('/assets/images/nextjs-starter-banner.png', baseURL).toString();
    const fixtureSettings = buildFixtureSettings(
      originalSettings,
      startingRecipe!.layout,
      heroImageUrl,
      {
        businessMode: 'team',
        hiddenSections: startingRecipe!.hiddenSections,
        presetBase: startingRecipe!.presetBase,
        sectionOrder: startingRecipe!.sectionOrder,
        sectionVariants: startingRecipe!.sectionVariants,
      },
    );
    const fixtureUpdate = await client.query(
      'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
      [JSON.stringify(fixtureSettings), SYNTHETIC_SALON_ID],
    );

    expect(fixtureUpdate.rowCount).toBe(1);

    const ownerContext = await browser.newContext({
      baseURL,
      reducedMotion: 'reduce',
      storageState: authStatePaths.superAdmin,
      viewport: { width: 390, height: 664 },
    });
    let impersonating = false;

    try {
      const impersonation = await ownerContext.request.post('/api/super-admin/impersonate', {
        data: { salonId: SYNTHETIC_SALON_ID },
      });

      expect(impersonation.ok(), await impersonation.text()).toBe(true);

      impersonating = true;

      const builderPage = await ownerContext.newPage();
      const builderResponse = await builderPage.goto(
        `${appPath('/admin/booking-page')}?salon=${encodeURIComponent(SYNTHETIC_SALON_SLUG)}&ownerPublishEvidence=1`,
        { waitUntil: 'domcontentloaded' },
      );

      expect(builderResponse?.ok(), await builderResponse?.text()).toBe(true);

      let currentLivePreset: BookingPagePresetId = 'collective';

      for (const presetId of BOOKING_PAGE_PRESET_IDS) {
        const presetLabel = STAGE7_PRESET_LABELS[presetId];
        const beforeState = await fetchBuilderApiState(builderPage);

        expect(beforeState.config.draft).toEqual(beforeState.config.live);
        expect(beforeState.config.draftPresetBase).toEqual(beforeState.config.livePresetBase);
        expect(beforeState.config.livePresetBase).toEqual({
          presetId: currentLivePreset,
          recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
        });

        await builderPage.getByRole('button', {
          name: `${presetLabel} starting design`,
        }).click();

        const reviewDialog = builderPage.getByRole('alertdialog', {
          name: `Switch to ${presetLabel}?`,
        });
        const applyOperation = {
          type: 'apply_preset',
          presetId,
          presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
          expectedPresentationSignature: getBookingPagePresentationSignature({
            ...beforeState.config.draft,
            presetBase: beforeState.config.draftPresetBase,
          }),
        } as const;
        const appliedState = await applyBuilderOperationFromPage(
          builderPage,
          applyOperation,
          () => reviewDialog.getByRole('button', { name: `Use ${presetLabel}` }).click(),
        );

        expect(appliedState.config.draftPresetBase).toEqual({
          presetId,
          recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
        });
        expect(appliedState.config.livePresetBase).toEqual({
          presetId: currentLivePreset,
          recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
        });
        await expect(builderPage.getByTestId('booking-page-preset-state')).toHaveText(presetLabel);
        await expect(builderPage.getByTestId('booking-page-preset-picker').getByRole('status')).toContainText(
          'Starting design applied to your draft. Review the preview, then publish when you’re ready.',
        );

        const fullPreviewLink = builderPage.getByTestId('booking-page-preview-link');

        await expect(fullPreviewLink).toHaveAttribute('href');

        const fullPreviewHref = await fullPreviewLink.getAttribute('href');

        expect(fullPreviewHref).not.toBeNull();

        const fullPreviewPage = await ownerContext.newPage();

        try {
          const fullPreviewResponse = await fullPreviewPage.goto(fullPreviewHref!, {
            waitUntil: 'domcontentloaded',
          });

          expect(fullPreviewResponse?.ok(), await fullPreviewResponse?.text()).toBe(true);
          await expect(fullPreviewPage.getByTestId('owner-preview-banner')).toBeVisible();

          await expectStage7PresetStructure(
            fullPreviewPage,
            presetId,
            salonName!,
            technicianResult.rows,
          );

          await expect.poll(() => fullPreviewPage.evaluate(() => ({
            bodyScrollTop: document.body.scrollTop,
            documentScrollTop: document.documentElement.scrollTop,
            scrollY: window.scrollY,
          }))).toEqual({ bodyScrollTop: 0, documentScrollTop: 0, scrollY: 0 });
        } finally {
          await fullPreviewPage.close();
        }

        const unpublishedContext = await browser.newContext({
          baseURL,
          reducedMotion: 'reduce',
          viewport: { width: 390, height: 664 },
        });

        try {
          const unpublishedPage = await unpublishedContext.newPage();
          const unpublishedResponse = await unpublishedPage.goto(
            `${appPath(`/${SYNTHETIC_SALON_SLUG}/book/service`)}?ownerPublishEvidence=before-${presetId}`,
            { waitUntil: 'domcontentloaded' },
          );

          expect(unpublishedResponse?.ok(), await unpublishedResponse?.text()).toBe(true);
          await expect(unpublishedPage.getByTestId('owner-preview-banner')).toHaveCount(0);

          await expectStage7PresetStructure(
            unpublishedPage,
            currentLivePreset,
            salonName!,
            technicianResult.rows,
          );
        } finally {
          await unpublishedContext.close();
        }

        await builderPage.getByTestId('booking-page-publish').click();

        await expect(builderPage.getByText(
          'Published. Your live booking page now matches your draft.',
          { exact: true },
        )).toBeVisible();
        await expect.poll(async () => {
          const publishedState = await fetchBuilderApiState(builderPage);

          return {
            draft: publishedState.config.draft,
            draftPresetBase: publishedState.config.draftPresetBase,
            live: publishedState.config.live,
            livePresetBase: publishedState.config.livePresetBase,
          };
        }).toEqual({
          draft: appliedState.config.draft,
          draftPresetBase: appliedState.config.draftPresetBase,
          live: appliedState.config.draft,
          livePresetBase: appliedState.config.draftPresetBase,
        });

        const publishedContext = await browser.newContext({
          baseURL,
          reducedMotion: 'reduce',
          viewport: { width: 390, height: 664 },
        });

        try {
          const publishedPage = await publishedContext.newPage();
          const publishedResponse = await publishedPage.goto(
            `${appPath(`/${SYNTHETIC_SALON_SLUG}/book/service`)}?ownerPublishEvidence=after-${presetId}`,
            { waitUntil: 'domcontentloaded' },
          );

          expect(publishedResponse?.ok(), await publishedResponse?.text()).toBe(true);
          await expect(publishedPage.getByTestId('owner-preview-banner')).toHaveCount(0);

          await expectStage7PresetStructure(
            publishedPage,
            presetId,
            salonName!,
            technicianResult.rows,
          );
        } finally {
          await publishedContext.close();
        }

        await builderPage.reload({ waitUntil: 'domcontentloaded' });

        await expect(builderPage.getByTestId('booking-page-preset-state')).toHaveText(presetLabel);

        currentLivePreset = presetId;
      }
    } finally {
      try {
        if (impersonating) {
          const stopImpersonation = await ownerContext.request.delete('/api/super-admin/impersonate');

          expect(stopImpersonation.ok(), await stopImpersonation.text()).toBe(true);
        }
      } finally {
        await ownerContext.close();
      }
    }
  } finally {
    try {
      if (fixtureLoaded) {
        const restoreResult = await client.query(
          'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
          [originalSettings === null ? null : JSON.stringify(originalSettings), SYNTHETIC_SALON_ID],
        );

        expect(restoreResult.rowCount).toBe(1);
      }
    } finally {
      await client.end();
    }
  }
});

test('Stage 7 owner preset confirmation updates only the real draft preview and preserves Stage 6 keyboard/reset evidence @mobile-layout', async ({
  baseURL,
  browser,
}) => {
  test.slow();

  assertLocalSyntheticTarget(baseURL);

  const target = requireDisposableDatabaseTarget();
  const expectedServer = resolveDisposableDatabaseServerExpectation(target);
  const client = new Client({ connectionString: target.connectionString });
  let originalSettings: unknown = null;
  let fixtureLoaded = false;

  await client.connect();

  try {
    // Authentication alone is not authority to mutate a browser fixture.
    // Attest the connected disposable session before the first salon read,
    // impersonation, direct fixture update, or semantic builder PATCH.
    await attestDisposableDatabaseSession(client, target, expectedServer);

    const fixtureResult = await client.query<SalonFixtureRow>(
      'SELECT id, name, settings FROM salon WHERE slug = $1',
      [SYNTHETIC_SALON_SLUG],
    );

    expect(fixtureResult.rows).toHaveLength(1);
    expect(fixtureResult.rows[0]?.id).toBe(SYNTHETIC_SALON_ID);

    const serviceResult = await client.query<Pick<ServiceFixtureRow, 'name'>>(
      'SELECT name FROM service WHERE salon_id = $1 AND id = $2',
      [SYNTHETIC_SALON_ID, e2eConfig.serviceId],
    );

    expect(serviceResult.rows).toHaveLength(1);

    const canonicalServiceName = serviceResult.rows[0]!.name;

    originalSettings = fixtureResult.rows[0]?.settings ?? null;
    fixtureLoaded = true;

    for (const scenario of VIEWPORT_SCENARIOS) {
      const heroImageUrl = new URL('/assets/images/nextjs-starter-banner.png', baseURL).toString();
      const fixtureSettings = buildFixtureSettings(
        originalSettings,
        'editorial',
        heroImageUrl,
        {
          businessMode: 'team',
          hiddenSections: [],
          sectionOrder: ALL_PRESENTATION_SECTION_ORDER,
          sectionVariants: {
            salonProfile: 'compact',
            technicianProfile: 'full',
            featuredServices: 'carousel',
            serviceMenu: 'list',
            hoursLocation: 'full',
            policies: 'card',
            socialLinks: 'icons',
            bookingCta: 'sticky',
          },
        },
      );
      const fixtureUpdate = await client.query(
        'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
        [JSON.stringify(fixtureSettings), SYNTHETIC_SALON_ID],
      );

      expect(fixtureUpdate.rowCount).toBe(1);

      const context = await browser.newContext({
        baseURL,
        reducedMotion: 'reduce',
        storageState: authStatePaths.superAdmin,
        viewport: scenario.viewport,
      });
      let impersonating = false;

      if (scenario.zoom === 2) {
        await context.addInitScript(() => {
          document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.style.zoom = '2';
          });
        });
      }

      try {
        const impersonation = await context.request.post('/api/super-admin/impersonate', {
          data: { salonId: SYNTHETIC_SALON_ID },
        });

        expect(impersonation.ok(), await impersonation.text()).toBe(true);

        impersonating = true;

        const page = await context.newPage();
        const expectedOrigin = new URL(baseURL).origin;
        const allowedBuilderPatches: unknown[] = [];
        const blockedWrites: string[] = [];
        const externalRequests: string[] = [];

        await page.route('**/*', async (route) => {
          const request = route.request();
          const method = request.method();
          const requestUrl = request.url();
          const parsedUrl = new URL(requestUrl);

          if (parsedUrl.origin !== expectedOrigin) {
            // The authenticated admin shell may attempt its exact reserved
            // `.invalid` Clerk bootstrap. It is pre-existing auth plumbing,
            // remains blocked, and is not a Stage 6 hosted dependency. Every
            // other external request is still recorded and fails the lane.
            if (requestUrl !== SYNTHETIC_CI_CLERK_BOOTSTRAP_URL) {
              externalRequests.push(requestUrl);
            }
            await route.abort('blockedbyclient');
            return;
          }

          if (method === 'PATCH' && parsedUrl.pathname === '/api/admin/booking-page') {
            allowedBuilderPatches.push(request.postDataJSON());
            await route.continue();
            return;
          }

          if (method !== 'GET' && method !== 'HEAD') {
            blockedWrites.push(`${method} ${requestUrl}`);
            await route.abort('blockedbyclient');
            return;
          }

          await route.continue();
        });

        const response = await page.goto(
          `${appPath('/admin/booking-page')}?salon=${encodeURIComponent(SYNTHETIC_SALON_SLUG)}&stage7Evidence=${encodeURIComponent(scenario.label)}`,
          { waitUntil: 'domcontentloaded' },
        );

        expect(response?.ok(), await response?.text()).toBe(true);

        const builder = page.getByTestId('booking-page-builder');
        const previewIframe = page.locator('iframe[title="Live booking page preview"]');
        const preview = page.frameLocator('iframe[title="Live booking page preview"]');

        await expect(builder).toBeVisible();
        await expect(builder.getByRole('heading', { level: 2, name: 'Make it yours' })).toBeVisible();
        await expect(page.getByTestId('booking-page-customization-state')).toHaveText('Customized');
        await expect(previewIframe).toBeVisible();
        await expect(previewIframe).toHaveAttribute(
          'src',
          new RegExp(`/${SYNTHETIC_SALON_SLUG}/book/service\\?builderPreview=\\d+`),
        );
        await expect(previewIframe).toHaveAttribute('sandbox', 'allow-same-origin');
        await expect(previewIframe).toHaveAttribute('aria-hidden', 'true');
        await expect(previewIframe).toHaveAttribute('tabindex', '-1');
        await expect(previewIframe).toHaveCSS('pointer-events', 'auto');
        await expect(preview.getByTestId('service-menu-list')).toBeVisible();
        await expect(preview.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();

        await expectOpaquePreviewServiceCard(
          preview,
          e2eConfig.serviceId,
          `${scenario.label} embedded live preview`,
        );
        await expectPreviewStartsAtTop(
          preview,
          'booking-step-header',
          `${scenario.label} embedded live preview`,
        );
        await expectRestoredPreviewScrollIsNormalized({
          evidenceLabel: `${scenario.label} embedded live preview`,
          iframe: previewIframe,
          preview,
          topMarkerTestId: 'booking-step-header',
        });

        for (const protectedSectionId of ['salonProfile', 'serviceMenu', 'bookingCta']) {
          await expect(page.getByTestId(`builder-visibility-${protectedSectionId}`)).toHaveCount(0);
          await expect(page.getByTestId(`builder-section-status-${protectedSectionId}`)).toHaveText('Protected');
        }

        await expectNoHorizontalOverflow(page);
        await expectBuilderTargetsAtLeast44px(page);

        const beforeState = await fetchBuilderApiState(page);
        const canonicalContent = beforeState.content;
        const livePresentation = beforeState.config.live;
        const livePresetBase = beforeState.config.livePresetBase;
        const serviceTextBefore = (
          await preview.getByTestId(`service-card-${e2eConfig.serviceId}`).textContent()
          ?? ''
        ).replace(/\s+/g, ' ').trim();
        const collectiveRecipe = resolveBookingPagePresetRecipe({
          presetId: 'collective',
          recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
        });

        expect(collectiveRecipe).not.toBeNull();
        expect(beforeState.config.draftPresetBase).toBeNull();
        await expect(page.getByTestId('booking-page-preset-state'))
          .toHaveText('Custom · existing design');

        for (const presetId of ['quick_book', 'signature', 'menu'] as const) {
          const presetLabel = STAGE7_PRESET_LABELS[presetId];

          await page.getByRole('button', {
            name: `${presetLabel} starting design`,
          }).click();

          const reviewDialog = page.getByRole('alertdialog', {
            name: `Switch to ${presetLabel}?`,
          });
          const reviewFrameTitle = `${presetLabel} design preview`;
          const reviewIframe = reviewDialog.locator(`iframe[title="${reviewFrameTitle}"]`);
          const reviewPreview = page.frameLocator(`iframe[title="${reviewFrameTitle}"]`);

          await expect(reviewDialog).toBeVisible();
          await expect(reviewIframe).toHaveAttribute('sandbox', 'allow-same-origin');
          await expect(reviewPreview.getByTestId(
            STAGE7_PRESET_DOM_EXPECTATIONS[presetId].present[0],
          )).toBeVisible();

          await expectOpaquePreviewServiceCard(
            reviewPreview,
            e2eConfig.serviceId,
            `${scenario.label} ${presetLabel} preset-switch preview`,
          );
          await expectPreviewStartsAtTop(
            reviewPreview,
            STAGE7_PRESET_DOM_EXPECTATIONS[presetId].present[0],
            `${scenario.label} ${presetLabel} preset-switch preview`,
          );
          await expectRestoredPreviewScrollIsNormalized({
            evidenceLabel: `${scenario.label} ${presetLabel} preset-switch preview`,
            iframe: reviewIframe,
            preview: reviewPreview,
            topMarkerTestId: STAGE7_PRESET_DOM_EXPECTATIONS[presetId].present[0],
          });
          await reviewDialog.getByRole('button', { name: 'Cancel' }).click();

          await expect(reviewDialog).toHaveCount(0);
        }

        const applyPresetOperation = {
          type: 'apply_preset',
          presetId: 'collective',
          presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
          expectedPresentationSignature: getBookingPagePresentationSignature({
            ...beforeState.config.draft,
            presetBase: beforeState.config.draftPresetBase,
          }),
        } as const;
        const collectiveCard = page.getByRole('button', { name: 'Collective starting design' });

        await collectiveCard.click();

        const presetDialog = page.getByRole('alertdialog', { name: 'Switch to Collective?' });

        await expect(presetDialog).toBeVisible();
        await expect(presetDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
        await expect(presetDialog).toContainText(
          'Only the draft’s layout, section order, section visibility, and section presentations will change.',
        );
        await expect(presetDialog).toContainText('Your live booking page will not change until you publish.');

        const targetPreviewIframe = presetDialog.locator(
          'iframe[title="Collective design preview"]',
        );
        const targetPreview = page.frameLocator(
          'iframe[title="Collective design preview"]',
        );

        await expect(targetPreviewIframe).toHaveAttribute(
          'src',
          new RegExp(
            `/${SYNTHETIC_SALON_SLUG}/book/service\\?builderPreview=\\d+&presetPreview=collective&presetPreviewVersion=1`,
          ),
        );
        await expect(targetPreviewIframe).toHaveAttribute('sandbox', 'allow-same-origin');
        await expect(targetPreview.getByTestId('technician-profile-cards')).toBeVisible();
        await expect(targetPreview.getByTestId('editorial-featured-services')).toBeVisible();
        await expect(targetPreview.getByTestId('location-cards')).toBeVisible();
        await expect(targetPreview.getByTestId('booking-social-links-labeled')).toBeVisible();
        await expect(targetPreview.getByTestId('service-menu-list')).toBeVisible();
        await expect(targetPreview.getByTestId(`service-card-${e2eConfig.serviceId}`))
          .toContainText(canonicalServiceName);

        await expectOpaquePreviewServiceCard(
          targetPreview,
          e2eConfig.serviceId,
          `${scenario.label} Collective preset-switch preview`,
        );
        await expectPreviewStartsAtTop(
          targetPreview,
          STAGE7_PRESET_DOM_EXPECTATIONS.collective.present[0],
          `${scenario.label} Collective preset-switch preview`,
        );
        await expectRestoredPreviewScrollIsNormalized({
          evidenceLabel: `${scenario.label} Collective preset-switch preview`,
          iframe: targetPreviewIframe,
          preview: targetPreview,
          topMarkerTestId: STAGE7_PRESET_DOM_EXPECTATIONS.collective.present[0],
        });

        const dialogBox = await page.getByTestId('booking-page-preset-dialog-content')
          .boundingBox();

        expect(dialogBox, `${scenario.label} preset dialog must have a rendered viewport box`)
          .not.toBeNull();
        expect(dialogBox!.y, `${scenario.label} preset dialog must start inside the viewport`)
          .toBeGreaterThanOrEqual(0);
        expect(
          dialogBox!.y + dialogBox!.height,
          `${scenario.label} preset dialog must end inside the viewport`,
        ).toBeLessThanOrEqual(scenario.viewport.height);
        expect(allowedBuilderPatches, 'opening the preset review must not mutate the draft').toEqual([]);

        const appliedPresetState = await applyBuilderOperationFromPage(
          page,
          applyPresetOperation,
          () => presetDialog.getByRole('button', { name: 'Use Collective' }).click(),
        );

        expect(appliedPresetState.config.draft).toMatchObject({
          hiddenSections: [...collectiveRecipe!.hiddenSections],
          layout: collectiveRecipe!.layout,
          sectionOrder: [...collectiveRecipe!.sectionOrder],
          sectionVariants: { ...collectiveRecipe!.sectionVariants },
        });
        expect(appliedPresetState.config.draftPresetBase).toEqual(collectiveRecipe!.presetBase);
        expect(appliedPresetState.config.live).toEqual(livePresentation);
        expect(appliedPresetState.config.livePresetBase).toEqual(livePresetBase);
        await expect(page.getByRole('heading', { name: 'Starting design' })).toBeFocused();
        await expect(page.getByTestId('booking-page-preset-state')).toHaveText('Collective');
        await expect(page.getByTestId('booking-page-preset-picker').getByRole('status')).toContainText(
          'Starting design applied to your draft. Review the preview, then publish when you’re ready.',
        );
        await expect(preview.getByTestId('technician-profile-cards')).toBeVisible();
        await expect(preview.getByTestId('editorial-featured-services')).toBeVisible();
        await expect(preview.getByTestId('location-cards')).toBeVisible();
        await expect(preview.getByTestId('booking-social-links-labeled')).toBeVisible();
        await expect(preview.getByTestId('service-menu-list')).toBeVisible();

        await expectOpaquePreviewServiceCard(
          preview,
          e2eConfig.serviceId,
          `${scenario.label} applied Collective live preview`,
        );
        await expectPreviewStartsAtTop(
          preview,
          STAGE7_PRESET_DOM_EXPECTATIONS.collective.present[0],
          `${scenario.label} applied Collective live preview`,
        );

        const initialFlowOrder = appliedPresetState.config.draft.sectionOrder.filter(sectionId => (
          (STAGE6_FLOW_ORDER_PROOF_IDS as readonly string[]).includes(sectionId)
        ));

        await expectBuilderAndDraftPreviewOrder(page, initialFlowOrder);

        const moveOperation = {
          type: 'move_section',
          sectionId: 'policies',
          targetSectionId: 'hoursLocation',
          direction: 'up',
        } as const;
        const moveButton = page.getByRole('button', { name: 'Move Policies up' });

        await expect(moveButton).toBeEnabled();

        await moveButton.focus();

        await expect(moveButton).toBeFocused();

        const movedState = await applyBuilderOperationFromPage(
          page,
          moveOperation,
          () => page.keyboard.press('Enter'),
        );
        const movedFlowOrder = movedState.config.draft.sectionOrder.filter(sectionId => (
          (STAGE6_FLOW_ORDER_PROOF_IDS as readonly string[]).includes(sectionId)
        ));

        expect(movedFlowOrder.indexOf('policies')).toBeLessThan(movedFlowOrder.indexOf('hoursLocation'));

        await expectBuilderAndDraftPreviewOrder(page, movedFlowOrder);

        await expect(page.getByRole('button', { name: 'Move Policies up' })).toBeFocused();
        await expect(builder.getByTestId('builder-reorder-status')).toHaveText(
          'Policies moved to position 3 of 4 movable sections.',
        );

        const groupedOperation = {
          type: 'set_variant',
          sectionId: 'serviceMenu',
          variant: 'grouped_categories',
        } as const;

        const groupedState = await applyBuilderOperationFromPage(
          page,
          groupedOperation,
          () => page.getByTestId('builder-variant-serviceMenu').selectOption('grouped_categories'),
        );

        await expect(preview.getByTestId('service-menu-grouped-categories')).toBeVisible();
        await expect(preview.getByTestId('service-menu-list')).toHaveCount(0);
        await expect(preview.locator('h2', { hasText: /^Services$/ })).toHaveCount(1);
        await expect(preview.getByTestId(`service-card-${e2eConfig.serviceId}`)).toContainText(
          e2eConfig.serviceName,
        );

        const resetOperation = {
          type: 'reset_all',
          expectedPresentationSignature: getBookingPagePresentationSignature({
            ...groupedState.config.draft,
            presetBase: groupedState.config.draftPresetBase,
          }),
        } as const;
        const resetState = await applyBuilderOperationFromPage(
          page,
          resetOperation,
          async () => {
            const dialogPromise = page.waitForEvent('dialog');
            const clickPromise = page.getByTestId('builder-reset-all').click();
            const dialog = await dialogPromise;

            expect(dialog.type()).toBe('confirm');
            expect(dialog.message()).toContain('Your salon content will not be deleted.');

            await dialog.accept();
            await clickPromise;
          },
        );

        expect(resetState.config.draft).toMatchObject({
          hiddenSections: [...collectiveRecipe!.hiddenSections],
          layout: collectiveRecipe!.layout,
          sectionOrder: [...collectiveRecipe!.sectionOrder],
          sectionVariants: { ...collectiveRecipe!.sectionVariants },
        });
        expect(resetState.config.draftPresetBase).toEqual(collectiveRecipe!.presetBase);
        await expect(page.getByTestId('booking-page-customization-state')).toHaveText('Using starting design');
        await expect(page.getByTestId('booking-page-preset-state')).toHaveText('Collective');
        await expect(page.getByTestId('builder-reset-all')).toBeDisabled();
        await expect(preview.getByTestId('service-menu-list')).toBeVisible();
        await expect(preview.getByTestId('service-menu-grouped-categories')).toHaveCount(0);
        await expect(preview.getByTestId('technician-profile-cards')).toBeVisible();
        await expect(preview.getByTestId('location-cards')).toBeVisible();

        const resetFlowOrder = resetState.config.draft.sectionOrder.filter(sectionId => (
          (STAGE6_FLOW_ORDER_PROOF_IDS as readonly string[]).includes(sectionId)
        ));
        await expectBuilderAndDraftPreviewOrder(page, resetFlowOrder);

        const afterState = await fetchBuilderApiState(page);
        const serviceTextAfter = (
          await preview.getByTestId(`service-card-${e2eConfig.serviceId}`).textContent()
          ?? ''
        ).replace(/\s+/g, ' ').trim();

        expect(afterState.content, 'reset must not rewrite canonical booking-page content').toEqual(canonicalContent);
        expect(afterState.config.live, 'draft builder operations must not rewrite published presentation').toEqual(livePresentation);
        expect(afterState.config.livePresetBase, 'draft preset operations must not rewrite published provenance')
          .toEqual(livePresetBase);
        expect(serviceTextAfter, 'the same canonical service must survive preset, move, variant, and reset')
          .toBe(serviceTextBefore);

        const persistedResult = await client.query<SalonFixtureRow>(
          'SELECT id, name, settings FROM salon WHERE id = $1',
          [SYNTHETIC_SALON_ID],
        );
        const persistedSettings = persistedResult.rows[0]?.settings;

        if (!isRecord(persistedSettings)) {
          throw new Error('The synthetic builder fixture settings must remain a JSON object.');
        }

        expect(persistedSettings.bookingExperience).toEqual(fixtureSettings.bookingExperience);
        expect(persistedSettings.bookingPageContent).toEqual(fixtureSettings.bookingPageContent);
        expect(persistedSettings.bookingPage).toMatchObject({
          draftPresetBase: collectiveRecipe!.presetBase,
          live: (fixtureSettings.bookingPage as Record<string, unknown>).live,
        });

        expect(allowedBuilderPatches).toEqual([
          { builderOperation: applyPresetOperation },
          { builderOperation: moveOperation },
          { builderOperation: groupedOperation },
          { builderOperation: resetOperation },
        ]);
        expect(blockedWrites, 'The owner builder lane must not attempt any non-builder browser mutation.').toEqual([]);
        expect(externalRequests, 'The owner builder lane must make no unexpected hosted requests.').toEqual([]);

        await expectNoHorizontalOverflow(page);
        await expectBuilderTargetsAtLeast44px(page);
      } finally {
        try {
          if (impersonating) {
            const stopImpersonating = await context.request.delete('/api/super-admin/impersonate');

            expect(stopImpersonating.ok(), await stopImpersonating.text()).toBe(true);
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    try {
      if (fixtureLoaded) {
        const restoreResult = await client.query(
          'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
          [originalSettings === null ? null : JSON.stringify(originalSettings), SYNTHETIC_SALON_ID],
        );

        expect(restoreResult.rowCount).toBe(1);

        const restoredResult = await client.query<SalonFixtureRow>(
          'SELECT id, name, settings FROM salon WHERE id = $1',
          [SYNTHETIC_SALON_ID],
        );

        expect(restoredResult.rows).toHaveLength(1);
        expect(restoredResult.rows[0]?.settings ?? null).toEqual(originalSettings);
      }
    } finally {
      await client.end();
    }
  }
});
