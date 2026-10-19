export const CLIENT_IMAGE_INPUT_BYTES = 20000000;
const UPLOAD_BYTES = 3000000;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Shared local preparation: preserve alpha/aspect; no crop, filters or enlargement. */
export async function prepareClientImage(file: File, kind: 'artwork' | 'photo'): Promise<File> {
  const artwork = kind === 'artwork';
  if (!TYPES.has(file.type) || file.size <= 0 || file.size > CLIENT_IMAGE_INPUT_BYTES) {
    throw new Error(artwork ? 'Choose a PNG, JPG or WebP Canva export under 20 MB.' : 'Choose a PNG, JPG or WebP photo or logo under 20 MB.');
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
      image.onerror = () => reject(new Error(artwork ? 'This export could not be read. Download it again from Canva as PNG or JPG.' : 'This image could not be read. Try its original PNG or JPG.'));
      image.src = url;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height || width * height > 40000000 || Math.max(width, height) > 16000) {
      throw new Error(artwork ? 'This export is too large to prepare on your device. Export separate Canva pages, or a smaller original PNG or JPG.' : 'This image is too large to prepare on your device. Export a smaller PNG or JPG. Your saved website is unchanged.');
    }
    const scale = artwork ? 1 : Math.min(1, 2400 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error(artwork ? 'Your browser could not prepare this export. Download a PNG or JPG under 3 MB from Canva.' : 'Your browser could not prepare this image. Try a PNG or JPG under 3 MB.');
    }
    // Modern image decoding honours EXIF orientation before drawing.
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.96, 0.9, 0.84]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (blob && ['image/webp', 'image/png'].includes(blob.type) && blob.size > 0 && blob.size <= UPLOAD_BYTES) {
        const extension = blob.type === 'image/webp' ? 'webp' : 'png';
        return new File([blob], `${file.name.replace(/\.[^.]+$/u, '')}.${extension}`, { type: blob.type, lastModified: file.lastModified });
      }
    }
    throw new Error(artwork ? 'This export is still too large for a clear upload. Export separate Canva pages or a high-quality JPG under 3 MB. Your saved design is unchanged.' : 'This image is still too large for a clear upload. Export a smaller PNG or high-quality JPG. Your saved website is unchanged.');
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    canvas.width = 0;
    canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}

export const prepareWebsiteImage = (file: File) => prepareClientImage(file, 'photo');
