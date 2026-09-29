import { expect, test } from '@playwright/test';

import { impersonateSalonAsSuperAdmin } from './support/appointment-ops';
import { appPath, authStatePaths, e2eConfig } from './support/config';

test.use({ storageState: authStatePaths.superAdmin, viewport: { width: 390, height: 844 } });

test('owner corrects a mistaken no-show from More without exposing another salon @network-no-show-protection', async ({ page }) => {
  let status = 'no_show';
  await page.route('**/api/admin/network-no-show/records?*', async route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ page: 1, pageSize: 25, total: 1, platformActive: true, items: [{ appointmentId: 'appt-owner-no-show', clientName: 'Owner Client', clientPhone: '••• 1234', clientEmail: 'o•••@example.test', appointmentStatus: status, cancelReason: status === 'no_show' ? 'no_show' : 'admin_correction', updatedAt: '2026-09-29T12:00:00.000Z', startTime: '2026-09-29T10:00:00.000Z', endTime: '2026-09-29T11:00:00.000Z', eventId: null, eventState: null, eventEligible: false, countsForNetwork: false, expiresAt: null }] }) }));
  await page.route('**/api/admin/network-no-show/correct?*', async (route) => {
    expect(route.request().url()).toContain('salonSlug=');
    expect(route.request().postDataJSON()).toMatchObject({ appointmentId: 'appt-owner-no-show', reason: expect.stringContaining('marked') });

    status = 'cancelled';
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ corrected: true }) });
  });
  await impersonateSalonAsSuperAdmin(page);
  try {
    await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'More' }).click();
    await page.getByTestId('admin-app-tile-no-show-records').click();

    await expect(page.getByText('Owner Client')).toBeVisible();

    await page.getByRole('button', { name: 'Correct mistaken no-show' }).click();
    await page.getByLabel('Why was this marked incorrectly?').fill('Client attended and this was marked by mistake.');
    await page.getByRole('button', { name: 'Confirm correction' }).click();

    await expect(page.getByText('Corrected to cancelled')).toBeVisible();
  } finally {
    await page.request.delete('/api/super-admin/impersonate');
  }
});
