/**
 * Rendered contrast audit.
 *
 * The palette-level test proves the token pairings are sound in the
 * abstract; this one measures what actually reaches the screen — every
 * visible text node's computed colour against its effective (first opaque
 * ancestor) background, in every section, on the surfaces the composition
 * system paints, across a representative style/palette spread.
 *
 * It exists because a token can be correct and still be used on the wrong
 * ground: muted grey is fine on ivory and unreadable on a contrast band.
 */

import { expect, test } from '@playwright/test';

const RECIPES = ['signature_one_page', 'promo_led', 'gallery_forward'] as const;

const RENDITIONS = [
  { palette: 'luster_berry', style: 'modern' },
  { palette: 'black_champagne', style: 'luxury' },
  { palette: 'monochrome', style: 'editorial' },
  { palette: 'navy_ivory', style: 'minimal' },
] as const;

const showcaseUrl = (params: Record<string, string>): string =>
  `/?${new URLSearchParams({ audit: '1', device: 'phone', full: '1', surface: 'sections', ...params }).toString()}`;

type Offender = {
  background: string;
  color: string;
  ratio: number;
  section: string;
  size: number;
  text: string;
  weight: string;
};

const auditContrast = async (page: import('@playwright/test').Page) =>
  page.evaluate<Offender[]>(() => {
    /**
     * Computed colours arrive as `rgb()`/`rgba()` or, wherever `color-mix()`
     * is used, as `color(srgb r g b / a)` with 0–1 channels. Both must parse
     * or the audit invents failures.
     */
    const parse = (value: string): [number, number, number, number] => {
      const srgb = value.match(/color\(\s*srgb\s+([^)]+)\)/i);
      if (srgb) {
        const [channels, alpha] = srgb[1]!.split('/');
        const parts = channels!.trim().split(/\s+/).map(Number.parseFloat);
        return [
          (parts[0] ?? 0) * 255,
          (parts[1] ?? 0) * 255,
          (parts[2] ?? 0) * 255,
          alpha === undefined ? 1 : Number.parseFloat(alpha),
        ];
      }
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return [0, 0, 0, 0];
      const parts = match[1]!.split(/[,\s/]+/).filter(Boolean).map(Number.parseFloat);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const luminance = ([r, g, b]: [number, number, number, number]): number => {
      const channel = (value: number) => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (
      foreground: [number, number, number, number],
      background: [number, number, number, number],
    ): number => {
      const first = luminance(foreground);
      const second = luminance(background);
      const lighter = Math.max(first, second);
      const darker = Math.min(first, second);
      return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
    };
    /**
     * Returns the first opaque painted background, or null when the nearest
     * painted layer is an image or gradient — those cannot be sampled from
     * computed style, so the audit reports nothing rather than guessing.
     */
    const effectiveBackground = (
      element: Element,
    ): [number, number, number, number] | null => {
      let node: Element | null = element;
      while (node) {
        const style = getComputedStyle(node);
        if (style.backgroundImage !== 'none') return null;
        const parsed = parse(style.backgroundColor);
        if (parsed[3] > 0.85) return parsed;
        node = node.parentElement;
      }
      return [255, 255, 255, 1];
    };

    const offenders: Offender[] = [];
    const root = document.querySelector('.onboarding-site-preview');
    if (!root) return offenders;

    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      // Only elements whose own text is visible to a reader.
      const ownText = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent ?? '')
        .join('')
        .trim();
      if (!ownText) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (Number.parseFloat(style.opacity) < 0.5) continue;
      if (element.closest('.visually-hidden')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;

      const size = Number.parseFloat(style.fontSize);
      const weight = style.fontWeight;
      const large = size >= 24 || (size >= 18.66 && Number.parseInt(weight, 10) >= 700);
      const required = large ? 3 : 4.5;
      const background = effectiveBackground(element);
      if (!background) continue;
      const measured = ratio(parse(style.color), background);
      if (measured < required) {
        const section = element.closest('[data-section-id]');
        offenders.push({
          background: getComputedStyle(
            element.closest('[data-surface]') ?? element,
          ).backgroundColor,
          color: style.color,
          ratio: measured,
          section: section?.getAttribute('data-section-id')
            ?? section?.getAttribute('data-library-type')
            ?? 'chrome',
          size,
          text: ownText.slice(0, 40),
          weight,
        });
      }
    }
    return offenders;
  });

test.describe('rendered contrast', () => {
  test('every visible text run meets WCAG AA on the surface it lands on', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 940 });
    const allOffenders: Offender[] = [];

    for (const recipe of RECIPES) {
      for (const rendition of RENDITIONS) {
        await page.goto(showcaseUrl({ recipe, ...rendition }));
        await expect(page.locator('[data-showcase-ready]')).toBeVisible();
        const offenders = await auditContrast(page);
        for (const offender of offenders) {
          allOffenders.push({
            ...offender,
            section: `${recipe}/${rendition.style}/${rendition.palette} · ${offender.section}`,
          });
        }
      }
    }

    if (allOffenders.length > 0) {
      console.warn(`[contrast] ${JSON.stringify(allOffenders, null, 2)}`);
    }
    expect(
      allOffenders.map(item => `${item.section}: "${item.text}" ${item.ratio}:1`),
      'text below WCAG AA',
    ).toEqual([]);
  });
});
