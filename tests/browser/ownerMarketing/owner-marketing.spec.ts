import { expect, test } from '@playwright/test';

const retentionSettings = {
  defaultRebookDays: 21,
  reminderLeadHours: 24,
  googleReviewUrl: 'https://g.page/r/isla/review',
  parkingInstructions: '',
  sixWeekPromotion: { enabled: false, name: '', discountType: 'fixed', value: 0, eligibleServiceIds: [], expiryDays: 14, code: '', messageTemplate: '', singleUse: true },
  eightWeekPromotion: { enabled: false, name: '', discountType: 'fixed', value: 0, eligibleServiceIds: [], expiryDays: 21, code: '', messageTemplate: '', singleUse: true },
};

const salonSettings = {
  smartFit: { enabled: false, discountType: 'percent', value: 10, maxRemainingGapMinutes: 30, minImprovementMinutes: 15, eligibleServiceIds: [], eligibleTechnicianIds: [] },
  bookingConfig: { currency: 'CAD' },
  communications: {
    email: { enabled: true },
    sms: { enabled: true, bookingDefault: 'default_on' },
    killSwitch: false,
    quietHours: { enabled: true, start: '21:00', end: '09:00' },
    reminders: { rules: [{ id: 'reminder_60', offsetMinutes: 60, channels: 'both', enabled: true }] },
    events: {},
  },
  sms: { providerReady: true, senderMode: 'shared_luster', senderLabel: 'Luster SMS', automaticEnabled: true, manualAvailable: true, remindersEnabled: true, availableCredits: 100, quietHours: { enabled: true, start: '21:00', end: '09:00' } },
};

async function mockLocalApis(page: import('@playwright/test').Page) {
  const mutations: Array<{ path: string; body: unknown }> = [];
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3138') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      mutations.push({ path: url.pathname, body });
      if (url.pathname === '/api/admin/salon/settings' && body?.smartFit) {
        await route.fulfill({ json: { ...salonSettings, smartFit: body.smartFit } });
        return;
      }
      if (url.pathname === '/api/admin/salon/settings' && body?.communications) {
        await route.fulfill({ json: { ...salonSettings, communications: body.communications } });
        return;
      }
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 405, json: { error: 'Unexpected fixture mutation' } });
      return;
    }
    const responses: Record<string, unknown> = {
      '/api/admin/retention/settings': { data: { settings: retentionSettings, availableServices: [] } },
      '/api/admin/marketing': { data: { currency: 'CAD', followups: { groups: [], reminders: [] }, results: { windowDays: 30, outreach: [], campaigns: [], automatic: [] } } },
      '/api/admin/today': { data: { links: { bookingUrl: 'https://luster.test/book' }, timeZone: 'America/Toronto' } },
      '/api/integrations/health': { data: { sms: salonSettings.sms, availability: {}, google: { status: 'disconnected' } } },
      '/api/admin/settings/modules': { data: { modules: {}, entitledModules: {}, moduleReasons: { smsReminders: 'ENABLED' } } },
      '/api/admin/review-requests/settings': { data: { googleReviewUrl: retentionSettings.googleReviewUrl, automaticEnabled: false, delayMinutes: 60, messageTemplate: 'Hi {{firstName}}', businessName: 'Isla Nail Studio' } },
      '/api/admin/salon/settings': salonSettings,
      '/api/salon/services': { data: { services: [{ id: 'service_1', name: 'BIAB' }] } },
      '/api/admin/technicians': { data: { technicians: [{ id: 'tech_1', name: 'Isla' }], pagination: { totalPages: 1 } } },
      '/api/admin/settings/visibility': { data: { visibility: { staff: {} }, entitled: false } },
      '/api/admin/settings/booking-flow': { data: { bookingFlowCustomizationEnabled: false, bookingFlow: [] } },
      '/api/admin/profile': { user: { name: 'Isla', email: 'isla@example.test' } },
    };
    await route.fulfill({ json: responses[url.pathname] ?? { data: {} } });
  });
  return { mutations, unexpected };
}

