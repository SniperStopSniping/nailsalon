const SERVICE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const SERVICE_IMAGE_TARGET_BYTES = 2 * 1024 * 1024;
const SERVICE_IMAGE_MAX_DIMENSION = 1600;

const SUPPORTED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const HEIC_CONTENT_TYPES = new Set([
  'image/heic',
  'image/heic-sequence',
  'image/heif',
  'image/heif-sequence',
  'image/x-heic',
  'image/x-heif',
]);
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const JPEG_QUALITY_STEPS = [0.82, 0.72, 0.62];

export type ServiceImageErrorCode
  = | 'UNSUPPORTED_IMAGE_TYPE'
  | 'HEIC_NOT_SUPPORTED'
  | 'EMPTY_IMAGE'
  | 'IMAGE_TOO_LARGE_AFTER_RESIZE'
  | 'IMAGE_PROCESSING_FAILED'
  | 'PRESIGN_FAILED'
  | 'UPLOAD_NETWORK_FAILED'
  | 'PROVIDER_REJECTED_UPLOAD'
  | 'FINALIZE_STALE_IMAGE'
  | 'FINALIZE_INVALID_METADATA'
  | 'IMAGE_PERMISSION_DENIED'
  | 'IMAGE_SERVICE_FAILED';

const ERROR_MESSAGES: Record<ServiceImageErrorCode, string> = {
  UNSUPPORTED_IMAGE_TYPE: 'Choose a JPG, PNG, or WebP image.',
  HEIC_NOT_SUPPORTED:
    'HEIC images are not supported yet. Please choose a screenshot, JPG, PNG, or WebP.',
  EMPTY_IMAGE: 'Choose a non-empty image.',
  IMAGE_TOO_LARGE_AFTER_RESIZE:
    'The image was still too large after resizing. Try a smaller image.',
  IMAGE_PROCESSING_FAILED:
    'Your browser could not read or resize that image. Try a JPG, PNG, or WebP.',
  PRESIGN_FAILED: 'The image upload could not be prepared. Try again.',
  UPLOAD_NETWORK_FAILED:
    'The image upload lost its connection. Check your internet and try again.',
  PROVIDER_REJECTED_UPLOAD:
    'The image service rejected the upload. Try another JPG, PNG, or WebP.',
  FINALIZE_STALE_IMAGE:
    'The service image changed elsewhere. Reopen Edit Service and try again.',
  FINALIZE_INVALID_METADATA:
    'The uploaded image could not be verified. Try another image.',
  IMAGE_PERMISSION_DENIED:
    'You no longer have permission to update this service image. Refresh and try again.',
  IMAGE_SERVICE_FAILED:
    'The image service could not finish the update. Open Edit Service and try again.',
};

const PARTIAL_SUCCESS_MESSAGES: Record<ServiceImageErrorCode, string> = {
  UNSUPPORTED_IMAGE_TYPE:
    'Service details were saved, but that image type is not supported. Choose a JPG, PNG, or WebP.',
  HEIC_NOT_SUPPORTED:
    'Service details were saved, but HEIC images are not supported yet. Choose a screenshot, JPG, PNG, or WebP.',
  EMPTY_IMAGE:
    'Service details were saved, but the selected image was empty. Choose another image.',
  IMAGE_TOO_LARGE_AFTER_RESIZE:
    'Service details were saved, but the image upload failed because the file was still too large after resizing. Try a smaller image.',
  IMAGE_PROCESSING_FAILED:
    'Service details were saved, but your browser could not read or resize that image. Try a JPG, PNG, or WebP.',
  PRESIGN_FAILED:
    'Service details were saved, but the image upload could not be prepared. Try again.',
  UPLOAD_NETWORK_FAILED:
    'Service details were saved, but the image upload lost its connection. Check your internet and try again.',
  PROVIDER_REJECTED_UPLOAD:
    'Service details were saved, but the image service rejected the upload. Try another JPG, PNG, or WebP.',
  FINALIZE_STALE_IMAGE:
    'Service details were saved, but the service image changed elsewhere. Reopen Edit Service and try again.',
  FINALIZE_INVALID_METADATA:
    'Service details were saved, but the uploaded image could not be verified. Try another image.',
  IMAGE_PERMISSION_DENIED:
    'Service details were saved, but you no longer have permission to update this service image. Refresh and try again.',
  IMAGE_SERVICE_FAILED:
    'Service details were saved, but the image service could not finish the update. Open Edit Service and try again.',
};

