/**
 * Booking URL Parameter Helpers
 *
 * Ensures booking flow URLs maintain required parameters (locationId, serviceIds, etc.)
 * Provides repair functions for deep-links that may be missing required params.
 */

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
    serviceIds: string[];
    locationId?: string | null;
    techId?: string | null;
    clientPhone?: string | null;
    originalAppointmentId?: string | null;
    date?: string | null;
    time?: string | null;
  },
): string {
  const searchParams = new URLSearchParams();

  // Required: serviceIds
  if (params.serviceIds.length > 0) {
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

  // Optional: clientPhone (for authenticated flow)
  if (params.clientPhone) {
    searchParams.set('clientPhone', params.clientPhone);
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
  return queryString ? `${basePath}?${queryString}` : basePath;
}

/**
 * Extract booking params from URLSearchParams with defaults.
 * Handles missing/invalid values gracefully.
 */
export function parseBookingParams(searchParams: URLSearchParams): {
  serviceIds: string[];
  locationId: string | null;
  techId: string | null;
  clientPhone: string | null;
  originalAppointmentId: string | null;
  date: string | null;
  time: string | null;
} {
  const serviceIdsRaw = searchParams.get('serviceIds');
  const serviceIds = serviceIdsRaw ? serviceIdsRaw.split(',').filter(Boolean) : [];

  return {
    serviceIds,
    locationId: searchParams.get('locationId') || null,
    techId: searchParams.get('techId') || null,
    clientPhone: searchParams.get('clientPhone') || null,
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
): string {
  const params = new URLSearchParams();

  // Preserve ALL existing params
  for (const [key, value] of Object.entries(currentSearchParams)) {
    if (value !== undefined && key !== 'locationId') {
      params.set(key, value);
    }
  }

  // Set the repaired locationId
  params.set('locationId', primaryLocationId);

  const queryString = params.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}
