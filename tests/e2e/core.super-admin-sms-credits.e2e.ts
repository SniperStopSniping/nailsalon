import { expect, test } from '@playwright/test';

import { appPath, authStatePaths, e2eConfig } from './support/config';

test.use({
  storageState: authStatePaths.superAdmin,
  viewport: { width: 390, height: 844 },
});

test('super admin adds confirmed SMS credits on mobile without a duplicate pending request', async ({ page }) => {
  let postRequests = 0;
  let finishPost: (() => void) | undefined;
  const postFinished = new Promise<void>((resolve) => {
    finishPost = resolve;
  });

  await page.route('**/api/super-admin/salons/*/sms-credits', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ balance: 100, administrativeBalance: 20 }),
      });
      return;
    }

    postRequests += 1;

    expect(route.request().postDataJSON()).toMatchObject({
      amount: 25,
      reason: 'Service recovery',
    });

    await postFinished;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        lotId: 'mock-administrative-credit',
        created: true,
        balance: 125,
        administrativeBalance: 45,
      }),
    });
  });

  await page.goto(appPath('/super-admin'), { waitUntil: 'domcontentloaded' });
  const organizationsResponse = page.waitForResponse((response) => {
    if (!response.url().includes('/api/super-admin/organizations')) {
      return false;
    }
    return new URL(response.url()).searchParams.get('q') === e2eConfig.salonSlug;
  });
  const search = page.getByPlaceholder('Search salons, slugs, or owner phones...');
  const targetRow = page.getByRole('row').filter({ hasText: e2eConfig.salonSlug });

  await search.fill(e2eConfig.salonSlug);
  const filteredOrganizations = await organizationsResponse;
  const filteredBody = await filteredOrganizations.json();

  expect(filteredBody.items.map((item: { slug: string }) => item.slug)).toEqual([e2eConfig.salonSlug]);
  await expect(targetRow).toBeVisible();

  await targetRow.getByRole('button', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Billing & Programs' }).click();

  const control = page.getByTestId('add-sms-credits-control');

  await expect(control).toBeVisible();

  await control.scrollIntoViewIfNeeded();

  await expect(control).toBeInViewport();
  await expect(control.getByText('100', { exact: true })).toBeVisible();
  await expect(control.getByText('20', { exact: true })).toBeVisible();

  await control.getByLabel('Texts to add').fill('25');
  await control.getByLabel('Reason').fill('Service recovery');
  const confirmation = control.getByLabel(`I confirm adding 25 texts to ${e2eConfig.salonName}.`);
  await confirmation.check();

  const submit = control.getByRole('button', { name: /^(Add texts|Adding texts…)$/ });
  await submit.focus();
  await page.keyboard.press('Enter');

  await expect(submit).toHaveAccessibleName('Adding texts…');
  await expect(submit).toBeDisabled();
  await expect.poll(() => postRequests).toBe(1);

  // A programmatic second activation is stronger than a normal second tap:
  // React still sees the click, but the pending state rejects it before fetch.
  await submit.dispatchEvent('click');

  await expect.poll(() => postRequests).toBe(1);

  finishPost?.();

  await expect(control.getByText(`25 texts added to ${e2eConfig.salonName}.`)).toBeVisible();
  await expect(control.getByText('125', { exact: true })).toBeVisible();
  await expect.poll(() => page.locator('html').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
});
