import { expect, test } from '@playwright/test';

const hours = {
  monday: { open: '10:00', close: '18:00' },
  tuesday: { open: '10:00', close: '18:00' },
  wednesday: { open: '10:00', close: '18:00' },
  thursday: { open: '10:00', close: '18:00' },
  friday: { open: '10:00', close: '18:00' },
  saturday: null,
  sunday: null,
};

function information(businessHours = hours) {
  return {
    data: {
      salon: {
        id: 'salon_isla',
        slug: 'isla',
        name: 'Isla Nail Studio',
        publicationStatus: 'published',
        slugLocked: true,
        customDomain: null,
        publicUrl: 'https://luster.test/isla',
        logoUrl: null,
        phone: '4165550111',
        email: 'hello@isla.test',
      },
      technician: null,
      technicianCount: 1,
      instagram: null,
      instagramHandle: null,
      location: { id: 'location_isla', name: 'Isla Nail Studio', address: '1 King St', city: 'Toronto', state: 'ON', zipCode: 'M5H 1A1' },
      addressPrivacy: { draft: 'city_only', live: 'city_only' },
      contactPreferences: { bookingOnlyContact: false, callEnabled: true, textEnabled: true, textNumber: '4165550111' },
      businessHours,
      staffedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      timezone: 'America/Toronto',
    },
  };
}

async function mockInformationApi(page: import('@playwright/test').Page) {
  const writes: unknown[] = [];
  let currentHours = hours;
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3137') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (url.pathname === '/api/admin/salon/information' && request.method() === 'GET') {
      await route.fulfill({ json: information(currentHours) });
      return;
    }
    if (url.pathname === '/api/admin/salon/information' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as { businessHours?: typeof hours };
      writes.push(body);
      currentHours = body.businessHours ?? currentHours;
      await route.fulfill({ json: information(currentHours) });
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 404, json: { error: 'unexpected owner-navigation fixture API' } });
  });
  return { writes, unexpected };
}

