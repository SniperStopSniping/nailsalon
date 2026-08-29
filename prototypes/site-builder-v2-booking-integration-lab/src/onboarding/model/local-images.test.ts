import {
  decodeOnboardingLocalImage,
  ONBOARDING_GALLERY_MAX_FILES,
  ONBOARDING_GALLERY_MAX_TOTAL_BYTES,
  ONBOARDING_IMAGE_DECODE_ERROR,
  ONBOARDING_LOCAL_IMAGE_MAX_BYTES,
  normalizeOnboardingLocalImage,
  validateOnboardingGalleryImages,
  validateOnboardingLocalImage,
} from './local-images';

const SIGNATURES = {
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: new Uint8Array([
    0x52, 0x49, 0x46, 0x46,
    0x00, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
  ]),
} as const;

const VALID_IMAGE_CASES = [
  { bytes: SIGNATURES.png, fileName: 'portrait.png', mimeType: 'image/png' },
  { bytes: SIGNATURES.jpeg, fileName: 'portrait.jpg', mimeType: 'image/jpeg' },
  { bytes: SIGNATURES.webp, fileName: 'portrait.webp', mimeType: 'image/webp' },
] as const;

const withReportedSize = (file: File, size: number): File => {
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
};

const HEIC_SIGNATURE = new Uint8Array([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x6d, 0x69, 0x66, 0x31,
  0x00, 0x00, 0x00, 0x00,
  0x68, 0x65, 0x69, 0x63,
]);

const GENERIC_HEIF_SIGNATURE = new Uint8Array([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x6d, 0x69, 0x66, 0x31,
  0x00, 0x00, 0x00, 0x00,
  0x6d, 0x73, 0x66, 0x31,
]);

const AVIF_SIGNATURE = new Uint8Array([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x61, 0x76, 0x69, 0x66,
  0x00, 0x00, 0x00, 0x00,
  0x6d, 0x69, 0x66, 0x31,
]);

