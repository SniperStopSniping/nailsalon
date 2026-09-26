import { expect, test } from '@playwright/test';

import { appPath, authStatePaths } from './support/config';

test.use({
  storageState: authStatePaths.superAdmin,
  viewport: { width: 390, height: 844 },
});

test('super admin reviews a salon no-show and removes only its network risk event @network-no-show-protection', async ({ page }) => {
  let eventState = 'active';
  await page.route('**/api/super-admin/network-no-show/records?*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      page: 1,
      pageSize: 25,
      total: 1,
      platformActive: true,
      items: [{
        appointmentId: 'synthetic-appointment',
        salonId: 'synthetic-salon',
        salonName: 'Synthetic Salon',
        salonSlug: 'synthetic-salon',
        clientName: 'Synthetic Client',
        clientPhone: '••• 1234',
        clientEmail: 's•••@example.test',
        appointmentStatus: 'no_show',
        cancelReason: 'no_show',
        updatedAt: '2026-09-26T10:00:00.000Z',
        startTime: '2026-09-26T09:00:00.000Z',
        endTime: '2026-09-26T10:00:00.000Z',
        eventId: 'synthetic-event',
        eventState,
        eventEligible: eventState === 'active',
        countsForNetwork: eventState === 'active',
        markedAt: '2026-09-26T10:05:00.000Z',
        expiresAt: '2027-09-26T10:00:00.000Z',
        suppressionReason: eventState === 'suppressed' ? 'accuracy_dispute' : null,
      }],
    }),
  }));
  await page.route('**/api/super-admin/network-no-show', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      action: 'suppress_event',
      mode: 'apply',
      salonId: 'synthetic-salon',
      appointmentId: 'synthetic-appointment',
    });

    eventState = 'suppressed';
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ applied: true }) });
  });

  await page.goto(appPath('/super-admin/no-shows'), { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'No-show records across salons' })).toBeVisible();
  await expect(page.getByText('Synthetic Salon')).toBeVisible();
  await expect(page.getByRole('cell', { name: /Counts in network risk/ })).toBeVisible();

  await page.getByRole('button', { name: 'Remove from network risk' }).click();

  await expect(page.getByText(/The source appointment stays marked no-show/)).toBeVisible();

  await page.getByRole('button', { name: 'Confirm removal' }).click();

  await expect(page.getByRole('cell', { name: 'Removed from network risk' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'No-show' })).toBeVisible();
});
