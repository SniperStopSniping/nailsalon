import 'server-only';

import { sql } from 'drizzle-orm';

import { deleteOnboardingMediaFile, isOnboardingMediaStorageProvider } from '@/features/onboarding-v1-integration/media-storage.server';
import type { DbTransaction } from '@/libs/auditLog';
import { cloudinary, isCloudinaryConfigured } from '@/libs/Cloudinary';
import { assertManagedPortfolioImagePublicId } from '@/libs/portfolioImageStorage.server';
import { deleteCloudinaryServiceImageByPublicId, deleteManagedServiceImage, parseManagedServiceImagePublicId } from '@/libs/serviceImageStorage.server';
import type { SalonDeletionAsset } from '@/models/salonDeletion';

type ImageReference = { salonId: string; ownerId: string; source: string; reference: string; imageUrl: string | null };

function cloudinaryIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://res.cloudinary.com' || url.search || url.hash
      || !process.env.CLOUDINARY_CLOUD_NAME) {
      return null;
    }
    const prefix = `/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/`;
    if (!url.pathname.startsWith(prefix)) {
      return null;
    }
    // Only canonical app URLs, not arbitrary transformations or remote fetches.
    return url.pathname.slice(prefix.length).replace(/^v\d+\//, '').replace(/\.(jpg|jpeg|png|webp|heic|heif)$/, '');
  } catch {
    return null;
  }
}

function ownedPublicId(reference: ImageReference, salonId: string): SalonDeletionAsset | null {
  const publicId = reference.source === 'appointment' || reference.source === 'portfolio'
    ? reference.reference.replace(/\.(jpg|jpeg|png|webp|heic|heif)$/, '')
    : cloudinaryIdFromUrl(reference.reference);
  if (!publicId) {
    return null;
  }
  try {
    assertManagedPortfolioImagePublicId({ publicId, salonId });
    return { kind: 'cloudinary', publicId, source: 'portfolio' };
  } catch { /* Try the other strictly owned namespaces. */ }
  const service = parseManagedServiceImagePublicId(publicId);
  if (service?.salonId === salonId) {
    return { kind: 'cloudinary', publicId, source: 'service' };
  }
  // Appointment ids come from a joined appointment owned by this tenant.
  if (/^[\w-]{1,160}$/.test(reference.ownerId) && /^[\w-]{1,160}$/.test(salonId)) {
    const legacy = new RegExp(`^salons/${salonId}/appointments/${reference.ownerId}/[\\w-]{1,200}$`);
    const current = new RegExp(`^photos/${reference.ownerId}/(before|after)/[\\w-]{16}_[a-z0-9]+$`);
    if (legacy.test(publicId) || current.test(publicId)) {
      return { kind: 'cloudinary', publicId, source: 'appointment' };
    }
  }
  return null;
}

async function imageReferences(executor: Pick<DbTransaction, 'execute'>) {
  return executor.execute<ImageReference>(sql`
    SELECT id AS "salonId", id AS "ownerId", 'profile' AS source, logo_url AS reference, logo_url AS "imageUrl" FROM salon WHERE logo_url IS NOT NULL
    UNION ALL SELECT id, id, 'profile', cover_image_url, cover_image_url FROM salon WHERE cover_image_url IS NOT NULL
    UNION ALL SELECT salon_id, id, 'service', image_url, image_url FROM service WHERE image_url IS NOT NULL
    UNION ALL SELECT p.salon_id, p.appointment_id, 'appointment', p.cloudinary_public_id, p.image_url
      FROM appointment_photo p JOIN appointment a ON a.id = p.appointment_id AND a.salon_id = p.salon_id
    UNION ALL SELECT salon_id, id, 'portfolio', cloudinary_public_id, image_url FROM salon_portfolio_photo
    UNION ALL SELECT a.salon_id, a.id, 'artifact', p.before_photo_url, p.before_photo_url
      FROM appointment_artifacts p JOIN appointment a ON a.id = p.appointment_id WHERE p.before_photo_url IS NOT NULL
    UNION ALL SELECT a.salon_id, a.id, 'artifact', p.after_photo_url, p.after_photo_url
      FROM appointment_artifacts p JOIN appointment a ON a.id = p.appointment_id WHERE p.after_photo_url IS NOT NULL
  `);
}

