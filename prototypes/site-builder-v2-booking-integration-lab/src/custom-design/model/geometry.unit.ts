import {
  calculateDisplayGeometry,
  canonicalizeNormalizedRect,
  clampNormalizedRect,
  createTapGestureState,
  customDesignTouchAction,
  isNearFullImageArea,
  moveNormalizedRect,
  normalizedRectToPixels,
  pixelRectToNormalized,
  rectanglesHaveInteriorOverlap,
  renderedAreaNeedsTargetWarning,
  resizeNormalizedRect,
  tapGestureShouldActivate,
  updateTapGestureForScroll,
  updateTapGestureState,
  validateNormalizedRect,
} from './geometry';

describe('Custom Design geometry', () => {
  const rect = { x: 10, y: 20, width: 30, height: 25 };
  const imageRect = { x: 50, y: 100, width: 400, height: 800 };

  it('round trips normalized and rendered-pixel rectangles', () => {
    const pixels = normalizedRectToPixels(rect, imageRect);
    expect(pixels).toEqual({ x: 90, y: 260, width: 120, height: 200 });
    expect(pixelRectToNormalized(pixels, imageRect)).toEqual(rect);
  });

  it('canonicalizes drag precision to two decimals with an explicit adjustment', () => {
    const pixels = normalizedRectToPixels(
      { x: 10.1234, y: 20.5678, width: 30.999, height: 25.001 },
      imageRect,
    );
    const normalized = pixelRectToNormalized(pixels, imageRect);
    expect(normalized).not.toBeNull();
    expect(canonicalizeNormalizedRect(normalized!)).toEqual({
      rect: { x: 10.12, y: 20.57, width: 31, height: 25 },
      adjusted: true,
    });
    expect(canonicalizeNormalizedRect({ x: 90.004, y: 0, width: 10.004, height: 10 })).toEqual({
      rect: { x: 90, y: 0, width: 10, height: 10 },
      adjusted: true,
    });
  });

  it('calculates poster, contained, and full-width display geometry', () => {
    expect(calculateDisplayGeometry({
      mode: 'poster',
      availableWidth: 1_200,
      intrinsicWidth: 800,
      intrinsicHeight: 1_600,
    })).toMatchObject({ x: 210, width: 780, height: 1_560 });
    expect(calculateDisplayGeometry({
      mode: 'contained',
      availableWidth: 920,
      intrinsicWidth: 800,
      intrinsicHeight: 1_600,
    })).toMatchObject({ x: 0, width: 920, height: 1_840 });
    expect(calculateDisplayGeometry({
      mode: 'full_width',
      availableWidth: 1_440,
      intrinsicWidth: 800,
      intrinsicHeight: 1_600,
    })).toMatchObject({ x: 0, width: 1_440, height: 2_880 });
    expect(calculateDisplayGeometry({
      mode: 'contained',
      availableWidth: 920,
      intrinsicWidth: 100,
      intrinsicHeight: 200,
      maximumUpscaleFactor: 1,
    })).toMatchObject({ x: 0, width: 920, height: 1_840 });
    expect(calculateDisplayGeometry({
      mode: 'poster',
      availableWidth: 920,
      intrinsicWidth: 100,
      intrinsicHeight: 200,
      maximumUpscaleFactor: 1.5,
    })).toMatchObject({ x: 385, width: 150, height: 300 });
    expect(calculateDisplayGeometry({
      mode: 'poster',
      availableWidth: 320,
      intrinsicWidth: 100,
      intrinsicHeight: 200,
      maximumUpscaleFactor: 1.5,
    })).toMatchObject({ x: 0, width: 320, height: 640 });
  });

  it('moves and resizes without storing pixel coordinates', () => {
    expect(moveNormalizedRect(rect, { x: 40, y: -80 }, {
      width: 400,
      height: 800,
    }).rect).toEqual({ x: 20, y: 10, width: 30, height: 25 });
    expect(resizeNormalizedRect(rect, 'south_east', { x: 40, y: 80 }, {
      width: 400,
      height: 800,
    }).rect).toEqual({ x: 10, y: 20, width: 40, height: 35 });
    expect(clampNormalizedRect({ x: 95, y: -1, width: 20, height: 10 })).toEqual({
      rect: { x: 80, y: 0, width: 20, height: 10 },
      adjusted: true,
    });
  });

  it('validates normalized bounds and rejects interior overlap but permits edge touch', () => {
    expect(validateNormalizedRect(rect)).toEqual([]);
    expect(validateNormalizedRect({ x: 90, y: 0, width: 11, height: 10 })).toContain(
      'x plus width must not exceed 100.',
    );
    expect(rectanglesHaveInteriorOverlap(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 19.99, y: 0, width: 20, height: 20 },
    )).toBe(true);
    expect(rectanglesHaveInteriorOverlap(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
    )).toBe(false);
    expect(rectanglesHaveInteriorOverlap(
      { x: 0.1, y: 0, width: 0.2, height: 10 },
      { x: 0.3, y: 0, width: 10, height: 10 },
    )).toBe(false);
    expect(rectanglesHaveInteriorOverlap(
      { x: 0.1, y: 0, width: 0.200_001, height: 10 },
      { x: 0.3, y: 0, width: 10, height: 10 },
    )).toBe(true);
  });

  it('rejects only overlays spanning at least 95% on both axes', () => {
    expect(isNearFullImageArea({ x: 0, y: 0, width: 94.99, height: 100 })).toBe(false);
    expect(isNearFullImageArea({ x: 0, y: 0, width: 95, height: 95 })).toBe(true);
    expect(isNearFullImageArea({ x: 0, y: 0, width: 100, height: 80 })).toBe(false);
  });

  it('warns without silently enlarging sub-44px targets', () => {
    const small = { x: 0, y: 0, width: 10, height: 10 };
    expect(renderedAreaNeedsTargetWarning(small, { width: 430, height: 430 })).toBe(true);
    expect(renderedAreaNeedsTargetWarning(small, { width: 440, height: 440 })).toBe(false);
    expect(small).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('cancels activation after meaningful pointer movement or page scroll', () => {
    const started = createTapGestureState({ x: 20, y: 20 }, { x: 0, y: 100 });
    expect(tapGestureShouldActivate(
      updateTapGestureState(started, { x: 20, y: 28 }),
    )).toBe(true);
    expect(tapGestureShouldActivate(
      updateTapGestureState(started, { x: 20, y: 28.01 }),
    )).toBe(false);
    expect(tapGestureShouldActivate(
      updateTapGestureForScroll(started, { x: 0, y: 109 }),
    )).toBe(false);
    expect(customDesignTouchAction).toBe('pan-y pinch-zoom');
  });
});
