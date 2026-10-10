import { expect, test } from '@playwright/test';

import { expectReadableText } from '../assert-readable';

for (const screen of ['calendar', 'clients', 'services']) {
  test(`${screen} text has sufficient rendered contrast`, async ({ page }) => {
    await page.goto(`/?screen=${screen}`);
    const ready = screen === 'calendar'
      ? page.getByRole('button', { name: 'Next month' })
      : screen === 'clients'
        ? page.getByRole('button', { name: /SM Sofia Martin/ })
        : page.getByText('Russian Manicure', { exact: true });

    await expect(ready).toBeVisible();

    await expectReadableText(page);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
