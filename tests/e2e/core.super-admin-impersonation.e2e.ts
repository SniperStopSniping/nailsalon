import { expect, test } from '@playwright/test';

import {
  appPath,
  appPathPattern,
  authStatePaths,
  e2eConfig,
} from './support/config';

test.use({ storageState: authStatePaths.superAdmin });

test('super admin can impersonate a salon, save a policy, and end impersonation', async ({ page }) => {
  test.slow();
  await page.goto(appPath('/super-admin'), {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: /super admin/i })).toBeVisible();
  await page.getByPlaceholder('Search salons, slugs, or owner phones...').fill(e2eConfig.salonName);
  await expect(page.getByText(e2eConfig.salonName)).toBeVisible();

  await page.getByRole('button', { name: 'View' }).first().click();
  await expect(page.getByText('Salon Details')).toBeVisible();

  const impersonateStart = await page.evaluate(async ({ salonName, salonSlug }) => {
    const listResponse = await fetch(`/api/super-admin/organizations?page=1&pageSize=20&q=${encodeURIComponent(salonName)}`, {
      cache: 'no-store',
    });
    const listBody = await listResponse.json().catch(() => null);
    if (!listResponse.ok) {
      return {
        ok: false,
        body: listBody,
      };
    }

    const targetSalon = Array.isArray(listBody?.items)
      ? listBody.items.find((item: { slug?: string }) => item.slug === salonSlug) ?? listBody.items[0]
      : null;

    if (!targetSalon?.id) {
      return {
        ok: false,
        body: { error: 'Missing target salon id for impersonation' },
      };
    }

    const response = await fetch('/api/super-admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonId: targetSalon.id }),
    });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      body,
    };
  }, {
    salonName: e2eConfig.salonName,
    salonSlug: e2eConfig.salonSlug,
  });

  expect(impersonateStart.ok, JSON.stringify(impersonateStart.body)).toBeTruthy();

  await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(appPathPattern('/admin'));
  await expect(page.getByTestId('admin-impersonation-banner')).toBeVisible();

  await page.goto(appPath('/admin/policies'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /policy settings/i })).toBeVisible();
  await page.getByRole('button', { name: /save changes/i }).click();
  await expect(page.getByRole('button', { name: /saved!/i })).toBeVisible();

  await page.getByTestId('admin-end-impersonation').click();
  await expect(page).toHaveURL(appPathPattern('/super-admin'));
});
