export const PUBLIC_SERVICE_IMAGE_FALLBACK = '/assets/images/biab-short.webp';

function normalizeImageUrlValue(imageUrl: string | null | undefined): string {
  return typeof imageUrl === 'string' ? imageUrl.trim() : '';
}

function isCloudinaryServiceImageUrl(imageUrl: string): boolean {
  try {
    const parsed = new URL(imageUrl);
    return parsed.protocol === 'https:' && parsed.hostname === 'res.cloudinary.com';
  } catch {
    return false;
  }
}

export function isUnusablePublicServiceImageUrl(imageUrl: string | null | undefined): boolean {
  const normalized = normalizeImageUrlValue(imageUrl);

  if (!normalized) {
    return true;
  }

  if (normalized.startsWith('/uploads/')) {
    return true;
  }

  if (normalized.startsWith('/')) {
    return false;
  }

  return !isCloudinaryServiceImageUrl(normalized);
}

export function normalizePublicServiceImageUrl(imageUrl: string | null | undefined): string {
  if (isUnusablePublicServiceImageUrl(imageUrl)) {
    return PUBLIC_SERVICE_IMAGE_FALLBACK;
  }

  return normalizeImageUrlValue(imageUrl);
}
