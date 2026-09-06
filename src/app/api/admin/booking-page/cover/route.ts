/**
 * POST /api/admin/booking-page/cover?salonSlug=xxx — upload the owner's cover
 * photo and assign it to the booking-page DRAFT.
 *
 * The cover is the third image role beside the business logo and the
 * technician photo. It is stored through the same delivery pipeline as staff
 * avatars (Cloudinary when configured, otherwise an app-owned
 * `/uploads/cover/<salonId>/…` file) and assigned by writing
 * `bookingPageContent.draft.heroImageUrl` — the existing draft/live pair, so
 * a replacement never changes the published page until the owner publishes.
 *
 * "Use default" and "Remove" are plain content PATCHes (`heroImageUrl: null`)
 * through `/api/admin/booking-page`; this route only ever adds a new asset
 * and never deletes the previous one, which a published revision may still
 * reference.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';

import { requireAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { resolveBookingPageContent, updateBookingPageContentDraft } from '@/libs/bookingPageContent';
import { isCloudinaryConfigured } from '@/libs/Cloudinary';
import { getSalonById, getSalonBySlug } from '@/libs/queries';

export const dynamic = 'force-dynamic';

const MAX_COVER_BYTES = 12 * 1024 * 1024;
const MAX_COVER_EDGE = 2000;
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ErrorResponse = { error: { code: string; message: string } };

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } } satisfies ErrorResponse, { status });

/**
 * Normalises orientation from EXIF, bounds the longest edge and re-encodes as
 * WebP so a phone photo becomes a predictable, safe-to-serve cover. Anything
 * sharp cannot decode is rejected as not an image, whatever its declared type.
 */
async function prepareCoverImage(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const image = sharp(input, { failOn: 'error', limitInputPixels: 80_000_000 }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('UNREADABLE_IMAGE');
  }
  const resized = image
    .resize({ width: MAX_COVER_EDGE, height: MAX_COVER_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86 });
  const { data, info } = await resized.toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function storeCover(salonId: string, data: Buffer): Promise<string> {
  const token = randomBytes(8).toString('hex');
  if (isCloudinaryConfigured()) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: `salons/${salonId}/cover`,
            resource_type: 'image',
            public_id: `cover_${token}`,
            overwrite: false,
          },
          (error, uploaded) => {
            if (error || !uploaded) {
              reject(new Error(`Cloudinary upload failed: ${error?.message ?? 'no result'}`));
              return;
            }
            resolve({ secure_url: uploaded.secure_url });
          },
        )
        .end(data);
    });
    return result.secure_url;
  }

  const relativeDirectory = path.join('uploads', 'cover', salonId);
  const absoluteDirectory = path.join(process.cwd(), 'public', relativeDirectory);
  const fileName = `cover_${token}.webp`;
  await mkdir(absoluteDirectory, { recursive: true });
  await writeFile(path.join(absoluteDirectory, fileName), data);
  return `/${path.posix.join(relativeDirectory.replaceAll(path.sep, '/'), fileName)}`;
}

export async function POST(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const salonSlug = searchParams.get('salonSlug');
  if (!salonSlug) {
    return errorResponse(400, 'VALIDATION_ERROR', 'salonSlug query parameter is required');
  }

  const salon = await getSalonBySlug(salonSlug);
  if (!salon) {
    return errorResponse(404, 'SALON_NOT_FOUND', 'Salon not found');
  }

  const guard = await requireAdmin(salon.id);
  if (!guard.ok) {
    return guard.response;
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_COVER_BYTES + 64 * 1024) {
    return errorResponse(413, 'FILE_TOO_LARGE', 'Cover photos must be 12 MB or smaller.');
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Expected an image upload.');
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Choose an image to upload.');
  }
  // The cover the owner was looking at when they chose this file. A newer
  // choice made while the upload was in flight (another upload, "Use
  // default") wins: this late response must never overwrite it.
  const baselineField = formData.get('baselineHeroImageUrl');
  const baselineHeroImageUrl = typeof baselineField === 'string' ? baselineField : null;
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    return errorResponse(400, 'UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG and WebP images are allowed.');
  }
  if (file.size > MAX_COVER_BYTES) {
    return errorResponse(413, 'FILE_TOO_LARGE', 'Cover photos must be 12 MB or smaller.');
  }

  let prepared: Awaited<ReturnType<typeof prepareCoverImage>>;
  try {
    prepared = await prepareCoverImage(Buffer.from(await file.arrayBuffer()));
  } catch {
    return errorResponse(400, 'UNREADABLE_IMAGE', 'That file could not be read as an image. Try a JPEG, PNG or WebP photo.');
  }

  let heroImageUrl: string;
  try {
    heroImageUrl = await storeCover(salon.id, prepared.data);
  } catch (error) {
    console.error('Cover upload storage failed', error);
    return errorResponse(502, 'STORAGE_UNAVAILABLE', 'The photo could not be stored right now. Your current cover is unchanged.');
  }

  // Assign to the DRAFT only, and only if the draft still holds the cover
  // the owner started from. The stored file stays where it is either way; an
  // orphaned upload is cheaper than clobbering a deliberate newer choice.
  if (baselineHeroImageUrl !== null) {
    const latest = await getSalonById(salon.id);
    const currentHeroImageUrl = resolveBookingPageContent(latest?.settings ?? null).draft.heroImageUrl ?? '';
    if (currentHeroImageUrl !== baselineHeroImageUrl) {
      return errorResponse(409, 'STALE_CHOICE', 'Your cover changed while this photo was uploading, so the newer choice was kept.');
    }
  }
  const updated = await updateBookingPageContentDraft(salon.id, { heroImageUrl });
  if (!updated) {
    return errorResponse(409, 'CONFLICT', 'The booking page changed before the cover could be saved. Reload and try again.');
  }

  void logAuditEvent({
    salonId: salon.id,
    actorType: 'admin',
    actorId: guard.admin.id,
    action: 'settings_updated',
    entityType: 'booking_page_draft',
    entityId: salon.id,
    metadata: { contentFields: ['heroImageUrl'], coverUpload: true },
  });

  return Response.json({
    data: {
      heroImageUrl,
      width: prepared.width,
      height: prepared.height,
      // Non-blocking quality guidance: a cover renders up to ~1400px wide on
      // desktop, so a small source is flagged, never refused.
      qualityNote: prepared.width < 1200
        ? 'This photo is on the small side for a wide cover. A larger photo will look sharper on desktop.'
        : null,
    },
    content: updated,
  });
}
