import { expect, test } from '@playwright/test';

import { expectReadableText } from '../assert-readable';

test('Reports keeps mobile data readable and its Back action reachable', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?reports=populated');
  await page.getByRole('button', { name: 'analytics', exact: true }).click();
  const report = page.getByRole('dialog', { name: 'Reports', exact: true });

  await expect(report.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await expect(report.getByText('$1,234,567.89').first()).toBeVisible();
  await expect(report.getByRole('button', { name: 'Weekly', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const back = report.getByRole('button', { name: 'Back', exact: true });

  await expect.poll(async () => (await back.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect.poll(async () => (await report.getByRole('button', { name: 'Monthly', exact: true }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect.poll(async () => (await back.boundingBox())?.y ?? 1000).toBeLessThan(100);

  await expectReadableText(page);
  await page.screenshot({ path: testInfo.outputPath('reports-mobile.png'), scale: 'css' });
  await report.getByRole('button', { name: 'Monthly', exact: true }).click();

  await expect(report.getByRole('button', { name: 'Monthly', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await report.getByRole('button', { name: 'October 2026', exact: true }).click();
  await report.getByLabel('Jump to date').fill('2026-09-14');

  await expect(report.getByRole('button', { name: 'September 2026', exact: true })).toBeVisible();

  await report.getByRole('button', { name: 'Today', exact: true }).click();

  await expect(report.getByRole('button', { name: 'October 2026', exact: true })).toBeVisible();

  await report.getByRole('button', { name: 'Previous period', exact: true }).click();

  await expect(report.getByRole('button', { name: 'September 2026', exact: true })).toBeVisible();

  await report.getByRole('button', { name: 'Next period', exact: true }).click();

  await expect(report.getByRole('button', { name: 'October 2026', exact: true })).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('reports-mobile.png'), scale: 'css' });
  const services = report.getByRole('region', { name: 'Top services', exact: true });
  await services.scrollIntoViewIfNeeded();

  await expect(services.getByText('Russian Manicure with French Tips & Hand-painted Nail Art')).toBeVisible();

  const utilization = report.getByRole('region', { name: 'Utilization', exact: true });

  await expect(utilization.getByText('72%')).toHaveCount(1);
  await expect(back).toBeVisible();
  await expect.poll(async () => (await back.boundingBox())?.y ?? 1000).toBeLessThan(100);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[role="dialog"] *')].filter(el => el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible').map(el => ({ tag: el.tagName, text: el.textContent?.slice(0, 100), className: el.getAttribute('class'), width: el.clientWidth, content: el.scrollWidth })))).toEqual([]);

  await back.click();

  await expect(report).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'analytics', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test('Reports empty state and keyboard date recovery work with reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?app=analytics');
  const report = page.getByRole('dialog', { name: 'Reports', exact: true });

  await expect(report.getByText('No prior data')).toBeVisible();
  await expect(report.getByText('No staff data available')).toHaveCount(1);
  await expect(report.getByRole('button', { name: 'View All Staff' })).toHaveCount(0);

  const date = report.getByRole('button', { name: 'Oct 5 - Oct 11, 2026', exact: true });
  await date.click();
  await report.getByLabel('Jump to date').focus();
  await page.keyboard.press('Escape');

  await expect(report).toBeVisible();
  await expect(date).toBeFocused();
  await expect(date).toHaveAttribute('aria-expanded', 'false');
  await expect(report.getByLabel('Jump to date')).toHaveCount(0);

  await expectReadableText(page);
  await page.screenshot({ path: testInfo.outputPath('reports-empty-mobile.png'), scale: 'css' });
  await report.getByRole('button', { name: 'Back', exact: true }).click();

  await expect(report).toHaveCount(0);
});
