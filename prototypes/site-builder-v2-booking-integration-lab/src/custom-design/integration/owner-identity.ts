import type {
  CustomDesignDisplayMode,
  CustomDesignImageItem,
  CustomDesignSettings,
} from '../model/types';

const DISPLAY_LABELS: Record<CustomDesignDisplayMode, string> = {
  contained: 'Contained',
  full_width: 'Full width',
  poster: 'Poster',
};

export type CustomDesignOwnerIdentity = {
  imageCount: number;
  label: 'Custom Design';
  longDescription: string;
  shortDescription: string;
};

const imageCountLabel = (count: number): string =>
  `${count} ${count === 1 ? 'image' : 'images'}`;

export const getCustomDesignOwnerIdentity = (
  settings: Pick<CustomDesignSettings, 'displayMode' | 'images'>,
): CustomDesignOwnerIdentity => {
  const imageCount = settings.images.length;
  if (imageCount === 0) {
    return {
      imageCount,
      label: 'Custom Design',
      longDescription: 'Empty',
      shortDescription: 'Empty',
    };
  }

  const count = imageCountLabel(imageCount);
  return {
    imageCount,
    label: 'Custom Design',
    longDescription: `${count} · ${DISPLAY_LABELS[settings.displayMode]}`,
    shortDescription: count,
  };
};

export const getCustomDesignImageAccessibilityStatus = (
  image: Pick<CustomDesignImageItem, 'altText' | 'decorative'>,
): 'Alt text added' | 'Decorative' | 'Needs alt text' => {
  if (image.decorative) {
    return 'Decorative';
  }
  return image.altText.trim() ? 'Alt text added' : 'Needs alt text';
};

export const customDesignDisplayLabel = (
  displayMode: CustomDesignDisplayMode,
): string => DISPLAY_LABELS[displayMode];
