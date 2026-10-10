import { expect, test } from '@playwright/test';

import { expectReadableText } from '../assert-readable';

test('Today and More retain readable text across owner surfaces', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Today', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Sofia Martin', { exact: true })).toBeVisible();

  await expectReadableText(page);
  await page.getByRole('tab', { name: 'More', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Booking', exact: true })).toBeVisible();

  await expectReadableText(page);
});
