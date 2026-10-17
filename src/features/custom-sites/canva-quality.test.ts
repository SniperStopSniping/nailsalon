import { describe, expect, it } from 'vitest';

import { canvaImageQuality, canvaPageWidth, sameCanvaProportions } from './canva-quality';

describe('Canva upload resolution and proportional fitting', () => {
  it.each([
    [{ width: 279, height: 1280 }, 600, 'small', 1200],
    [{ width: 800, height: 3200 }, 600, 'standard', 1200],
    [{ width: 1200, height: 6000 }, 600, 'sharp', 1200],
    [{ width: 1600, height: 1600 }, 800, 'sharp', 1600],
    [{ width: 2400, height: 1200 }, 1200, 'sharp', 2400],
  ] as const)('fits %o independently of source pixel width and gives honest resolution advice', (page, displayWidth, level, recommendedWidth) => {
    expect(canvaPageWidth(page)).toBe(displayWidth);
    expect(canvaImageQuality(page)).toMatchObject({ level, displayWidth, recommendedWidth, recommendedHeight: Math.round(recommendedWidth * page.height / page.width) });
  });

  it('retains normalized link positions only for the same proportions, allowing export rounding', () => {
    const original = { width: 279, height: 1280 };

    expect(sameCanvaProportions(original, { width: 1116, height: 5120 })).toBe(true);
    expect(sameCanvaProportions(original, { width: 1200, height: 5505 })).toBe(true);
    expect(sameCanvaProportions(original, { width: 1200, height: 5000 })).toBe(false);
    expect(sameCanvaProportions(original, { width: 1280, height: 279 })).toBe(false);
    expect(sameCanvaProportions(original, { width: 0, height: 1280 })).toBe(false);
  });
});
