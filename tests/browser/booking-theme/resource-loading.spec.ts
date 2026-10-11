import { expect, test } from '@playwright/test';

test('Isla prioritizes its approved hero without loading another layout renderer', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/?step=service&isla');

  const hero = page.locator('.isla-photograph-frame img');

  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute('fetchpriority', 'high');
  await expect(hero).toHaveAttribute('src', '/isla/gel-x.jpg');
  await expect(page.locator('.isla-service')).toHaveCount(3);
  expect(requests.some(url => url.includes('/QuickBookProfileHeader.tsx'))).toBe(false);
  expect(requests.some(url => url.includes('/quick-book-presentation.css'))).toBe(false);
  expect(requests.some(url => url.includes('/QuickBookPresentation.tsx'))).toBe(false);
});

test('Quick Book still loads its real renderer and styles when selected', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/?step=service&quick-book-layout=compact_dropdown');

  await expect(page.locator('.qbp-header.qbp-compact')).toBeVisible();
  expect(requests.some(url => url.includes('/QuickBookProfileHeader.tsx'))).toBe(true);
  expect(requests.some(url => url.includes('/quick-book-presentation.css'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Our Services', exact: true })).toBeVisible();
});
