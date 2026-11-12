import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?view=adjustments');

  await expect(page.getByRole('heading', { name: 'Appointment payments preview' })).toBeVisible();
});

test('tech requests only the increase and waits for payment evidence', async ({ page }) => {
  await page.getByRole('button', { name: 'Request $20.00 payment' }).click();

  await expect(page.getByRole('button', { name: 'Request $20.00 payment' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Record payment received' })).toBeDisabled();

  await page.getByRole('button', { name: 'Simulate customer payment confirmation' }).click();

  await expect(page.getByRole('button', { name: 'Request $20.00 payment' })).toHaveCount(0);
  await expect(page.getByText('Online payment', { exact: true })).toHaveCount(2);
});

test('staff requests owner approval and refund confirmation balances the reduced bill', async ({ page }) => {
  await page.getByRole('button', { name: 'Remove a service', exact: true }).click();
  await page.getByRole('button', { name: 'Request owner refund approval' }).click();
  await page.getByLabel('Reason for refund').fill('Nail art removed');
  await page.getByRole('button', { name: 'Send for owner approval' }).click();

  await expect(page.getByText('Refund pending', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Simulate approved refund confirmation' }).click();

  await expect(page.getByText('Overpayment to resolve', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Refunded', { exact: true })).toHaveCount(2);
});

test('deposit credit and offline recording remain clear on a narrow screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Deposit paid', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Request $100.00 payment' })).toBeVisible();

  await page.getByLabel('Online requests available').uncheck();

  await expect(page.getByRole('button', { name: 'Request $100.00 payment' })).toBeDisabled();

  await page.getByRole('button', { name: 'Record payment received' }).click();

  await expect(page.getByText('Payment recorded at salon')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
