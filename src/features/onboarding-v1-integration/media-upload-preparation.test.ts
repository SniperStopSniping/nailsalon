import type { DecodedImage } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets/image-processing';
import { ONBOARDING_MEDIA_MAX_FILE_BYTES, ONBOARDING_MEDIA_MAX_REQUEST_BYTES } from './media-limits';
import { prepareOnboardingMediaUpload } from './media-upload-preparation';

const browser = vi.hoisted(() => ({
  close: vi.fn(),
  decode: vi.fn<() => Promise<DecodedImage>>(),
  orientation: vi.fn(async () => 1),
}));

vi.mock('../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets/image-processing', async importOriginal => ({
  ...await importOriginal<typeof import('../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets/image-processing')>(),
  decodeImageInBrowser: browser.decode,
  readExifOrientation: browser.orientation,
}));

const png = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([bytes], { type: 'image/png' });
};
const context = { drawImage: vi.fn(), scale: vi.fn(), transform: vi.fn() };
const encode = vi.fn();
let canvases: { height: number; width: number }[];

beforeEach(() => {
  vi.clearAllMocks();
  canvases = [];
  browser.decode.mockResolvedValue({
    close: browser.close,
    height: 3_024,
    orientationApplied: true,
    source: {} as CanvasImageSource,
    width: 4_032,
  });
  browser.orientation.mockResolvedValue(1);
  encode.mockImplementation((callback: BlobCallback) => callback(new Blob([new Uint8Array(1_000_000)], { type: 'image/webp' })));
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = { getContext: () => context, height: 0, toBlob: encode, width: 0 };
      canvases.push(canvas);
      return canvas;
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('onboarding image transport preparation', () => {
  it('preserves a small supported image without decoding or replacing the local asset', async () => {
    const original = png(24);
    const prepared = await prepareOnboardingMediaUpload(original, 'logo.png');

    expect(prepared.name).toBe('logo.png');
    expect(prepared.type).toBe('image/png');
    expect(await prepared.arrayBuffer()).toEqual(await original.arrayBuffer());
    expect(browser.decode).not.toHaveBeenCalled();
  });

  it('prepares a large iPhone-sized image through the shared renderer below the multipart bound', async () => {
    const original = png(8_000_000);
    const prepared = await prepareOnboardingMediaUpload(original, 'iphone.png');
    const form = new FormData();
    form.set('file', prepared, prepared.name);
    form.set('siteId', '22222222-2222-4222-8222-222222222222');
    form.set('role', 'gallery');

    expect(prepared.type).toBe('image/webp');
    expect(prepared.name).toBe('iphone.webp');
    expect(prepared.size).toBeLessThanOrEqual(ONBOARDING_MEDIA_MAX_FILE_BYTES);
    expect((await new Response(form).blob()).size).toBeLessThan(ONBOARDING_MEDIA_MAX_REQUEST_BYTES);
    expect(canvases[0]).toMatchObject({ height: 1_920, width: 2_560 });
    expect(original.size).toBe(8_000_000);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('retains aspect ratio and applies unapplied EXIF orientation exactly once', async () => {
    browser.decode.mockResolvedValue({
      close: browser.close,
      height: 3_024,
      orientationApplied: false,
      source: {} as CanvasImageSource,
      width: 4_032,
    });
    browser.orientation.mockResolvedValue(6);

    await prepareOnboardingMediaUpload(png(5_000_000), 'portrait.png');

    expect(canvases[0]).toMatchObject({ height: 2_560, width: 1_920 });
    expect(context.transform).toHaveBeenCalledOnce();
    expect(context.scale).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('continues bounded compression when an initial encode is too large', async () => {
    encode.mockImplementationOnce((callback: BlobCallback) => callback(png(ONBOARDING_MEDIA_MAX_FILE_BYTES + 1)));

    const prepared = await prepareOnboardingMediaUpload(png(5_000_000), 'photo.png');

    expect(encode).toHaveBeenCalledTimes(2);
    expect(prepared.size).toBe(1_000_000);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('supports the PNG canvas fallback without dropping transparency', async () => {
    encode.mockImplementation((callback: BlobCallback) => callback(png(1_000_000)));

    const prepared = await prepareOnboardingMediaUpload(png(5_000_000), 'logo.png');

    expect(prepared.type).toBe('image/png');
    expect(prepared.name).toBe('logo.png');
  });

  it('uses JPEG for opaque photos when Safari cannot encode WebP', async () => {
    encode.mockImplementation((callback: BlobCallback, mimeType: string) => callback(new Blob([new Uint8Array(1_000_000)], {
      type: mimeType === 'image/webp' ? 'image/png' : mimeType,
    })));
    const bytes = new Uint8Array(5_000_000);
    bytes.set([0xFF, 0xD8, 0xFF]);

    const prepared = await prepareOnboardingMediaUpload(new Blob([bytes], { type: 'image/jpeg' }), 'photo.jpg');

    expect(prepared.type).toBe('image/jpeg');
    expect(prepared.name).toBe('photo.jpg');
    expect(encode.mock.calls.map(call => call[1])).toEqual(['image/webp', 'image/jpeg']);
  });

  it('downsizes alpha-capable PNG instead of flattening it when Safari PNG output remains too large', async () => {
    encode.mockImplementation((callback: BlobCallback) => callback(png(
      canvases[canvases.length - 1]!.width > 1_024 ? 4_100_000 : 3_000_000,
    )));

    const prepared = await prepareOnboardingMediaUpload(png(5_000_000), 'transparent.png');

    expect(prepared.type).toBe('image/png');
    expect(prepared.size).toBe(3_000_000);
    expect(canvases.at(-1)?.width).toBe(1_024);
    expect(encode.mock.calls.every(call => call[1] === 'image/webp')).toBe(true);
  });

  it('fails without uploading when safe encoding is unavailable and still closes the decoder', async () => {
    encode.mockImplementation((callback: BlobCallback) => callback(null));

    await expect(prepareOnboardingMediaUpload(png(5_000_000), 'photo.png')).rejects.toMatchObject({ code: 'normalization_failed' });
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('rejects a mismatched type before any decoder or encoder runs', async () => {
    await expect(prepareOnboardingMediaUpload(new Blob(['fake'], { type: 'image/png' }), 'photo.png'))
      .rejects.toMatchObject({ code: 'signature_mismatch' });
    expect(browser.decode).not.toHaveBeenCalled();
  });

  it('preserves the existing safe decoded-pixel limit', async () => {
    browser.decode.mockResolvedValue({ close: browser.close, height: 50_000, orientationApplied: true, width: 50_000 });

    await expect(prepareOnboardingMediaUpload(png(5_000_000), 'photo.png')).rejects.toMatchObject({ code: 'dimensions_too_large' });
    expect(encode).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('preserves every native pixel of tall artwork instead of applying the photo maximum edge', async () => {
    browser.decode.mockResolvedValue({ close: browser.close, height: 8_000, orientationApplied: true, source: {} as CanvasImageSource, width: 1_200 });
    const prepared = await prepareOnboardingMediaUpload(png(8_000_000), 'canva.png', 'artwork');

    expect(canvases[0]).toMatchObject({ width: 1_200, height: 8_000 });
    expect(encode.mock.calls[0]?.[1]).toBe('image/png');
    expect(prepared.size).toBeLessThanOrEqual(ONBOARDING_MEDIA_MAX_FILE_BYTES);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('keeps artwork dimensions for all bounded compression attempts', async () => {
    browser.decode.mockResolvedValue({ close: browser.close, height: 6_000, orientationApplied: true, source: {} as CanvasImageSource, width: 1_600 });
    encode.mockImplementationOnce((callback: BlobCallback) => callback(png(4_000_000)));
    const prepared = await prepareOnboardingMediaUpload(png(8_000_000), 'canva.png', 'artwork');

    expect(canvases).toHaveLength(2);
    expect(canvases.every(canvas => canvas.width === 1_600 && canvas.height === 6_000)).toBe(true);
    expect(prepared.type).toBe('image/webp');
    expect(encode.mock.calls.map(call => call[1])).toEqual(['image/png', 'image/webp']);
  });

  it('retains transparent artwork when the browser only encodes PNG', async () => {
    encode.mockImplementation((callback: BlobCallback) => callback(png(1_000_000)));
    browser.decode.mockResolvedValue({ close: browser.close, height: 4_000, orientationApplied: true, source: {} as CanvasImageSource, width: 1_200 });

    const prepared = await prepareOnboardingMediaUpload(png(8_000_000), 'transparent.png', 'artwork');

    expect(prepared.type).toBe('image/png');
    expect(canvases[0]).toMatchObject({ width: 1_200, height: 4_000 });
    expect(encode).toHaveBeenCalledOnce();
  });

  it('applies EXIF once while preserving full-resolution artwork geometry', async () => {
    browser.decode.mockResolvedValue({ close: browser.close, height: 1_200, orientationApplied: false, source: {} as CanvasImageSource, width: 6_000 });
    browser.orientation.mockResolvedValue(6);

    await prepareOnboardingMediaUpload(png(8_000_000), 'rotated.png', 'artwork');

    expect(canvases[0]).toMatchObject({ width: 1_200, height: 6_000 });
    expect(context.transform).toHaveBeenCalledOnce();
  });

  it('asks to split an oversized page instead of silently blurring it', async () => {
    browser.decode.mockResolvedValue({ close: browser.close, height: 8_000, orientationApplied: true, source: {} as CanvasImageSource, width: 1_200 });
    encode.mockImplementation((callback: BlobCallback) => callback(png(4_000_000)));
    const original = png(8_000_000);

    await expect(prepareOnboardingMediaUpload(original, 'canva.png', 'artwork')).rejects.toThrow('Export it as separate PNG pages');
    expect(encode).toHaveBeenCalledTimes(5);
    expect(canvases.every(canvas => canvas.width === 1_200 && canvas.height === 8_000)).toBe(true);
    expect(original.size).toBe(8_000_000);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('rejects artwork over the server pixel bound before attempting full-resolution encoding', async () => {
    browser.decode.mockResolvedValue({ close: browser.close, height: 7_000, orientationApplied: true, source: {} as CanvasImageSource, width: 6_000 });

    await expect(prepareOnboardingMediaUpload(png(8_000_000), 'canva.png', 'artwork')).rejects.toMatchObject({ code: 'dimensions_too_large' });
    expect(encode).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
