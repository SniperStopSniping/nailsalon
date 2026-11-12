import { expect, test } from '@playwright/test';

test('owner opt-in, no-tip, disclosure, deposit and back work without live calls', async ({ page }) => {
  const externalRequests: string[] = [];
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') {
      externalRequests.push(route.request().url());
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Test setup', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Pay online' })).toBeDisabled();

  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save test setup' }).click();

  await expect(page.getByRole('status')).toHaveText('Test setup saved for this page only. Nothing is live.');

  await page.getByRole('radio', { name: 'Pay online' }).check();
  await page.getByLabel('Custom tip (CAD)').fill('5');

  await expect(page.getByText('Due now: $123.65')).toBeVisible();

  await page.getByRole('button', { name: 'No tip', exact: true }).click();

  await expect(page.getByText('Due now: $118.65')).toBeVisible();

  await page.getByText('ⓘ Tax and fee breakdown').click();

  await expect(page.getByText('Recipient: Salon, for tax authority')).toBeVisible();

  await page.getByRole('button', { name: 'Continue to secure payment' }).click();

  await expect(page.getByRole('status')).toHaveText('Rehearsal complete. No payment or booking was made.');

  await page.getByLabel('Booking payment policy').selectOption('required_deposit');

  await expect(page.getByRole('radio', { name: 'Pay in person' })).toBeDisabled();
  await expect(page.getByText('Due now: $20.00')).toBeVisible();
  await expect(page.getByText('Remaining at the salon: $98.65')).toBeVisible();

  await page.getByRole('button', { name: 'Back', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('Back selected. No booking or payment was made.');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(el => el.clientWidth));

  await page.screenshot({ path: `/tmp/luster-payments-${test.info().project.name}.png`, fullPage: true });

  expect(externalRequests).toEqual([]);
});
