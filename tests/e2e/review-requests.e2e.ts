import { expect, test } from '@playwright/test';

import { impersonateSalonAsSuperAdmin } from './support/appointment-ops';
import { appPath, authStatePaths, e2eConfig } from './support/config';

// Normal isolated owner authentication; review writes cannot enqueue real SMS.
test.use({ storageState: authStatePaths.superAdmin });

test('review settings require explicit automation opt-in @mobile-safari', async ({ page }) => {
  let settings = {
    googleReviewUrl: null as string | null,
    automaticEnabled: false,
    delayMinutes: 60,
    messageTemplate: 'Hi {{firstName}}! Thanks for visiting {{businessName}}. Review us: {{reviewLink}}',
    businessName: 'Daniela Nails',
  };
  await page.route('**/api/admin/review-requests/settings?**', async (route) => {
    if (route.request().method() === 'PATCH') {
      settings = { ...settings, ...route.request().postDataJSON() };
    }
    await route.fulfill({ json: { data: settings } });
  });
  await impersonateSalonAsSuperAdmin(page);
  await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=settings&view=review-requests`);
  const panel = page.getByTestId('review-request-settings');

  await expect(panel).toBeVisible();

  await panel.getByLabel('Google review link', { exact: true }).fill('https://g.page/daniela/review');

  await expect(panel.getByRole('checkbox', { name: 'Automatically request reviews' })).not.toBeChecked();

  await panel.getByRole('button', { name: 'Save review settings' }).click();

  await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(settings.automaticEnabled).toBe(false);

  await panel.getByRole('checkbox', { name: 'Automatically request reviews' }).check();
  await panel.getByLabel('Send after', { exact: true }).selectOption('60');

  await expect(panel.getByText('Reply STOP to opt out.', { exact: false })).toBeVisible();

  await panel.getByRole('button', { name: 'Save review settings' }).click();

  await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(settings.automaticEnabled).toBe(true);
});
