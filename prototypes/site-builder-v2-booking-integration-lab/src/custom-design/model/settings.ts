import { parseCustomDesignAction } from './actions';
import {
  CUSTOM_DESIGN_DISPLAY_MODES,
  CUSTOM_DESIGN_GAPS,
  CUSTOM_DESIGN_MAX_AREAS_PER_IMAGE,
  CUSTOM_DESIGN_MAX_FILE_BYTES,
  CUSTOM_DESIGN_MAX_IMAGE_DIMENSION,
  CUSTOM_DESIGN_MAX_IMAGE_PIXELS,
  CUSTOM_DESIGN_MAX_IMAGES,
  CUSTOM_DESIGN_MAX_SECTION_BYTES,
  CUSTOM_DESIGN_SETTINGS_VERSION,
  CUSTOM_DESIGN_SUPPORTED_MIME_TYPES,
} from './constants';
import { parseNativeCta, repairCtaPlacementForImages } from './cta';
import {
  isNearFullImageArea,
  rectanglesHaveInteriorOverlap,
  validateNormalizedRect,
} from './geometry';
import {
  parseBoundedMultilinePlainText,
  parseBoundedSingleLineText,
} from './text';
import type {
  CustomDesignAreaReviewReason,
  CustomDesignBackground,
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
  CustomDesignNormalizedRect,
  CustomDesignSettings,
  CustomDesignValidationResult,
} from './types';

const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/u;
const IMAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => Object.keys(value).every((key) => expected.includes(key));

const asIdentifier = (value: unknown): string | null =>
  typeof value === 'string' && IMAGE_ID_PATTERN.test(value) ? value : null;

const asPositiveInteger = (value: unknown): number | null =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value > 0
    ? value
    : null;

const asNonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0
    ? value
    : null;

export const normalizeCustomDesignHexColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : null;
};

const parseBackground = (value: unknown): CustomDesignBackground | null => {
  if (!isRecord(value) || typeof value.mode !== 'string') return null;
  if (value.mode === 'site' || value.mode === 'transparent') {
    return hasOnlyKeys(value, ['mode']) ? { mode: value.mode } : null;
  }
  if (value.mode === 'custom' && hasOnlyKeys(value, ['mode', 'color'])) {
    const color = normalizeCustomDesignHexColor(value.color);
    return color ? { mode: 'custom', color } : null;
  }
  return null;
};

const parseLegacyBackground = (
  value: Record<string, unknown>,
): CustomDesignBackground | null => {
  if (value.backgroundMode === 'site' || value.backgroundMode === 'transparent') {
    return { mode: value.backgroundMode };
  }
  if (value.backgroundMode === 'custom') {
    const color = normalizeCustomDesignHexColor(value.customBackground);
    return color ? { mode: 'custom', color } : null;
  }
  return null;
};

const parseRect = (value: unknown): CustomDesignNormalizedRect | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['x', 'y', 'width', 'height'])) {
    return null;
  }
  if (
    typeof value.x !== 'number' ||
    typeof value.y !== 'number' ||
    typeof value.width !== 'number' ||
    typeof value.height !== 'number'
  ) {
    return null;
  }
  const rect: CustomDesignNormalizedRect = {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  };
  if (validateNormalizedRect(rect).length > 0 || isNearFullImageArea(rect)) {
    return null;
  }
  return rect;
};

const parseReview = (
  value: Record<string, unknown>,
): Pick<CustomDesignInteractiveArea, 'reviewStatus' | 'reviewReason'> | null => {
  if (value.reviewStatus === 'approved') {
    return value.reviewReason === undefined
      ? { reviewStatus: 'approved' }
      : null;
  }
  if (value.reviewStatus === 'needs_review') {
    const reason: CustomDesignAreaReviewReason | null =
      value.reviewReason === 'aspect_ratio_changed' ||
      value.reviewReason === 'owner_review_required'
        ? value.reviewReason
        : null;
    return reason ? { reviewStatus: 'needs_review', reviewReason: reason } : null;
  }
  return null;
};