function normalizedReference(value: string): string {
  return value.split(/[?#]/)[0]!.replace(/\.(?:jpg|jpeg|png|webp|heic|heif)$/, '');
}

/** Capture before purge: references with unknown ownership remain reviewable. */
export async function collectSalonDeletionAssets(tx: DbTransaction, salonId: string): Promise<SalonDeletionAsset[]> {
  const media = await tx.execute<{ storageKey: string; storageProvider: string }>(sql`
    SELECT storage_key AS "storageKey", storage_provider AS "storageProvider"
    FROM onboarding_site_media WHERE salon_id = ${salonId} AND storage_key IS NOT NULL
  `);
  const assets: SalonDeletionAsset[] = media.rows.map(row => isOnboardingMediaStorageProvider(row.storageProvider)
    ? { kind: 'onboarding', key: row.storageKey }
    : { kind: 'review', reference: row.storageKey, reason: 'Unrecognized onboarding storage provider' });

  // Read the same reference inventory for other tenants as well: even an owned
  // namespace is not safe to erase when another live tenant still references it.
  const images = await imageReferences(tx);
  const otherReferences = new Set(images.rows.filter(row => row.salonId !== salonId).flatMap(row => [
    normalizedReference(row.reference),
    row.imageUrl && normalizedReference(row.imageUrl),
    cloudinaryIdFromUrl(row.reference),
    row.imageUrl && cloudinaryIdFromUrl(row.imageUrl),
  ].filter((value): value is string => !!value)));
  for (const row of images.rows.filter(row => row.salonId === salonId)) {
    const owned = ownedPublicId(row, salonId);
    if (owned?.kind === 'cloudinary' && ![...otherReferences].some(reference => reference === owned.publicId || reference.endsWith(`/${owned.publicId}`))) {
      assets.push(owned);
    } else if (row.source === 'service'
      && row.reference.startsWith(`/uploads/services/${salonId}/`)
      && !otherReferences.has(row.reference.replace(/\.webp$/, ''))) {
      assets.push({ kind: 'local_service', imageUrl: row.reference, serviceId: row.ownerId });
    } else if (row.reference) {
      assets.push({ kind: 'review', reference: row.reference, reason: owned ? 'Referenced by another salon' : 'Ownership or storage provider requires verification' });
    }
  }
  const unique = new Map<string, SalonDeletionAsset>();
  for (const asset of assets) {
    const key = asset.kind === 'cloudinary'
      ? `cloudinary:${asset.publicId}`
      : asset.kind === 'onboarding'
        ? `onboarding:${asset.key}`
        : asset.kind === 'local_service' ? `local:${asset.imageUrl}` : `review:${asset.reference}`;
    unique.set(key, asset);
  }
  return [...unique.values()];
}

/** Recheck at execution time: another tenant may have added a reference since capture. */
export async function assertSalonDeletionAssetUnreferenced(executor: Pick<DbTransaction, 'execute'>, asset: SalonDeletionAsset): Promise<void> {
  if (asset.kind === 'onboarding') {
    const live = await executor.execute(sql`SELECT 1 FROM onboarding_site_media WHERE storage_key = ${asset.key} LIMIT 1`);
    if (live.rows.length) {
      throw new Error('Media remains referenced');
    }
  } else if (asset.kind === 'cloudinary' || asset.kind === 'local_service') {
    const images = await imageReferences(executor);
    const target = asset.kind === 'cloudinary' ? asset.publicId : normalizedReference(asset.imageUrl);
    if (images.rows.some(row => [row.reference, row.imageUrl].some((value) => {
      const normalized = value ? normalizedReference(value) : '';
      return normalized === target || normalized.endsWith(`/${target}`);
    }))) {
      throw new Error('Media remains referenced');
    }
  }
}

export async function removeSalonDeletionAsset(asset: SalonDeletionAsset, salonId: string): Promise<void> {
  if (asset.kind === 'review') {
    throw new Error('Manual ownership review required');
  }
  if (asset.kind === 'onboarding') {
    await deleteOnboardingMediaFile(asset.key, { salonId });
    return;
  }
  if (asset.kind === 'local_service') {
    if (!await deleteManagedServiceImage({ ...asset, salonId })) {
      throw new Error('Local media cleanup not confirmed');
    }
    return;
  }
  if (!isCloudinaryConfigured()) {
    throw new Error('Image storage unavailable');
  }
  // Ownership was captured from tenant rows before the purge. Validate the
  // immutable key again before every provider call, including retries.
  const expected = ownedPublicId({ salonId, ownerId: asset.publicId.split('/')[3] ?? '', source: asset.source, reference: asset.publicId, imageUrl: null }, salonId);
  if (!expected && asset.source !== 'service') {
    // photos/{appointment}/... does not contain a salon id. Its proof is the
    // joined appointment inventory, stored only by collectSalonDeletionAssets.
    if (asset.source !== 'appointment' || !/^photos\/[\w-]{1,160}\/(?:before|after)\/[\w-]{16}_[a-z0-9]+$/.test(asset.publicId)) {
      throw new Error('Media ownership could not be verified');
    }
  }
  if (asset.source === 'service' && parseManagedServiceImagePublicId(asset.publicId)?.salonId !== salonId) {
    throw new Error('Service media ownership could not be verified');
  }
  if (asset.source === 'service') {
    const service = parseManagedServiceImagePublicId(asset.publicId)!;
    // Preserve the existing active-metadata, deployment and asset-id checks.
    // Its boolean alone is not proof: false also means already absent, and
    // a successful API call may contain per-asset failures. Verify absence.
    await deleteCloudinaryServiceImageByPublicId({ publicId: asset.publicId, salonId, serviceId: service.serviceId });
    const remaining = await cloudinary.api.resources_by_ids([asset.publicId], { resource_type: 'image', type: 'upload' }) as unknown as { resources?: unknown[] };
    if (!Array.isArray(remaining.resources) || remaining.resources.length !== 0) {
      throw new Error('Service media cleanup not confirmed');
    }
    return;
  }
  const result = await cloudinary.uploader.destroy(asset.publicId, { resource_type: 'image', type: 'upload', invalidate: true });
  if (result.result !== 'ok' && result.result !== 'not found') {
    throw new Error('Provider did not confirm media removal');
  }
}
