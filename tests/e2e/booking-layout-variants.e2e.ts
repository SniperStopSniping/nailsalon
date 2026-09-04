/* eslint-disable playwright/no-conditional-expect, playwright/no-conditional-in-test */
import {
  devices,
  expect,
  type FrameLocator,
  type Locator,
  type Page,
  type Request,
  type Route,
  test,
} from '@playwright/test';
import { Client, type QueryResultRow } from 'pg';
import sharp from 'sharp';

import type { BookingPageConfigSide } from '../../src/libs/bookingPageConfig';
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
import type { ServiceMenuLayout } from '../../src/libs/serviceMenuLayout';
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

type PreviewPresentationState = Pick<BookingPageConfigSide, 'quickBookProfile' | 'serviceMenuLayout'>;

function getPresetDomExpectations(
  presetId: BookingPagePresetId,
  presentation?: PreviewPresentationState,
) {
  const preset = STAGE7_PRESET_DOM_EXPECTATIONS[presetId];
  const compactProfile = presetId === 'quick_book' && presentation?.quickBookProfile.version === 1;
  const categoryMenu = presentation
    ? presentation.serviceMenuLayout === 'category_menu'
    : presetId === 'menu';
  const present = preset.present.map((testId) => {
    if (testId === 'service-menu-grouped-categories' || testId === 'service-menu-list') {
      return categoryMenu ? 'service-menu-grouped-categories' : 'service-menu-list';
    }
    if (compactProfile && testId === 'booking-policy') {
      return 'quick-book-policies';
    }
    if (compactProfile && testId === 'booking-social-links') {
      return 'quick-book-instagram';
    }
    return testId;
  });
  const absent = [
    ...preset.absent.map((testId) => {
      if (testId === 'service-menu-grouped-categories' || testId === 'service-menu-list') {
        return categoryMenu ? 'service-menu-list' : 'service-menu-grouped-categories';
      }
      return testId;
    }),
    ...(compactProfile ? ['booking-policy', 'booking-social-links'] : []),
  ];
  return { absent, present };
}

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

type SparseSalonFixtureRow = SalonFixtureRow & {
  address: string | null;
  city: string | null;
  social_links: unknown;
  state: string | null;
  zip_code: string | null;
};

type SparseServiceFixtureRow = QueryResultRow & {
  category: string;
  featured_order: number | null;
  id: string;
  template_key: string | null;
};

type SparseTechnicianFixtureRow = QueryResultRow & {
  avatar_url: string | null;
  bio: string | null;
  id: string;
};

type SparseLocationFixtureRow = QueryResultRow & {
  id: string;
  is_active: boolean | null;
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
  serviceFacts: {
    name: string;
    duration: string;
    price: string;
  };
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
      quickBookProfile: BookingPageConfigSide['quickBookProfile'];
      serviceMenuLayout: ServiceMenuLayout;
      sectionOrder: string[];
      sectionVariants: Record<string, string>;
    };
    live: BookingPageConfigSide;
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
  'quick-book-policies',
  'quick-book-instagram',
] as const;

type TestIdSurface = {
  getByTestId: (testId: string | RegExp) => Locator;
};

