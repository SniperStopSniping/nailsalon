import {
  decodeOnboardingLocalImage,
  ONBOARDING_GALLERY_MAX_FILES,
  ONBOARDING_IMAGE_DECODE_ERROR,
  ONBOARDING_LOCAL_IMAGE_MAX_BYTES,
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

describe('browser-local onboarding image limits', () => {
  it('accepts bounded raster images and rejects unsupported or oversized files', () => {
    expect(() => validateOnboardingLocalImage(
      new File(['image'], 'portrait.jpg', { type: 'image/jpeg' }),
    )).not.toThrow();
    expect(() => validateOnboardingLocalImage(
      new File(['pdf'], 'portrait.pdf', { type: 'application/pdf' }),
    )).toThrow(/PNG, JPG, or WebP/u);
    expect(() => validateOnboardingLocalImage(
      new File([], 'empty.png', { type: 'image/png' }),
    )).toThrow(/empty/u);
    expect(() => validateOnboardingLocalImage(
      new File([new Uint8Array(ONBOARDING_LOCAL_IMAGE_MAX_BYTES + 1)], 'large.png', {
        type: 'image/png',
      }),
    )).toThrow('Choose an image smaller than 1.5 MB.');
  });

  it('bounds Gallery count and aggregate browser-local payload size', () => {
    const tooMany = Array.from({ length: ONBOARDING_GALLERY_MAX_FILES + 1 }, (_, index) =>
      new File(['image'], `${index}.webp`, { type: 'image/webp' }));
    expect(() => validateOnboardingGalleryImages(tooMany)).toThrow(/up to 8/u);

    const largeSelection = [0, 1, 2].map((index) => new File([
      new Uint8Array(1_100_000),
    ], `${index}.png`, { type: 'image/png' }));
    expect(() => validateOnboardingGalleryImages(largeSelection)).toThrow(/under 3 MB total/u);
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
