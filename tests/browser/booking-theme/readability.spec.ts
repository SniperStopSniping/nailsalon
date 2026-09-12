import { expect, test } from '@playwright/test';

import { CUSTOMER_SITE_PALETTE_PRESETS } from '../../../src/libs/customerSitePresentation';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-12T12:00:00Z'));
});

test('week navigation and full calendar preserve date selection and keyboard access', async ({ page }) => {
  await page.goto('/?count=1');
  const days = page.locator('[data-testid^="calendar-day-"]');

  await expect(days).toHaveCount(7);
  await expect(page.getByTestId('calendar-day-2026-09-11')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeDisabled();

  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByTestId('calendar-day-2026-09-19').focus();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('calendar-day-2026-09-19')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('calendar-day-2026-09-19')).toBeEnabled();

  await expect(page.getByText('Only 1 opening available')).toBeVisible();

  await page.getByRole('button', { name: 'View full calendar' }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByTestId('calendar-day-2026-10-21').click();
  await page.getByRole('button', { name: 'Show one week' }).click();

  await expect(page.getByTestId('calendar-day-2026-10-21')).toHaveAttribute('aria-pressed', 'true');
  await expect(days).toHaveCount(7);
});

test('confirmation keyboard order includes reading preferences before Back', async ({ page, browserName }) => {
  // macOS WebKit uses Option-Tab to traverse all clickable controls.
  const nextControlKey = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  await page.goto('/?step=confirm&count=1');

  await expect(page.getByRole('button', { name: 'Easier to read Off' })).toBeVisible();

  await page.keyboard.press(nextControlKey);

  await expect(page.getByRole('button', { name: 'Easier to read Off' })).toBeFocused();

  await page.keyboard.press(nextControlKey);

  const edit = page.getByRole('button', { name: 'Back', exact: true });

  await expect(edit).toBeFocused();
  await expect.poll(() => edit.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
});

for (const palette of CUSTOMER_SITE_PALETTE_PRESETS) {
  test(`${palette} reading preference carries across every booking screen and resets`, async ({ page }) => {
    await page.goto(`/?palette=${palette}&count=1`);
    const toggle = page.getByRole('button', { name: 'Easier to read Off' });
    await toggle.focus();
    await page.keyboard.press('Enter');
    for (const step of ['service', 'tech', 'time', 'confirm']) {
      await page.goto(`/?palette=${palette}&step=${step}&count=1`);

      await expect(page.getByRole('button', { name: 'Easier to read On' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-customer-booking-theme]')).toHaveAttribute('data-customer-site-palette', palette);
      await expect(page.getByRole('heading', { level: 1 }).first()).toHaveCSS('font-family', 'ui-sans-serif, system-ui, sans-serif');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      const scope = page.locator('[data-booking-readability]');

      await expect(scope).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    }
    await page.getByRole('button', { name: 'Easier to read On' }).click();
    await page.reload();

    await expect(page.getByRole('button', { name: 'Easier to read Off' })).toHaveAttribute('aria-pressed', 'false');
  });
}

for (const width of [320, 375]) {
  test(`${width}px reading mode supports long text, 200% text size, and visible focus`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/?palette=black_champagne&count=1&long=1');
    await page.getByRole('button', { name: 'Easier to read Off' }).click();
    const prep = page.getByText('Your service takes 3h 30m plus 10 minutes of preparation time.');

    await expect(prep).toBeVisible();

    const choice = page.getByTestId('time-slot-13:45');
    await page.keyboard.press('Tab');
    await choice.focus();

    await expect(choice).toHaveCSS('outline-style', 'solid');
    await expect(choice).toHaveCSS('outline-width', '3px');

    for (const day of await page.locator('.booking-week-day').all()) {
      const bounds = await day.boundingBox();

      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    await expect(page.locator('html')).toHaveCSS('font-size', '32px');

    const summary = page.getByTestId('booking-summary-card');

    await expect.poll(() => summary.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

    const serviceBounds = await page.getByTestId('booking-summary-service').boundingBox();

    expect(serviceBounds!.width).toBeGreaterThan(120);

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(prep).toBeVisible();

    await page.getByRole('button', { name: 'View full calendar' }).click();

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByTestId('calendar-day-2026-09-12')).toHaveAttribute('aria-pressed', 'true');

    const calendar = page.getByLabel('Choose an appointment date', { exact: true });
    const calendarBounds = await calendar.boundingBox();
    for (const button of await calendar.getByRole('button').all()) {
      const bounds = await button.boundingBox();

      expect(bounds!.x).toBeGreaterThanOrEqual(calendarBounds!.x);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(calendarBounds!.x + calendarBounds!.width + 1);
    }
    await page.screenshot({ path: info.outputPath(`reading-${width}-200.png`), fullPage: true, animations: 'disabled' });

    await choice.click();

    await expect.poll(() => page.locator('html').getAttribute('data-navigation')).toContain('/book/confirm');
  });
}

test('reduced motion makes opacity changes immediate without a stale transition frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?count=1');
  const summary = page.getByTestId('booking-summary-card');

  await expect(summary).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next week' })).toHaveCSS('transition-property', 'none');

  const concealed = await summary.evaluate((element) => {
    element.style.transition = 'opacity 300ms ease 100ms';
    // Force the starting computed style before reproducing the preview's
    // opacity-zero negative control in the same frame.
    const initialOpacity = getComputedStyle(element).opacity;
    element.style.opacity = '0';
    return { initialOpacity, opacity: getComputedStyle(element).opacity };
  });

  expect(concealed).toEqual({ initialOpacity: '1', opacity: '0' });
});

test('the reading preference stays usable on the confirmed receipt', async ({ page }, info) => {
  await page.goto('/?palette=black_champagne&step=confirm');
  await page.getByRole('button', { name: 'Easier to read Off' }).click();
  await page.getByRole('textbox', { name: 'Customer name' }).fill('Test Client');
  await page.getByRole('textbox', { name: 'Customer email' }).fill('client@example.test');
  await page.getByRole('textbox', { name: 'Customer phone' }).fill('4165550123');
  await page.getByRole('button', { name: /Confirm appointment/ }).click();

  await expect(page.getByTestId('booking-result-receipt')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toHaveCSS('color', 'rgb(32, 32, 32)');

  await page.getByRole('button', { name: 'Easier to read On' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('reading-receipt.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Easier to read On' }).click();

  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toHaveCSS('color', 'rgb(255, 247, 232)');
});

test('captures compact calendar and easy-reading evidence', async ({ page }, info) => {
  for (const count of [1, 3, 10, 0]) {
    await page.goto(`/?palette=luster_berry&count=${count}`);

    await expect(page.locator('[data-testid^="time-slot-"]')).toHaveCount(count);
    await expect(page.locator('[data-public-surface="timeSelectionControls"]')).toBeVisible();

    await page.screenshot({ path: info.outputPath(`calendar-${count}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.goto('/?palette=black_champagne&count=1');
  await page.getByRole('button', { name: 'Easier to read Off' }).click();

  await expect(page.getByTestId('time-slot-13:45')).toBeVisible();

  await page.screenshot({ path: info.outputPath('easy-reading.png'), fullPage: true, animations: 'disabled' });
});
