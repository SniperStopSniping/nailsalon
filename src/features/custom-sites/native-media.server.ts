import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupTransaction } from '@/features/business-setup/drafts.server';
import { ONBOARDING_MEDIA_MAX_FILE_BYTES } from '@/features/onboarding-v1-integration/media-limits';
import { readOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import type { db } from '@/libs/DB';
import sharp from '@/libs/safeSharp.server';
import type { customSiteAssetSchema as assets } from '@/models/Schema';
import { onboardingSiteMediaSchema as media } from '@/models/Schema';

import { assetDataUrl, ownedAssets } from './assets.server';
import type { CanvaDesign } from './canva';
import { canvaNativeImages } from './canva-native-content';

type NativeMediaRecord = { id: string; kind: 'onboarding'; row: typeof media.$inferSelect } | { id: string; kind: 'asset'; asset: typeof assets.$inferSelect; width: number; height: number };

function assertNativeAsset(asset: typeof assets.$inferSelect) {
  if (asset.role !== 'photo' || asset.mimeType !== 'image/webp' || asset.byteSize <= 0 || asset.byteSize > ONBOARDING_MEDIA_MAX_FILE_BYTES || asset.storageKey?.startsWith('custom_site_asset:')) {
    throw new SetupError('NOT_READY', 'Choose a saved salon photo for this section.');
  }
}

/** Existing immutable private library, not a second photo catalog. */
export async function canvaNativeAssetMetadata(asset: typeof assets.$inferSelect) {
  assertNativeAsset(asset);
  const data = await assetDataUrl(asset);
  const bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
  if (bytes.length !== asset.byteSize) {
    throw new SetupError('NOT_READY', 'This saved photo changed. Upload it again.');
  }
  try {
    const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 40000000 }).metadata();
    if (metadata.format !== 'webp' || !metadata.width || !metadata.height) {
      throw new Error('Photo format');
    }
    return { width: metadata.width, height: metadata.height, bytes };
  } catch {
    throw new SetupError('NOT_READY', 'This saved photo could not be displayed. Upload it again.');
  }
}

/** IDs address files; exact salon, immutable origin, role and ready state authorize them. */
export async function assertCanvaNativeMedia(tx: SetupTransaction | typeof db, salonId: string, design: CanvaDesign | undefined, verifyAssetBytes = false): Promise<NativeMediaRecord[]> {
  const images = canvaNativeImages(design?.nativeContent);
  if (!images.length) {
    return [];
  }
  const legacy = images.filter(image => !image.storageKind);
  const origin = design?.manualOrigin;
  if (legacy.length && !origin) {
    throw new SetupError('INVALID', 'These photos need their saved manual website.');
  }
  const rows = legacy.length && origin ? await tx.select().from(media).where(and(eq(media.salonId, salonId), eq(media.siteId, origin.siteId), eq(media.revisionId, origin.revisionId), inArray(media.id, legacy.map(image => image.mediaId)))) : [];
  for (const image of legacy) {
    const row = rows.find(row => row.id === image.mediaId);
    if (!row || row.role !== image.role || row.claimStatus !== 'ready' || !row.storageKey || row.mimeType !== 'image/webp' || row.width !== image.width || row.height !== image.height) {
      throw new SetupError('NOT_READY', 'A saved photo is unavailable. Return to your design and retry its upload.');
    }
  }
  const result: NativeMediaRecord[] = rows.map(row => ({ id: row.id, kind: 'onboarding', row }));
  const libraryImages = images.filter(image => image.storageKind === 'asset');
  const library = await ownedAssets(tx, salonId, libraryImages.map(image => image.mediaId));
  for (const image of libraryImages) {
    const asset = library.find(asset => asset.id === image.mediaId)!;
    assertNativeAsset(asset);
    // Verify new source on save. Reads authorize all pointers cheaply, then
    // read/verify only the requested bytes; publication decodes every photo.
    // This avoids downloading the whole gallery for every individual image.
    if (verifyAssetBytes) {
      const metadata = await canvaNativeAssetMetadata(asset);
      if (metadata.width !== image.width || metadata.height !== image.height) {
        throw new SetupError('NOT_READY', 'A saved photo changed. Upload it again before publishing.');
      }
    }
    result.push({ id: asset.id, kind: 'asset', asset, width: image.width, height: image.height });
  }
  return result;
}

export async function readCanvaNativeMedia(record: NativeMediaRecord, validate = false) {
  if (record.kind === 'asset') {
    const { bytes, width, height } = await canvaNativeAssetMetadata(record.asset);
    if (width !== record.width || height !== record.height) {
      throw new SetupError('NOT_READY', 'This saved photo changed. Upload it again.');
    }
    if (validate) {
      try {
        await sharp(bytes, { failOn: 'error', limitInputPixels: 40000000 }).stats();
      } catch {
        throw new SetupError('NOT_READY', 'A saved photo could not be displayed. Retry its upload before publishing.');
      }
    }
    return bytes;
  }
  const row = record.row;
  if (!row.storageKey || row.claimStatus !== 'ready' || row.mimeType !== 'image/webp') {
    throw new SetupError('NOT_READY', 'This photo is unavailable.');
  }
  const bytes = await readOnboardingMediaFile(row.storageKey, { salonId: row.salonId, siteId: row.siteId });
  if (!bytes.length || bytes.length > ONBOARDING_MEDIA_MAX_FILE_BYTES) {
    throw new SetupError('NOT_READY', 'This photo could not be loaded. Retry its upload.');
  }
  if (validate) {
    try {
      const image = sharp(bytes, { failOn: 'error', limitInputPixels: 40000000 });
      const metadata = await image.metadata();
      if (metadata.format !== 'webp' || metadata.width !== row.width || metadata.height !== row.height) {
        throw new Error('Photo changed');
      }
      // Decode before committing publication; a readable object/header alone
      // is not proof that the browser can display the complete saved photo.
      await image.stats();
    } catch {
      throw new SetupError('NOT_READY', 'A saved photo could not be displayed. Retry its upload before publishing.');
    }
  }
  return bytes;
}
