/* eslint-disable playwright/no-conditional-expect, playwright/no-conditional-in-test */
import { expect, type Page, test } from '@playwright/test';
import { Client, type QueryResultRow } from 'pg';

import {
  attestDisposableDatabaseSession,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '../../src/libs/disposableDatabaseTarget';
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

const SECTION_ORDER = [
  'salonProfile',
  'featuredServices',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
] as const;

const STAGE5_SECTION_ORDER = [
  'salonProfile',
  'technicianProfile',
  'featuredServices',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
] as const;

const STAGE6_EDITORIAL_STARTING_ORDER = [
  'salonProfile',
  'featuredServices',
  'technicianProfile',
  'portfolio',
  'reviews',
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

type Layout = 'editorial' | 'quick_book';

type Stage5Profile = 'booking_led' | 'identity_led' | 'service_led' | 'team_led';

type FixtureOptions = {
  businessMode?: 'solo' | 'team';
  hiddenSections?: readonly string[];
  sectionOrder?: readonly string[];
  sectionVariants?: Readonly<Record<string, string>>;
};

const STAGE5_PROFILES = {
  booking_led: {
    layout: 'quick_book',
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
    present: [
      'booking-step-header',
      'editorial-about',
      'featured-services-scroll',
      'service-menu-list',
      'editorial-visit',
      'booking-policy',
      'booking-social-links',
    ],
    absent: [
      'editorial-hero',
      'technician-profile-cards',
      'editorial-featured-services',
      'service-menu-grouped-categories',
      'location-cards',
      'editorial-policies',
      'booking-social-links-labeled',
    ],
  },
  identity_led: {
    layout: 'editorial',
    sectionVariants: {
      salonProfile: 'hero_image',
      technicianProfile: 'full',
      featuredServices: 'signature',
      serviceMenu: 'list',
      hoursLocation: 'full',
      policies: 'inline',
      socialLinks: 'icons',
      bookingCta: 'sticky',
    },
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
  service_led: {
    layout: 'editorial',
    sectionVariants: {
      salonProfile: 'compact',
      technicianProfile: 'full',
      featuredServices: 'carousel',
      serviceMenu: 'grouped_categories',
      hoursLocation: 'full',
      policies: 'card',
      socialLinks: 'icons',
      bookingCta: 'sticky',
    },
    present: [
      'booking-step-header',
      'editorial-about',
      'featured-services-scroll',
      'service-menu-grouped-categories',
      'editorial-visit',
      'booking-policy',
      'booking-social-links',
    ],
    absent: [
      'editorial-hero',
      'technician-profile-cards',
      'editorial-featured-services',
      'service-menu-list',
      'location-cards',
      'editorial-policies',
      'booking-social-links-labeled',
    ],
  },
  team_led: {
    layout: 'editorial',
    sectionVariants: {
      salonProfile: 'compact',
      technicianProfile: 'cards',
      featuredServices: 'carousel',
      serviceMenu: 'list',
      hoursLocation: 'location_cards',
      policies: 'card',
      socialLinks: 'labeled',
      bookingCta: 'sticky',
    },
    present: [
      'booking-step-header',
      'technician-profile-cards',
      'featured-services-scroll',
      'service-menu-list',
      'location-cards',
      'booking-policy',
      'booking-social-links-labeled',
    ],
    absent: [
      'editorial-hero',
      'editorial-about',
      'editorial-featured-services',
      'service-menu-grouped-categories',
      'editorial-visit',
      'editorial-policies',
      'booking-social-links',
    ],
  },
} as const satisfies Record<Stage5Profile, {
  absent: readonly string[];
  layout: Layout;
  present: readonly string[];
  sectionVariants: Readonly<Record<string, string>>;
}>;

type SalonFixtureRow = QueryResultRow & {
  id: string;
  name: string;
  settings: unknown;
};

type ServiceFixtureRow = QueryResultRow & {
  id: string;
  name: string;
};

type TechnicianFixtureRow = QueryResultRow & {
  email: string | null;
  id: string;
  name: string;
  phone: string | null;
};

type FeaturedServiceSnapshot = {
  id: string;
  text: string;
};

type Stage5ProfileSnapshot = {
  serviceText: string;
  structure: string;
};

type BuilderOperation =
  | {
    type: 'move_section';
    sectionId: string;
    targetSectionId: string;
    direction: 'up' | 'down';
  }
  | { type: 'set_variant'; sectionId: string; variant: string | null }
  | { type: 'reset_all' };

type BuilderApiState = {
  config: {
    draft: {
      hiddenSections: string[];
      sectionOrder: string[];
      sectionVariants: Record<string, string>;
    };
    live: unknown;
  };
  content: unknown;
};

const STAGE5_STRUCTURAL_MARKERS = [
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

async function expectStage5ProfileStructure(
  page: Page,
  profile: Stage5Profile,
  salonName: string,
  technicians: TechnicianFixtureRow[],
): Promise<Stage5ProfileSnapshot> {
  const definition = STAGE5_PROFILES[profile];

  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main main')).toHaveCount(0);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('main h1')).toHaveCount(1);
  await expect(page.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();
  await expect(page.getByTestId('booking-experience-intro')).toHaveCount(1);
  await expect(page.getByTestId('booking-appointment-only')).toHaveText('Synthetic appointment only');

  for (const testId of definition.present) {
    await expect(page.getByTestId(testId), `${profile} must render ${testId} exactly once`).toHaveCount(1);
    await expect(page.getByTestId(testId), `${profile} must visibly render ${testId}`).toBeVisible();
  }
  for (const testId of definition.absent) {
    await expect(page.getByTestId(testId), `${profile} must not render ${testId}`).toHaveCount(0);
  }

  await expect(page.locator('[data-public-surface="technicianProfile"]')).toHaveCount(1);
  await expect(page.locator('[data-public-surface="hoursLocation"]')).toHaveCount(1);
  await expect(page.locator('[data-public-surface="socialLinks"]')).toHaveCount(1);

  if (profile === 'identity_led') {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(salonName);
    await expect(page.getByTestId('editorial-hero-image')).toHaveAttribute('alt', `${salonName} salon`);
  }

  if (profile === 'service_led') {
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

  for (const technician of technicians) {
    const profileSurface = profile === 'team_led'
      ? page.getByTestId(`technician-profile-card-${technician.id}`)
      : page.getByTestId(`editorial-technician-${technician.id}`);

    await expect(profileSurface).toHaveCount(1);
    await expect(profileSurface).toContainText(technician.name);
  }

  if (profile === 'team_led') {
    await expect(page.getByTestId('technician-profile-cards').getByRole('listitem')).toHaveCount(technicians.length);
    await expect(page.getByTestId('location-cards').getByRole('listitem')).not.toHaveCount(0);

    const labeledSocialLink = page.getByRole('link', { name: `Visit ${salonName} on Instagram` });
    const socialTarget = await labeledSocialLink.boundingBox();

    await expect(labeledSocialLink).toContainText('Instagram');
    await expect(labeledSocialLink).toHaveAttribute('href', 'https://www.instagram.com/luster-stage4-fixture');
    expect(socialTarget).not.toBeNull();
    expect(socialTarget!.height).toBeGreaterThanOrEqual(44);

    const publicText = await page.locator('body').textContent() ?? '';
    for (const technician of technicians) {
      if (technician.email) {
        expect(publicText).not.toContain(technician.email);
      }
      if (technician.phone) {
        expect(publicText).not.toContain(technician.phone);
      }
    }
  }

  await expectNoDuplicateOrEmptyPublicSurfaces(page);
  await expectNoHorizontalOverflow(page);

  const actualMarkers: string[] = [];
  for (const testId of STAGE5_STRUCTURAL_MARKERS) {
    if (await page.getByTestId(testId).count()) {
      actualMarkers.push(testId);
    }
  }

  return {
    serviceText: (await page.getByTestId(`service-card-${e2eConfig.serviceId}`).textContent() ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    structure: actualMarkers.join('|'),
  };
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

test('Stage 5 variants express four reusable profiles with canonical content across mobile and zoom @mobile-layout', async ({
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
      'SELECT id, name FROM service WHERE salon_id = $1 AND id = $2',
      [SYNTHETIC_SALON_ID, e2eConfig.serviceId],
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
    expect(technicianResult.rows.length).toBeGreaterThan(0);

    const canonicalServiceName = serviceResult.rows[0]!.name;
    const profileSnapshots = new Map<Stage5Profile, Stage5ProfileSnapshot>();

    for (const profile of Object.keys(STAGE5_PROFILES) as Stage5Profile[]) {
      const definition = STAGE5_PROFILES[profile];
      const heroImageUrl = new URL('/assets/images/nextjs-starter-banner.png', baseURL).toString();
      const fixtureSettings = buildFixtureSettings(
        originalSettings,
        definition.layout,
        heroImageUrl,
        {
          businessMode: 'team',
          hiddenSections: [],
          sectionOrder: STAGE5_SECTION_ORDER,
          sectionVariants: definition.sectionVariants,
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
            `${appPath(`/${SYNTHETIC_SALON_SLUG}/book/service`)}?stage5Evidence=${profile}-${scenario.label}`,
            { waitUntil: 'domcontentloaded' },
          );

          expect(response?.ok(), await response?.text()).toBe(true);
          await expect(page.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();

          const snapshot = await expectStage5ProfileStructure(
            page,
            profile,
            salonName!,
            technicianResult.rows,
          );

          expect(snapshot.serviceText).toContain(canonicalServiceName);

          const baseline = profileSnapshots.get(profile);
          if (baseline) {
            expect(snapshot, `${profile} must remain stable at ${scenario.label}`).toEqual(baseline);
          } else {
            profileSnapshots.set(profile, snapshot);
          }

          expect(attemptedWrites, 'The Stage 5 browser walk must not create appointments or payments.').toEqual([]);
          expect(externalRequests, 'The deterministic Stage 5 lane must not depend on hosted resources.').toEqual([]);
        } finally {
          await context.close();
        }
      }
    }

    expect(profileSnapshots.size).toBe(4);
    expect(new Set([...profileSnapshots.values()].map(snapshot => snapshot.structure)).size).toBe(4);
    expect(new Set([...profileSnapshots.values()].map(snapshot => snapshot.serviceText)).size).toBe(1);
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

test('Stage 6 owner builder keeps semantic edits, draft preview order, reset, and targets honest across mobile and zoom @mobile-layout', async ({
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
          sectionOrder: STAGE5_SECTION_ORDER,
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
          `${appPath('/admin/booking-page')}?salon=${encodeURIComponent(SYNTHETIC_SALON_SLUG)}&stage6Evidence=${encodeURIComponent(scenario.label)}`,
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
          new RegExp(`/${e2eConfig.locale}/${SYNTHETIC_SALON_SLUG}/book/service\\?builderPreview=\\d+`),
        );
        await expect(previewIframe).toHaveAttribute('sandbox', 'allow-same-origin');
        await expect(previewIframe).toHaveAttribute('aria-hidden', 'true');
        await expect(previewIframe).toHaveAttribute('tabindex', '-1');
        await expect(previewIframe).toHaveCSS('pointer-events', 'none');
        await expect(preview.getByTestId('service-menu-list')).toBeVisible();
        await expect(preview.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();

        for (const protectedSectionId of ['salonProfile', 'serviceMenu', 'bookingCta']) {
          await expect(page.getByTestId(`builder-visibility-${protectedSectionId}`)).toHaveCount(0);
          await expect(page.getByTestId(`builder-section-status-${protectedSectionId}`)).toHaveText('Protected');
        }

        await expectNoHorizontalOverflow(page);
        await expectBuilderTargetsAtLeast44px(page);

        const beforeState = await fetchBuilderApiState(page);
        const canonicalContent = beforeState.content;
        const livePresentation = beforeState.config.live;
        const serviceTextBefore = (
          await preview.getByTestId(`service-card-${e2eConfig.serviceId}`).textContent()
          ?? ''
        ).replace(/\s+/g, ' ').trim();
        const initialFlowOrder = beforeState.config.draft.sectionOrder.filter(sectionId => (
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

        const groupedOperation = {
          type: 'set_variant',
          sectionId: 'serviceMenu',
          variant: 'grouped_categories',
        } as const;

        await applyBuilderOperationFromPage(
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

        const resetOperation = { type: 'reset_all' } as const;
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
          hiddenSections: [],
          sectionOrder: [...STAGE6_EDITORIAL_STARTING_ORDER],
          sectionVariants: {},
        });
        await expect(page.getByTestId('booking-page-customization-state')).toHaveText('Using starting design');
        await expect(page.getByTestId('builder-reset-all')).toBeDisabled();
        await expect(preview.getByTestId('service-menu-list')).toBeVisible();
        await expect(preview.getByTestId('service-menu-grouped-categories')).toHaveCount(0);

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
        expect(serviceTextAfter, 'the same canonical service must survive move, variant, and reset').toBe(serviceTextBefore);

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

        expect(allowedBuilderPatches).toEqual([
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
