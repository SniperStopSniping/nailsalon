import { expect, test } from '@playwright/test';

for (const width of [320, 390, 430]) {
  test(`saved setup opens the single lifetime offer directly at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Lock in Luster free for life' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your Luster site is saved' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Choose how to start' })).toHaveCount(0);
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Claim my free lifetime plan' })).toHaveCount(1);
    await expect(page.getByText('100 free texts included')).toBeVisible();
    await expect(page.getByText('Unlimited emails', { exact: true })).toBeVisible();
    await expect(page.getByText('Usage-based features are separate')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.screenshot({ path: testInfo.outputPath(`direct-offer-${width}-viewport.png`), fullPage: false });
    await page.screenshot({ path: testInfo.outputPath(`direct-offer-${width}.png`), fullPage: true });
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Lock in Luster free for life' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Preview my saved site' })).toHaveAttribute('href', '/en/admin/website/preview/11111111-1111-4111-8111-111111111111');
    await expect(page.getByRole('button', { name: 'Edit my site' })).toBeEnabled();
  });
}

test('photo and preserved-edit notices remain available on the offer', async ({ page }) => {
  await page.goto('/?warnings=1');

  await expect(page.getByRole('heading', { name: 'Lock in Luster free for life' })).toBeVisible();
  await expect(page.getByText(/photos listed earlier remain only on this device/)).toBeVisible();
  await expect(page.getByTestId('onboarding-preserved-edits')).toContainText('opening hours, service prices');
});
