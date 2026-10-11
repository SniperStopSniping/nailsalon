import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { DEFAULT_RETENTION_SETTINGS } from '../../../src/libs/retentionAssistant';
import type { SmartFitReportResponse } from '../../../src/libs/smartFitReporting';
import { expectReadableText } from '../assert-readable';

const endpoint = '**/api/admin/analytics/smart-fit?*';

function report({ enabled = true, empty = false, monthly = false, yearly = false } = {}): SmartFitReportResponse {
  return {
    config: { enabled },
    metrics: {
      appointments: empty ? 0 : 42,
      discountGivenCents: empty ? 0 : 42000,
      bookedRevenueCents: empty ? 0 : 123456789,
      averageDiscountCents: empty ? 0 : 1000,
      completedCount: empty ? 0 : 30,
      upcomingCount: empty ? 0 : 12,
      cancelledCount: 1,
      noShowCount: 1,
      resolvedFinancialCount: empty ? 0 : 42,
      unknownCurrencyCount: 0,
      excludedForeignCurrencyCount: 0,
      invalidFinancialCount: 0,
    },
    series: Array.from({ length: monthly ? 31 : yearly ? 12 : 7 }, (_, index) => ({ key: `day-${index}`, label: monthly ? String(index + 1) : yearly ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][index]! : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index]!, appointments: empty ? 0 : index % 4, discountCents: empty ? 0 : 1000, revenueCents: empty ? 0 : 9000 })),
    services: empty ? [] : [{ name: 'Russian Manicure with French Tips & Hand-painted Nail Art', appointments: 42, revenueCents: 123456789, discountCents: 42000 }],
    technicians: empty ? [] : [{ name: 'Alexandra Marie — Senior Nail Artist', appointments: 42, revenueCents: 123456789, discountCents: 42000 }],
    recent: empty ? [] : [{ startTime: '2026-10-05T14:00:00.000Z', clientName: 'Synthetic client', serviceName: 'Russian Manicure with French Tips & Hand-painted Nail Art', technicianName: 'Alexandra Marie', subtotalCents: 10000, discountCents: 1000, finalCents: 10170, financialState: 'resolved', status: 'completed' }],
    period: monthly ? 'monthly' : yearly ? 'yearly' : 'weekly',
    anchor: '2026-10-05',
    dateRange: { start: '2026-10-04T04:00:00Z', end: '2026-10-11T04:00:00Z' },
    timezone: 'America/Toronto',
    currency: 'CAD',
  };
}

async function card(page: Page) {
  const region = page.getByRole('region', { name: 'Smart Fit results', exact: true });
  await region.scrollIntoViewIfNeeded();
  return region;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3171' ? route.continue() : route.abort());
  await page.route('**/api/admin/retention/settings?*', route => route.fulfill({ json: { data: { settings: DEFAULT_RETENTION_SETTINGS, availableServices: [] } } }));
});

test('Smart Fit results have readable text, full-size settings and long values that fit', async ({ page }, info) => {
  await page.route(endpoint, route => route.fulfill({ json: { data: report() } }));
  await page.goto('/?app=analytics&smartfit=review');
  const region = await card(page);
  const settings = region.getByRole('button', { name: 'Settings', exact: true });

  await expect(region.getByText('$1,234,567.89', { exact: true })).toBeVisible();
  await expect.poll(async () => (await settings.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  await expectReadableText(page);

  expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await settings.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('smart-fit-populated.png'), scale: 'css' });
  await settings.click();

  await expect(page).toHaveURL(/app=marketing.*view=smart-fit/);
  await expect(page.getByTestId('smart-fit-enabled')).toBeVisible();
  await expect(page.getByTestId('smart-fit-enabled')).not.toBeChecked();
});

