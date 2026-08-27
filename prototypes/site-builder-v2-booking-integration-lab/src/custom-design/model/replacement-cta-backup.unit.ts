import {
  createCustomDesignAssetManifest,
  createCustomDesignBackupEnvelope,
  parseCustomDesignBackupEnvelope,
  resolveCustomDesignAssetManifest,
  serializeCustomDesignBackupEnvelope,
} from './backup';
import { CUSTOM_DESIGN_BACKUP_WARNING } from './constants';
import {
  getCtaInsertionIndex,
  reconcileCtaPlacementForImages,
  repairCtaPlacementForImages,
  resolveNativeCtaAction,
} from './cta';
import {
  approveInteractiveAreaReview,
  getCustomDesignPublishBlockers,
  replacementPreservesAreaApproval,
  replaceCustomDesignImage,
  symmetricAspectRatioDelta,
} from './replacement';
import { createDefaultCustomDesignSettings } from './settings';
import type {
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
  CustomDesignNativeCta,
  CustomDesignSettings,
} from './types';

const validArea = (
  overrides: Partial<CustomDesignInteractiveArea> = {},
): CustomDesignInteractiveArea => ({
  id: 'area_policy',
  geometry: { x: 10, y: 20, width: 30, height: 10 },
  semanticOrder: 0,
  accessibleLabel: 'Read booking policy',
  labelConfirmed: true,
  action: { type: 'custom_url', destination: { url: 'https://example.com/policy' } },
  validationStatus: 'valid',
  reviewStatus: 'approved',
  ...overrides,
});

const validImage = (
  id: string,
  overrides: Partial<CustomDesignImageItem> = {},
): CustomDesignImageItem => ({
  id,
  assetId: `asset_${id}`,
  fileName: `${id}.png`,
  mimeType: 'image/png',
  fileSize: 1_000,
  width: 1_000,
  height: 2_000,
  aspectRatio: 0.5,
  altText: 'Policy poster',
  decorative: false,
  interactiveAreas: [validArea()],
  ...overrides,
});

const withImages = (images: CustomDesignImageItem[]): CustomDesignSettings => ({
  ...createDefaultCustomDesignSettings(),
  images,
});

describe('replacement review safety', () => {
  it('uses the approved symmetric 5% ratio in both directions', () => {
    expect(symmetricAspectRatioDelta(1, 1.05)).toBeCloseTo(0.05, 10);
    expect(symmetricAspectRatioDelta(1.05, 1)).toBeCloseTo(0.05, 10);
    expect(replacementPreservesAreaApproval(1, 1.05)).toBe(true);
    expect(replacementPreservesAreaApproval(1.05, 1)).toBe(true);
    expect(symmetricAspectRatioDelta(1, 0.95)).toBeCloseTo(0.0526315789, 10);
    expect(replacementPreservesAreaApproval(1, 0.95)).toBe(false);
  });

  it('preserves item/area identity and marks all affected areas for review', () => {
    const original = validImage('image_1');
    const replaced = replaceCustomDesignImage(original, {
      assetId: 'asset_replacement',
      fileName: 'wide.webp',
      mimeType: 'image/webp',
      fileSize: 2_000,
      width: 2_000,
      height: 1_000,
      aspectRatio: 2,
    });
    expect(replaced.id).toBe(original.id);
    expect(replaced.interactiveAreas[0]).toMatchObject({
      id: 'area_policy',
      reviewStatus: 'needs_review',
      reviewReason: 'aspect_ratio_changed',
    });
    expect(getCustomDesignPublishBlockers(withImages([replaced]))).toContainEqual({
      imageItemId: 'image_1',
      areaId: 'area_policy',
      reason: 'needs_review',
    });
  });

  it('never auto-clears a preexisting review state', () => {
    const original = validImage('image_1', {
      interactiveAreas: [validArea({
        reviewStatus: 'needs_review',
        reviewReason: 'owner_review_required',
      })],
    });
    const replaced = replaceCustomDesignImage(original, {
      assetId: 'asset_similar',
      fileName: 'similar.png',
      mimeType: 'image/png',
      fileSize: 1_100,
      width: 1_050,
      height: 2_000,
      aspectRatio: 0.525,
    });
    expect(replaced.interactiveAreas[0]).toMatchObject({
      reviewStatus: 'needs_review',
      reviewReason: 'owner_review_required',
    });
    expect(approveInteractiveAreaReview(replaced.interactiveAreas[0]!)).toMatchObject({
      reviewStatus: 'approved',
    });
  });

  it('derives replacement ratios from dimensions instead of stale metadata', () => {
    const staleOriginal = validImage('stale', { aspectRatio: 2 });
    const similar = replaceCustomDesignImage(staleOriginal, {
      assetId: 'asset_similar',
      fileName: 'similar.png',
      mimeType: 'image/png',
      fileSize: 1_100,
      width: 1_050,
      height: 2_000,
      aspectRatio: 9,
    });
    expect(similar.aspectRatio).toBe(0.525);
    expect(similar.interactiveAreas[0]?.reviewStatus).toBe('approved');

    const different = replaceCustomDesignImage(validImage('different'), {
      assetId: 'asset_wide',
      fileName: 'wide.png',
      mimeType: 'image/png',
      fileSize: 1_100,
      width: 2_000,
      height: 1_000,
      aspectRatio: 0.5,
    });
    expect(different.aspectRatio).toBe(2);
    expect(different.interactiveAreas[0]?.reviewStatus).toBe('needs_review');
  });
});

