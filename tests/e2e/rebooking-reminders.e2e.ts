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

  await expect(page.getByRole('heading', { name: 'Rebooking Reminders', exact: true })).toBeVisible();

  await page.getByRole('switch', { name: 'Enable rebooking reminders' }).click();
  await page.getByLabel('Send after the last completed appointment').fill('4');
  await page.getByLabel('SMS wording').fill('Hi {{first_name}}, book {{service_name}} at {{salon_name}}: {{booking_link}}');

  await expect(page.getByText(/Hi Alex, book Gel manicure at/)).toBeVisible();

  await page.getByRole('button', { name: 'Save reminders' }).click();

  await expect(page.getByRole('status')).toContainText('Rebooking Reminders saved.');
  expect(saves).toEqual([{ enabled: true, defaultIntervalWeeks: 4, messageTemplate: 'Hi {{first_name}}, book {{service_name}} at {{salon_name}}: {{booking_link}}' }]);
});

test.describe('bulk client messages', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('owner filters old visits, adjusts recipients, reviews credits and queues separate texts @mobile-safari', async ({ page }, testInfo) => {
    const clients = [
      { id: 'old-a', fullName: 'Ava Martin', phone: '4165550101', lastCompletedAt: '2030-10-21T16:00:00Z', eligible: true },
      { id: 'old-b', fullName: 'Bea Chen', phone: '4165550102', lastCompletedAt: '2030-10-10T16:00:00Z', eligible: true },
      { id: 'old-c', fullName: 'Cam Rivera', phone: '4165550103', lastCompletedAt: '2030-09-28T16:00:00Z', eligible: true },
      { id: 'recent', fullName: 'Dee Wilson', phone: '4165550104', lastCompletedAt: '2030-11-04T16:00:00Z', eligible: true },
      { id: 'new', fullName: 'Eve Brooks', phone: '4165550105', lastCompletedAt: null, eligible: true },
      { id: 'stop', fullName: 'Faye Johnson', phone: '4165550106', lastCompletedAt: '2030-10-14T16:00:00Z', eligible: false },
    ].map(client => ({ ...client, hasUpcomingAppointment: false, unavailableReason: client.eligible ? null : 'Promotional texts unavailable or opted out' }));
    const sends: Array<Record<string, unknown>> = [];
    let reviewedIds: string[] = [];
    await page.route('**/api/admin/messages/bulk?**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { data: { clients, asOf: '2030-11-11T16:00:00Z', timeZone: 'America/Toronto', bookingUrl: 'https://example.test/book', sms: { manualAvailable: true, availableCredits: 100, senderLabel: 'Luster', detail: '' } } } });
        return;
      }
      const request = route.request().postDataJSON() as Record<string, unknown>;
      const recipients = clients.filter(client => (request.clientIds as string[]).includes(client.id));
      if (request.action === 'preview') {
        reviewedIds = request.clientIds as string[];
        await route.fulfill({ json: { data: { preview: { fingerprint: 'a'.repeat(64), body: `Demo Studio via Luster: ${request.message} Reply STOP to opt out.`, recipients, skipped: 0, creditsPerText: 1, totalCredits: recipients.length } } } });
        return;
      }
      sends.push(request);
      await route.fulfill({ status: 202, json: { data: { receipt: { requestId: request.requestId, queued: recipients.length, skipped: 0, totalCredits: recipients.length, messages: recipients.map(client => ({ id: client.id, clientName: client.fullName, status: 'queued', failureReason: null })) } } } });
    });

    await impersonateSalonAsSuperAdmin(page);
    await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=marketing`);
    await page.getByTestId('marketing-write-message-action').click();
    await page.getByRole('button', { name: /^Message multiple clients/ }).click();

    await expect(page.getByLabel('Select Ava Martin')).toBeVisible();

    await page.getByRole('button', { name: 'All clients', exact: true }).click();

    await expect(page.getByText('5 selected', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Last visit', exact: true }).click();

    await expect(page.getByLabel('Weeks since last completed visit')).toHaveValue('3');
    await expect(page.getByText('3 selected', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Select Dee Wilson')).toHaveCount(0);
    await expect(page.getByLabel('Select Eve Brooks')).toHaveCount(0);
    await expect(page.getByLabel('Select Faye Johnson')).toBeDisabled();

    await page.getByLabel('Select Bea Chen').uncheck();

    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();

    await page.getByLabel('Select Bea Chen').check();
    await page.getByLabel('Your message').fill('Book your next visit!');
    await page.getByRole('button', { name: 'Add booking link', exact: true }).click();
    await page.getByRole('button', { name: /^Review message/ }).click();

    await expect(page.getByText('Review your message', { exact: true })).toBeVisible();
    await expect(page.getByText('3 clients · 3 credits', { exact: true })).toBeVisible();
    await expect(page.getByTestId('sms-message-preview')).toContainText('Book your next visit! https://example.test/book');
    expect(reviewedIds.sort()).toEqual(['old-a', 'old-b', 'old-c']);
    expect(sends).toHaveLength(0);

    await page.screenshot({ path: testInfo.outputPath('bulk-message-review.png'), fullPage: true });
    await page.getByRole('button', { name: 'Send to 3 clients · 3 credits', exact: true }).click();

    await expect(page.getByText('Your messages are queued', { exact: true })).toBeVisible();
    await expect(page.getByText('Queued', { exact: true })).toHaveCount(3);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ message: 'Book your next visit! https://example.test/book', clientIds: expect.arrayContaining(['old-a', 'old-b', 'old-c']), filter: { minWeeks: 3, excludeUpcoming: true } });
  });
});
