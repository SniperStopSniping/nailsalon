import { expect, test } from '@playwright/test';

const viewports = [[320, 568], [375, 667], [390, 844], [430, 932], [1180, 800]] as const;

for (const [width, height] of viewports) {
  test(`website entry and adjacent address fields ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90_000);

    await page.setViewportSize({ width, height });
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Let’s build your website.');
    await expect(page.getByRole('link', { name: 'Open owner dashboard', exact: true })).toHaveAttribute('href', '/en/owner-sign-in');

    const build = page.getByRole('link', { name: 'Build my website', exact: true });

    expect((await build.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await build.click();
    await page.getByRole('button', { name: /Start with Quick Book/u }).click();
    await page.getByLabel('Salon or studio name *', { exact: true }).fill('Maya Nail Atelier');
    await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Independent nail tech/u }) }).click();
    await page.getByLabel('Your name *', { exact: true }).fill('Maya');
    await page.getByRole('button', { name: 'Show me my site →', exact: true }).click();
    await page.getByRole('button', { name: 'Continue setting up my site', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Where can clients find you?' })).toBeVisible();

    const city = page.getByLabel('City *', { exact: true });
    const address = page.getByLabel('Full address *', { exact: true });
    const cityBox = (await city.boundingBox())!;
    const addressBox = (await address.boundingBox())!;

    expect(addressBox.y).toBeGreaterThan(cityBox.y + cityBox.height);
    expect(addressBox.y - cityBox.y - cityBox.height).toBeLessThan(80);
    expect(addressBox.x).toBeCloseTo(cityBox.x, 0);
    expect(addressBox.width).toBeCloseTo(cityBox.width, 0);

    await city.fill('Toronto');
    await address.fill('880 Ellesmere Rd, Unit 2');
    await page.reload();

    await expect(city).toHaveValue('Toronto');
    await expect(address).toHaveValue('880 Ellesmere Rd, Unit 2');
    await expect(page.locator('[aria-controls="onboarding-contact-card-panel"]')).not.toContainText('Complete');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('French website entry keeps localized links usable on a short phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/fr');

  await expect(page.getByRole('link', { name: 'Créer mon site web', exact: true })).toHaveAttribute('href', '/fr/onboarding-v1');
  await expect(page.getByRole('link', { name: 'Ouvrir mon tableau de bord', exact: true })).toHaveAttribute('href', '/fr/owner-sign-in');

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
