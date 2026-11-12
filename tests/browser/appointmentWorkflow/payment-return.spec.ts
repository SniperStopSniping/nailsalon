import { expect, test } from '@playwright/test';

test('customer return waits for verified status and shows refund history without another payment action', async ({ page }, testInfo) => {
  const requests: unknown[] = [];
  const unexpected: string[] = [];
  let received = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/api/public/payments/status') && request.method() === 'POST') {
      requests.push(request.postDataJSON());
      return route.fulfill({ json: { data: { status: received ? 'received' : 'pending', currency: 'CAD', amountCents: 11300, refundedCents: received ? 2300 : 0 } } });
    }
    unexpected.push(request.url());
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/?paymentReturn=1&result=success#status=synthetic-browser-status-capability');

  await expect(page.getByText('$113.00 CAD')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  await expect(page.getByText(/do not pay again/)).toBeVisible();
  await expect(page.getByRole('link')).toHaveCount(0);

  received = true;
  await page.getByRole('button', { name: 'Refresh payment status' }).click();

  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible();
  await expect(page.getByText('$23.00 CAD')).toBeVisible();
  await expect(page.getByText('You can close this page.')).toBeVisible();
  expect(requests.every(body => JSON.stringify(body) === JSON.stringify({ token: 'synthetic-browser-status-capability' }))).toBe(true);
  expect(unexpected).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: testInfo.outputPath(`payment-return-${testInfo.project.name}.png`), fullPage: true });
});
