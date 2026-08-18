import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { requireAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  bookableDiscoverFamilies,
  type DiscoverServiceFamily,
} from '@/libs/discoverTaxonomy';
import type { EligibilityContext } from '@/libs/portfolioEligibility';
import { getSalonBySlug } from '@/libs/queries';
import {
  type Salon,
  salonDiscoverSettingsSchema,
  serviceSchema,
} from '@/models/Schema';

/**
 * Shared authorization + context loading for the owner portfolio surface.
 *
 * Tenancy is resolved server-side from the slug and then re-checked against
 * the actor's membership — the slug is a selector, never a claim of access.
 */

export type PortfolioAdminContext = {
  salon: Salon;
  actorId: string;
};

export async function requirePortfolioAdmin(
  salonSlug: string | null,
): Promise<{ error: Response; context: null } | { error: null; context: PortfolioAdminContext }> {
  if (!salonSlug) {
    return {
      error: Response.json(
        { error: { code: 'MISSING_SALON_SLUG', message: 'salonSlug is required' } },
        { status: 400 },
      ),
      context: null,
    };
  }

  const salon = await getSalonBySlug(salonSlug);

  if (!salon) {
    return {
      error: Response.json(
        { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
        { status: 404 },
      ),
      context: null,
    };
  }

  const guard = await requireAdmin(salon.id);

  if (!guard.ok) {
    return { error: guard.response, context: null };
  }

  return { error: null, context: { salon, actorId: guard.admin.id } };
}

/** Families the salon can currently be booked for. */
export async function loadBookableFamilies(
  salonId: string,
): Promise<Set<DiscoverServiceFamily>> {
  const services = await db
    .select({
      templateKey: serviceSchema.templateKey,
      name: serviceSchema.name,
      isActive: serviceSchema.isActive,
    })
    .from(serviceSchema)
    .where(eq(serviceSchema.salonId, salonId));

  return bookableDiscoverFamilies(services as never);
}

export async function loadDiscoverSettings(salonId: string) {
  const [settings] = await db
    .select()
    .from(salonDiscoverSettingsSchema)
    .where(eq(salonDiscoverSettingsSchema.salonId, salonId))
    .limit(1);

  return settings ?? null;
}

/**
 * Eligibility context for owner-facing readiness.
 *
 * `locationEligible` is `true` here because PR1 ships no geo model — there is
 * no radius or public discovery point to evaluate yet. PR3 introduces those
 * and becomes the real source of this value; the field is required by
 * `EligibilityContext` precisely so that it cannot be quietly forgotten then.
 */
export async function loadEligibilityContext(salon: Salon): Promise<EligibilityContext> {
  const [bookableFamilies, settings] = await Promise.all([
    loadBookableFamilies(salon.id),
    loadDiscoverSettings(salon.id),
  ]);

  const businessEligible
    = salon.isActive !== false
    && salon.deletedAt === null
    && salon.status === 'active'
    && salon.publicationStatus === 'published';

  return {
    businessEligible,
    businessDiscoverEnabled: Boolean(settings?.discoverEnabled) && !settings?.adminSuspendedAt,
    bookableFamilies,
    locationEligible: true,
  };
}

/**
 * Confirm every id belongs to this salon before a batch mutation reports
 * success, so a caller cannot learn anything about another tenant's ids.
 */
export async function assertPhotoIdsBelongToSalon({
  salonId,
  photoIds,
  table,
}: {
  salonId: string;
  photoIds: string[];
  table: typeof import('@/models/Schema').salonPortfolioPhotoSchema;
}): Promise<boolean> {
  if (photoIds.length === 0) {
    return true;
  }

  const owned = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.salonId, salonId),
        inArray(table.id, photoIds),
        isNull(table.deletedAt),
      ),
    );

  return owned.length === photoIds.length;
}
