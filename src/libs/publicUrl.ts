type SalonPublicUrlInput = {
  customDomain?: string | null;
  slug?: string | null;
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

export function areTenantSubdomainsEnabled(): boolean {
  return process.env.TENANT_SUBDOMAINS_ENABLED === 'true';
}

export function getCanonicalAppOrigin(): string {
  const configuredUrl = normalizePublicBaseUrl(process.env.PUBLIC_APP_URL)
    ?? normalizePublicBaseUrl(process.env.NEXT_PUBLIC_APP_URL)
    ?? normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL)
    ?? normalizePublicBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL)
    ?? normalizePublicBaseUrl(process.env.VERCEL_URL);

  if (configuredUrl) {
    return configuredUrl;
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000';
  }

  throw new Error('Unable to determine the canonical application origin');
}

export function getSalonPublicBaseUrl(salon?: SalonPublicUrlInput): string {
  const salonDomain = normalizePublicBaseUrl(salon?.customDomain);
  if (salonDomain) {
    return salonDomain;
  }

  const rootDomain = process.env.LUSTER_ROOT_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (salon?.slug && rootDomain && areTenantSubdomainsEnabled()) {
    return `https://${salon.slug}.${rootDomain}`;
  }

  return getCanonicalAppOrigin();
}

export function buildSalonPublicUrl(path: string, salon?: SalonPublicUrlInput): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getSalonPublicBaseUrl(salon)}${normalizedPath}`;
}

export function buildSalonTenantPublicUrl(
  path: string,
  salon: SalonPublicUrlInput & { slug: string },
  locale = 'en',
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const hasDedicatedHost = Boolean(
    salon.customDomain
    || (process.env.LUSTER_ROOT_DOMAIN && areTenantSubdomainsEnabled()),
  );
  const tenantPath = hasDedicatedHost
    ? normalizedPath
    : `/${locale}/${salon.slug}${normalizedPath === '/' ? '' : normalizedPath}`;
  return `${getSalonPublicBaseUrl(salon)}${tenantPath}`;
}
