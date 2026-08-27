import {
  CUSTOM_DESIGN_MAX_FILE_BYTES,
  CUSTOM_DESIGN_MAX_IMAGE_DIMENSION,
  CUSTOM_DESIGN_MAX_IMAGE_PIXELS,
  CUSTOM_DESIGN_MAX_IMAGES,
  CUSTOM_DESIGN_MAX_SECTION_BYTES,
  CUSTOM_DESIGN_SUPPORTED_MIME_TYPES,
} from '../model/constants';
import type { CustomDesignMimeType } from '../model/types';
import {
  CUSTOM_DESIGN_MAX_THUMBNAIL_BYTES,
  CUSTOM_DESIGN_THUMBNAIL_MAX_EDGE_PX,
  type ExifOrientation,
  type ImageAssetMetadata,
  type PreparedImageAsset,
  type SupportedImageMimeType,
} from './types';

export const CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX =
  CUSTOM_DESIGN_MAX_IMAGE_DIMENSION;
export const CUSTOM_DESIGN_MAX_DECODED_PIXELS =
  CUSTOM_DESIGN_MAX_IMAGE_PIXELS;
export { CUSTOM_DESIGN_THUMBNAIL_MAX_EDGE_PX } from './types';
export const CUSTOM_DESIGN_EXIF_SCAN_BYTES = 256 * 1024;

export type ImageUploadErrorCode =
  | 'corrupt_image'
  | 'decode_failed'
  | 'dimensions_too_large'
  | 'empty_file'
  | 'file_too_large'
  | 'invalid_capacity'
  | 'invalid_file_size'
  | 'signature_mismatch'
  | 'section_too_large'
  | 'too_many_images'
  | 'unsupported_type';

export class ImageUploadError extends Error {
  readonly code: ImageUploadErrorCode;

  constructor(code: ImageUploadErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ImageUploadError';
    this.code = code;
  }
}

export type DecodedImage = {
  close?: () => void;
  height: number;
  orientationApplied: boolean;
  source?: CanvasImageSource;
  width: number;
};

export type ImageDecoder = (blob: Blob) => Promise<DecodedImage>;

export type ThumbnailInput = {
  decoded: DecodedImage;
  height: number;
  orientation: ExifOrientation;
  width: number;
};

export type ThumbnailGenerator = (
  input: ThumbnailInput,
) => Promise<Blob | null>;

export type PrepareImageOptions = {
  assetId: string;
  createdAt?: string;
  decodeImage?: ImageDecoder;
  generateThumbnail?: ThumbnailGenerator;
};

export type UploadCapacity = {
  currentImageCount: number;
  currentSectionBytes: number;
};

export type ProcessImageBatchOptions = UploadCapacity & {
  createAssetId: (file: File, index: number) => string;
  createdAt?: (file: File, index: number) => string;
  decodeImage?: ImageDecoder;
  generateThumbnail?: ThumbnailGenerator;
};

export type RejectedImageUpload = {
  code: ImageUploadErrorCode;
  error: ImageUploadError;
  file: File;
  index: number;
};

export type ProcessImageBatchResult = {
  accepted: PreparedImageAsset[];
  rejected: RejectedImageUpload[];
};

const isSupportedMimeType = (value: string): value is CustomDesignMimeType =>
  CUSTOM_DESIGN_SUPPORTED_MIME_TYPES.some((mimeType) => mimeType === value);

const normalizeUploadError = (error: unknown): ImageUploadError =>
  error instanceof ImageUploadError
    ? error
    : new ImageUploadError(
        'decode_failed',
        'This image couldn’t be opened. Try exporting it again from Canva.',
        error,
      );

export const readBlobArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  if (typeof globalThis.FileReader !== 'function') {
    throw new ImageUploadError(
      'decode_failed',
      'This browser cannot read the selected image.',
    );
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new globalThis.FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('File read failed.'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error('The image file could not be read as binary data.'));
    };
    reader.readAsArrayBuffer(blob);
  });
};

