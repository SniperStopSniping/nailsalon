import { expect, test } from '@playwright/test';

const experience = { primaryColor: null, bookingMessage: 'Welcome', socialLinks: { instagram: null, facebook: null, tiktok: null }, confirmationMessage: 'Thanks', policy: { enabled: false, title: null, text: null, showOnServicePage: true, showBeforeConfirmation: true, showAfterConfirmation: true, showInConfirmationEmail: true, acknowledgment: { required: false, text: null }, version: null }, quickFacts: { appointmentOnly: { enabled: false, label: null }, depositNotice: { enabled: false, label: null }, cancellationNotice: { enabled: false, label: null } } };
async function mockApi(page: import('@playwright/test').Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3141') {
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) {
      return route.continue();
    }
    if (url.pathname === '/api/admin/salon/settings') {
      return route.fulfill({ json: { reviewsEnabled: true, rewardsEnabled: true, billingMode: 'STRIPE', subscriptionStatus: 'active', bookingExperience: experience, bookingConfig: { bufferMinutes: 10, slotIntervalMinutes: 15, currency: 'CAD', timezone: 'America/Toronto', minimumNoticeMinutes: 120, clientChangeCutoffHours: 24, confirmationMode: 'instant' }, payments: { tax: { enabled: false, name: '', ratePercent: 0 }, deposit: { enabled: false } }, communications: {} } });
    }
    if (url.pathname === '/api/admin/profile') {
      return route.fulfill({ json: { user: { name: 'Daniela', email: 'daniela@example.com' } } });
    }
    if (url.pathname === '/api/admin/settings/modules') {
      return route.fulfill({ json: { data: { modules: {}, entitledModules: {}, moduleReasons: {} } } });
    }
    if (url.pathname === '/api/admin/settings/visibility') {
      return route.fulfill({ json: { data: { visibility: { staff: {} }, entitled: false } } });
    }
    if (url.pathname === '/api/admin/settings/booking-flow') {
      return route.fulfill({ json: { data: { bookingFlowCustomizationEnabled: false, bookingFlow: null } } });
    }
    if (url.pathname.startsWith('/api/admin/owner-assistant')) {
      return route.fulfill({ status: 404, json: {} });
    }
    if (url.pathname === '/api/billing/portal') {
      throw new Error('browser harness must never open billing portal');
    }
    return route.fulfill({ json: {} });
  });
}

test('mobile Settings exposes only secondary destinations and guards a dirty Account exit', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?salon=salon-a&app=settings');
  for (const item of ['Account', 'Owner & Staff Alerts', 'Appointment Photo Rules', 'Advanced']) {
    await expect(page.getByText(item, { exact: true })).toBeVisible();
  }

  await expect(page.getByText('Business', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Booking & Availability', { exact: true })).toHaveCount(0);

  await page.getByText('Advanced', { exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Advanced', exact: true })).toBeVisible();
  await expect(page.getByText('Optional Features', { exact: true })).toBeVisible();

  await page.getByText('Optional Features', { exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Optional Features', exact: true })).toBeVisible();

  await page.goBack();

  await expect(page.getByRole('heading', { name: 'Advanced', exact: true })).toBeVisible();

  await page.goBack();

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await page.getByText('Account', { exact: true }).click();

  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue('daniela@example.com');

  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Daniela D');
  await page.getByRole('button', { name: 'Open Plan & Usage' }).click();

  await expect(page.getByRole('alertdialog')).toContainText('unsaved changes');

  await page.getByRole('button', { name: 'Keep editing' }).click();

  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile Plan & Usage hosts billing presentation without opening the portal', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?salon=salon-a&app=plan-usage');
  await page.getByRole('button', { name: /plan & billing/i }).click();

  await expect(page).toHaveURL(/app=plan-usage&view=billing/);
  await expect(page.getByText('Stripe Billing')).toBeVisible();
  await expect(page.getByTestId('manage-billing-button')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan & Usage' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
