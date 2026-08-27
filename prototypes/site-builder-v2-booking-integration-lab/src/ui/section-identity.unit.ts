import { createDefaultCustomDesignSettings } from '../custom-design/model/settings';
import type { CustomDesignSectionInstance } from '../model/types';
import { getSectionOwnerIdentity } from './section-identity';

const customSection = (
  imageCount = 0,
): CustomDesignSectionInstance => ({
  id: 'section_custom',
  label: 'Custom Design',
  order: 0,
  sectionType: 'custom_design',
  settings: {
    ...createDefaultCustomDesignSettings(),
    images: Array.from({ length: imageCount }, (_, index) => ({
      id: `image_${index}`,
      assetId: `asset_${index}`,
      fileName: `page-${index + 1}.png`,
      mimeType: 'image/png' as const,
      fileSize: 1_024,
      width: 1_000,
      height: 2_000,
      aspectRatio: 0.5,
      altText: '',
      decorative: false,
      interactiveAreas: [],
    })),
  },
  visible: true,
});

describe('section owner identity', () => {
  it('uses the approved empty Custom Design identity', () => {
    expect(getSectionOwnerIdentity(customSection())).toMatchObject({
      detail: 'Empty',
      label: 'Custom Design',
      mark: 'CD',
      short: 'Empty',
    });
  });

  it('uses an image count and display mode without placeholder fields', () => {
    expect(getSectionOwnerIdentity(customSection(3))).toMatchObject({
      detail: '3 images · Poster',
      recoveryDetail: '3 images · settings and links retained',
      short: '3 images',
    });
  });
});
