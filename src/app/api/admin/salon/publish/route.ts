import { requireAdminOwner } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { hasUnpublishedBookingPageChanges, resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { publishWebsite } from '@/libs/bookingPageLifecycle';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { getSalonBySlug } from '@/libs/queries';

export const dynamic = 'force-dynamic';

type PublishableSalon = {
  id: string;
  slug: string;
  customDomain: string | null;
  publicationStatus: string;
  publishedAt: Date | null;
  slugLockedAt: Date | null;
  settings?: unknown;
};

function buildResponseData(salon: PublishableSalon) {
  return {
    hasDraftChanges: hasUnpublishedBookingPageChanges(resolveBookingPageConfig(salon.settings), resolveBookingPageContent(salon.settings)),
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

  // Publishing is irreversible in the way that matters: it stamps
  // publishedAt AND slugLockedAt, so the public address can never be changed
  // again. That belongs to the owner, not to a collaborator (role 'admin'),
  // hence requireAdminOwner rather than requireAdmin. Super admins keep the
  // access requireAdmin already gave them (impersonation stays locked to this
  // salon).
  const guard = await requireAdminOwner(salon.id, 'Only the salon owner can publish this website.');
  if (!guard.ok) {
    return guard.response;
  }

  // One locked transaction publishes the saved draft and makes it public.
  // Repeated requests leave subsequent unpublished edits and timestamps alone.
  let result;
  try {
    result = await publishWebsite(salon.id);
  } catch {
    return Response.json(
      { error: { code: 'PUBLISH_FAILED', message: 'Your website could not be published. Your saved setup is safe. Please try again.' } },
      { status: 503 },
    );
  }
  if (!result) {
    return Response.json({ error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } }, { status: 404 });
  }
  if (!result.applied) {
    return Response.json({ data: buildResponseData(result.salon) });
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

  return Response.json({ data: buildResponseData(result.salon) });
}
