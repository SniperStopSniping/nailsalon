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
  e2eConfig,
  usingExternalBaseUrl,
} from './support/config';

const SYNTHETIC_SALON_ID = 'salon_nail-salon-no5';
const SYNTHETIC_SALON_SLUG = 'nail-salon-no5';

const SECTION_ORDER = [
  'salonProfile',
  'featuredServices',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
] as const;

const VIEWPORT_SCENARIOS = [
  { label: '320px', viewport: { width: 320, height: 700 }, zoom: 1 },
  { label: '375x600', viewport: { width: 375, height: 600 }, zoom: 1 },
  // Matches the existing public-booking Chromium accessibility approximation
  // in mobile-service-layout.e2e.ts: a desktop viewport with 200% CSS zoom.
  { label: '200% zoom', viewport: { width: 1280, height: 800 }, zoom: 2 },
] as const;

type Layout = 'editorial' | 'quick_book';

type SalonFixtureRow = QueryResultRow & {
  id: string;
  name: string;
  settings: unknown;
};

type ServiceFixtureRow = QueryResultRow & {
  id: string;
  name: string;
};

type FeaturedServiceSnapshot = {
  id: string;
  text: string;
};

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
): Record<string, unknown> {
  const base = isRecord(originalSettings) ? originalSettings : {};
  const editorial = layout === 'editorial';
  const side = {
    layout,
    stylePack: 'default',
    tokenOverrides: null,
    sectionOrder: [...SECTION_ORDER],
    sectionVariants: editorial
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
        },
    // Keep a content-ready section in the order but hidden, so the browser
    // proves Stage 2 admission survives the Stage 4 presentation variants.
    hiddenSections: ['hoursLocation'],
    businessMode: 'solo',
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
