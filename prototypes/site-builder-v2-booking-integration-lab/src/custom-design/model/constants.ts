export const CUSTOM_DESIGN_SETTINGS_VERSION = 1 as const;

export const CUSTOM_DESIGN_MAX_IMAGES = 10;
export const CUSTOM_DESIGN_MAX_AREAS_PER_IMAGE = 8;
export const CUSTOM_DESIGN_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const CUSTOM_DESIGN_MAX_SECTION_BYTES = 75 * 1024 * 1024;
export const CUSTOM_DESIGN_MAX_IMAGE_DIMENSION = 32_768;
export const CUSTOM_DESIGN_MAX_IMAGE_PIXELS = 50_000_000;
export const CUSTOM_DESIGN_MIN_TOUCH_TARGET_PX = 44;
export const CUSTOM_DESIGN_POSTER_MAX_WIDTH_PX = 780;
/** Paired with the isolated renderer's named inline-size container query. */
export const CUSTOM_DESIGN_POSTER_QUALITY_CAP_MIN_WIDTH_PX = 600;

/** Ignores sub-pixel floating-point noise while still rejecting real overlap. */
export const CUSTOM_DESIGN_GEOMETRY_EPSILON_PERCENT = 0.000_000_1;

/** An area spanning at least 95% on both axes is an unsafe full-image overlay. */
export const CUSTOM_DESIGN_NEAR_FULL_AXIS_PERCENT = 95;

/** Symmetric aspect-ratio delta at or below 5% preserves approved areas. */
export const CUSTOM_DESIGN_ASPECT_RATIO_REVIEW_THRESHOLD = 0.05;

export const CUSTOM_DESIGN_TAP_MOVEMENT_THRESHOLD_PX = 8;
export const CUSTOM_DESIGN_TOUCH_ACTION = 'pan-y pinch-zoom' as const;

export const CUSTOM_DESIGN_BACKUP_WARNING =
  'Uploaded design files are stored in this browser and aren\u2019t included in the JSON backup.';

export const CUSTOM_DESIGN_SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export const CUSTOM_DESIGN_DISPLAY_MODES = [
  'poster',
  'contained',
  'full_width',
] as const;

export const CUSTOM_DESIGN_GAPS = [
  'seamless',
  'small',
  'comfortable',
] as const;
