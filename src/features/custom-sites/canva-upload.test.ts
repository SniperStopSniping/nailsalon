// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { CANVA_INPUT_BYTES, prepareCanvaUpload } from './canva-upload';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps an already bounded original unchanged without decoding, upscaling or an AI request', async () => {
  const file = new File(['original'], 'canva.png', { type: 'image/png' });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  expect(await prepareCanvaUpload(file)).toBe(file);
  expect(fetch).not.toHaveBeenCalled();
});

function browser(width = 1200, height = 3600) {
  const revoked = vi.fn();
  const drawImage = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:local-canva';
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
  return { revoked, drawImage };
}

it('prepares an oversized Canva export at its full dimensions, retains transparency format and frees browser memory', async () => {
  const { revoked, drawImage } = browser();
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['encoded-image'], { type: 'image/webp' })));
  const input = new File([new Uint8Array(3100000)], 'original.png', { type: 'image/png', lastModified: 123 });
  const saved = await prepareCanvaUpload(input);

  expect(saved).toMatchObject({ name: 'original.webp', type: 'image/webp', lastModified: 123 });
  expect(saved.size).toBeLessThanOrEqual(3000000);
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1200, 3600);
  expect(encode).toHaveBeenCalledOnce();
  expect(revoked).toHaveBeenCalledWith('blob:local-canva');
});

it('bounds compression retries and reports a useful fallback without stretching or flattening a transparent PNG', async () => {
  const { revoked } = browser();
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob([new Uint8Array(3100000)], { type: 'image/png' })));

  await expect(prepareCanvaUpload(new File([new Uint8Array(3100000)], 'original.png', { type: 'image/png' }))).rejects.toThrow('separate Canva pages');
  expect(encode).toHaveBeenCalledTimes(3);
  expect(revoked).toHaveBeenCalledOnce();
});

it('rejects excessive files and decoded pixels before allocating a canvas or sending a request', async () => {
  await expect(prepareCanvaUpload(new File([new Uint8Array(CANVA_INPUT_BYTES + 1)], 'huge.png', { type: 'image/png' }))).rejects.toThrow('under 20 MB');
  await expect(prepareCanvaUpload(new File(['svg'], 'bad.svg', { type: 'image/svg+xml' }))).rejects.toThrow('PNG, JPG or WebP');

  const { revoked, drawImage } = browser(10000, 10000);

  await expect(prepareCanvaUpload(new File([new Uint8Array(3100000)], 'large.png', { type: 'image/png' }))).rejects.toThrow('too large to prepare');
  expect(drawImage).not.toHaveBeenCalled();
  expect(revoked).toHaveBeenCalledOnce();
});
