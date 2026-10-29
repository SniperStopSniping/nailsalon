import { expect, test } from '@playwright/test';

for (const layout of ['visual_grid', 'clean_list', 'editorial_cards', 'category_menu', 'editorial_price_list'] as const) {
  test(`${layout} retains its catalogue geometry and selection at phone and desktop widths`, async ({ page }) => {
    await page.route('https://**/*', route => route.abort());
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/?step=service&quick-book-layout=compact_dropdown&service-menu-layout=${layout}`);
      const menu = page.locator('[data-booking-menu-layout]');
      const grid = menu.locator('.qbp-service-grid').first();
      const card = menu.locator('[data-qbp-service]').filter({ hasText: 'Russian Manicure' });

      await expect(menu).toHaveAttribute('data-booking-menu-layout', layout);
      await expect(card).toBeVisible();
      await expect(page.locator('.qbp-page')).toHaveCSS('container-type', 'inline-size');

      const columns = await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);

      expect(columns).toBe(layout === 'visual_grid' && width === 1440 ? 4 : 1);
      await expect(card).toHaveCSS('display', layout === 'visual_grid' && width === 390 ? 'grid' : 'flex');

      if (layout !== 'visual_grid') {
        await expect(card).toHaveCSS('flex-direction', layout === 'editorial_cards' ? 'column' : 'row');
      }
      const image = card.locator('[data-testid^="service-card-image-"]').first();
      if (layout === 'editorial_price_list') {
        await expect(image).toHaveCount(0);
      } else {
        await expect(image).toHaveCSS('height', layout === 'visual_grid' ? width === 1440 ? '170px' : '102px' : layout === 'editorial_cards' ? '148px' : '88px');

        if (layout === 'clean_list' || layout === 'category_menu') {
          await expect(image).toHaveCSS('width', '96px');
        }
      }
      await card.click();

      await expect(card).toHaveAttribute('data-selected', 'true');

      const addOns = page.getByTestId('service-inline-addons-panel');

      await expect(addOns).toBeVisible();
      await expect(addOns).toContainText('Simple nail art');
      await expect(page.getByTestId('service-continue-button')).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
