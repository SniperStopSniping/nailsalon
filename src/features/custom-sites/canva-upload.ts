const UPLOAD_BYTES = 3000000;
export const CANVA_INPUT_BYTES = 20000000;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Prepare a larger export locally. Keep dimensions, alpha and composition; never upscale. */
export async function prepareCanvaUpload(file: File): Promise<File> {
  if (!TYPES.has(file.type) || file.size <= 0 || file.size > CANVA_INPUT_BYTES) {
    throw new Error('Choose a PNG, JPG or WebP Canva export under 20 MB.');
  }
  if (file.size <= UPLOAD_BYTES) {
    return file;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This export could not be read. Download it again from Canva as PNG or JPG.'));
      image.src = url;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height || width * height > 40000000 || Math.max(width, height) > 16000) {
      throw new Error('This export is too large to prepare on your device. Export separate Canva pages, or a smaller original PNG or JPG.');
    }
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Your browser could not prepare this export. Download a PNG or JPG under 3 MB from Canva.');
    }
    context.drawImage(image, 0, 0, width, height);
    for (const quality of [0.96, 0.9, 0.84]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (blob && ['image/webp', 'image/png'].includes(blob.type) && blob.size > 0 && blob.size <= UPLOAD_BYTES) {
        const extension = blob.type === 'image/webp' ? 'webp' : 'png';
        return new File([blob], `${file.name.replace(/\.[^.]+$/u, '')}.${extension}`, { type: blob.type, lastModified: file.lastModified });
      }
    }
    throw new Error('This export is still too large for a clear upload. Export separate Canva pages or a high-quality JPG under 3 MB. Your saved design is unchanged.');
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    canvas.width = 0;
    canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}
