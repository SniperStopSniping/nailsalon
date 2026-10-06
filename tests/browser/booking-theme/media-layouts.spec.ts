import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { QUICK_BOOK_MEDIA_GROUPS, QUICK_BOOK_MEDIA_LAYOUTS } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/quick-book/media-layouts';

test.describe.configure({ timeout: 90_000 });

for (const layout of QUICK_BOOK_MEDIA_LAYOUTS) {
  test(`${layout.id} preserves the real customer booking surface on four canvases`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1440, 1000]]) {
      await page.setViewportSize({ width: width!, height: height! });
      await page.goto(`/?step=service&quick-book-layout=${layout.id}`);
      const header = page.locator('.qbm-header');

      await expect(header).toHaveAttribute('data-qb-layout', layout.id);
      await expect(header.getByRole('heading', { name: 'Isla Nail Studio', exact: true })).toHaveCSS('font-weight', '400');
      await expect(header.locator('.qbm-logo')).toHaveCount(Number(layout.supportsLogo));
      await expect(header.locator('.qbm-profile')).toHaveCount(Number(layout.supportsProfile));
      await expect(header.locator('.qbm-cover')).toHaveCount(Number(layout.supportsCover));
      await expect(header.getByTestId('quick-book-book-button')).toHaveCSS('min-height', '52px');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect.poll(() => header.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);

      if (layout.id === 'cover_hero') {
        await expect(header.locator('h1')).toHaveCSS('color', 'rgb(255, 255, 255)');
      }
      if (layout.supportsLogo) {
        await expect(header.locator('.qbm-logo img')).toHaveCSS('object-fit', 'contain');
      }

      await expect(page.getByRole('heading', { name: 'Our Services' })).toBeVisible();
      // Changing headers must retain the already-shipped mobile rows/desktop cards.
      await expect(page.locator('[data-qbp-service]').first()).toBeVisible();

      if (width === 390 || width === 1440) {
        await testInfo.attach(`${layout.id}-${width}`, { body: await header.screenshot(), contentType: 'image/png' });
      }
    }
    await page.getByTestId('quick-book-book-button').click();

    await expect(page).toHaveURL(/#quick-book-booking$/u);

    const disclosure = page.getByTestId('quick-book-profile-actions');
    await disclosure.locator('summary').focus();
    await page.keyboard.press('Enter');

    await expect(disclosure).toHaveAttribute('open', '');
    await expect(disclosure).toContainText('Exact address shared after booking.');
    expect(await page.locator('body').textContent()).not.toContain('880 Ellesmere');

    await disclosure.locator('summary').click();
    await page.locator('[data-qbp-service]').filter({ hasText: 'Russian Manicure' }).click();

    await expect(page.getByTestId('service-inline-addons-panel')).toBeVisible();
    await expect(page.getByText('Simple nail art')).toBeVisible();
    await expect(page.getByTestId('service-continue-button')).toBeEnabled();
    expect(errors).toEqual([]);
  });
}

for (const group of QUICK_BOOK_MEDIA_GROUPS) {
  const layout = QUICK_BOOK_MEDIA_LAYOUTS.find(item => item.mediaConfiguration === group.id)!;

  test(`${group.id} balances 0–5 facts, long content and missing media`, async ({ page }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (let count = 0; count <= 5; count += 1) {
        await page.goto(`/?step=service&quick-book-layout=${layout.id}&case=facts-${count}`);
        const expected = Math.min(count, 4);

        await expect(page.locator('.qbp-facts > .qbp-fact')).toHaveCount(expected);

        if (expected) {
          const arrangement = await page.locator('.qbp-facts').getAttribute('data-arrangement');

          expect([['one'], ['two', 'list'], ['three', 'list'], ['four', 'list']][expected - 1]).toContain(arrangement);
        } else {
          await expect(page.locator('.qbp-facts')).toHaveCount(0);
        }

        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      for (const scenario of ['long-name', 'long-facts', 'missing-media', 'expired-media', 'hidden-media']) {
        await page.goto(`/?step=service&quick-book-layout=${layout.id}&case=${scenario}`);
        if (scenario === 'long-facts') {
          await expect(page.locator('.qbp-facts')).toHaveAttribute('data-arrangement', 'list');
        }

        await expect.poll(() => page.locator('.qbm-header img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByTestId('quick-book-book-button')).toBeVisible();
      }
    }
  });
}

test('logo compositions preserve square, wide and tall uploads', async ({ page }) => {
  for (const [width, height] of [[512, 512], [300, 900], [1200, 240]]) {
    await page.route('**/quick-book-logo-fixture.png', route => route.fulfill({ contentType: 'image/png', body: readFileSync(path.join(__dirname, 'logo-fixtures', `${width}x${height}.png`)) }));
    for (const layout of QUICK_BOOK_MEDIA_LAYOUTS.filter(item => item.supportsLogo)) {
      await page.goto(`/?step=service&quick-book-layout=${layout.id}&case=logo-${width}`);
      const image = page.locator('.qbm-logo img');

      await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(width);
      await expect(image).toHaveCSS('object-fit', 'contain');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.unroute('**/quick-book-logo-fixture.png');
  }
});
