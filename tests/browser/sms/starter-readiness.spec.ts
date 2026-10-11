import { expect, test } from '@playwright/test';
import axe from 'axe-core';

type AxeRuntime = typeof axe;

test('mobile readiness explains the paused claims, stays readable and only reads data', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const methods: string[] = [];
  await page.route('**/api/super-admin/billing/starter-identity-readiness', async (route) => {
    methods.push(route.request().method());
    await route.fulfill({ json: { data: { keysReady: true, totalClaims: 12000, missingEmail: 3, missingPhone: 8, purgedClaims: 1, ready: false, newClaimsEnabled: false } } });
  });
  await page.goto('/?fixture=starter-readiness');
  const panel = page.getByRole('region', { name: 'Free-text claims' });

  await expect(panel.getByText('New claims paused')).toBeVisible();
  await expect(panel.getByText(/Earlier allowances need verified contact links/)).toBeVisible();
  await expect(panel.getByText('12,000')).toBeVisible();

  const refresh = panel.getByRole('button', { name: 'Refresh report' });
  const box = await refresh.boundingBox();

  expect(box?.height).toBeGreaterThanOrEqual(44);

  await refresh.click();

  await expect(refresh).toBeEnabled();
  expect(methods).toEqual(['GET', 'GET']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  await page.addScriptTag({ content: axe.source });
  const accessibility = await page.evaluate(async () => (window as typeof window & { axe: AxeRuntime }).axe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));

  expect(accessibility.violations).toEqual([]);

  await page.screenshot({ path: testInfo.outputPath('starter-readiness-mobile.png'), fullPage: true, scale: 'css' });
});

test('a failed readiness report recovers without exposing stale or invented counts', async ({ page }) => {
  let fail = true;
  await page.route('**/api/super-admin/billing/starter-identity-readiness', async (route) => {
    expect(route.request().method()).toBe('GET');

    if (fail) {
      await route.fulfill({ status: 503, json: { error: { message: 'Internal detail' } } });
      return;
    }
    await route.fulfill({ json: { data: { keysReady: true, totalClaims: 0, missingEmail: 0, missingPhone: 0, purgedClaims: 0, ready: true, newClaimsEnabled: true } } });
  });
  await page.goto('/?fixture=starter-readiness');

  await expect(page.getByRole('status')).toContainText('could not be checked');
  await expect(page.getByText('Historical allowances')).toHaveCount(0);
  await expect(page.getByText('Internal detail')).toHaveCount(0);

  fail = false;
  await page.getByRole('button', { name: 'Refresh report' }).click();

  await expect(page.getByRole('status')).toContainText('New claims enabled');
  await expect(page.getByText('Historical allowances')).toBeVisible();
});
