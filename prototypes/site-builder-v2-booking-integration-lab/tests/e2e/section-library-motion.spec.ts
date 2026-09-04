/**
 * Motion contract for the customer section layer.
 *
 * The library animates a lot — scroll reveals, card presses, a breathing
 * "open now" dot — and every one of those is a chance to hide real customer
 * content behind an animation that never runs. That already happened once:
 * a staggered Quick Info entrance held `opacity: 0` through its delay and
 * the strip measured 1.09:1 in a screenshot. So the rules below are checked
 * by machine rather than trusted:
 *
 *   1. No animation on a real element may touch a property that can hide it.
 *      Decorative pseudo-elements may fade; text may only move.
 *   2. Every piece of text is fully opaque at first paint, before any
 *      animation has had a chance to finish.
 *   3. `prefers-reduced-motion: reduce` leaves no animation running at all —
 *      including scroll-linked ones, whose progress comes from the scroll
 *      position and so cannot be stopped by shortening a duration.
 *   4. The interactions that carry meaning actually respond: the FAQ marker
 *      turns when its answer opens, and an open salon gets its status dot.
 *
 * Run against a lab dev server:
 *   LUSTER_LAB_PORT=4193 npx playwright test tests/e2e/section-library-motion.spec.ts
 */

import { expect, test } from '@playwright/test';

/** A recipe dense enough to exercise every animated section at once. */
const RECIPE_URL = '/?audit=1&surface=sections&recipe=signature_one_page&full=1';

const PREVIEW = '.onboarding-site-preview';

/** Properties that can make content invisible rather than merely move it. */
const HIDING_PROPERTIES = ['opacity', 'visibility', 'clipPath', 'display', 'filter'];

