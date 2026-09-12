import { expect, test } from '@playwright/test';

import { CUSTOMER_SITE_PALETTE_PRESETS, getCustomerSitePresentationCssVariables } from '../../../src/libs/customerSitePresentation';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-12T12:00:00Z'));
});

for (const palette of CUSTOMER_SITE_PALETTE_PRESETS) {
  test(`${palette} follows the client through service, artist, time and confirmation`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const tokens = getCustomerSitePresentationCssVariables({ palettePreset: palette, stylePreset: 'modern' });
    for (const step of ['service', 'tech', 'time', 'confirm']) {
      await page.goto(`/?palette=${palette}&step=${step}&count=1`);
      const scope = page.locator('[data-customer-booking-theme]');

      await expect(scope).toHaveAttribute('data-customer-site-palette', palette);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

      const observed = await scope.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          ground: style.getPropertyValue('--theme-background').trim(),
          confirmationGround: style.getPropertyValue('--n5-bg-page').trim(),
          foreground: style.getPropertyValue('--booking-brand-foreground').trim(),
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });

      expect(observed).toEqual({
        ground: tokens['--theme-background'],
        confirmationGround: tokens['--theme-background'],
        foreground: tokens['--booking-brand-foreground'],
        overflow: false,
      });
    }

    await page.goto(`/?palette=${palette}&count=1`);
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
    const opening = page.getByTestId('time-slot-13:45');

    await expect(opening).toHaveCSS('background-color', rgb(tokens['--booking-brand-primary']!));
    await expect(opening).toHaveCSS('color', rgb(tokens['--booking-brand-foreground']!));
    await expect(page.getByTestId('calendar-day-2026-09-12')).toHaveCSS('color', rgb(tokens['--booking-brand-foreground']!));
    await expect(page.getByTestId('booking-summary-duration')).toHaveCSS('color', rgb(tokens['--booking-summary-foreground']!));

    expect(errors).toEqual([]);
  });
}

for (const width of [320, 375]) {
  for (const count of [0, 1, 3, 10]) {
    test(`${width}px ${count} available times stay readable and selectable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/?palette=black_champagne&count=${count}&long=1`);
      const choices = page.locator('[data-testid^="time-slot-"]');

      await expect(choices).toHaveCount(count);
      await expect(page.getByRole('button', { name: '11:00 AM' })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      if (count === 0) {
        // Preserve the existing initial next-day lookup when today is empty.
        await expect(page.getByRole('heading', { name: /^No openings on / })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Choose another date' })).toBeEnabled();
      } else {
        await expect(page.getByText('Your service takes 3h 30m plus 10 minutes of preparation time.')).toBeVisible();

        const first = choices.first();
        const bounds = await first.boundingBox();

        expect(bounds?.height).toBeGreaterThanOrEqual(44);

        await first.focus();

        await expect(first).toBeFocused();

        await first.press('Enter');

        await expect.poll(() => page.locator('html').getAttribute('data-navigation')).toContain('/book/confirm');
      }
    });
  }
}

test('captures owner-review evidence for the current palettes', async ({ page }, testInfo) => {
  for (const [palette, count] of [['luster_berry', 1], ['navy_ivory', 3], ['sage_stone', 10], ['black_champagne', 0]] as const) {
    await page.goto(`/?palette=${palette}&count=${count}`);

    await expect(page.locator('[data-testid^="time-slot-"]')).toHaveCount(count);
    await expect(page.locator('[data-public-surface="timeSelectionControls"]')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath(`${palette}-${count}.png`), fullPage: true, animations: 'disabled' });
  }
});

test('the confirmed receipt retains the chosen palette', async ({ page }, testInfo) => {
  await page.goto('/?palette=black_champagne&step=confirm');
  await page.getByRole('textbox', { name: 'Customer name' }).fill('Test Client');
  await page.getByRole('textbox', { name: 'Customer email' }).fill('client@example.test');
  await page.getByRole('textbox', { name: 'Customer phone' }).fill('4165550123');
  const confirm = page.getByRole('button', { name: /Confirm appointment/ });

  await expect(confirm).toHaveCSS('background-color', 'rgb(225, 194, 126)');
  await expect(confirm).toHaveCSS('color', 'rgb(33, 26, 22)');

  await page.screenshot({ path: testInfo.outputPath('black-champagne-confirm.png'), fullPage: true, animations: 'disabled' });
  await confirm.click();

  await expect(page.getByTestId('booking-result-receipt')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toHaveCSS('color', 'rgb(255, 247, 232)');
  await expect(page.locator('[data-customer-booking-theme]')).toHaveAttribute('data-customer-site-palette', 'black_champagne');

  await page.screenshot({ path: testInfo.outputPath('black-champagne-receipt.png'), fullPage: true, animations: 'disabled' });
});
