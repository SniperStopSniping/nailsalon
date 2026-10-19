import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

test('AI enrollment preserves the two manual choices and secondary full editor', async ({ page }, info) => {
  await page.goto('/?startup=1&aiBuilder=1');

  await expect(page.getByRole('heading', { name: 'Choose your starting point' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start with Quick Book/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Use my Canva design/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start with AI/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start with AI/ })).toHaveCSS('opacity', '1');
  await expect(page.getByRole('button', { name: /Start with Full Website/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await mkdir(path.resolve('artifacts/ai-credits/entry'), { recursive: true });
  await page.screenshot({ path: path.resolve(`artifacts/ai-credits/entry/choices-${info.project.name}.png`), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Set up manually' }).click();

  await expect(page.getByRole('heading', { name: 'Choose your starting point' })).toBeHidden();
});

test('the real intro and account-entry components fit phones and select the correct saved business', async ({ page }, info) => {
  const requests: unknown[] = [];
  await page.route('**/api/admin/business-setup/entry', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: requests.length === 1 ? { kind: 'choose', salons: [{ slug: 'salon-a', name: 'Studio A' }, { slug: 'salon-b', name: 'Studio B' }] } : { kind: 'ready', slug: 'salon-b' } } });
  });
  await page.goto('/?startup=1&aiIntro=1');

  await expect(page.getByRole('heading', { name: /Your business/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Build with AI · from $10 CAD' })).toHaveAttribute('href', '/en/ai-website?account=sign-up');
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await mkdir(path.resolve('artifacts/ai-credits/entry'), { recursive: true });
  await page.screenshot({ path: path.resolve(`artifacts/ai-credits/entry/intro-${info.project.name}.png`), fullPage: true, animations: 'disabled' });
  await page.goto('/?startup=1&aiIntro=1&aiOwner=1');

  await expect(page.getByRole('link', { name: 'Build with AI · from $10 CAD' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Continue to my AI builder' }).click();
  await page.getByRole('button', { name: 'Studio B' }).click();

  await expect(page.locator('body')).toHaveAttribute('data-ai-destination', '/en/admin/business-setup?salon=salon-b');
  expect(requests).toEqual([{}, { salonSlug: 'salon-b' }]);
});