test.describe('customer section motion', () => {
  test('animations move content, they never hide it', async ({ page }) => {
    await page.goto(RECIPE_URL);
    await page.waitForSelector(`${PREVIEW} [data-library-type]`);

    const offenders = await page.evaluate(({ hiding, previewSelector }) => {
      const preview = document.querySelector(previewSelector);
      if (!preview) {
        return [{ reason: 'no preview' }];
      }
      const structural = new Set(['offset', 'computedOffset', 'easing', 'composite']);

      return document.getAnimations()
        .flatMap((animation) => {
          const effect = animation.effect;
          if (!(effect instanceof KeyframeEffect)) {
            return [];
          }
          const target = effect.target;
          if (!target || !preview.contains(target)) {
            return [];
          }

          const properties = new Set<string>();
          for (const frame of effect.getKeyframes()) {
            for (const key of Object.keys(frame)) {
              if (!structural.has(key)) {
                properties.add(key);
              }
            }
          }
          const hidingProperties = [...properties].filter(name => hiding.includes(name));
          // A pseudo-element carries decoration, never the customer's words,
          // so it is allowed to fade. Anything else must only move.
          if (hidingProperties.length === 0 || effect.pseudoElement) {
            return [];
          }
          return [{
            animation: animation instanceof CSSAnimation
              ? animation.animationName
              : '(unnamed)',
            hidingProperties,
            target: `${target.tagName.toLowerCase()}.${target.className}`,
          }];
        });
    }, { hiding: HIDING_PROPERTIES, previewSelector: PREVIEW });

    expect(offenders).toEqual([]);
  });

  test('every word is fully opaque at first paint', async ({ page }) => {
    await page.goto(RECIPE_URL);
    await page.waitForSelector(`${PREVIEW} [data-library-type]`);

    // Deliberately no settling wait: this is the state a screenshot, a
    // crawler, or a visitor on a throttled device sees before any entrance
    // has had time to complete.
    const faded = await page.evaluate((previewSelector) => {
      const preview = document.querySelector(previewSelector);
      if (!preview) {
        return [{ text: 'no preview', opacity: '0' }];
      }

      return [...preview.querySelectorAll('h1, h2, h3, p, li, dd, dt, summary, a, button')]
        .filter(element => (element.textContent ?? '').trim().length > 0)
        .map(element => ({
          element,
          style: window.getComputedStyle(element),
        }))
        .filter(({ style }) => (
          Number(style.opacity) < 1
          || style.visibility === 'hidden'
          || style.display === 'none'
        ))
        .map(({ element, style }) => ({
          opacity: style.opacity,
          text: (element.textContent ?? '').trim().slice(0, 40),
        }));
    }, PREVIEW);

    expect(faded).toEqual([]);
  });

  test('reduced motion leaves nothing animating, scroll-linked included', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(RECIPE_URL);
    await page.waitForSelector(`${PREVIEW} [data-library-type]`);
    // Scroll-linked animations only reveal themselves once the page moves.
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(250);

    const running = await page.evaluate((previewSelector) => {
      const preview = document.querySelector(previewSelector);
      if (!preview) {
        return ['no preview'];
      }
      return document.getAnimations()
        .filter((animation) => {
          const effect = animation.effect;
          if (!(effect instanceof KeyframeEffect)) {
            return false;
          }
          return Boolean(effect.target && preview.contains(effect.target));
        })
        .map(animation => (animation instanceof CSSAnimation
          ? animation.animationName
          : '(unnamed)'));
    }, PREVIEW);

    expect(running).toEqual([]);
  });

  test('reveals never push the page sideways', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(RECIPE_URL);
    await page.waitForSelector(`${PREVIEW} [data-library-type]`);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(250);

    const overflow = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));

    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  });

  test('the FAQ marker turns when its answer opens', async ({ page }) => {
    await page.goto('/?audit=1&surface=sections&type=faq&full=1');
    const summary = page.locator('.customer-lib-faq summary').first();

    await expect(summary).toBeVisible();

    const markerRotate = async () => summary.evaluate(
      element => window.getComputedStyle(element, '::after').rotate,
    );

    const closed = await markerRotate();
    await summary.click();
    const open = page.locator('.customer-lib-faq details[open]').first();

    await expect(open).toBeAttached();

    await page.waitForTimeout(400);

    expect(closed).toBe('none');
    // The plus becomes a close mark rather than swapping glyph.
    expect(await markerRotate()).toBe('45deg');

    // And the answer is readable the moment it opens, not once an animation
    // has run: a height transition from zero leaves it clipped anywhere
    // transitions do not advance.
    const answer = open.locator('p').first();
    const [answerBox, detailsBox] = await Promise.all([
      answer.boundingBox(),
      open.boundingBox(),
    ]);

    expect(answerBox?.height ?? 0).toBeGreaterThan(0);
    expect((detailsBox?.y ?? 0) + (detailsBox?.height ?? 0))
      .toBeGreaterThanOrEqual((answerBox?.y ?? 0) + (answerBox?.height ?? 0) - 1);
  });

  test('a card still lifts on hover while its reveal is applied', async ({ page }) => {
    // A filled animation outranks the declared style for the property it
    // animates, so a reveal that set `transform` would hold it for the life
    // of the page and silently swallow every hover lift and press. The
    // reveals animate `translate`/`scale` instead, which compose with
    // `transform` by the CSS transform model. This is the test that says so.
    await page.goto('/?audit=1&surface=sections&type=featured_services&full=1');
    const card = page.locator('.customer-lib-featured-card').first();

    await expect(card).toBeVisible();

    const revealProperties = await card.evaluate(element => [...new Set(
      element.getAnimations().flatMap((animation) => {
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect)) {
          return [];
        }
        return effect.getKeyframes().flatMap(frame => Object.keys(frame));
      }),
    )].filter(name => !['offset', 'computedOffset', 'easing', 'composite'].includes(name)));

    expect(revealProperties).not.toContain('transform');

    const translateY = async () => card.evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(window.getComputedStyle(element).transform);
      return matrix.m42;
    });

    const resting = await translateY();
    await card.hover();
    await page.waitForTimeout(400);
    const hovered = await translateY();

    expect(hovered).toBeLessThan(resting);
  });

  test('an open salon gets a status dot', async ({ page }) => {
    await page.goto('/?audit=1&surface=sections&type=hours&full=1');
    const status = page.locator('.customer-lib-hours-status');

    await expect(status).toBeVisible();

    // The demo salon's real open/closed state depends on the wall clock, so
    // the stylesheet's rule is put under test directly rather than the
    // salon's Tuesday.
    const dot = await status.evaluate((element) => {
      element.setAttribute('data-hours-status', 'open');
      const before = window.getComputedStyle(element, '::before');
      return { content: before.content, width: before.width };
    });

    expect(dot.content).toBe('""');
    expect(Number.parseFloat(dot.width)).toBeGreaterThan(0);
  });
});
