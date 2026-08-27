import {
  CUSTOM_DESIGN_GEOMETRY_EPSILON_PERCENT,
  CUSTOM_DESIGN_MIN_TOUCH_TARGET_PX,
  CUSTOM_DESIGN_NEAR_FULL_AXIS_PERCENT,
  CUSTOM_DESIGN_POSTER_MAX_WIDTH_PX,
  CUSTOM_DESIGN_POSTER_QUALITY_CAP_MIN_WIDTH_PX,
  CUSTOM_DESIGN_TAP_MOVEMENT_THRESHOLD_PX,
  CUSTOM_DESIGN_TOUCH_ACTION,
} from './constants';
import type {
  CustomDesignDisplayMode,
  CustomDesignNormalizedRect,
} from './types';

export type CustomDesignPixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CustomDesignDisplayGeometry = CustomDesignPixelRect & {
  scale: number;
};

export type CustomDesignResizeHandle =
  | 'north_west'
  | 'north'
  | 'north_east'
  | 'east'
  | 'south_east'
  | 'south'
  | 'south_west'
  | 'west';

export type CustomDesignGeometryAdjustment = {
  rect: CustomDesignNormalizedRect;
  adjusted: boolean;
};

export type CustomDesignTapGestureState = {
  originX: number;
  originY: number;
  latestX: number;
  latestY: number;
  scrollOriginX: number;
  scrollOriginY: number;
  latestScrollX: number;
  latestScrollY: number;
  cancelled: boolean;
};

const finite = (value: number): boolean => Number.isFinite(value);
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const validateNormalizedRect = (
  rect: CustomDesignNormalizedRect,
): string[] => {
  const issues: string[] = [];
  if (![rect.x, rect.y, rect.width, rect.height].every(finite)) {
    return ['Clickable-area geometry must contain finite numbers.'];
  }
  if (rect.x < 0 || rect.x > 100) issues.push('x must be between 0 and 100.');
  if (rect.y < 0 || rect.y > 100) issues.push('y must be between 0 and 100.');
  if (rect.width <= 0 || rect.width > 100) {
    issues.push('width must be greater than 0 and at most 100.');
  }
  if (rect.height <= 0 || rect.height > 100) {
    issues.push('height must be greater than 0 and at most 100.');
  }
  if (rect.x + rect.width > 100) {
    issues.push('x plus width must not exceed 100.');
  }
  if (rect.y + rect.height > 100) {
    issues.push('y plus height must not exceed 100.');
  }
  return issues;
};

/**
 * Returns an explicit adjustment flag so callers can ask the owner to confirm
 * a change instead of silently mutating persisted geometry.
 */
export const clampNormalizedRect = (
  rect: CustomDesignNormalizedRect,
): CustomDesignGeometryAdjustment => {
  const safeWidth = finite(rect.width) ? clamp(rect.width, 0.01, 100) : 0.01;
  const safeHeight = finite(rect.height) ? clamp(rect.height, 0.01, 100) : 0.01;
  const safeX = finite(rect.x) ? clamp(rect.x, 0, 100 - safeWidth) : 0;
  const safeY = finite(rect.y) ? clamp(rect.y, 0, 100 - safeHeight) : 0;
  const adjusted =
    safeX !== rect.x ||
    safeY !== rect.y ||
    safeWidth !== rect.width ||
    safeHeight !== rect.height;
  return {
    rect: { x: safeX, y: safeY, width: safeWidth, height: safeHeight },
    adjusted,
  };
};

const roundNormalizedCoordinate = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/** Canonical persisted geometry: two decimals, then explicit bounded repair. */
export const canonicalizeNormalizedRect = (
  rect: CustomDesignNormalizedRect,
): CustomDesignGeometryAdjustment => {
  const rounded: CustomDesignNormalizedRect = {
    x: roundNormalizedCoordinate(rect.x),
    y: roundNormalizedCoordinate(rect.y),
    width: roundNormalizedCoordinate(rect.width),
    height: roundNormalizedCoordinate(rect.height),
  };
  const clamped = clampNormalizedRect(rounded);
  return {
    rect: clamped.rect,
    adjusted: clamped.adjusted ||
      rounded.x !== rect.x ||
      rounded.y !== rect.y ||
      rounded.width !== rect.width ||
      rounded.height !== rect.height,
  };
};

export const normalizedRectToPixels = (
  rect: CustomDesignNormalizedRect,
  imageRect: CustomDesignPixelRect,
): CustomDesignPixelRect => ({
  x: imageRect.x + (rect.x / 100) * imageRect.width,
  y: imageRect.y + (rect.y / 100) * imageRect.height,
  width: (rect.width / 100) * imageRect.width,
  height: (rect.height / 100) * imageRect.height,
});

export const pixelRectToNormalized = (
  rect: CustomDesignPixelRect,
  imageRect: CustomDesignPixelRect,
): CustomDesignNormalizedRect | null => {
  if (
    imageRect.width <= 0 ||
    imageRect.height <= 0 ||
    ![
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      imageRect.x,
      imageRect.y,
      imageRect.width,
      imageRect.height,
    ].every(finite)
  ) {
    return null;
  }
  return {
    x: ((rect.x - imageRect.x) / imageRect.width) * 100,
    y: ((rect.y - imageRect.y) / imageRect.height) * 100,
    width: (rect.width / imageRect.width) * 100,
    height: (rect.height / imageRect.height) * 100,
  };
};

