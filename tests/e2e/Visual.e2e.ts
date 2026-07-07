import percySnapshot from '@percy/playwright';
import { expect, type Page, test } from '@playwright/test';

import { e2eConfig } from './support/config';

async function snapshotIfConfigured(page: Page, name: string) {
  if (!process.env.PERCY_TOKEN) {
    return;
  }

  await percySnapshot(page, name);
}

test.describe('Visual testing', () => {
  test.describe('Static pages', () => {
    test('should render the booking service page for visual coverage', async ({ page }) => {
      await page.goto(`/book/service?salonSlug=${e2eConfig.salonSlug}`, {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.getByRole('heading', { name: /choose your service/i })).toBeVisible();

      await snapshotIfConfigured(page, 'Booking Service');
    });
  });
});
