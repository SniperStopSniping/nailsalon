import { expect, test } from '@playwright/test';

import { appPath, e2eConfig } from './support/config';

test.describe('I18n', () => {
  test.describe('Language Switching', () => {
    test('should display the default locale booking page', async ({ page }) => {
      await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.getByRole('heading', { name: /choose your service/i })).toBeVisible();
    });

    test('should display the French locale booking route', async ({ page }) => {
      await page.goto(`/fr/book/service?salonSlug=${e2eConfig.salonSlug}`, {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.getByRole('heading', { name: /choose your service/i })).toBeVisible();
    });
  });
});
