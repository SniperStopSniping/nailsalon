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

const technician = {
  id: 'tech_isla',
  name: 'Isla',
  isActive: true,
  weeklySchedule: {
    monday: { start: '09:00', end: '18:00' },
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
  },
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
  const technicianWrites: unknown[] = [];
  let currentHours = hours;
  let currentTechnician = technician;
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
    if (url.pathname === '/api/admin/technicians' && request.method() === 'GET') {
      await route.fulfill({ json: { data: { technicians: [currentTechnician], pagination: { totalPages: 1 } } } });
      return;
    }
    if (url.pathname === `/api/admin/technicians/${technician.id}` && request.method() === 'GET') {
      await route.fulfill({ json: { data: { technician: currentTechnician } } });
      return;
    }
    if (url.pathname === `/api/admin/technicians/${technician.id}` && request.method() === 'PUT') {
      const body = request.postDataJSON() as { weeklySchedule?: typeof technician.weeklySchedule };
      technicianWrites.push(body);
      currentTechnician = { ...currentTechnician, weeklySchedule: body.weeklySchedule ?? currentTechnician.weeklySchedule };
      await route.fulfill({ json: { data: { technician: currentTechnician } } });
      return;
    }
    if (url.pathname === '/api/staff/time-off' && request.method() === 'GET') {
      await route.fulfill({ json: { data: { timeOff: [] } } });
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 404, json: { error: 'unexpected owner-navigation fixture API' } });
  });
  return { writes, technicianWrites, unexpected };
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

test('solo Hours opens a separate working-hours editor and persists the first Monday edit', async ({ page }) => {
  const { technicianWrites, unexpected } = await mockInformationApi(page);
  await page.goto('/?app=hours&salon=isla&freeSolo=1');

  await expect(page.getByRole('button', { name: 'Working hours' })).toBeVisible();

  await page.getByRole('button', { name: 'Working hours' }).tap();

  const mondayStart = page.getByLabel('Monday start time');

  await expect(mondayStart).toHaveValue('09:00');

  await mondayStart.selectOption('10:00');

  await expect(mondayStart).toHaveValue('10:00');

  await page.getByRole('button', { name: 'Save Schedule' }).tap();

  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  expect(technicianWrites).toEqual([{
    salonSlug: 'isla',
    weeklySchedule: {
      sunday: null,
      monday: { start: '10:00', end: '18:00' },
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
    },
  }]);
  expect(unexpected).toEqual([]);
});

test('solo Hours opens time off without mounting a competing recurring-hours editor', async ({ page }) => {
  const { unexpected } = await mockInformationApi(page);
  await page.goto('/?app=hours&salon=isla&freeSolo=1');

  await page.getByRole('button', { name: 'Time off' }).tap();

  await expect(page.getByText('Time off is an exception to your normal working hours. Adding time off keeps existing appointments in place.')).toBeVisible();
  await expect(page.getByText('No upcoming time off')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Schedule' })).toBeHidden();
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
