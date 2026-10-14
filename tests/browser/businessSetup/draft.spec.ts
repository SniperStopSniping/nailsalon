import { expect, test } from '@playwright/test';

import { resetSyntheticSetup } from './fixture';

test('real local draft UI uses authenticated production preview without publishing', async ({ page }, testInfo) => {
  await resetSyntheticSetup();
  // This session belongs exclusively to the synthetic, unpublished salon in
  // the separately marked local Development database. No production identity.
  await page.context().addCookies([{ name: 'n5_admin_session', value: 'synthetic-local-setup-session-only', domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto('/admin/business-setup?salon=setup-synthetic-studio');

  await expect(page.getByRole('heading', { name: 'Let’s build your business.' })).toBeVisible();
  await expect(page.getByText('Saved as draft · Your live business is unchanged')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Business setup', exact: true }).click();
  await page.getByLabel('Business name', { exact: true }).fill('Synthetic Gel Studio');
  await page.getByLabel('City or area', { exact: true }).fill('Toronto');
  await page.getByRole('button', { name: 'Save business details' }).click();

  await expect(page.getByText('Saved as draft · Your live business is unchanged')).toBeVisible();

  await page.getByRole('button', { name: 'Website', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Your website draft"]');

  await expect(preview.getByText('Private draft preview. Booking is disabled here. Availability examples are simulated.')).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByRole('heading', { name: 'Synthetic Gel Studio', exact: true })).toBeVisible();

  const previewUrl = await page.locator('iframe').getAttribute('src');
  const response = await page.request.get(previewUrl!);

  expect(response.headers()['content-security-policy']).toContain('sandbox');

  const live = await page.request.get('/setup-synthetic-studio/book/service', { headers: { Cookie: '' } });

  expect(live.status()).toBe(404);

  await page.screenshot({ path: testInfo.outputPath('private-draft.png'), fullPage: true });
  await page.reload();

  await expect(page.getByText('Saved as draft · Your live business is unchanged')).toBeVisible();

  await page.getByRole('button', { name: 'Business setup', exact: true }).click();

  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Synthetic Gel Studio');
});
