import 'server-only';

import { eq } from 'drizzle-orm';

import { isValidSalonSlug } from '@/libs/tenantSlug';
import { salonSchema } from '@/models/Schema';

import type { SetupDocument } from './contracts';
import { SetupError } from './contracts';
import type { SetupTransaction } from './drafts.server';

export function canChooseSetupBookingLink(salon: Pick<typeof salonSchema.$inferSelect, 'publicationStatus' | 'slugLockedAt'>) {
  return salon.publicationStatus !== 'published' && !salon.slugLockedAt;
}

/** Review and publication share the global salon URL namespace. Never silently suffix a chosen URL. */
export async function setupBookingLinkBlockers(tx: SetupTransaction, salon: typeof salonSchema.$inferSelect, document: SetupDocument): Promise<string[]> {
  const slug = document.siteSlug ?? salon.slug;
  if (slug === salon.slug) {
    return [];
  }
  if (!canChooseSetupBookingLink(salon)) {
    return ['Your published booking link stays the same. Contact Luster if your business needs a new address.'];
  }
  if (!isValidSalonSlug(slug) || slug !== slug.trim().toLowerCase()) {
    return ['Choose a booking link using letters, numbers and hyphens, with no spaces.'];
  }
  const [existing] = await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.slug, slug)).limit(1);
  return existing ? ['That booking link is already in use. Choose another in Details, then review again.'] : [];
}

/** A competing first publication can win after review; the whole loser transaction rolls back. */
export function rethrowBookingLinkCollision(error: unknown): never {
  let cause = error;
  for (let depth = 0; depth < 6 && cause && typeof cause === 'object'; depth += 1) {
    const value = cause as { code?: string; constraint?: string; cause?: unknown };
    if (value.code === '23505' && ['salon_slug_unique', 'salon_slug_idx'].includes(value.constraint ?? '')) {
      throw new SetupError('NOT_READY', 'That booking link was just taken. Choose another in Details, then review again.');
    }
    cause = value.cause;
  }
  throw error;
}
