import { CANVA_INPUT_BYTES } from './canva-upload';

export const CANVA_MAX_PAGES = 6;
const PAGE_PIXELS = 12000000;
const TOTAL_PIXELS = 36000000;
class CanvaPdfError extends Error {}

/** Render artwork only. PDF annotations, links, forms and scripts never become UI. */
export async function prepareCanvaPdf(file: File, maximumPages: number, onProgress?: (message: string) => void): Promise<File[]> {
  if (file.type !== 'application/pdf' || !file.size || file.size > CANVA_INPUT_BYTES) {
    throw new CanvaPdfError('Choose a Canva PDF under 20 MB.');
  }
  if (typeof Worker !== 'function') {
    throw new CanvaPdfError('This browser cannot prepare a PDF. Download PNG pages from Canva, or use a newer browser.');
  }
  if (!Number.isInteger(maximumPages) || maximumPages < 1 || maximumPages > CANVA_MAX_PAGES) {
    throw new CanvaPdfError('Keep up to six Canva pages. Remove an attached page to make room.');
  }
  onProgress?.('Preparing your PDF…');
  const { AnnotationMode, getDocument, PDFWorker, version } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const base = new URL(`/assets/pdfjs/${version}/`, location.origin).href;
  // Require a real worker; do not fall back to interpreting a PDF on the owner UI thread.
  const worker = new Worker(`${base}pdf.worker.legacy.min.mjs`, { type: 'module', name: 'luster-canva-artwork' });
  const pdfWorker = PDFWorker.create({ port: worker });
  let loading: ReturnType<typeof getDocument> | undefined;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      reject(new Error('PDF preparation timed out.'));
    }, 90000);
  });
  const bounded = <T>(work: Promise<T>) => Promise.race([work, deadline]);
  try {
    const data = new Uint8Array(await bounded(file.arrayBuffer()));
    if (new TextDecoder().decode(data.subarray(0, 5)) !== '%PDF-') {
      throw new CanvaPdfError('This file is not a readable PDF. Export it again from Canva.');
    }
    loading = getDocument({
      data,
      worker: pdfWorker,
      verbosity: 0,
      enableXfa: false,
      stopAtErrors: true,
      cMapUrl: `${base}cmaps/`,
      standardFontDataUrl: `${base}standard_fonts/`,
      iccUrl: `${base}iccs/`,
      wasmUrl: `${base}wasm/`,
      useWorkerFetch: true,
      maxImageSize: 40000000,
      canvasMaxAreaInBytes: PAGE_PIXELS * 4,
      useSystemFonts: false,
    });
    const pdf = await bounded(loading.promise);
    if (pdf.numPages < 1 || pdf.numPages > maximumPages) {
      throw new CanvaPdfError(`This PDF has ${pdf.numPages} pages. You can add ${maximumPages} more Canva page${maximumPages === 1 ? '' : 's'}. Export fewer pages or remove an attached page.`);
    }
    // Validate the whole document's geometry before allocating or uploading a page.
    const dimensions: { width: number; height: number; scale: number }[] = [];
    let pixels = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await bounded(pdf.getPage(number));
      const original = page.getViewport({ scale: 1 });
      if (!Number.isFinite(original.width) || !Number.isFinite(original.height) || original.width < 1 || original.height < 1 || Math.max(original.width, original.height) > 16000) {
        throw new CanvaPdfError('A PDF page is too large or has an unreadable size. Export separate standard-sized Canva pages.');
      }
      // Rasterize vector artwork sharply, without stretching its aspect ratio.
      const scale = Math.min(1600 / original.width, Math.sqrt(PAGE_PIXELS / (original.width * original.height)), 16000 / Math.max(original.width, original.height));
      const width = Math.ceil(original.width * scale);
      const height = Math.ceil(original.height * scale);
      pixels += width * height;
      if (pixels > TOTAL_PIXELS) {
        throw new CanvaPdfError('These PDF pages are too large to prepare together. Upload fewer pages at a time.');
      }
      dimensions.push({ width, height, scale });
      page.cleanup();
    }
    const pages: File[] = [];
    for (const [index, size] of dimensions.entries()) {
      onProgress?.(`Preparing PDF page ${index + 1} of ${pdf.numPages}…`);
      const page = await bounded(pdf.getPage(index + 1));
      const canvas = document.createElement('canvas');
      try {
        canvas.width = size.width;
        canvas.height = size.height;
        // PDF page paper is white; retain the PDF's vector type and visible appearances.
        await bounded(page.render({ canvas, viewport: page.getViewport({ scale: size.scale }), annotationMode: AnnotationMode.ENABLE }).promise);
        let saved: Blob | null = null;
        for (const quality of [0.96, 0.9, 0.84]) {
          const blob = await bounded(new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality)));
          if (blob && ['image/webp', 'image/png'].includes(blob.type) && blob.size > 0 && blob.size <= 3000000) {
            saved = blob;
            break;
          }
        }
        if (!saved) {
          throw new CanvaPdfError('A PDF page is too detailed to upload clearly. Download separate high-quality PNG or JPG pages from Canva.');
        }
        pages.push(new File([saved], `${file.name.replace(/\.[^.]+$/u, '')} - page ${index + 1}.${saved.type === 'image/webp' ? 'webp' : 'png'}`, { type: saved.type, lastModified: file.lastModified }));
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
    return pages;
  } catch (error) {
    if (timedOut) {
      throw new Error('This PDF took too long to prepare. Try fewer pages or download PNG images from Canva. Your saved design is unchanged.');
    }
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new Error('Use a PDF without a password, or download PNG images from Canva.');
    }
    if (error instanceof CanvaPdfError) {
      throw error;
    }
    throw new Error('Your PDF could not be prepared on this device. Download PNG pages from Canva, or try again. Your saved design is unchanged.');
  } finally {
    clearTimeout(timeout!);
    try {
      if (timedOut) {
        void loading?.destroy().catch(() => {});
      } else {
        await loading?.destroy().catch(() => {});
      }
    } finally {
      pdfWorker.destroy();
      worker.terminate();
    }
  }
}
