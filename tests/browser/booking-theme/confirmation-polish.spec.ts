import { expect, test } from '@playwright/test';

import { CUSTOMER_SITE_PALETTE_PRESETS } from '../../../src/libs/customerSitePresentation';

for (const palette of CUSTOMER_SITE_PALETTE_PRESETS) {
  test(`${palette} confirmation has readable labels and usable inputs`, async ({ page }) => {
    await page.goto(`/?step=confirm&palette=${palette}`);
    const name = page.getByRole('textbox', { name: 'Customer name' });

    await expect(name).toBeVisible();

    await name.focus();

    await expect(name).toHaveCSS('outline-style', 'solid');
    await expect(page.getByTestId('booking-receipt-when')).toContainText('1:45 PM');
    await expect(page.getByTestId('booking-receipt-services')).toContainText('Russian Manicure');
    await expect(page.getByText('Not booked yet. Confirm below to reserve your time.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    await expect(page.locator('main > div').first().locator('svg')).toHaveCount(0);

    const colors = await page.locator('.booking-confirm-page').evaluate((element) => {
      const style = getComputedStyle(element);
      return { primary: style.getPropertyValue('--n5-ink-main').trim(), secondary: style.getPropertyValue('--n5-ink-muted').trim() };
    });

    expect(colors.secondary).toBe(colors.primary);

    const inputColor = await name.evaluate(element => getComputedStyle(element).color);

    await expect(page.getByRole('heading', { name: 'Your contact details' })).toHaveCSS('color', inputColor);
  });
}

for (const width of [320, 375, 1280]) {
  test(`${width}px confirmation reflows and preserves the booking gate`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?step=confirm&palette=luster_berry');
    const confirm = page.getByRole('button', { name: /Confirm appointment/ });

    await expect(confirm).toBeDisabled();

    await page.getByRole('textbox', { name: 'Customer name' }).fill('Review Guest');
    await page.getByRole('textbox', { name: 'Customer email' }).fill('review@example.com');
    await page.getByRole('textbox', { name: 'Customer phone' }).fill('4165550100');

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));

    await expect.poll(() => page.locator('main [style*="opacity"]').evaluateAll(elements => elements.every(element => getComputedStyle(element).opacity === '1'))).toBe(true);

    await page.screenshot({ path: info.outputPath(`confirmation-${width}.png`), fullPage: true });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('synthetic confirmed receipt shows the next-booking prompt and opens its server-provided handoff', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?step=confirm&palette=luster_berry&rebooking');

  await page.getByRole('textbox', { name: 'Customer name' }).fill('Review Guest');
  await page.getByRole('textbox', { name: 'Customer email' }).fill('review@example.com');
  await page.getByRole('textbox', { name: 'Customer phone' }).fill('4165550100');
  await page.getByRole('button', { name: /Confirm appointment/ }).click();

  await expect(page.getByTestId('booking-result-receipt')).toContainText('Appointment confirmed');
  await expect(page.getByRole('region', { name: 'Why not book your next visit now?' })).toContainText('We recommend visiting every 3 weeks.');
  await expect(page.getByText('Secure your next spot now.')).toBeVisible();

  await page.getByRole('button', { name: 'Book my next appointment' }).click();

  await expect.poll(() => page.locator('html').getAttribute('data-navigation')).toBe('/en/theme-fixture/book/time?serviceIds=service-fixture&techId=tech-fixture');
  await expect.poll(() => page.locator('html').getAttribute('data-next-booking-request')).toContain('/api/public/appointments/manage/private-token/next-booking?locale=en');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const status of ['confirmed', 'pending'] as const) {
  test(`${status} receipt arrives at its heading and keeps detailed booking information`, async ({ page, browserName }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/?step=confirm&palette=luster_berry&receipt-details${status === 'pending' ? '&pending' : ''}`);
    await page.getByRole('textbox', { name: 'Customer name' }).fill('Fictional Receipt Guest');
    await page.getByRole('textbox', { name: 'Customer email' }).fill('receipt@example.invalid');
    await page.getByRole('textbox', { name: 'Customer phone' }).fill('4165550100');
    const submit = page.getByRole('button', { name: /Confirm appointment/ });

    await submit.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await submit.click();

    const heading = page.getByTestId('booking-result-heading');
    await expect(heading).toHaveText(status === 'confirmed' ? 'Appointment confirmed' : 'Request received');
    await expect(heading).toBeFocused();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThanOrEqual(1);
    await expect(heading).toBeInViewport();
    await expect(page.getByTestId('booking-receipt-when')).toContainText('1:45 PM');
    await expect(page.getByTestId('booking-receipt-services')).toContainText('Russian Manicure');
    await expect(page.getByTestId('booking-receipt-add-ons')).toContainText('Simple Nail Art x2 · $10');
    await expect(page.getByTestId('booking-receipt-add-ons')).not.toContainText('Russian Manicure:');
    await expect(page.getByTestId('booking-result-receipt')).toContainText('$55');
    await expect(page.getByTestId('booking-result-receipt')).toContainText('1h 5m');
    await expect(page.getByTestId('booking-result-receipt')).toContainText('100 Demo Lane, Toronto');
    await expect(page.getByTestId('booking-success-celebration')).toHaveCount(status === 'confirmed' ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Google Calendar', exact: true })).toHaveCount(status === 'confirmed' ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Apple Calendar', exact: true })).toHaveCount(status === 'confirmed' ? 1 : 0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`receipt-${status}.png`), fullPage: true });

    // macOS WebKit skips links with plain Tab unless full keyboard access is
    // enabled; Option-Tab includes links in the native navigation sequence.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    const manage = page.getByRole('link', { name: status === 'confirmed' ? 'Manage this appointment' : 'Manage this request', exact: true });
    await expect(manage).toBeFocused();
    await expect(manage).toHaveCSS('outline-style', 'solid');
    // CSS text enlargement exercises reflow; this is not a physical-device or
    // native browser text-size setting verification.
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
