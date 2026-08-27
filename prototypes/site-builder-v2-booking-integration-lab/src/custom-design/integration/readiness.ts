import {
  isNearFullImageArea,
  rectanglesHaveInteriorOverlap,
  validateNormalizedRect,
} from '../model/geometry';
import type {
  CustomDesignAction,
  CustomDesignActionResolution,
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
  CustomDesignSettings,
} from '../model/types';

export type CustomDesignAssetAvailability = 'available' | 'error' | 'missing';

export type CustomDesignReadinessIssueCode =
  | 'action_unresolved'
  | 'alt_text_missing'
  | 'area_invalid'
  | 'asset_error'
  | 'asset_missing'
  | 'empty_section'
  | 'geometry_invalid'
  | 'label_unconfirmed'
  | 'needs_review'
  | 'overlap'
  | 'unsafe_full_image_area';

export type CustomDesignReadinessIssue = {
  areaId?: string;
  code: CustomDesignReadinessIssueCode;
  imageItemId?: string;
  message: string;
  source: 'area' | 'asset' | 'cta';
};

export type CustomDesignReadinessContext = {
  getAssetAvailability: (
    assetId: string,
    image: CustomDesignImageItem,
  ) => CustomDesignAssetAvailability;
  resolveAction: (
    action: CustomDesignAction,
    source:
      | { area: CustomDesignInteractiveArea; image: CustomDesignImageItem; type: 'area' }
      | { type: 'cta' },
  ) => CustomDesignActionResolution;
};

export type CustomDesignReadiness = {
  customerReady: boolean;
  issues: CustomDesignReadinessIssue[];
};

const issue = (
  code: CustomDesignReadinessIssueCode,
  message: string,
  source: CustomDesignReadinessIssue['source'],
  image?: CustomDesignImageItem,
  area?: CustomDesignInteractiveArea,
): CustomDesignReadinessIssue => ({
  code,
  message,
  source,
  ...(image ? { imageItemId: image.id } : {}),
  ...(area ? { areaId: area.id } : {}),
});

const areaReadinessIssues = (
  image: CustomDesignImageItem,
  area: CustomDesignInteractiveArea,
  overlapsAnotherArea: boolean,
  context: CustomDesignReadinessContext,
): CustomDesignReadinessIssue[] => {
  const issues: CustomDesignReadinessIssue[] = [];
  if (validateNormalizedRect(area.geometry).length > 0) {
    issues.push(issue(
      'geometry_invalid',
      'This link area has invalid geometry.',
      'area',
      image,
      area,
    ));
  }
  if (isNearFullImageArea(area.geometry)) {
    issues.push(issue(
      'unsafe_full_image_area',
      'A link area cannot cover nearly the whole image.',
      'area',
      image,
      area,
    ));
  }
  if (overlapsAnotherArea) {
    issues.push(issue(
      'overlap',
      'This link area overlaps another link area.',
      'area',
      image,
      area,
    ));
  }
  if (area.validationStatus !== 'valid') {
    issues.push(issue(
      'area_invalid',
      'This link area has not passed validation.',
      'area',
      image,
      area,
    ));
  }
  if (!area.labelConfirmed || !area.accessibleLabel.trim()) {
    issues.push(issue(
      'label_unconfirmed',
      'Confirm an accessible label before this link can be used.',
      'area',
      image,
      area,
    ));
  }
  if (area.reviewStatus === 'needs_review') {
    issues.push(issue(
      'needs_review',
      'Review this link position before clients can use it.',
      'area',
      image,
      area,
    ));
  }
  if (context.resolveAction(area.action, { area, image, type: 'area' }).status !== 'resolved') {
    issues.push(issue(
      'action_unresolved',
      'Choose an available destination before this link can be used.',
      'area',
      image,
      area,
    ));
  }
  return issues;
};

export const getCustomDesignReadiness = (
  settings: CustomDesignSettings,
  context: CustomDesignReadinessContext,
): CustomDesignReadiness => {
  const issues: CustomDesignReadinessIssue[] = [];
  if (settings.images.length === 0) {
    issues.push(issue(
      'empty_section',
      'Upload at least one image before this section can appear in Preview.',
      'asset',
    ));
  }
  for (const image of settings.images) {
    const availability = context.getAssetAvailability(image.assetId, image);
    if (availability !== 'available') {
      issues.push(issue(
        availability === 'missing' ? 'asset_missing' : 'asset_error',
        availability === 'missing'
          ? 'This design file is not available in this browser.'
          : 'This design file could not be read from browser storage.',
        'asset',
        image,
      ));
    }
    if (!image.decorative && !image.altText.trim()) {
      issues.push(issue(
        'alt_text_missing',
        'Add alt text or mark this image as decorative.',
        'asset',
        image,
      ));
    }
    const overlappingAreaIds = new Set<string>();
    image.interactiveAreas.forEach((area, index) => {
      for (const candidate of image.interactiveAreas.slice(index + 1)) {
        if (!rectanglesHaveInteriorOverlap(area.geometry, candidate.geometry)) {
          continue;
        }
        overlappingAreaIds.add(area.id);
        overlappingAreaIds.add(candidate.id);
      }
    });
    image.interactiveAreas.forEach((area) => {
      issues.push(...areaReadinessIssues(
        image,
        area,
        overlappingAreaIds.has(area.id),
        context,
      ));
    });
  }

  if (settings.cta.type === 'book_now') {
    const resolution = context.resolveAction({ type: 'start_booking' }, { type: 'cta' });
    if (resolution.status !== 'resolved') {
      issues.push(issue(
        'action_unresolved',
        'The Book now button needs an available Booking section.',
        'cta',
      ));
    }
  } else if (settings.cta.type === 'custom') {
    const resolution = context.resolveAction(settings.cta.action, { type: 'cta' });
    if (resolution.status !== 'resolved') {
      issues.push(issue(
        'action_unresolved',
        'Choose an available destination for this button.',
        'cta',
      ));
    }
  }

  return { customerReady: issues.length === 0, issues };
};

export const isCustomDesignAreaReadyForCustomer = (
  readiness: CustomDesignReadiness,
  imageItemId: string,
  areaId: string,
): boolean => !readiness.issues.some((candidate) =>
  candidate.imageItemId === imageItemId
  && (candidate.source === 'asset' || candidate.areaId === areaId));
