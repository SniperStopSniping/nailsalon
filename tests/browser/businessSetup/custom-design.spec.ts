import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { selectBookableSlotFromApi } from '../../e2e/support/booking';
import { darkSource, editorialSource } from './custom-design-fixtures';
import { resetSyntheticSetup } from './fixture';

for (const [name, source] of [['editorial', editorialSource], ['dark', darkSource]] as const) {
  test(`${name} custom source: private preview, manual revision, exact publication and original booking`, async ({ page, browser }, testInfo) => {
    test.setTimeout(240000);

    await resetSyntheticSetup();
    await page.context().addCookies([{ name: 'n5_admin_session', value: 'synthetic-local-setup-session-only', domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    // WebKit routes blob-worker loads through interception; these are local
    // in-memory source, not outbound network requests.
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.protocol === 'blob:' || ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
    });
    const headers = { origin: 'http://localhost:3197' };
    const setup = async (body: unknown) => {
      const response = await page.request.post('/api/admin/business-setup', { headers, data: { salonSlug: 'setup-synthetic-studio', ...body as object } });

      expect(response.status(), await response.text()).toBe(200);

      return (await response.json()).data;
    };
    await setup({ action: 'open' });
    const hours = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { open: '09:00', close: '18:00' }]));
    await setup({ action: 'edit', edit: { expectedRevision: 1, operationId: randomUUID(), operations: [
      { type: 'business', values: { name: name === 'editorial' ? 'Atelier Studio' : 'Nocturne Studio', city: 'Toronto', exactAddress: '123 Synthetic Private Street', homeBased: true, workMode: 'solo' } },
      { type: 'hours', values: hours },
      { type: 'service', values: { id: 'draft_gel', name: 'Synthetic Gel Manicure', description: 'Detailed nail care with gel colour.', priceCents: 6500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure' } },
    ] } });
    const saved = await page.request.post('/api/admin/custom-sites?salonSlug=setup-synthetic-studio', { headers, data: { action: 'save', input: { expectedRevision: 2, operationId: randomUUID(), source, assetIds: [] } } });

    expect(saved.status(), await saved.text()).toBe(200);

    await page.goto('/admin/business-setup?salon=setup-synthetic-studio');
    await page.getByRole('button', { name: 'Website', exact: true }).click();
    const custom = page.frameLocator('iframe[src="http://127.0.0.1:3198/renderer"]');

    await expect(custom.getByText('Synthetic Gel Manicure', { exact: true })).toBeVisible({ timeout: 45000 });
    await expect(custom.getByText('$65.00', { exact: true })).toBeVisible();
    await expect(custom.getByText('123 Synthetic Private Street', { exact: false })).toHaveCount(0);

    await custom.getByRole('button', { name: 'Book this service ↗' }).click();

    await expect(page.getByText('This is your private preview. Customers can book after you approve and publish.')).toBeVisible();

    const anonymous = await browser.newContext({ baseURL: 'http://localhost:3197', viewport: page.viewportSize() });
    await anonymous.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.protocol === 'blob:' || ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
    });
    try {
      expect((await anonymous.request.get('/setup-synthetic-studio/book/service')).status()).toBe(404);
      expect((await anonymous.request.get('/api/admin/custom-sites?salonSlug=setup-synthetic-studio')).status()).not.toBe(200);

      await page.getByText('Edit website source', { exact: true }).click();
      await page.getByLabel('CSS', { exact: true }).fill(`${source.css}\n.hero{border-bottom:4px solid #aa895b}`);
      await page.getByRole('button', { name: 'Save design changes', exact: true }).click();

      await expect(page.getByRole('status').filter({ hasText: 'Validating' })).toHaveCount(0);
      await expect(custom.getByText('Synthetic Gel Manicure', { exact: true })).toBeVisible();

      await page.reload();
      await page.getByRole('button', { name: 'Website', exact: true }).click();

      await expect(custom.getByText('Synthetic Gel Manicure', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Review before publishing', exact: true }).click();

      await expect(page.getByText('Custom website design version (see the exact preview above)')).toBeVisible();

      await page.getByRole('button', { name: 'Approve and publish', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'Your approved changes are published.' })).toBeVisible();

      const booking = await anonymous.newPage();
      await booking.goto('/setup-synthetic-studio/book/service');
      const site = booking.frameLocator('iframe[src="http://127.0.0.1:3198/renderer"]');

      await expect(site.getByText('Synthetic Gel Manicure', { exact: true })).toBeVisible();
      await expect(site.getByText('$65.00', { exact: true })).toBeVisible();

      const renderFrame = booking.frames().find(frame => frame.url().startsWith('http://127.0.0.1:3198/renderer'))!;

      expect(await renderFrame.evaluate(() => {
        try {
          return parent.document.cookie;
        } catch {
          return 'blocked';
        }
      })).toBe('blocked');
      expect(await renderFrame.evaluate(() => {
        try {
          return document.cookie;
        } catch {
          return 'blocked';
        }
      })).toBe('blocked');
      expect(await renderFrame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);

      if (name === 'editorial') {
        await site.getByRole('button', { name: 'A note from the studio +' }).click();

        await expect(site.getByText('A calm space for beautiful detail.')).toBeVisible();
      }
      await booking.screenshot({ path: testInfo.outputPath(`${name}-custom-site.png`), fullPage: true, animations: 'disabled' });
      await site.getByRole('button', { name: 'Book this service ↗' }).click();

      await expect(booking).toHaveURL(/nativeBooking=1.*baseServiceId=/);

      await booking.getByTestId('service-continue-button').click();
      await booking.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);
      if (new URL(booking.url()).pathname.endsWith('/book/tech')) {
        await booking.getByRole('button', { name: /Synthetic Owner/ }).click();
      }

      await expect(booking).toHaveURL(/\/book\/time/);

      const selected = new URL(booking.url());
      const baseServiceId = selected.searchParams.get('baseServiceId');
      await selectBookableSlotFromApi(booking, { technicianId: selected.searchParams.get('techId') === 'any' ? null : selected.searchParams.get('techId'), startDayOffset: 3, baseServiceId, selectedAddOns: selected.searchParams.get('selectedAddOns'), locationId: selected.searchParams.get('locationId') });
      await booking.getByLabel('Customer name', { exact: true }).fill('Synthetic Custom Site Customer');
      await booking.getByLabel('Customer email', { exact: true }).fill(`custom-${randomUUID()}@example.invalid`);
      await booking.getByLabel('Customer phone', { exact: true }).fill('4165550198');
      await booking.getByRole('checkbox', { name: 'Text me appointment confirmations, reminders, and review requests', exact: true }).uncheck();
      await booking.getByRole('checkbox', { name: /I agree to arrive on time and cancel promptly/ }).check();
      const created = booking.waitForResponse(response => response.url().endsWith('/api/appointments') && response.request().method() === 'POST');
      await booking.getByRole('button', { name: /confirm appointment/i }).click();

      expect((await created).status()).toBe(201);
      await expect(booking.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();
      await expect(booking.getByText('Synthetic Gel Manicure', { exact: true }).first()).toBeVisible();

      await booking.screenshot({ path: testInfo.outputPath(`${name}-booking-confirmed.png`), fullPage: true, animations: 'disabled' });
      const database = new Client({ host: '127.0.0.1', port: 55432, user: 'luster_e2e_ci', database: 'luster_ai_setup_development' });
      await database.connect();

      expect((await database.query('SELECT total_price,total_duration_minutes FROM appointment WHERE salon_id=$1', ['setup-synthetic-salon'])).rows).toEqual([{ total_price: 6500, total_duration_minutes: 60 }]);

      await database.end();
    } finally {
      await anonymous.close();
    }
  });
}
