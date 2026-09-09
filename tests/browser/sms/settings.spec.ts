import { expect, test } from '@playwright/test';

test('Features & plan opens included SMS credits and paused Client communications with a canonical save', async ({ page }) => {
  const browserErrors: string[] = [];
  const unexpectedRequests: string[] = [];
  const mutations: Array<{ path: string; method: string; body: unknown }> = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });
  const modules = {
    smsReminders: false,
    referrals: false,
    rewards: false,
    scheduleOverrides: true,
    staffEarnings: false,
    clientFlags: false,
    clientBlocking: false,
    analyticsDashboard: false,
    utilization: false,
  };
  let communications = {
    sms: { enabled: false },
    email: { enabled: true },
    killSwitch: false,
    quietHours: { enabled: true, start: '21:00', end: '09:00' },
    reminders: { rules: [] },
    events: {},
  };
  const pausedSms = {
    providerReady: false,
    senderMode: 'shared_luster',
    senderLabel: 'Luster shared texting number',
    phoneNumber: null,
    blockingReason: 'GLOBAL_SMS_DISABLED',
    detail: 'Luster has temporarily paused SMS sending. Your credits and preferences are saved.',
    automaticEnabled: false,
    manualAvailable: false,
    remindersEnabled: false,
    quietHours: communications.quietHours,
    availableCredits: 100,
    workerConfigured: true,
  };
  const settings = () => ({ communications, sms: { ...pausedSms, smsEnabled: communications.sms.enabled }, billingMode: 'NONE' });

  // The only network origin is this component harness. APIs are synthetic;
  // unexpected writes are rejected and asserted, never sent to an application.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3127') {
      unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    if (request.method() !== 'GET') {
      mutations.push({ path: `${url.pathname}${url.search}`, method: request.method(), body: request.postDataJSON() });
      if (request.method() !== 'PATCH' || url.pathname !== '/api/admin/salon/settings' || url.searchParams.get('salonSlug') !== 'sms-fixture') {
        unexpectedRequests.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({ status: 405, json: { error: 'Unexpected fixture mutation' } });
        return;
      }
      const body = request.postDataJSON();
      if (Object.keys(body).length !== 1 || !body.communications) {
        unexpectedRequests.push('Non-communications settings mutation');
        await route.fulfill({ status: 400, json: { error: 'Only communications preferences may be saved' } });
        return;
      }
      communications = body.communications;
      await route.fulfill({ json: settings() });
      return;
    }
    const responses: Record<string, unknown> = {
      '/api/admin/settings/modules': { data: { modules, entitledModules: modules, moduleReasons: Object.fromEntries(Object.entries(modules).map(([key, enabled]) => [key, enabled ? 'ENABLED' : 'UPGRADE_REQUIRED'])) } },
      '/api/admin/settings/visibility': { data: { visibility: { staff: {} }, entitled: false } },
      '/api/admin/settings/booking-flow': { data: { bookingFlowCustomizationEnabled: false, bookingFlow: ['service', 'tech', 'time', 'confirm'] } },
      '/api/admin/salon/settings': settings(),
      '/api/admin/profile': { user: { name: 'Test Owner', email: 'owner@example.test' } },
    };
    if (!(url.pathname in responses)) {
      unexpectedRequests.push(`GET ${url.pathname}`);
      await route.fulfill({ status: 404, json: { error: 'Unknown fixture API' } });
      return;
    }
    await route.fulfill({ json: responses[url.pathname] });
  });
  await page.goto('/?fixture=settings');

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay, [data-nextjs-dialog]')).toHaveCount(0);

  await page.getByRole('button', { name: /Features & plan/ }).click();
  const smsEntry = page.getByTestId('settings-sms-communications');

  await expect(smsEntry).toContainText('Included on every plan · Uses SMS credits');
  await expect(page.getByRole('button', { name: /Toggle SMS/ })).toHaveCount(0);
  await expect(page.getByTestId('locked-feature-rewards')).toContainText('Not included in your plan yet');
  await expect(page.getByTestId('locked-feature-rewards')).toContainText('Locked');
  await expect(page.getByRole('button', { name: 'Toggle Schedule Overrides' })).toBeEnabled();
  expect(mutations).toEqual([]);

  await page.screenshot({ path: test.info().outputPath('features-included-sms.png'), fullPage: true });
  await smsEntry.click();

  await expect(page.getByRole('heading', { name: 'Client communications', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/app=settings&view=communications/);
  await expect(page.getByText('100 SMS credits available. See Usage for details.')).toBeVisible();
  await expect(page.getByText(pausedSms.detail)).toBeVisible();
  await expect(page.getByText(/SMS access is included with every plan/)).toBeVisible();

  const preference = page.getByRole('checkbox', { name: 'Text messages to clients', exact: true });
  const save = page.getByRole('button', { name: 'Save communication settings' });

  await expect(preference).not.toBeChecked();
  await expect(preference).toBeEnabled();
  await expect(save).toBeDisabled();
  expect(mutations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: test.info().outputPath('communications-paused-100-credits.png'), fullPage: true });
  await preference.check();
  await save.click();

  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(preference).toBeChecked();
  await expect(save).toBeDisabled();
  await expect(page.getByText(pausedSms.detail)).toBeVisible();
  await expect(page.getByText('100 SMS credits available. See Usage for details.')).toBeVisible();
  expect(mutations).toEqual([{
    path: '/api/admin/salon/settings?salonSlug=sms-fixture',
    method: 'PATCH',
    body: { communications: { sms: { enabled: true }, email: { enabled: true }, killSwitch: false, quietHours: { enabled: true, start: '21:00', end: '09:00' }, reminders: { rules: [] } } },
  }]);
  expect(unexpectedRequests).toEqual([]);
  expect(browserErrors).toEqual([]);

  await page.screenshot({ path: test.info().outputPath('communications-saved-still-paused.png'), fullPage: true });
});
