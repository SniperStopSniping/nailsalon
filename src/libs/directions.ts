export type DirectionsLocation = {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
};

function cleanPart(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildDirectionsDestination(location: DirectionsLocation | null | undefined): string | null {
  if (!location) {
    return null;
  }

  const parts = [
    cleanPart(location.address),
    cleanPart(location.city),
    cleanPart(location.state),
    cleanPart(location.zipCode),
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return null;
  }

  return parts.join(', ');
}

export function resolveDirectionsLocation<T extends DirectionsLocation>(
  ...candidates: Array<T | null | undefined>
): T | null {
  for (const candidate of candidates) {
    if (candidate && buildDirectionsDestination(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function buildGoogleMapsDirectionsUrl(location: DirectionsLocation | null | undefined): string | null {
  const destination = buildDirectionsDestination(location);
  if (!destination) {
    return null;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export function openGoogleMapsDirections(location: DirectionsLocation | null | undefined): boolean {
  const url = buildGoogleMapsDirectionsUrl(location);
  if (!url || typeof window === 'undefined') {
    return false;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
