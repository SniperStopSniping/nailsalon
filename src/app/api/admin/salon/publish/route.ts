/**
 * Admin Salon Publish API (Phase A — onboarding creation/publication split).
 *
 * POST /api/admin/salon/publish?salonSlug=xxx
 *
 * Luster onboarding (`/api/onboarding/luster`) creates every new salon as a
 * private, owner-only draft — `publicationStatus: 'draft'`, `publishedAt:
 * null`, `slugLockedAt: null` — instead of publishing it in the same atomic
 * request. This endpoint is the ONE place that flips a salon from draft to
 * published: a distinct, owner-initiated action, not a side effect of setup.
 *
 * Auth follows the same tenant-scoped pattern as every other admin salon
 * route (see `@/app/api/admin/salon/settings/route.ts`,
 * `@/app/api/admin/booking-page/route.ts`): resolve the salon by slug, then
 * `requireAdmin(salon.id)`. `requireAdmin` already accepts the Clerk session
 * onboarding signs owners in with — `getAdminSession()` falls back to Clerk
 * auth (`@/libs/adminAuth.ts`) when no legacy admin-session cookie is
 * present — so no new auth mechanism is introduced here.
 *
 * Idempotent: the UPDATE only touches a row that is not already published,
 * so publishing an already-published salon is a safe no-op that returns the
 * existing publish timestamps unchanged — a double-click or a retried
 * request can never re-stamp `publishedAt`/`slugLockedAt`.
 */
import { and, eq, ne } from 'drizzle-orm';

import { requireAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { getSalonById, getSalonBySlug } from '@/libs/queries';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

type PublishableSalon = {
  id: string;
  slug: string;
  customDomain: string | null;
  publicationStatus: string;
  publishedAt: Date | null;
  slugLockedAt: Date | null;
};

function buildResponseData(salon: PublishableSalon) {
  return {
    salonId: salon.id,
    slug: salon.slug,
    publicationStatus: salon.publicationStatus,
    publishedAt: salon.publishedAt ? salon.publishedAt.toISOString() : null,
    slugLockedAt: salon.slugLockedAt ? salon.slugLockedAt.toISOString() : null,
    publicUrl: buildSalonTenantPublicUrl('/', { slug: salon.slug, customDomain: salon.customDomain }),
    bookingUrl: buildSalonTenantPublicUrl('/book/service', { slug: salon.slug, customDomain: salon.customDomain }),
  };
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const salonSlug = searchParams.get('salonSlug');

  if (!salonSlug) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'salonSlug is required' } },
      { status: 400 },
    );
  }

  const salon = await getSalonBySlug(salonSlug);
  if (!salon) {
    return Response.json(
      { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
      { status: 404 },
    );
  }

  const guard = await requireAdmin(salon.id);
  if (!guard.ok) {
    return guard.response;
  }

  const now = new Date();

  // Conditional WHERE (not just a plain UPDATE by id) makes this both the
  // idempotency check AND the concurrency guard in one round trip: two
  // concurrent publish requests can only ever have one of them actually
  // stamp publishedAt/slugLockedAt.
  const [updated] = await db
    .update(salonSchema)
    .set({
      publicationStatus: 'published',
      publishedAt: now,
      slugLockedAt: now,
    })
    .where(and(eq(salonSchema.id, salon.id), ne(salonSchema.publicationStatus, 'published')))
    .returning();

  if (!updated) {
    // Already published — idempotent no-op. Re-read by id rather than
    // trusting the salon fetched above, so a request that raced a concurrent
    // publish still reports the real, current timestamps.
    const current = (await getSalonById(salon.id)) ?? salon;
    return Response.json({ data: buildResponseData(current) });
  }

  void logAuditEvent({
    salonId: salon.id,
    actorType: 'admin',
    actorId: guard.admin.id,
    action: 'settings_updated',
    entityType: 'salon',
    entityId: salon.id,
    metadata: { via: 'onboarding_publish', publicationStatus: 'published' },
  });

  return Response.json({ data: buildResponseData(updated) });
}
