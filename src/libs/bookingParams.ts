/**
 * Booking URL Parameter Helpers
 *
 * Ensures booking flow URLs maintain required parameters (locationId, serviceIds, etc.)
 * Provides repair functions for deep-links that may be missing required params.
 */

import { normalizeSalonSlug } from './tenantSlug';
import { AppConfig, AllLocales } from '@/utils/AppConfig';

type TenantRouteOptions = {
  routeSalonSlug?: string | null;
  locale?: string | null;
};

function getEffectiveTenantRoute(
  tenantRoute?: TenantRouteOptions,
  fallbackSalonSlug?: string | null,
): TenantRouteOptions | undefined {
  const routeSalonSlug = normalizeSalonSlug(tenantRoute?.routeSalonSlug)
    ?? (
      normalizeLocale(tenantRoute?.locale)
        ? normalizeSalonSlug(fallbackSalonSlug)
        : null
    );

  if (!routeSalonSlug && !tenantRoute?.locale) {
    return tenantRoute;
  }

  return {
    ...tenantRoute,
    routeSalonSlug,
  };
}

function normalizeLocale(locale?: string | null): string | null {
  if (!locale) {
    return null;
  }

  return AllLocales.includes(locale) ? locale : null;
}

function splitPathAndQuery(path: string): {
  pathname: string;
  searchParams: URLSearchParams;
} {
  const [basePathPart, rawQuery = ''] = path.split('?');
  const pathname = basePathPart
    ? (basePathPart.startsWith('/') ? basePathPart : `/${basePathPart}`)
    : '/';

  return {
    pathname,
    searchParams: new URLSearchParams(rawQuery),
  };
}

function inferLocaleFromPath(pathname: string): string | null {
  const [, firstSegment] = pathname.split('/');
  return normalizeLocale(firstSegment);
}

function stripLeadingSegment(pathname: string, segment: string): string {
  if (pathname === `/${segment}`) {
    return '/';
  }

  if (pathname.startsWith(`/${segment}/`)) {
    const stripped = pathname.slice(segment.length + 1);
    return stripped.startsWith('/') ? stripped : `/${stripped}`;
  }

  return pathname;
}

function finalizeTenantPath(
  path: string,
  tenantRoute?: TenantRouteOptions,
): string {
  const routeSalonSlug = normalizeSalonSlug(tenantRoute?.routeSalonSlug);
  const explicitLocale = normalizeLocale(tenantRoute?.locale);

  if (!routeSalonSlug && !explicitLocale) {
    return path;
  }

  const { pathname, searchParams } = splitPathAndQuery(path);
  if (routeSalonSlug) {
    searchParams.delete('salonSlug');
  }

  const locale = explicitLocale
    ?? inferLocaleFromPath(pathname)
    ?? AppConfig.defaultLocale;

  let routePath = pathname;
  const existingLocale = inferLocaleFromPath(routePath);
  if (existingLocale) {
    routePath = stripLeadingSegment(routePath, existingLocale);
  }

  if (!routeSalonSlug) {
    const suffix = routePath === '/' ? '' : routePath;
    const localizedPath = `/${locale}${suffix}`;
    const queryString = searchParams.toString();

    return queryString ? `${localizedPath}?${queryString}` : localizedPath;
  }

  routePath = stripLeadingSegment(routePath, routeSalonSlug);
  const suffix = routePath === '/' ? '' : routePath;
  const queryString = searchParams.toString();
  const tenantPath = `/${locale}/${routeSalonSlug}${suffix}`;

  return queryString ? `${tenantPath}?${queryString}` : tenantPath;
}

/**
 * Build booking URL with all required parameters preserved.
 * Use this instead of manually constructing URLs to prevent missing params.
 *
 * @param basePath - The booking step path (e.g., '/book/tech', '/book/time')
 * @param params - Required and optional booking parameters
 * @returns Complete URL with search params
 */
export function buildBookingUrl(
  basePath: string,
  params: {
    salonSlug?: string | null;
    serviceIds?: string[];
    locationId?: string | null;
    techId?: string | null;
    originalAppointmentId?: string | null;
    date?: string | null;
    time?: string | null;
  },
  tenantRoute?: TenantRouteOptions,
): string {
  const effectiveTenantRoute = getEffectiveTenantRoute(
    tenantRoute,
    params.salonSlug,
  );
  const searchParams = new URLSearchParams();

  if (params.salonSlug && !effectiveTenantRoute?.routeSalonSlug) {
    searchParams.set('salonSlug', params.salonSlug);
  }

  if (params.serviceIds && params.serviceIds.length > 0) {
    searchParams.set('serviceIds', params.serviceIds.join(','));
  }

  // Optional but important: locationId (for multi-location support)
  if (params.locationId) {
    searchParams.set('locationId', params.locationId);
  }

  // Optional: techId
  if (params.techId) {
    searchParams.set('techId', params.techId);
  }

  // Optional: originalAppointmentId (for reschedule flow)
  if (params.originalAppointmentId) {
    searchParams.set('originalAppointmentId', params.originalAppointmentId);
  }

  // Optional: date and time (for confirm step)
  if (params.date) {
    searchParams.set('date', params.date);
  }
  if (params.time) {
    searchParams.set('time', params.time);
  }

  const queryString = searchParams.toString();
  const path = queryString ? `${basePath}?${queryString}` : basePath;

  return finalizeTenantPath(path, effectiveTenantRoute);
}

