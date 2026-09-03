import {
  CUSTOM_DESIGN_MAX_FILE_BYTES,
  CUSTOM_DESIGN_MAX_IMAGES,
  CUSTOM_DESIGN_MAX_SECTION_BYTES,
} from '../model/constants';
import {
  CUSTOM_DESIGN_MAX_DECODED_PIXELS,
  CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX,
  decodeImageInBrowser,
  detectImageMimeType,
  generateImageThumbnail,
  getOrientedDimensions,
  parseExifOrientation,
  prepareImageAsset,
  processImageBatch,
  readBlobArrayBuffer,
  validateUploadCapacity,
} from './image-processing';
import {
  CUSTOM_DESIGN_MAX_THUMBNAIL_BYTES,
  type ExifOrientation,
  type SupportedImageMimeType,
} from './types';

const signatures: Record<SupportedImageMimeType, number[]> = {
  'image/jpeg': [0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x04, 0x00, 0x00],
  'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  'image/webp': [
    0x52,
    0x49,
    0x46,
    0x46,
    0x04,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50,
  ],
};

const makeFile = (
  mimeType: SupportedImageMimeType,
  name = 'design.png',
): File =>
  new File([new Uint8Array(signatures[mimeType])], name, { type: mimeType });

const withReportedSize = (file: File, size: number): File => {
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
};

const decodePortrait = vi.fn(async () => ({
  height: 1_600,
  orientationApplied: true,
  width: 800,
}));

const noThumbnail = vi.fn(async () => null);

const createExifJpeg = (orientation: number): ArrayBuffer => {
  const bytes = new Uint8Array(40);
  bytes.set([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x22], 0);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  // Little-endian TIFF, first IFD at offset 8.
  bytes.set([0x49, 0x49, 0x2A, 0, 0x08, 0, 0, 0], 12);
  bytes.set([0x01, 0], 20);
  bytes.set(
    [0x12, 0x01, 0x03, 0, 0x01, 0, 0, 0, orientation, 0, 0, 0],
    22,
  );
  bytes.set([0, 0, 0, 0, 0xFF, 0xD9], 34);
  return bytes.buffer;
};