test('mobile Marketing consolidates appointment messages and keeps URL history context', async ({ page }) => {
  const { mutations, unexpected } = await mockLocalApis(page);
  await page.goto('/?salon=isla&returnTo=calendar&app=marketing');

  await expect(page.getByTestId('marketing-home')).toBeVisible();
  await expect(page.getByTestId('marketing-home-appointment-messages')).toBeVisible();
  await expect(page.getByTestId('marketing-home-texting-settings')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByTestId('marketing-home-appointment-messages').tap();

  await expect(page).toHaveURL(/salon=isla.*returnTo=calendar.*app=marketing.*view=messages/);
  await expect(page.getByLabel('SMS reminders during online booking')).toHaveValue('default_on');
  await expect(page.getByLabel('Reminder 1 timing')).toHaveValue('60');

  await page.getByLabel('SMS reminders during online booking').selectOption('default_off');
  await page.getByRole('button', { name: 'Save communication settings' }).tap();

  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toEqual({
    path: '/api/admin/salon/settings',
    body: {
      communications: {
        email: { enabled: true },
        sms: { enabled: true, bookingDefault: 'default_off' },
        killSwitch: false,
        quietHours: { enabled: true, start: '21:00', end: '09:00' },
        reminders: { rules: [{ id: 'reminder_60', offsetMinutes: 60, channels: 'both', enabled: true }] },
      },
    },
  });
  expect(JSON.stringify(mutations[0]?.body)).not.toMatch(/stop|consent/i);

  await page.getByRole('button', { name: 'Marketing & Messages' }).tap();

  await expect(page.getByTestId('marketing-home')).toBeVisible();

  await page.goBack();

  await expect(page).not.toHaveURL(/view=messages/);
  expect(unexpected).toEqual([]);
});

test('legacy Reviews URL opens Review Requests on both mobile widths', async ({ page }) => {
  const { unexpected } = await mockLocalApis(page);
  await page.goto('/?salon=isla&returnTo=calendar&app=marketing&view=reviews');

  await expect(page.getByRole('heading', { name: 'Review Requests', exact: true })).toBeVisible();
  await expect(page.getByTestId('review-request-settings')).toBeVisible();

  await page.getByRole('button', { name: 'Marketing & Messages' }).tap();

  await expect(page.getByTestId('marketing-home')).toBeVisible();

  await page.goBack();

  await expect(page).not.toHaveURL(/view=reviews/);
  expect(unexpected).toEqual([]);
});

test('client-side direct links remount the correct leaf editor', async ({ page }) => {
  const { unexpected } = await mockLocalApis(page);
  await page.goto('/?salon=isla&returnTo=calendar&app=marketing&view=smart-fit');

  await expect(page.getByTestId('smart-fit-enabled')).toBeVisible();

  await page.evaluate(() => {
    window.history.pushState({}, '', '/?salon=isla&returnTo=calendar&app=marketing&view=messages');
    window.dispatchEvent(new Event('luster:marketing-fixture-navigation'));
  });

  await expect(page.getByLabel('SMS reminders during online booking')).toHaveValue('default_on');
  await expect(page.getByLabel('Reminder 1 timing')).toHaveValue('60');
  await expect(page.getByTestId('smart-fit-enabled')).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('Offers reaches Smart Fit and preserves its existing save and dirty-leave guard', async ({ page }) => {
  const { mutations, unexpected } = await mockLocalApis(page);
  await page.goto('/?salon=isla&returnTo=calendar&app=marketing');

  await page.getByTestId('marketing-home-offers').tap();
  await page.getByTestId('marketing-offers-smart-fit').tap();

  await expect(page.getByTestId('smart-fit-enabled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marketing & Messages' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View Smart Fit results' })).toHaveCount(0);

  await page.getByTestId('smart-fit-enabled').check();
  await page.getByRole('button', { name: 'Offers' }).tap();

  await expect(page.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeVisible();

  await page.getByRole('button', { name: 'Keep editing' }).tap();
  await page.getByRole('button', { name: 'Save Smart Fit settings' }).tap();

  await expect(page.getByText('Smart Fit settings saved.')).toBeVisible();

  expect(mutations).toEqual([{
    path: '/api/admin/salon/settings',
    body: { smartFit: { enabled: true, discountType: 'percent', value: 10, maxRemainingGapMinutes: 30, minImprovementMinutes: 15, eligibleServiceIds: [], eligibleTechnicianIds: [] } },
  }]);
  expect(unexpected).toEqual([]);
});