test('mobile More is ranked in task groups and Hours opens first with browser history in sync', async ({ page }) => {
  const { unexpected } = await mockInformationApi(page);
  await page.goto('/?client=client_9&returnTo=calendar');

  await expect(page.getByTestId('more-screen')).toBeVisible();

  for (const heading of ['Booking', 'Clients & Growth', 'Business', 'Luster']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  const orderedIds = await page.locator('[data-testid^="admin-app-tile-"]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-testid')),
  );

  expect(orderedIds).toEqual([
    'admin-app-tile-hours',
    'admin-app-tile-booking-rules',
    'admin-app-tile-booking-page',
    'admin-app-tile-marketing',
    'admin-app-tile-portfolio',
    'admin-app-tile-payments',
    'admin-app-tile-analytics',
    'admin-app-tile-team',
    'admin-app-tile-integrations',
    'admin-app-tile-plan-usage',
    'admin-app-tile-settings',
    'admin-app-tile-help',
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByTestId('admin-app-tile-hours').tap();

  await expect(page.getByText('Hours & Availability', { exact: true })).toBeVisible();
  await expect(page.getByTestId('booking-page-information-editor')).toBeVisible();
  await expect(page).toHaveURL(/app=hours/);

  await page.goBack();

  await expect(page.getByTestId('more-screen')).toBeVisible();

  await page.goForward();

  await expect(page.getByText('Hours & Availability', { exact: true })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test('Hours saves through its existing canonical API payload on mobile', async ({ page }) => {
  const { writes, unexpected } = await mockInformationApi(page);
  await page.goto('/?app=hours&salon=isla');

  await expect(page.getByTestId('information-hours')).toBeVisible();

  await page.getByTestId('information-hours-monday-open').fill('11:00');

  await expect(page.getByTestId('information-save-hours')).toBeEnabled();

  await page.getByTestId('information-save-hours').tap();

  await expect(page.getByText('Hours saved. Bookable times still follow each staff member’s schedule.')).toBeVisible();
  expect(writes).toEqual([{ businessHours: { ...hours, monday: { open: '11:00', close: '18:00' } } }]);
  expect(unexpected).toEqual([]);
});

test('unsaved hours guard protects both the More header and contextual shortcuts', async ({ page }) => {
  await mockInformationApi(page);
  await page.goto('/?app=hours&salon=isla');

  await expect(page.getByTestId('information-hours')).toBeVisible();

  await page.getByTestId('information-hours-monday-open').fill('11:00');
  await page.getByRole('button', { name: 'More' }).tap();

  await expect(page.getByRole('dialog', { name: 'Unsaved hours' })).toBeVisible();

  await page.getByRole('button', { name: 'Keep editing' }).tap();

  await expect(page.getByRole('dialog', { name: 'Unsaved hours' })).toBeHidden();

  await page.getByRole('button', { name: 'View calendar' }).tap();

  await expect(page.getByRole('dialog', { name: 'Unsaved hours' })).toBeVisible();

  await page.getByRole('button', { name: 'Discard changes' }).tap();

  await expect(page.getByTestId('calendar-screen')).toBeVisible();
});

test('Help dispatches to existing paths and Free Solo retains the existing plan gate', async ({ page }) => {
  await mockInformationApi(page);
  await page.goto('/?app=help&salon=isla');

  await page.getByRole('button', { name: /workspace tour/i }).tap();

  await expect(page.getByTestId('workspace-tour-screen')).toBeVisible();

  await page.goto('/?app=help&salon=isla');
  await page.getByRole('button', { name: /luster resources/i }).tap();

  await expect(page.getByTestId('luster-screen')).toBeVisible();

  await page.goto('/?app=plan-usage&salon=isla&freeSolo=1');

  await expect(page.getByRole('button', { name: /usage & billing/i })).toBeEnabled();
  await expect(page.getByRole('button', { name: /compare plans/i })).toHaveCount(0);
});

async function mockBookingControls(page: import('@playwright/test').Page) {
  const writes: unknown[] = [];
  const unexpected: string[] = [];
  let bookingConfig = { currency: 'CAD', timezone: 'America/Toronto', minimumNoticeMinutes: 120, bufferMinutes: 10, slotIntervalMinutes: 15, clientChangeCutoffHours: 24, confirmationMode: 'instant' };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3137') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (url.pathname === '/api/admin/salon/settings') {
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        writes.push(body);
        bookingConfig = { ...bookingConfig, ...body.bookingConfig };
      }
      await route.fulfill({ json: { bookingConfig } });
      return;
    }
    if (request.method() === 'GET' && ['/api/admin/settings/modules', '/api/admin/settings/visibility', '/api/admin/settings/booking-flow', '/api/admin/profile'].includes(url.pathname)) {
      await route.fulfill({ json: { data: {}, user: { name: 'Isla', email: 'isla@example.test' } } });
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 404, json: { error: 'Unexpected booking-controls fixture API' } });
  });
  return { writes, unexpected };
}

test('Payments Currency saves its own field and browser Back preserves context', async ({ page }) => {
  const { writes, unexpected } = await mockBookingControls(page);
  await page.goto('/?app=payments&salon=isla&returnTo=calendar');
  await page.getByRole('button', { name: /Currency Currency for/ }).tap();

  await expect(page).toHaveURL(/view=currency/);

  await page.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('USD');
  await page.getByRole('button', { name: 'Save currency' }).tap();

  await expect(page.getByText('Currency saved.')).toBeVisible();
  expect(writes).toEqual([{ bookingConfig: { currency: 'USD' } }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goBack();

  await expect(page.getByRole('button', { name: /Currency Currency for/ })).toBeVisible();

  await page.goForward();

  await expect(page.getByRole('combobox', { name: 'Currency', exact: true })).toHaveValue('USD');
  await expect(page).toHaveURL(/returnTo=calendar/);
  expect(unexpected).toEqual([]);
});

test('Booking Rules saves notice without submitting currency or timezone on mobile', async ({ page }) => {
  const { writes, unexpected } = await mockBookingControls(page);
  await page.goto('/?app=booking-rules&view=rules&salon=isla');
  await page.getByTestId('minimum-notice-select').selectOption('1440');

  await expect(page.getByRole('combobox', { name: 'Currency', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Timezone', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Save booking rules' }).tap();

  await expect(page.getByText('Booking rules saved.')).toBeVisible();
  expect(writes).toEqual([{ bookingConfig: { confirmationMode: 'instant', minimumNoticeMinutes: 1440, bufferMinutes: 10, slotIntervalMinutes: 15, clientChangeCutoffHours: 24 } }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(unexpected).toEqual([]);
});
