import { createDefaultCustomDesignSettings } from '../model/settings';
import type {
  CustomDesignActionResolution,
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
} from '../model/types';
import {
  type CustomDesignReadinessContext,
  getCustomDesignReadiness,
  isCustomDesignAreaReadyForCustomer,
} from './readiness';

const resolved: CustomDesignActionResolution = {
  status: 'resolved',
  href: '#booking',
  external: false,
};

const clickableArea = (
  overrides: Partial<CustomDesignInteractiveArea> = {},
): CustomDesignInteractiveArea => ({
  id: 'area-one',
  geometry: { x: 10, y: 10, width: 20, height: 20 },
  semanticOrder: 0,
  accessibleLabel: 'Book now',
  labelConfirmed: true,
  action: { type: 'start_booking' },
  validationStatus: 'valid',
  reviewStatus: 'approved',
  ...overrides,
});

const image = (
  overrides: Partial<CustomDesignImageItem> = {},
): CustomDesignImageItem => ({
  id: 'image-one',
  assetId: 'asset-one',
  fileName: 'poster.png',
  mimeType: 'image/png',
  fileSize: 1_000,
  width: 1_000,
  height: 2_000,
  aspectRatio: 0.5,
  altText: 'Policy poster',
  decorative: false,
  interactiveAreas: [clickableArea()],
  ...overrides,
});

const context = (
  overrides: Partial<CustomDesignReadinessContext> = {},
): CustomDesignReadinessContext => ({
  getAssetAvailability: () => 'available',
  resolveAction: () => resolved,
  ...overrides,
});

describe('integrated Custom Design readiness', () => {
  it('marks an empty section and a nondecorative image without alt text as not ready', () => {
    expect(getCustomDesignReadiness(
      createDefaultCustomDesignSettings(),
      context(),
    ).issues).toMatchObject([{ code: 'empty_section', source: 'asset' }]);

    const settings = {
      ...createDefaultCustomDesignSettings(),
      images: [image({ altText: '' })],
    };

    expect(getCustomDesignReadiness(settings, context()).issues).toMatchObject([
      { code: 'alt_text_missing', imageItemId: 'image-one', source: 'asset' },
    ]);
  });

  it('reports a fully available and resolved section as customer ready', () => {
    const settings = {
      ...createDefaultCustomDesignSettings(),
      images: [image()],
    };
    const readiness = getCustomDesignReadiness(settings, context());

    expect(readiness).toEqual({ customerReady: true, issues: [] });
    expect(
      isCustomDesignAreaReadyForCustomer(readiness, 'image-one', 'area-one'),
    ).toBe(true);
  });

  it('preserves one exact missing-asset issue and suppresses its area readiness', () => {
    const settings = {
      ...createDefaultCustomDesignSettings(),
      images: [image()],
    };
    const readiness = getCustomDesignReadiness(settings, context({
      getAssetAvailability: () => 'missing',
    }));

    expect(readiness.customerReady).toBe(false);
    expect(readiness.issues).toMatchObject([
      { code: 'asset_missing', imageItemId: 'image-one', source: 'asset' },
    ]);
    // Customer rendering suppresses the whole image-local link layer when its
    // asset is unavailable, even though the metadata itself remains valid.
    expect(readiness.issues.some(candidate =>
      candidate.imageItemId === 'image-one')).toBe(true);
    expect(
      isCustomDesignAreaReadyForCustomer(readiness, 'image-one', 'area-one'),
    ).toBe(false);
  });

  it('explains review, label, unsafe geometry, overlap, and action failures', () => {
    const first = clickableArea({
      accessibleLabel: '',
      labelConfirmed: false,
      reviewStatus: 'needs_review',
      reviewReason: 'aspect_ratio_changed',
      validationStatus: 'invalid',
    });
    const second = clickableArea({
      id: 'area-two',
      semanticOrder: 1,
      geometry: { x: 15, y: 15, width: 90, height: 90 },
    });
    const settings = {
      ...createDefaultCustomDesignSettings(),
      images: [image({ interactiveAreas: [first, second] })],
    };
    const readiness = getCustomDesignReadiness(settings, context({
      resolveAction: () => ({
        status: 'unresolved',
        reason: 'booking_unavailable',
      }),
    }));

    expect(new Set(readiness.issues.map(candidate => candidate.code))).toEqual(
      new Set([
        'action_unresolved',
        'area_invalid',
        'geometry_invalid',
        'label_unconfirmed',
        'needs_review',
        'overlap',
      ]),
    );
    expect(
      isCustomDesignAreaReadyForCustomer(readiness, 'image-one', 'area-one'),
    ).toBe(false);
    expect(readiness.issues.filter(candidate =>
      candidate.code === 'overlap')).toHaveLength(2);
  });

  it('reports the shared near-full-image threshold and suppresses customer readiness', () => {
    const settings = {
      ...createDefaultCustomDesignSettings(),
      images: [image({
        interactiveAreas: [clickableArea({
          geometry: { x: 0, y: 0, width: 95, height: 95 },
        })],
      })],
    };
    const readiness = getCustomDesignReadiness(settings, context());

    expect(readiness.issues).toContainEqual(expect.objectContaining({
      areaId: 'area-one',
      code: 'unsafe_full_image_area',
      imageItemId: 'image-one',
      source: 'area',
    }));
    expect(
      isCustomDesignAreaReadyForCustomer(readiness, 'image-one', 'area-one'),
    ).toBe(false);
  });

  it('requires the native Book now CTA to resolve a canonical Booking target', () => {
    const settings = {
      ...createDefaultCustomDesignSettings(),
      images: [image({ interactiveAreas: [] })],
      cta: {
        type: 'book_now' as const,
        label: 'Book now',
        placement: { type: 'after_all' as const },
      },
    };
    const readiness = getCustomDesignReadiness(settings, context({
      resolveAction: () => ({
        status: 'unresolved',
        reason: 'booking_unavailable',
      }),
    }));

    expect(readiness).toMatchObject({
      customerReady: false,
      issues: [{ code: 'action_unresolved', source: 'cta' }],
    });
  });
});
