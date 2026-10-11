import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`starting choices defer later design and auth modules at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const loaded: string[] = [];
    page.on('request', request => loaded.push(new URL(request.url()).pathname));
    await page.goto('/?startup=1');

    await expect(page.getByRole('heading', { name: 'Choose your starting point' })).toBeVisible();
    // Observe actual module requests rather than assuming lazy() split the graph.
    expect(loaded.filter(url => /\/(?:DesignScreens|OnboardingSitePreview|AccountGate|HoursScreen|LocationContactScreen|LabReviewOptions)\.tsx$/u.test(url))).toEqual([]);
    expect(loaded.filter(url => /\/onboarding\/fixtures(?:\/index\.ts)?$/u.test(url))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Start with Quick Book' }).click();

    await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('luster:onboarding-v1-lab')!).recipe.starter)).toBe('quick_book');

    await page.reload();

    await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeVisible();
  });
}

for (const [step, heading, moduleName] of [
  ['hours', 'When are you open?', 'HoursScreen'],
  ['location_contact', 'Where can clients find you?', 'LocationContactScreen'],
] as const) {
  test(`saved ${step} step loads on demand and survives reload`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const loaded: string[] = [];
    page.on('request', request => loaded.push(new URL(request.url()).pathname));
    await page.goto(`/?startup=1&resume=${step}`);

    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(loaded.some(url => url.endsWith(`/${moduleName}.tsx`))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.reload();

    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('luster:onboarding-v1-lab')!).profile.businessName)).toBe('Isla Nail Studio');

    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Choose your starting point' })).toBeVisible();
  });
}

test('a failed hours download offers recovery and preserves the draft', async ({ page }) => {
  await page.route('**/HoursScreen.tsx', route => route.abort(), { times: 1 });
  await page.goto('/?startup=1&resume=hours');

  await expect(page.getByRole('alert')).toContainText('We couldn’t load this part of setup.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('luster:onboarding-v1-lab')!).profile.businessName)).toBe('Isla Nail Studio');

  await page.getByRole('button', { name: 'Reload setup' }).click();

  await expect(page.getByRole('heading', { name: 'When are you open?', exact: true })).toBeVisible();
});