export const validateUploadCapacity = (
  file: File,
  capacity: UploadCapacity,
): void => {
  if (
    !Number.isFinite(capacity.currentImageCount) ||
    !Number.isInteger(capacity.currentImageCount) ||
    capacity.currentImageCount < 0 ||
    !Number.isFinite(capacity.currentSectionBytes) ||
    !Number.isInteger(capacity.currentSectionBytes) ||
    capacity.currentSectionBytes < 0
  ) {
    throw new ImageUploadError(
      'invalid_capacity',
      'The current Custom Design storage totals are invalid.',
    );
  }
  if (capacity.currentImageCount >= CUSTOM_DESIGN_MAX_IMAGES) {
    throw new ImageUploadError(
      'too_many_images',
      `A Custom Design section can contain up to ${CUSTOM_DESIGN_MAX_IMAGES} images.`,
    );
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new ImageUploadError(
      'invalid_file_size',
      'This image has an invalid file size. Try exporting it again.',
    );
  }
  if (file.size === 0) {
    throw new ImageUploadError('empty_file', 'This image file is empty.');
  }
  if (file.size > CUSTOM_DESIGN_MAX_FILE_BYTES) {
    throw new ImageUploadError(
      'file_too_large',
      'This image is larger than the 15 MB per-file limit.',
    );
  }
  if (capacity.currentSectionBytes + file.size > CUSTOM_DESIGN_MAX_SECTION_BYTES) {
    throw new ImageUploadError(
      'section_too_large',
      'These images would exceed the 75 MB limit for this Custom Design section.',
    );
  }
  if (!isSupportedMimeType(file.type)) {
    throw new ImageUploadError(
      'unsupported_type',
      'This file type isn’t supported. Export your design as PNG, JPG, or WebP.',
    );
  }
};

export const detectImageMimeType = async (
  blob: Blob,
): Promise<SupportedImageMimeType | null> => {
  const bytes = new Uint8Array(await readBlobArrayBuffer(blob.slice(0, 16)));
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
};

const readUint16 = (
  view: DataView,
  offset: number,
  littleEndian: boolean,
): number | null =>
  offset >= 0 && offset + 2 <= view.byteLength
    ? view.getUint16(offset, littleEndian)
    : null;

const readUint32 = (
  view: DataView,
  offset: number,
  littleEndian: boolean,
): number | null =>
  offset >= 0 && offset + 4 <= view.byteLength
    ? view.getUint32(offset, littleEndian)
    : null;

export const parseExifOrientation = (buffer: ArrayBuffer): ExifOrientation => {
  const view = new DataView(buffer);
  if (
    view.byteLength < 4 ||
    view.getUint8(0) !== 0xff ||
    view.getUint8(1) !== 0xd8
  ) {
    return 1;
  }

  let markerOffset = 2;
  while (markerOffset + 4 <= view.byteLength) {
    if (view.getUint8(markerOffset) !== 0xff) {
      markerOffset += 1;
      continue;
    }

    const marker = view.getUint8(markerOffset + 1);
    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    const segmentLength = view.getUint16(markerOffset + 2, false);
    if (segmentLength < 2 || markerOffset + 2 + segmentLength > view.byteLength) {
      break;
    }

    const payloadOffset = markerOffset + 4;
    if (
      marker === 0xe1 &&
      segmentLength >= 8 &&
      view.getUint8(payloadOffset) === 0x45 &&
      view.getUint8(payloadOffset + 1) === 0x78 &&
      view.getUint8(payloadOffset + 2) === 0x69 &&
      view.getUint8(payloadOffset + 3) === 0x66 &&
      view.getUint8(payloadOffset + 4) === 0 &&
      view.getUint8(payloadOffset + 5) === 0
    ) {
      const tiffOffset = payloadOffset + 6;
      if (tiffOffset + 8 > view.byteLength) {
        return 1;
      }
      const byteOrder = view.getUint16(tiffOffset, false);
      const littleEndian = byteOrder === 0x4949;
      if (!littleEndian && byteOrder !== 0x4d4d) {
        return 1;
      }
      if (readUint16(view, tiffOffset + 2, littleEndian) !== 0x2a) {
        return 1;
      }
      const relativeIfdOffset = readUint32(view, tiffOffset + 4, littleEndian);
      if (relativeIfdOffset === null) {
        return 1;
      }
      const ifdOffset = tiffOffset + relativeIfdOffset;
      const entryCount = readUint16(view, ifdOffset, littleEndian);
      if (entryCount === null) {
        return 1;
      }

      for (let index = 0; index < entryCount; index += 1) {
        const entryOffset = ifdOffset + 2 + index * 12;
        const tag = readUint16(view, entryOffset, littleEndian);
        if (tag !== 0x0112) {
          continue;
        }
        const type = readUint16(view, entryOffset + 2, littleEndian);
        const count = readUint32(view, entryOffset + 4, littleEndian);
        const orientation = readUint16(view, entryOffset + 8, littleEndian);
        return type === 3 && count === 1 && orientation && orientation <= 8
          ? (orientation as ExifOrientation)
          : 1;
      }
      return 1;
    }

    markerOffset += 2 + segmentLength;
  }
  return 1;
};

