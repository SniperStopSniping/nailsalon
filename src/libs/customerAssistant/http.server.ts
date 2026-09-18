import 'server-only';

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
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      length += chunk.value.length;
      if (length > 30_000) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