const parseInteractiveArea = (
  value: unknown,
): CustomDesignInteractiveArea | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'geometry',
      'semanticOrder',
      'accessibleLabel',
      'labelConfirmed',
      'action',
      'validationStatus',
      'reviewStatus',
      'reviewReason',
    ])
  ) {
    return null;
  }
  const id = asIdentifier(value.id);
  const geometry = parseRect(value.geometry);
  const semanticOrder = asNonNegativeInteger(value.semanticOrder);
  const accessibleLabel = parseBoundedSingleLineText(
    value.accessibleLabel,
    200,
    true,
  );
  const action = parseCustomDesignAction(value.action);
  const review = parseReview(value);
  if (
    !id ||
    !geometry ||
    semanticOrder === null ||
    accessibleLabel === null ||
    typeof value.labelConfirmed !== 'boolean' ||
    !action ||
    !review ||
    (value.validationStatus !== 'valid' && value.validationStatus !== 'invalid')
  ) {
    return null;
  }
  const staticallyValid = value.labelConfirmed && accessibleLabel.length > 0;
  if (
    (staticallyValid && value.validationStatus !== 'valid') ||
    (!staticallyValid && value.validationStatus !== 'invalid')
  ) {
    return null;
  }
  return {
    id,
    geometry,
    semanticOrder,
    accessibleLabel,
    labelConfirmed: value.labelConfirmed,
    action,
    validationStatus: value.validationStatus,
    ...review,
  };
};

export const validateCustomDesignImageMetadata = (
  value: unknown,
): CustomDesignValidationResult<CustomDesignImageItem> => {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { success: false, issues: ['Image item must be an object.'] };
  }
  if (!hasOnlyKeys(value, [
    'id',
    'assetId',
    'fileName',
    'mimeType',
    'fileSize',
    'width',
    'height',
    'aspectRatio',
    'altText',
    'decorative',
    'accessibleSummary',
    'interactiveAreas',
  ])) {
    issues.push('Image item has unknown fields.');
  }
  const id = asIdentifier(value.id);
  const assetId = asIdentifier(value.assetId);
  const fileName = parseBoundedSingleLineText(value.fileName, 255);
  const mimeType = CUSTOM_DESIGN_SUPPORTED_MIME_TYPES.find(
    (candidate) => candidate === value.mimeType,
  );
  const fileSize = asPositiveInteger(value.fileSize);
  const width = asPositiveInteger(value.width);
  const height = asPositiveInteger(value.height);
  const altText = parseBoundedSingleLineText(value.altText, 500, true);
  const accessibleSummary = value.accessibleSummary === undefined
    ? undefined
    : parseBoundedMultilinePlainText(value.accessibleSummary, 5_000);

  if (!id) issues.push('Image item ID is invalid.');
  if (!assetId) issues.push('Asset ID is invalid.');
  if (!fileName) issues.push('File name is invalid.');
  if (!mimeType) issues.push('Only PNG, JPEG, and WebP image metadata is supported.');
  if (!fileSize || fileSize > CUSTOM_DESIGN_MAX_FILE_BYTES) {
    issues.push(`Image file size must be at most ${CUSTOM_DESIGN_MAX_FILE_BYTES} bytes.`);
  }
  if (!width || width > CUSTOM_DESIGN_MAX_IMAGE_DIMENSION) {
    issues.push(`Image width must be at most ${CUSTOM_DESIGN_MAX_IMAGE_DIMENSION}px.`);
  }
  if (!height || height > CUSTOM_DESIGN_MAX_IMAGE_DIMENSION) {
    issues.push(`Image height must be at most ${CUSTOM_DESIGN_MAX_IMAGE_DIMENSION}px.`);
  }
  if (width && height && width * height > CUSTOM_DESIGN_MAX_IMAGE_PIXELS) {
    issues.push(`Image must contain at most ${CUSTOM_DESIGN_MAX_IMAGE_PIXELS} pixels.`);
  }
  const canonicalAspectRatio = width && height ? width / height : null;
  if (
    typeof value.aspectRatio !== 'number' ||
    !Number.isFinite(value.aspectRatio) ||
    value.aspectRatio <= 0 ||
    (canonicalAspectRatio !== null &&
      Math.abs(value.aspectRatio - canonicalAspectRatio) / canonicalAspectRatio > 0.000_001)
  ) {
    issues.push('Image aspect ratio must match its dimensions.');
  }
  if (altText === null) issues.push('Alt text is invalid.');
  if (typeof value.decorative !== 'boolean') {
    issues.push('Decorative must be a boolean.');
  } else if (value.decorative && altText !== '') {
    issues.push('Decorative images must use empty alt text.');
  }
  if (value.accessibleSummary !== undefined && accessibleSummary === null) {
    issues.push('Accessible summary is invalid.');
  }
  if (!Array.isArray(value.interactiveAreas)) {
    issues.push('Interactive areas must be an array.');
  } else if (value.interactiveAreas.length > CUSTOM_DESIGN_MAX_AREAS_PER_IMAGE) {
    issues.push(`An image can have at most ${CUSTOM_DESIGN_MAX_AREAS_PER_IMAGE} clickable areas.`);
  }

  const interactiveAreas: CustomDesignInteractiveArea[] = [];
  if (Array.isArray(value.interactiveAreas)) {
    const ids = new Set<string>();
    const orders = new Set<number>();
    value.interactiveAreas.forEach((candidate, index) => {
      const area = parseInteractiveArea(candidate);
      if (!area) {
        issues.push(`Clickable area ${index + 1} is invalid.`);
        return;
      }
      if (ids.has(area.id)) issues.push(`Clickable area ID ${area.id} is duplicated.`);
      if (orders.has(area.semanticOrder)) {
        issues.push(`Clickable area order ${area.semanticOrder} is duplicated.`);
      }
      const overlap = interactiveAreas.find((other) =>
        rectanglesHaveInteriorOverlap(other.geometry, area.geometry));
      if (overlap) {
        issues.push(`Clickable areas ${overlap.id} and ${area.id} overlap.`);
      }
      ids.add(area.id);
      orders.add(area.semanticOrder);
      interactiveAreas.push(area);
    });
  }

  if (
    issues.length > 0 ||
    !id ||
    !assetId ||
    !fileName ||
    !mimeType ||
    !fileSize ||
    !width ||
    !height ||
    altText === null ||
    typeof value.aspectRatio !== 'number' ||
    typeof value.decorative !== 'boolean'
  ) {
    return { success: false, issues };
  }
  return {
    success: true,
    value: {
      id,
      assetId,
      fileName,
      mimeType,
      fileSize,
      width,
      height,
      aspectRatio: width / height,
      altText,
      decorative: value.decorative,
      ...(accessibleSummary ? { accessibleSummary } : {}),
      interactiveAreas: interactiveAreas.sort(
        (first, second) => first.semanticOrder - second.semanticOrder,
      ),
    },
  };
};

