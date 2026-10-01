import { expect, type Locator, test } from '@playwright/test';

import { getColorContrastRatio } from '../../../src/libs/bookingExperience';
import { CUSTOMER_SITE_PALETTE_PRESETS } from '../../../src/libs/customerSitePresentation';

async function primaryButtonContrast(control: Locator, property: 'color' | 'outline-color' = 'color') {
  const colors = await control.evaluate((element, foregroundProperty) => {
    const style = getComputedStyle(element);
    const toHex = (rgb: string) => `#${(rgb.match(/\d+/g) ?? []).slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
    return { background: toHex(style.backgroundColor), foreground: toHex(style.getPropertyValue(foregroundProperty)) };
  }, property);
  return getColorContrastRatio(colors.background, colors.foreground);
}

async function renderedContrast(control: Locator, property = 'color') {
  const colors = await control.evaluate((element, foregroundProperty) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const composite = (foreground: number[], background: number[]) => {
      const alpha = foreground[3]! / 255;
      return background.slice(0, 3).map((channel, index) => foreground[index]! * alpha + channel * (1 - alpha));
    };
    const layers: number[][] = [];
    let node: Element | null = element;
    while (node) {
      layers.unshift(rgba(getComputedStyle(node).backgroundColor));
      node = node.parentElement;
    }
    const background = layers.reduce((surface, layer) => composite(layer, surface), [255, 255, 255]);
    const foreground = composite(rgba(getComputedStyle(element).getPropertyValue(foregroundProperty)), background);
    const hex = (channels: number[]) => `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
    return { background: hex(background), foreground: hex(foreground) };
  }, property);
  return getColorContrastRatio(colors.background, colors.foreground);
}