async function readStage7StructuralFingerprint(surface: TestIdSurface): Promise<string> {
  const markers: string[] = [];

  for (const testId of STAGE7_STRUCTURAL_MARKERS) {
    const marker = surface.getByTestId(testId);
    const markerCount = await marker.count();

    if (!markerCount) {
      continue;
    }

    expect(markerCount, `${testId} must render exactly once`).toBe(1);
    await expect(marker, `${testId} must be visibly rendered`).toBeVisible();

    markers.push(testId);
  }

  const canonicalServiceCard = surface.getByTestId(`service-card-${e2eConfig.serviceId}`);

  await expect(canonicalServiceCard, 'canonical service content must remain visibly rendered')
    .toBeVisible();
  await expect(canonicalServiceCard, 'canonical service content must remain non-empty')
    .toContainText(/\S/);

  return markers.join('|');
}

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
    // This legacy presentation has a deliberately public policy and social
    // link. Keep their explicit consent when adopting the compact profile.
    quickBookProfile: {
      version: 0,
      showBookingPolicy: true,
      showCancellationPolicy: true,
      showInstagram: true,
    },
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
  presentation?: PreviewPresentationState,
): Promise<Stage7PresetSnapshot> {
  const expectation = getPresetDomExpectations(presetId, presentation);
  const compactProfile = presetId === 'quick_book' && presentation?.quickBookProfile.version === 1;
  const categoryMenu = presentation
    ? presentation.serviceMenuLayout === 'category_menu'
    : presetId === 'menu';

  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main main')).toHaveCount(0);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('main h1')).toHaveCount(1);
  await expect(page.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();
  await expect(page.getByTestId('booking-experience-intro')).toHaveCount(1);

  if (compactProfile) {
    await page.getByTestId('quick-book-policies').locator('summary').click();

    await expect(page.getByTestId('quick-book-policies').getByText('Synthetic appointment only', { exact: true }))
      .toBeVisible();
    await expect(page.getByTestId('booking-appointment-only')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('booking-appointment-only')).toHaveText('Synthetic appointment only');
  }

  for (const testId of expectation.present) {
    await expect(page.getByTestId(testId), `${presetId} must render ${testId} exactly once`).toHaveCount(1);
    await expect(page.getByTestId(testId), `${presetId} must visibly render ${testId}`).toBeVisible();
  }
  for (const testId of expectation.absent) {
    await expect(page.getByTestId(testId), `${presetId} must not render ${testId}`).toHaveCount(0);
  }

  await expect(page.locator('[data-public-surface="socialLinks"]')).toHaveCount(compactProfile ? 0 : 1);
  await expect(page.locator('a[href="https://www.instagram.com/luster-stage4-fixture"]')).toHaveCount(1);

  if (presetId !== 'quick_book') {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(salonName);
    await expect(page.getByTestId('editorial-hero-image')).toHaveAttribute('alt', `${salonName} salon`);
  }

  if (categoryMenu) {
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
    ? compactProfile
      ? page.getByTestId('quick-book-policies').getByText('Please arrive five minutes before your synthetic appointment.', { exact: true })
      : page.getByTestId('booking-policy').locator('p')
    : page.getByTestId('editorial-policies').locator('p');
  const social = presetId === 'collective'
    ? page.getByTestId('booking-social-links-labeled').getByRole('link').first()
    : compactProfile
      ? page.getByTestId('quick-book-instagram')
      : page.getByTestId('booking-social-links').getByRole('link').first();

  return {
    policyText: (await policy.textContent() ?? '').replace(/\s+/g, ' ').trim(),
    serviceFacts: {
      name: (await page.getByTestId(`service-card-content-${e2eConfig.serviceId}`)
        .locator(':scope > div.break-words').textContent() ?? '').trim(),
      duration: (await page.getByTestId(`service-card-meta-row-${e2eConfig.serviceId}`)
        .locator(':scope > span').first().textContent() ?? '').trim(),
      price: (await page.getByTestId(`service-card-price-${e2eConfig.serviceId}`)
        .textContent() ?? '').trim(),
    },
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
  frameAncestorsAreSafe: boolean;
  frameHasPixels: boolean;
  frameHasVisibleArea: boolean;
  frameIsOpaque: boolean;
  footerIntersects: boolean;
  scrollY: number;
  surfaceScrollTop: number;
  topContentAncestorsAreSafe: boolean;
  topContentHasPixels: boolean;
  topContentIsOpaque: boolean;
  topContentIsVisible: boolean;
  topIntersects: boolean;
}>;

async function readPreviewViewportMetrics(
  iframe: Locator,
  preview: FrameLocator,
  topMarkerTestId: string,
): Promise<PreviewViewportMetrics> {
  const scrollSurface = iframe.locator('xpath=ancestor::*[@data-booking-page-preview-scroll][1]');
  const [childMetrics, frameMetrics, surfaceScrollTop] = await Promise.all([
    preview.locator('html').evaluate((html, markerTestId) => {
      const topMarker = document.querySelector<HTMLElement>(
        `[data-testid="${CSS.escape(markerTestId)}"]`,
      );
      const footer = document.querySelector<HTMLElement>(
        '[data-testid="public-salon-footer"]',
      );
      const intersectsChildViewport = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }
        const box = element.getBoundingClientRect();
        return box.width > 0
          && box.height > 0
          && box.right > 0
          && box.left < window.innerWidth
          && box.bottom > 0
          && box.top < window.innerHeight;
      };
      const topContentCandidates = topMarker
        ? [...topMarker.querySelectorAll<HTMLElement>(
            'h1, [data-testid="booking-salon-name"], img[alt]',
          )]
        : [];
      const topContentMetrics = topContentCandidates.map((candidate) => {
        const box = candidate.getBoundingClientRect();
        let effectiveOpacity = 1;
        let ancestorsAreSafe = true;
        let visibleLeft = Math.max(0, box.left);
        let visibleTop = Math.max(0, box.top);
        let visibleRight = Math.min(window.innerWidth, box.right);
        let visibleBottom = Math.min(window.innerHeight, box.bottom);
        let ancestor: HTMLElement | null = candidate;

        while (ancestor) {
          const style = getComputedStyle(ancestor);
          const opacity = Number.parseFloat(style.opacity);
          const ancestorBox = ancestor.getBoundingClientRect();

          effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
          ancestorsAreSafe = ancestorsAreSafe
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.visibility !== 'collapse'
          && style.contentVisibility !== 'hidden'
          && (!style.clipPath || style.clipPath === 'none')
          && (style.display === 'contents'
            || ancestor === document.body
            || ancestor === document.documentElement
            || (ancestorBox.width > 0 && ancestorBox.height > 0));

          if (/auto|clip|hidden|scroll/.test(style.overflowX)) {
            visibleLeft = Math.max(visibleLeft, ancestorBox.left);
            visibleRight = Math.min(visibleRight, ancestorBox.right);
          }
          if (/auto|clip|hidden|scroll/.test(style.overflowY)) {
            visibleTop = Math.max(visibleTop, ancestorBox.top);
            visibleBottom = Math.min(visibleBottom, ancestorBox.bottom);
          }
          ancestor = ancestor.parentElement;
        }

        return {
          hasMeaning: Boolean(
            candidate.textContent?.trim()
            || (candidate instanceof HTMLImageElement && candidate.alt.trim()),
          ),
          ancestorsAreSafe,
          hasPixels: box.width > 0 && box.height > 0,
          intersects: intersectsChildViewport(candidate)
            && visibleRight > visibleLeft
            && visibleBottom > visibleTop,
          isOpaque: effectiveOpacity > 0,
          isVisible: ancestorsAreSafe,
        };
      });

      return {
        bodyScrollTop: document.body.scrollTop,
        documentScrollTop: html.scrollTop,
        footerIntersects: intersectsChildViewport(footer),
        scrollY: window.scrollY,
        topContentAncestorsAreSafe: topContentMetrics.some(metric => (
          metric.hasMeaning && metric.hasPixels && metric.ancestorsAreSafe
        )),
        topContentHasPixels: topContentMetrics.some(metric => (
          metric.hasMeaning && metric.hasPixels
        )),
        topContentIsOpaque: topContentMetrics.some(metric => (
          metric.hasMeaning && metric.hasPixels && metric.isOpaque
        )),
        topContentIsVisible: topContentMetrics.some(metric => (
          metric.hasMeaning && metric.hasPixels && metric.isVisible
        )),
        topIntersects: topContentMetrics.some(metric => (
          metric.hasMeaning
          && metric.hasPixels
          && metric.intersects
          && metric.isOpaque
          && metric.isVisible
        )),
      };
    }, topMarkerTestId),
    iframe.evaluate((frame) => {
      let effectiveOpacity = 1;
      let ancestorsAreSafe = true;
      let hasPixels = true;
      const frameBox = frame.getBoundingClientRect();
      let visibleLeft = frameBox.left;
      let visibleTop = frameBox.top;
      let visibleRight = frameBox.right;
      let visibleBottom = frameBox.bottom;
      let reachedPreviewViewport = false;
      let ancestor: HTMLElement | null = frame;

      while (ancestor) {
        const style = getComputedStyle(ancestor);
        const opacity = Number.parseFloat(style.opacity);
        const box = ancestor.getBoundingClientRect();

        effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
        const ancestorHasPixels = style.display === 'contents'
          || ancestor === document.body
          || ancestor === document.documentElement
          || (box.width > 0 && box.height > 0);
        hasPixels = hasPixels && ancestorHasPixels;
        ancestorsAreSafe = ancestorsAreSafe
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.visibility !== 'collapse'
        && style.contentVisibility !== 'hidden'
        && (!style.clipPath || style.clipPath === 'none')
        && ancestorHasPixels;
        if (
          !reachedPreviewViewport
          && ancestor !== frame
          && /auto|clip|hidden|scroll/.test(style.overflowX)
        ) {
          visibleLeft = Math.max(visibleLeft, box.left);
          visibleRight = Math.min(visibleRight, box.right);
        }
        if (
          !reachedPreviewViewport
          && ancestor !== frame
          && /auto|clip|hidden|scroll/.test(style.overflowY)
        ) {
          visibleTop = Math.max(visibleTop, box.top);
          visibleBottom = Math.min(visibleBottom, box.bottom);
        }
        if (ancestor.hasAttribute('data-booking-page-preview-scroll')) {
          reachedPreviewViewport = true;
        }
        ancestor = ancestor.parentElement;
      }

      return {
        frameAncestorsAreSafe: ancestorsAreSafe,
        frameHasPixels: hasPixels,
        frameHasVisibleArea: visibleRight > visibleLeft && visibleBottom > visibleTop,
        frameIsOpaque: effectiveOpacity > 0,
      };
    }),
    scrollSurface.evaluate(element => element.scrollTop),
  ]);

  return {
    ...childMetrics,
    ...frameMetrics,
    surfaceScrollTop,
    topContentAncestorsAreSafe: childMetrics.topContentAncestorsAreSafe
      && frameMetrics.frameAncestorsAreSafe,
    topContentHasPixels: childMetrics.topContentHasPixels && frameMetrics.frameHasPixels,
    topContentIsOpaque: childMetrics.topContentIsOpaque && frameMetrics.frameIsOpaque,
    topContentIsVisible: childMetrics.topContentIsVisible && frameMetrics.frameAncestorsAreSafe,
    topIntersects: childMetrics.topIntersects
      && frameMetrics.frameAncestorsAreSafe
      && frameMetrics.frameHasPixels
      && frameMetrics.frameHasVisibleArea
      && frameMetrics.frameIsOpaque,
  };
}

async function expectPreviewStartsAtTop(
  iframe: Locator,
  preview: FrameLocator,
  topMarkerTestId: string,
  evidenceLabel: string,
): Promise<void> {
  await expect.poll(
    () => readPreviewViewportMetrics(iframe, preview, topMarkerTestId),
    { message: `${evidenceLabel} must begin with real top-of-page content in view` },
  ).toEqual({
    bodyScrollTop: 0,
    documentScrollTop: 0,
    frameAncestorsAreSafe: true,
    frameHasPixels: true,
    frameHasVisibleArea: true,
    frameIsOpaque: true,
    footerIntersects: false,
    scrollY: 0,
    surfaceScrollTop: 0,
    topContentAncestorsAreSafe: true,
    topContentHasPixels: true,
    topContentIsOpaque: true,
    topContentIsVisible: true,
    topIntersects: true,
  });
}

async function expectOpacityZeroAncestorIsRejected(
  iframe: Locator,
  preview: FrameLocator,
  topMarkerTestId: string,
  evidenceLabel: string,
): Promise<void> {
  const marker = preview.getByTestId(topMarkerTestId);

  await marker.evaluate((element) => {
    element.dataset.testOriginalOpacity = element.style.opacity;
    element.style.opacity = '0';
  });

  const concealed = await readPreviewViewportMetrics(iframe, preview, topMarkerTestId);

  expect(concealed.topContentHasPixels, `${evidenceLabel} negative control keeps canonical DOM geometry`)
    .toBe(true);
  expect(concealed.topContentIsOpaque, `${evidenceLabel} must reject opacity:0 on a relevant ancestor`)
    .toBe(false);
  expect(concealed.topIntersects, `${evidenceLabel} hidden pixels cannot satisfy first-viewport proof`)
    .toBe(false);

  await marker.evaluate((element) => {
    element.style.opacity = element.dataset.testOriginalOpacity ?? '';
    delete element.dataset.testOriginalOpacity;
  });

  const scrollHost = iframe.locator('xpath=ancestor::*[@data-booking-page-preview-scroll][1]');
  await scrollHost.evaluate((element) => {
    element.dataset.testOriginalOpacity = (element as HTMLElement).style.opacity;
    (element as HTMLElement).style.opacity = '0';
  });

  const outerConcealed = await readPreviewViewportMetrics(iframe, preview, topMarkerTestId);

  expect(outerConcealed.topContentHasPixels, `${evidenceLabel} outer negative control keeps canonical geometry`)
    .toBe(true);
  expect(outerConcealed.frameIsOpaque, `${evidenceLabel} must reject opacity:0 outside the child document`)
    .toBe(false);
  expect(outerConcealed.topIntersects, `${evidenceLabel} an opaque child inside a hidden preview host is not visible`)
    .toBe(false);

  await scrollHost.evaluate((element) => {
    (element as HTMLElement).style.opacity = element.dataset.testOriginalOpacity ?? '';
    delete element.dataset.testOriginalOpacity;
  });

  await expectPreviewStartsAtTop(iframe, preview, topMarkerTestId, evidenceLabel);
}

async function captureNonblankPreviewViewport(
  iframe: Locator,
  evidenceLabel: string,
): Promise<Buffer> {
  const screenshot = await iframe.screenshot();
  const { data, info } = await sharp(screenshot)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let meaningfullyDarkPixels = 0;

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset] ?? 255;
    const green = data[offset + 1] ?? 255;
    const blue = data[offset + 2] ?? 255;
    const alpha = data[offset + 3] ?? 255;

    if (alpha > 0 && (red < 215 || green < 215 || blue < 215)) {
      meaningfullyDarkPixels += 1;
    }
  }

  const pixelCount = info.width * info.height;

  expect(
    meaningfullyDarkPixels / pixelCount,
    `${evidenceLabel} must contain visible non-background page pixels`,
  ).toBeGreaterThan(0.002);

  return screenshot;
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
      const metrics = await readPreviewViewportMetrics(iframe, preview, topMarkerTestId);

      return {
        restoredScrollPresent: metrics.scrollY > 0,
        topContentNoLongerIntersects: !metrics.topIntersects,
      };
    },
    { message: `${evidenceLabel} fixture must reproduce a restored frame away from its top content` },
  ).toEqual({ restoredScrollPresent: true, topContentNoLongerIntersects: true });

  // Replay the browser's child-frame load boundary after parking it at the
  // restored position. The real parent handler must normalize this state;
  // DOM-existence/opacity assertions alone cannot detect the regression.
  await iframe.dispatchEvent('load');
  await expectPreviewStartsAtTop(iframe, preview, topMarkerTestId, evidenceLabel);
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
  await expect(iframe).toHaveCSS('pointer-events', 'none');
  await expect(iframe).toHaveAttribute('inert', '');

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
  await expectPreviewStartsAtTop(iframe, preview, topMarkerTestId, evidenceLabel);
  await iframe.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }));

  const scrollSurface = iframe.locator('xpath=ancestor::*[@data-booking-page-preview-scroll][1]');
  if (scrollInput === 'wheel') {
    await scrollSurface.scrollIntoViewIfNeeded();
    const frameBox = await scrollSurface.boundingBox();

    expect(frameBox, `${evidenceLabel} must expose a real scrollable viewport`).not.toBeNull();

    await scrollSurface.hover({ position: { x: 8, y: 120 } });
    await page.mouse.wheel(0, 600);
  } else {
    // Playwright's mobile WebKit driver does not expose a swipe or wheel API.
    // Dispatch the real DOM touch sequence consumed by the safe parent scroll
    // owner without claiming a physical iOS gesture; Chromium supplies the
    // real hardware-input wheel proof.
    await scrollSurface.evaluate((element) => {
      const start = new Event('touchstart', { bubbles: true, cancelable: true });
      Object.defineProperty(start, 'touches', { value: [{ clientY: 500 }] });
      element.dispatchEvent(start);
      const move = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(move, 'touches', { value: [{ clientY: 100 }] });
      element.dispatchEvent(move);
    });
  }

  await expect.poll(
    () => preview.locator('html').evaluate(() => window.scrollY),
    { message: `${evidenceLabel} must remain wheel/touchpad scrollable` },
  ).toBeGreaterThan(0);

  await iframe.dispatchEvent('load');
  await expectPreviewStartsAtTop(iframe, preview, topMarkerTestId, evidenceLabel);
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
  const previewRoute = /\/admin\/booking-page\/preview\/[^?]+\?.*builderPreview=/;
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
    await expect(iframe).toHaveAttribute('inert', '');

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
  // inert. A subsequent real refresh remains permanently inert even after its
  // exact authorized document is loaded and guarded.
  await expect(iframe).toHaveCSS('pointer-events', 'none');

  await refreshButton.click();
  await expectPreviewDocumentMatchesFrameSource(iframe, preview, baseURL);

  await expect(iframe).toHaveCSS('pointer-events', 'none');
  await expect(iframe).toHaveAttribute('inert', '');

  await expectAdmittedPreviewRelocksBeforeDelayedReplacement({
    evidenceLabel: 'embedded live preview',
    iframe,
    page,
    preview,
    replacementKind: 'login',
    touch,
  });

  await refreshButton.click();
  await expectPreviewDocumentMatchesFrameSource(iframe, preview, baseURL);

  await expect(iframe).toHaveCSS('pointer-events', 'none');
  await expect(iframe).toHaveAttribute('inert', '');
}

