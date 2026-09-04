import { expect, type Page } from '@playwright/test';

import { e2eConfig } from './config';

/** Check the canonical Quick Book identity and usable catalog, not retired step copy. */
export async function expectBookingServicePageReady(page: Page): Promise<void> {
  const main = page.getByRole('main');

  await expect(main).toHaveCount(1);
  await expect(main.getByRole('heading', {
    level: 1,
    name: e2eConfig.salonName,
    exact: true,
  })).toBeVisible();

  const service = main.getByTestId(`service-card-${e2eConfig.serviceId}`);

  await expect(service).toBeVisible();
  await expect(service).toContainText(e2eConfig.serviceName);
  // The server renders service buttons disabled until booking state hydrates.
  await expect(service).toBeEnabled();
}
