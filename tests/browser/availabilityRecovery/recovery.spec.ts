import { expect, type Page, test } from '@playwright/test';

// Real Next.js screens, an isolated synthetic salon and controlled network
// failures. No booking, message, payment or salon-setting writes are made.
const timeUrl = '/isla-nail-studio/book/time?baseServiceId=svc_biab-short&selectedAddOns=%5B%7B%22addOnId%22%3A%22addon_e2e_nail-repair%22%2C%22quantity%22%3A1%7D%5D&locationId=location_nail-salon-no5_primary&techId=tech_daniela&date=2026-10-12';
const empty = { slots: [], visibleSlots: [], bookedSlots: [] };
const opening = (date: string) => ({
  slots: [{ time: '13:00', startTime: `${date}T13:00:00-04:00`, availability: 'available' }],
  visibleSlots: ['13:00'],
  bookedSlots: [],
});

async function capture(page: Page, path: string) {
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-07T12:00:00-04:00'));
});

test('partial search failure never claims the next month has no openings', async ({ page }, info) => {
  await page.route('**/api/appointments/availability?**', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date');
    await route.fulfill({ status: date === '2026-10-14' ? 503 : 200, json: empty });
  });
  await page.goto(timeUrl);
  await page.getByRole('button', { name: 'Find next available', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Find next available', exact: true })).toBeEnabled();

  await capture(page, info.outputPath('S16-partial-search.jpg'));

  await expect(page.getByText('We couldn’t finish checking availability. Please try again or choose a date.')).toBeVisible();
  await expect(page.getByText(/No openings were found in the next 30 days/)).toHaveCount(0);
});

test('manual date selection wins over a delayed search result', async ({ page }, info) => {
  let releaseSearch!: () => void;
  const searchHold = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  let searchStarted = false;
  await page.route('**/api/appointments/availability?**', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date');
    if (date === '2026-10-13') {
      searchStarted = true;
      await searchHold;
      await route.fulfill({ json: opening(date) }).catch(() => {});
      return;
    }
    await route.fulfill({ json: empty });
  });
  await page.goto(timeUrl);
  await page.getByRole('button', { name: 'Find next available', exact: true }).click();

  await expect.poll(() => searchStarted).toBe(true);

  await page.getByTestId('calendar-day-2026-10-14').click();
  releaseSearch();

  await expect(page.getByRole('button', { name: 'Find next available', exact: true })).toBeEnabled();

  await capture(page, info.outputPath('S16-manual-date-after-search.jpg'));

  await expect(page.getByTestId('calendar-day-2026-10-14')).toHaveAttribute('aria-pressed', 'true');
});

test('a slow availability response shows checking, not no openings', async ({ page }, info) => {
  let releaseDay!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseDay = resolve;
  });
  await page.route('**/api/appointments/availability?**', async (route) => {
    await hold;
    await route.fulfill({ json: empty }).catch(() => {});
  });
  await page.goto(timeUrl);

  await expect(page.getByRole('heading', { name: 'Pick Your Time' })).toBeVisible();

  await capture(page, info.outputPath('S16-loading.jpg'));
  try {
    await expect(page.getByText('Checking live availability')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Find next available', exact: true })).toHaveCount(0);
  } finally {
    releaseDay();
  }
});

test('next opening skips closed days and preserves service, add-on and artist through confirmation', async ({ page }, info) => {
  const dates: Array<string | null> = [];
  await page.route('**/api/appointments/availability?**', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date');
    dates.push(date);
    await route.fulfill({ json: date === '2026-10-13' ? opening(date) : empty });
  });
  await page.goto(timeUrl.replace('date=2026-10-12', 'date=2026-10-10'));
  await page.getByRole('button', { name: 'Find next available', exact: true }).click();

  await expect(page.getByTestId('calendar-day-2026-10-13')).toHaveAttribute('aria-pressed', 'true');
  expect(dates).not.toContain('2026-10-11');

  await page.getByRole('button', { name: '1:00 PM', exact: true }).click();

  await expect(page).toHaveURL(/\/book\/confirm\?/);

  const query = new URL(page.url()).searchParams;

  expect(query.get('baseServiceId')).toBe('svc_biab-short');
  expect(query.get('selectedAddOns')).toBe('[{"addOnId":"addon_e2e_nail-repair","quantity":1}]');
  expect(query.get('techId')).toBe('tech_daniela');
  expect(query.get('date')).toBe('2026-10-13');

  await expect(page.getByRole('heading', { name: 'Review & confirm' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('BIAB Short');
  await expect(page.getByRole('list', { name: 'Selected add-ons' })).toContainText('Nail Repair');
  await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('Daniela · 1h 25m');
  await expect(page.getByRole('button', { name: 'Confirm appointment · $70.00', exact: true })).toBeVisible();

  await capture(page, info.outputPath('S17-preserved-selection.jpg'));
});

test('choosing a date instead cancels the search and returns keyboard focus to the calendar', async ({ page }, info) => {
  let releaseSearch!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route('**/api/appointments/availability?**', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date');
    if (date !== '2026-10-12') {
      await hold;
      await route.fulfill({ json: opening(date!) }).catch(() => {});
      return;
    }
    await route.fulfill({ json: empty });
  });
  await page.goto(timeUrl);
  await page.getByRole('button', { name: 'Find next available', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a date instead', exact: true }).click();
  releaseSearch();

  await expect(page.getByRole('group', { name: 'Choose an appointment date' })).toBeFocused();
  await expect(page.getByTestId('calendar-day-2026-10-12')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Find next available', exact: true })).toBeEnabled();

  await capture(page, info.outputPath('S16-cancel-search.jpg'));
});

test('320px recovery actions and enlarged text remain readable', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.route('**/api/appointments/availability?**', route => route.fulfill({ json: empty }));
  await page.goto(timeUrl);

  await expect(page.getByRole('button', { name: 'Find next available', exact: true })).toBeVisible();

  await page.addStyleTag({ content: 'html { font-size: 20px !important; }' });
  await capture(page, info.outputPath('S16-320px-enlarged-text.jpg'));
});