describe('stable native CTA placement', () => {
  const images = [validImage('one'), validImage('two'), validImage('three')];
  const cta: CustomDesignNativeCta = {
    type: 'book_now',
    label: 'Book now',
    placement: { type: 'after_image', imageItemId: 'two' },
  };

  it('follows a stable image item when pages reorder', () => {
    expect(getCtaInsertionIndex(cta, images)).toBe(2);
    expect(getCtaInsertionIndex(cta, [images[2]!, images[1]!, images[0]!])).toBe(2);
    expect(repairCtaPlacementForImages(cta, [images[2]!, images[1]!, images[0]!]))
      .toBe(cta);
  });

  it('returns an explicit owner notice when its anchor image was removed', () => {
    expect(reconcileCtaPlacementForImages(cta, [images[0]!, images[2]!])).toEqual({
      cta: { ...cta, placement: { type: 'after_all' } },
      placementRepaired: true,
      noticeReason: 'anchor_image_removed',
    });
  });

  it('resolves bounded Book, Contact, and custom CTA actions', () => {
    expect(resolveNativeCtaAction(cta, { bookingHref: '#booking' })).toMatchObject({
      status: 'resolved',
      href: '#booking',
    });
    expect(resolveNativeCtaAction({
      type: 'contact_me',
      label: 'Contact me',
      placement: { type: 'after_all' },
    }, { contactHref: 'mailto:owner@example.com' })).toMatchObject({
      status: 'resolved',
      href: 'mailto:owner@example.com',
    });
    expect(resolveNativeCtaAction({
      type: 'custom',
      label: 'Directions',
      placement: { type: 'after_all' },
      action: { type: 'directions', destination: { address: '123 Main St' } },
    }, {})).toMatchObject({ status: 'resolved', external: true });
  });
});

