import { expect, type Locator, type Page, test } from '@playwright/test';

import { selectBookableSlotFromApi } from './support/booking';
import { appPath, appPathPattern, e2eConfig } from './support/config';

const IPHONE_CHROME_USER_AGENT
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';

const MOBILE_VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 600 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const WIDE_VIEWPORTS = [
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const;

async function openServicePage(page: Page): Promise<void> {
  await page.goto(appPath(`/${e2eConfig.salonSlug}/book/service`), {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('[data-testid^="service-card-"]').first().waitFor({ state: 'visible', timeout: 15_000 });
}

async function expectNoPageHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
    bodyClient: document.body.clientWidth,
  }));

  expect(overflow.docScroll, 'document must not scroll horizontally').toBeLessThanOrEqual(overflow.docClient);
  expect(overflow.bodyScroll, 'body must not scroll horizontally').toBeLessThanOrEqual(overflow.bodyClient);
}

type TargetMeasurement = {
  height: number;
  label: string;
  width: number;
};

async function expectPracticalBookingTargets(page: Page): Promise<TargetMeasurement[]> {
  const targets = await page.locator('button, a[href], input, select, textarea').evaluateAll((elements) => {
    const measured = new Set<Element>();
    return elements.flatMap((element) => {
      if (!(element instanceof HTMLElement)) {
        return [];
      }

      const style = window.getComputedStyle(element);
      const ownBounds = element.getBoundingClientRect();
      if (
        style.display === 'none'
        || style.visibility === 'hidden'
        || ownBounds.width === 0
        || ownBounds.height === 0
      ) {
        return [];
      }

      const effectiveTarget = element instanceof HTMLInputElement
        && (element.type === 'checkbox' || element.type === 'radio')
        ? element.closest('label') ?? element
        : element;
      if (measured.has(effectiveTarget)) {
        return [];
      }
      measured.add(effectiveTarget);

      const bounds = effectiveTarget.getBoundingClientRect();
      const label = element.getAttribute('aria-label')
        || element.getAttribute('title')
        || element.textContent?.replace(/\s+/g, ' ').trim()
        || (element instanceof HTMLInputElement ? element.placeholder : '')
        || element.getAttribute('data-testid')
        || element.tagName.toLowerCase();

      return [{ height: bounds.height, label, width: bounds.width }];
    });
  });

  const unnamed = targets.filter(target => !target.label);
  const undersized = targets.filter(target => target.width < 43.5 || target.height < 43.5);

  expect(unnamed, 'Every visible booking target needs an accessible name or visible label.').toEqual([]);
  expect(undersized, `Sub-44px booking targets: ${JSON.stringify(undersized)}`).toEqual([]);

  return targets;
}

async function expectNoTargetOverlap(targets: Locator[]): Promise<void> {
  const boxes = (await Promise.all(targets.map(target => target.boundingBox())))
    .filter(box => box !== null);

  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex]!;
      const right = boxes[rightIndex]!;
      const overlapWidth = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
      const overlapHeight = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);

      expect(overlapWidth > 0.5 && overlapHeight > 0.5, 'Adjacent interactive targets must not overlap.').toBe(false);
    }
  }
}

async function expectReducedMotionControl(control: Locator): Promise<void> {
  await expect(control).toBeVisible();

  const transitionProperty = await control.evaluate(
    element => window.getComputedStyle(element).transitionProperty,
  );

  expect(transitionProperty, 'Reduced motion must suppress control transitions.').toBe('none');

  await control.hover();

  const hoveredTransform = await control.evaluate(
    element => window.getComputedStyle(element).transform,
  );

  expect(hoveredTransform, 'Reduced motion must suppress hover scaling.').toBe('none');

  const page = control.page();
  const bounds = await control.boundingBox();

  expect(bounds).not.toBeNull();

  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();

  const activeTransform = await control.evaluate(
    element => window.getComputedStyle(element).transform,
  );

  expect(activeTransform, 'Reduced motion must suppress active scaling.').toBe('none');

  await page.mouse.move(0, 0);
  await page.mouse.up();
}

