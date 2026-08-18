import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import {
  loadDiscoverSettings,
  loadEligibilityContext,
  requirePortfolioAdmin,
} from '@/libs/portfolioAdminContext.server';
import { summarizeDiscoverReadiness } from '@/libs/portfolioEligibility';
import { getPortfolioUsage } from '@/libs/portfolioLimits.server';
import { listPortfolioPhotos } from '@/libs/portfolioMedia.server';
import { salonDiscoverSettingsSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const toggleSchema = z.object({
  salonSlug: z.string().trim().min(1),
  discoverEnabled: z.boolean(),
});

/**
 * Business-level Discover participation.
 *
 * Turning Discover off removes the business from Discover surfaces only. It
 * never touches the salon's booking page, its public profile, or any
 * owner-level photo setting — a business that opts out keeps everything it had
 * before it opted in.
 *
 * Administrative suspension is deliberately not settable here: it is an admin
 * concern that must not be clearable by the owner it applies to.
 */
export async function PATCH(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'INVALID_BODY', message: 'A JSON body is required' } },
      { status: 400 },
    );
  }

  const parsed = toggleSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: parsed.error.issues[0]?.message ?? 'Invalid request',
        },
      },
      { status: 400 },
    );
  }

  const { error, context } = await requirePortfolioAdmin(parsed.data.salonSlug);

  if (error) {
    return error;
  }

  const existing = await loadDiscoverSettings(context.salon.id);

  if (existing) {
    await db
      .update(salonDiscoverSettingsSchema)
      .set({ discoverEnabled: parsed.data.discoverEnabled, updatedBy: context.actorId })
      .where(eq(salonDiscoverSettingsSchema.salonId, context.salon.id));
  } else {
    await db.insert(salonDiscoverSettingsSchema).values({
      salonId: context.salon.id,
      discoverEnabled: parsed.data.discoverEnabled,
      updatedBy: context.actorId,
    });
  }

  await logAuditEvent({
    salonId: context.salon.id,
    actorType: 'admin',
    actorId: context.actorId,
    action: 'discover_participation_changed',
    entityType: 'salon_discover_settings',
    entityId: context.salon.id,
    metadata: { discoverEnabled: parsed.data.discoverEnabled },
  });

  return Response.json({ discoverEnabled: parsed.data.discoverEnabled });
}

/** Owner-facing readiness: counts and reasons, never a rendered card. */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const { error, context } = await requirePortfolioAdmin(searchParams.get('salonSlug'));

  if (error) {
    return error;
  }

  const [photos, usage, eligibilityContext, settings] = await Promise.all([
    listPortfolioPhotos(context.salon.id),
    getPortfolioUsage(context.salon.id),
    loadEligibilityContext(context.salon),
    loadDiscoverSettings(context.salon.id),
  ]);

  const eligibilityPhotos = photos.map(photo => ({
    id: photo.id,
    sortOrder: photo.sortOrder,
    createdAt: photo.createdAt,
    ownerVisible: photo.ownerVisible,
    discoverIncluded: photo.discoverIncluded,
    serviceFamily: photo.serviceFamily,
    nailLength: photo.nailLength,
    moderationState: photo.moderationState,
    deletedAt: photo.deletedAt,
    cropX: photo.cropX,
    cropY: photo.cropY,
    cropWidth: photo.cropWidth,
    cropHeight: photo.cropHeight,
  }));

  return Response.json({
    discoverEnabled: Boolean(settings?.discoverEnabled),
    adminSuspended: Boolean(settings?.adminSuspendedAt),
    usage,
    readiness: summarizeDiscoverReadiness(eligibilityPhotos, usage.max, eligibilityContext),
  });
}
