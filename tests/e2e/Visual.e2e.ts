import percySnapshot from '@percy/playwright';
import { expect, type Page, test } from '@playwright/test';

import { e2eConfig } from './support/config';
import { expectBookingServicePageReady } from './support/service-page';

async function snapshotIfConfigured(page: Page, name: string) {
  if (!process.env.PERCY_TOKEN) {
    return;
  }

  await percySnapshot(page, name);
}

test.describe('Visual testing', () => {
  test.describe('Static pages', () => {
    test('should render the booking service page for visual coverage', async ({ page }) => {
      const response = await page.goto(`/book/service?salonSlug=${e2eConfig.salonSlug}`, {
        waitUntil: 'domcontentloaded',
      });

      expect(response?.status()).toBe(200);

      await expectBookingServicePageReady(page);

      await snapshotIfConfigured(page, 'Booking Service');
    });
  });
});
