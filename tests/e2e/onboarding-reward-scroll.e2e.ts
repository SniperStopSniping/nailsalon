import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`account reward reaches its customer footer at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/onboarding/v1/slug-availability', async (route) => {
      const { slug } = route.request().postDataJSON() as { slug: string };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: { available: true, reason: 'available', slug } }),
      });
    });
    await page.goto('/en/onboarding-v1');
    await page.getByRole('button', { name: 'Start with Quick Book' }).click();
    await page.getByLabel('Salon or studio name *', { exact: true }).fill('Scroll Test Studio');
    await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Independent nail tech/u }) }).click();
    await page.getByLabel('Your name *', { exact: true }).fill('Test Owner');
    await page.getByRole('button', { name: 'Show me my site →', exact: true }).click();
    await page.getByRole('button', { name: 'Continue setting up my site', exact: true }).click();
    await page.getByLabel('City *', { exact: true }).fill('Toronto');
    await page.getByLabel('Full address *', { exact: true }).fill('100 Test Street');
    const contact = page.locator('[aria-controls="onboarding-contact-card-panel"]');
    await contact.click();
    await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Online booking only/u }) }).click();
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await page.getByRole('button', { name: 'Apply to selected days', exact: true }).click();
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await page.getByRole('button', { name: 'Use this look', exact: true }).click();

    await expect(page.getByRole('heading', { name: /Your site is coming together/u })).toBeVisible();

    const thumb = page.locator('.onboarding-gate__thumb');
    const frame = thumb.locator('.onboarding-preview-frame');
    await thumb.scrollIntoViewIfNeeded();

    await expect.poll(async () => {
      const box = await thumb.boundingBox();
      const content = await frame.boundingBox();
      return Boolean(box && content && content.y + content.height <= box.y + box.height + 1);
    }).toBe(true);

    await frame.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    await expect.poll(async () => {
      const host = await thumb.boundingBox();
      const footer = await frame.locator('.onboarding-customer-footer').boundingBox();
      return Boolean(host && footer && footer.y >= host.y && footer.y + footer.height <= host.y + host.height + 1);
    }).toBe(true);
    expect(await frame.evaluate(element => element.scrollTop > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const outerScroll = await page.evaluate(() => ({
      top: scrollY,
      maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    }));
    await frame.hover();
    await page.mouse.wheel(0, 500);

    await expect.poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThanOrEqual(Math.min(outerScroll.top + 1, outerScroll.maximum));

    await page.getByRole('button', { name: 'Continue with email', exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Continue with email', exact: true }).click();

    await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  });
}
