import { expect, test } from '@playwright/test';

import { expectReadableText } from '../assert-readable';

const viewports = [
  { width: 320, height: 640 },
  { width: 320, height: 360 },
  { width: 390, height: 844 },
  { width: 430, height: 844 },
  { width: 667, height: 375 },
  { width: 1280, height: 900 },
];

for (const viewport of viewports) {
  for (const fonts of ['standalone', 'shared']) {
    test(`setup progress remains readable with ${fonts} fonts at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/?startup=1&resume=site_style${fonts === 'shared' ? '&productFonts=1' : ''}`);

      await expect(page.getByRole('heading', { name: 'Choose your look' })).toBeVisible();

      await page.evaluate(() => document.fonts.ready);

      const progress = page.getByRole('navigation', { name: 'Onboarding progress' });
      const stages = progress.locator('li');

      await expect(stages).toHaveCount(5);
      await expect(progress.locator('[data-stage="basics"]')).toHaveAttribute('data-stage-state', 'complete');
      await expect(progress.locator('[data-stage="style"]')).toHaveAttribute('aria-current', 'step');
      await expect(progress.locator('[data-stage="booking"]')).toHaveAttribute('data-stage-state', 'upcoming');

      const geometry = await stages.evaluateAll(elements => elements.map((element) => {
        const label = element.querySelector('span:not([aria-hidden]):not(.visually-hidden)')!;
        const style = getComputedStyle(label);
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { text: label.textContent, fontSize: Number.parseFloat(style.fontSize), transform: style.textTransform, labelLeft: text.left, labelRight: text.right, left: box.left, right: box.right, top: box.top };
      }));

      expect(geometry.map(item => item.text)).toEqual(['Basics', 'Style', 'Booking', 'Design', 'Review']);

      for (const item of geometry) {
        expect(item.fontSize, `${item.text} uses readable type`).toBeGreaterThanOrEqual(13);
        expect(item.transform).toBe('none');
        expect(item.labelLeft, `${item.text} stays inside its stage`).toBeGreaterThanOrEqual(item.left - 1);
        expect(item.labelRight, `${item.text} is not clipped or overlapping`).toBeLessThanOrEqual(item.right + 1);
      }

      expect(Math.max(...geometry.map(item => item.top)) - Math.min(...geometry.map(item => item.top))).toBeLessThanOrEqual(1);

      const counter = page.locator('.onboarding-essentials-counter');

      await expect(counter).toContainText('required');
      expect(await counter.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);

      await expectReadableText(page);

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await info.attach('progress-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
      await page.screenshot({ path: info.outputPath('setup-progress.png'), fullPage: false });

      await page.reload();

      await expect(progress.locator('[aria-current="step"]')).toHaveAttribute('data-stage', 'style');

      await page.getByRole('button', { name: 'Back', exact: true }).click();

      await expect(progress.locator('[aria-current="step"]')).toHaveAttribute('data-stage', 'basics');
      await expect(page.getByRole('heading', { name: 'When are you open?' })).toBeVisible();
    });
  }
}

for (const viewport of [{ width: 320, height: 360 }, { width: 390, height: 844 }, { width: 667, height: 375 }]) {
  test(`larger setup progress leaves invalid business fields reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?startup=1&productFonts=1');
    await page.getByRole('button', { name: 'Start with Quick Book' }).click();
    await page.getByRole('button', { name: /Show me my site/ }).click();

    const name = page.getByRole('textbox', { name: 'Salon or studio name *', exact: true });

    await expect(name).toBeFocused();

    const bounds = await name.evaluate((element) => {
      const field = element.getBoundingClientRect();
      const header = document.querySelector('.onboarding-shell__header')!.getBoundingClientRect();
      const progress = document.querySelector('.onboarding-shell__progress')!.getBoundingClientRect();
      const actions = document.querySelector('.sticky-onboarding-actions')!.getBoundingClientRect();
      return { top: field.top, bottom: field.bottom, stickyTop: Math.max(header.bottom, progress.bottom), stickyBottom: actions.top };
    });

    expect(bounds.top).toBeGreaterThanOrEqual(bounds.stickyTop - 1);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.stickyBottom + 1);

    await name.fill('Progress review studio');

    await expect(name).toHaveValue('Progress review studio');
  });
}