export const createDefaultCustomDesignSettings = (): CustomDesignSettings => ({
  schemaVersion: CUSTOM_DESIGN_SETTINGS_VERSION,
  images: [],
  displayMode: 'poster',
  gap: 'small',
  background: { mode: 'site' },
  cta: { type: 'none' },
});

const parseImagesDefensively = (value: unknown): CustomDesignImageItem[] => {
  if (!Array.isArray(value)) return [];
  const images: CustomDesignImageItem[] = [];
  const imageIds = new Set<string>();
  const areaIds = new Set<string>();
  const assets = new Map<string, CustomDesignImageItem>();
  let totalBytes = 0;
  for (const candidate of value) {
    if (images.length >= CUSTOM_DESIGN_MAX_IMAGES) break;
    const result = validateCustomDesignImageMetadata(salvageNestedAreas(candidate));
    if (!result.success || imageIds.has(result.value.id)) continue;
    const priorAsset = assets.get(result.value.assetId);
    if (priorAsset && !assetMetadataMatches(priorAsset, result.value)) continue;
    if (totalBytes + result.value.fileSize > CUSTOM_DESIGN_MAX_SECTION_BYTES) continue;
    const interactiveAreas = result.value.interactiveAreas.filter((area) => {
      if (areaIds.has(area.id)) return false;
      areaIds.add(area.id);
      return true;
    });
    const image = interactiveAreas.length === result.value.interactiveAreas.length
      ? result.value
      : { ...result.value, interactiveAreas };
    images.push(image);
    imageIds.add(image.id);
    assets.set(image.assetId, image);
    totalBytes += image.fileSize;
  }
  return images;
};

const assetMetadataMatches = (
  first: Pick<
    CustomDesignImageItem,
    'assetId' | 'fileName' | 'mimeType' | 'fileSize' | 'width' | 'height'
  >,
  second: Pick<
    CustomDesignImageItem,
    'assetId' | 'fileName' | 'mimeType' | 'fileSize' | 'width' | 'height'
  >,
): boolean => first.assetId === second.assetId &&
  first.fileName === second.fileName &&
  first.mimeType === second.mimeType &&
  first.fileSize === second.fileSize &&
  first.width === second.width &&
  first.height === second.height;

const salvageNestedAreas = (value: unknown): unknown => {
  if (!isRecord(value) || !Array.isArray(value.interactiveAreas)) return value;
  const areas: CustomDesignInteractiveArea[] = [];
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const candidate of value.interactiveAreas) {
    if (areas.length >= CUSTOM_DESIGN_MAX_AREAS_PER_IMAGE) break;
    const area = parseInteractiveArea(candidate);
    if (
      !area ||
      ids.has(area.id) ||
      orders.has(area.semanticOrder) ||
      areas.some((other) => rectanglesHaveInteriorOverlap(other.geometry, area.geometry))
    ) {
      continue;
    }
    areas.push(area);
    ids.add(area.id);
    orders.add(area.semanticOrder);
  }
  return { ...value, interactiveAreas: areas };
};

