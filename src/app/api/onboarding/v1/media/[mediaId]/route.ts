import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { authorizeOnboardingSite } from '@/features/onboarding-v1-integration/media-authorization.server';
import { readOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import { db } from '@/libs/DB';
import { onboardingSiteMediaSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const mediaIdSchema = z.string().uuid();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  if (!isOnboardingV1IntegrationEnabled()) {
    return new Response(null, { status: 404 });
  }
  const parsedMediaId = mediaIdSchema.safeParse((await params).mediaId);
  if (!parsedMediaId.success) {
    return new Response(null, { status: 404 });
  }

  const [media] = await db
    .select()
    .from(onboardingSiteMediaSchema)
    .where(eq(onboardingSiteMediaSchema.id, parsedMediaId.data))
    .limit(1);
  if (
    !media
    || media.claimStatus !== 'ready'
    || !media.storageKey
    || !media.mimeType
  ) {
    return new Response(null, { status: 404 });
  }
  const authorized = await authorizeOnboardingSite(media.siteId);
  if (
    !authorized
    || authorized.salonId !== media.salonId
    || authorized.revisionId !== media.revisionId
  ) {
    return new Response(null, { status: 404 });
  }
  const [owned] = await db
    .select({ id: onboardingSiteMediaSchema.id })
    .from(onboardingSiteMediaSchema)
    .where(and(
      eq(onboardingSiteMediaSchema.id, media.id),
      eq(onboardingSiteMediaSchema.salonId, authorized.salonId),
      eq(onboardingSiteMediaSchema.siteId, authorized.siteId),
    ))
    .limit(1);
  if (!owned) {
    return new Response(null, { status: 404 });
  }

  try {
    const body = await readOnboardingMediaFile(media.storageKey);
    const responseBody = new Uint8Array(body.byteLength);
    responseBody.set(body);
    return new Response(responseBody, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Length': String(body.byteLength),
        'Content-Type': media.mimeType,
        'Vary': 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
