// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { CLIENT_IMAGE_INPUT_BYTES, prepareWebsiteImage } from './image-upload';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function browser(width: number, height: number) {
  const revoked = vi.fn();
  const drawImage = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:local-photo';
    static revokeObjectURL = revoked;
  });
  vi.stubGlobal('Image', class {
    naturalWidth = width;
    naturalHeight = height;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    get src() {
      return '';
    }

    set src(value: string) {
      if (value) {
        queueMicrotask(() => this.onload?.());
      }
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['prepared'], { type: 'image/webp' })));
  return { drawImage, revoked };
}

it.each([[4000, 3000, 2400, 1800], [3000, 4000, 1800, 2400], [1200, 800, 1200, 800]])('bounds %d x %d photos to %d x %d without cropping or enlargement', async (width, height, outputWidth, outputHeight) => {
  const { drawImage, revoked } = browser(width, height);
  const input = new File([new Uint8Array(3100000)], 'my-photo.jpg', { type: 'image/jpeg', lastModified: 123 });
  const result = await prepareWebsiteImage(input);

  expect(result).toMatchObject({ name: 'my-photo.webp', type: 'image/webp', lastModified: 123 });
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, outputWidth, outputHeight);
  expect(revoked).toHaveBeenCalledOnce();
});

it('keeps a bounded original untouched and never requests AI or external image processing', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const input = new File(['original'], 'logo.png', { type: 'image/png' });

  expect(await prepareWebsiteImage(input)).toBe(input);
  expect(fetch).not.toHaveBeenCalled();
});

it('retains a transparency-capable format and frees a wide logo canvas', async () => {
  const { drawImage } = browser(4096, 1024);
  const output = await prepareWebsiteImage(new File([new Uint8Array(3100000)], 'logo.png', { type: 'image/png' }));

  expect(output.type).toBe('image/webp');
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2400, 600);
});

it('rejects unsupported, empty, excessive-byte and excessive-pixel files without an upload', async () => {
  await expect(prepareWebsiteImage(new File(['svg'], 'logo.svg', { type: 'image/svg+xml' }))).rejects.toThrow('under 20 MB');
  await expect(prepareWebsiteImage(new File([], 'empty.png', { type: 'image/png' }))).rejects.toThrow('under 20 MB');
  await expect(prepareWebsiteImage(new File([new Uint8Array(CLIENT_IMAGE_INPUT_BYTES + 1)], 'huge.png', { type: 'image/png' }))).rejects.toThrow('under 20 MB');

  const { drawImage, revoked } = browser(10000, 10000);

  await expect(prepareWebsiteImage(new File([new Uint8Array(3100000)], 'huge.png', { type: 'image/png' }))).rejects.toThrow('too large to prepare');
  expect(drawImage).not.toHaveBeenCalled();
  expect(revoked).toHaveBeenCalledOnce();
});
