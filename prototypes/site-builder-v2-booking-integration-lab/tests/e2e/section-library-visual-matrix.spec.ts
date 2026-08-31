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
  ['reviews', 'reviews'],
  ['footer', 'hero'],
];

/**
 * Pairs made only of composition chrome publish nothing on their own (the
 * page-viability rule), so their seam is sampled behind a hero instead.
 */
const CHROME_PAIR_SAMPLES: ReadonlyArray<readonly string[]> = [
  ['hero', 'final_cta', 'footer'],
  ['hero', 'announcement_bar', 'quick_info'],
];

/**
 * Composition chrome never justifies publishing a page by itself, so a page
 * holding only chrome drops entirely — these types are honestly absent when
 * shown alone and are captured beside a substantive section instead.
 * Section Navigation additionally needs two anchor targets before it renders.
 */
const CHROME_ALONE_DROPS = new Set([
  'announcement_bar',
  'quick_info',
  'section_navigation',
  'final_cta',
  'footer',
]);

/** Companions that give a chrome section a realistic page to sit in. */
const CHROME_COMPANIONS: Record<string, readonly string[]> = {
  announcement_bar: ['hero'],
  final_cta: ['hero'],
  footer: ['hero'],
  quick_info: ['hero'],
  section_navigation: ['featured_services', 'reviews'],
};

const WIDTHS = [390, 1440] as const;

const showcaseUrl = (params: Record<string, string>): string => {
  const search = new URLSearchParams({ audit: '1', surface: 'sections', ...params });
  return `/?${search.toString()}`;
};

/** Evidence captures unclip the device frame so whole pages fit one image. */
const captureUrl = (params: Record<string, string>): string =>
  showcaseUrl({ ...params, full: '1' });

/**
 * Booking's service cards use `content-visibility: auto` and its images are
 * lazy — both correct for a customer on a phone, both invisible-in-a-
 * screenshot if the page is captured without ever scrolling. Walk the page
 * first so the evidence shows what a real visitor sees.
 */
const settleForCapture = async (page: import('@playwright/test').Page) => {
  // `content-visibility: auto` re-skips rendering the moment a card scrolls
  // away again, and a full-page screenshot scrolls. Pin it on for the
  // capture so the image shows what a visitor sees at that scroll position.
  await page.addStyleTag({
    content: '.onboarding-site-preview * { content-visibility: visible !important; }',
  });
  await page.evaluate(async () => {
    // Lazy images below the fold may never start loading during a scripted
    // scroll, so ask for them eagerly and wait for the decode.
    for (const image of document.images) {
      image.loading = 'eager';
      if (image.getAttribute('decoding') !== 'sync') image.decoding = 'sync';
    }
    const step = window.innerHeight;
    const total = document.body.scrollHeight;
    for (let offset = 0; offset < total; offset += step) {
      window.scrollTo(0, offset);
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    }
    window.scrollTo(0, 0);
    await Promise.all([...document.images].map(image => (
      image.complete && image.naturalWidth > 0
        ? Promise.resolve()
        : new Promise((resolve) => {
            const done = () => resolve(null);
            image.addEventListener('load', done, { once: true });
            image.addEventListener('error', done, { once: true });
            window.setTimeout(done, 4000);
          })
    )));
    await Promise.all([...document.images]
      .filter(image => typeof image.decode === 'function')
      .map(image => image.decode().catch(() => undefined)));
  });
  await page.waitForTimeout(400);
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
        const device = width >= 1024 ? 'desktop' : 'phone';

        if (CHROME_ALONE_DROPS.has(type)) {
          // Alone, the page is pure chrome and correctly publishes nothing.
          expect(rendered, `${type}@${width} should drop when alone`).toBe(0);

          // Beside a substantive section it must render, and that is what the
          // evidence screenshot shows.
          const run = [type, ...(CHROME_COMPANIONS[type] ?? ['hero'])];
          await page.goto(showcaseUrl({ device, types: run.join(',') }));
          await expect(page.locator('[data-showcase-ready]')).toBeVisible();
          await expect(
            page.locator(`[data-section-id="showcase-${type}-0"]`),
            `${type}@${width} did not render beside ${run.slice(1).join(' + ')}`,
          ).toHaveCount(1);
          await assertNoHorizontalOverflow(page, `${type}@${width} (in context)`);
          await page.goto(captureUrl({ device, types: run.join(',') }));
        } else {
          expect(rendered, `${type}@${width} did not render`).toBeGreaterThan(0);
          await assertNoHorizontalOverflow(page, `${type}@${width}`);
          await page.goto(captureUrl({ device, type }));
        }

        await expect(page.locator('[data-showcase-ready]')).toBeVisible();
        await settleForCapture(page);
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
            await page.goto(captureUrl({ device: 'phone', second, type: first }));
            await expect(page.locator('[data-showcase-ready]')).toBeVisible();
            await settleForCapture(page);
            await page.screenshot({
              fullPage: true,
              path: `${EVIDENCE_ROOT}/pairs/${first}--${second}-390.png`,
            });
          }
        }
      }
    }
  });

  test('chrome-only seams are sampled behind a substantive section', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 940 });
    for (const run of CHROME_PAIR_SAMPLES) {
      await page.goto(showcaseUrl({ device: 'phone', types: run.join(',') }));
      await expect(page.locator('[data-showcase-ready]')).toBeVisible();
      for (const type of run.slice(1)) {
        await expect(
          page.locator(`[data-section-id^="showcase-${type}-"]`),
          `${type} missing from ${run.join('+')}`,
        ).toHaveCount(1);
      }
      await assertNoHorizontalOverflow(page, run.join('+'));
      await page.goto(captureUrl({ device: 'phone', types: run.join(',') }));
      await expect(page.locator('[data-showcase-ready]')).toBeVisible();
      await settleForCapture(page);
      await page.screenshot({
        fullPage: true,
        path: `${EVIDENCE_ROOT}/pairs/${run.join('--')}-390.png`,
      });
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
        await page.goto(captureUrl({
          device: width >= 1024 ? 'desktop' : 'phone',
          recipe,
        }));
        await expect(page.locator('[data-showcase-ready]')).toBeVisible();
        await settleForCapture(page);
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
        await page.goto(captureUrl({
          device: 'phone',
          palette,
          recipe: 'signature_one_page',
          style,
        }));
        await expect(page.locator('[data-showcase-ready]')).toBeVisible();
        await settleForCapture(page);
        await page.screenshot({
          fullPage: true,
          path: `${EVIDENCE_ROOT}/style-palette/${style}--${palette}.png`,
        });
      }
    }
  });
});