async function selectConfiguredService(page: Page): Promise<void> {
  const configuredCard = page.getByTestId(`service-card-${e2eConfig.serviceId}`);
  const firstCard = page.locator('[data-testid^="service-card-"]:not([data-testid*="image"]):not([data-testid*="content"]):not([data-testid*="meta"]):not([data-testid*="price"]):not([data-testid*="addon"])').first();
  const card = await configuredCard.isVisible().catch(() => false) ? configuredCard : firstCard;

  await expect(card).toBeVisible();

  await card.click();

  await expect(page.getByTestId('service-continue-button')).toBeVisible();
}

async function walkReadOnlyBookingTargets(page: Page): Promise<void> {
  await openServicePage(page);

  const search = page.getByPlaceholder(/search services/i);

  await expect(search).toBeVisible();

  await search.fill('gel');

  await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();

  await expectPracticalBookingTargets(page);
  await page.getByRole('button', { name: 'Clear search' }).click();

  const categoryTargets = await page.getByTestId('service-category-track').getByRole('button').all();
  await expectNoTargetOverlap(categoryTargets);

  await selectConfiguredService(page);
  await expectPracticalBookingTargets(page);

  await expectReducedMotionControl(page.getByTestId('service-continue-button'));

  const addOnTargets = await page.locator('[data-testid^="service-addon-row-"] button').all();
  await expectNoTargetOverlap(addOnTargets);

  await page.getByTestId('service-continue-button').click();
  await page.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);

  if (appPathPattern('/book/tech').test(page.url())) {
    await expectPracticalBookingTargets(page);
    const back = page.getByRole('button', { name: 'Go back' });

    await expectReducedMotionControl(back);

    await back.focus();

    await expect(back).toBeFocused();

    const configuredTechnician = page.getByRole('button', {
      name: new RegExp(e2eConfig.staffTechnicianName, 'i'),
    });
    const technician = await configuredTechnician.isVisible().catch(() => false)
      ? configuredTechnician
      : page.getByRole('button', { name: /surprise me/i });
    await technician.click();
  }

  await expect(page).toHaveURL(appPathPattern('/book/time'));

  await expectPracticalBookingTargets(page);
  await expectReducedMotionControl(page.getByRole('button', { name: 'Previous month' }));
  await expectReducedMotionControl(page.getByRole('button', { name: 'Next month' }));
  await expectNoTargetOverlap([
    page.getByRole('button', { name: 'Previous month' }),
    page.getByRole('button', { name: 'Next month' }),
  ]);
  await expectNoTargetOverlap(await page.locator('[data-testid^="calendar-day-"]:not([disabled])').all());

  const timeStepUrl = new URL(page.url());
  const technicianId = timeStepUrl.searchParams.get('techId');
  await selectBookableSlotFromApi(page, {
    technicianId: technicianId && technicianId !== 'any' ? technicianId : null,
    startDayOffset: 3,
    baseServiceId: timeStepUrl.searchParams.get('baseServiceId'),
    locationId: timeStepUrl.searchParams.get('locationId'),
    selectedAddOns: timeStepUrl.searchParams.get('selectedAddOns'),
  });

  await expect(page).toHaveURL(appPathPattern('/book/confirm'));

  await expectPracticalBookingTargets(page);
  await expectNoPageHorizontalOverflow(page);

  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press('Tab');

  await expect(edit).toBeFocused();
  await expect.poll(() => edit.evaluate(element => window.getComputedStyle(element).outlineStyle)).not.toBe('none');
}

const ACCESSIBILITY_VIEWPORTS = [
  { label: 'compact 320x700', viewport: { height: 700, width: 320 } },
  { label: 'short 375x600', viewport: { height: 600, width: 375 } },
  { label: 'normal mobile 390x844', viewport: { height: 844, width: 390 } },
] as const;

