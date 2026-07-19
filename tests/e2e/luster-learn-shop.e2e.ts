import { expect, test } from '@playwright/test';

import { appPath, authStatePaths, e2eConfig } from './support/config';

test.use({
  storageState: authStatePaths.superAdmin,
  viewport: { width: 390, height: 844 },
});

test('More opens the internal Luster app and browser Back returns to More', async ({ page }) => {
  test.slow();

  const organizationsResponse = await page.request.get(
    `/api/super-admin/organizations?page=1&pageSize=20&q=${encodeURIComponent(e2eConfig.salonSlug)}`,
  );
  const organizations = await organizationsResponse.json();
  const salon = organizations.items?.find(
    (item: { slug?: string }) => item.slug === e2eConfig.salonSlug,
  );

  expect(salon?.id, 'The configured E2E salon must exist.').toBeTruthy();

  const impersonation = await page.request.post('/api/super-admin/impersonate', {
    data: { salonId: salon.id },
  });

  expect(impersonation.ok(), await impersonation.text()).toBe(true);

  try {
    await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.getByTestId('owner-nav-more')).toBeVisible();

    await page.getByTestId('owner-nav-more').click();

    await expect(page.getByTestId('owner-more-workspace')).toBeVisible();

    await page.getByTestId('admin-app-tile-luster').click();

    await expect(page).toHaveURL(/\/admin\/luster/);

    await expect(page.getByRole('heading', { name: 'Luster', exact: true })).toBeVisible();

    await expect(page.getByTestId('luster-promos')).toBeVisible();

    await expect(page.getByTestId('luster-shop')).toBeVisible();

    await expect(page.getByTestId('luster-learn')).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.goBack();

    await expect(page).not.toHaveURL(/\/admin\/luster/);

    await expect(page.getByTestId('owner-more-workspace')).toBeVisible();
  } finally {
    await page.request.delete('/api/super-admin/impersonate');
  }
});
