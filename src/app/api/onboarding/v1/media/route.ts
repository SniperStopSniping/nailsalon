import { randomUUID } from 'node:crypto';

import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';

import {
  type CanonicalOnboardingProfileMedia,
  CanonicalOnboardingProfileMediaError,
} from '@/features/onboarding-v1-integration/canonical-profile-media.server';
import { promoteCurrentDraftCanonicalIdentityMedia } from '@/features/onboarding-v1-integration/canonical-profile-media-lifecycle.server';
import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { authorizeOnboardingSite } from '@/features/onboarding-v1-integration/media-authorization.server';
import { ONBOARDING_MEDIA_MAX_FILE_BYTES, ONBOARDING_MEDIA_MAX_REQUEST_BYTES } from '@/features/onboarding-v1-integration/media-limits';
import { OnboardingMediaRequestTooLarge, readOnboardingMediaForm } from '@/features/onboarding-v1-integration/media-request.server';
import {
  deleteOnboardingMediaFile,
  OnboardingMediaStorageError,
  readOnboardingMediaFile,
  saveOnboardingMediaFile,
} from '@/features/onboarding-v1-integration/media-storage.server';
import { getAdminSession } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  onboardingSiteMediaSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

const uploadFieldsSchema = z.object({
  altText: z.string().trim().max(300).nullable(),
  draftId: z.string().trim().min(1).max(256).regex(/^[\w-]+$/),
  fileName: z.string().trim().min(1).max(240),
  idempotencyKey: z.string().trim().min(16).max(512).regex(/^[\w:-]+$/),
  localItemId: z.string().trim().min(1).max(160),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  order: z.coerce.number().int().min(0).max(1_000),
  role: z.enum(['profile', 'logo', 'gallery', 'custom_design']),
  siteId: z.string().uuid(),
  siteRevision: z.coerce.number().int().positive(),
}).strict();

const textField = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const mediaResponse = (media: typeof onboardingSiteMediaSchema.$inferSelect) => ({
  data: {
    media: {
      height: media.height,
      id: media.id,
      role: media.role,
      // Carried-forward rows may retain the prior revision's stored URL. The
      // current row owns access; never return a provider URL or a stale row ID.
      url: `/api/onboarding/v1/media/${encodeURIComponent(media.id)}`,
      width: media.width,
    },
  },
});

const canonicalProjectionMetadata = (
  projection: CanonicalOnboardingProfileMedia | null,
): Record<string, string> => projection
  ? {
      canonicalPublicUrl: projection.publicUrl,
      canonicalStorageKey: projection.storageKey,
      canonicalStorageProvider: projection.storageProvider,
    }
  : {};

