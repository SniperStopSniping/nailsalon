import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`starting choices defer later design and auth modules at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const loaded: string[] = [];
    page.on('request', request => loaded.push(new URL(request.url()).pathname));
    await page.goto('/?startup=1');

    await expect(page.getByRole('heading', { name: 'Choose your starting point' })).toBeVisible();
    // Observe actual module requests rather than assuming lazy() split the graph.
    expect(loaded.filter(url => /\/(?:DesignScreens|OnboardingSitePreview|AccountGate)\.tsx$/u.test(url))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Start with Quick Book' }).click();

    await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('luster:onboarding-v1-lab')!).recipe.starter)).toBe('quick_book');

    await page.reload();

    await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeVisible();
  });
}
