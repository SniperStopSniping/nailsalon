import { expect, test } from '@playwright/test';

for (const width of [320, 390, 768, 1440]) {
  test(`Isla custom presentation preserves booking selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?step=service&isla');

    await expect(page.locator('.isla-headline')).toHaveText('Your nextbeautiful set.');
    await expect(page.getByRole('link', { name: 'Manage my booking' }).first()).toHaveAttribute('href', '/en/isla-nail-studio/find-booking');
    await expect(page.getByRole('navigation', { name: 'Booking progress' })).not.toContainText('Artist');
    await expect(page.locator('.isla-service')).toHaveCount(3);

    await page.getByRole('button', { name: '3 more manicure services' }).click();

    await expect(page.locator('.isla-service')).toHaveCount(6);

    await page.getByTestId('service-card-isla-russian').click();
    await page.getByRole('button', { name: 'Add French finish', exact: true }).click();

    await expect(page.getByTestId('service-sticky-price')).toHaveText('$45');
    await expect(page.getByTestId('service-auto-technician-preview')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove French finish', exact: true })).toHaveCSS('background-color', 'rgb(49, 49, 45)');
    await expect(page.getByTestId('service-sticky-duration')).toHaveText('50 min');
    await expect(page.getByRole('navigation', { name: 'Booking progress' })).not.toContainText('Artist');

    await page.getByRole('button', { name: 'Choose a time', exact: true }).click();

    await expect(page.locator('html')).toHaveAttribute('data-navigation', /\/isla-nail-studio\/book\/time\?.*baseServiceId=isla-russian/);

    const next = await page.locator('html').getAttribute('data-navigation');

    expect(new URL(next!, 'https://example.test').searchParams.get('selectedAddOns')).toContain('isla-extra');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const heroImage = page.locator('.isla-photograph-frame img');

    expect(await heroImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await page.locator('.isla-headline').evaluate(node => getComputedStyle(node).fontFamily)).toContain('Isla Cormorant');

    if (width <= 760) {
      expect(await heroImage.evaluate(node => getComputedStyle(node).borderRadius)).toBe('9px');

      const hero = await page.locator('.isla-hero').boundingBox();
      const title = await page.locator('#isla-services-title').boundingBox();

      expect(title!.y).toBeGreaterThan(hero!.y + hero!.height);
    }
  });
}

test('categories, search and policy controls work without replacing the service engine', async ({ page }) => {
  await page.goto('/?step=service&isla');
  await page.getByRole('button', { name: 'Pedicure', exact: true }).click();

  await expect(page.getByTestId('service-card-isla-pedi')).toBeVisible();

  await page.getByRole('button', { name: 'Search services', exact: true }).click();
  await page.getByPlaceholder('Search services...').fill('Gel-X');

  await expect(page.getByTestId('service-card-isla-extensions')).toBeVisible();
  await expect(page.getByTestId('service-card-isla-pedi')).toHaveCount(0);

  await page.getByRole('button', { name: 'Booking policies', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Appointment agreement' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog', { name: 'Appointment agreement' })).toHaveCount(0);
});

test('other salon pages retain their existing presentation', async ({ page }) => {
  await page.goto('/?step=service&quick-book-layout=brand_artist_centered');

  await expect(page.locator('.isla-page')).toHaveCount(0);
  await expect(page.locator('.qbm-header')).toBeVisible();
});