export class ServiceImageError extends Error {
  readonly code: ServiceImageErrorCode;

  constructor(code: ServiceImageErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ServiceImageError';
    this.code = code;
  }
}

type ImageRequestStage = 'presign' | 'finalize' | 'remove';

type DecodedServiceImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

function extensionFromName(name: string): string {
  return name.toLowerCase().split('.').pop() ?? '';
}

function normalizedContentType(file: File): string | null {
  const contentType = file.type.trim().toLowerCase();

  if (contentType === 'image/jpg') {
    return 'image/jpeg';
  }
  if (SUPPORTED_CONTENT_TYPES.has(contentType)) {
    return contentType;
  }
  if (contentType === '' || contentType === 'application/octet-stream') {
    return CONTENT_TYPE_BY_EXTENSION[extensionFromName(file.name)] ?? null;
  }

  return null;
}

function isHeic(file: File): boolean {
  const contentType = file.type.trim().toLowerCase();
  const extension = extensionFromName(file.name);

  return HEIC_CONTENT_TYPES.has(contentType)
    || extension === 'heic'
    || extension === 'heif';
}

export function validateServiceImageFile(file: File): File {
  if (isHeic(file)) {
    throw new ServiceImageError('HEIC_NOT_SUPPORTED');
  }

  const contentType = normalizedContentType(file);
  if (!contentType) {
    throw new ServiceImageError('UNSUPPORTED_IMAGE_TYPE');
  }
  if (file.size <= 0) {
    throw new ServiceImageError('EMPTY_IMAGE');
  }

  if (contentType === file.type) {
    return file;
  }

  return new File([file], file.name, {
    type: contentType,
    lastModified: file.lastModified,
  });
}

async function decodeWithImageBitmap(file: File): Promise<DecodedServiceImage | null> {
  if (typeof globalThis.createImageBitmap !== 'function') {
    return null;
  }

  try {
    const bitmap = await globalThis.createImageBitmap(file, {
      imageOrientation: 'from-image',
    });
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      bitmap.close();
      return null;
    }

    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  } catch {
    return null;
  }
}

function decodeWithImageElement(file: File): Promise<DecodedServiceImage> {
  return new Promise((resolve, reject) => {
    let objectUrl: string;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      reject(new ServiceImageError('IMAGE_PROCESSING_FAILED'));
      return;
    }

    const cleanUp = () => URL.revokeObjectURL(objectUrl);
    let image: HTMLImageElement;
    try {
      image = new Image();
    } catch {
      cleanUp();
      reject(new ServiceImageError('IMAGE_PROCESSING_FAILED'));
      return;
    }

    image.onload = () => {
      cleanUp();
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new ServiceImageError('IMAGE_PROCESSING_FAILED'));
        return;
      }
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      cleanUp();
      reject(new ServiceImageError('IMAGE_PROCESSING_FAILED'));
    };
    image.src = objectUrl;
  });
}

async function decodeServiceImage(file: File): Promise<DecodedServiceImage> {
  // HTMLImageElement applies EXIF orientation reliably on mobile Safari before
  // canvas output strips that metadata. ImageBitmap remains a fallback for
  // browsers that cannot decode the object URL through an image element.
  try {
    return await decodeWithImageElement(file);
  } catch {
    const bitmap = await decodeWithImageBitmap(file);
    if (bitmap) {
      return bitmap;
    }

    throw new ServiceImageError('IMAGE_PROCESSING_FAILED');
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new ServiceImageError('IMAGE_PROCESSING_FAILED'));
          return;
        }
        resolve(blob);
      }, 'image/jpeg', quality);
    } catch {
      reject(new ServiceImageError('IMAGE_PROCESSING_FAILED'));
    }
  });
}

function jpegFileName(fileName: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, '').trim() || 'service-image';
  return `${baseName}.jpg`;
}

