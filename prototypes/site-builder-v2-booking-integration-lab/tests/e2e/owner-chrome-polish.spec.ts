import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import axe from 'axe-core';

type AxeRuntime = typeof axe;

const STORAGE_KEY = 'luster:onboarding-v1-lab';
const screens = [
  ['business', '.onboarding-your-business-screen'],
  ['starting_preview', '.onboarding-starting-preview-screen'],
  ['location_contact', '.onboarding-location-contact-screen'],
  ['hours', '.onboarding-hours-screen'],
  ['booking_preferences', '.onboarding-booking-preferences-screen'],
  ['about', '[data-screen="about"]'],
  ['about_design', '[data-screen="about_design"]'],
  ['policies', '[data-screen="policies"]'],
  ['site_style', '[data-screen="site_style"]'],
  ['save_progress', '[data-screen="save_progress"]'],
  ['booking_layout', '[data-screen="booking_layout"]'],
  ['final_preview', '[data-screen="final_preview"]'],
] as const;

for (const width of [320, 390, 430, 1280]) {
  test(`Luster owner chrome stays consistent at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto('/?audit=1');

    await expect(page.locator('.onboarding-starter-entry__brand .onboarding-brand-mark')).toBeVisible();

    await page.getByRole('button', { name: 'Start with Quick Book' }).click();
    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Lab review options' }).click();
    await page.getByRole('dialog', { name: 'Lab review options' }).getByRole('button', { name: 'Daniela / Isla Nail Studio', exact: true }).click();

    await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

    for (const [screen, selector] of screens) {
      await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

      // This saved-state hop is confined to the disposable lab fixture. It
      // covers each real screen's chrome without claiming live signup success.
      await page.evaluate(({ key, screen }) => {
        const state = JSON.parse(localStorage.getItem(key)!);
        // Booking layout is an intentional Quick Book-only branch.
        if (screen === 'booking_layout') {
          state.recipe.starter = 'quick_book';
        }
        state.progress.currentScreen = screen;
        state.progress.lastActiveScreen = screen;
        localStorage.setItem(key, JSON.stringify(state));
      }, { key: STORAGE_KEY, screen });
      await page.reload();

      await expect(page.locator(selector)).toBeVisible();

      await expectReadableText(page);

      await expect(page.locator('.onboarding-shell__brand .onboarding-brand-mark')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(page.locator('.onboarding-shell__content h1').first()).toBeVisible();
      await expect(page.locator('.onboarding-shell__content h1').first()).toHaveCSS('font-family', /Luster Onboarding Display/);
      await expect(page.locator('.onboarding-app')).toHaveCSS('--onboarding-ground', '#fcf3f2');
      await expect(page.locator('.onboarding-app')).toHaveCSS('--onboarding-focus', '#8f3155');

      const actions = page.locator('.sticky-onboarding-actions > button:visible');
      for (const action of await actions.all()) {
        expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
}

// The standalone lab is ESM; its test helper stays inside this package.
async function expectReadableText(page: Page) {
  await page.addScriptTag({ content: axe.source });
  await page.evaluate(() => document.fonts.ready);

  // Entrance animations and colour transitions can be mid-frame when the
  // content becomes visible. Retry the real audit, without disabling styles.
  await expect(async () => {
    const violations = await page.evaluate(async () => {
      const audit = await (window as typeof window & { axe: AxeRuntime }).axe.run(document.body, {
        runOnly: { type: 'rule', values: ['color-contrast'] },
      });
      return audit.violations.flatMap(violation => violation.nodes.map(node => ({
        target: node.target,
        summary: node.failureSummary,
      })));
    });

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }).toPass({ timeout: 5000, intervals: [250, 500] });
}
