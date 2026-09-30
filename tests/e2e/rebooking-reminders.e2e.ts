import { expect, test } from '@playwright/test';

import { impersonateSalonAsSuperAdmin } from './support/appointment-ops';
import { appPath, authStatePaths, e2eConfig } from './support/config';

test.use({ storageState: authStatePaths.superAdmin });

test('mobile owner can manage a separate automatic rebooking reminder @mobile-safari', async ({ page }) => {
  let settings = {
    enabled: false,
    defaultIntervalWeeks: 3,
    messageTemplate: 'Hi {{first_name}}! It’s almost time for your next appointment 💕 Our popular times can fill up quickly, so book ahead to get the time that works best for you: {{booking_link}}',
    enabledAt: null as string | null,
  };
  const saves: Array<Record<string, unknown>> = [];
  await page.route('**/api/admin/rebooking-reminders?**', async (route) => {
    if (route.request().method() === 'PATCH') {
      const update = route.request().postDataJSON() as Record<string, unknown>;
      saves.push(update);
      settings = { ...settings, ...update, enabledAt: '2026-09-30T14:00:00Z' };
    }
    await route.fulfill({ json: { data: { settings } } });
  });

  await impersonateSalonAsSuperAdmin(page);
  await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=marketing`);

  const home = page.getByTestId('marketing-home');

  await expect(home).toBeVisible();

  const reminderCard = home.getByTestId('marketing-home-rebooking-reminders');

  await expect(reminderCard).toContainText('Automatically remind clients when it’s almost time for their next appointment.');
  await expect(home.getByTestId('marketing-home-campaigns')).toContainText('Bring overdue clients back with timed reminders or offers.');
  await expect(home.getByTestId('marketing-home-rebooking-prompt')).toContainText('Confirmation Page Rebooking Prompt');

  await reminderCard.click();

  await expect(page.getByRole('heading', { name: 'Rebooking Reminders' })).toBeVisible();

  await page.getByRole('switch', { name: 'Enable rebooking reminders' }).click();
  await page.getByLabel('Send after the last completed appointment').fill('4');
  await page.getByLabel('SMS wording').fill('Hi {{first_name}}, book {{service_name}} at {{salon_name}}: {{booking_link}}');

  await expect(page.getByText(/Hi Alex, book Gel manicure at/)).toBeVisible();

  await page.getByRole('button', { name: 'Save Rebooking Reminders' }).click();

  await expect(page.getByRole('status')).toContainText('Rebooking Reminders saved.');
  expect(saves).toEqual([{ enabled: true, defaultIntervalWeeks: 4, messageTemplate: 'Hi {{first_name}}, book {{service_name}} at {{salon_name}}: {{booking_link}}' }]);
});
