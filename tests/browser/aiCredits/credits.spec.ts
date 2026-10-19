import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

const purchaseId = '98f1e8de-fd2e-4a63-a5c7-c66e9d0d2751';
async function fixture(page: Page, options: { pending?: boolean; loseFirst?: boolean; purchases?: boolean } = {}) {
  let failed = false;
  let paid = false;
  let reconciles = 0;
  const requests: any[] = [];
  await page.route('**/api/admin/ai-credits**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill({ json: { purchasesEnabled: options.purchases !== false, data: { availableMicroCad: paid ? 20_000_000 : 10_000_000, reservedMicroCad: 0, debtMicroCad: 0, pendingPurchase: options.pending && !paid ? { id: purchaseId, packKey: 'ai_10_cad_v1', canManage: true } : null, history: [{ id: 'history', kind: 'usage', amountMicroCad: -15000, createdAt: '2026-10-17T12:00:00Z' }] } } });
    }
    const body = request.postDataJSON();
    requests.push(body);
    if (body.action === 'checkout') {
      if (options.loseFirst && !failed) {
        failed = true;
        return route.abort('failed');
      }
      return route.fulfill({ json: { data: { status: 'ready', purchaseId, url: 'https://checkout.stripe.com/c/pay/synthetic' } } });
    }
    reconciles++;
    paid = reconciles >= 2;
    return route.fulfill({ json: { data: { status: paid ? 'paid' : 'pending', purchaseId } } });
  });
  return requests;
}

test('credit dialog fits phones, supports keyboard access and makes the scope clear', async ({ page }, info) => {
  await fixture(page);
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'AI credits · $10.00' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Bring your ideas to life.' });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Ordinary bookings and manual editing/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '$10.00 CAD · one-time Start here' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close AI credits' })).toBeFocused();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  for (const button of await dialog.locator('.ai-credit-packs > button').all()) {
    const box = (await button.boundingBox())!;
    const price = (await button.locator('strong').boundingBox())!;

    expect(price.x).toBeGreaterThanOrEqual(box.x + 5);
    expect(price.x + price.width).toBeLessThanOrEqual(box.x + box.width - 5);
  }

  const directory = path.resolve('artifacts/ai-credits/interface');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${info.project.name}.png`), fullPage: true });
  await page.keyboard.press('Shift+Tab');

  expect(await page.evaluate(() => document.querySelector('[role=dialog]')?.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');

  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('lost checkout response and reload reuse the same purchase request', async ({ page }) => {
  const requests = await fixture(page, { loseFirst: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI credits · $10.00' }).click();
  await page.getByRole('button', { name: '$10.00 CAD · one-time Start here' }).click();

  await expect(page.getByRole('alert')).toBeVisible();

  const first = requests[0].operationId;
  await page.reload();
  await page.getByRole('button', { name: 'AI credits · $10.00' }).click();
  await page.getByRole('button', { name: '$10.00 CAD · one-time Start here' }).click();

  await expect(page.getByText(/Verified Stripe checkout redirect/)).toBeVisible();
  expect(requests[1].operationId).toBe(first);
  expect(requests[1]).not.toHaveProperty('amountCents');
});

test('returning from checkout checks payment and updates the verified balance without another checkout', async ({ page }) => {
  const requests = await fixture(page, { pending: true });
  await page.goto(`/?salon=synthetic&credits=success&purchase=${purchaseId}`);

  await expect(page.getByText('Checking your payment…')).toBeVisible();
  await expect(page.getByText('Payment confirmed. Your credit balance is updated.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI credits · $20.00' })).toBeVisible();
  expect(requests.map(request => request.action)).toEqual(['reconcile', 'reconcile']);
  expect(new URL(page.url()).searchParams.has('purchase')).toBe(false);
});

test('turning purchases off preserves the balance and credit history', async ({ page }) => {
  const requests = await fixture(page, { purchases: false });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI credits · $10.00' }).click();

  await expect(page.getByText(/Credit purchases are not available yet/)).toBeVisible();
  await expect(page.getByRole('button', { name: '$10.00 CAD · one-time Start here' })).toHaveCount(0);

  await page.getByText('Credit history').click();

  await expect(page.getByText('AI changes')).toBeVisible();
  expect(requests).toEqual([]);
});
