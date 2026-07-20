import { expect, type Page, test } from '@playwright/test';

import { appPath, e2eConfig } from './support/config';

const IPHONE_CHROME_USER_AGENT
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';

const MOBILE_VIEWPORTS = [
  { width: 320, height: 700 },
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
