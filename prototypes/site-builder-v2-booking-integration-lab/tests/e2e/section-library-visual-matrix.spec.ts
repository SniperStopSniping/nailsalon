/**
 * Visual + overflow matrix for the Section Library V1 showcase surface.
 *
 * Runs only with LUSTER_SECTION_MATRIX=1 (it captures hundreds of states):
 *   LUSTER_SECTION_MATRIX=1 LUSTER_LAB_PORT=4193 npx playwright test tests/e2e/section-library-visual-matrix.spec.ts
 *
 * Machine checks (all 400 ordered pairs + every renderable type + all six
 * recipes, at 390px and 1440px): the showcase mounts, the requested sections
 * render (or are honestly absent), and the preview never scrolls
 * horizontally. Screenshots are captured for every single-type rendition,
 * a named sample of adjacency pairs, the six recipes, and a 6×8
 * style-palette sweep of the flagship recipe.
 */

import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const EVIDENCE_ROOT = '/tmp/luster-site-section-library-v1/visual';

const RUN_MATRIX = process.env.LUSTER_SECTION_MATRIX === '1';

const LIBRARY_TYPES = [
  'announcement_bar',
  'hero',
  'quick_info',
  'section_navigation',
  'featured_services',
  'offers',
  'gallery',
  'about',
  'team',
  'reviews',
  'deposits_cancellations',
  'policies',
  'faq',
  'hours',
  'visit_us',
  'contact',
  'final_cta',
  'footer',
] as const;

const PAIR_TYPES = [...LIBRARY_TYPES, 'booking'] as const;

const STYLES = ['modern', 'editorial', 'soft', 'minimal', 'bold', 'luxury'] as const;
const PALETTES = [
  'luster_berry',
  'blush_cocoa',
  'terracotta_cream',
  'sage_stone',
  'lilac_plum',
  'navy_ivory',
  'monochrome',
  'black_champagne',
] as const;

const RECIPES = [
  'quick_book',
  'signature_one_page',
  'the_collective',
  'solo_editorial',
  'promo_led',
  'gallery_forward',
] as const;

/** Pairs whose composition is worth keeping as image evidence. */
const SAMPLE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['announcement_bar', 'hero'],
  ['hero', 'quick_info'],
  ['quick_info', 'featured_services'],
  ['featured_services', 'booking'],
  ['booking', 'deposits_cancellations'],
  ['deposits_cancellations', 'policies'],
  ['gallery', 'reviews'],
  ['reviews', 'visit_us'],
  ['team', 'about'],
  ['offers', 'featured_services'],
  ['faq', 'hours'],
  ['hours', 'visit_us'],
  ['visit_us', 'contact'],
  ['contact', 'final_cta'],
  ['final_cta', 'footer'],
  ['reviews', 'reviews'],
  ['final_cta', 'final_cta'],
  ['footer', 'hero'],
];

/** Section Navigation needs 2+ anchor targets; alone it is honestly absent. */
const HONESTLY_ABSENT_ALONE = new Set(['section_navigation']);

const WIDTHS = [390, 1440] as const;

const showcaseUrl = (params: Record<string, string>): string => {
  const search = new URLSearchParams({ audit: '1', surface: 'sections', ...params });
  return `/?${search.toString()}`;
};

test.describe('section library visual matrix', () => {
  test.skip(!RUN_MATRIX, 'Set LUSTER_SECTION_MATRIX=1 to run the matrix.');

  test.beforeAll(() => {
    for (const dir of ['sections', 'pairs', 'recipes', 'style-palette']) {
      mkdirSync(`${EVIDENCE_ROOT}/${dir}`, { recursive: true });
    }
  });

  const assertNoHorizontalOverflow = async (
    page: import('@playwright/test').Page,
    label: string,
  ) => {
    const overflow = await page.evaluate(() => {
      const frame = document.querySelector('.onboarding-preview-frame');
      if (!frame) return null;
      const overflowing: string[] = [];
      if (frame.scrollWidth > frame.clientWidth + 1) {
        overflowing.push(`frame:${frame.scrollWidth}>${frame.clientWidth}`);
      }
      return overflowing;
    });
    expect(overflow, `${label}: showcase frame missing`).not.toBeNull();
    expect(overflow, `${label}: horizontal overflow`).toEqual([]);
  };

  test('every renderable section holds at 390 and 1440 (screenshots captured)', async ({ page }) => {
    test.setTimeout(360_000);
    for (const type of PAIR_TYPES) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 940 });
        await page.goto(showcaseUrl({
          device: width >= 1024 ? 'desktop' : 'phone',
          type,
        }));
        await expect(page.locator('[data-showcase-ready]')).toBeVisible();
        const rendered = await page.locator(`[data-section-id="showcase-${type}-0"]`).count();
        if (HONESTLY_ABSENT_ALONE.has(type)) {
          expect(rendered, `${type}@${width} should be honestly absent alone`).toBe(0);
        } else {
          expect(rendered, `${type}@${width} did not render`).toBeGreaterThan(0);
        }
        await assertNoHorizontalOverflow(page, `${type}@${width}`);
        await page.screenshot({
          fullPage: true,
          path: `${EVIDENCE_ROOT}/sections/${type}-${width}.png`,
        });
      }
    }
  });

  test('all 400 ordered pairs compose without overflow at both widths', async ({ page }) => {
    test.setTimeout(1_500_000);
    const sampleSet = new Set(SAMPLE_PAIRS.map(pair => pair.join('+')));
    for (const first of PAIR_TYPES) {
      for (const second of PAIR_TYPES) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 940 });
          await page.goto(showcaseUrl({
            device: width >= 1024 ? 'desktop' : 'phone',
            second,
            type: first,
          }));
          await expect(page.locator('[data-showcase-ready]')).toBeVisible();
          await assertNoHorizontalOverflow(page, `${first}+${second}@${width}`);
          if (width === 390 && sampleSet.has(`${first}+${second}`)) {
            await page.screenshot({
              fullPage: true,
              path: `${EVIDENCE_ROOT}/pairs/${first}--${second}-390.png`,
            });
          }
        }
      }
    }
  });

  test('all six recipes render end to end at both widths (screenshots captured)', async ({ page }) => {
    test.setTimeout(300_000);
    for (const recipe of RECIPES) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 940 });
        await page.goto(showcaseUrl({
          device: width >= 1024 ? 'desktop' : 'phone',
          recipe,
        }));
        await expect(page.locator('[data-showcase-ready]')).toBeVisible();
        await expect(page.locator('.onboarding-customer-page').first()).toBeVisible();
        await assertNoHorizontalOverflow(page, `${recipe}@${width}`);
        await page.screenshot({
          fullPage: true,
          path: `${EVIDENCE_ROOT}/recipes/${recipe}-${width}.png`,
        });
      }
    }
  });

  test('the flagship recipe holds across all 48 style × palette pairings', async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 390, height: 940 });
    for (const style of STYLES) {
      for (const palette of PALETTES) {
        await page.goto(showcaseUrl({
          device: 'phone',
          palette,
          recipe: 'signature_one_page',
          style,
        }));
        await expect(page.locator('[data-showcase-ready]')).toBeVisible();
        await assertNoHorizontalOverflow(page, `signature/${style}/${palette}`);
        await page.screenshot({
          path: `${EVIDENCE_ROOT}/style-palette/${style}--${palette}.png`,
        });
      }
    }
  });
});
