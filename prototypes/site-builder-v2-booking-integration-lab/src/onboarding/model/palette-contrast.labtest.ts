/**
 * WCAG contrast matrix for the customer palette roles.
 *
 * Every palette is checked in the exact role pairings the section library
 * paints: body ink on ground and on surface, muted secondary text, button
 * label on button, accent as a large-text/eyebrow colour, and the contrast
 * surface tone (ground-on-ink) the composition system uses for CTA/footer
 * bands. A palette that fails here would ship unreadable customer text in
 * some section, so this is a gate, not a report.
 */

import { describe, expect, it } from 'vitest';

import { SITE_PALETTE_PRESETS } from './palettes';

type Rgb = { b: number; g: number; r: number };

const parseHex = (value: string): Rgb => {
  const hex = value.trim().replace('#', '');
  const full = hex.length === 3
    ? hex.split('').map(char => char + char).join('')
    : hex;
  return {
    b: Number.parseInt(full.slice(4, 6), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    r: Number.parseInt(full.slice(0, 2), 16),
  };
};

const channelLuminance = (channel: number): number => {
  const scaled = channel / 255;
  return scaled <= 0.03928
    ? scaled / 12.92
    : ((scaled + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (color: Rgb): number =>
  0.2126 * channelLuminance(color.r)
  + 0.7152 * channelLuminance(color.g)
  + 0.0722 * channelLuminance(color.b);

/** WCAG 2.1 contrast ratio, rounded to two decimals for stable messages. */
export const contrastRatio = (foreground: string, background: string): number => {
  const first = relativeLuminance(parseHex(foreground));
  const second = relativeLuminance(parseHex(background));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
};

/** Mixes two hex colours the way `color-mix(in srgb, a X%, b)` does. */
const mix = (first: string, second: string, firstPercent: number): string => {
  const a = parseHex(first);
  const b = parseHex(second);
  const weight = firstPercent / 100;
  const channel = (left: number, right: number) =>
    Math.round(left * weight + right * (1 - weight))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
};

const AA_BODY = 4.5;
const AA_LARGE = 3;

describe('customer palette contrast', () => {
  it.each(SITE_PALETTE_PRESETS.map(preset => [preset.label, preset] as const))(
    '%s keeps every customer text pairing readable',
    (label, preset) => {
      const { roles } = preset;
      // The tint surface the composition layer paints under alternating
      // sections, matching section-library.css exactly.
      const tint = mix(roles.surface, roles.ground, 62);

      const bodyPairs: ReadonlyArray<readonly [string, string, string]> = [
        ['ink on ground', roles.ink, roles.ground],
        ['ink on surface', roles.ink, roles.surface],
        ['ink on tint', roles.ink, tint],
        ['muted on ground', roles.muted, roles.ground],
        ['muted on surface', roles.muted, roles.surface],
        ['muted on tint', roles.muted, tint],
        ['button text on button', roles.buttonText, roles.button],
        // Contrast band: the customer ground becomes the text colour on ink.
        ['ground on ink (contrast band)', roles.ground, roles.ink],
      ];

      for (const [pairLabel, foreground, background] of bodyPairs) {
        const ratio = contrastRatio(foreground, background);
        expect(ratio, `${label}: ${pairLabel} is ${ratio}:1`).toBeGreaterThanOrEqual(AA_BODY);
      }

      // Eyebrows and text CTAs use the accent at small-bold/large sizes.
      const accentPairs: ReadonlyArray<readonly [string, string, string]> = [
        ['accent on ground', roles.accent, roles.ground],
        ['accent on surface', roles.accent, roles.surface],
        ['accent on tint', roles.accent, tint],
      ];
      for (const [pairLabel, foreground, background] of accentPairs) {
        const ratio = contrastRatio(foreground, background);
        expect(ratio, `${label}: ${pairLabel} is ${ratio}:1`).toBeGreaterThanOrEqual(AA_LARGE);
      }
    },
  );

  it('computes known reference ratios exactly', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });
});
