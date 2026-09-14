import { expect, test } from '@playwright/test';

import { CUSTOMER_SITE_PALETTE_PRESETS } from '../../../src/libs/customerSitePresentation';

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(value => value / 255);
    const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const palette of CUSTOMER_SITE_PALETTE_PRESETS) {
  test(`${palette} key booking text meets 4.5:1`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-12T12:00:00Z'));
    await page.goto(`/?palette=${palette}&count=1`);

    await expect(page.locator('[data-booking-readability]')).toHaveAttribute('data-booking-readability', 'standard');
    await expect(page.getByTestId('time-slot-13:45')).toBeVisible();

    const pairs = await page.evaluate(() => {
      const sample = (text: string, ground = text) => ({
        text,
        foreground: getComputedStyle(document.querySelector(text)!).color,
        background: getComputedStyle(document.querySelector(ground)!).backgroundColor,
      });
      return [
        sample('#availability-heading', '[data-public-surface="timeSelectionControls"]'),
        sample('.booking-preparation p', '.booking-preparation'),
        sample('[data-testid="booking-summary-duration"]', '[data-testid="booking-summary-card"]'),
        sample('[data-testid="booking-step-marker-confirm"]'),
        sample('[data-testid="calendar-day-2026-09-12"]'),
        sample('[data-testid="time-slot-13:45"]'),
      ];
    });
    for (const pair of pairs) {
      expect(contrast(pair.foreground, pair.background), `${palette}: ${pair.text}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