describe('custom design image processing', () => {
  beforeEach(() => {
    decodePortrait.mockClear();
    noThumbnail.mockClear();
  });

  it('detects PNG, JPEG, and WebP by file signature', async () => {
    await expect(detectImageMimeType(makeFile('image/png'))).resolves.toBe(
      'image/png',
    );
    await expect(
      detectImageMimeType(makeFile('image/jpeg', 'design.jpg')),
    ).resolves.toBe('image/jpeg');
    await expect(
      detectImageMimeType(makeFile('image/webp', 'design.webp')),
    ).resolves.toBe('image/webp');
    await expect(detectImageMimeType(new File([
      new Uint8Array([0xFF, 0xD8, 0xFF, 0xC2, 0x00, 0x11]),
    ], 'progressive.jpg', { type: 'image/jpeg' }))).resolves.toBe('image/jpeg');
    await expect(
      detectImageMimeType(
        new File([new Uint8Array([1, 2, 3])], 'fake.png', {
          type: 'image/png',
        }),
      ),
    ).resolves.toBeNull();
  });

  it.each([
    ['image/png', 'page.png'],
    ['image/jpeg', 'page.jpg'],
    ['image/webp', 'page.webp'],
  ] as const)('prepares a decoded %s original without altering its bytes', async (mimeType, name) => {
    const file = makeFile(mimeType, name);
    const before = new Uint8Array(await readBlobArrayBuffer(file));
    const prepared = await prepareImageAsset(file, {
      assetId: `asset-${mimeType}`,
      createdAt: '2026-08-27T12:00:00.000Z',
      decodeImage: decodePortrait,
      generateThumbnail: noThumbnail,
    });

    expect(prepared.blob).toBe(file);
    expect(new Uint8Array(await readBlobArrayBuffer(prepared.blob))).toEqual(before);
    expect(prepared.metadata).toMatchObject({
      aspectRatio: 0.5,
      fileName: name,
      height: 1_600,
      mimeType,
      orientation: 1,
      width: 800,
    });
    expect(JSON.stringify(prepared.metadata)).not.toContain('data:image');
  });

  it('rejects unsupported MIME, mismatched signatures, and undecodable images', async () => {
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], 'art.gif', {
      type: 'image/gif',
    });

    await expect(
      prepareImageAsset(gif, {
        assetId: 'gif',
        decodeImage: decodePortrait,
        generateThumbnail: noThumbnail,
      }),
    ).rejects.toMatchObject({ code: 'unsupported_type' });

    const disguised = new File(
      [new Uint8Array(signatures['image/jpeg'])],
      'fake.png',
      { type: 'image/png' },
    );

    await expect(
      prepareImageAsset(disguised, {
        assetId: 'disguised',
        decodeImage: decodePortrait,
        generateThumbnail: noThumbnail,
      }),
    ).rejects.toMatchObject({ code: 'signature_mismatch' });

    await expect(
      prepareImageAsset(makeFile('image/png'), {
        assetId: 'corrupt',
        decodeImage: vi.fn().mockRejectedValue(new Error('decode failed')),
        generateThumbnail: noThumbnail,
      }),
    ).rejects.toMatchObject({ code: 'decode_failed' });
  });

  it('parses EXIF orientation and swaps natural dimensions when decode is raw', async () => {
    const exif = createExifJpeg(6);

    expect(parseExifOrientation(exif)).toBe(6);
    expect(getOrientedDimensions(1_200, 800, 6)).toEqual({
      height: 1_200,
      width: 800,
    });
    expect(getOrientedDimensions(1_200, 800, 3)).toEqual({
      height: 800,
      width: 1_200,
    });

    const file = new File([exif], 'rotated.jpg', { type: 'image/jpeg' });
    const prepared = await prepareImageAsset(file, {
      assetId: 'rotated',
      decodeImage: async () => ({
        height: 800,
        orientationApplied: false,
        width: 1_200,
      }),
      generateThumbnail: noThumbnail,
    });

    expect(prepared.metadata).toMatchObject({
      aspectRatio: 800 / 1_200,
      height: 1_200,
      orientation: 6,
      width: 800,
    });
  });

  it('closes decoded resources and rejects invalid or excessive dimensions', async () => {
    const close = vi.fn();

    await expect(
      prepareImageAsset(makeFile('image/png'), {
        assetId: 'zero',
        decodeImage: async () => ({
          close,
          height: 0,
          orientationApplied: true,
          width: 100,
        }),
        generateThumbnail: noThumbnail,
      }),
    ).rejects.toMatchObject({ code: 'corrupt_image' });
    expect(close).toHaveBeenCalledOnce();

    await expect(
      prepareImageAsset(makeFile('image/png'), {
        assetId: 'dimension-cap',
        decodeImage: async () => ({
          height: 1,
          orientationApplied: true,
          width: CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX + 1,
        }),
        generateThumbnail: noThumbnail,
      }),
    ).rejects.toMatchObject({ code: 'dimensions_too_large' });

    await expect(
      prepareImageAsset(makeFile('image/png'), {
        assetId: 'pixel-cap',
        decodeImage: async () => ({
          height: Math.ceil(CUSTOM_DESIGN_MAX_DECODED_PIXELS / 8_000) + 1,
          orientationApplied: true,
          width: 8_000,
        }),
        generateThumbnail: noThumbnail,
      }),
    ).rejects.toMatchObject({ code: 'dimensions_too_large' });
  });

  it('keeps a valid original when optional thumbnail generation fails', async () => {
    const file = makeFile('image/png');
    const prepared = await prepareImageAsset(file, {
      assetId: 'thumbnail-failed',
      decodeImage: decodePortrait,
      generateThumbnail: vi.fn().mockRejectedValue(new Error('canvas denied')),
    });

    expect(prepared.blob).toBe(file);
    expect(prepared.thumbnailBlob).toBeUndefined();
    expect(prepared.metadata.thumbnail).toBeUndefined();
  });

  it('requires a thumbnail for onboarding surfaces that promise an accepted preview', async () => {
    await expect(prepareImageAsset(makeFile('image/png'), {
      assetId: 'thumbnail-required',
      decodeImage: decodePortrait,
      generateThumbnail: vi.fn().mockResolvedValue(null),
      requireThumbnail: true,
    })).rejects.toMatchObject({ code: 'thumbnail_failed' });
  });

  it('falls back from createImageBitmap to HTMLImageElement.decode and revokes its URL', async () => {
    const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
    const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
    const originalCreateUrl = Object.getOwnPropertyDescriptor(globalThis.URL, 'createObjectURL');
    const originalRevokeUrl = Object.getOwnPropertyDescriptor(globalThis.URL, 'revokeObjectURL');
    const decode = vi.fn().mockRejectedValue(new Error('Safari decode timing'));
    const createObjectURL = vi.fn(() => 'blob:test-image');
    const revokeObjectURL = vi.fn();

    class TestImage {
      naturalHeight = 1_200;
      naturalWidth = 900;
      onerror: OnErrorEventHandler = null;
      onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null = null;
      decode = decode;

      private source = '';

      get src() {
        return this.source;
      }

      set src(value: string) {
        this.source = value;
        queueMicrotask(() => this.onload?.call(
          this as unknown as GlobalEventHandlers,
          new Event('load'),
        ));
      }
    }

    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('unsupported option')),
    });
    Object.defineProperty(globalThis, 'Image', {
      configurable: true,
      value: TestImage,
    });
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    try {
      await expect(decodeImageInBrowser(makeFile('image/jpeg'))).resolves.toMatchObject({
        height: 1_200,
        orientationApplied: true,
        width: 900,
      });
      expect(decode).toHaveBeenCalledOnce();
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
    } finally {
      const restore = (
        target: object,
        key: PropertyKey,
        descriptor: PropertyDescriptor | undefined,
      ) => {
        if (descriptor) {
          Object.defineProperty(target, key, descriptor);
        } else {
          Reflect.deleteProperty(target, key);
        }
      };
      restore(globalThis, 'createImageBitmap', originalBitmap);
      restore(globalThis, 'Image', originalImage);
      restore(globalThis.URL, 'createObjectURL', originalCreateUrl);
      restore(globalThis.URL, 'revokeObjectURL', originalRevokeUrl);
    }
  });

  it('records a bounded optional thumbnail without placing it in metadata JSON', async () => {
    const thumbnailBlob = new Blob(['binary-secret'], { type: 'image/webp' });
    const prepared = await prepareImageAsset(makeFile('image/png'), {
      assetId: 'with-thumbnail',
      decodeImage: decodePortrait,
      generateThumbnail: vi.fn().mockResolvedValue(thumbnailBlob),
    });

    expect(prepared.thumbnailBlob).toBe(thumbnailBlob);
    expect(prepared.metadata.thumbnail).toEqual({
      byteSize: thumbnailBlob.size,
      height: 320,
      mimeType: 'image/webp',
      width: 160,
    });

    const metadataJson = JSON.stringify(prepared.metadata);

    expect(metadataJson).toContain('thumbnail');
    expect(metadataJson).not.toContain('data:image');
    expect(metadataJson).not.toContain('binary-secret');
  });

  it('drops zero-byte, oversized, and unsupported thumbnails while preserving originals', async () => {
    const oversized = new Blob(['oversized'], { type: 'image/webp' });
    Object.defineProperty(oversized, 'size', {
      configurable: true,
      value: CUSTOM_DESIGN_MAX_THUMBNAIL_BYTES + 1,
    });
    const candidates = [
      new Blob([], { type: 'image/webp' }),
      oversized,
      new Blob(['gif'], { type: 'image/gif' }),
    ];

    for (const [index, thumbnailBlob] of candidates.entries()) {
      const file = makeFile('image/png', `original-${index}.png`);
      const prepared = await prepareImageAsset(file, {
        assetId: `invalid-thumbnail-${index}`,
        decodeImage: decodePortrait,
        generateThumbnail: vi.fn().mockResolvedValue(thumbnailBlob),
      });

      expect(prepared.blob).toBe(file);
      expect(prepared.thumbnailBlob).toBeUndefined();
      expect(prepared.metadata.thumbnail).toBeUndefined();
    }
  });

  it('renders EXIF orientations 5–8 and falls back from WebP to PNG', async () => {
    const transform = vi.fn();
    const scaleContext = vi.fn();
    const drawImage = vi.fn();
    const context = {
      drawImage,
      scale: scaleContext,
      transform,
    } as unknown as CanvasRenderingContext2D;
    const pngThumbnail = new Blob(['png-thumbnail'], { type: 'image/png' });
    const toBlob = vi.fn(
      (callback: BlobCallback, mimeType?: string) =>
        callback(mimeType === 'image/webp' ? null : pngThumbnail),
    );
    const canvas = {
      getContext: vi.fn(() => context),
      height: 0,
      toBlob,
      width: 0,
    } as unknown as HTMLCanvasElement;
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockImplementation(() => canvas);
    const source = {} as CanvasImageSource;
    const renderScale = 320 / 1_200;
    const expectedTransforms: Record<ExifOrientation, number[] | null> = {
      1: null,
      2: null,
      3: null,
      4: null,
      5: [0, renderScale, renderScale, 0, 0, 0],
      6: [0, renderScale, -renderScale, 0, 213, 0],
      7: [0, -renderScale, -renderScale, 0, 213, 320],
      8: [0, -renderScale, renderScale, 0, 0, 320],
    };

    try {
      for (const orientation of [5, 6, 7, 8] as const) {
        transform.mockClear();
        scaleContext.mockClear();
        drawImage.mockClear();
        toBlob.mockClear();

        await expect(
          generateImageThumbnail({
            decoded: {
              height: 800,
              orientationApplied: false,
              source,
              width: 1_200,
            },
            height: 1_200,
            orientation,
            width: 800,
          }),
        ).resolves.toBe(pngThumbnail);

        expect(transform).toHaveBeenCalledWith(
          ...(expectedTransforms[orientation] ?? []),
        );
        expect(scaleContext).not.toHaveBeenCalled();
        expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1_200, 800);
        expect(toBlob.mock.calls.map(call => call[1])).toEqual([
          'image/webp',
          'image/png',
        ]);
        expect(canvas.width).toBe(213);
        expect(canvas.height).toBe(320);
      }
    } finally {
      createElement.mockRestore();
    }
  });

  it('enforces count, per-file, total-section, and valid capacity inputs', () => {
    const file = makeFile('image/png');

    expect(() =>
      validateUploadCapacity(file, {
        currentImageCount: CUSTOM_DESIGN_MAX_IMAGES,
        currentSectionBytes: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'too_many_images' }));
    expect(() =>
      validateUploadCapacity(
        withReportedSize(makeFile('image/png'), CUSTOM_DESIGN_MAX_FILE_BYTES + 1),
        { currentImageCount: 0, currentSectionBytes: 0 },
      ),
    ).toThrow(expect.objectContaining({ code: 'file_too_large' }));
    expect(() =>
      validateUploadCapacity(file, {
        currentImageCount: 0,
        currentSectionBytes: CUSTOM_DESIGN_MAX_SECTION_BYTES - file.size + 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'section_too_large' }));
    expect(() =>
      validateUploadCapacity(file, {
        currentImageCount: -1,
        currentSectionBytes: Number.NaN,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_capacity' }));
    expect(() =>
      validateUploadCapacity(withReportedSize(makeFile('image/png'), Number.NaN), {
        currentImageCount: 0,
        currentSectionBytes: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_file_size' }));
  });

  it('returns partial multi-upload success with stable per-file results', async () => {
    const valid = makeFile('image/png', 'valid.png');
    const corrupt = new File([new Uint8Array([1, 2, 3])], 'corrupt.png', {
      type: 'image/png',
    });
    const jpeg = makeFile('image/jpeg', 'second.jpg');
    const result = await processImageBatch([valid, corrupt, jpeg], {
      createAssetId: (_file, index) => `asset-${index}`,
      createdAt: () => '2026-08-27T12:00:00.000Z',
      currentImageCount: 0,
      currentSectionBytes: 0,
      decodeImage: decodePortrait,
      generateThumbnail: noThumbnail,
    });

    expect(result.accepted.map(asset => asset.metadata.id)).toEqual([
      'asset-0',
      'asset-2',
    ]);
    expect(result.rejected).toMatchObject([
      { code: 'corrupt_image', file: corrupt, index: 1 },
    ]);
  });

  it('applies the remaining image capacity incrementally in a batch', async () => {
    const result = await processImageBatch(
      [
        makeFile('image/png', 'first.png'),
        makeFile('image/png', 'second.png'),
        makeFile('image/png', 'third.png'),
      ],
      {
        createAssetId: (_file, index) => `limited-${index}`,
        currentImageCount: CUSTOM_DESIGN_MAX_IMAGES - 1,
        currentSectionBytes: 0,
        decodeImage: decodePortrait,
        generateThumbnail: noThumbnail,
      },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toMatchObject([
      { code: 'too_many_images', index: 1 },
      { code: 'too_many_images', index: 2 },
    ]);
  });

  it('keeps corrupt-file and capacity-overflow reasons distinct in one batch', async () => {
    const corrupt = new File([new Uint8Array([1, 2, 3])], 'corrupt.png', {
      type: 'image/png',
    });
    const result = await processImageBatch(
      [
        corrupt,
        makeFile('image/png', 'fills-final-slot.png'),
        makeFile('image/png', 'over-capacity.png'),
      ],
      {
        createAssetId: (_file, index) => `mixed-${index}`,
        currentImageCount: CUSTOM_DESIGN_MAX_IMAGES - 1,
        currentSectionBytes: 0,
        decodeImage: decodePortrait,
        generateThumbnail: noThumbnail,
      },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toMatchObject([
      { code: 'corrupt_image', index: 0 },
      { code: 'too_many_images', index: 2 },
    ]);
  });

  it('rejects every selected image with the capacity reason when already full', async () => {
    const result = await processImageBatch(
      [makeFile('image/png', 'first.png'), makeFile('image/png', 'second.png')],
      {
        createAssetId: (_file, index) => `full-${index}`,
        currentImageCount: CUSTOM_DESIGN_MAX_IMAGES,
        currentSectionBytes: 0,
        decodeImage: decodePortrait,
        generateThumbnail: noThumbnail,
      },
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toMatchObject([
      { code: 'too_many_images', index: 0 },
      { code: 'too_many_images', index: 1 },
    ]);
  });
});
