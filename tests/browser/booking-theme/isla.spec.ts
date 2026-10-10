import { expect, test } from '@playwright/test';

for (const width of [320, 390, 430, 768, 1440]) {
  test(`Isla custom presentation preserves booking selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?step=service&isla');

    await expect(page.locator('.isla-headline')).toHaveText('Your nextbeautiful set.');
    await expect(page.getByRole('link', { name: 'Manage my booking' }).first()).toHaveAttribute('href', '/en/isla-nail-studio/find-booking');
    await expect(page.getByRole('navigation', { name: 'Booking progress' })).not.toContainText('Artist');
    await expect(page.locator('.isla-service')).toHaveCount(3);

    const moreServices = page.getByRole('button', { name: 'View 3 more manicure services', exact: true });

    await moreServices.scrollIntoViewIfNeeded();

    await expect(moreServices).toHaveCSS('color', 'rgb(49, 49, 45)');
    await expect(moreServices).toHaveCSS('border-top-style', 'solid');
    await expect(moreServices).toHaveCSS('font-weight', '600');

    const buttonBounds = await moreServices.boundingBox();
    const menuBounds = await page.locator('.isla-menu').boundingBox();

    expect(buttonBounds!.height).toBeGreaterThanOrEqual(50);
    expect(buttonBounds!.width).toBeCloseTo(menuBounds!.width, 0);

    await moreServices.focus();

    await expect(moreServices).toHaveCSS('outline-style', 'solid');

    await page.screenshot({ path: test.info().outputPath(`more-services-${width}.png`) });
    await moreServices.press('Enter');

    await expect(page.locator('.isla-service')).toHaveCount(6);
    await expect(moreServices).toHaveCount(0);

    await page.getByTestId('service-card-isla-russian').click();
    await page.getByRole('button', { name: 'Add French finish', exact: true }).click();

    await expect(page.getByTestId('service-sticky-price')).toHaveText('$45');
    await expect(page.getByTestId('service-auto-technician-preview')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove French finish', exact: true })).toHaveCSS('background-color', 'rgb(49, 49, 45)');
    await expect(page.getByTestId('service-sticky-duration')).toHaveText('50 min');
    await expect(page.getByRole('navigation', { name: 'Booking progress' })).not.toContainText('Artist');

    await page.getByRole('button', { name: 'Choose a time', exact: true }).click();

    await expect(page.locator('html')).toHaveAttribute('data-navigation', /\/isla-nail-studio\/book\/time\?.*baseServiceId=isla-russian/);

    const next = await page.locator('html').getAttribute('data-navigation');

    expect(new URL(next!, 'https://example.test').searchParams.get('selectedAddOns')).toContain('isla-extra');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const heroImage = page.locator('.isla-photograph-frame img');

    expect(await heroImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await page.locator('.isla-headline').evaluate(node => getComputedStyle(node).fontFamily)).toContain('Isla Cormorant');

    if (width <= 760) {
      expect(await heroImage.evaluate(node => getComputedStyle(node).borderRadius)).toBe('9px');

      const hero = await page.locator('.isla-hero').boundingBox();
      const title = await page.locator('#isla-services-title').boundingBox();

      expect(title!.y).toBeGreaterThan(hero!.y + hero!.height);
    }
  });
}

test('categories, search and policy controls work without replacing the service engine', async ({ page }) => {
  // The footer must respect the salon's enabled policy and service-page
  // placement. Explicitly configure both instead of relying on fallback copy.
  await page.goto('/?step=service&isla&service-policy=visible');
  await page.getByRole('button', { name: 'Pedicure', exact: true }).click();

  await expect(page.getByTestId('service-card-isla-pedi')).toBeVisible();

  await page.getByRole('button', { name: 'Search services', exact: true }).click();
  await page.getByPlaceholder('Search services...').fill('Gel-X');

  await expect(page.getByTestId('service-card-isla-extensions')).toBeVisible();
  await expect(page.getByTestId('service-card-isla-pedi')).toHaveCount(0);

  await page.getByRole('button', { name: 'Booking policies', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Appointment agreement' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Changes or cancellations must be made at least 24 hours before your appointment.');

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog', { name: 'Appointment agreement' })).toHaveCount(0);
});

for (const { policyState, policyQuery } of [
  { policyState: 'absent', policyQuery: '' },
  { policyState: 'hidden', policyQuery: '&service-policy=hidden' },
  { policyState: 'disabled', policyQuery: '&service-policy=disabled' },
]) {
  test(`Isla does not expose ${policyState} service-page policy content`, async ({ page }) => {
    await page.goto(`/?step=service&isla${policyQuery}`);

    await expect(page.getByTestId('service-card-isla-russian')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Booking policies', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Appointment agreement' })).toHaveCount(0);
    await expect(page.getByText('Please arrive on time.', { exact: false })).toHaveCount(0);
  });
}

test('Isla preserves the canonical required-acknowledgment policy rule', async ({ page }) => {
  await page.goto('/?step=service&isla&service-policy=required');
  await page.getByRole('button', { name: 'Booking policies', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Appointment agreement' })).toContainText('Please arrive on time.');
});

test('other salon pages retain their existing presentation', async ({ page }) => {
  await page.goto('/?step=service&quick-book-layout=brand_artist_centered');

  await expect(page.locator('.isla-page')).toHaveCount(0);
  await expect(page.locator('.qbm-header')).toBeVisible();
});

for (const width of [320, 390, 1440]) {
  test(`Isla reads configured social links without overflow at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?step=service&isla&socials=updated');

    const studioLinks = page.getByRole('navigation', { name: 'Studio links' });
    const galleryLinks = page.getByRole('navigation', { name: 'Salon social links' });
    const instagram = 'https://www.instagram.com/abcdefghijklmnopqrstuvwxyz1234/';

    await expect(studioLinks.getByRole('link', { name: 'Isla Nail Studio on Instagram' })).toHaveAttribute('href', instagram);
    await expect(galleryLinks.getByRole('link', { name: 'Isla Nail Studio on Instagram' })).toHaveAttribute('href', instagram);
    await expect(galleryLinks).toContainText('@abcdefghijklmnopqrstuvwxyz1234');
    await expect(galleryLinks.getByRole('link', { name: 'Isla Nail Studio on Facebook' })).toHaveAttribute('href', 'https://www.facebook.com/isla.contract.fixture');
    await expect(galleryLinks.getByRole('link', { name: 'Isla Nail Studio on TikTok' })).toHaveAttribute('href', 'https://www.tiktok.com/@isla.contract.fixture');
    await expect(page.locator('.isla-photograph-frame img')).toHaveAttribute('src', '/isla/gel-x.jpg');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await galleryLinks.getByRole('link', { name: 'Isla Nail Studio on Facebook' }).focus();
    // macOS WebKit includes links in keyboard traversal with Option-Tab.
    await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');

    await expect(galleryLinks.getByRole('link', { name: 'Isla Nail Studio on TikTok' })).toBeFocused();

    await page.addStyleTag({ content: '.isla-studio-socials a { font-size: 22px; letter-spacing: 0.12em; }' });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const visibleLinks = await galleryLinks.getByRole('link').all();
    for (const link of visibleLinks) {
      const bounds = await link.boundingBox();

      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    }
  });
}

test('cleared Isla profiles stay absent while booking and approved gallery remain', async ({ page }) => {
  await page.goto('/?step=service&isla&socials=cleared');

  await expect(page.getByRole('navigation', { name: 'Salon social links' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Isla Nail Studio on / })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Manage my booking' })).toHaveCount(2);
  await expect(page.locator('.isla-gallery-grid img')).toHaveCount(3);
  await expect(page.getByTestId('service-card-isla-russian')).toBeVisible();
});
