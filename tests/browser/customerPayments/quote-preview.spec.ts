import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

// Cold local Vite compiles the full existing stylesheet, without app DB/provider access.
test.setTimeout(90_000);

function quoted(tipCents: number, expiry = 300000) {
  return { data: { quoteId: 'mock-quote', fingerprint: 'a'.repeat(64), expiresAt: new Date(Date.now() + expiry).toISOString(), testOnly: true, collectionEnabled: false, executable: false, currency: 'CAD', servicesCents: 10500, discountCents: 0, taxCents: 1365, tipCents, customerFeeCents: 0, totalCents: 11865 + tipCents, dueNowCents: 11865 + tipCents, remainingCents: 0 } };
}
async function transport(page: Page) {
  const requests: Array<{ requestId: string; tipCents: number }> = [];
  const external: string[] = [];
  let drop = false;
  let stale = false;
  let expiry = 300000;
  let held: Promise<void> | null = null;
  let release = () => {};
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      external.push(url.href);
      await route.abort();
      return;
    }
    if (!url.pathname.endsWith('/payment-quote')) {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON();
    requests.push(body);
    if (held) {
      await held;
      held = null;
    }
    if (drop) {
      drop = false;
      await route.abort('failed');
    } else if (stale) {
      stale = false;
      await route.fulfill({ status: 409, json: { error: { code: 'QUOTE_REVIEW_REQUIRED' } } });
    } else {
      await route.fulfill({ json: quoted(body.tipCents, expiry) });
    }
  });
  return { requests, external, interrupt: () => {
    drop = true;
  }, conflict: () => {
    stale = true;
  }, expireSoon: () => {
    expiry = 1800;
  }, hold: () => {
    held = new Promise<void>((done) => {
      release = done;
    });
  }, release: () => release() };
}
async function open(page: Page) {
  await page.goto('/?view=quote');

  await expect(page.getByRole('button', { name: 'Prepare test quote' })).toBeEnabled();
}

test('explicit mock quote has no automatic request, retries interrupted request with same identity', async ({ page }) => {
  const mock = await transport(page);
  await open(page);

  expect(mock.requests).toHaveLength(0);

  mock.interrupt();
  await page.getByRole('button', { name: 'Prepare test quote' }).click();

  await expect(page.getByRole('button', { name: 'Retry same quote request' })).toBeEnabled();
  await expect(page.getByLabel('Custom tip (CAD)')).toBeDisabled();

  await page.getByRole('button', { name: 'Retry same quote request' }).click();

  await expect(page.getByText('Preview total: $118.65')).toBeVisible();
  expect(mock.requests[1]).toEqual(mock.requests[0]);
  await expect(page.getByRole('button', { name: /pay now|secure payment/i })).toHaveCount(0);
  expect(mock.external).toEqual([]);
});

test('repeated clicks do not create duplicate requests and edited tip discards late response', async ({ page }) => {
  const mock = await transport(page);
  await open(page);
  mock.hold();
  await page.getByRole('button', { name: 'Prepare test quote' }).dblclick();

  await expect(page.getByRole('button', { name: 'Preparing test quote…' })).toBeDisabled();

  await page.getByLabel('Custom tip (CAD)').fill('5.25');

  expect(mock.requests).toHaveLength(1);

  mock.release();

  await expect(page.getByRole('button', { name: 'Prepare test quote' })).toBeEnabled();
  await expect(page.getByText('Preview total: $118.65')).toHaveCount(0);

  await page.getByRole('button', { name: 'Prepare test quote' }).click();

  await expect(page.getByText('Preview total: $123.90')).toBeVisible();
  expect(mock.requests[1]!.requestId).not.toBe(mock.requests[0]!.requestId);

  await page.getByText('Tax and fee explanation').click();

  await expect(page.getByText('Tax · Salon, for tax authority')).toBeVisible();

  const body = page.locator('body');

  await expect(body).toHaveJSProperty('scrollWidth', await body.evaluate(el => el.clientWidth));

  await page.screenshot({ path: `/tmp/luster-customer-quote-${test.info().project.name}.png`, fullPage: true });

  expect(mock.external).toEqual([]);
});

test('expired quote disappears and source conflict requires a new review', async ({ page }) => {
  const mock = await transport(page);
  await open(page);
  mock.expireSoon();
  await page.getByRole('button', { name: 'Prepare test quote' }).click();

  await expect(page.getByText('Preview total: $118.65')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('expired');
  await expect(page.getByText('Preview total: $118.65')).toHaveCount(0);

  mock.conflict();
  await page.getByRole('button', { name: 'Prepare test quote' }).click();

  await expect(page.getByRole('alert')).toContainText('appointment details changed');

  await page.getByRole('button', { name: 'Prepare test quote' }).click();

  await expect(page.getByText('Preview total: $118.65')).toBeVisible();
  expect(mock.requests[2]!.requestId).not.toBe(mock.requests[1]!.requestId);
  expect(mock.requests[1]!.requestId).not.toBe(mock.requests[0]!.requestId);
  expect(mock.external).toEqual([]);
});
