import { createCustomDesignAssetManifest } from './backup';
import {
  CUSTOM_DESIGN_MAX_FILE_BYTES,
  CUSTOM_DESIGN_MAX_IMAGES,
  CUSTOM_DESIGN_MAX_SECTION_BYTES,
} from './constants';
import { createDeterministicCustomDesignIdFactory } from './ids';
import {
  createDefaultCustomDesignSettings,
  parseCustomDesignSettings,
  validateCustomDesignImageMetadata,
  validateCustomDesignSettings,
} from './settings';
import type {
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
} from './types';

const area = (overrides: Partial<CustomDesignInteractiveArea> = {}): CustomDesignInteractiveArea => ({
  id: 'area_1',
  geometry: { x: 10, y: 10, width: 20, height: 10 },
  semanticOrder: 0,
  accessibleLabel: 'Book this service',
  labelConfirmed: true,
  action: { type: 'start_booking' },
  validationStatus: 'valid',
  reviewStatus: 'approved',
  ...overrides,
});

const image = (
  id: string,
  overrides: Partial<CustomDesignImageItem> = {},
): CustomDesignImageItem => ({
  id,
  assetId: `asset_${id}`,
  fileName: 'poster',
  mimeType: 'image/png',
  fileSize: 1_000,
  width: 1_000,
  height: 2_000,
  aspectRatio: 0.5,
  altText: 'A pink appointment policy poster',
  decorative: false,
  interactiveAreas: [],
  ...overrides,
});

