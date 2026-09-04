import { expect, test } from '@playwright/test';

import { assertLocalAcceptanceEnvironment } from './safety';

assertLocalAcceptanceEnvironment(process.env);

for (const width of [320, 375, 390, 430, 768, 1180, 1440]) {
  test(`Quick Book entry stays usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ height: 844, width });
    await page.goto('/onboarding-v1');
    await page.getByRole('button', { name: /Start with Quick Book$/ }).click();

    await expect(page.getByRole('heading', { name: 'Let’s start with your business', exact: true })).toBeVisible();

    const primary = page.getByRole('button', { name: 'Show me my site →', exact: true });
    await primary.scrollIntoViewIfNeeded();

    await expect(primary).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    expect(overflow).toBeLessThanOrEqual(1);
  });
}
