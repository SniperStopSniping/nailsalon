import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { ONBOARDING_SITE_MEDIA_MAX_ITEMS } from '@/features/onboarding-v1-integration/contracts';
import { authorizeOnboardingSite } from '@/features/onboarding-v1-integration/media-authorization.server';
import { readOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import { db } from '@/libs/DB';
import { onboardingSiteMediaSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const verifySchema = z.object({
  expected: z.array(z.object({
    localItemId: z.string().trim().min(1).max(160),
    order: z.number().int().min(0).max(1_000),
    role: z.enum(['profile', 'logo', 'gallery', 'custom_design']),
    serverMediaId: z.string().uuid(),
  }).strict()).max(ONBOARDING_SITE_MEDIA_MAX_ITEMS),
  siteId: z.string().uuid(),
  siteRevision: z.number().int().positive(),
}).strict();

export async function POST(request: Request): Promise<Response> {
  if (!isOnboardingV1IntegrationEnabled()) {
    return Response.json({
      error: { code: 'ONBOARDING_INTEGRATION_DISABLED', message: 'This onboarding route is not available.' },
    }, { status: 404 });
  }
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({
      error: { code: 'INVALID_MEDIA_VERIFICATION', message: 'Return to Review and try saving again.' },
    }, { status: 400 });
  }
  const authorized = await authorizeOnboardingSite(parsed.data.siteId, { ownerOnly: true });
  if (!authorized) {
    return Response.json({
      error: { code: 'NOT_FOUND', message: 'This saved site is not available.' },
    }, { status: 404 });
  }
  if (authorized.revision !== parsed.data.siteRevision) {
    return Response.json({
      error: { code: 'REVISION_CHANGED', message: 'Your site changed. Return to Review and try again.' },
    }, { status: 409 });
  }

  const media = await db
    .select()
    .from(onboardingSiteMediaSchema)
    .where(and(
      eq(onboardingSiteMediaSchema.salonId, authorized.salonId),
      eq(onboardingSiteMediaSchema.siteId, authorized.siteId),
      eq(onboardingSiteMediaSchema.revisionId, authorized.revisionId),
    ));
  const mediaById = new Map(media.map(item => [item.id, item]));
  const verifiedItems = parsed.data.expected.map((expected) => {
    const item = mediaById.get(expected.serverMediaId);
    return item?.claimStatus === 'ready'
      && item.localItemId === expected.localItemId
      && item.role === expected.role
      && item.sortOrder === expected.order
      && item.storageKey
      ? { ...item, storageKey: item.storageKey }
      : null;
  });
  if (verifiedItems.includes(null)) {
    return Response.json({
      error: { code: 'MEDIA_NOT_VERIFIED', message: 'One or more images are still saving.' },
    }, { status: 409 });
  }
  const readyItems = verifiedItems.filter(
    (item): item is NonNullable<(typeof verifiedItems)[number]> => item !== null,
  );
  const allReadyItems = media.filter((item): item is typeof item & { storageKey: string } => (
    item.claimStatus === 'ready' && typeof item.storageKey === 'string'
  ));
  try {
    await Promise.all([...new Map(
      [...readyItems, ...allReadyItems].map(item => [item.id, item]),
    ).values()].map(item =>
      readOnboardingMediaFile(item.storageKey, authorized)));
  } catch {
    return Response.json({
      error: { code: 'MEDIA_NOT_VERIFIED', message: 'One or more saved images could not be verified.' },
    }, { status: 409 });
  }

  return Response.json({
    data: {
      failed: media.filter(item => item.claimStatus === 'failed').length,
      pending: media.filter(item => item.claimStatus === 'pending' || item.claimStatus === 'uploading').length,
      ready: media.filter(item => item.claimStatus === 'ready').length,
      revision: authorized.revision,
    },
  });
}
