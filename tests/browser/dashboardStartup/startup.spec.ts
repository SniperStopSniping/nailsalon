import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:3171') {
      throw new Error('External calls are forbidden in the isolated startup review.');
    }
    await route.continue();
  });
});

const closedTools = /\/(?:AppointmentsModal|ClientsModal|SettingsModal|ScheduleCalendarModal|ServicesModal|MarketingModal|PaymentsModal|OwnerManagementModal|NewAppointmentModal|WalkInModal|OwnerAssistantSheet)\.tsx/;

test('Today does not download closed tools; Clients loads on demand and supports history', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

  expect(requests.filter(url => closedTools.test(url))).toEqual([]);

  await page.getByRole('button', { name: 'clients', exact: true }).click();

  await expect(page.getByRole('textbox', { name: 'Search clients' })).toBeVisible();
  await expect(page.getByRole('button', { name: /SM Sofia Martin/ })).toBeVisible();

  expect(requests.some(url => url.includes('/ClientsModal.tsx'))).toBe(true);

  await page.goBack();

  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goForward();

  await expect(page.getByRole('textbox', { name: 'Search clients' })).toBeVisible();

  await page.reload();

  await expect(page.getByRole('textbox', { name: 'Search clients' })).toBeVisible();

  await page.getByRole('button', { name: 'Back', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('slow Calendar can be closed before its module arrives without reopening', async ({ page }, testInfo) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/ScheduleCalendarModal.tsx*', async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'schedule', exact: true }).click();

    await expect(page.getByRole('status')).toHaveText('Opening…');
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await expect.poll(async () => (await page.getByTestId('app-modal-panel').boundingBox())?.y ?? 1000).toBeLessThan(60);

    await page.screenshot({ scale: 'css', path: testInfo.outputPath('loading-calendar.png') });
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);

    release();
    await page.getByRole('button', { name: 'schedule', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Next month' })).toBeVisible();

    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'schedule', exact: true })).toBeFocused();
  } finally {
    release();
  }
});

test('failed Services module has close and reload recovery; other tools remain usable', async ({ page }, testInfo) => {
  await page.route('**/ServicesModal.tsx*', route => route.abort('failed'));
  await page.goto('/?app=services');

  await expect(page.getByRole('alert')).toContainText('This screen couldn’t load');
  await expect(page.getByRole('button', { name: 'Reload app' })).toBeVisible();

  await expect.poll(async () => (await page.getByTestId('app-modal-panel').boundingBox())?.y ?? 1000).toBeLessThan(60);

  await page.screenshot({ scale: 'css', path: testInfo.outputPath('failed-tool.png') });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'clients', exact: true }).click();

  await expect(page.getByRole('textbox', { name: 'Search clients' })).toBeVisible();
});

test('a cancelled download does not retain the previous salon context', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/ClientsModal.tsx*', async (route) => {
    await pending;
    await route.continue();
  });
  await page.addInitScript(() => {
    const record: string[] = [];
    Object.defineProperty(window, '__startupApiRequests', { value: record });
    const original = window.fetch;
    // The fixture installs its API after initialization; record calls at the
    // boundary without reading or modifying any response.
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      get: () => original,
      set: (implementation: typeof fetch) => {
        Object.defineProperty(window, 'fetch', { configurable: true, writable: true, value: (input: RequestInfo | URL, init?: RequestInit) => {
          record.push(String(input));
          return implementation(input, init);
        } });
      },
    });
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'clients', exact: true }).click();

    await expect(page.getByRole('status')).toHaveText('Opening…');

    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Switch salon' }).click();
    await page.getByRole('button', { name: 'clients', exact: true }).click();
    release();

    await expect(page.getByRole('textbox', { name: 'Search clients' })).toBeVisible();

    const requests = await page.evaluate(() => (window as unknown as { __startupApiRequests: string[] }).__startupApiRequests.filter(url => url.includes('/api/admin/clients?')));

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(url => url.includes('other-browser'))).toBe(true);
  } finally {
    release();
  }
});

test('New appointment and Walk-in open from Today after deferred loading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New appointment', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'New Appointment', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close modal' })).toBeVisible();

  await page.getByRole('button', { name: 'Close modal' }).click();
  await page.getByRole('button', { name: 'Walk-in', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Quick Walk-in' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
