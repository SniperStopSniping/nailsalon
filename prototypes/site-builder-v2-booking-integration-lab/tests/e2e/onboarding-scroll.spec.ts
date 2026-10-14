import { expect, test } from '@playwright/test';

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`onboarding bars stay joined while scrolling at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?audit=1');
    await page.getByRole('button', { name: 'Start with Quick Book' }).click();

    await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeVisible();

    await page.evaluate(() => document.fonts.ready);
    // Exercise intrinsic height changes, including large text and the extra
    // top padding used by a phone's safe area. The progress bar must follow
    // the actual header height rather than its original 62px minimum.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
      const header = document.querySelector<HTMLElement>('.onboarding-shell__header')!;
      header.style.paddingTop = '32px';
    });

    for (const height of [viewport.height, viewport.height - 80, viewport.height]) {
      // Model the browser toolbar expanding and collapsing during a gesture.
      await page.setViewportSize({ width: viewport.width, height });
      for (const top of [0, 80, 260, 500, 180, 20, 0]) {
        await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), top);

        await expect.poll(() => page.evaluate(() => {
          const header = document.querySelector('.onboarding-shell__header')!.getBoundingClientRect();
          const progress = document.querySelector('.onboarding-shell__progress')!.getBoundingClientRect();
          return Math.max(Math.abs(header.top), Math.abs(progress.top - header.bottom));
        })).toBeLessThan(1);
      }
    }

    await page.getByRole('button', { name: 'More onboarding options' }).click();

    await expect(page.getByRole('menuitem', { name: 'Save and finish later' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: 'More onboarding options' })).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Onboarding progress' })).toBeVisible();
  });
}
