import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor, SetupTransaction } from '@/features/business-setup/drafts.server';
import { loadSetupHead, lockSetupSalon } from '@/features/business-setup/drafts.server';
import { onboardingArtworkStorageKey } from '@/features/onboarding-v1-integration/artwork-storage-key';
import type { AuthorizedOnboardingSite } from '@/features/onboarding-v1-integration/media-authorization.server';
import { ONBOARDING_MEDIA_MAX_FILE_BYTES } from '@/features/onboarding-v1-integration/media-limits';
import { deleteOnboardingMediaFile, normalizeOnboardingImage, OnboardingMediaStorageError, readOnboardingMediaFile, saveOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import { db } from '@/libs/DB';
import { customSiteAssetSchema as assets, onboardingSiteRevisionSchema as revisions, onboardingSiteSchema } from '@/models/Schema';

import { assetRoleSchema } from './contracts';

export const MAX_REFERENCE_BYTES = 3000000;
export const MAX_WEBSITE_IMAGE_BYTES = 300000;
export const MAX_WEBSITE_MEDIA_BYTES = 2000000;
// Migration 0102 bounds the isolated pilot's base64 text to 1,000,000
// characters. Match its decoded-byte budget before inserting an image.
const MAX_PRIVATE_PREVIEW_IMAGE_BYTES = 750000;

/** Reserve room for all six website images, base64 framing and source/data. */
export function assertWebsiteAssetBudget(media: { role: string; byteSize: number }[]) {
  if (media.filter(asset => asset.role !== 'reference').reduce((sum, asset) => sum + asset.byteSize, 0) > MAX_WEBSITE_MEDIA_BYTES) {
    throw new SetupError('INVALID', 'These photos are too large together. Remove a photo or upload smaller exports before creating your website. Your saved design is safe.');
  }
}
export async function ownedAssets(tx: SetupTransaction | typeof db, salonId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = unique.length ? await tx.select().from(assets).where(and(eq(assets.salonId, salonId), inArray(assets.id, unique))) : [];
  if (rows.length !== unique.length) {
    throw new SetupError('FORBIDDEN', 'One of these images is unavailable for this business.');
  }
  return rows;
}
type AssetContext = { type: 'setup'; artwork?: true } | { type: 'onboarding'; site: AuthorizedOnboardingSite };

/** The manual path shares assets without prematurely opening an AI/setup draft. */
async function authorizeAssetContext(tx: SetupTransaction, actor: SetupActor, context: AssetContext) {
  await lockSetupSalon(tx, actor);
  if (context.type === 'setup') {
    return (await loadSetupHead(tx, actor.salonId)).workspace.id;
  }
  const expected = context.site;
  const [site] = await tx.select().from(onboardingSiteSchema).where(and(
    eq(onboardingSiteSchema.id, expected.siteId),
    eq(onboardingSiteSchema.salonId, actor.salonId),
    eq(onboardingSiteSchema.isCurrent, true),
  )).for('share');
  if (expected.adminId !== actor.adminId || expected.salonId !== actor.salonId || !site || site.currentRevision !== expected.revision) {
    throw new SetupError('STALE', 'Your saved design changed. Return to your setup and try again.');
  }
  // The revision identity is rechecked as well as its number. A caller cannot
  // use a revision from another site as an upload/storage namespace.
  const [revision] = await tx.select({ id: revisions.id }).from(revisions).where(and(
    eq(revisions.salonId, actor.salonId),
    eq(revisions.siteId, site.id),
    eq(revisions.revision, expected.revision),
    eq(revisions.id, expected.revisionId),
  ));
  if (!revision) {
    throw new SetupError('STALE', 'Your saved design changed. Return to your setup and try again.');
  }
  return site.id;
}

async function uploadAsset(actor: SetupActor, file: File, role: ReturnType<typeof assetRoleSchema.parse>, context: AssetContext) {
  const manualArtwork = context.type === 'onboarding' || (context.type === 'setup' && context.artwork === true);
  const maximum = context.type === 'onboarding' ? ONBOARDING_MEDIA_MAX_FILE_BYTES : MAX_REFERENCE_BYTES;
  const privatePreview = process.env.APP_ENV === 'preview' && process.env.CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES === 'true';
  if (file.size <= 0 || file.size > maximum) {
    throw new SetupError('INVALID', manualArtwork ? 'This design needs to be prepared again before uploading.' : 'Choose a file under 3 MB.');
  }
  const id = randomUUID();
  const bytes = Buffer.from(await file.arrayBuffer());
  let pdfBase64: string | null = null;
  let imageBase64: string | null = null;
  let normalizedBytes: Buffer | null = null;
  let stored: Awaited<ReturnType<typeof saveOnboardingMediaFile>> | null = null;
  // Authorize before storing or parsing; repeat when accepting the immutable asset.
  const storageSiteId = await db.transaction(tx => authorizeAssetContext(tx, actor, context));
  if (file.type === 'application/pdf') {
    if (role !== 'reference' || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new SetupError('INVALID', 'PDFs can be used as design references. Upload logos and photos as images.');
    }
    try {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
      if (pdf.isEncrypted || pdf.getPageCount() > 6 || pdf.getPageCount() < 1) {
        throw new Error('limit');
      }
    } catch {
      throw new SetupError('INVALID', 'Use an unencrypted PDF with at most six pages.');
    }
    // Never rendered or offered as a public download. Bounded private reference
    // bytes avoid introducing a second public-media system for PDF input.
    pdfBase64 = bytes.toString('base64');
  } else {
    try {
      const imagePreparation = manualArtwork
        ? { artwork: true as const, maxOutputBytes: privatePreview ? Math.min(maximum, MAX_PRIVATE_PREVIEW_IMAGE_BYTES) : maximum, preserveDimensions: true as const }
        : role === 'reference'
          ? { artwork: true as const, maxOutputBytes: 750000 }
          : { ...(role === 'logo' ? { artwork: true as const } : {}), maxOutputBytes: MAX_WEBSITE_IMAGE_BYTES };
      if (privatePreview) {
        // Isolated pilot only: bounded private bytes in the existing Preview DB.
        // No production storage credentials, public upload URLs or ephemeral disk.
        normalizedBytes = (await normalizeOnboardingImage(file, imagePreparation)).normalized;
        imageBase64 = normalizedBytes.toString('base64');
      } else {
        stored = await saveOnboardingMediaFile({ file, role: manualArtwork || role === 'reference' ? 'custom_design' : role === 'photo' ? 'gallery' : 'logo', salonId: actor.salonId, siteId: storageSiteId, revisionId: id, stableItemId: id, uploadAttemptId: id, imagePreparation });
      }
    } catch (error) {
      if (error instanceof OnboardingMediaStorageError && ['INVALID_IMAGE', 'UNSUPPORTED_IMAGE'].includes(error.code)) {
        throw new SetupError('INVALID', error.message);
      }
      throw error;
    }
  }
  const byteSize = stored?.byteSize ?? normalizedBytes?.length ?? bytes.length;
  try {
    const storedBytes = stored ? await readOnboardingMediaFile(stored.storageKey, { salonId: actor.salonId }) : normalizedBytes ?? bytes;
    const hash = createHash('sha256').update(storedBytes).digest('hex');
    const result = await db.transaction(async (tx) => {
      await authorizeAssetContext(tx, actor, context);
      // A lost upload response or a PDF retry must not consume the library twice.
      // Do not deduplicate across tenants or roles, or reuse damaged historical bytes.
      const candidates = await tx.select().from(assets).where(and(eq(assets.salonId, actor.salonId), eq(assets.role, role), eq(assets.hash, hash)));
      for (const candidate of candidates) {
        if (await assetIsIntact(candidate)) {
          return candidate;
        }
      }
      const current = await tx.select({ byteSize: assets.byteSize }).from(assets).where(eq(assets.salonId, actor.salonId));
      if (current.length >= 24 || current.reduce((sum, a) => sum + a.byteSize, 0) + byteSize > 15000000) {
        throw new SetupError('NOT_READY', 'This business has reached its reference storage limit.');
      }
      const [asset] = await tx.insert(assets).values({ id, salonId: actor.salonId, actorId: actor.adminId, role, name: file.name.replace(/[^\w .-]/gu, '').slice(0, 120) || 'Reference', mimeType: stored?.mimeType ?? (imageBase64 ? 'image/webp' : 'application/pdf'), storageKey: stored?.storageKey ?? null, pdfBase64, imageBase64, byteSize, hash }).returning();
      return asset!;
    });
    if (result.id !== id && stored) {
      // This call created a unique temporary key, never a previously saved key.
      await deleteOnboardingMediaFile(stored.storageKey, { salonId: actor.salonId }).catch(() => {});
    }
    return { asset: result, bytes: storedBytes };
  } catch (e) {
    if (stored) {
      await deleteOnboardingMediaFile(stored.storageKey, { salonId: actor.salonId }).catch(() => {});
    }
    throw e;
  }
}
/** AI references keep their preparation profile; explicit artwork keeps native dimensions. */
export async function uploadCustomAsset(actor: SetupActor, file: File, rawRole: unknown, options?: { artwork: true }) {
  const assetRole = assetRoleSchema.parse(rawRole);
  if (options?.artwork && (assetRole !== 'reference' || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
    throw new SetupError('INVALID', 'Choose a PNG, JPG or WebP Canva export.');
  }
  const result = await uploadAsset(actor, file, assetRole, { type: 'setup', artwork: options?.artwork });
  const { id, name, role, mimeType } = result.asset;
  return { id, name, role, mimeType };
}

/** Preserve manual Canva pixels in the same tenant-owned library, without AI. */
export async function uploadOnboardingArtwork(site: AuthorizedOnboardingSite, file: File) {
  const actor = { adminId: site.adminId, salonId: site.salonId };
  const { asset, bytes } = await uploadAsset(actor, file, 'photo', { type: 'onboarding', site });
  const sharp = (await import('@/libs/safeSharp.server')).default;
  const metadata = await sharp(bytes).metadata();
  return {
    byteSize: bytes.byteLength,
    height: metadata.height!,
    mimeType: 'image/webp' as const,
    storageKey: onboardingArtworkStorageKey(site, asset.id),
    storageProvider: 'custom_site_asset' as const,
    width: metadata.width!,
  };
}

/** Called after the media route has authorized the exact current revision. */
export async function readOnboardingArtworkAsset(salonId: string, id: string) {
  const [asset] = await ownedAssets(db, salonId, [id]);
  // Aliases never nest. The library owns the real object or bounded private bytes.
  if (asset!.byteSize <= 0 || asset!.byteSize > ONBOARDING_MEDIA_MAX_FILE_BYTES || asset!.role !== 'photo' || asset!.mimeType !== 'image/webp' || asset!.storageKey?.startsWith('custom_site_asset:')) {
    throw new SetupError('INVALID', 'This saved design image is unavailable.');
  }
  const url = await assetDataUrl(asset!);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

export async function assetDataUrl(asset: typeof assets.$inferSelect) {
  const bytes = asset.storageKey ? await readOnboardingMediaFile(asset.storageKey, { salonId: asset.salonId }) : Buffer.from(asset.imageBase64 ?? asset.pdfBase64!, 'base64');
  if (createHash('sha256').update(bytes).digest('hex') !== asset.hash) {
    throw new SetupError('INVALID', 'A saved image changed or is unavailable. Please upload it again.');
  }
  return `data:${asset.mimeType};base64,${bytes.toString('base64')}`;
}

/** Only missing/changed bytes are recoverable; do not hide a storage outage. */
export async function assetIsIntact(asset: typeof assets.$inferSelect) {
  try {
    await assetDataUrl(asset);
    return true;
  } catch (error) {
    const missingLocalFile = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    if (missingLocalFile || (error instanceof SetupError && error.code === 'INVALID') || (error instanceof OnboardingMediaStorageError && error.code === 'IMAGE_NOT_FOUND')) {
      return false;
    }
    throw error;
  }
}