export const calculateDisplayGeometry = ({
  mode,
  availableWidth,
  intrinsicWidth,
  intrinsicHeight,
  posterMaximumWidth = CUSTOM_DESIGN_POSTER_MAX_WIDTH_PX,
  maximumUpscaleFactor = 1.5,
}: {
  mode: CustomDesignDisplayMode;
  availableWidth: number;
  intrinsicWidth: number;
  intrinsicHeight: number;
  posterMaximumWidth?: number;
  maximumUpscaleFactor?: number;
}): CustomDesignDisplayGeometry | null => {
  if (
    ![availableWidth, intrinsicWidth, intrinsicHeight].every(finite) ||
    availableWidth <= 0 ||
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0
  ) {
    return null;
  }

  const qualityWidth = intrinsicWidth * Math.max(1, maximumUpscaleFactor);
  const modeWidth = mode === 'poster'
    ? Math.min(availableWidth, posterMaximumWidth)
    : availableWidth;
  const shouldApplyPosterQualityCap =
    mode === 'poster' &&
    availableWidth >= CUSTOM_DESIGN_POSTER_QUALITY_CAP_MIN_WIDTH_PX;
  const width = shouldApplyPosterQualityCap
    ? Math.min(modeWidth, qualityWidth)
    : modeWidth;
  const height = width * (intrinsicHeight / intrinsicWidth);
  return {
    x: (availableWidth - width) / 2,
    y: 0,
    width,
    height,
    scale: width / intrinsicWidth,
  };
};

export const moveNormalizedRect = (
  rect: CustomDesignNormalizedRect,
  deltaPixels: { x: number; y: number },
  renderedImage: { width: number; height: number },
): CustomDesignGeometryAdjustment => {
  if (renderedImage.width <= 0 || renderedImage.height <= 0) {
    return { rect, adjusted: true };
  }
  return clampNormalizedRect({
    ...rect,
    x: rect.x + (deltaPixels.x / renderedImage.width) * 100,
    y: rect.y + (deltaPixels.y / renderedImage.height) * 100,
  });
};

export const resizeNormalizedRect = (
  rect: CustomDesignNormalizedRect,
  handle: CustomDesignResizeHandle,
  deltaPixels: { x: number; y: number },
  renderedImage: { width: number; height: number },
): CustomDesignGeometryAdjustment => {
  if (renderedImage.width <= 0 || renderedImage.height <= 0) {
    return { rect, adjusted: true };
  }
  const dx = (deltaPixels.x / renderedImage.width) * 100;
  const dy = (deltaPixels.y / renderedImage.height) * 100;
  let { x, y, width, height } = rect;

  if (handle.includes('west')) {
    x += dx;
    width -= dx;
  }
  if (handle.includes('east')) width += dx;
  if (handle.includes('north')) {
    y += dy;
    height -= dy;
  }
  if (handle.includes('south')) height += dy;

  return clampNormalizedRect({ x, y, width, height });
};

export const rectanglesHaveInteriorOverlap = (
  first: CustomDesignNormalizedRect,
  second: CustomDesignNormalizedRect,
): boolean => {
  const overlapWidth = Math.min(first.x + first.width, second.x + second.width)
    - Math.max(first.x, second.x);
  const overlapHeight = Math.min(first.y + first.height, second.y + second.height)
    - Math.max(first.y, second.y);
  return overlapWidth > CUSTOM_DESIGN_GEOMETRY_EPSILON_PERCENT &&
    overlapHeight > CUSTOM_DESIGN_GEOMETRY_EPSILON_PERCENT;
};

export const isNearFullImageArea = (
  rect: CustomDesignNormalizedRect,
): boolean => rect.width >= CUSTOM_DESIGN_NEAR_FULL_AXIS_PERCENT &&
  rect.height >= CUSTOM_DESIGN_NEAR_FULL_AXIS_PERCENT;

export const renderedAreaNeedsTargetWarning = (
  rect: CustomDesignNormalizedRect,
  renderedImage: { width: number; height: number },
): boolean => {
  const renderedWidth = (rect.width / 100) * renderedImage.width;
  const renderedHeight = (rect.height / 100) * renderedImage.height;
  return renderedWidth < CUSTOM_DESIGN_MIN_TOUCH_TARGET_PX ||
    renderedHeight < CUSTOM_DESIGN_MIN_TOUCH_TARGET_PX;
};

export const createTapGestureState = (
  point: { x: number; y: number },
  scroll = { x: 0, y: 0 },
): CustomDesignTapGestureState => ({
  originX: point.x,
  originY: point.y,
  latestX: point.x,
  latestY: point.y,
  scrollOriginX: scroll.x,
  scrollOriginY: scroll.y,
  latestScrollX: scroll.x,
  latestScrollY: scroll.y,
  cancelled: false,
});

export const updateTapGestureState = (
  state: CustomDesignTapGestureState,
  point: { x: number; y: number },
): CustomDesignTapGestureState => {
  const movement = Math.hypot(point.x - state.originX, point.y - state.originY);
  return {
    ...state,
    latestX: point.x,
    latestY: point.y,
    cancelled: state.cancelled || movement > CUSTOM_DESIGN_TAP_MOVEMENT_THRESHOLD_PX,
  };
};

export const updateTapGestureForScroll = (
  state: CustomDesignTapGestureState,
  scroll: { x: number; y: number },
): CustomDesignTapGestureState => {
  const movement = Math.hypot(
    scroll.x - state.scrollOriginX,
    scroll.y - state.scrollOriginY,
  );
  return {
    ...state,
    latestScrollX: scroll.x,
    latestScrollY: scroll.y,
    cancelled: state.cancelled || movement > CUSTOM_DESIGN_TAP_MOVEMENT_THRESHOLD_PX,
  };
};

export const cancelTapGesture = (
  state: CustomDesignTapGestureState,
): CustomDesignTapGestureState => ({ ...state, cancelled: true });

export const tapGestureShouldActivate = (
  state: CustomDesignTapGestureState,
): boolean => !state.cancelled;

export const customDesignTouchAction = CUSTOM_DESIGN_TOUCH_ACTION;
