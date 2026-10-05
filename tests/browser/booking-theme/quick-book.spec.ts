import { expect, test } from '@playwright/test';

const layouts = ['compact_dropdown', 'side_portrait', 'hero_banner'] as const;
for (const layout of layouts) {
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1440, 1000]]) {
    test(`${layout} approved customer composition at ${width}px`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width: width!, height: height! });
      await page.goto(`/?step=service&quick-book-layout=${layout}`);

      await expect(page.locator(`[data-qb-layout='${layout}']`)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Our Services' })).toBeVisible();

      const title = page.getByRole('heading', { name: 'Isla Nail Studio', exact: true });

      await expect(title).toHaveCSS('font-weight', '400');
      expect(await title.evaluate(element => getComputedStyle(element).fontFamily)).toContain('QBP Newsreader');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      if (layout !== 'compact_dropdown') {
        await expect(page.getByTestId('quick-book-book-button')).toHaveCSS('min-height', '52px');

        await page.getByTestId('quick-book-book-button').click();

        await expect(page).toHaveURL(/#quick-book-booking$/u);
      }
      const summary = page.getByTestId('quick-book-profile-actions').locator('summary');
      await summary.focus();
      await page.keyboard.press('Enter');

      await expect(page.getByTestId('quick-book-profile-actions')).toHaveAttribute('open', '');
      await expect(page.getByText('Exact address shared after booking.')).toBeVisible();
      expect(await page.locator('body').textContent()).not.toContain('880 Ellesmere');

      await summary.click();
      await page.locator('[data-qbp-service]').filter({ hasText: 'Russian Manicure' }).click();

      await expect(page.locator('[data-qbp-service][data-selected=true]')).toHaveCount(1);
      await expect(page.getByTestId('service-inline-addons-panel')).toBeVisible();
      await expect(page.getByText('Simple nail art')).toBeVisible();
      await expect(page.getByTestId('service-continue-button')).toBeEnabled();
      expect(errors).toEqual([]);
    });
  }

  test(`${layout} optional fact counts and long content stay balanced`, async ({ page }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (let count = 0; count <= 5; count += 1) {
        await page.goto(`/?step=service&quick-book-layout=${layout}&case=facts-${count}`);
        const expectedCount = Math.min(count, layout === 'compact_dropdown' ? 3 : 4);

        await expect(page.locator('.qbp-facts > .qbp-fact')).toHaveCount(expectedCount);

        if (expectedCount) {
          await expect(page.locator('.qbp-facts')).toHaveAttribute('data-arrangement', ['one', 'two', 'three', 'four'][expectedCount - 1]!);
        } else {
          await expect(page.locator('.qbp-facts')).toHaveCount(0);
        }

        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      await page.goto(`/?step=service&quick-book-layout=${layout}&case=long-facts`);

      await expect(page.locator('.qbp-facts')).toHaveAttribute('data-arrangement', 'list');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  for (const scenario of ['long-name', 'missing-media', 'expired-media', 'hidden-media']) {
    test(`${layout} ${scenario} preserves usable customer content`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(`/?step=service&quick-book-layout=${layout}&case=${scenario}`);

      await expect(page.locator('.qbp-brand h1')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      if (scenario === 'expired-media') {
        await expect(page.locator('[data-qb-image=fallback]')).toHaveCount(layout === 'compact_dropdown' ? 0 : 1);
      }

      await expect(page.locator('[data-qbp-service]').first()).toBeVisible();
    });
  }
}