export async function POST(request: Request): Promise<Response> {
  if (!isOnboardingV1IntegrationEnabled()) {
    return Response.json({
      error: { code: 'ONBOARDING_INTEGRATION_DISABLED', message: 'This onboarding route is not available.' },
    }, { status: 404 });
  }
  // Authenticate before multipart parsing so an anonymous request cannot make
  // the server materialize an arbitrarily large File in memory.
  const admin = await getAdminSession();
  if (!admin) {
    return Response.json({
      error: { code: 'UNAUTHENTICATED', message: 'Sign in to save website photos.' },
    }, { status: 401 });
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > ONBOARDING_MEDIA_MAX_REQUEST_BYTES) {
    return Response.json({
      error: { code: 'MEDIA_TOO_LARGE', message: 'This photo needs to be prepared again before uploading.' },
    }, { status: 413 });
  }
  let form: FormData | null;
  try {
    form = await readOnboardingMediaForm(request);
  } catch (error) {
    if (error instanceof OnboardingMediaRequestTooLarge) {
      return Response.json({
        error: { code: 'MEDIA_TOO_LARGE', message: 'This photo needs to be prepared again before uploading.' },
      }, { status: 413 });
    }
    form = null;
  }
  if (!form) {
    return Response.json({
      error: { code: 'INVALID_MEDIA', message: 'Choose the image again.' },
    }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({
      error: { code: 'INVALID_MEDIA', message: 'Choose the image again.' },
    }, { status: 400 });
  }
  if (file.size > ONBOARDING_MEDIA_MAX_FILE_BYTES) {
    return Response.json({
      error: { code: 'MEDIA_TOO_LARGE', message: 'This photo needs to be prepared again before uploading.' },
    }, { status: 413 });
  }
  const parsed = uploadFieldsSchema.safeParse({
    altText: textField(form, 'altText').trim() || null,
    draftId: textField(form, 'draftId'),
    fileName: textField(form, 'fileName'),
    idempotencyKey: textField(form, 'idempotencyKey'),
    localItemId: textField(form, 'localItemId'),
    mimeType: textField(form, 'mimeType'),
    order: textField(form, 'order'),
    role: textField(form, 'role'),
    siteId: textField(form, 'siteId'),
    siteRevision: textField(form, 'siteRevision'),
  });
  if (!parsed.success || file.type !== parsed.data.mimeType) {
    return Response.json({
      error: { code: 'INVALID_MEDIA', message: 'Choose a JPG, PNG or WebP image.' },
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

  const [manifestItem] = await db
    .select()
    .from(onboardingSiteMediaSchema)
    .where(and(
      eq(onboardingSiteMediaSchema.salonId, authorized.salonId),
      eq(onboardingSiteMediaSchema.siteId, authorized.siteId),
      eq(onboardingSiteMediaSchema.revisionId, authorized.revisionId),
      eq(onboardingSiteMediaSchema.role, parsed.data.role),
      eq(onboardingSiteMediaSchema.localItemId, parsed.data.localItemId),
    ))
    .limit(1);
  if (!manifestItem || manifestItem.sortOrder !== parsed.data.order) {
    return Response.json({
      error: { code: 'MEDIA_NOT_DECLARED', message: 'Return to Review and save this image again.' },
    }, { status: 409 });
  }
  if (
    manifestItem.claimStatus === 'ready'
    && manifestItem.publicUrl
    && manifestItem.width
    && manifestItem.height
    && manifestItem.storageKey
  ) {
    let storedFileReadable = true;
    try {
      await readOnboardingMediaFile(manifestItem.storageKey, authorized);
    } catch (error) {
      const missing = (error instanceof OnboardingMediaStorageError && error.code === 'IMAGE_NOT_FOUND')
        || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT');
      if (!missing) {
        // An outage is not evidence of deletion. Keep the durable ready row,
        // its immutable key and canonical projection intact for a later retry.
        return Response.json({
          error: { code: 'IMAGE_STORAGE_UNAVAILABLE', message: 'Your saved image is temporarily unavailable. Try again shortly.' },
        }, { status: 503 });
      }
      storedFileReadable = false;
      await db
        .update(onboardingSiteMediaSchema)
        .set({ claimStatus: 'failed', failureCode: 'STORED_MEDIA_MISSING', uploadLeaseId: null })
        .where(and(
          eq(onboardingSiteMediaSchema.id, manifestItem.id),
          eq(onboardingSiteMediaSchema.claimStatus, 'ready'),
        ));
    }

    if (storedFileReadable) {
      if (
        (
          manifestItem.role !== 'logo'
          && manifestItem.role !== 'profile'
        )
        || typeof manifestItem.metadata.canonicalPublicUrl === 'string'
      ) {
        return Response.json(mediaResponse(manifestItem));
      }

      try {
        const projection = manifestItem.role === 'logo' || manifestItem.role === 'profile'
          ? await promoteCurrentDraftCanonicalIdentityMedia(
            manifestItem.id,
            manifestItem.role,
            manifestItem.salonId,
          )
          : null;
        if (projection) {
          const [projected] = await db.update(onboardingSiteMediaSchema).set({
            metadata: {
              ...manifestItem.metadata,
              ...canonicalProjectionMetadata(projection),
            },
          }).where(and(
            eq(onboardingSiteMediaSchema.id, manifestItem.id),
            eq(onboardingSiteMediaSchema.claimStatus, 'ready'),
            eq(onboardingSiteMediaSchema.storageKey, manifestItem.storageKey),
          )).returning();
          if (projected) {
            return Response.json(mediaResponse(projected));
          }
        }
        return Response.json(mediaResponse(manifestItem));
      } catch (error) {
        const code = error instanceof CanonicalOnboardingProfileMediaError
          ? error.code
          : 'MEDIA_STORAGE_FAILED';
        return Response.json({
          error: {
            code,
            message: error instanceof CanonicalOnboardingProfileMediaError
              ? error.message
              : 'This image could not be connected to your public profile. Your saved copy is still safe.',
          },
        }, { status: 422 });
      }
    }
  }

  // A process may stop after acquiring the upload lease but before it can
  // finalize the row. Recover only an old, unchanged lease; a current upload
  // remains protected from duplicate writes.
  if (
    manifestItem.claimStatus === 'uploading'
    && Date.now() - manifestItem.updatedAt.getTime() > 2 * 60 * 1_000
  ) {
    await db
      .update(onboardingSiteMediaSchema)
      .set({ claimStatus: 'failed', failureCode: 'STALE_UPLOAD_LEASE', uploadLeaseId: null })
      .where(and(
        eq(onboardingSiteMediaSchema.id, manifestItem.id),
        eq(onboardingSiteMediaSchema.claimStatus, 'uploading'),
        eq(onboardingSiteMediaSchema.uploadLeaseId, manifestItem.uploadLeaseId!),
        eq(onboardingSiteMediaSchema.updatedAt, manifestItem.updatedAt),
      ));
  }

  const uploadLeaseId = randomUUID();
  const [leased] = await db
    .update(onboardingSiteMediaSchema)
    .set({
      claimStatus: 'uploading',
      failureCode: null,
      uploadLeaseId,
    })
    .where(and(
      eq(onboardingSiteMediaSchema.id, manifestItem.id),
      or(
        eq(onboardingSiteMediaSchema.claimStatus, 'pending'),
        eq(onboardingSiteMediaSchema.claimStatus, 'failed'),
      ),
    ))
    .returning();
  if (!leased) {
    return Response.json({
      error: { code: 'MEDIA_UPLOAD_IN_PROGRESS', message: 'This image is still saving. Try again shortly.' },
    }, { status: 409 });
  }

  let storageKey: string | null = null;
  try {
    const stored = await saveOnboardingMediaFile({
      file,
      role: parsed.data.role,
      revisionId: authorized.revisionId,
      salonId: authorized.salonId,
      siteId: authorized.siteId,
      stableItemId: parsed.data.localItemId,
      uploadAttemptId: uploadLeaseId,
    });
    storageKey = stored.storageKey;
    const publicUrl = `/api/onboarding/v1/media/${manifestItem.id}`;
    const [ready] = await db
      .update(onboardingSiteMediaSchema)
      .set({
        altText: parsed.data.altText,
        claimStatus: 'ready',
        failureCode: null,
        height: stored.height,
        metadata: {
          byteSize: stored.byteSize,
        },
        mimeType: stored.mimeType,
        publicUrl,
        storageKey: stored.storageKey,
        storageProvider: stored.storageProvider,
        uploadLeaseId: null,
        width: stored.width,
      })
      .where(and(
        eq(onboardingSiteMediaSchema.id, manifestItem.id),
        eq(onboardingSiteMediaSchema.claimStatus, 'uploading'),
        eq(onboardingSiteMediaSchema.uploadLeaseId, uploadLeaseId),
      ))
      .returning();
    if (!ready) {
      await deleteOnboardingMediaFile(stored.storageKey, authorized);
      return Response.json({
        error: { code: 'MEDIA_SAVE_CONFLICT', message: 'This image changed while it was saving. Try again.' },
      }, { status: 409 });
    }

    // Only the request that won the immutable private-media lease may update
    // the public role-owned projection. Projecting before this compare-and-set
    // would let a reclaimed, stale request overwrite the newer logo/photo.
    try {
      const canonicalProjection = ready.role === 'logo' || ready.role === 'profile'
        ? await promoteCurrentDraftCanonicalIdentityMedia(
          ready.id,
          ready.role,
          ready.salonId,
        )
        : null;
      if (!canonicalProjection) {
        return Response.json(mediaResponse(ready));
      }
      const [projected] = await db.update(onboardingSiteMediaSchema).set({
        metadata: {
          ...ready.metadata,
          ...canonicalProjectionMetadata(canonicalProjection),
        },
      }).where(and(
        eq(onboardingSiteMediaSchema.id, ready.id),
        eq(onboardingSiteMediaSchema.claimStatus, 'ready'),
        eq(onboardingSiteMediaSchema.storageKey, ready.storageKey!),
      )).returning();
      return Response.json(mediaResponse(projected ?? ready));
    } catch (error) {
      const code = error instanceof CanonicalOnboardingProfileMediaError
        ? error.code
        : 'MEDIA_STORAGE_FAILED';
      return Response.json({
        error: {
          code,
          message: error instanceof CanonicalOnboardingProfileMediaError
            ? error.message
            : 'This image could not be connected to your public profile. Your saved copy is still safe.',
        },
      }, { status: 422 });
    }
  } catch (error) {
    if (storageKey) {
      await deleteOnboardingMediaFile(storageKey, authorized).catch(() => undefined);
    }
    const code = error instanceof OnboardingMediaStorageError
      ? error.code
      : error instanceof CanonicalOnboardingProfileMediaError
        ? error.code
        : 'MEDIA_STORAGE_FAILED';
    await db
      .update(onboardingSiteMediaSchema)
      .set({ claimStatus: 'failed', failureCode: code, uploadLeaseId: null })
      .where(and(
        eq(onboardingSiteMediaSchema.id, manifestItem.id),
        eq(onboardingSiteMediaSchema.claimStatus, 'uploading'),
        eq(onboardingSiteMediaSchema.uploadLeaseId, uploadLeaseId),
      ));
    return Response.json({
      error: {
        code,
        message: error instanceof OnboardingMediaStorageError
          || error instanceof CanonicalOnboardingProfileMediaError
          ? error.message
          : 'This image could not be saved. Your local copy is still safe.',
      },
    }, { status: 422 });
  }
}