async function expectAdmittedPreviewRelocksBeforeDelayedReplacement({
  evidenceLabel,
  iframe,
  page,
  preview,
  replacementKind,
  touch,
}: {
  evidenceLabel: string;
  iframe: Locator;
  page: Page;
  preview: FrameLocator;
  replacementKind: 'error' | 'login';
  touch: boolean;
}): Promise<void> {
  let releaseSlowResource = () => {};
  let reportSlowResource = () => {};
  const slowResourceGate = new Promise<void>((resolve) => {
    releaseSlowResource = resolve;
  });
  const slowResourceStarted = new Promise<void>((resolve) => {
    reportSlowResource = resolve;
  });

  const replacementPath = `/__luster-preview-${replacementKind}-replacement`;
  const slowResourcePath = `/__luster-preview-${replacementKind}-probe.svg`;
  const replacementRoute = (url: URL) => url.pathname === replacementPath;
  const slowResourceRoute = (url: URL) => url.pathname === slowResourcePath;
  const navigationRequests: string[] = [];
  const recordNavigation = (request: Request) => {
    if (request.isNavigationRequest()) {
      navigationRequests.push(request.url());
    }
  };
  const isLoginReplacement = replacementKind === 'login';
  const handleReplacement = async (route: Route) => {
    await route.fulfill({
      body: `<!doctype html>
        <html>
          <body style="margin:0">
            <h1>${isLoginReplacement ? 'Owner sign in' : 'Preview unavailable'}</h1>
            <a data-testid="replacement-link" href="/should-not-leave-${replacementKind}-preview"
              style="display:block;width:240px;height:120px">${isLoginReplacement ? 'Sign in' : 'Return home'}</a>
            <form action="/should-not-submit-${replacementKind}-preview" method="get">
              <input data-testid="replacement-input" name="email" value="owner@example.test">
              <button data-testid="replacement-submit" type="submit"
                style="display:block;width:240px;height:120px">${isLoginReplacement ? 'Continue' : 'Retry'}</button>
            </form>
            <img src="${slowResourcePath}" alt="">
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

  await page.route(replacementRoute, handleReplacement);
  await page.route(slowResourceRoute, handleSlowResource);
  page.on('request', recordNavigation);

  try {
    // Bypass the child activation guard to reproduce a browser/session-driven
    // replacement on the same previously attested iframe element.
    await preview.locator('html').evaluate((_root, path) => window.location.assign(path), replacementPath);
    await slowResourceStarted;

    const replacementLink = preview.getByTestId('replacement-link');
    const replacementSubmit = preview.getByTestId('replacement-submit');

    await expect(replacementLink).toBeVisible();
    await expect(replacementSubmit).toBeVisible();
    await expect(iframe).toHaveCSS('pointer-events', 'none');
    await expect(iframe).toHaveAttribute('inert', '');

    const replacementScrollBefore = await preview.locator('html').evaluate(() => window.scrollY);
    const scrollSurface = iframe.locator(
      'xpath=ancestor::*[@data-booking-page-preview-scroll][1]',
    );
    const replacementScrollWasCaptured = await scrollSurface.evaluate((element) => {
      const wheel = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 200,
      });
      return !element.dispatchEvent(wheel);
    });

    expect(
      replacementScrollWasCaptured,
      `${evidenceLabel} must not inherit parent-scroll admission for a replacement document`,
    ).toBe(false);
    await expect.poll(
      () => preview.locator('html').evaluate(() => window.scrollY),
      { message: `${evidenceLabel} replacement document must not inherit trusted scrolling` },
    ).toBe(replacementScrollBefore);

    expect(
      await iframe.evaluate((frame) => {
        (frame as HTMLIFrameElement).focus();
        return frame.ownerDocument.activeElement === frame;
      }),
      `${evidenceLabel} replacement iframe must reject keyboard focus before load`,
    ).toBe(false);

    const replacementUrl = await preview.locator('html').evaluate(() => window.location.href);
    for (const control of [replacementLink, replacementSubmit]) {
      const controlBox = await control.boundingBox();

      expect(controlBox, `${replacementKind} control must expose visible hit-test geometry`)
        .not.toBeNull();

      if (touch) {
        await page.touchscreen.tap(
          controlBox!.x + controlBox!.width / 2,
          controlBox!.y + controlBox!.height / 2,
        );
      } else {
        await page.mouse.click(
          controlBox!.x + controlBox!.width / 2,
          controlBox!.y + controlBox!.height / 2,
        );
      }
    }
    await page.keyboard.press('Enter');

    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
    }));

    const settledDocumentUrl = await preview.locator('html').evaluate(() => window.location.href);
    const currentCanonicalFrameUrl = await iframe.evaluate(
      frame => (frame as HTMLIFrameElement).src,
    );
    const allowedNavigationUrls = [replacementUrl, currentCanonicalFrameUrl];

    expect(
      navigationRequests.filter(url => !allowedNavigationUrls.includes(url)),
      `${evidenceLabel} delayed ${replacementKind} replacement must not activate or navigate anywhere except its exact canonical fail-closed source`,
    ).toEqual([]);

    expect(
      allowedNavigationUrls,
      `${evidenceLabel} may stay on the inert replacement or be fail-closed back to its exact canonical source`,
    ).toContain(settledDocumentUrl);
  } finally {
    page.off('request', recordNavigation);
    releaseSlowResource();
    await page.unroute(replacementRoute, handleReplacement);
    await page.unroute(slowResourceRoute, handleSlowResource);
  }
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
          expect(snapshot.serviceFacts).toEqual({
            name: canonicalServiceName,
            duration: canonicalDuration,
            price: canonicalPrice,
          });
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
    // The compact Category Menu intentionally omits description prose; only
    // presentation differs. Compare exact canonical facts across recipes,
    // while the per-recipe snapshot above still pins all text across sizes.
    expect(new Set([...presetSnapshots.values()].map(snapshot => JSON.stringify(snapshot.serviceFacts))).size).toBe(1);
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

test('Production-split DRAFT Signature / LIVE Quick Book previews stay visible, private, and no-Publish across presets @owner-preview-webkit', async ({
  baseURL,
  browser,
}, testInfo) => {
  // WebKit executes four isolated mobile/zoom contexts serially and performs
  // substantially more process-bound cleanup than Chromium. Keep the same
  // assertions, but leave enough time for the fourth context and its explicit
  // impersonation teardown to complete on CI runners.
  test.setTimeout((testInfo.project.name === 'mobile-webkit' ? 5 : 3) * 60 * 1000);

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

    const signatureRecipe = resolveBookingPagePresetRecipe({
      presetId: 'signature',
      recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
    });
    const quickBookRecipe = resolveBookingPagePresetRecipe({
      presetId: 'quick_book',
      recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
    });

    expect(signatureRecipe).not.toBeNull();
    expect(quickBookRecipe).not.toBeNull();

    // Keep the complete auth/state/persistence matrix in one real mobile
    // viewport. The remaining viewport shapes run in the lighter scriptless
    // visibility matrix below so WebKit does not hide a functional result
    // behind one oversized multi-context timeout.
    for (const scenario of OWNER_PREVIEW_VIEWPORT_SCENARIOS.slice(0, 1)) {
      const heroImageUrl = new URL('/assets/images/nextjs-starter-banner.png', baseURL).toString();
      const fixtureSettings = buildFixtureSettings(
        originalSettings,
        signatureRecipe!.layout,
        heroImageUrl,
        {
          businessMode: 'team',
          hiddenSections: signatureRecipe!.hiddenSections,
          presetBase: signatureRecipe!.presetBase,
          sectionOrder: signatureRecipe!.sectionOrder,
          sectionVariants: signatureRecipe!.sectionVariants,
        },
      );
      const bookingPage = isRecord(fixtureSettings.bookingPage)
        ? fixtureSettings.bookingPage
        : {};
      const draftSide = isRecord(bookingPage.draft) ? bookingPage.draft : {};

      fixtureSettings.bookingPage = {
        ...bookingPage,
        live: {
          ...draftSide,
          hiddenSections: [...quickBookRecipe!.hiddenSections],
          layout: quickBookRecipe!.layout,
          sectionOrder: [...quickBookRecipe!.sectionOrder],
          sectionVariants: { ...quickBookRecipe!.sectionVariants },
        },
        livePresetBase: quickBookRecipe!.presetBase,
      };
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
        await expect(page.getByTestId('booking-page-preset-state')).toHaveText('Signature');

        const previewIframe = page.locator('iframe[title="Live booking page preview"]');
        const preview = page.frameLocator('iframe[title="Live booking page preview"]');
        const initialTopMarkerTestId = STAGE7_PRESET_DOM_EXPECTATIONS.signature.present[0];

        await expect(page.getByTestId('booking-page-builder')).toBeVisible();
        await expect(previewIframe).toHaveAttribute('sandbox', 'allow-same-origin');

        await expectPreviewDocumentMatchesFrameSource(previewIframe, preview, baseURL);

        await expectPreviewStartsAtTop(
          previewIframe,
          preview,
          initialTopMarkerTestId,
          `${scenario.label} initial embedded preview`,
        );
        if (scenario === OWNER_PREVIEW_VIEWPORT_SCENARIOS[0]) {
          const initialState = await fetchBuilderApiState(page);

          expect(initialState.config.draftPresetBase).toEqual(signatureRecipe!.presetBase);
          expect(initialState.config.livePresetBase).toEqual(quickBookRecipe!.presetBase);

          for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.signature.present) {
            await expect(preview.getByTestId(testId)).toBeVisible();
          }
          for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.signature.absent) {
            await expect(preview.getByTestId(testId)).toHaveCount(0);
          }
          await expectOpacityZeroAncestorIsRejected(
            previewIframe,
            preview,
            initialTopMarkerTestId,
            `${scenario.label} initial embedded preview`,
          );
          await testInfo.attach(`${testInfo.project.name}-signature-embedded.png`, {
            body: await captureNonblankPreviewViewport(
              previewIframe,
              `${scenario.label} initial embedded preview`,
            ),
            contentType: 'image/png',
          });
        }
        // Exercise the restored child-frame lifecycle once per browser engine.
        // The 200% approximation may make the child document itself
        // non-scrollable in WebKit, while every viewport below still proves
        // that each real load/candidate refresh begins at visible top content.
        if (scenario === OWNER_PREVIEW_VIEWPORT_SCENARIOS[0]) {
          await expectRestoredPreviewScrollIsNormalized({
            evidenceLabel: `${scenario.label} initial embedded preview`,
            iframe: previewIframe,
            preview,
            topMarkerTestId: initialTopMarkerTestId,
          });
        }
        if (exerciseViewOnlyInput) {
          await expectViewOnlyPreviewScrollsWithoutActivation({
            evidenceLabel: `${scenario.label} initial embedded preview`,
            iframe: previewIframe,
            page,
            preview,
            scrollInput: testInfo.project.name === 'mobile-webkit' ? 'engine' : 'wheel',
            topMarkerTestId: initialTopMarkerTestId,
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

        if (scenario === OWNER_PREVIEW_VIEWPORT_SCENARIOS[0]) {
          const fullPreviewHref = await page.getByTestId('booking-page-preview-link').getAttribute('href');

          expect(fullPreviewHref).not.toBeNull();

          const fullPreview = await context.newPage();
          try {
            const fullResponse = await fullPreview.goto(fullPreviewHref!, { waitUntil: 'domcontentloaded' });

            expect(fullResponse?.ok(), await fullResponse?.text()).toBe(true);
            expect(fullResponse?.headers()['cache-control']).toContain('no-store');
            expect(fullResponse?.headers()['x-robots-tag']).toBe('noindex, nofollow');
            await expect(fullPreview.getByTestId('owner-preview-banner')).toHaveAttribute(
              'data-preview-variant',
              'draft-config',
            );

            for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.signature.present) {
              await expect(fullPreview.getByTestId(testId)).toBeVisible();
            }
            for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.signature.absent) {
              await expect(fullPreview.getByTestId(testId)).toHaveCount(0);
            }
            await fullPreview.reload({ waitUntil: 'domcontentloaded' });
            for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.signature.present) {
              await expect(fullPreview.getByTestId(testId)).toBeVisible();
            }
          } finally {
            await fullPreview.close();
          }

          const anonymousPreviewContext = await browser.newContext({
            baseURL,
            reducedMotion: 'reduce',
            viewport: scenario.viewport,
          });
          try {
            const anonymousPreview = await anonymousPreviewContext.newPage();
            const embeddedPreviewHref = await previewIframe.getAttribute('src');

            expect(embeddedPreviewHref).not.toBeNull();

            const deniedEmbeddedResponse = await anonymousPreview.goto(embeddedPreviewHref!, {
              waitUntil: 'domcontentloaded',
            });

            expect(deniedEmbeddedResponse?.status()).toBe(404);
            expect(deniedEmbeddedResponse?.headers()['cache-control']).toContain('no-store');
            expect(deniedEmbeddedResponse?.headers()['x-robots-tag']).toBe('noindex, nofollow');
            await expect(anonymousPreview.getByTestId('owner-preview-banner')).toHaveCount(0);

            for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.signature.present) {
              await expect(anonymousPreview.getByTestId(testId)).toHaveCount(0);
            }

            const deniedResponse = await anonymousPreview.goto(fullPreviewHref!, {
              waitUntil: 'domcontentloaded',
            });

            expect(deniedResponse?.status()).toBe(404);
            await expect(anonymousPreview.getByTestId('owner-preview-banner')).toHaveCount(0);

            const publicResponse = await anonymousPreview.goto(
              appPath(`/${SYNTHETIC_SALON_SLUG}/book/service`),
              { waitUntil: 'domcontentloaded' },
            );

            expect(publicResponse?.ok(), await publicResponse?.text()).toBe(true);
            await expect(anonymousPreview.getByTestId('owner-preview-banner')).toHaveCount(0);

            for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.quick_book.present) {
              await expect(anonymousPreview.getByTestId(testId)).toBeVisible();
            }
            for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.quick_book.absent) {
              await expect(anonymousPreview.getByTestId(testId)).toHaveCount(0);
            }
          } finally {
            await anonymousPreviewContext.close();
          }
        }

        const noPublishPresetSequence = ['menu', 'collective', 'quick_book'] as const;

        for (const presetId of noPublishPresetSequence) {
          const presetLabel = STAGE7_PRESET_LABELS[presetId];
          const beforeState = await fetchBuilderApiState(page);
          const beforePreviewSrc = await previewIframe.getAttribute('src');

          // Site presets no longer own the independently selected booking
          // catalogue layout. This fixture keeps Visual Grid throughout.
          expect(beforeState.config.draft.serviceMenuLayout).toBe('visual_grid');

          const { absent: absentMarkers, present: presentMarkers } = getPresetDomExpectations(presetId, {
            ...beforeState.config.draft,
            // Applying Quick Book adopts compact content ownership, unlike
            // the untouched legacy LIVE fixture checked independently below.
            quickBookProfile: presetId === 'quick_book'
              ? { ...beforeState.config.draft.quickBookProfile, version: 1 }
              : beforeState.config.draft.quickBookProfile,
          });

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
            reviewIframe,
            reviewPreview,
            topMarkerTestId,
            `${scenario.label} ${presetLabel} review preview`,
          );

          await expect(reviewPreview.getByTestId('service-menu-list'))
            .toHaveAttribute('data-booking-menu-layout', beforeState.config.draft.serviceMenuLayout);

          if (scenario === OWNER_PREVIEW_VIEWPORT_SCENARIOS[0]) {
            await testInfo.attach(`${testInfo.project.name}-${presetId}-dialog.png`, {
              body: await captureNonblankPreviewViewport(
                reviewIframe,
                `${scenario.label} ${presetLabel} review preview`,
              ),
              contentType: 'image/png',
            });

            if (presetId === 'menu') {
              const candidateHref = await reviewIframe.getAttribute('src');
              const anonymousCandidateContext = await browser.newContext({
                baseURL,
                reducedMotion: 'reduce',
                viewport: scenario.viewport,
              });
              try {
                expect(candidateHref).not.toBeNull();

                const anonymousCandidate = await anonymousCandidateContext.newPage();
                const deniedCandidate = await anonymousCandidate.goto(candidateHref!, {
                  waitUntil: 'domcontentloaded',
                });

                expect(deniedCandidate?.status()).toBe(404);
                expect(deniedCandidate?.headers()['cache-control']).toContain('no-store');
                expect(deniedCandidate?.headers()['x-robots-tag']).toBe('noindex, nofollow');
                await expect(anonymousCandidate.getByTestId('owner-preview-banner')).toHaveCount(0);

                for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.menu.present) {
                  await expect(anonymousCandidate.getByTestId(testId)).toHaveCount(0);
                }
              } finally {
                await anonymousCandidateContext.close();
              }
            }
          }
          if (scenario === OWNER_PREVIEW_VIEWPORT_SCENARIOS[0]) {
            await expectRestoredPreviewScrollIsNormalized({
              evidenceLabel: `${scenario.label} ${presetLabel} review preview`,
              iframe: reviewIframe,
              preview: reviewPreview,
              topMarkerTestId,
            });
          }
          if (exerciseViewOnlyInput) {
            await expectViewOnlyPreviewScrollsWithoutActivation({
              evidenceLabel: `${scenario.label} ${presetLabel} review preview`,
              iframe: reviewIframe,
              page,
              preview: reviewPreview,
              scrollInput: testInfo.project.name === 'mobile-webkit' ? 'engine' : 'wheel',
              topMarkerTestId,
            });
            if (presetId === BOOKING_PAGE_PRESET_IDS[0]) {
              await expectAdmittedPreviewRelocksBeforeDelayedReplacement({
                evidenceLabel: `${scenario.label} ${presetLabel} review preview`,
                iframe: reviewIframe,
                page,
                preview: reviewPreview,
                replacementKind: 'error',
                touch: testInfo.project.name === 'mobile-webkit',
              });
            }
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
            reviewIframe,
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
          expect(appliedState.config.draft.serviceMenuLayout)
            .toBe(beforeState.config.draft.serviceMenuLayout);
          expect(appliedState.content).toEqual(beforeState.content);
          expect(appliedState.config.draft.quickBookProfile).toEqual(
            presetId === 'quick_book'
              ? { ...beforeState.config.draft.quickBookProfile, version: 1 }
              : beforeState.config.draft.quickBookProfile,
          );
          expect(appliedState.config.livePresetBase).toEqual(beforeState.config.livePresetBase);
          expect(appliedState.config.livePresetBase).toEqual(quickBookRecipe!.presetBase);
          await expect(page.getByTestId('booking-page-preset-state')).toHaveText(presetLabel);
          await expect(page.getByTestId('booking-page-preset-picker').getByRole('status')).toContainText(
            'Starting design applied to your draft. Review the preview, then publish when you’re ready.',
          );
          await expect.poll(() => previewIframe.getAttribute('src')).not.toBe(beforePreviewSrc);

          await expectPreviewDocumentMatchesFrameSource(previewIframe, preview, baseURL);

          await expectPreviewStartsAtTop(
            previewIframe,
            preview,
            topMarkerTestId,
            `${scenario.label} applied ${presetLabel} embedded preview`,
          );

          await expect(preview.getByTestId('service-menu-list'))
            .toHaveAttribute('data-booking-menu-layout', beforeState.config.draft.serviceMenuLayout);

          if (scenario === OWNER_PREVIEW_VIEWPORT_SCENARIOS[0]) {
            await testInfo.attach(`${testInfo.project.name}-${presetId}-embedded.png`, {
              body: await captureNonblankPreviewViewport(
                previewIframe,
                `${scenario.label} applied ${presetLabel} embedded preview`,
              ),
              contentType: 'image/png',
            });
          }
          if (scenario === OWNER_PREVIEW_VIEWPORT_SCENARIOS[0]) {
            await expectRestoredPreviewScrollIsNormalized({
              evidenceLabel: `${scenario.label} applied ${presetLabel} embedded preview`,
              iframe: previewIframe,
              preview,
              topMarkerTestId,
            });
          }

          if (scenario === OWNER_PREVIEW_VIEWPORT_SCENARIOS[0]) {
            const fullPreviewHref = await page.getByTestId('booking-page-preview-link').getAttribute('href');

            expect(fullPreviewHref).not.toBeNull();

            const fullPreview = await context.newPage();
            try {
              const fullResponse = await fullPreview.goto(fullPreviewHref!, { waitUntil: 'domcontentloaded' });

              expect(fullResponse?.ok(), await fullResponse?.text()).toBe(true);
              await expect(fullPreview.getByTestId('owner-preview-banner')).toHaveAttribute(
                'data-preview-variant',
                'draft-config',
              );

              for (const testId of presentMarkers) {
                await expect(fullPreview.getByTestId(testId)).toBeVisible();
              }
              for (const testId of absentMarkers) {
                await expect(fullPreview.getByTestId(testId)).toHaveCount(0);
              }

              await expect(fullPreview.getByTestId('service-menu-list'))
                .toHaveAttribute('data-booking-menu-layout', beforeState.config.draft.serviceMenuLayout);

              if (presetId === 'quick_book') {
                const policies = fullPreview.getByTestId('quick-book-policies');

                await policies.locator('summary').click();

                await expect(policies.getByText('Please arrive five minutes before your synthetic appointment.', { exact: true }))
                  .toBeVisible();
                await expect(fullPreview.getByText('Please arrive five minutes before your synthetic appointment.', { exact: true }))
                  .toHaveCount(1);
                await expect(fullPreview.getByTestId('quick-book-instagram'))
                  .toHaveAttribute('href', 'https://www.instagram.com/luster-stage4-fixture');
                await expect(fullPreview.locator('a[href="https://www.instagram.com/luster-stage4-fixture"]'))
                  .toHaveCount(1);
              }

              await fullPreview.reload({ waitUntil: 'domcontentloaded' });

              await expect(fullPreview.getByTestId(topMarkerTestId)).toBeVisible();
            } finally {
              await fullPreview.close();
            }

            const publicContext = await browser.newContext({
              baseURL,
              reducedMotion: 'reduce',
              viewport: scenario.viewport,
            });
            try {
              const publicPage = await publicContext.newPage();
              const publicResponse = await publicPage.goto(
                appPath(`/${SYNTHETIC_SALON_SLUG}/book/service`),
                { waitUntil: 'domcontentloaded' },
              );

              expect(publicResponse?.ok(), await publicResponse?.text()).toBe(true);
              await expect(publicPage.getByTestId('owner-preview-banner')).toHaveCount(0);

              for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.quick_book.present) {
                await expect(publicPage.getByTestId(testId)).toBeVisible();
              }
              for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.quick_book.absent) {
                await expect(publicPage.getByTestId(testId)).toHaveCount(0);
              }
            } finally {
              await publicContext.close();
            }
          }
        }

        // Signature is the initial authoritative DRAFT, so its card is not
        // reviewable until the matrix reaches Quick Book. Reopen it now to
        // complete the four-preset dialog visibility matrix, then cancel so
        // the exact no-Publish DRAFT=Quick Book / LIVE=Quick Book end state is
        // preserved.
        const beforeSignatureReview = await fetchBuilderApiState(page);

        await page.getByRole('button', { name: 'Signature starting design' }).click();

        const signatureReview = page.getByRole('alertdialog', { name: 'Switch to Signature?' });
        const signatureReviewIframe = signatureReview.locator('iframe[title="Signature design preview"]');
        const signatureReviewPreview = page.frameLocator('iframe[title="Signature design preview"]');

        await expectPreviewDocumentMatchesFrameSource(
          signatureReviewIframe,
          signatureReviewPreview,
          baseURL,
        );
        await expectPreviewStartsAtTop(
          signatureReviewIframe,
          signatureReviewPreview,
          STAGE7_PRESET_DOM_EXPECTATIONS.signature.present[0],
          `${scenario.label} Signature review preview`,
        );
        for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.signature.present) {
          await expect(signatureReviewPreview.getByTestId(testId)).toBeVisible();
        }
        for (const testId of STAGE7_PRESET_DOM_EXPECTATIONS.signature.absent) {
          await expect(signatureReviewPreview.getByTestId(testId)).toHaveCount(0);
        }
        if (scenario === OWNER_PREVIEW_VIEWPORT_SCENARIOS[0]) {
          await testInfo.attach(`${testInfo.project.name}-signature-dialog.png`, {
            body: await captureNonblankPreviewViewport(
              signatureReviewIframe,
              `${scenario.label} Signature review preview`,
            ),
            contentType: 'image/png',
          });
        }
        await signatureReview.getByRole('button', { name: 'Cancel' }).click();

        await expect(signatureReview).toHaveCount(0);
        expect(await fetchBuilderApiState(page)).toEqual(beforeSignatureReview);

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

test('scriptless embedded and dialog previews remain visible across mobile and zoom viewports @owner-preview-webkit', async ({
  baseURL,
  browser,
}, testInfo) => {
  test.setTimeout((testInfo.project.name === 'mobile-webkit' ? 4 : 2) * 60 * 1000);

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

    const signatureRecipe = resolveBookingPagePresetRecipe({
      presetId: 'signature',
      recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
    });
    const quickBookRecipe = resolveBookingPagePresetRecipe({
      presetId: 'quick_book',
      recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
    });

    expect(signatureRecipe).not.toBeNull();
    expect(quickBookRecipe).not.toBeNull();

    const heroImageUrl = new URL('/assets/images/nextjs-starter-banner.png', baseURL).toString();
    const fixtureSettings = buildFixtureSettings(
      originalSettings,
      signatureRecipe!.layout,
      heroImageUrl,
      {
        businessMode: 'team',
        hiddenSections: signatureRecipe!.hiddenSections,
        presetBase: signatureRecipe!.presetBase,
        sectionOrder: signatureRecipe!.sectionOrder,
        sectionVariants: signatureRecipe!.sectionVariants,
      },
    );
    const bookingPage = isRecord(fixtureSettings.bookingPage)
      ? fixtureSettings.bookingPage
      : {};
    const draftSide = isRecord(bookingPage.draft) ? bookingPage.draft : {};

    fixtureSettings.bookingPage = {
      ...bookingPage,
      live: {
        ...draftSide,
        hiddenSections: [...quickBookRecipe!.hiddenSections],
        layout: quickBookRecipe!.layout,
        sectionOrder: [...quickBookRecipe!.sectionOrder],
        sectionVariants: { ...quickBookRecipe!.sectionVariants },
      },
      livePresetBase: quickBookRecipe!.presetBase,
    };

    const fixtureUpdate = await client.query(
      'UPDATE salon SET settings = $1::jsonb WHERE id = $2',
      [JSON.stringify(fixtureSettings), SYNTHETIC_SALON_ID],
    );

    expect(fixtureUpdate.rowCount).toBe(1);

    for (const scenario of OWNER_PREVIEW_VIEWPORT_SCENARIOS.slice(1)) {
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
        const response = await page.goto(
          `${appPath('/admin/booking-page')}?salon=${encodeURIComponent(SYNTHETIC_SALON_SLUG)}&ownerPreviewEvidence=${encodeURIComponent(scenario.label)}`,
          { waitUntil: 'domcontentloaded' },
        );

        expect(response?.ok(), await response?.text()).toBe(true);
        await expect(page.getByTestId('booking-page-preset-state')).toHaveText('Signature');

        const embeddedIframe = page.locator('iframe[title="Live booking page preview"]');
        const embeddedPreview = page.frameLocator('iframe[title="Live booking page preview"]');

        await expect(embeddedIframe).toHaveAttribute('sandbox', 'allow-same-origin');

        await expectPreviewDocumentMatchesFrameSource(embeddedIframe, embeddedPreview, baseURL);
        await expectPreviewStartsAtTop(
          embeddedIframe,
          embeddedPreview,
          STAGE7_PRESET_DOM_EXPECTATIONS.signature.present[0],
          `${scenario.label} Signature embedded preview`,
        );
        await testInfo.attach(`${testInfo.project.name}-${scenario.label}-signature-embedded.png`, {
          body: await captureNonblankPreviewViewport(
            embeddedIframe,
            `${scenario.label} Signature embedded preview`,
          ),
          contentType: 'image/png',
        });

        for (const presetId of ['menu', 'collective', 'quick_book'] as const) {
          const presetLabel = STAGE7_PRESET_LABELS[presetId];
          const beforeDialogState = await fetchBuilderApiState(page);
          const dialogExpectation = getPresetDomExpectations(presetId, beforeDialogState.config.draft);

          expect(beforeDialogState.config.draft.serviceMenuLayout).toBe('visual_grid');

          await page.getByRole('button', { name: `${presetLabel} starting design` }).click();

          const dialog = page.getByRole('alertdialog', { name: `Switch to ${presetLabel}?` });
          const dialogIframe = dialog.locator(`iframe[title="${presetLabel} design preview"]`);
          const dialogPreview = page.frameLocator(`iframe[title="${presetLabel} design preview"]`);

          await expect(dialog).toBeVisible();
          await expect(dialogIframe).toHaveAttribute('sandbox', 'allow-same-origin');

          await expectPreviewDocumentMatchesFrameSource(dialogIframe, dialogPreview, baseURL);
          await expectPreviewStartsAtTop(
            dialogIframe,
            dialogPreview,
            STAGE7_PRESET_DOM_EXPECTATIONS[presetId].present[0],
            `${scenario.label} ${presetLabel} dialog preview`,
          );
          for (const testId of dialogExpectation.present) {
            await expect(dialogPreview.getByTestId(testId)).toBeVisible();
          }
          for (const testId of dialogExpectation.absent) {
            await expect(dialogPreview.getByTestId(testId)).toHaveCount(0);
          }

          await expect(dialogPreview.getByTestId('service-menu-list'))
            .toHaveAttribute('data-booking-menu-layout', beforeDialogState.config.draft.serviceMenuLayout);

          await testInfo.attach(`${testInfo.project.name}-${scenario.label}-${presetId}-dialog.png`, {
            body: await captureNonblankPreviewViewport(
              dialogIframe,
              `${scenario.label} ${presetLabel} dialog preview`,
            ),
            contentType: 'image/png',
          });

          await dialog.getByRole('button', { name: 'Cancel' }).click();

          await expect(dialog).toHaveCount(0);
          expect(await fetchBuilderApiState(page)).toEqual(beforeDialogState);
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
      presetId: 'signature',
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
    let crossHostAuthResponses = 0;

    try {
      const impersonation = await ownerContext.request.post('/api/super-admin/impersonate', {
        data: { salonId: SYNTHETIC_SALON_ID },
      });

      expect(impersonation.ok(), await impersonation.text()).toBe(true);

      impersonating = true;

      // Reproduce a salon whose customer-facing booking URL lives on another
      // host. Owner Preview must ignore that public destination: the admin and
      // impersonation cookies are host-only, so crossing hosts would silently
      // render LIVE instead of the owner's DRAFT.
      await ownerContext.route('**/api/admin/auth/me**', async (route) => {
        const response = await route.fetch();
        const body = await response.json();

        if (body?.user?.salons?.[0]) {
          body.user.salons[0].bookingUrl = 'https://cross-host-preview.invalid/book/service';
          crossHostAuthResponses += 1;
        }

        await route.fulfill({ response, json: body });
      });

      const builderPage = await ownerContext.newPage();
      const builderResponse = await builderPage.goto(
        `${appPath('/admin/booking-page')}?ownerPublishEvidence=1`,
        { waitUntil: 'domcontentloaded' },
      );

      expect(builderResponse?.ok(), await builderResponse?.text()).toBe(true);
      await expect.poll(() => crossHostAuthResponses).toBeGreaterThan(0);

      let currentLivePreset: BookingPagePresetId = 'signature';

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
        expect(appliedState.content).toEqual(beforeState.content);
        expect(beforeState.config.draft.serviceMenuLayout).toBe('visual_grid');
        expect(appliedState.config.draft.serviceMenuLayout)
          .toBe(beforeState.config.draft.serviceMenuLayout);
        await expect(builderPage.getByTestId('booking-page-preset-state')).toHaveText(presetLabel);
        await expect(builderPage.getByTestId('booking-page-preset-picker').getByRole('status')).toContainText(
          'Starting design applied to your draft. Review the preview, then publish when you’re ready.',
        );

        const embeddedPreview = builderPage.frameLocator('iframe[title="Live booking page preview"]');
        const appliedExpectation = getPresetDomExpectations(presetId, appliedState.config.draft);

        for (const testId of appliedExpectation.present) {
          await expect(
            embeddedPreview.getByTestId(testId),
            `embedded draft preview must adopt ${presetId}:${testId}`,
          ).toBeVisible();
        }
        for (const testId of appliedExpectation.absent) {
          await expect(
            embeddedPreview.getByTestId(testId),
            `embedded draft preview must drop the prior recipe's ${testId}`,
          ).toHaveCount(0);
        }

        const fullPreviewLink = builderPage.getByTestId('booking-page-preview-link');

        await expect(fullPreviewLink).toHaveAttribute('href');

        const fullPreviewHref = await fullPreviewLink.getAttribute('href');

        expect(fullPreviewHref).not.toBeNull();

        const fullPreviewUrl = new URL(fullPreviewHref!, builderPage.url());

        expect(fullPreviewUrl.origin).toBe(new URL(builderPage.url()).origin);
        expect(fullPreviewUrl.pathname).toBe(
          appPath(`/admin/booking-page/preview/${SYNTHETIC_SALON_SLUG}`),
        );
        expect(fullPreviewUrl.search).toBe('');

        const fullPreviewPage = await ownerContext.newPage();
        let draftPreviewSnapshot: Stage7PresetSnapshot | null = null;

        try {
          const fullPreviewResponse = await fullPreviewPage.goto(fullPreviewUrl.href, {
            waitUntil: 'domcontentloaded',
          });

          expect(fullPreviewResponse?.ok(), await fullPreviewResponse?.text()).toBe(true);
          await expect(fullPreviewPage.getByTestId('owner-preview-banner')).toBeVisible();

          draftPreviewSnapshot = await expectStage7PresetStructure(
            fullPreviewPage,
            presetId,
            salonName!,
            technicianResult.rows,
            appliedState.config.draft,
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

          const liveBeforePublishSnapshot = await expectStage7PresetStructure(
            unpublishedPage,
            currentLivePreset,
            salonName!,
            technicianResult.rows,
            beforeState.config.live,
          );

          expect(draftPreviewSnapshot).not.toBeNull();
          expect(draftPreviewSnapshot!.structure).not.toBe(liveBeforePublishSnapshot.structure);
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

          const liveAfterPublishSnapshot = await expectStage7PresetStructure(
            publishedPage,
            presetId,
            salonName!,
            technicianResult.rows,
            appliedState.config.draft,
          );

          expect(liveAfterPublishSnapshot).toEqual(draftPreviewSnapshot);
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

test('sparse Signature and Quick Book may converge visibly while every preview still resolves the authoritative draft @mobile-chrome', async ({
  baseURL,
  browser,
}, testInfo) => {
  test.setTimeout(2 * 60 * 1000);

  assertLocalSyntheticTarget(baseURL);

  const target = requireDisposableDatabaseTarget();
  const expectedServer = resolveDisposableDatabaseServerExpectation(target);
  const client = new Client({ connectionString: target.connectionString });
  let salonSnapshot: SparseSalonFixtureRow | null = null;
  let serviceSnapshots: SparseServiceFixtureRow[] = [];
  let technicianSnapshots: SparseTechnicianFixtureRow[] = [];
  let locationSnapshots: SparseLocationFixtureRow[] = [];

  await client.connect();

  try {
    await attestDisposableDatabaseSession(client, target, expectedServer);

    const [salonResult, serviceResult, technicianResult, locationResult] = await Promise.all([
      client.query<SparseSalonFixtureRow>(
        `SELECT id, name, settings, address, city, state, zip_code, social_links
         FROM salon
         WHERE id = $1`,
        [SYNTHETIC_SALON_ID],
      ),
      client.query<SparseServiceFixtureRow>(
        `SELECT id, category::text, featured_order, template_key
         FROM service
         WHERE salon_id = $1
         ORDER BY id`,
        [SYNTHETIC_SALON_ID],
      ),
      client.query<SparseTechnicianFixtureRow>(
        `SELECT id, bio, avatar_url
         FROM technician
         WHERE salon_id = $1
         ORDER BY id`,
        [SYNTHETIC_SALON_ID],
      ),
      client.query<SparseLocationFixtureRow>(
        `SELECT id, is_active
         FROM salon_location
         WHERE salon_id = $1
         ORDER BY id`,
        [SYNTHETIC_SALON_ID],
      ),
    ]);

    expect(salonResult.rows).toHaveLength(1);
    expect(serviceResult.rows.length).toBeGreaterThan(0);

    salonSnapshot = salonResult.rows[0]!;
    serviceSnapshots = serviceResult.rows;
    technicianSnapshots = technicianResult.rows;
    locationSnapshots = locationResult.rows;

    const signatureRecipe = resolveBookingPagePresetRecipe({
      presetId: 'signature',
      recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
    });
    const quickBookRecipe = resolveBookingPagePresetRecipe({
      presetId: 'quick_book',
      recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
    });

    expect(signatureRecipe).not.toBeNull();
    expect(quickBookRecipe).not.toBeNull();

    const sparseSettings = buildFixtureSettings(
      salonSnapshot.settings,
      signatureRecipe!.layout,
      '',
      {
        businessMode: 'solo',
        hiddenSections: signatureRecipe!.hiddenSections,
        presetBase: signatureRecipe!.presetBase,
        sectionOrder: signatureRecipe!.sectionOrder,
        sectionVariants: signatureRecipe!.sectionVariants,
      },
    );
    const existingMerchandising = isRecord(sparseSettings.merchandising)
      ? sparseSettings.merchandising
      : {};

    sparseSettings.merchandising = {
      ...existingMerchandising,
      featureLusterManicure: false,
    };
    sparseSettings.bookingExperience = {
      primaryColor: null,
      bookingMessage: null,
      policy: {
        enabled: false,
        title: null,
        text: null,
        showOnServicePage: true,
        showBeforeConfirmation: false,
        showAfterConfirmation: false,
        showInConfirmationEmail: false,
        acknowledgment: { required: false, text: null },
      },
      quickFacts: {
        appointmentOnly: { enabled: false, label: null },
        depositNotice: { enabled: false, label: null },
        cancellationNotice: { enabled: false, label: null },
      },
      socialLinks: { instagram: null, facebook: null, tiktok: null },
      confirmationMessage: null,
    };
    sparseSettings.bookingPageContent = {
      version: 1,
      draft: {
        heroImageUrl: null,
        specialtyLine: null,
        bio: null,
        locationDisplayMode: 'full_address',
      },
      live: {
        heroImageUrl: null,
        specialtyLine: null,
        bio: null,
        locationDisplayMode: 'full_address',
      },
    };
    const sparseBookingPage = isRecord(sparseSettings.bookingPage)
      ? sparseSettings.bookingPage
      : {};
    const sparseDraft = isRecord(sparseBookingPage.draft)
      ? sparseBookingPage.draft
      : {};
    sparseSettings.bookingPage = {
      ...sparseBookingPage,
      draftPresetBase: signatureRecipe!.presetBase,
      live: {
        ...sparseDraft,
        hiddenSections: [...quickBookRecipe!.hiddenSections],
        layout: quickBookRecipe!.layout,
        sectionOrder: [...quickBookRecipe!.sectionOrder],
        sectionVariants: { ...quickBookRecipe!.sectionVariants },
      },
      livePresetBase: quickBookRecipe!.presetBase,
    };

    await client.query(
      `UPDATE salon
       SET settings = $1::jsonb,
           address = NULL,
           city = NULL,
           state = NULL,
           zip_code = NULL,
           social_links = '{}'::jsonb
       WHERE id = $2`,
      [JSON.stringify(sparseSettings), SYNTHETIC_SALON_ID],
    );
    await client.query(
      `UPDATE service
       SET category = 'manicure', featured_order = NULL, template_key = NULL
       WHERE salon_id = $1`,
      [SYNTHETIC_SALON_ID],
    );
    await client.query(
      `UPDATE technician
       SET bio = NULL, avatar_url = NULL
       WHERE salon_id = $1`,
      [SYNTHETIC_SALON_ID],
    );
    await client.query(
      `UPDATE salon_location
       SET is_active = false
       WHERE salon_id = $1`,
      [SYNTHETIC_SALON_ID],
    );

    const ownerContext = await browser.newContext({
      baseURL,
      reducedMotion: 'reduce',
      storageState: authStatePaths.superAdmin,
      viewport: { width: 375, height: 600 },
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
        `${appPath('/admin/booking-page')}?salon=${encodeURIComponent(SYNTHETIC_SALON_SLUG)}&sparsePresetEvidence=1`,
        { waitUntil: 'domcontentloaded' },
      );

      expect(builderResponse?.ok(), await builderResponse?.text()).toBe(true);
      await expect(builderPage.getByTestId('booking-page-preset-state')).toHaveText('Signature');

      const embeddedIframe = builderPage.locator('iframe[title="Live booking page preview"]');
      const embeddedPreview = builderPage.frameLocator('iframe[title="Live booking page preview"]');
      const expectedSparseFingerprint = 'booking-step-header|service-menu-list';

      await expect(embeddedIframe).toHaveAttribute('sandbox', 'allow-same-origin');

      await expectPreviewStartsAtTop(
        embeddedIframe,
        embeddedPreview,
        'booking-step-header',
        'sparse Signature embedded preview',
      );
      await expectOpacityZeroAncestorIsRejected(
        embeddedIframe,
        embeddedPreview,
        'booking-step-header',
        'sparse Signature embedded preview restored after negative control',
      );
      await testInfo.attach('sparse-signature-scriptless-preview.png', {
        body: await captureNonblankPreviewViewport(
          embeddedIframe,
          'sparse Signature scriptless preview screenshot',
        ),
        contentType: 'image/png',
      });
      const signatureEmbeddedFingerprint = await readStage7StructuralFingerprint(embeddedPreview);

      expect(signatureEmbeddedFingerprint).toBe(expectedSparseFingerprint);

      const signaturePreviewHref = await builderPage.getByTestId('booking-page-preview-link')
        .getAttribute('href');

      expect(signaturePreviewHref).not.toBeNull();

      const signaturePreviewPage = await ownerContext.newPage();
      let signatureFullPageFingerprint = '';

      try {
        const response = await signaturePreviewPage.goto(signaturePreviewHref!, {
          waitUntil: 'domcontentloaded',
        });

        expect(response?.ok(), await response?.text()).toBe(true);
        await expect(signaturePreviewPage.getByTestId('owner-preview-banner')).toBeVisible();

        signatureFullPageFingerprint = await readStage7StructuralFingerprint(signaturePreviewPage);

        expect(signatureFullPageFingerprint).toBe(expectedSparseFingerprint);
      } finally {
        await signaturePreviewPage.close();
      }

      const beforeState = await fetchBuilderApiState(builderPage);

      expect(beforeState.config.draftPresetBase).toEqual(signatureRecipe!.presetBase);
      expect(beforeState.config.livePresetBase).toEqual(quickBookRecipe!.presetBase);

      const beforeEmbeddedSrc = await builderPage.locator('iframe[title="Live booking page preview"]')
        .getAttribute('src');

      await builderPage.getByRole('button', { name: 'Quick Book starting design' }).click();

      const reviewDialog = builderPage.getByRole('alertdialog', { name: 'Switch to Quick Book?' });
      const reviewIframe = reviewDialog.locator('iframe[title="Quick Book design preview"]');
      const reviewPreview = builderPage.frameLocator('iframe[title="Quick Book design preview"]');

      await expect(reviewIframe).toHaveAttribute('sandbox', 'allow-same-origin');

      await expectPreviewStartsAtTop(
        reviewIframe,
        reviewPreview,
        'booking-step-header',
        'sparse Quick Book preset-dialog preview',
      );
      await testInfo.attach('sparse-quick-book-dialog-preview.png', {
        body: await captureNonblankPreviewViewport(
          reviewIframe,
          'sparse Quick Book preset-dialog screenshot',
        ),
        contentType: 'image/png',
      });
      const quickBookState = await applyBuilderOperationFromPage(
        builderPage,
        {
          type: 'apply_preset',
          presetId: 'quick_book',
          presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
          expectedPresentationSignature: getBookingPagePresentationSignature({
            ...beforeState.config.draft,
            presetBase: beforeState.config.draftPresetBase,
          }),
        },
        () => reviewDialog.getByRole('button', { name: 'Use Quick Book' }).click(),
      );

      expect(quickBookState.config.draft).toMatchObject({
        hiddenSections: [...quickBookRecipe!.hiddenSections],
        layout: quickBookRecipe!.layout,
        sectionOrder: [...quickBookRecipe!.sectionOrder],
        sectionVariants: { ...quickBookRecipe!.sectionVariants },
      });
      expect(quickBookState.config.draftPresetBase).toEqual(quickBookRecipe!.presetBase);
      expect(quickBookState.config.live).toEqual(beforeState.config.live);
      expect(quickBookState.config.livePresetBase).toEqual(quickBookRecipe!.presetBase);
      expect(quickBookState.content).toEqual(beforeState.content);
      await expect(builderPage.getByTestId('booking-page-preset-state')).toHaveText('Quick Book');
      await expect.poll(
        () => builderPage.locator('iframe[title="Live booking page preview"]').getAttribute('src'),
      ).not.toBe(beforeEmbeddedSrc);

      const quickBookEmbeddedFingerprint = await readStage7StructuralFingerprint(embeddedPreview);

      await expectPreviewStartsAtTop(
        embeddedIframe,
        embeddedPreview,
        'booking-step-header',
        'sparse Quick Book embedded preview',
      );
      await testInfo.attach('sparse-quick-book-scriptless-preview.png', {
        body: await captureNonblankPreviewViewport(
          embeddedIframe,
          'sparse Quick Book scriptless preview screenshot',
        ),
        contentType: 'image/png',
      });

      expect(quickBookEmbeddedFingerprint).toBe(expectedSparseFingerprint);
      expect(quickBookEmbeddedFingerprint).toBe(signatureEmbeddedFingerprint);

      const quickBookPreviewHref = await builderPage.getByTestId('booking-page-preview-link')
        .getAttribute('href');
      const quickBookPreviewPage = await ownerContext.newPage();

      try {
        const response = await quickBookPreviewPage.goto(quickBookPreviewHref!, {
          waitUntil: 'domcontentloaded',
        });

        expect(response?.ok(), await response?.text()).toBe(true);
        await expect(quickBookPreviewPage.getByTestId('owner-preview-banner')).toBeVisible();
        expect(await readStage7StructuralFingerprint(quickBookPreviewPage))
          .toBe(expectedSparseFingerprint);
      } finally {
        await quickBookPreviewPage.close();
      }

      const publicContext = await browser.newContext({
        baseURL,
        reducedMotion: 'reduce',
        viewport: { width: 375, height: 600 },
      });

      try {
        const publicPage = await publicContext.newPage();
        const response = await publicPage.goto(
          appPath(`/${SYNTHETIC_SALON_SLUG}/book/service`),
          { waitUntil: 'domcontentloaded' },
        );

        expect(response?.ok(), await response?.text()).toBe(true);
        await expect(publicPage.getByTestId('owner-preview-banner')).toHaveCount(0);
        expect(await readStage7StructuralFingerprint(publicPage)).toBe(expectedSparseFingerprint);
      } finally {
        await publicContext.close();
      }

      // The byte-identical-looking sparse surfaces are legitimate convergence:
      // Stage 2 omitted every recipe discriminator whose canonical content is
      // absent, while the API still proves the requested DRAFT provenance and
      // the independently seeded LIVE=Quick Book provenance.
      expect(signatureFullPageFingerprint).toBe(quickBookEmbeddedFingerprint);

      const finalState = await fetchBuilderApiState(builderPage);

      expect(finalState.config.draftPresetBase).toEqual(quickBookRecipe!.presetBase);
      expect(finalState.config.livePresetBase).toEqual(quickBookRecipe!.presetBase);
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
      if (salonSnapshot) {
        await client.query(
          `UPDATE salon
           SET settings = $1::jsonb,
               address = $2,
               city = $3,
               state = $4,
               zip_code = $5,
               social_links = $6::jsonb
           WHERE id = $7`,
          [
            salonSnapshot.settings === null ? null : JSON.stringify(salonSnapshot.settings),
            salonSnapshot.address,
            salonSnapshot.city,
            salonSnapshot.state,
            salonSnapshot.zip_code,
            salonSnapshot.social_links === null ? null : JSON.stringify(salonSnapshot.social_links),
            SYNTHETIC_SALON_ID,
          ],
        );
        for (const service of serviceSnapshots) {
          await client.query(
            `UPDATE service
             SET category = $1, featured_order = $2, template_key = $3
             WHERE salon_id = $4 AND id = $5`,
            [
              service.category,
              service.featured_order,
              service.template_key,
              SYNTHETIC_SALON_ID,
              service.id,
            ],
          );
        }
        for (const technician of technicianSnapshots) {
          await client.query(
            `UPDATE technician
             SET bio = $1, avatar_url = $2
             WHERE salon_id = $3 AND id = $4`,
            [technician.bio, technician.avatar_url, SYNTHETIC_SALON_ID, technician.id],
          );
        }
        for (const location of locationSnapshots) {
          await client.query(
            `UPDATE salon_location
             SET is_active = $1
             WHERE salon_id = $2 AND id = $3`,
            [location.is_active, SYNTHETIC_SALON_ID, location.id],
          );
        }
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
          new RegExp(`/admin/booking-page/preview/${SYNTHETIC_SALON_SLUG}\\?builderPreview=\\d+`),
        );
        await expect(previewIframe).toHaveAttribute('sandbox', 'allow-same-origin');
        await expect(previewIframe).toHaveAttribute('aria-hidden', 'true');
        await expect(previewIframe).toHaveAttribute('tabindex', '-1');
        await expect(previewIframe).toHaveCSS('pointer-events', 'none');
        await expect(previewIframe).toHaveAttribute('inert', '');
        await expect(preview.getByTestId('service-menu-list')).toBeVisible();
        await expect(preview.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();

        await expectOpaquePreviewServiceCard(
          preview,
          e2eConfig.serviceId,
          `${scenario.label} embedded live preview`,
        );
        await expectPreviewStartsAtTop(
          previewIframe,
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
            reviewIframe,
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
            `/admin/booking-page/preview/${SYNTHETIC_SALON_SLUG}\\?builderPreview=\\d+&presetPreview=collective&presetPreviewVersion=1`,
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
          targetPreviewIframe,
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
          previewIframe,
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

        expect(groupedState.config.draft.serviceMenuLayout).toBe('category_menu');
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
        expect(resetState.config.draft.serviceMenuLayout).toBe('category_menu');
        await expect(preview.getByTestId('service-menu-grouped-categories')).toBeVisible();
        await expect(page.getByTestId('builder-variant-serviceMenu')).toHaveValue('grouped_categories');
        await expect(preview.getByTestId('technician-profile-cards')).toBeVisible();
        await expect(preview.getByTestId('location-cards')).toBeVisible();

        const resetFlowOrder = resetState.config.draft.sectionOrder.filter(sectionId => (
          (STAGE6_FLOW_ORDER_PROOF_IDS as readonly string[]).includes(sectionId)
        ));
        await expectBuilderAndDraftPreviewOrder(page, resetFlowOrder);

        // Resetting the site preserves the separate booking layout. Only
        // this explicitly targeted Services reset restores its default.
        const resetServicesState = await applyBuilderOperationFromPage(
          page,
          { type: 'reset_section', sectionId: 'serviceMenu' },
          () => page.getByRole('button', { name: 'Reset Services', exact: true }).click(),
        );

        expect(resetServicesState.config.draft.serviceMenuLayout).toBe('visual_grid');
        await expect(preview.getByTestId('service-menu-list')).toHaveAttribute('data-booking-menu-layout', 'visual_grid');
        await expect(preview.getByTestId('service-menu-grouped-categories')).toHaveCount(0);

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
          { builderOperation: { type: 'reset_section', sectionId: 'serviceMenu' } },
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