for (const { label, viewport } of ACCESSIBILITY_VIEWPORTS) {
  test(`public booking targets meet the practical floor at ${label} @mobile-layout`, async ({
    browser,
    baseURL,
  }) => {
    test.slow();

    const context = await browser.newContext({
      baseURL,
      viewport,
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
      userAgent: IPHONE_CHROME_USER_AGENT,
      reducedMotion: 'reduce',
    });
    const attemptedWrites: string[] = [];

    try {
      const page = await context.newPage();
      await page.route('**/*', async (route) => {
        const method = route.request().method();
        if (method !== 'GET' && method !== 'HEAD') {
          attemptedWrites.push(`${method} ${route.request().url()}`);
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });

      await walkReadOnlyBookingTargets(page);

      expect(attemptedWrites, 'The accessibility browser walk must remain read-only.').toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('public booking targets remain usable under the Chromium 200% CSS zoom approximation @mobile-layout', async ({
  browser,
  baseURL,
}) => {
  test.slow();

  const context = await browser.newContext({
    baseURL,
    viewport: { height: 800, width: 1280 },
    reducedMotion: 'reduce',
  });
  const attemptedWrites: string[] = [];

  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.zoom = '2';
    });
  });

  try {
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const method = route.request().method();
      if (method !== 'GET' && method !== 'HEAD') {
        attemptedWrites.push(`${method} ${route.request().url()}`);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    await walkReadOnlyBookingTargets(page);
    await expectNoPageHorizontalOverflow(page);

    expect(attemptedWrites, 'The zoom accessibility walk must remain read-only.').toEqual([]);
  } finally {
    await context.close();
  }
});

for (const viewport of MOBILE_VIEWPORTS) {
  test(`service page fits ${viewport.width}x${viewport.height} without clipping @mobile-layout`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport,
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
      userAgent: IPHONE_CHROME_USER_AGENT,
    });

    try {
      const page = await context.newPage();
      await openServicePage(page);

      await expectNoPageHorizontalOverflow(page);

      // Heading fully below the viewport top.
      const salonName = page.getByTestId('booking-salon-name');

      await expect(salonName).toBeVisible();

      const nameBox = await salonName.boundingBox();

      expect(nameBox).not.toBeNull();
      expect(nameBox!.y).toBeGreaterThanOrEqual(0);

      // Featured cards stay inside the viewport; the carousel scrolls
      // internally instead of widening the document.
      const featuredScroll = page.getByTestId('featured-services-scroll');
      if (await featuredScroll.count()) {
        const firstFeatured = page.locator('[data-testid^="featured-service-card-"]').first();

        await expect(firstFeatured).toBeVisible();

        const cardBox = await firstFeatured.boundingBox();

        expect(cardBox).not.toBeNull();
        expect(cardBox!.x).toBeGreaterThanOrEqual(0);
        expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(viewport.width + 1);

        const scrollable = await featuredScroll.evaluate(
          element => element.scrollWidth >= element.clientWidth,
        );

        expect(scrollable).toBe(true);
      }

      // Category chips scroll inside their own track.
      const chipScroll = page.getByTestId('service-category-scroll');
      if (await chipScroll.count()) {
        const chipBox = await chipScroll.boundingBox();

        expect(chipBox).not.toBeNull();
        expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(viewport.width + 1);
      }

      await expectNoPageHorizontalOverflow(page);

      // Selecting the LAST card raises the sticky bar; the reserved bottom
      // clearance must keep that card fully above the bar at scroll end.
      const cards = page.locator('[data-testid^="service-card-"]:not([data-testid*="image"]):not([data-testid*="content"]):not([data-testid*="meta"]):not([data-testid*="price"]):not([data-testid*="addon"])');
      const lastCard = cards.last();
      await lastCard.scrollIntoViewIfNeeded();
      await lastCard.click();

      const stickyBar = page.getByTestId('service-sticky-bar');

      await expect(stickyBar).toBeVisible();

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

      const [cardBox, stickyBox] = await Promise.all([
        lastCard.boundingBox(),
        stickyBar.boundingBox(),
      ]);

      expect(cardBox).not.toBeNull();
      expect(stickyBox).not.toBeNull();
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(stickyBox!.y + 1);

      await expectNoPageHorizontalOverflow(page);
    } finally {
      await context.close();
    }
  });
}

for (const viewport of WIDE_VIEWPORTS) {
  test(`service page keeps the tablet/desktop layout at ${viewport.width}x${viewport.height} @mobile-layout`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, viewport });

    try {
      const page = await context.newPage();
      await openServicePage(page);

      await expectNoPageHorizontalOverflow(page);

      const firstFeatured = page.locator('[data-testid^="featured-service-card-"]').first();
      if (await firstFeatured.count()) {
        const cardBox = await firstFeatured.boundingBox();

        expect(cardBox).not.toBeNull();
        // sm: widths take over on wide viewports — cards keep their fixed
        // 280/320px width instead of shrinking with the viewport.
        expect(cardBox!.width).toBeGreaterThanOrEqual(279);
      }
    } finally {
      await context.close();
    }
  });
}