async function expectReadableText(elements: Locator, minimumSize: number) {
  expect(await elements.count()).toBeGreaterThan(0);

  for (const element of await elements.all()) {
    expect(await renderedContrast(element), (await element.textContent()) ?? '').toBeGreaterThanOrEqual(4.5);
    expect(await element.evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(minimumSize);
  }
}

for (const palette of CUSTOMER_SITE_PALETTE_PRESETS) {
  test(`${palette} confirmation has readable labels and usable inputs`, async ({ page }) => {
    await page.goto(`/?step=confirm&palette=${palette}`);
    const name = page.getByRole('textbox', { name: 'Customer name' });

    await expect(name).toBeVisible();

    await name.focus();

    await expect(name).toHaveCSS('outline-style', 'solid');
    expect(await primaryButtonContrast(name, 'outline-color')).toBeGreaterThanOrEqual(3);
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
    await expect(page.getByTestId('booking-receipt-total')).toHaveCSS('color', inputColor);
    await expect(page.getByTestId('booking-receipt-duration')).toHaveCSS('color', inputColor);

    await name.fill('Fictional Palette Guest');
    await page.getByLabel('Customer email').fill('palette@example.invalid');
    await page.getByLabel('Customer phone').fill('4165550100');
    const confirm = page.getByRole('button', { name: /Confirm appointment/ });

    await expect(confirm).toBeEnabled();
    expect(await primaryButtonContrast(confirm)).toBeGreaterThanOrEqual(4.5);

    await expectReadableText(page.locator('.booking-review-summary p, .booking-review-summary li'), 14);
    const changeSelection = page.getByRole('button', { name: 'Change time or services', exact: true });

    expect(await renderedContrast(changeSelection)).toBeGreaterThanOrEqual(4.5);
    expect(await renderedContrast(name, 'border-top-color')).toBeGreaterThanOrEqual(3);
    await expect(name).toHaveCSS('font-size', '16px');

    await confirm.click();

    await expect(page.getByTestId('booking-result-heading')).toBeVisible();
    await expect.poll(() => page.locator('main [style*="opacity"]').evaluateAll(elements => elements.every(element => getComputedStyle(element).opacity === '1'))).toBe(true);

    await expectReadableText(page.locator('.booking-review-summary p, .booking-review-summary li'), 14);
    await expectReadableText(page.locator('main a, main button'), 14);
    await expectReadableText(page.locator('[data-booking-avatar-fallback] span'), 14);

    expect(await renderedContrast(page.getByTestId('booking-success-celebration').locator('svg'))).toBeGreaterThanOrEqual(3);

    const title = page.getByRole('heading', { name: 'Appointment summary', exact: true });
    const titleBox = (await title.boundingBox())!;
    const priceBox = (await page.getByTestId('booking-receipt-total').boundingBox())!;
    const titleLineHeight = await title.evaluate(element => Number.parseFloat(getComputedStyle(element).lineHeight));

    expect(titleBox.height).toBeLessThanOrEqual(titleLineHeight + 1);
    expect(priceBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  });
}

for (const theme of ['espresso', 'lavender', 'pastel', 'lavender&page-theme=espresso', 'espresso&page-theme=lavender', 'lavender&custom-appearance']) {
  test(`${theme} legacy-theme review and management buttons have readable contrast`, async ({ page }) => {
    await page.goto(`/?step=confirm&legacy-theme=${theme}`);
    await page.getByLabel('Customer name').fill('Fictional Theme Guest');
    await page.getByLabel('Customer email').fill('theme@example.invalid');
    await page.getByLabel('Customer phone').fill('4165550100');
    const confirm = page.getByRole('button', { name: /Confirm appointment/ });

    await expect(confirm).toBeEnabled();
    expect(await primaryButtonContrast(confirm)).toBeGreaterThanOrEqual(4.5);

    await confirm.click();
    const manage = page.getByRole('link', { name: 'Manage this appointment', exact: true });

    await expect(manage).toBeVisible();
    expect(await primaryButtonContrast(manage)).toBeGreaterThanOrEqual(4.5);
  });
}

for (const { color, rgb } of [
  { color: '#000000', rgb: 'rgb(0, 0, 0)' },
  { color: '#FFFFFF', rgb: 'rgb(255, 255, 255)' },
  { color: '#D6A249', rgb: 'rgb(214, 162, 73)' },
]) {
  test(`${color} custom-primary-only buttons keep their paired background and foreground`, async ({ page }) => {
    await page.goto(`/?step=confirm&legacy-theme=espresso&primary-color=${encodeURIComponent(color)}`);
    await page.getByLabel('Customer name').fill('Fictional Brand Guest');
    await page.getByLabel('Customer email').fill('brand@example.invalid');
    await page.getByLabel('Customer phone').fill('4165550100');
    const confirm = page.getByRole('button', { name: /Confirm appointment/ });

    await expect(confirm).toBeEnabled();
    await expect(confirm).toHaveCSS('background-color', rgb);
    expect(await primaryButtonContrast(confirm)).toBeGreaterThanOrEqual(4.5);

    await confirm.click();
    const manage = page.getByRole('link', { name: 'Manage this appointment', exact: true });

    await expect(manage).toBeVisible();
    await expect(manage).toHaveCSS('background-color', rgb);
    expect(await primaryButtonContrast(manage)).toBeGreaterThanOrEqual(4.5);
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

    if (status === 'confirmed') {
      expect(await page.getByTestId('booking-receipt-when').evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('[data-testid="booking-success-celebration"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    }

    await expect(page.getByRole('link', { name: 'Google Calendar', exact: true })).toHaveCount(status === 'confirmed' ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Apple Calendar', exact: true })).toHaveCount(status === 'confirmed' ? 1 : 0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => page.locator('main [style*="opacity"]').evaluateAll(elements => elements.every(element => getComputedStyle(element).opacity === '1'))).toBe(true);

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

    await expect(page.getByRole('heading', { name: 'Appointment summary', exact: true })).toHaveCSS('overflow-wrap', 'anywhere');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.screenshot({ path: info.outputPath(`receipt-${status}-text-200.png`), fullPage: true });
  });
}

for (const theme of ['espresso', 'lavender', 'pastel']) {
  test(`${theme} missing-management recovery remains readable`, async ({ page }) => {
    await page.goto(`/?step=confirm&legacy-theme=${theme}&missing-management`);
    await page.getByLabel('Customer name').fill('Fictional Recovery Guest');
    await page.getByLabel('Customer email').fill('recovery@example.invalid');
    await page.getByLabel('Customer phone').fill('4165550100');
    await page.getByRole('button', { name: /Confirm appointment/ }).click();
    const recovery = page.getByRole('link', { name: 'Find my booking to receive a secure management link', exact: true });

    await expect(recovery).toBeVisible();
    await expect(recovery).toHaveCSS('text-decoration-line', 'underline');
    expect(await renderedContrast(recovery)).toBeGreaterThanOrEqual(4.5);
  });
}

test('320px receipt supports enlarged text and user text-spacing without clipping controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?step=confirm&legacy-theme=espresso&receipt-details');
  await page.getByLabel('Customer name').fill('Fictional Spacing Guest');
  await page.getByLabel('Customer email').fill('spacing@example.invalid');
  await page.getByLabel('Customer phone').fill('4165550100');
  await page.getByRole('button', { name: /Confirm appointment/ }).click();

  await expect(page.getByTestId('booking-result-heading')).toBeVisible();

  await page.addStyleTag({ content: 'html { font-size: 200% !important; } .booking-confirm-page * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } .booking-confirm-page p { margin-bottom: 2em !important; }' });

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  for (const control of await page.locator('main a, main button').all()) {
    const box = (await control.boundingBox())!;

    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
    expect(await control.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
});
