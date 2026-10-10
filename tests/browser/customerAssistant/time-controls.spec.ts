import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

const origin = 'http://127.0.0.1:3130';
const route = '/en/isla-nail-studio/book/time?baseServiceId=fixture-service&techId=fixture-tech&date=2030-01-15';
const times = Array.from({ length: 20 }, (_, index) => `${String(12 + Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`);

async function installTimeFixture(page: Page) {
  const unexpected: string[] = [];
  const requests: string[] = [];
  await page.clock.setFixedTime(new Date('2030-01-14T17:00:00Z'));
  await page.route('**/*', async (intercept) => {
    const request = intercept.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await intercept.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await intercept.continue();
      return;
    }
    requests.push(`${request.method()} ${url.pathname}`);
    if (url.pathname === '/api/__fixture/booking-page') {
      await intercept.fulfill({ json: { stage: 'time', props: {
        services: [{ id: 'fixture-service', name: 'Russian Manicure', price: 35, duration: 35 }],
        totalPrice: 35,
        totalDuration: 35,
        locationName: 'Primary location',
        technician: { id: 'fixture-tech', name: 'Daniela', imageUrl: null },
        bookingFlow: ['service', 'time', 'confirm'],
        minimumNoticeMinutes: 120,
        salonTimeZone: 'America/Toronto',
        closedWeekdays: [0],
      } } });
      return;
    }
    if (url.pathname === '/api/appointments/availability') {
      const date = url.searchParams.get('date');
      await intercept.fulfill({ json: {
        slots: times.map(time => ({ time, startTime: `${date}T${time}:00-05:00`, availability: 'available' })),
        bookedSlots: [],
        visibleDurationMinutes: 35,
        blockedDurationMinutes: 45,
      } });
      return;
    }
    if (url.pathname === '/api/public/customer-assistant/isla-nail-studio/session' && request.method() === 'POST') {
      await intercept.fulfill({ json: { conversation: 'synthetic-layout-conversation', salon: { name: 'Synthetic Isla Browser Salon' } } });
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await intercept.abort();
  });
  return { unexpected, requests };
}

for (const size of [
  { width: 320, height: 740, zoom: 100 },
  { width: 390, height: 844, zoom: 100 },
  { width: 430, height: 932, zoom: 100 },
  { width: 1440, height: 1000, zoom: 100 },
  { width: 320, height: 740, zoom: 200 },
]) {
  test(`time controls stay uncovered at ${size.width}px/${size.zoom}%`, async ({ page }, testInfo) => {
    const { unexpected, requests } = await installTimeFixture(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(route);
    await page.addStyleTag({ content: `html { font-size: ${size.zoom}%; } *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0s !important; animation-duration: 0s !important; }` });

    await expect(page.getByRole('heading', { name: '20 times available' })).toBeVisible();

    const launcher = page.getByRole('button', { name: 'Help me choose & book' });
    const time = page.getByRole('button', { name: '2:15 PM', exact: true });
    // Reproduce the production collision at the lower edge of the viewport.
    // A bottom spacer alone cannot protect a control midway through a page.
    await time.evaluate((button) => {
      const box = button.getBoundingClientRect();
      window.scrollBy(0, box.y + box.height / 2 - (window.innerHeight - 32));
    });

    expect(await time.evaluate((button) => {
      const box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);

    await time.focus();

    await expect(time).toBeFocused();

    await time.click({ trial: true });
    await page.screenshot({ path: path.resolve('artifacts/booking-time-mobile', `${testInfo.project.name}-${size.width}-${size.zoom}-times.png`) });

    const calendarToggle = page.getByRole('button', { name: 'View full calendar' });
    await calendarToggle.click();

    await expect(page.getByRole('button', { name: 'Next month' })).toBeVisible();

    await page.getByRole('button', { name: 'Show one week' }).click();

    await launcher.scrollIntoViewIfNeeded();

    expect((await launcher.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await launcher.click();

    await expect(page.getByRole('heading', { name: 'AI booking assistant' })).toBeVisible();

    await page.getByRole('button', { name: 'Continue manually' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(launcher).toBeFocused();
    expect(new URL(page.url()).searchParams.get('date')).toBe('2030-01-15');
    await expect(page.getByRole('heading', { name: '20 times available' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(requests.filter(request => request.startsWith('POST'))).toEqual(['POST /api/public/customer-assistant/isla-nail-studio/session']);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);

    await page.screenshot({ path: path.resolve('artifacts/booking-time-mobile', `${testInfo.project.name}-${size.width}-${size.zoom}-help.png`), fullPage: true });
  });
}