describe('Custom Design model and settings validation', () => {
  it('creates migration-safe recommended defaults', () => {
    const settings = createDefaultCustomDesignSettings();

    expect(settings).toEqual({
      schemaVersion: 1,
      images: [],
      displayMode: 'poster',
      gap: 'small',
      background: { mode: 'site' },
      cta: { type: 'none' },
    });
    expect(validateCustomDesignSettings(settings)).toEqual({
      success: true,
      value: settings,
    });
  });

  it('creates stable image, asset, and area IDs for the universal section', () => {
    const ids = createDeterministicCustomDesignIdFactory('contract');

    expect(ids('section')).toBe('custom_design_section_contract_1');
    expect(ids('image')).toBe('custom_design_image_contract_1');
    expect(ids('asset')).toBe('custom_design_asset_contract_1');
    expect(ids('area')).toBe('custom_design_area_contract_1');
  });

  it('accepts PNG, JPEG/JPG, and WebP metadata without trusting an extension', () => {
    expect(validateCustomDesignImageMetadata(image('png', {
      fileName: 'mobile-picker-file',
      mimeType: 'image/png',
    })).success).toBe(true);
    expect(validateCustomDesignImageMetadata(image('jpeg', {
      fileName: 'poster.png',
      mimeType: 'image/jpeg',
    })).success).toBe(true);
    expect(validateCustomDesignImageMetadata(image('webp', {
      fileName: 'poster.webp',
      mimeType: 'image/webp',
    })).success).toBe(true);
    expect(validateCustomDesignImageMetadata(image('gif', {
      mimeType: 'image/gif' as never,
    })).success).toBe(false);
  });

  it('normalizes and round-trips multiline accessible policy summaries', () => {
    const validated = validateCustomDesignImageMetadata(image('summary', {
      accessibleSummary: '  Deposit policy\r\nBring photo ID.\rContact us\twith questions.  ',
    }));

    expect(validated.success).toBe(true);

    if (!validated.success) {
      return;
    }

    expect(validated.value.accessibleSummary).toBe(
      'Deposit policy\nBring photo ID.\nContact us\twith questions.',
    );

    const roundTrip = validateCustomDesignImageMetadata(
      JSON.parse(JSON.stringify(validated.value)),
    );

    expect(roundTrip).toEqual(validated);
    expect(validateCustomDesignImageMetadata(image('unsafe-summary', {
      accessibleSummary: 'Policy\u0000hidden payload',
    })).success).toBe(false);
  });

  it('rejects multiline or control-character CTA labels', () => {
    const defaults = createDefaultCustomDesignSettings();
    for (const label of ['Book\nnow', 'Book\tnow', 'Book\u0000now']) {
      expect(validateCustomDesignSettings({
        ...defaults,
        cta: {
          type: 'book_now',
          label,
          placement: { type: 'after_all' },
        },
      }).success).toBe(false);
    }
  });

  it('enforces per-file, total-section, image-count, dimension, and pixel limits', () => {
    expect(validateCustomDesignImageMetadata(image('too-large', {
      fileSize: CUSTOM_DESIGN_MAX_FILE_BYTES + 1,
    })).success).toBe(false);
    expect(validateCustomDesignImageMetadata(image('too-many-pixels', {
      width: 10_000,
      height: 5_001,
      aspectRatio: 10_000 / 5_001,
    })).success).toBe(false);

    const defaults = createDefaultCustomDesignSettings();

    expect(validateCustomDesignSettings({
      ...defaults,
      images: Array.from({ length: CUSTOM_DESIGN_MAX_IMAGES + 1 }, (_, index) =>
        image(`count_${index}`)),
    }).success).toBe(false);
    expect(validateCustomDesignSettings({
      ...defaults,
      images: Array.from({ length: 6 }, (_, index) => image(`bytes_${index}`, {
        fileSize: CUSTOM_DESIGN_MAX_FILE_BYTES,
      })),
    }).success).toBe(false);
    expect(CUSTOM_DESIGN_MAX_SECTION_BYTES).toBe(75 * 1024 * 1024);
  });

  it('validates bounded areas, semantic order, labels, overlap, and full-image safety', () => {
    const defaults = createDefaultCustomDesignSettings();

    expect(validateCustomDesignSettings({
      ...defaults,
      images: [image('areas', {
        interactiveAreas: [
          area(),
          area({
            id: 'area_2',
            semanticOrder: 1,
            geometry: { x: 30, y: 10, width: 20, height: 10 },
          }),
        ],
      })],
    }).success).toBe(true);
    expect(validateCustomDesignImageMetadata(image('overlap', {
      interactiveAreas: [
        area(),
        area({ id: 'area_2', semanticOrder: 1, geometry: { x: 29, y: 10, width: 10, height: 10 } }),
      ],
    }))).toMatchObject({ success: false });
    expect(validateCustomDesignImageMetadata(image('full', {
      interactiveAreas: [area({ geometry: { x: 0, y: 0, width: 95, height: 95 } })],
    }))).toMatchObject({ success: false });
    expect(validateCustomDesignImageMetadata(image('unconfirmed', {
      interactiveAreas: [area({
        accessibleLabel: '',
        labelConfirmed: false,
        validationStatus: 'invalid',
      })],
    }))).toMatchObject({ success: true });
  });

  it('rejects duplicate area IDs across image items', () => {
    const defaults = createDefaultCustomDesignSettings();
    const result = validateCustomDesignSettings({
      ...defaults,
      images: [
        image('first', { interactiveAreas: [area()] }),
        image('second', { interactiveAreas: [area()] }),
      ],
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.issues.join(' ')).toContain('duplicated across images');
    }
  });

  it('falls back field by field and salvages an image with one malformed area', () => {
    const fallback = parseCustomDesignSettings({
      images: [image('salvaged', {
        interactiveAreas: [
          area(),
          { ...area({ id: 'bad', semanticOrder: 1 }), geometry: { x: -10, y: 0, width: 20, height: 20 } },
        ],
      })],
      displayMode: 'anything',
      gap: 'huge',
      backgroundMode: 'custom',
      customBackground: '#aabbcc',
      cta: { type: 'none' },
    });

    expect(fallback.images).toHaveLength(1);
    expect(fallback.images[0]?.interactiveAreas).toEqual([area()]);
    expect(fallback).toMatchObject({
      schemaVersion: 1,
      displayMode: 'poster',
      gap: 'small',
      background: { mode: 'custom', color: '#AABBCC' },
    });
  });

  it('normalizes the ambiguous Phase 1 contact CTA to none but rejects it strictly', () => {
    const legacy = {
      ...createDefaultCustomDesignSettings(),
      cta: {
        type: 'contact_me',
        label: 'Contact me',
        placement: { type: 'after_all' },
      },
    };

    expect(parseCustomDesignSettings(legacy).cta).toEqual({ type: 'none' });
    expect(validateCustomDesignSettings(legacy).success).toBe(false);
  });

  it('defensively deduplicates area IDs across images', () => {
    const parsed = parseCustomDesignSettings({
      ...createDefaultCustomDesignSettings(),
      images: [
        image('first', { interactiveAreas: [area()] }),
        image('second', { interactiveAreas: [area()] }),
      ],
    });

    expect(parsed.images[0]?.interactiveAreas).toHaveLength(1);
    expect(parsed.images[1]?.interactiveAreas).toHaveLength(0);
    expect(validateCustomDesignSettings(parsed).success).toBe(true);
  });

  it('salvages repeated assets only when their canonical metadata agrees', () => {
    const parsed = parseCustomDesignSettings({
      ...createDefaultCustomDesignSettings(),
      images: [
        image('first', { assetId: 'asset_shared' }),
        image('same', { assetId: 'asset_shared' }),
        image('conflict', {
          assetId: 'asset_shared',
          width: 2_000,
          height: 2_000,
          aspectRatio: 1,
        }),
      ],
    });

    expect(parsed.images.map(candidate => candidate.id)).toEqual(['first', 'same']);
    expect(validateCustomDesignSettings(parsed).success).toBe(true);
    expect(() => createCustomDesignAssetManifest([parsed])).not.toThrow();

    const strict = validateCustomDesignSettings({
      ...createDefaultCustomDesignSettings(),
      images: [
        image('first', { assetId: 'asset_shared' }),
        image('conflict', {
          assetId: 'asset_shared',
          width: 2_000,
          height: 2_000,
          aspectRatio: 1,
        }),
      ],
    });

    expect(strict.success).toBe(false);

    if (!strict.success) {
      expect(strict.issues.join(' ')).toContain('conflicting image metadata');
    }
  });

  it('canonicalizes accepted aspect-ratio metadata from natural dimensions', () => {
    const result = validateCustomDesignImageMetadata(image('ratio', {
      width: 3_000,
      height: 2_000,
      aspectRatio: 1.500_000_5,
    }));

    expect(result).toMatchObject({ success: true });

    if (result.success) {
      expect(result.value.aspectRatio).toBe(1.5);
    }

    expect(validateCustomDesignImageMetadata(image('bad-ratio', {
      width: 100,
      height: 10_000,
      aspectRatio: 0.010_001,
    })).success).toBe(false);
  });

  it('keeps document state JSON-safe and contains metadata rather than bytes', () => {
    const settings = {
      ...createDefaultCustomDesignSettings(),
      images: [image('serializable', { interactiveAreas: [area()] })],
    };
    const serialized = JSON.stringify(settings);

    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain('blob:');
    expect(JSON.parse(serialized)).toEqual(settings);
  });
});
