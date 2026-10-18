// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { prepareCanvaPdf } from './canva-pdf-upload';

const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), destroyWorker: vi.fn() }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  version: '6.4.299',
  AnnotationMode: { ENABLE: 1 },
  getDocument: mocks.getDocument,
  PDFWorker: { create: () => ({ destroy: mocks.destroyWorker }) },
}));

let terminated: ReturnType<typeof vi.fn>;

beforeEach(() => {
  terminated = vi.fn();
  vi.stubGlobal('Worker', class {
    terminate = terminated;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['artwork'], { type: 'image/webp' })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mocks.getDocument.mockReset();
  mocks.destroyWorker.mockReset();
});

function file() {
  const file = new File(['%PDF-test'], 'my-canva.pdf', { type: 'application/pdf', lastModified: 123 });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('%PDF-test').buffer });
  return file;
}
function document(sizes: [number, number][] = [[400, 800], [800, 400]]) {
  const render = vi.fn(() => ({ promise: Promise.resolve() }));
  const cleanup = vi.fn();
  const pages = sizes.map(([width, height]) => ({ getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale }), render, cleanup }));
  const destroy = vi.fn().mockResolvedValue(undefined);
  const getPage = vi.fn(async (number: number) => pages[number - 1]!);
  mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: pages.length, getPage }), destroy });
  return { render, cleanup, getPage, destroy };
}

it('preserves rotated page proportions and order, paints visible appearances and releases canvases/workers', async () => {
  const { render, destroy, cleanup } = document();
  const progress: string[] = [];
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const pages = await prepareCanvaPdf(file(), 6, text => progress.push(text));

  expect(pages.map(page => page.name)).toEqual(['my-canva - page 1.webp', 'my-canva - page 2.webp']);
  expect(pages.every(page => page.type === 'image/webp' && page.lastModified === 123)).toBe(true);
  expect(render.mock.calls.map(([options]: any) => options.viewport)).toEqual([{ width: 1600, height: 3200 }, { width: 1600, height: 800 }]);
  expect(render.mock.calls.every(([options]: any) => options.annotationMode === 1 && options.canvas.width === 0 && options.canvas.height === 0)).toBe(true);
  expect(progress).toEqual(['Preparing your PDF…', 'Preparing PDF page 1 of 2…', 'Preparing PDF page 2 of 2…']);
  expect(mocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array), enableXfa: false, stopAtErrors: true, useWorkerFetch: true, useSystemFonts: false, cMapUrl: expect.stringContaining('/assets/pdfjs/6.4.299/cmaps/'), maxImageSize: 40000000 }));
  expect(mocks.getDocument.mock.calls[0]![0]).not.toHaveProperty('url');
  expect(fetch).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(4);
  expect(destroy).toHaveBeenCalledOnce();
  expect(terminated).toHaveBeenCalledOnce();
  expect(mocks.destroyWorker).toHaveBeenCalledOnce();
});

it('rejects excess pages and extreme geometry before rendering any page', async () => {
  let fixture = document();

  await expect(prepareCanvaPdf(file(), 1)).rejects.toThrow('You can add 1 more Canva page');
  expect(fixture.render).not.toHaveBeenCalled();

  fixture = document([[20000, 20000]]);

  await expect(prepareCanvaPdf(file(), 6)).rejects.toThrow('too large');
  expect(fixture.render).not.toHaveBeenCalled();

  fixture = document(Array.from({ length: 6 }, () => [400, 4000]));

  await expect(prepareCanvaPdf(file(), 6)).rejects.toThrow('too large to prepare together');
  expect(fixture.render).not.toHaveBeenCalled();
});

it('bounds encoding and frees the current page after a failure without producing partial files', async () => {
  const { cleanup, destroy } = document();
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob([new Uint8Array(3000001)], { type: 'image/png' })));

  await expect(prepareCanvaPdf(file(), 6)).rejects.toThrow('too detailed');
  expect(encode).toHaveBeenCalledTimes(3);
  expect(cleanup).toHaveBeenCalledTimes(3);
  expect(destroy).toHaveBeenCalledOnce();
  expect(terminated).toHaveBeenCalledOnce();
});

it('handles password-protected PDFs without showing a password dialog or leaving a worker running', async () => {
  const destroy = vi.fn().mockResolvedValue(undefined);
  mocks.getDocument.mockReturnValue({ promise: Promise.reject(Object.assign(new Error('password'), { name: 'PasswordException' })), destroy });

  await expect(prepareCanvaPdf(file(), 6)).rejects.toThrow('without a password');
  expect(destroy).toHaveBeenCalledOnce();
  expect(terminated).toHaveBeenCalledOnce();
});

it('terminates a stalled parser after a bounded wait and leaves saved artwork unchanged', async () => {
  vi.useFakeTimers();
  const destroy = vi.fn().mockResolvedValue(undefined);
  mocks.getDocument.mockReturnValue({ promise: new Promise(() => {}), destroy });
  const assertion = expect(prepareCanvaPdf(file(), 6)).rejects.toThrow('took too long');
  await vi.advanceTimersByTimeAsync(90000);
  await assertion;

  expect(destroy).toHaveBeenCalledOnce();
  expect(terminated).toHaveBeenCalledOnce();
});

it('explains an unexpected parser failure in plain language without leaking its internal error', async () => {
  const destroy = vi.fn().mockResolvedValue(undefined);
  mocks.getDocument.mockReturnValue({ promise: Promise.reject(new TypeError('private-parser-internal-detail')), destroy });

  await expect(prepareCanvaPdf(file(), 6)).rejects.toThrow('Your PDF could not be prepared on this device. Download PNG pages from Canva');
  expect(destroy).toHaveBeenCalledOnce();
  expect(terminated).toHaveBeenCalledOnce();
});
