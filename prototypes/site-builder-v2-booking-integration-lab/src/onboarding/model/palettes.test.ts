import { SITE_PALETTE_PRESETS } from './palettes';
import { SITE_STYLE_PRESETS } from './site-styles';

const relativeLuminance = (hex: string): number => {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/gu)
    ?.map(value => Number.parseInt(value, 16) / 255);
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex colour, received ${hex}`);
  }
  const linear = channels.map(channel => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * linear[0]!) + (0.7152 * linear[1]!) + (0.0722 * linear[2]!);
};

const contrastRatio = (foreground: string, background: string): number => {
  const values = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((left, right) => right - left);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
};

describe('customer website palette presets', () => {
  it('keeps all six styles compatible with all eight palettes', () => {
    expect(SITE_STYLE_PRESETS).toHaveLength(6);
    expect(SITE_PALETTE_PRESETS).toHaveLength(8);
    expect(SITE_STYLE_PRESETS.length * SITE_PALETTE_PRESETS.length).toBe(48);
  });

  it.each(SITE_PALETTE_PRESETS)('$label passes text and focus contrast roles', (palette) => {
    const { roles } = palette;
    for (const background of [roles.ground, roles.surface]) {
      expect(contrastRatio(roles.ink, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(roles.muted, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(roles.accent, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(roles.focusRing, background)).toBeGreaterThanOrEqual(3);
    }
    expect(contrastRatio(roles.buttonText, roles.button)).toBeGreaterThanOrEqual(4.5);
  });
});