export const parseCustomDesignSettings = (value: unknown): CustomDesignSettings => {
  const defaults = createDefaultCustomDesignSettings();
  if (!isRecord(value)) return defaults;
  const images = parseImagesDefensively(value.images);
  const displayMode = CUSTOM_DESIGN_DISPLAY_MODES.find(
    (candidate) => candidate === value.displayMode,
  ) ?? defaults.displayMode;
  const gap = CUSTOM_DESIGN_GAPS.find((candidate) => candidate === value.gap) ??
    defaults.gap;
  const background = parseBackground(value.background) ??
    parseLegacyBackground(value) ??
    defaults.background;
  const cta = repairCtaPlacementForImages(parseNativeCta(value.cta) ?? defaults.cta, images);
  return {
    schemaVersion: CUSTOM_DESIGN_SETTINGS_VERSION,
    images,
    displayMode,
    gap,
    background,
    cta,
  };
};

export const validateCustomDesignSettings = (
  value: unknown,
): CustomDesignValidationResult<CustomDesignSettings> => {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { success: false, issues: ['Custom Design settings must be an object.'] };
  }
  if (!hasOnlyKeys(value, [
    'schemaVersion',
    'images',
    'displayMode',
    'gap',
    'background',
    'cta',
  ])) {
    issues.push('Custom Design settings have unknown fields.');
  }
  if (value.schemaVersion !== CUSTOM_DESIGN_SETTINGS_VERSION) {
    issues.push(`Custom Design schemaVersion must be ${CUSTOM_DESIGN_SETTINGS_VERSION}.`);
  }
  if (!Array.isArray(value.images)) {
    issues.push('images must be an array.');
  } else if (value.images.length > CUSTOM_DESIGN_MAX_IMAGES) {
    issues.push(`A section can have at most ${CUSTOM_DESIGN_MAX_IMAGES} images.`);
  }

  const images: CustomDesignImageItem[] = [];
  const imageIds = new Set<string>();
  const areaIds = new Set<string>();
  const assets = new Map<string, CustomDesignImageItem>();
  if (Array.isArray(value.images)) {
    value.images.forEach((candidate, index) => {
      const result = validateCustomDesignImageMetadata(candidate);
      if (!result.success) {
        issues.push(...result.issues.map((issue) => `Image ${index + 1}: ${issue}`));
        return;
      }
      if (imageIds.has(result.value.id)) {
        issues.push(`Image item ID ${result.value.id} is duplicated.`);
      }
      imageIds.add(result.value.id);
      for (const area of result.value.interactiveAreas) {
        if (areaIds.has(area.id)) {
          issues.push(`Clickable area ID ${area.id} is duplicated across images.`);
        }
        areaIds.add(area.id);
      }
      const priorAsset = assets.get(result.value.assetId);
      if (priorAsset && !assetMetadataMatches(priorAsset, result.value)) {
        issues.push(`Asset ID ${result.value.assetId} has conflicting image metadata.`);
      }
      assets.set(result.value.assetId, result.value);
      images.push(result.value);
    });
  }
  const totalBytes = images.reduce((total, image) => total + image.fileSize, 0);
  if (totalBytes > CUSTOM_DESIGN_MAX_SECTION_BYTES) {
    issues.push(`Section image files must total at most ${CUSTOM_DESIGN_MAX_SECTION_BYTES} bytes.`);
  }
  if (!CUSTOM_DESIGN_DISPLAY_MODES.includes(value.displayMode as never)) {
    issues.push('Display mode is invalid.');
  }
  if (!CUSTOM_DESIGN_GAPS.includes(value.gap as never)) issues.push('Image gap is invalid.');
  const background = parseBackground(value.background);
  if (!background) issues.push('Background is invalid.');
  const cta = parseNativeCta(value.cta);
  if (!cta) {
    issues.push('Native CTA is invalid.');
  } else if (
    cta.type !== 'none' &&
    cta.placement.type === 'after_image' &&
    !imageIds.has(cta.placement.imageItemId)
  ) {
    issues.push('Native CTA placement references a missing image item.');
  }

  if (
    issues.length > 0 ||
    value.schemaVersion !== CUSTOM_DESIGN_SETTINGS_VERSION ||
    !CUSTOM_DESIGN_DISPLAY_MODES.includes(value.displayMode as never) ||
    !CUSTOM_DESIGN_GAPS.includes(value.gap as never) ||
    !background ||
    !cta
  ) {
    return { success: false, issues };
  }
  return {
    success: true,
    value: {
      schemaVersion: CUSTOM_DESIGN_SETTINGS_VERSION,
      images,
      displayMode: value.displayMode as CustomDesignSettings['displayMode'],
      gap: value.gap as CustomDesignSettings['gap'],
      background,
      cta,
    },
  };
};
