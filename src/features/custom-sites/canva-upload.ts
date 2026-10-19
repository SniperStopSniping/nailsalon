import { CLIENT_IMAGE_INPUT_BYTES, prepareClientImage } from './image-upload';

export const CANVA_INPUT_BYTES = CLIENT_IMAGE_INPUT_BYTES;

/** Keep PDF parsing out of the normal image-upload bundle. */
export async function prepareCanvaPages(file: File, maximumPages = 6, onProgress?: (message: string) => void): Promise<File[]> {
  if (file.type === 'application/pdf') {
    const { prepareCanvaPdf } = await import('./canva-pdf-upload');
    return prepareCanvaPdf(file, maximumPages, onProgress);
  }
  if (maximumPages < 1) {
    throw new Error('Keep up to six Canva pages. Remove an attached page to make room.');
  }
  return [await prepareCanvaUpload(file)];
}

/** Prepare a larger export locally. Keep dimensions, alpha and composition; never upscale. */
export async function prepareCanvaUpload(file: File): Promise<File> {
  return prepareClientImage(file, 'artwork');
}
