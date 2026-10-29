import 'server-only';

import { readBoundedJsonBody } from '@/libs/boundedJsonBody';
import { getSalonBySlug } from '@/libs/queries';
import { guardSalonApiRoute, isOnlineBookingEnabled } from '@/libs/salonStatus';

import { getCustomerAssistantConfig, isCustomerAssistantEnabledForSalon } from './access.server';

export const CUSTOMER_NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function resolveCustomerAssistantSalon(slug: string) {
  if (!isCustomerAssistantEnabledForSalon(slug) || !getCustomerAssistantConfig()) {
    return null;
  }
  const salon = await getSalonBySlug(slug);
  if (!salon || salon.slug !== slug || salon.publicationStatus !== 'published'
    || await guardSalonApiRoute(salon.id) || !await isOnlineBookingEnabled(salon.id)) {
    return null;
  }
  return salon;
}

export function isCustomerSameOrigin(request: Request): boolean {
  try {
    return request.headers.get('origin') === new URL(request.url).origin
      && request.headers.get('sec-fetch-site') !== 'cross-site';
  } catch {
    return false;
  }
}

/** Bound the stream itself; Content-Length alone is attacker controlled. */
export async function readCustomerJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body) {
    return null;
  }
  try {
    return await readBoundedJsonBody(request, 30_000);
  } catch {
    return null;
  }
}
