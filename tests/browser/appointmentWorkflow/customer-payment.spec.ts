import { expect, test } from '@playwright/test';

test('customer reviews the deposit-adjusted balance and policy before one payment request', async ({ page }, testInfo) => {
  const commands: Record<string, unknown>[] = [];
  const unexpected: string[] = [];
  const view = { initialized: false, revision: 0, invoiceHash: 'a'.repeat(64), canPay: true, needsReview: false, totalCents: 13300, paidCents: 2000, depositCreditCents: 2000, balanceCents: 11300, overpaidCents: 0, policy: { revision: 1, cancellationPolicy: 'Contact your salon before cancelling. Any refund is reviewed against your original payment.' }, activePayment: null as unknown };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (!request.url().endsWith('/manage/synthetic-browser-private-booking/payments')) {
      unexpected.push(request.url());
      return route.fulfill({ status: 404, json: {} });
    }
    if (request.method() === 'POST') {
      commands.push(request.postDataJSON());
      view.initialized = true;
      view.revision = 2;
      view.canPay = false;
      view.activePayment = { id: '11111111-1111-4111-8111-111111111111', state: 'open', canResume: true };
      return route.fulfill({ json: { data: view, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_browser' } });
    }
    return route.fulfill({ json: { data: view } });
  });
  await page.goto('/?customerPayment=1');

  await expect(page.getByRole('heading', { name: 'Appointment payment' })).toBeVisible();
  await expect(page.getByText('Deposit included above')).toBeVisible();

  const pay = page.getByRole('button', { name: 'Pay $113.00 online' });

  await expect(pay).toBeDisabled();

  await page.getByRole('checkbox').check();
  await pay.click();

  await expect(page.getByRole('link', { name: 'Continue to secure payment' })).toHaveAttribute('href', 'https://checkout.stripe.com/c/pay/cs_test_browser');
  await expect(page.getByText(/A payment request is already open/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay $113.00 online' })).toHaveCount(0);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ kind: 'request_payment', expectedRevision: 0, acceptedPolicyRevision: 1, expectedInvoiceHash: 'a'.repeat(64) });
  expect(commands[0]).not.toHaveProperty('amountCents');
  expect(unexpected).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: testInfo.outputPath(`customer-payment-${testInfo.project.name}.png`), fullPage: true });
});
