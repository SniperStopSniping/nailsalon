import { expect, test } from '@playwright/test';

for (const width of [360, 390, 430, 768, 1024, 1440]) {
  test(`homepage layout and controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width >= 1100 ? 900 : 844 });
    await page.goto('/');
    const build = page.getByRole('link', { name: 'Build Your Booking Page', exact: true });
    const login = page.getByRole('link', { name: 'Log In', exact: true });
    const carousel = page.getByRole('region', { name: 'Explore Luster', exact: true });

    await expect(build).toHaveAttribute('href', '/onboarding-v1');
    await expect(login).toHaveAttribute('href', '/owner-sign-in');
    await expect(page.getByRole('link', { name: 'Shop Luster Gel', exact: true })).toHaveAttribute('href', 'https://lustergel.ca/shop');
    await expect(page.locator('h1')).toHaveText('Manage your salon, book clients, and grow your business.');
    await expect(page.locator('h1')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const buildBox = await build.boundingBox();
    const loginBox = await login.boundingBox();
    const previewBox = await carousel.boundingBox();

    expect(buildBox!.height).toBeGreaterThanOrEqual(52);
    expect(loginBox!.height).toBeGreaterThanOrEqual(52);

    if (width < 1100) {
      expect(loginBox!.y).toBeGreaterThan(buildBox!.y + buildBox!.height);
      expect(previewBox!.y).toBeGreaterThan(loginBox!.y + loginBox!.height);
      expect(buildBox!.width).toBe(loginBox!.width);

      await page.getByRole('button', { name: 'Open menu', exact: true }).click();

      await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toBeFocused();

      await page.getByRole('button', { name: 'Open menu', exact: true }).press('Enter');
      await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Features', exact: true }).click();

      await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden();
      await expect(page).toHaveURL(/#features$/);
    } else {
      expect(loginBox!.y).toBe(buildBox!.y);
      expect(previewBox!.x).toBeGreaterThan(loginBox!.x);
      await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toBeHidden();
    }
    await page.getByRole('button', { name: 'Next preview', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Easy booking for your clients.', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Show preview 4: Less chasing. More showing up.', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Less chasing. More showing up.', exact: true })).toBeVisible();
    await expect(page.getByText('SMS reminders use optional paid credits.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Next preview', exact: true }).press('Enter');

    await expect(page.getByRole('heading', { name: 'Your booking page, your style.', exact: true })).toBeVisible();
    await expect(build).toHaveAttribute('href', '/onboarding-v1');
    await expect(login).toHaveAttribute('href', '/owner-sign-in');
    expect((await carousel.boundingBox())!.height).toBe(previewBox!.height);
  });
}

test('touch swipe changes only the product preview', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP touch injection is Chromium-only; WebKit controls and geometry run above.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#home-preview-track').scrollIntoViewIfNeeded();
  const box = await page.locator('#home-preview-track').boundingBox();
  const client = await page.context().newCDPSession(page);
  const y = box!.y + 160;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 340, y }] });
  for (const x of [300, 240, 180, 120, 50]) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(page.getByRole('heading', { name: 'Easy booking for your clients.', exact: true })).toBeVisible();
});

test('reduced motion, enlarged text and all product images remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  for (let index = 1; index <= 4; index++) {
    await page.getByRole('button', { name: new RegExp(`^Show preview ${index}:`) }).click();
    const slide = page.getByRole('group', { name: new RegExp(`^${index} / 4:`) });

    await expect(slide).toBeVisible();
    await expect.poll(async () => slide.locator('img').evaluateAll(images => images.filter(image => image.getBoundingClientRect().width > 0).every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