for (const [period, buckets, visibleLabels] of [
  ['Monthly', 31, ['1', '6', '11', '16', '21', '26', '31']],
  ['Yearly', 12, ['Jan', 'Mar', 'May', 'Jul', 'Sep', 'Nov']],
] as const) {
  test(`Smart Fit keeps historical results and ${period.toLowerCase()} labels readable when off`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(endpoint, route => route.fulfill({ json: { data: report({ enabled: false, monthly: period === 'Monthly', yearly: period === 'Yearly' }) } }));
    await page.goto('/?app=analytics&smartfit=review');
    await page.getByRole('button', { name: period, exact: true }).click();
    const region = await card(page);

    await expect(region.getByText('Smart Fit is off', { exact: true })).toBeVisible();
    await expect(region.getByText('$1,234,567.89', { exact: true })).toBeVisible();
    await expect(region.getByText(/excluded from the totals/)).toBeVisible();

    const chart = region.getByRole('list', { name: 'Smart Fit appointments per period' });

    await expect(chart.getByRole('listitem')).toHaveCount(buckets);

    const labels = await chart.locator('span[aria-hidden="true"]').evaluateAll(elements => elements.map(el => ({ text: el.textContent, width: el.clientWidth, contentWidth: el.scrollWidth, fontSize: Number.parseFloat(getComputedStyle(el).fontSize), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })));

    expect(labels.map(label => label.text)).toEqual(visibleLabels);

    for (const label of labels) {
      expect(label.contentWidth).toBeLessThanOrEqual(label.width + 1);
      expect(label.fontSize).toBeGreaterThanOrEqual(12);
    }

    expect(labels.slice(1).every((label, index) => label.left >= labels[index]!.right)).toBe(true);

    await expectReadableText(page);

    expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);

    await chart.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`smart-fit-history-${period.toLowerCase()}.png`), scale: 'css' });
  });
}

test('Smart Fit loading and error recovery preserve range, truthful values and keyboard focus', async ({ page }, info) => {
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const requests: URL[] = [];
  await page.route(endpoint, async (route) => {
    requests.push(new URL(route.request().url()));
    await pending;
    await route.fulfill(requests.length === 1 ? { status: 503, json: {} } : { json: { data: report({ empty: true }) } });
  });
  await page.goto('/?app=analytics&smartfit=review');
  const region = await card(page);

  await expect(region.getByRole('status')).toHaveText('Loading Smart Fit results…');
  await expect(region.getByText('$0.00', { exact: true })).toHaveCount(0);

  finish?.();
  const retry = region.getByRole('button', { name: 'Try again', exact: true });

  await expect(retry).toBeVisible();
  await expect.poll(async () => (await retry.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  await expectReadableText(page);
  await retry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('smart-fit-retry.png'), scale: 'css' });
  await retry.focus();
  await page.keyboard.press('Enter');

  await expect(region.getByText('No Smart Fit appointments were found for this period.')).toBeVisible();
  expect(await region.evaluate(el => el.contains(document.activeElement))).toBe(true);
  expect(requests).toHaveLength(2);

  for (const url of requests) {
    expect(url.searchParams.get('salonSlug')).toBe('isla-browser');
    expect(url.searchParams.get('period')).toBe('weekly');
    expect(url.searchParams.get('anchor')).toBe('2026-10-05');
  }
  await expectReadableText(page);
});

test('Smart Fit desktop metrics use the available space without overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route(endpoint, route => route.fulfill({ json: { data: report() } }));
  await page.goto('/?app=analytics&smartfit=review');
  const region = await card(page);

  await expect(region.getByText('$1,234,567.89', { exact: true })).toBeVisible();

  const first = await region.getByText('Smart Fit appointments', { exact: true }).evaluate(el => el.parentElement!.getBoundingClientRect().toJSON());
  const second = await region.getByText('Discount given', { exact: true }).evaluate(el => el.parentElement!.getBoundingClientRect().toJSON());

  expect(first.y).toBe(second.y);
  expect(second.x).toBeGreaterThan(first.x);
  expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);

  await expectReadableText(page);
  await region.getByRole('button', { name: 'Settings', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('smart-fit-desktop.png'), scale: 'css' });
});
