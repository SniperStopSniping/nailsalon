import { expect, test } from '@playwright/test';

import fr from '@/locales/fr.json';

test('owner reviews an early mark and corrects it without overflow at 200% text', async ({ page }) => {
  let corrected = false;
  let corrections = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:3139') {
      errors.push(`Unexpected external request: ${url.origin}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }

    expect(url.searchParams.get('salonSlug')).toBe('synthetic-salon');

    if (url.pathname.endsWith('/records')) {
      await route.fulfill({ json: { page: 1, pageSize: 25, total: 1, platformActive: true, timeZone: 'America/Toronto', items: [{
        appointmentId: 'synthetic-no-show',
        clientName: 'Synthetic client with a long name for mobile layout',
        clientPhone: '••• 0199',
        clientEmail: 's•••@example.test',
        appointmentStatus: corrected ? 'cancelled' : 'no_show',
        cancelReason: corrected ? 'admin_correction' : 'no_show',
        updatedAt: '2026-09-29T12:00:00.000Z',
        startTime: '2026-09-29T14:00:00.000Z',
        endTime: '2026-09-29T14:35:00.000Z',
        eventId: null,
        eventState: null,
        eventEligible: false,
        countsForNetwork: false,
        expiresAt: null,
      }] } });
      return;
    }
    if (url.pathname.endsWith('/correct')) {
      corrections += 1;

      expect(route.request().postDataJSON()).toEqual({ appointmentId: 'synthetic-no-show', expectedUpdatedAt: '2026-09-29T12:00:00.000Z', reason: 'This appointment was marked by mistake.' });

      corrected = true;
      await route.fulfill({ json: { corrected: true } });
      return;
    }
    errors.push(`Unexpected API: ${url.pathname}`);
    await route.abort();
  });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });

  await expect(page.getByText('Synthetic client with a long name for mobile layout')).toBeVisible();
  await expect(page.getByText(/10:00:00 AM/)).toBeVisible();

  await page.getByRole('button', { name: 'Correct mistaken no-show' }).click();

  await expect(page.getByLabel('Why was this marked incorrectly?')).toBeFocused();

  const confirm = page.getByRole('button', { name: 'Confirm correction' });

  await expect(confirm).toBeDisabled();

  await page.getByLabel('Why was this marked incorrectly?').fill('This appointment was marked by mistake.');
  await confirm.click();

  await expect(page.getByText('Corrected to cancelled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Correct mistaken no-show' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(corrections).toBe(1);
  expect(errors).toEqual([]);
});

test('French owners see translated no-show instructions and controls', async ({ page }) => {
  await page.route('**/api/admin/network-no-show/records?*', route => route.fulfill({ json: { page: 1, pageSize: 25, total: 0, platformActive: false, items: [] } }));
  await page.goto('/?locale=fr');

  await expect(page.getByText(fr.NoShowRecords.title, { exact: true })).toBeVisible();
  await expect(page.getByText(fr.NoShowRecords.explainer, { exact: true })).toBeVisible();
  await expect(page.getByText(fr.NoShowRecords.paused, { exact: true })).toBeVisible();
  await expect(page.getByText(fr.NoShowRecords.empty, { exact: true })).toBeVisible();
});