/**
 * Confirms that the browser can decode the selected image, then reduces large
 * images before upload. Small images keep their original bytes and format.
 */
export async function prepareServiceImage(file: File): Promise<File> {
  const validatedFile = validateServiceImageFile(file);
  const decoded = await decodeServiceImage(validatedFile);

  try {
    const scale = Math.min(
      1,
      SERVICE_IMAGE_MAX_DIMENSION / decoded.width,
      SERVICE_IMAGE_MAX_DIMENSION / decoded.height,
    );
    const shouldOptimize = scale < 1
      || validatedFile.size > SERVICE_IMAGE_TARGET_BYTES;

    if (!shouldOptimize) {
      return validatedFile;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));

    const context = canvas.getContext('2d');
    if (!context) {
      throw new ServiceImageError('IMAGE_PROCESSING_FAILED');
    }

    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    let smallestBlob: Blob | null = null;
    for (const quality of JPEG_QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, quality);
      if (!smallestBlob || blob.size < smallestBlob.size) {
        smallestBlob = blob;
      }
      if (blob.size <= SERVICE_IMAGE_TARGET_BYTES) {
        break;
      }
    }

    if (
      scale === 1
      && validatedFile.size <= SERVICE_IMAGE_MAX_BYTES
      && (!smallestBlob || smallestBlob.size >= validatedFile.size)
    ) {
      return validatedFile;
    }

    if (!smallestBlob || smallestBlob.size > SERVICE_IMAGE_MAX_BYTES) {
      throw new ServiceImageError('IMAGE_TOO_LARGE_AFTER_RESIZE');
    }

    return new File([smallestBlob], jpegFileName(validatedFile.name), {
      type: 'image/jpeg',
      lastModified: validatedFile.lastModified,
    });
  } catch (error) {
    if (error instanceof ServiceImageError) {
      throw error;
    }
    throw new ServiceImageError('IMAGE_PROCESSING_FAILED');
  } finally {
    decoded.close?.();
  }
}

function apiErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    return null;
  }
  const error = payload.error;
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null;
  }

  return typeof error.code === 'string' ? error.code : null;
}

export function serviceImageResponseError(
  stage: ImageRequestStage,
  status: number,
  payload: unknown,
): ServiceImageError {
  const code = apiErrorCode(payload);

  if (
    status === 401
    || status === 403
    || code === 'UNAUTHORIZED'
    || code === 'NO_SALON_ACCESS'
    || code === 'SALON_NOT_FOUND'
    || code === 'SERVICE_NOT_FOUND'
  ) {
    return new ServiceImageError('IMAGE_PERMISSION_DENIED');
  }
  if (code === 'SERVICE_IMAGE_STALE' || (status === 409 && stage !== 'presign')) {
    return new ServiceImageError('FINALIZE_STALE_IMAGE');
  }
  if (code === 'FILE_TOO_LARGE') {
    return new ServiceImageError('IMAGE_TOO_LARGE_AFTER_RESIZE');
  }
  if (code === 'INVALID_FILE_TYPE' || code === 'UNSUPPORTED_MEDIA_TYPE') {
    return new ServiceImageError('UNSUPPORTED_IMAGE_TYPE');
  }
  if (
    code?.startsWith('INVALID_IMAGE')
    || code === 'UNMANAGED_IMAGE'
    || code === 'IMAGE_DIMENSIONS_TOO_LARGE'
    || code === 'NO_FILE_PROVIDED'
    || (code === 'VALIDATION_ERROR' && stage === 'finalize')
  ) {
    return new ServiceImageError('FINALIZE_INVALID_METADATA');
  }
  if (stage === 'presign') {
    return new ServiceImageError('PRESIGN_FAILED');
  }

  return new ServiceImageError('IMAGE_SERVICE_FAILED');
}

export function normalizeServiceImageError(error: unknown): ServiceImageError {
  return error instanceof ServiceImageError
    ? error
    : new ServiceImageError('IMAGE_SERVICE_FAILED');
}

export function serviceImagePartialSuccessMessage(error: unknown): string {
  const imageError = normalizeServiceImageError(error);

  return PARTIAL_SUCCESS_MESSAGES[imageError.code];
}
