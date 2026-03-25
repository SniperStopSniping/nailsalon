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
  'membership',
  'my-referrals',
  'onboarding',
  'payment-methods',
  'preferences',
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
]);

export function normalizeSalonSlug(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
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
  if (!normalized || RESERVED_PUBLIC_SEGMENTS.has(normalized)) {
    return null;
  }

  return normalized;
}
