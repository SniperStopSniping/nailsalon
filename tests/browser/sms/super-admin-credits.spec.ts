import { expect, test } from '@playwright/test';

test('mobile super-admin adds confirmed texts once and keeps the fixture within the viewport', async ({ page }) => {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];

  await page.route('**/api/super-admin/salons/super-admin-fixture/sms-credits', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { balance: 100, administrativeBalance: 20 } });
      return;
    }
    requests.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postDataJSON(),
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({
      json: {
        lotId: 'fixture-administrative-lot',
        created: true,
        balance: 125,
        administrativeBalance: 45,
      },
    });
  });

  await page.goto('/?fixture=super-admin-credits');
  const control = page.getByTestId('add-sms-credits-control');

  await expect(control).toBeVisible();
  await expect(control.getByText('100', { exact: true })).toBeVisible();
  await expect(control.getByText('20', { exact: true })).toBeVisible();

  await control.getByLabel('Texts to add').fill('25');
  await control.getByLabel('Reason').fill('Service recovery');

  await expect(control.getByLabel('Texts to add')).toHaveValue('25');

  const confirmation = control.getByLabel('I confirm adding 25 texts to Fixture Nail Studio.');

  await expect(confirmation).toBeVisible();

  await confirmation.check();
  const add = control.getByRole('button', { name: 'Add texts' });
  await add.tap();

  await expect(add).toBeDisabled();
  await expect.poll(() => requests).toHaveLength(1);

  await add.evaluate((element) => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  await expect.poll(() => requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    method: 'POST',
    path: '/api/super-admin/salons/super-admin-fixture/sms-credits',
    body: { amount: 25, reason: 'Service recovery' },
  });

  await expect(control.getByRole('status')).toHaveText('25 texts added to Fixture Nail Studio.');
  await expect(control.getByText('125', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
