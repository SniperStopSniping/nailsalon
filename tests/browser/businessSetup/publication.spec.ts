import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { selectBookableSlotFromApi } from '../../e2e/support/booking';
import { resetSyntheticSetup } from './fixture';

// This checkpoint deliberately uses the manual controls. Provider integration
// has separate deterministic tests; this is not evidence of a real AI trial.
test('local setup publishes approved records and completes the original booking flow', async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);

  await resetSyntheticSetup();

  const database = new Client({ host: '127.0.0.1', port: 55432, user: 'luster_e2e_ci', database: 'luster_ai_setup_development' });
  await database.connect();
  try {
    const target = await database.query('SELECT current_database() AS name, inet_server_addr()::text AS host');

    expect(target.rows[0]).toEqual({ name: 'luster_ai_setup_development', host: '127.0.0.1/32' });

    await page.context().addCookies([{ name: 'n5_admin_session', value: 'synthetic-local-setup-session-only', domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto('/admin/business-setup?salon=setup-synthetic-studio');

    await expect(page.getByText('Saved as draft · Your live business is unchanged')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Business setup', exact: true }).click();
    await page.getByLabel('Business name', { exact: true }).fill('Synthetic Gel Studio');
    await page.getByLabel('City or area', { exact: true }).fill('Toronto');
    await page.getByLabel('Private service address').fill('123 Synthetic Private Street');
    await page.getByLabel('I work from home').check();
    await page.getByLabel('Do you work alone or with a team?').selectOption('solo');
    await page.getByLabel('What customers see').selectOption('city_only');
    await page.getByRole('button', { name: 'Save business details' }).click();

    await expect(page.getByText('Saved as draft · Your live business is unchanged')).toBeVisible();

    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) {
      await page.getByRole('checkbox', { name: day, exact: true }).check();
    }
    await page.getByRole('button', { name: 'Save opening hours' }).click();

    await expect(page.getByText('Saved as draft · Your live business is unchanged')).toBeVisible();

    if (await page.getByRole('button', { name: 'Save service', exact: true }).count() === 0) {
      await page.getByRole('button', { name: 'Add a service', exact: true }).click();
    }
    await page.getByLabel('Service', { exact: true }).fill('Synthetic Gel Manicure');
    await page.getByLabel('Price', { exact: true }).fill('65');
    await page.getByLabel('Minutes', { exact: true }).fill('60');
    await page.getByRole('button', { name: 'Save service', exact: true }).click();

    await expect(page.getByText('Saved as draft · Your live business is unchanged')).toBeVisible();

    await page.getByRole('button', { name: 'Clean and minimal', exact: true }).click();

    await expect(page.getByText('Saved as draft · Your live business is unchanged')).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('editable-setup.png'), fullPage: true });
    await page.getByRole('button', { name: 'Website', exact: true }).click();
    const preview = page.frameLocator('iframe');

    await expect(preview.getByText('Synthetic Gel Manicure', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(preview.getByText('Proposed booking setup')).toBeVisible();
    await expect(preview.getByText('123 Synthetic Private Street', { exact: false })).toHaveCount(0);

    await page.screenshot({ path: testInfo.outputPath('working-draft.png'), fullPage: true });
    const before = await database.query('SELECT publication_status, business_hours FROM salon WHERE id = $1', ['setup-synthetic-salon']);

    expect(before.rows[0]).toMatchObject({ publication_status: 'draft', business_hours: null });
    expect((await database.query('SELECT id FROM service WHERE salon_id = $1', ['setup-synthetic-salon'])).rows).toHaveLength(0);

    await page.getByRole('button', { name: 'Review before publishing' }).click();

    await expect(page.getByRole('heading', { name: 'Review your changes', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and publish', exact: true })).toBeEnabled();

    await page.screenshot({ path: testInfo.outputPath('exact-review.png'), fullPage: true });
    let lostPublication: Record<string, unknown> | null = null;
    await page.route('**/api/admin/business-setup', async (route) => {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() as Record<string, unknown> : null;
      if (!lostPublication && body?.action === 'publish') {
        const committed = await route.fetch();

        expect(committed.status()).toBe(200);

        lostPublication = body;
        await route.abort('connectionreset');
      } else {
        await route.continue();
      }
    });
    await page.getByRole('button', { name: 'Approve and publish', exact: true }).click();
    await page.getByRole('button', { name: 'Reload saved changes', exact: true }).click();
    const replay = await page.request.post('/api/admin/business-setup', { headers: { origin: 'http://localhost:3197' }, data: lostPublication });

    expect(replay.status()).toBe(200);

    await expect(page.getByRole('heading', { name: 'Your approved changes are published.' })).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: testInfo.outputPath('published.png'), fullPage: true });
    const service = (await database.query('SELECT id, price, duration_minutes FROM service WHERE salon_id = $1', ['setup-synthetic-salon'])).rows;

    expect(service).toHaveLength(1);
    expect(service[0]).toMatchObject({ price: 6500, duration_minutes: 60 });

    const rejectedPreviewBooking = await page.request.post('/api/appointments', { data: { salonSlug: 'setup-synthetic-studio', baseServiceId: `setup_preview_${service[0].id}`, startTime: '2099-10-19T13:00:00.000Z', clientName: 'Synthetic Preview', clientEmail: 'preview@example.invalid', clientPhone: '4165550198' } });

    expect(rejectedPreviewBooking.status()).toBeGreaterThanOrEqual(400);
    expect((await database.query('SELECT id FROM appointment WHERE salon_id = $1', ['setup-synthetic-salon'])).rows).toHaveLength(0);

    const customer = await browser.newContext({ baseURL: 'http://localhost:3197' });
    try {
      await customer.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      const booking = await customer.newPage();
      const publicPage = await booking.goto('/setup-synthetic-studio/book/service');

      expect(await publicPage!.text()).not.toContain('123 Synthetic Private Street');

      await expect(booking.getByText('123 Synthetic Private Street', { exact: false })).toHaveCount(0);

      await booking.getByTestId(`service-card-${service[0].id}`).click();
      await booking.getByTestId('service-continue-button').click();
      await booking.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);
      if (new URL(booking.url()).pathname.endsWith('/book/tech')) {
        await booking.getByRole('button', { name: /Synthetic Owner/ }).click();
      }

      await expect(booking).toHaveURL(/\/book\/time/);
      await expect(booking.getByTestId('booking-summary-price')).toContainText('$65');

      const selected = new URL(booking.url());
      await selectBookableSlotFromApi(booking, { technicianId: selected.searchParams.get('techId') === 'any' ? null : selected.searchParams.get('techId'), startDayOffset: 3, baseServiceId: service[0].id, selectedAddOns: selected.searchParams.get('selectedAddOns'), locationId: selected.searchParams.get('locationId') });

      await expect(booking.getByRole('heading', { name: 'Review & confirm', exact: true })).toBeVisible();

      await booking.getByLabel('Customer name', { exact: true }).fill('Synthetic Setup Customer');
      await booking.getByLabel('Customer email', { exact: true }).fill(`setup-${randomUUID()}@example.invalid`);
      await booking.getByLabel('Customer phone', { exact: true }).fill('4165550198');
      await booking.getByRole('checkbox', { name: 'Text me appointment confirmations, reminders, and review requests', exact: true }).uncheck();
      await booking.getByRole('checkbox', { name: /I agree to arrive on time and cancel promptly/ }).check();
      await booking.screenshot({ path: testInfo.outputPath('original-booking-review.png'), fullPage: true });
      const responsePromise = booking.waitForResponse(response => response.url().endsWith('/api/appointments') && response.request().method() === 'POST');
      await booking.getByRole('button', { name: /confirm appointment/i }).click();
      const response = await responsePromise;
      const body = await response.json();

      expect(response.status(), JSON.stringify(body)).toBe(201);
      await expect(booking.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();

      await expect(booking.getByText('Synthetic Gel Manicure', { exact: true }).first()).toBeVisible();
      await expect.poll(() => booking.getByRole('heading', { name: /appointment confirmed/i }).evaluate((element) => {
        for (let current: Element | null = element; current; current = current.parentElement) {
          if (Number(getComputedStyle(current).opacity) < 1) {
            return false;
          }
        }
        return true;
      })).toBe(true);

      await booking.screenshot({ path: testInfo.outputPath('original-booking-confirmed.png'), fullPage: true, animations: 'disabled' });
      const appointments = await database.query('SELECT total_price, total_duration_minutes FROM appointment WHERE salon_id = $1', ['setup-synthetic-salon']);

      expect(appointments.rows).toEqual([{ total_price: 6500, total_duration_minutes: 60 }]);
    } finally {
      await customer.close();
    }
    await page.getByRole('button', { name: 'Make more changes' }).click();

    await expect(page.getByText('Saved as draft · Your live business is unchanged')).toBeVisible();

    await page.getByRole('button', { name: 'Business setup', exact: true }).click();

    await expect(page.getByLabel('I work from home')).toBeChecked();

    await page.getByLabel('Price', { exact: true }).fill('70');
    await page.getByRole('button', { name: 'Save service', exact: true }).click();

    await expect(page.getByText('Saved as draft · Your live business is unchanged')).toBeVisible();
    expect((await database.query('SELECT price FROM service WHERE id = $1', [service[0].id])).rows[0].price).toBe(6500);

    await page.getByRole('button', { name: 'Review before publishing' }).click();
    await page.getByRole('button', { name: 'Approve and publish', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Your approved changes are published.' })).toBeVisible();
    expect((await database.query('SELECT price FROM service WHERE salon_id = $1', ['setup-synthetic-salon'])).rows).toEqual([{ price: 7000 }]);
    expect((await database.query('SELECT total_price, total_duration_minutes FROM appointment WHERE salon_id = $1', ['setup-synthetic-salon'])).rows).toEqual([{ total_price: 6500, total_duration_minutes: 60 }]);
  } finally {
    await database.end();
  }
});
