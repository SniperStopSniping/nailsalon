type SalonPublicUrlInput = {
  customDomain?: string | null;
};

function normalizePublicBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return url.origin;
  } catch {
    return null;
  }
}

export function getSalonPublicBaseUrl(salon?: SalonPublicUrlInput): string {
  const salonDomain = normalizePublicBaseUrl(salon?.customDomain);
  if (salonDomain) {
    return salonDomain;
  }

  const configuredUrl = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_APP_URL)
    ?? normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL)
    ?? normalizePublicBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL)
    ?? normalizePublicBaseUrl(process.env.VERCEL_URL);

  if (configuredUrl) {
    return configuredUrl;
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000';
  }

  throw new Error('Unable to build public URL without a salon custom domain or public app URL');
}

export function buildSalonPublicUrl(path: string, salon?: SalonPublicUrlInput): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getSalonPublicBaseUrl(salon)}${normalizedPath}`;
}
