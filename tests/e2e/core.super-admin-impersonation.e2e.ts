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

  await expect(page.getByRole('heading', { name: 'Platform Control Center', exact: true })).toBeVisible();

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

  let impersonationStarted = false;
  let originalPhotoMode: string | null = null;

  try {
    expect(impersonateStart.ok, JSON.stringify(impersonateStart.body)).toBeTruthy();

    impersonationStarted = true;

    await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page).toHaveURL(appPathPattern('/admin'));
    await expect(page.getByTestId('admin-impersonation-banner')).toBeVisible();

    await page.goto(appPath('/admin/policies'), { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByRole('heading', { level: 1, name: 'Appointment Photo Rules' }),
    ).toBeVisible();

    const beforePhoto = page.getByLabel('Before Photo to Start');

    originalPhotoMode = await beforePhoto.inputValue();

    const savedPhotoMode = originalPhotoMode === 'required' ? 'off' : 'required';

    await beforePhoto.selectOption(savedPhotoMode);
    await page.getByRole('button', { name: 'Save photo rules' }).click();

    await expect(page.getByRole('button', { name: /saved!/i })).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByLabel('Before Photo to Start')).toHaveValue(savedPhotoMode);
  } finally {
    if (impersonationStarted) {
      try {
        if (originalPhotoMode !== null) {
          await page.goto(appPath('/admin/policies'), { waitUntil: 'domcontentloaded' });

          const beforePhoto = page.getByLabel('Before Photo to Start');

          await expect(beforePhoto).toBeVisible();

          await beforePhoto.selectOption(originalPhotoMode);
          await page.getByRole('button', { name: 'Save photo rules' }).click();

          await expect(page.getByRole('button', { name: /saved!/i })).toBeVisible();

          await page.reload({ waitUntil: 'domcontentloaded' });

          await expect(page.getByLabel('Before Photo to Start')).toHaveValue(originalPhotoMode);
        }
      } finally {
        await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`, {
          waitUntil: 'domcontentloaded',
        });

        const endImpersonation = page.getByTestId('admin-end-impersonation');

        await expect(endImpersonation).toBeVisible();

        const endResponse = page.waitForResponse(response => (
          response.url().includes('/api/super-admin/impersonate')
          && response.request().method() === 'DELETE'
        ));

        await endImpersonation.click();
        const ended = await endResponse;

        expect(ended.ok(), await ended.text()).toBe(true);
        await expect(page).toHaveURL(appPathPattern('/super-admin'));

        const statusResponse = await page.request.get('/api/super-admin/impersonate');
        const status = await statusResponse.json();

        expect(statusResponse.ok()).toBe(true);
        expect(status).toMatchObject({ isImpersonating: false, session: null });

        await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`, {
          waitUntil: 'domcontentloaded',
        });

        await expect(page.getByTestId('admin-impersonation-banner')).toHaveCount(0);
      }
    }
  }
});
