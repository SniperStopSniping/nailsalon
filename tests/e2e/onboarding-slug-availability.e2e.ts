import { expect, test } from '@playwright/test';

const MOBILE_VIEWPORTS = [
  { height: 568, width: 320 },
  { height: 667, width: 375 },
  { height: 844, width: 390 },
  { height: 932, width: 430 },
] as const;

for (const viewport of MOBILE_VIEWPORTS) {
  test(`Screen 1 rejects an occupied site URL at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const checkedSlugs: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    await page.route('**/api/onboarding/v1/slug-availability', async (route) => {
      const request = route.request();
      const body = request.postDataJSON() as { slug?: unknown };
      const slug = typeof body.slug === 'string' ? body.slug : '';
      const available = slug !== 'isla-nail-studio';
      checkedSlugs.push(slug);
      await route.fulfill({
        body: JSON.stringify({
          data: {
            available,
            reason: available ? 'available' : 'unavailable',
            slug,
          },
        }),
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        status: 200,
      });
    });

    await page.goto('/en/onboarding-v1');
    await page.getByRole('button', { name: 'Start with Quick Book' }).click();
    await page.getByLabel('Salon or studio name *', { exact: true }).fill('Isla Nail Studio');
    await page.locator('label').filter({
      has: page.getByRole('radio', { name: /^Independent nail tech/u }),
    }).click();
    await page.getByLabel('Your name *', { exact: true }).fill('Daniela');

    await expect(page.getByText('This URL is not available. Choose a different URL.'))
      .toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose another URL' })).toBeVisible();
    expect(checkedSlugs).toEqual(['isla-nail-studio']);

    await page.getByRole('button', { name: 'Show me my site →', exact: true }).click();

    const customUrl = page.getByLabel('Custom Luster URL');

    await expect(customUrl).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Let’s start with your business' }))
      .toBeVisible();

    const availabilityStatus = page.getByRole('status').filter({
      hasText: 'This URL is not available',
    });

    await expect(availabilityStatus).toHaveAttribute('id', /.+/u);
    await expect(customUrl).toHaveAttribute('aria-describedby', /.+/u);

    await customUrl.fill('isla-nail-studio-new-owner');

    await expect(page.getByText('This URL is available')).toBeVisible();
    expect(checkedSlugs).toEqual(['isla-nail-studio', 'isla-nail-studio-new-owner']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  });
}
