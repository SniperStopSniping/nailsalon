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

  const applicationConsoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      applicationConsoleErrors.push(message.text());
    }
  });

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

    await page.getByRole('tab', { name: 'Client Insights' }).click();

    const clientHub = page.getByTestId('client-hub');

    await expect(
      clientHub.getByRole('heading', { name: 'Client health' }),
    ).toBeVisible();
    await expect(
      clientHub.getByRole('heading', { name: 'Needs attention' }),
    ).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))).toEqual({
      innerWidth: 390,
      clientWidth: 390,
      scrollWidth: 390,
    });

    await page.getByTestId('client-insights-kpi-active').click();

    await expect(page.getByTestId('clients-active-segment')).toContainText(
      'Active clients',
    );

    await page.getByRole('button', { name: 'Clear' }).click();

    await expect(page.getByTestId('clients-active-segment')).toHaveCount(0);

    const firstClient = page
      .getByTestId('clients-directory-scroll')
      .locator('button')
      .first();

    await expect(firstClient).toBeVisible();

    await firstClient.click();

    const editClientAction = page.getByTestId('edit-client-action');

    await expect(editClientAction).toBeVisible();

    await editClientAction.click();

    const editDialog = page.getByTestId('edit-client-dialog');
    const editDialogBody = page.getByTestId('edit-client-dialog-body');
    const saveClient = page.getByTestId('edit-client-save');

    await expect(editDialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Edit client' })).toBeVisible();
    await expect(page.getByLabel('First name')).not.toHaveValue('');
    await expect(page.getByLabel('Phone')).not.toHaveValue('');
    await expect(page.getByLabel('Last name')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Birthday')).toBeVisible();

    await page.getByLabel('Notes').scrollIntoViewIfNeeded();

    await expect(page.getByLabel('Notes')).toBeVisible();
    await expect(saveClient).toBeVisible();

    const editGeometry = await editDialog.evaluate((dialog) => {
      const dialogRect = dialog.getBoundingClientRect();
      const documentElement = document.documentElement;
      return {
        dialogBottom: Math.round(dialogRect.bottom),
        dialogLeft: Math.round(dialogRect.left),
        dialogRight: Math.round(dialogRect.right),
        dialogTop: Math.round(dialogRect.top),
        dialogWidth: Math.round(dialogRect.width),
        documentClientWidth: documentElement.clientWidth,
        documentScrollWidth: documentElement.scrollWidth,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });

    expect(editGeometry.dialogTop).toBeGreaterThanOrEqual(0);
    expect(editGeometry.dialogBottom).toBeLessThanOrEqual(
      editGeometry.viewportHeight,
    );
    expect(editGeometry.dialogLeft).toBeGreaterThanOrEqual(0);
    expect(editGeometry.dialogRight).toBeLessThanOrEqual(
      editGeometry.viewportWidth,
    );
    expect(editGeometry.dialogWidth).toBeLessThanOrEqual(
      editGeometry.viewportWidth,
    );
    expect(editGeometry.documentScrollWidth).toBe(
      editGeometry.documentClientWidth,
    );

    const bodyGeometry = await editDialogBody.evaluate(body => ({
      clientWidth: body.clientWidth,
      scrollWidth: body.scrollWidth,
    }));

    expect(bodyGeometry.scrollWidth).toBe(bodyGeometry.clientWidth);
    await expect(saveClient).toBeInViewport();
    await expect(
      page.getByRole('button', { name: 'Close edit client dialog' }),
    ).toBeInViewport();

    await page.getByRole('button', { name: 'Close edit client dialog' }).click();

    await expect(editDialog).toHaveCount(0);

    const appModal = page.getByTestId('app-modal-scroll-region');

    await appModal.getByRole('button', { name: 'Clients' }).click();
    await appModal.getByRole('button', { name: 'Back' }).first().click();

    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const servicesOpener = page.getByTestId('owner-nav-services');
    await servicesOpener.click();

    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible();

    const servicesPanel = page.getByTestId('app-modal-panel');
    const servicesScrollRegion = page.getByTestId('app-modal-scroll-region');
    const servicesFocusables = servicesPanel.locator(
      'a[href]:visible, button:not([disabled]):visible, input:not([disabled]):not([type="hidden"]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible',
    );

    await expect(servicesScrollRegion).toBeFocused();

    await page.keyboard.press('Tab');

    await expect(servicesFocusables.first()).toBeFocused();

    await servicesFocusables.last().focus();
    await page.keyboard.press('Tab');

    await expect(servicesFocusables.first()).toBeFocused();

    await page.keyboard.press('Shift+Tab');

    await expect(servicesFocusables.last()).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(servicesPanel).not.toBeInViewport();
    await expect(servicesOpener).toBeFocused();

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
    expect(applicationConsoleErrors).toEqual([]);
  } finally {
    await page.request.delete('/api/super-admin/impersonate');
  }
});
