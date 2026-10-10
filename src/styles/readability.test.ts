import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { espressoTheme, lavenderTheme, pastelTheme } from '@/theme/themes';

const css = (path: string) => readFileSync(path, 'utf8');
const globalCss = css('src/styles/global.css');
const owner = globalCss.slice(globalCss.indexOf('.owner-workspace-theme,\n  .owner-theme-scope,'));
const isla = css('src/components/isla/isla-booking.css');
function token(source: string, name: string) {
  const value = source.match(new RegExp(`${name}: (#[a-f0-9]{6});`, 'i'))?.[1];
  if (!value) {
    throw new Error(`Missing token ${name}`);
  }
  return value;
}
function contrast(a: string, b: string) {
  const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(c => Number.parseInt(c, 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('readable shared colour roles', () => {
  for (const background of ['ground', 'surface', 'surface-soft', 'blush']) {
    it(`owner ink and controls remain visible on ${background}`, () => {
      const ground = token(owner, `--owner-${background}`);
      for (const foreground of ['ink', 'muted', 'accent']) {
        expect(contrast(token(owner, `--owner-${foreground}`), ground)).toBeGreaterThanOrEqual(4.5);
      }

      expect(contrast(token(owner, '--owner-control'), ground)).toBeGreaterThanOrEqual(3);
      expect(contrast(token(owner, '--owner-focus'), ground)).toBeGreaterThanOrEqual(3);
    });
  }

  it('keeps owner, sign-in and onboarding secondary text aligned', () => {
    const muted = token(owner, '--owner-muted');

    expect(token(css('src/components/owner-entry/owner-entry.css'), '--entry-muted')).toBe(muted);
    expect(token(css('prototypes/site-builder-v2-booking-integration-lab/src/onboarding/onboarding.css'), '--onboarding-muted')).toBe(muted);
  });

  for (const ground of ['#faf7f0', '#fffdf8', '#f6f1e6']) {
    it(`Isla text and selection controls are readable on ${ground}`, () => {
      for (const foreground of ['--isla-ink', '--isla-muted', '--isla-gold-ink']) {
        expect(contrast(token(isla, foreground), ground)).toBeGreaterThanOrEqual(4.5);
      }

      expect(contrast(token(isla, '--isla-control'), ground)).toBeGreaterThanOrEqual(3);
    });
  }

  for (const theme of [espressoTheme, lavenderTheme, pastelTheme]) {
    it(`${theme.name} secondary text and action labels meet AA`, () => {
      for (const ground of [theme.colors.bgPage, theme.colors.bgCard, theme.colors.bgSurface, theme.colors.bgSelected]) {
        expect(contrast(theme.colors.inkMuted, ground)).toBeGreaterThanOrEqual(4.5);
      }

      expect(contrast(theme.buttons.buttonPrimaryText, theme.buttons.buttonPrimaryBg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('loads onboarding fonts locally without a render-blocking external import', () => {
    const library = css('prototypes/site-builder-v2-booking-integration-lab/src/onboarding/section-library.css');

    expect(library).not.toContain('fonts.googleapis.com');
    expect(library).toContain('url(\'./quick-book/fonts/inter-latin.woff2\')');
    expect(library).toContain('url(\'./quick-book/fonts/newsreader-latin.woff2\')');
    expect(library).toContain('font-display: swap;');
  });
});
