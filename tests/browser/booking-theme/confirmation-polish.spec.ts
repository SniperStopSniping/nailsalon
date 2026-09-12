import { expect, test } from '@playwright/test';

import { CUSTOMER_SITE_PALETTE_PRESETS } from '../../../src/libs/customerSitePresentation';

for (const palette of CUSTOMER_SITE_PALETTE_PRESETS) {
  test(`${palette} confirmation has readable labels and usable inputs`, async ({ page }) => {
    await page.goto(`/?step=confirm&palette=${palette}`);
    const name = page.getByRole('textbox', { name: 'Customer name' });

    await expect(name).toBeVisible();

    await name.focus();

    await expect(name).toHaveCSS('outline-style', 'solid');
    await expect(page.locator('.booking-detail-row')).toHaveCount(2);
    await expect(page.locator('.booking-detail-row').first()).toHaveCSS('border-top-width', '1px');
    await expect(page.getByText('Not booked yet. Confirm below to reserve your time.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    await expect(page.locator('main > div').first().locator('svg')).toHaveCount(0);

    const colors = await page.locator('.booking-confirm-page').evaluate((element) => {
      const style = getComputedStyle(element);
      return { primary: style.getPropertyValue('--n5-ink-main').trim(), secondary: style.getPropertyValue('--n5-ink-muted').trim() };
    });

    expect(colors.secondary).toBe(colors.primary);

    const inputColor = await name.evaluate(element => getComputedStyle(element).color);

    await expect(page.getByRole('heading', { name: 'Your contact details' })).toHaveCSS('color', inputColor);
  });
}

for (const width of [320, 375, 1280]) {
  test(`${width}px confirmation reflows and preserves the booking gate`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?step=confirm&palette=luster_berry');
    const confirm = page.getByRole('button', { name: /Confirm appointment/ });

    await expect(confirm).toBeDisabled();

    await page.getByRole('textbox', { name: 'Customer name' }).fill('Review Guest');
    await page.getByRole('textbox', { name: 'Customer email' }).fill('review@example.com');
    await page.getByRole('textbox', { name: 'Customer phone' }).fill('4165550100');

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));

    await expect.poll(() => page.locator('main [style*="opacity"]').evaluateAll(elements => elements.every(element => getComputedStyle(element).opacity === '1'))).toBe(true);

    await page.screenshot({ path: info.outputPath(`confirmation-${width}.png`), fullPage: true });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