describe('browser-local onboarding image limits', () => {
  it('accepts bounded raster images and rejects unsupported or oversized files', () => {
    expect(() => validateOnboardingLocalImage(
      new File(['image'], 'portrait.jpg', { type: 'image/jpeg' }),
    )).not.toThrow();
    expect(() => validateOnboardingLocalImage(
      new File(['pdf'], 'portrait.pdf', { type: 'application/pdf' }),
    )).toThrow(/PNG, JPG, WebP, HEIC, or HEIF/u);
    expect(() => validateOnboardingLocalImage(
      new File([], 'empty.png', { type: 'image/png' }),
    )).toThrow(/empty/u);
    expect(() => validateOnboardingLocalImage(withReportedSize(
      new File(['large'], 'large.png', { type: 'image/png' }),
      ONBOARDING_LOCAL_IMAGE_MAX_BYTES + 1,
    ))).toThrow('Choose an image smaller than 15 MB.');
  });

  it('bounds Gallery count and aggregate browser-local payload size', () => {
    const tooMany = Array.from({ length: ONBOARDING_GALLERY_MAX_FILES + 1 }, (_, index) =>
      new File(['image'], `${index}.webp`, { type: 'image/webp' }));
    expect(() => validateOnboardingGalleryImages(tooMany)).toThrow(/up to 8/u);

    const largeSelection = [0, 1, 2].map((index) => withReportedSize(
      new File(['large'], `${index}.png`, { type: 'image/png' }),
      Math.floor(ONBOARDING_GALLERY_MAX_TOTAL_BYTES / 3) + 1,
    ));
    expect(() => validateOnboardingGalleryImages(largeSelection)).toThrow(/under 75 MB total/u);
  });

  it('reports unsupported HEIC truthfully instead of describing it as corrupt', async () => {
    const heic = new File([HEIC_SIGNATURE], 'IMG_5222.HEIC', { type: 'image/heic' });

    await expect(normalizeOnboardingLocalImage(heic, {
      decodeImage: vi.fn().mockRejectedValue(new Error('No HEIC decoder')),
    })).rejects.toMatchObject({
      code: 'unsupported_heic',
      message: 'This iPhone photo format isn’t supported in this browser. Choose a JPG, PNG, or WebP image.',
    });
  });

  it('treats generic HEIF containers as a decoder capability path while excluding AVIF', async () => {
    const genericHeif = new File([GENERIC_HEIF_SIGNATURE], 'IMG_5222.HEIF', {
      type: 'image/heif',
    });
    const avif = new File([AVIF_SIGNATURE], 'not-an-iphone-photo.heif', {
      type: 'image/heif',
    });

    await expect(normalizeOnboardingLocalImage(genericHeif, {
      decodeImage: vi.fn().mockRejectedValue(new Error('No HEIF decoder')),
    })).rejects.toMatchObject({ code: 'unsupported_heic' });
    await expect(normalizeOnboardingLocalImage(avif, {
      decodeImage: vi.fn(),
    })).rejects.toMatchObject({ code: 'signature_mismatch' });
  });

  it('normalizes browser-decodable HEIC bytes to a safe JPEG and closes the decoder', async () => {
    const heic = new File([HEIC_SIGNATURE], 'IMG_5222.HEIC', { type: 'image/heic' });
    const close = vi.fn();
    const decoded = {
      close,
      height: 3_024,
      orientationApplied: true,
      source: {} as CanvasImageSource,
      width: 4_032,
    };
    const normalized = new File([SIGNATURES.jpeg], 'IMG_5222.jpg', {
      type: 'image/jpeg',
    });
    const encodeDecodedImage = vi.fn().mockResolvedValue(normalized);

    await expect(normalizeOnboardingLocalImage(heic, {
      decodeImage: vi.fn().mockResolvedValue(decoded),
      encodeDecodedImage,
    })).resolves.toBe(normalized);
    expect(encodeDecodedImage).toHaveBeenCalledWith(decoded, heic);
    expect(close).toHaveBeenCalledOnce();
  });

  it('detects HEIC bytes even when an iPhone picker supplies a misleading JPEG MIME', async () => {
    const mislabeled = new File([HEIC_SIGNATURE], 'IMG_5222.jpeg', {
      type: 'image/jpeg',
    });

    await expect(normalizeOnboardingLocalImage(mislabeled, {
      decodeImage: vi.fn().mockRejectedValue(new Error('No HEIC decoder')),
    })).rejects.toMatchObject({ code: 'unsupported_heic' });
  });

  it.each(VALID_IMAGE_CASES)(
    'accepts the $mimeType signature only after a successful browser decode',
    async ({ bytes, fileName, mimeType }) => {
      const file = new File([bytes], fileName, { type: mimeType });
      const close = vi.fn();
      const decodeImage = vi.fn(async () => ({
        close,
        height: 900,
        orientationApplied: true,
        width: 600,
      }));

      await expect(decodeOnboardingLocalImage(file, { decodeImage }))
        .resolves.toEqual({ height: 900, width: 600 });
      expect(decodeImage).toHaveBeenCalledWith(file);
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it('rejects corrupt and MIME-mismatched raster data before browser decoding', async () => {
    const decodeImage = vi.fn();
    const corrupt = new File(['not-an-image'], 'portrait.png', { type: 'image/png' });
    const mislabeled = new File([SIGNATURES.jpeg], 'portrait.png', { type: 'image/png' });

    await expect(decodeOnboardingLocalImage(corrupt, { decodeImage }))
      .rejects.toThrow(ONBOARDING_IMAGE_DECODE_ERROR);
    await expect(decodeOnboardingLocalImage(mislabeled, { decodeImage }))
      .rejects.toThrow(ONBOARDING_IMAGE_DECODE_ERROR);
    expect(decodeImage).not.toHaveBeenCalled();
  });

  it('normalizes decode failures and invalid dimensions while closing decoded resources', async () => {
    const png = new File([SIGNATURES.png], 'portrait.png', { type: 'image/png' });
    await expect(decodeOnboardingLocalImage(png, {
      decodeImage: vi.fn(async () => {
        throw new Error('Native decoder detail');
      }),
    })).rejects.toThrow(ONBOARDING_IMAGE_DECODE_ERROR);

    const close = vi.fn();
    await expect(decodeOnboardingLocalImage(png, {
      decodeImage: vi.fn(async () => ({
        close,
        height: 0,
        orientationApplied: true,
        width: Number.NaN,
      })),
    })).rejects.toThrow(ONBOARDING_IMAGE_DECODE_ERROR);
    expect(close).toHaveBeenCalledOnce();
  });
});
