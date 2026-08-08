// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  prepareServiceImage,
  ServiceImageError,
  serviceImagePartialSuccessMessage,
  serviceImageResponseError,
  validateServiceImageFile,
} from './serviceImageClient';

const FIVE_MIB = 5 * 1024 * 1024;

type BitmapStub = {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
};

function bitmapStub(width: number, height: number): BitmapStub {
  return { width, height, close: vi.fn() };
}

function expectImageError(
  action: () => unknown,
  code: ServiceImageError['code'],
  message?: string,
) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceImageError);
    expect(error).toMatchObject({ code });

    if (message) {
      expect(error).toHaveProperty('message', message);
    }
    return;
  }

  throw new Error(`Expected ${code}`);
}

describe('serviceImageClient', () => {
  const createImageBitmapMock = vi.fn();

  beforeEach(() => {
    createImageBitmapMock.mockReset();
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ['photo.jpg', 'image/jpeg'],
    ['screenshot.png', 'image/png'],
    ['art.webp', 'image/webp'],
  ])('keeps a small supported %s image unchanged after decoding it', async (name, type) => {
    const bitmap = bitmapStub(900, 600);
    const file = new File(['small-image'], name, { type });

    createImageBitmapMock.mockResolvedValue(bitmap);

    await expect(prepareServiceImage(file)).resolves.toBe(file);
    expect(createImageBitmapMock).toHaveBeenCalledWith(file, {
      imageOrientation: 'from-image',
    });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('resizes an oversized image to 1600px and returns a compressed JPEG', async () => {
    const bitmap = bitmapStub(4032, 3024);
    const input = new File(
      [new Uint8Array(FIVE_MIB + 1)],
      'iphone-screenshot.png',
      { type: 'image/png', lastModified: 123 },
    );
    const compressedBlob = new Blob(
      [new Uint8Array(900 * 1024)],
      { type: 'image/jpeg' },
    );
    const context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback, type, quality) => {
        expect(type).toBe('image/jpeg');
        expect(quality).toBe(0.82);

        callback(compressedBlob);
      });

    createImageBitmapMock.mockResolvedValue(bitmap);

    const prepared = await prepareServiceImage(input);
    const canvas = getContext.mock.contexts[0] as HTMLCanvasElement;

    expect(prepared).not.toBe(input);
    expect(prepared.name).toBe('iphone-screenshot.jpg');
    expect(prepared.type).toBe('image/jpeg');
    expect(prepared.size).toBe(compressedBlob.size);
    expect(prepared.size).toBeLessThan(FIVE_MIB);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(context.fillStyle).toBe('#fff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200);
    expect(context.drawImage).toHaveBeenCalledWith(
      bitmap,
      0,
      0,
      1600,
      1200,
    );
    expect(toBlob).toHaveBeenCalledOnce();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('reports a specific error when the compressed output still exceeds 5 MiB', async () => {
    const bitmap = bitmapStub(4000, 3000);
    const input = new File(
      [new Uint8Array(FIVE_MIB + 1)],
      'too-detailed.jpg',
      { type: 'image/jpeg' },
    );
    const tooLargeBlob = new Blob([new Uint8Array(FIVE_MIB + 1)], {
      type: 'image/jpeg',
    });

    createImageBitmapMock.mockResolvedValue(bitmap);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(callback => callback(tooLargeBlob));

    await expect(prepareServiceImage(input)).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE_AFTER_RESIZE',
      message: 'The image was still too large after resizing. Try a smaller image.',
    });
    expect(toBlob).toHaveBeenCalledTimes(3);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('maps a browser JPEG encoding failure and still closes the decoded bitmap', async () => {
    const bitmap = bitmapStub(2400, 1600);
    const input = new File(['image'], 'encode-failure.png', {
      type: 'image/png',
    });

    createImageBitmapMock.mockResolvedValue(bitmap);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(callback => callback(null));

    await expect(prepareServiceImage(input)).rejects.toMatchObject({
      code: 'IMAGE_PROCESSING_FAILED',
      message: 'Your browser could not read or resize that image. Try a JPG, PNG, or WebP.',
    });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('keeps an upload-safe original when JPEG conversion would make it larger', async () => {
    const bitmap = bitmapStub(1200, 800);
    const input = new File(
      [new Uint8Array(3 * 1024 * 1024)],
      'efficient.webp',
      { type: 'image/webp' },
    );
    const largerJpeg = {
      size: FIVE_MIB + 1,
      type: 'image/jpeg',
    } as Blob;

    createImageBitmapMock.mockResolvedValue(bitmap);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(callback => callback(largerJpeg));

    await expect(prepareServiceImage(input)).resolves.toBe(input);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['unsafe.svg', 'image/svg+xml'],
    ['animated.gif', 'image/gif'],
  ])('rejects unsupported image type %s before decoding', (name, type) => {
    const file = new File(['unsupported'], name, { type });

    expectImageError(
      () => validateServiceImageFile(file),
      'UNSUPPORTED_IMAGE_TYPE',
      'Choose a JPG, PNG, or WebP image.',
    );

    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });

  it.each([
    ['legacy.jpg', 'image/jpg', 'image/jpeg'],
    ['camera.JPEG', '', 'image/jpeg'],
    ['screenshot.PNG', 'application/octet-stream', 'image/png'],
    ['art.WEBP', '', 'image/webp'],
  ])('normalizes supported browser metadata for %s', (name, type, expectedType) => {
    const file = new File(['supported'], name, { type, lastModified: 456 });
    const validated = validateServiceImageFile(file);

    expect(validated.name).toBe(name);
    expect(validated.type).toBe(expectedType);
    expect(validated.size).toBe(file.size);
    expect(validated.lastModified).toBe(456);
  });

  it.each([
    ['photo.heic', 'image/heic'],
    ['photo.heif', 'image/heif'],
    ['photo.heic', 'image/x-heic'],
    ['photo.heif', 'image/x-heif'],
    ['PHOTO.HEIC', ''],
    ['PHOTO.HEIF', 'application/octet-stream'],
  ])('rejects HEIC/HEIF selection %s with clear guidance', (name, type) => {
    const file = new File(['heic'], name, { type });

    expectImageError(
      () => validateServiceImageFile(file),
      'HEIC_NOT_SUPPORTED',
      'HEIC images are not supported yet. Please choose a screenshot, JPG, PNG, or WebP.',
    );
  });

  it('prefers orientation-safe HTML image decoding when ImageBitmap is also available', async () => {
    const file = new File(['safari-image'], 'safari.png', { type: 'image/png' });
    const revokeObjectURL = vi.fn();

    class SuccessfulImage {
      naturalHeight = 800;
      naturalWidth = 1200;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      get src() {
        return '';
      }

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal('Image', SuccessfulImage);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:safari-fallback'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    await expect(prepareServiceImage(file)).resolves.toBe(file);
    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:safari-fallback');
  });

  it('maps browser decode failures to a specific safe error', async () => {
    const file = new File(['unreadable'], 'unreadable.jpg', { type: 'image/jpeg' });
    const revokeObjectURL = vi.fn();

    class FailedImage {
      naturalHeight = 0;
      naturalWidth = 0;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      get src() {
        return '';
      }

      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }

    createImageBitmapMock.mockRejectedValue(new DOMException('decode failed'));
    vi.stubGlobal('Image', FailedImage);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:decode-failure'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    await expect(prepareServiceImage(file)).rejects.toMatchObject({
      code: 'IMAGE_PROCESSING_FAILED',
      message: 'Your browser could not read or resize that image. Try a JPG, PNG, or WebP.',
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:decode-failure');
  });

  it.each([
    ['presign', 503, { error: { code: 'IMAGE_STORAGE_UNAVAILABLE' } }, 'PRESIGN_FAILED'],
    ['presign', 409, { error: { code: 'SERVICE_IMAGE_STALE' } }, 'FINALIZE_STALE_IMAGE'],
    ['finalize', 409, { error: { code: 'SERVICE_IMAGE_STALE' } }, 'FINALIZE_STALE_IMAGE'],
    ['finalize', 400, { error: { code: 'INVALID_IMAGE_UPLOAD' } }, 'FINALIZE_INVALID_METADATA'],
    ['finalize', 400, { error: { code: 'INVALID_IMAGE' } }, 'FINALIZE_INVALID_METADATA'],
    ['finalize', 400, { error: { code: 'UNMANAGED_IMAGE' } }, 'FINALIZE_INVALID_METADATA'],
    ['finalize', 400, { error: { code: 'IMAGE_DIMENSIONS_TOO_LARGE' } }, 'FINALIZE_INVALID_METADATA'],
    ['finalize', 400, { error: { code: 'FILE_TOO_LARGE' } }, 'IMAGE_TOO_LARGE_AFTER_RESIZE'],
    ['finalize', 403, { error: { message: 'private details' } }, 'IMAGE_PERMISSION_DENIED'],
    ['finalize', 500, { error: { code: 'IMAGE_SAVE_FAILED' } }, 'IMAGE_SERVICE_FAILED'],
    ['finalize', 502, { error: { code: 'IMAGE_VERIFICATION_FAILED' } }, 'IMAGE_SERVICE_FAILED'],
  ] as const)(
    'maps %s HTTP %s failures with safe typed codes',
    (stage, status, payload, expectedCode) => {
      expect(serviceImageResponseError(stage, status, payload)).toMatchObject({
        code: expectedCode,
      });
    },
  );

  it.each([
    ['PRESIGN_FAILED', 'image upload could not be prepared'],
    ['UPLOAD_NETWORK_FAILED', 'image upload lost its connection'],
    ['PROVIDER_REJECTED_UPLOAD', 'image service rejected the upload'],
    ['FINALIZE_STALE_IMAGE', 'service image changed elsewhere'],
    ['FINALIZE_INVALID_METADATA', 'uploaded image could not be verified'],
    ['IMAGE_PERMISSION_DENIED', 'no longer have permission'],
    ['IMAGE_SERVICE_FAILED', 'image service could not finish'],
  ] as const)('creates safe partial-success copy for %s', (code, copy) => {
    const message = serviceImagePartialSuccessMessage(
      new ServiceImageError(code),
    );

    expect(message).toContain('Service details were saved');
    expect(message).toContain(copy);
    expect(message).not.toContain('signature');
    expect(message).not.toContain('token');
  });
});
