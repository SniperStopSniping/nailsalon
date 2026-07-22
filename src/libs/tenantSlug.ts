export const ACTIVE_SALON_COOKIE = '__active_salon_slug';

export type SearchParamsRecord = Record<string, string | string[] | undefined>;
export type SearchParamsLike = URLSearchParams | SearchParamsRecord | undefined;
export type RouteParamsRecord = Record<string, string | string[] | undefined>;

const RESERVED_PUBLIC_SEGMENTS = new Set([
  'admin',
  'admin-login',
  'admin-onboarding',
  'appointments',
  'book',
  'booking-disabled',
  'cancelled',
  'change-appointment',
  'dashboard',
  'gallery',
  'invite',
  'join',
  'manage',
  'membership',
  'my-referrals',
  'not-found',
  'onboarding',
  'owner',
  'owner-sign-in',
  'owner-sign-up',
  'pay',
  'payment-methods',
  'preferences',
  'privacy',
  'profile',
  'referral',
  'rewards',
  'rewards-disabled',
  'sign-in',
  'sign-up',
  'staff',
  'staff-login',
  'super-admin',
  'super-admin-login',
  'suspended',
  'terms',
]);

export const RESERVED_TENANT_SUBDOMAINS = new Set([
  'www',
  'app',
  'admin',
  'api',
  'support',
  'mail',
  'status',
  'accounts',
  'clerk',
  'auth',
  'signin',
  'signup',
]);

export function isReservedSalonSlug(value: string): boolean {
  const normalized = normalizeSalonSlug(value);
  return !normalized
    || RESERVED_PUBLIC_SEGMENTS.has(normalized)
    || RESERVED_TENANT_SUBDOMAINS.has(normalized);
}

export function isValidSalonSlug(value: string): boolean {
  const normalized = normalizeSalonSlug(value);
  return Boolean(
    normalized
    && /^[a-z0-9](?:[a-z0-9-]{0,45}[a-z0-9])?$/.test(normalized)
    && !isReservedSalonSlug(normalized),
  );
}

export function isTenantSubdomainSlugEnabled(value: string): boolean {
  const slug = normalizeSalonSlug(value);
  if (!slug || isReservedSalonSlug(slug)) {
    return false;
  }
  if (process.env.TENANT_SUBDOMAINS_ENABLED === 'true') {
    return true;
  }
  return (process.env.TENANT_SUBDOMAIN_ALLOWLIST ?? '')
    .split(',')
    .map(normalizeSalonSlug)
    .includes(slug);
}

export function getSalonSlugFromHostname(
  hostname: string,
  rootDomain = process.env.LUSTER_ROOT_DOMAIN || 'luster.com',
): string | null {
  const normalizedHost = hostname.toLowerCase().split(':')[0]?.replace(/\.$/, '');
  const normalizedRoot = rootDomain.toLowerCase().split(':')[0]?.replace(/^www\./, '');
  if (!normalizedHost || !normalizedRoot || normalizedHost === normalizedRoot || normalizedHost === `www.${normalizedRoot}`) {
    return null;
  }
  if (!normalizedHost.endsWith(`.${normalizedRoot}`)) {
    return null;
  }
  const subdomain = normalizedHost.slice(0, -(normalizedRoot.length + 1));
  return subdomain.includes('.') || isReservedSalonSlug(subdomain) ? null : normalizeSalonSlug(subdomain);
}

export function normalizeSalonSlug(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export function getSalonSlugFromRouteParams(
  params?: RouteParamsRecord,
): string | null {
  if (!params) {
    return null;
  }

  const rawValue = params.slug;
  if (Array.isArray(rawValue)) {
    return normalizeSalonSlug(rawValue[0]);
  }

  return normalizeSalonSlug(rawValue);
}

export function getSalonSlugFromSearchParams(
  searchParams?: SearchParamsLike,
): string | null {
  if (!searchParams) {
    return null;
  }

  if (searchParams instanceof URLSearchParams) {
    return normalizeSalonSlug(searchParams.get('salonSlug'));
  }

  const rawValue = searchParams.salonSlug;
  if (Array.isArray(rawValue)) {
    return normalizeSalonSlug(rawValue[0]);
  }

  return normalizeSalonSlug(rawValue);
}

export function getSalonSlugFromPathname(
  pathname: string,
  locales: readonly string[],
): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const [maybeLocale, maybeSlug] = segments;
  if (!maybeLocale || !locales.includes(maybeLocale) || !maybeSlug) {
    return null;
  }

  const normalized = normalizeSalonSlug(maybeSlug);
  if (!normalized || isReservedSalonSlug(normalized)) {
    return null;
  }

  return normalized;
}
