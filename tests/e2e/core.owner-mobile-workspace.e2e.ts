import { expect, test } from '@playwright/test';

import { appPath, authStatePaths, e2eConfig } from './support/config';

test.use({
  storageState: authStatePaths.superAdmin,
  viewport: { width: 390, height: 844 },
});

test('owner mobile navigation opens visible top-aligned workspaces and day details', async ({
  page,
}) => {
  test.slow();

  const start = await page.request.get(
    `/api/super-admin/organizations?page=1&pageSize=20&q=${encodeURIComponent(e2eConfig.salonSlug)}`,
  );
  const organizations = await start.json();
  const salon = organizations.items?.find(
    (item: { slug?: string }) => item.slug === e2eConfig.salonSlug,
  );

  expect(salon?.id, 'The configured E2E salon must exist.').toBeTruthy();

  const impersonation = await page.request.post(
    '/api/super-admin/impersonate',
    {
      data: { salonId: salon.id },
    },
  );

  expect(impersonation.ok(), await impersonation.text()).toBe(true);

  try {
    await page.goto(
      `${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`,
      { waitUntil: 'domcontentloaded' },
    );

    await expect(page.getByTestId('owner-today-workspace')).toBeVisible();
    await expect(page.getByTestId('owner-nav-calendar')).toBeVisible();

    await page.getByTestId('owner-nav-calendar').click();

    await expect(
      page.getByText('Schedule', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Monthly' })).toBeVisible();

    const calendarDay = page.locator('button[aria-label*="Luster"]').first();

    await expect(calendarDay).toBeVisible();

    await calendarDay.click();
    const closeDay = page.getByRole('button', { name: 'Close day details' });

    await expect(closeDay).toBeVisible();

    const daySheet = closeDay.locator(
      'xpath=ancestor::div[contains(@class,"fixed")][1]',
    );
    const box = await daySheet.boundingBox();

    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(846);

    await closeDay.click();
    await page.getByRole('button', { name: 'Back' }).first().click();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByTestId('owner-nav-clients').click();

    await expect(
      page.getByText('Clients', { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Back' }).first().click();

    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByTestId('owner-nav-services').click();

    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible();

    await page.getByRole('button', { name: 'Back' }).first().click();

    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);

    await page.getByTestId('owner-nav-more').click();

    await expect(page.getByTestId('owner-more-workspace')).toBeVisible();
    await expect(page.getByTestId('admin-app-tile-settings')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);

    // Integrations opens through a deep-linkable URL and browser Back closes it.
    await expect(page.getByTestId('admin-app-tile-integrations')).toBeVisible();

    await page.getByTestId('admin-app-tile-integrations').click();

    await expect(page.getByTestId('integrations-modal')).toBeVisible();
    await expect(page).toHaveURL(/app=integrations/);
    await expect(page.getByTestId('integration-row-google')).toBeVisible();
    await expect(page.getByTestId('integration-row-texting')).toBeVisible();

    await page.goBack();

    await expect(page).not.toHaveURL(/app=integrations/);
    // The sheet animates off-screen on close; its node may briefly outlive the
    // exit animation, so assert it left the viewport rather than the DOM.
    await expect(page.getByTestId('integration-row-google')).not.toBeInViewport();
    await expect(page.getByTestId('owner-more-workspace')).toBeVisible();
  } finally {
    await page.request.delete('/api/super-admin/impersonate');
  }
});