describe('truthful Custom Design backup contract', () => {
  it('exports metadata and the exact local-asset warning without bytes', () => {
    const settings = withImages([validImage('poster')]);
    const envelope = createCustomDesignBackupEnvelope({
      document: { sections: [{ sectionType: 'custom_design', settings }] },
      settings: [settings],
      exportedAt: '2026-08-27T12:00:00.000Z',
    });
    expect(envelope.customDesignAssets).toMatchObject({
      version: 1,
      assetsIncluded: false,
      warning: CUSTOM_DESIGN_BACKUP_WARNING,
    });
    const json = serializeCustomDesignBackupEnvelope(envelope);
    expect(json).not.toContain('data:image');
    expect(json).not.toContain('blob:');
    expect(parseCustomDesignBackupEnvelope(JSON.parse(json))).toMatchObject({
      success: true,
    });
  });

  it('rejects document blobs, object URLs, and envelopes without a document key', () => {
    expect(() => createCustomDesignBackupEnvelope({
      document: { image: new Blob(['bytes'], { type: 'image/png' }) },
      settings: [],
    })).toThrow('image bytes');
    expect(() => createCustomDesignBackupEnvelope({
      document: { image: 'blob:https://example.com/ephemeral' },
      settings: [],
    })).toThrow('ephemeral object URL');
    expect(parseCustomDesignBackupEnvelope({
      kind: 'luster_site_builder_backup',
      version: 1,
      exportedAt: '2026-08-27T12:00:00.000Z',
      customDesignAssets: {
        version: 1,
        assetsIncluded: false,
        warning: CUSTOM_DESIGN_BACKUP_WARNING,
        assets: [],
      },
    }).success).toBe(false);
  });

  it('rejects every data/blob casing plus ArrayBuffer bytes and non-JSON values', () => {
    expect(() => createCustomDesignBackupEnvelope({
      document: { payload: '  DATA:text/plain;base64,SGVsbG8=' },
      settings: [],
    })).toThrow('image bytes');
    expect(() => createCustomDesignBackupEnvelope({
      document: { payload: '  BLOB:https://example.com/id' },
      settings: [],
    })).toThrow('image bytes');
    expect(() => createCustomDesignBackupEnvelope({
      document: { payload: new ArrayBuffer(8) },
      settings: [],
    })).toThrow('image bytes');
    expect(() => createCustomDesignBackupEnvelope({
      document: { payload: new Uint8Array([1, 2, 3]) },
      settings: [],
    })).toThrow('image bytes');
    expect(() => createCustomDesignBackupEnvelope({
      document: { missing: undefined },
      settings: [],
    })).toThrow('truthfully in JSON');

    const sparsePages: unknown[] = [];
    sparsePages.length = 1;
    expect(() => createCustomDesignBackupEnvelope({
      document: { pages: sparsePages },
      settings: [],
    })).toThrow('truthfully in JSON');

    const disguisedSparsePages = new Array<unknown>(1) as unknown[] & {
      note?: string;
    };
    disguisedSparsePages.note = 'JSON would silently drop this property.';
    expect(() => createCustomDesignBackupEnvelope({
      document: { pages: disguisedSparsePages },
      settings: [],
    })).toThrow('truthfully in JSON');

    const documentWithToJson = { title: 'Safe' };
    Object.defineProperty(documentWithToJson, 'toJSON', {
      value: () => ({ title: 'Silently replaced' }),
    });
    expect(() => createCustomDesignBackupEnvelope({
      document: documentWithToJson,
      settings: [],
    })).toThrow('truthfully in JSON');

    const documentWithAccessor: Record<string, unknown> = {};
    Object.defineProperty(documentWithAccessor, 'title', {
      enumerable: true,
      get: () => 'Computed during serialization',
    });
    expect(() => createCustomDesignBackupEnvelope({
      document: documentWithAccessor,
      settings: [],
    })).toThrow('truthfully in JSON');
  });

  it('rejects accessors without invoking them during create, parse, or serialize', () => {
    let getterCalls = 0;
    const documentWithAccessor: Record<string, unknown> = {};
    Object.defineProperty(documentWithAccessor, 'title', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('Backup validation must not invoke accessors.');
      },
    });

    expect(() => createCustomDesignBackupEnvelope({
      document: documentWithAccessor,
      settings: [],
    })).toThrow('truthfully in JSON');
    expect(getterCalls).toBe(0);

    const untrustedEnvelope = {
      kind: 'luster_site_builder_backup',
      version: 1,
      exportedAt: '2026-08-27T12:00:00.000Z',
      document: documentWithAccessor,
      customDesignAssets: {
        version: 1,
        assetsIncluded: false,
        warning: CUSTOM_DESIGN_BACKUP_WARNING,
        assets: [],
      },
    };
    expect(parseCustomDesignBackupEnvelope(untrustedEnvelope).success).toBe(false);
    expect(getterCalls).toBe(0);
    expect(() => serializeCustomDesignBackupEnvelope(
      untrustedEnvelope as ReturnType<typeof createCustomDesignBackupEnvelope>,
    )).toThrow('truthfully JSON-serializable');
    expect(getterCalls).toBe(0);
  });

  it('revalidates a mutated envelope immediately before serialization', () => {
    const envelope = createCustomDesignBackupEnvelope({
      document: { title: 'Safe' },
      settings: [],
      exportedAt: '2026-08-27T12:00:00.000Z',
    });
    (envelope.document as { title: string }).title = '  DaTa:application/octet-stream;base64,AA==';
    expect(() => serializeCustomDesignBackupEnvelope(envelope)).toThrow('image bytes');

    const mutated = createCustomDesignBackupEnvelope({
      document: { title: 'Safe' },
      settings: [],
      exportedAt: '2026-08-27T12:00:00.000Z',
    });
    (mutated.customDesignAssets as { assetsIncluded: boolean }).assetsIncluded = true;
    expect(() => serializeCustomDesignBackupEnvelope(mutated)).toThrow('Backup envelope is invalid');
  });

  it('reports same-browser availability and different-browser missing assets', () => {
    const manifest = createCustomDesignAssetManifest([
      withImages([validImage('one'), validImage('two')]),
    ]);
    expect(resolveCustomDesignAssetManifest(manifest, new Set(['asset_one']))).toEqual([
      { assetId: 'asset_one', status: 'available', imageItemIds: ['one'] },
      { assetId: 'asset_two', status: 'missing', imageItemIds: ['two'] },
    ]);
  });

  it('rejects conflicting metadata for one shared asset ID', () => {
    expect(() => createCustomDesignAssetManifest([withImages([
      validImage('first', { assetId: 'asset_shared' }),
      validImage('second', {
        assetId: 'asset_shared',
        width: 2_000,
        aspectRatio: 1,
      }),
    ])])).toThrow('conflicting manifest metadata');
  });
});
