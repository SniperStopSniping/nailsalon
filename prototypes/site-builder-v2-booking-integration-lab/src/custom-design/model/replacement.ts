import { CUSTOM_DESIGN_ASPECT_RATIO_REVIEW_THRESHOLD } from './constants';
import type {
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
  CustomDesignSettings,
} from './types';

export type CustomDesignReplacementMetadata = Pick<
  CustomDesignImageItem,
  | 'assetId'
  | 'fileName'
  | 'mimeType'
  | 'fileSize'
  | 'width'
  | 'height'
  | 'aspectRatio'
>;

/** Approved symmetric ratio: max(new / old, old / new) - 1. */
export const symmetricAspectRatioDelta = (
  first: number,
  second: number,
): number => {
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(second) ||
    first <= 0 ||
    second <= 0
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(first / second, second / first) - 1;
};

export const replacementPreservesAreaApproval = (
  oldAspectRatio: number,
  newAspectRatio: number,
): boolean => symmetricAspectRatioDelta(oldAspectRatio, newAspectRatio) <=
  CUSTOM_DESIGN_ASPECT_RATIO_REVIEW_THRESHOLD + Number.EPSILON;

export const replaceCustomDesignImage = (
  image: CustomDesignImageItem,
  replacement: CustomDesignReplacementMetadata,
): CustomDesignImageItem => {
  if (
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    !Number.isFinite(replacement.width) ||
    !Number.isFinite(replacement.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    replacement.width <= 0 ||
    replacement.height <= 0
  ) {
    throw new RangeError('Replacement dimensions must be positive finite numbers.');
  }
  const oldAspectRatio = image.width / image.height;
  const newAspectRatio = replacement.width / replacement.height;
  const preserveApproval = replacementPreservesAreaApproval(
    oldAspectRatio,
    newAspectRatio,
  );
  const interactiveAreas = image.interactiveAreas.map((area) => {
    if (area.reviewStatus === 'needs_review' || preserveApproval) return area;
    return {
      ...area,
      reviewStatus: 'needs_review' as const,
      reviewReason: 'aspect_ratio_changed' as const,
    };
  });

  return {
    ...image,
    ...replacement,
    aspectRatio: newAspectRatio,
    interactiveAreas,
  };
};

export const approveInteractiveAreaReview = (
  area: CustomDesignInteractiveArea,
): CustomDesignInteractiveArea => {
  const { reviewReason: _reviewReason, ...rest } = area;
  return { ...rest, reviewStatus: 'approved' };
};

export const hasUnresolvedAreaReviews = (
  settings: CustomDesignSettings,
): boolean => settings.images.some((image) =>
  image.interactiveAreas.some((area) => area.reviewStatus === 'needs_review'));

export type CustomDesignPublishBlocker = {
  imageItemId: string;
  areaId: string;
  reason: 'needs_review' | 'invalid' | 'label_unconfirmed';
};

/** Phase 2 must additionally resolve live targets and asset availability. */
export const getCustomDesignPublishBlockers = (
  settings: CustomDesignSettings,
): CustomDesignPublishBlocker[] => settings.images.flatMap((image) =>
  image.interactiveAreas.flatMap((area) => {
    const blockers: CustomDesignPublishBlocker[] = [];
    if (area.reviewStatus === 'needs_review') {
      blockers.push({ imageItemId: image.id, areaId: area.id, reason: 'needs_review' });
    }
    if (area.validationStatus === 'invalid') {
      blockers.push({ imageItemId: image.id, areaId: area.id, reason: 'invalid' });
    }
    if (!area.labelConfirmed) {
      blockers.push({
        imageItemId: image.id,
        areaId: area.id,
        reason: 'label_unconfirmed',
      });
    }
    return blockers;
  }));