export const readExifOrientation = async (
  blob: Blob,
): Promise<ExifOrientation> =>
  blob.type === 'image/jpeg'
    ? parseExifOrientation(
        await readBlobArrayBuffer(
          blob.slice(0, CUSTOM_DESIGN_EXIF_SCAN_BYTES),
        ),
      )
    : 1;

export const getOrientedDimensions = (
  width: number,
  height: number,
  orientation: ExifOrientation,
): { height: number; width: number } =>
  orientation >= 5
    ? { height: width, width: height }
    : { height, width };

export const decodeImageInBrowser: ImageDecoder = async (blob) => {
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(blob, {
        imageOrientation: 'from-image',
      });
      return {
        close: () => bitmap.close(),
        height: bitmap.height,
        orientationApplied: true,
        source: bitmap,
        width: bitmap.width,
      };
    } catch {
      // Fall through to HTMLImageElement. Some engines expose
      // createImageBitmap but do not support its orientation option.
    }
  }

  if (
    typeof globalThis.Image !== 'function' ||
    typeof globalThis.URL?.createObjectURL !== 'function'
  ) {
    throw new ImageUploadError(
      'decode_failed',
      'This browser cannot decode the selected image.',
    );
  }

  const url = globalThis.URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new globalThis.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Image decode failed.'));
      element.src = url;
    });
    return {
      height: image.naturalHeight,
      orientationApplied: true,
      source: image,
      width: image.naturalWidth,
    };
  } finally {
    globalThis.URL.revokeObjectURL(url);
  }
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mimeType: SupportedImageMimeType,
  quality?: number,
): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));

export const generateImageThumbnail: ThumbnailGenerator = async ({
  decoded,
  height,
  orientation,
  width,
}) => {
  if (!decoded.source || typeof document === 'undefined') {
    return null;
  }

  const scale = Math.min(
    1,
    CUSTOM_DESIGN_THUMBNAIL_MAX_EDGE_PX / Math.max(width, height),
  );
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  const sourceWidth = decoded.width;
  const sourceHeight = decoded.height;
  const appliedOrientation = decoded.orientationApplied ? 1 : orientation;
  switch (appliedOrientation) {
    case 2:
      context.transform(-scale, 0, 0, scale, targetWidth, 0);
      break;
    case 3:
      context.transform(-scale, 0, 0, -scale, targetWidth, targetHeight);
      break;
    case 4:
      context.transform(scale, 0, 0, -scale, 0, targetHeight);
      break;
    case 5:
      context.transform(0, scale, scale, 0, 0, 0);
      break;
    case 6:
      context.transform(0, scale, -scale, 0, targetWidth, 0);
      break;
    case 7:
      context.transform(0, -scale, -scale, 0, targetWidth, targetHeight);
      break;
    case 8:
      context.transform(0, -scale, scale, 0, 0, targetHeight);
      break;
    default:
      context.scale(scale, scale);
  }
  context.drawImage(decoded.source, 0, 0, sourceWidth, sourceHeight);

  const webp = await canvasToBlob(canvas, 'image/webp', 0.82);
  return webp ?? canvasToBlob(canvas, 'image/png');
};

