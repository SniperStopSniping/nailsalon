import { expect, test } from '@playwright/test';

const labels = ['Before Photo to Start', 'After Photo to Finish', 'After Photo to Pay', 'Enable Auto-Post', 'AI Caption'];

for (const width of [320, 390, 1280]) {
  test(`visible labels focus the correct controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    for (const label of labels) {
      const select = page.getByRole('combobox', { name: label, exact: true });

      await expect(select).toHaveValue('');

      await page.locator('label').filter({ hasText: label }).click();

      await expect(select).toBeFocused();
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const locale of ['en', 'fr']) {
  test(`Back has an accessible name and preserves the ${locale} destination`, async ({ page }) => {
    await page.goto(`/?locale=${locale}`);
    const back = page.getByRole('button', { name: 'Back to platform dashboard', exact: true });
    const size = await back.boundingBox();

    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(44);

    await back.click();

    await expect(page).toHaveURL(new RegExp(`/${locale}/super-admin$`));
  });
}

test('labelled selection survives a failed save with no success message', async ({ page }) => {
  await page.goto('/');
  const select = page.getByRole('combobox', { name: 'Before Photo to Start', exact: true });
  await select.selectOption('required');
  await page.getByRole('button', { name: 'Save Global Overrides', exact: true }).click();

  await expect(page.getByText('Synthetic policy save refused. No policy changed.', { exact: true })).toBeVisible();
  await expect(select).toHaveValue('required');
  await expect(page.getByRole('button', { name: 'Save Global Overrides', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Saved!', exact: true })).toHaveCount(0);
});
