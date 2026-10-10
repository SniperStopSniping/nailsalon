import { expect, test } from '@playwright/test';

import { expectReadableText } from '../assert-readable';

for (const screen of ['offer', 'salons', 'sign-in-recovery']) {
  test(`${screen} keeps owner entry copy readable`, async ({ page }) => {
    await page.goto(`/?screen=${screen}`);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await expectReadableText(page);
  });
}
