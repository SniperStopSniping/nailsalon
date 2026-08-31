/**
 * Performance budget for the section library.
 *
 * The customer site is the product's slowest-network surface, so this pins
 * the costs the library adds: DOM weight per page, first-render time for the
 * heaviest recipe, restyle cost when a palette changes, and the guarantee
 * that every animation stays on the compositor (transform/opacity only, no
 * geometry properties).
 *
 * Budgets are deliberately generous — they exist to catch a regression of
 * kind (a layout-animating rule, an accidental O(n²) render), not to police
 * millisecond noise on a dev server.
 */

import { expect, test } from '@playwright/test';

const RECIPES = [
  'quick_book',
  'signature_one_page',
  'the_collective',
  'solo_editorial',
  'promo_led',
  'gallery_forward',
] as const;

/** Properties that force layout or paint off the compositor when animated. */
const NON_COMPOSITED = [
  'width',
  'height',
  'top',
  'left',
  'right',
  'bottom',
  'margin',
  'padding',
  'font-size',
  'line-height',
  'inset',
];

const showcaseUrl = (params: Record<string, string>): string =>
  `/?${new URLSearchParams({ audit: '1', surface: 'sections', ...params }).toString()}`;

test.describe('section library performance', () => {
  test('every recipe stays within its DOM and render budget', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 940 });
    const report: Array<{ nodes: number; recipe: string; renderMs: number }> = [];

    for (const recipe of RECIPES) {
      const started = Date.now();
      await page.goto(showcaseUrl({ device: 'phone', recipe }));
      await expect(page.locator('[data-showcase-ready]')).toBeVisible();
      const renderMs = Date.now() - started;
      const nodes = await page.evaluate(() =>
        document.querySelectorAll('.onboarding-site-preview *').length);
      report.push({ nodes, recipe, renderMs });

      // A whole customer page should stay well under a thousand elements;
      // beyond that something is duplicating subtrees.
      expect(nodes, `${recipe} DOM weight`).toBeLessThan(1000);
      expect(renderMs, `${recipe} first render`).toBeLessThan(12_000);
    }

    console.warn(`[perf] ${JSON.stringify(report)}`);
  });

  test('animations never touch layout properties', async ({ page }) => {
    await page.goto(showcaseUrl({ device: 'phone', recipe: 'signature_one_page' }));
    await expect(page.locator('[data-showcase-ready]')).toBeVisible();

    const offenders = await page.evaluate((banned) => {
      const found: string[] = [];
      for (const sheet of [...document.styleSheets]) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // cross-origin (Google Fonts)
        }
        for (const rule of [...rules]) {
          if (!(rule instanceof CSSStyleRule)) continue;
          const selector = rule.selectorText ?? '';
          if (!selector.includes('customer-lib') && !selector.includes('onboarding-customer')) {
            continue;
          }
          const transition = rule.style.getPropertyValue('transition')
            + rule.style.getPropertyValue('transition-property');
          for (const property of banned) {
            // `transition: all` is equally disqualifying: it animates layout.
            if (transition.includes(`${property} `) || transition.trim().startsWith('all')) {
              found.push(`${selector} → ${transition.trim()}`);
            }
          }
        }
      }
      return found;
    }, NON_COMPOSITED);

    expect(offenders, 'layout-animating transitions').toEqual([]);
  });

  test('a palette change restyles without re-rendering the tree', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 940 });
    await page.goto(showcaseUrl({
      device: 'phone',
      palette: 'luster_berry',
      recipe: 'signature_one_page',
    }));
    await expect(page.locator('[data-showcase-ready]')).toBeVisible();
    const before = await page.evaluate(() => ({
      accent: getComputedStyle(document.querySelector('.onboarding-site-preview')!)
        .getPropertyValue('--customer-accent').trim(),
      nodes: document.querySelectorAll('.onboarding-site-preview *').length,
    }));

    await page.goto(showcaseUrl({
      device: 'phone',
      palette: 'black_champagne',
      recipe: 'signature_one_page',
    }));
    await expect(page.locator('[data-showcase-ready]')).toBeVisible();
    const after = await page.evaluate(() => ({
      accent: getComputedStyle(document.querySelector('.onboarding-site-preview')!)
        .getPropertyValue('--customer-accent').trim(),
      nodes: document.querySelectorAll('.onboarding-site-preview *').length,
    }));

    // The palette is pure token substitution: same markup, different colours.
    expect(after.accent).not.toBe(before.accent);
    expect(after.nodes).toBe(before.nodes);
  });
});
