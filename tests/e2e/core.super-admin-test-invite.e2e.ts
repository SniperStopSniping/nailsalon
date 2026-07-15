import { expect, test } from '@playwright/test';

import { appPath, authStatePaths } from './support/config';

test.use({ storageState: authStatePaths.superAdmin });

test('super admin can create, copy, and open a Luster test invitation', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(appPath('/super-admin'), { waitUntil: 'domcontentloaded' });

  const email = `luster+clerk_test_${Date.now()}@example.com`;
  await page.getByLabel('Nail tech email').fill(email);
  await page.getByLabel('Campaign source').fill('playwright-local');
  await page.getByRole('button', { name: /create invitation/i }).click();

  await expect(page.getByRole('status')).toContainText('Test invitation created.');

  const joinUrl = (await page.getByTestId('test-invite-url').textContent())?.trim();

  expect(joinUrl).toBeTruthy();

  await page.getByRole('button', { name: /copy invitation link/i }).click();

  await expect(page.getByRole('status')).toContainText('Invitation link copied.');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(joinUrl);

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /open invitation link/i }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  const openedUrl = new URL(popup.url());
  const expectedUrl = new URL(joinUrl!);

  expect(openedUrl.origin).toBe(expectedUrl.origin);
  expect(openedUrl.pathname).toMatch(/\/(?:en\/)?join\//);
  await expect(popup.getByRole('heading', { name: /create your owner account/i })).toBeVisible();

  await popup.close();
});
