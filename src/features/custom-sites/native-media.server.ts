import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupTransaction } from '@/features/business-setup/drafts.server';
import { ONBOARDING_MEDIA_MAX_FILE_BYTES } from '@/features/onboarding-v1-integration/media-limits';
import { readOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import type { db } from '@/libs/DB';
import sharp from '@/libs/safeSharp.server';
import { onboardingSiteMediaSchema as media } from '@/models/Schema';

import type { CanvaDesign } from './canva';
import { canvaNativeImages } from './canva-native-content';

/** IDs address files; exact salon, immutable origin, role and ready state authorize them. */
export async function assertCanvaNativeMedia(tx: SetupTransaction | typeof db, salonId: string, design: CanvaDesign | undefined) {
  const images = canvaNativeImages(design?.nativeContent);
  if (!images.length) {
    return [];
  }
  const origin = design?.manualOrigin;
  if (!origin) {
    throw new SetupError('INVALID', 'These photos need their saved manual website.');
  }
  const rows = await tx.select().from(media).where(and(eq(media.salonId, salonId), eq(media.siteId, origin.siteId), eq(media.revisionId, origin.revisionId), inArray(media.id, images.map(image => image.mediaId))));
  for (const image of images) {
    const row = rows.find(row => row.id === image.mediaId);
    if (!row || row.role !== image.role || row.claimStatus !== 'ready' || !row.storageKey || row.mimeType !== 'image/webp' || row.width !== image.width || row.height !== image.height) {
      throw new SetupError('NOT_READY', 'A saved photo is unavailable. Return to your design and retry its upload.');
    }
  }
  return rows;
}

export async function readCanvaNativeMedia(row: typeof media.$inferSelect, validate = false) {
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