export const prepareImageAsset = async (
  file: File,
  options: PrepareImageOptions,
): Promise<PreparedImageAsset> => {
  validateUploadCapacity(file, {
    currentImageCount: 0,
    currentSectionBytes: 0,
  });
  const detectedMimeType = await detectImageMimeType(file);
  if (!detectedMimeType) {
    throw new ImageUploadError(
      'corrupt_image',
      'This image couldn’t be opened. Try exporting it again from Canva.',
    );
  }
  if (detectedMimeType !== file.type) {
    throw new ImageUploadError(
      'signature_mismatch',
      'This file’s contents do not match its image type. Try exporting it again.',
    );
  }

  const orientation = await readExifOrientation(file);
  const decodeImage = options.decodeImage ?? decodeImageInBrowser;
  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(file);
  } catch (error) {
    throw normalizeUploadError(error);
  }

  try {
    if (
      !Number.isFinite(decoded.width) ||
      !Number.isFinite(decoded.height) ||
      decoded.width <= 0 ||
      decoded.height <= 0
    ) {
      throw new ImageUploadError(
        'corrupt_image',
        'This image has invalid dimensions. Try exporting it again.',
      );
    }

    const dimensions = decoded.orientationApplied
      ? { height: decoded.height, width: decoded.width }
      : getOrientedDimensions(decoded.width, decoded.height, orientation);
    if (
      dimensions.width > CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX ||
      dimensions.height > CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX ||
      dimensions.width * dimensions.height > CUSTOM_DESIGN_MAX_DECODED_PIXELS
    ) {
      throw new ImageUploadError(
        'dimensions_too_large',
        'This image has too many pixels to process safely. Export it at a smaller size.',
      );
    }

    const generateThumbnail = options.generateThumbnail ?? generateImageThumbnail;
    let thumbnailBlob: Blob | null = null;
    try {
      thumbnailBlob = await generateThumbnail({
        decoded,
        ...dimensions,
        orientation,
      });
    } catch {
      // The original remains usable when optional editor thumbnail creation is
      // unsupported or fails (for example, a restricted canvas implementation).
      thumbnailBlob = null;
    }
    const validThumbnailBlob =
      thumbnailBlob &&
      thumbnailBlob.size > 0 &&
      thumbnailBlob.size <= CUSTOM_DESIGN_MAX_THUMBNAIL_BYTES &&
      isSupportedMimeType(thumbnailBlob.type)
        ? thumbnailBlob
        : null;
    const thumbnailDimensions = validThumbnailBlob
      ? (() => {
          const scale = Math.min(
            1,
            CUSTOM_DESIGN_THUMBNAIL_MAX_EDGE_PX /
              Math.max(dimensions.width, dimensions.height),
          );
          return {
            height: Math.max(1, Math.round(dimensions.height * scale)),
            width: Math.max(1, Math.round(dimensions.width * scale)),
          };
        })()
      : null;
    const thumbnailMimeType = validThumbnailBlob?.type;
    const thumbnail =
      validThumbnailBlob &&
      thumbnailDimensions &&
      thumbnailMimeType &&
      isSupportedMimeType(thumbnailMimeType)
        ? {
            byteSize: validThumbnailBlob.size,
            ...thumbnailDimensions,
            mimeType: thumbnailMimeType,
          }
        : undefined;
    const metadata: ImageAssetMetadata = {
      aspectRatio: dimensions.width / dimensions.height,
      byteSize: file.size,
      createdAt: options.createdAt ?? new Date().toISOString(),
      fileName: file.name,
      height: dimensions.height,
      id: options.assetId,
      mimeType: detectedMimeType,
      orientation,
      ...(thumbnail ? { thumbnail } : {}),
      width: dimensions.width,
    };

    return {
      blob: file,
      metadata,
      ...(thumbnail && validThumbnailBlob
        ? { thumbnailBlob: validThumbnailBlob }
        : {}),
    };
  } finally {
    decoded.close?.();
  }
};

export const processImageBatch = async (
  files: readonly File[],
  options: ProcessImageBatchOptions,
): Promise<ProcessImageBatchResult> => {
  const accepted: PreparedImageAsset[] = [];
  const rejected: RejectedImageUpload[] = [];
  let imageCount = options.currentImageCount;
  let sectionBytes = options.currentSectionBytes;

  for (const [index, file] of files.entries()) {
    try {
      validateUploadCapacity(file, {
        currentImageCount: imageCount,
        currentSectionBytes: sectionBytes,
      });
      const asset = await prepareImageAsset(file, {
        assetId: options.createAssetId(file, index),
        ...(options.createdAt
          ? { createdAt: options.createdAt(file, index) }
          : {}),
        ...(options.decodeImage ? { decodeImage: options.decodeImage } : {}),
        ...(options.generateThumbnail
          ? { generateThumbnail: options.generateThumbnail }
          : {}),
      });
      accepted.push(asset);
      imageCount += 1;
      sectionBytes += file.size;
    } catch (error) {
      const uploadError = normalizeUploadError(error);
      rejected.push({
        code: uploadError.code,
        error: uploadError,
        file,
        index,
      });
    }
  }

  return { accepted, rejected };
};
