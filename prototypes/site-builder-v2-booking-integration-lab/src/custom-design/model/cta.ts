import {
  parseCustomDesignAction,
  resolveCustomDesignAction,
} from './actions';
import { parseBoundedSingleLineText } from './text';
import type {
  CustomDesignActionResolution,
  CustomDesignActionResolutionContext,
  CustomDesignCtaPlacement,
  CustomDesignImageItem,
  CustomDesignNativeCta,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => Object.keys(value).every(key => expected.includes(key));

export const parseCtaPlacement = (
  value: unknown,
): CustomDesignCtaPlacement | null => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }
  if (value.type === 'after_all') {
    return hasOnlyKeys(value, ['type']) ? { type: 'after_all' } : null;
  }
  if (
    value.type === 'after_image'
    && hasOnlyKeys(value, ['type', 'imageItemId'])
    && typeof value.imageItemId === 'string'
    && value.imageItemId.trim().length > 0
    && value.imageItemId.length <= 160
  ) {
    return { type: 'after_image', imageItemId: value.imageItemId };
  }
  return null;
};

export const parseNativeCta = (value: unknown): CustomDesignNativeCta | null => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }
  if (value.type === 'none') {
    return hasOnlyKeys(value, ['type']) ? { type: 'none' } : null;
  }
  const label = parseBoundedSingleLineText(value.label, 80);
  const placement = parseCtaPlacement(value.placement);
  if (!label || !placement) {
    return null;
  }

  if (value.type === 'book_now') {
    return hasOnlyKeys(value, ['type', 'label', 'placement'])
      ? { type: value.type, label, placement }
      : null;
  }
  if (value.type === 'custom' && hasOnlyKeys(value, [
    'type',
    'label',
    'placement',
    'action',
  ])) {
    const action = parseCustomDesignAction(value.action);
    return action ? { type: 'custom', label, placement, action } : null;
  }
  return null;
};

export const getCtaInsertionIndex = (
  cta: CustomDesignNativeCta,
  images: readonly Pick<CustomDesignImageItem, 'id'>[],
): number | null => {
  if (cta.type === 'none') {
    return null;
  }
  const placement = cta.placement;
  if (placement.type === 'after_all') {
    return images.length;
  }
  const imageIndex = images.findIndex(image => image.id === placement.imageItemId);
  return imageIndex === -1 ? images.length : imageIndex + 1;
};

export const repairCtaPlacementForImages = (
  cta: CustomDesignNativeCta,
  images: readonly Pick<CustomDesignImageItem, 'id'>[],
): CustomDesignNativeCta => {
  if (
    cta.type === 'none'
  ) {
    return cta;
  }
  const placement = cta.placement;
  if (
    placement.type === 'after_all'
    || images.some(image => image.id === placement.imageItemId)
  ) {
    return cta;
  }
  return { ...cta, placement: { type: 'after_all' } };
};

export type CustomDesignCtaPlacementReconciliation = {
  cta: CustomDesignNativeCta;
  placementRepaired: boolean;
  noticeReason?: 'anchor_image_removed';
};

export const reconcileCtaPlacementForImages = (
  cta: CustomDesignNativeCta,
  images: readonly Pick<CustomDesignImageItem, 'id'>[],
): CustomDesignCtaPlacementReconciliation => {
  const repaired = repairCtaPlacementForImages(cta, images);
  return repaired === cta
    ? { cta, placementRepaired: false }
    : {
        cta: repaired,
        placementRepaired: true,
        noticeReason: 'anchor_image_removed',
      };
};

export const resolveNativeCtaAction = (
  cta: Exclude<CustomDesignNativeCta, { type: 'none' }>,
  context: CustomDesignActionResolutionContext,
): CustomDesignActionResolution => {
  if (cta.type === 'book_now') {
    return resolveCustomDesignAction({ type: 'start_booking' }, context);
  }
  return resolveCustomDesignAction(cta.action, context);
};
