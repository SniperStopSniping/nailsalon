import { expect, test } from '@playwright/test';

import { expectReadableText } from '../assert-readable';

const fontCases = [
  { name: 'standalone', query: '', display: 'Luster Onboarding Display', sans: 'Luster Onboarding Sans', unused: ['Shared Inter', 'Shared Newsreader'] },
  { name: 'shared', query: '&productFonts=1', display: 'Shared Newsreader', sans: 'Shared Inter', unused: ['Luster Onboarding Sans', 'Luster Onboarding Display'] },
];

for (const width of [320, 390, 430]) {
  for (const fonts of fontCases) {
    test(`starter previews keep readable prices and ${fonts.name} fonts at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/?startup=1${fonts.query}`);
      const heading = page.getByRole('heading', { name: 'Choose your starting point' });

      await expect(heading).toBeVisible();

      await page.evaluate(() => document.fonts.ready);

      await expect(heading).toHaveCSS('font-family', new RegExp(fonts.display));
      await expect(page.locator('.onboarding-app')).toHaveCSS('font-family', new RegExp(fonts.sans));

      // Cover every service-price label, even when its animated scene is off
      // screen. Axe alone only samples the currently visible animation frame.
      const labels = page.locator('.final-starter-preview__poster-items small, .final-starter-preview__service-list small');

      expect(await labels.count()).toBeGreaterThan(0);

      const colors = await labels.evaluateAll(elements => elements.map(element => getComputedStyle(element).color));
      for (const color of colors) {
        const rgb = color.match(/[\d.]+/gu)!.slice(0, 3).map(Number).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        const luminance = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
        // Preview labels sit on white/cream cards. Check a darker cream too,
        // so the translucent white background cannot hide a contrast failure.
        const creamLuminance = 0.89;

        expect((creamLuminance + 0.05) / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
      }

      const loadedFamilies = await page.evaluate(() => Array.from(document.fonts).filter(font => font.status === 'loaded').map(font => font.family));

      expect(loadedFamilies.filter(family => fonts.unused.includes(family))).toEqual([]);

      await expectReadableText(page);

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.screenshot({ path: info.outputPath('starter-previews.png'), fullPage: true });

      await page.getByRole('button', { name: 'Start with Quick Book' }).click();

      await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Salon or studio name *', exact: true })).toBeVisible();
    });
  }
}
