import { expect, test } from '@playwright/test';

import { appPath, authStatePaths, e2eBaseUrl, e2eConfig } from './support/config';

const e2eOrigin = new URL(e2eBaseUrl).origin;

test.use({
  storageState: authStatePaths.superAdmin,
  viewport: { width: 390, height: 844 },
});

test('owner mobile navigation opens visible top-aligned workspaces and day details', async ({
  page,
}) => {
  test.slow();

  const applicationConsoleErrors: Array<{ text: string; locationUrl: string }> = [];
  const unexpectedHttpErrors: string[] = [];
  let ownerAssistantDarkContext404Responses = 0;
  const isOwnerAssistantContextUrl = (value: string) => {
    try {
      const url = new URL(value);
      return url.origin === e2eOrigin
        && url.pathname === '/api/admin/owner-assistant/context'
        && url.searchParams.get('salonSlug') === e2eConfig.salonSlug;
    } catch {
      return false;
    }
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      applicationConsoleErrors.push({
        text: message.text(),
        locationUrl: message.location().url,
      });
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }

    if (
      response.status() === 404
      && response.request().method() === 'GET'
      && isOwnerAssistantContextUrl(response.url())
    ) {
      ownerAssistantDarkContext404Responses += 1;
      return;
    }

    const url = new URL(response.url());
    unexpectedHttpErrors.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
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
      headers: { Origin: e2eOrigin },
      data: { salonId: salon.id },
    },
  );

  expect(impersonation.ok(), await impersonation.text()).toBe(true);

  let createdClientId: string | undefined;

  try {
    await page.goto(
      `${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`,
      { waitUntil: 'domcontentloaded' },
    );

    await expect(page.getByTestId('owner-today-workspace')).toBeVisible();
    await expect(page.getByTestId('owner-nav-calendar')).toBeVisible();

    await page.getByTestId('owner-nav-calendar').click();

    const calendarDialog = page.getByRole('dialog', { name: 'Calendar' });

    await expect(calendarDialog).toBeVisible();
    await expect(calendarDialog.getByRole('button', { name: 'Monthly' })).toBeVisible();

    const calendarDay = calendarDialog.locator('button[aria-label*="Luster"]').first();

    await expect(calendarDay).toBeVisible();

    await calendarDay.click();
    const closeDay = page.getByRole('button', { name: 'Close day details' });

    await expect(closeDay).toBeVisible();

    // The calendar can appear before its addressable route settles. Keep the
    // normal fast selection path, then verify the original selected-day panel
    // survives the canonical URL commit instead of accepting a transient sheet.
    const originalDayPanel = await closeDay.locator(
      'xpath=ancestor::*[@role="dialog"][1]',
    ).elementHandle();

    expect(originalDayPanel, 'The selected-day panel must be mounted before the route settles.').not.toBeNull();

    await page.waitForURL(
      url => url.pathname === new URL(appPath('/admin'), e2eBaseUrl).pathname
        && url.searchParams.get('app') === 'schedule',
      { waitUntil: 'domcontentloaded' },
    );

    expect(await originalDayPanel!.evaluate(panel => panel.isConnected)).toBe(true);

    await expect(closeDay).toBeVisible();

    const dayPanel = closeDay.locator('xpath=ancestor::*[@role="dialog"][1]');

    await expect.poll(async () => dayPanel.evaluate((panel) => {
      const style = getComputedStyle(panel);
      const matrix = new DOMMatrixReadOnly(style.transform);
      return style.opacity === '1' && Math.abs(matrix.m42) < 0.5;
    }), { timeout: 10_000 }).toBe(true);

    await expect.poll(async () => {
      return dayPanel.evaluate(async (panel) => {
        const before = panel.getBoundingClientRect();
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const after = panel.getBoundingClientRect();

        return Math.abs(before.x - after.x) < 0.5
          && Math.abs(before.y - after.y) < 0.5
          && Math.abs(before.width - after.width) < 0.5
          && Math.abs(before.height - after.height) < 0.5;
      });
    }, { timeout: 10_000 }).toBe(true);

    const box = await dayPanel.boundingBox();

    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(846);

    await closeDay.click();
    await calendarDialog.getByRole('button', { name: 'Back' }).click();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByTestId('owner-nav-clients').click();

    await expect(
      page.getByText('Clients', { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Insights & Follow-ups' }).click();

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

    await page.getByTestId('clients-active-segment').getByRole('button', { name: 'Clear', exact: true }).click();

    await expect(page.getByTestId('clients-active-segment')).toHaveCount(0);

    // Earlier customer-booking cases may have populated the shared disposable
    // salon. Use the real header action so this edit flow works with either an
    // empty or populated directory without resetting shared fixtures.
    const clientsModeTabs = page.getByRole('tablist', {
      name: 'Clients or Insights and Follow-ups',
    });
    await clientsModeTabs.getByTestId('clients-mode-clients').click();

    await expect(page.getByTestId('clients-add-action')).toBeVisible();

    await page.getByTestId('clients-add-action').click();

    const uniqueSuffix = `${Date.now()}`.slice(-4);
    const firstName = `E2E${uniqueSuffix}`;
    await page.getByLabel('First name').fill(firstName);
    await page.getByLabel('Last name').fill('Mobile');
    await page.getByLabel('Phone').fill(`416555${uniqueSuffix}`);

    const createResponsePromise = page.waitForResponse(response => (
      response.url().includes('/api/admin/clients')
      && response.request().method() === 'POST'
      && response.status() === 201
    ));
    await page.getByTestId('add-client-save').click();
    const createResponse = await createResponsePromise;
    const createPayload = await createResponse.json();
    createdClientId = createPayload.data?.client?.id;

    expect(createdClientId, 'The owner UI must commit a client before the edit flow.').toBeTruthy();

    const createdClientProfile = page.getByTestId('client-detail-scroll');

    await expect(
      createdClientProfile.getByRole('heading', { name: `${firstName} Mobile` }),
    ).toBeVisible();

    const editClientAction = page.getByTestId('edit-client-action');

    await expect(editClientAction).toBeVisible();

    await editClientAction.click();

    const editDialog = page.getByTestId('edit-client-dialog');
    const editDialogBody = page.getByTestId('edit-client-dialog-body');
    const saveClient = page.getByTestId('edit-client-save');

    await expect(editDialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Edit client' })).toBeVisible();
    await expect(page.getByLabel('First name')).toHaveValue(firstName);
    await expect(page.getByLabel('Phone')).toHaveValue(`416555${uniqueSuffix}`);
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
    expect(editGeometry.dialogBottom).toBeLessThanOrEqual(editGeometry.viewportHeight);
    expect(editGeometry.dialogLeft).toBeGreaterThanOrEqual(0);
    expect(editGeometry.dialogRight).toBeLessThanOrEqual(editGeometry.viewportWidth);
    expect(editGeometry.dialogWidth).toBeLessThanOrEqual(editGeometry.viewportWidth);
    expect(editGeometry.documentScrollWidth).toBe(editGeometry.documentClientWidth);

    const bodyGeometry = await editDialogBody.evaluate(body => ({
      clientWidth: body.clientWidth,
      scrollWidth: body.scrollWidth,
    }));

    expect(bodyGeometry.scrollWidth).toBe(bodyGeometry.clientWidth);
    await expect(saveClient).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Close edit client dialog' })).toBeInViewport();

    await page.getByRole('button', { name: 'Close edit client dialog' }).click();

    await expect(editDialog).toHaveCount(0);

    await editClientAction.click();

    await expect(editDialog).toBeVisible();

    await expect(page.getByLabel('First name')).toHaveValue(firstName);

    const updatedNotes = `Mobile edit ${uniqueSuffix}`;
    await page.getByLabel('Notes').fill(updatedNotes);
    const updateResponsePromise = page.waitForResponse(response => (
      response.url().includes(`/api/admin/clients/${createdClientId}`)
      && response.request().method() === 'PATCH'
    ));
    await saveClient.click();
    const updateResponse = await updateResponsePromise;

    expect(updateResponse.ok(), await updateResponse.text()).toBe(true);

    const profileResponse = await page.request.get(
      `/api/admin/clients/${encodeURIComponent(createdClientId)}?salonSlug=${encodeURIComponent(e2eConfig.salonSlug)}`,
      { headers: { Origin: e2eOrigin } },
    );

    expect(profileResponse.ok(), await profileResponse.text()).toBe(true);

    const profilePayload = await profileResponse.json();

    expect(profilePayload.data?.client?.notes).toBe(updatedNotes);

    const updatedAt = profilePayload.data?.client?.updatedAt;

    expect(updatedAt, 'The committed client must expose its current version for cleanup.').toBeTruthy();

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

    const serviceCreateAction = page.getByRole('button', { name: 'New service' });

    await expect(serviceCreateAction).toBeVisible();

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

    const expectedDarkContextConsoleErrors = applicationConsoleErrors.filter(error => (
      error.text === 'Failed to load resource: the server responded with a status of 404 (Not Found)'
      && isOwnerAssistantContextUrl(error.locationUrl)
    ));
    const unexpectedConsoleErrors = applicationConsoleErrors.filter(error => (
      !expectedDarkContextConsoleErrors.includes(error)
    ));

    expect(ownerAssistantDarkContext404Responses).toBe(1);

    expect(expectedDarkContextConsoleErrors.length).toBeLessThanOrEqual(
      ownerAssistantDarkContext404Responses,
    );
    expect(unexpectedHttpErrors).toEqual([]);
    expect(unexpectedConsoleErrors).toEqual([]);
    await expect(page.getByTestId('owner-assistant-launcher')).toHaveCount(0);
  } finally {
    if (createdClientId) {
      const profileResponse = await page.request.get(
        `/api/admin/clients/${encodeURIComponent(createdClientId)}?salonSlug=${encodeURIComponent(e2eConfig.salonSlug)}`,
        { headers: { Origin: e2eOrigin } },
      );
      if (profileResponse.ok()) {
        const profilePayload = await profileResponse.json();
        const expectedUpdatedAt = profilePayload.data?.client?.updatedAt;
        if (expectedUpdatedAt) {
          await page.request.post(
            `/api/admin/clients/${encodeURIComponent(createdClientId)}/archive`,
            {
              headers: { Origin: e2eOrigin },
              data: { salonSlug: e2eConfig.salonSlug, expectedUpdatedAt },
            },
          );
        }
      }
    }

    await page.request.delete('/api/super-admin/impersonate', {
      headers: { Origin: e2eOrigin },
    });
  }
});