/**
 * Extract booking params from URLSearchParams with defaults.
 * Handles missing/invalid values gracefully.
 */
export function parseBookingParams(searchParams: URLSearchParams): {
  salonSlug: string | null;
  serviceIds: string[];
  locationId: string | null;
  techId: string | null;
  originalAppointmentId: string | null;
  date: string | null;
  time: string | null;
} {
  const serviceIdsRaw = searchParams.get('serviceIds');
  const serviceIds = serviceIdsRaw ? serviceIdsRaw.split(',').filter(Boolean) : [];

  return {
    salonSlug: searchParams.get('salonSlug') || null,
    serviceIds,
    locationId: searchParams.get('locationId') || null,
    techId: searchParams.get('techId') || null,
    originalAppointmentId: searchParams.get('originalAppointmentId') || null,
    date: searchParams.get('date') || null,
    time: searchParams.get('time') || null,
  };
}

/**
 * Repair booking params by injecting missing required values.
 * Returns updated params object (does not mutate original).
 *
 * @param params - Current booking params
 * @param defaults - Default values to inject if missing
 * @returns Repaired params object
 */
export function repairBookingParams(
  params: ReturnType<typeof parseBookingParams>,
  defaults: {
    primaryLocationId?: string | null;
  },
): ReturnType<typeof parseBookingParams> {
  return {
    ...params,
    // Inject primary location if locationId is missing
    locationId: params.locationId || defaults.primaryLocationId || null,
  };
}

/**
 * Check if booking URL repair is needed.
 * Returns true only if locationId is missing or different from validLocationId.
 * Use this BEFORE calling repairBookingUrl() to prevent redirect loops.
 *
 * @param currentLocationId - Current locationId from URL (may be undefined/null)
 * @param validLocationId - The validated location ID to use
 * @returns true if redirect is needed, false if URL is already correct
 */
export function shouldRepairBookingUrl(
  currentLocationId: string | undefined | null,
  validLocationId: string,
): boolean {
  // No repair needed if current locationId matches the valid one
  return currentLocationId !== validLocationId;
}

/**
 * Server-side helper to repair booking URL with primary locationId.
 * Preserves ALL existing search params and only updates locationId.
 * Use this for server-side redirects to ensure no params are lost.
 *
 * IMPORTANT: Call shouldRepairBookingUrl() FIRST to prevent redirect loops.
 *
 * @param basePath - The booking step path (e.g., '/book/service')
 * @param currentSearchParams - Current URL search params object
 * @param primaryLocationId - The primary location ID to inject
 * @returns Complete URL with repaired locationId
 */
export function repairBookingUrl(
  basePath: string,
  currentSearchParams: Record<string, string | undefined>,
  primaryLocationId: string,
  tenantRoute?: TenantRouteOptions,
): string {
  const effectiveTenantRoute = getEffectiveTenantRoute(
    tenantRoute,
    currentSearchParams.salonSlug,
  );
  const params = new URLSearchParams();

  // Preserve ALL existing params
  for (const [key, value] of Object.entries(currentSearchParams)) {
    if (
      value !== undefined
      && key !== 'locationId'
      && !(effectiveTenantRoute?.routeSalonSlug && key === 'salonSlug')
    ) {
      params.set(key, value);
    }
  }

  // Set the repaired locationId
  params.set('locationId', primaryLocationId);

  const queryString = params.toString();
  const path = queryString ? `${basePath}?${queryString}` : basePath;

  return finalizeTenantPath(path, effectiveTenantRoute);
}

export function appendSalonSlug(
  path: string,
  salonSlug?: string | null,
  tenantRoute?: TenantRouteOptions,
): string {
  const effectiveTenantRoute = getEffectiveTenantRoute(tenantRoute, salonSlug);

  if (effectiveTenantRoute?.routeSalonSlug) {
    return finalizeTenantPath(path, effectiveTenantRoute);
  }

  if (!salonSlug) {
    return finalizeTenantPath(path, effectiveTenantRoute);
  }

  const [basePathPart, rawQuery = ''] = path.split('?');
  const basePath = basePathPart || path;
  const params = new URLSearchParams(rawQuery);
  params.set('salonSlug', salonSlug);
  const queryString = params.toString();
  const pathWithSalonSlug = queryString ? `${basePath}?${queryString}` : basePath;

  return finalizeTenantPath(pathWithSalonSlug, effectiveTenantRoute);
}

export function buildChangeAppointmentUrl(params: {
  salonSlug?: string | null;
  serviceIds: string[];
  techId?: string | null;
  locationId?: string | null;
  originalAppointmentId: string;
  startTime: string;
  basePath?: string;
  tenantRoute?: TenantRouteOptions;
}): string {
  const appointmentTime = new Date(params.startTime);
  const date = appointmentTime.toISOString().split('T')[0] ?? '';
  const time = `${appointmentTime.getHours()}:${appointmentTime.getMinutes().toString().padStart(2, '0')}`;

  return buildBookingUrl(params.basePath ?? '/change-appointment', {
    salonSlug: params.salonSlug,
    serviceIds: params.serviceIds,
    techId: params.techId ?? 'any',
    locationId: params.locationId,
    originalAppointmentId: params.originalAppointmentId,
    date,
    time,
  }, params.tenantRoute);
}
