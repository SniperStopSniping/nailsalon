import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor } from '@/features/business-setup/drafts.server';
import { loadSetupHead, lockSetupSalon } from '@/features/business-setup/drafts.server';
import { onboardingArtworkStorageKey } from '@/features/onboarding-v1-integration/artwork-storage-key';
import { db } from '@/libs/DB';
import sharp from '@/libs/safeSharp.server';
import { businessSetupRevisionSchema as revisions, customSiteArtifactSchema as artifacts, onboardingSiteMediaSchema as media } from '@/models/Schema';

import { assertCustomArtifact } from './artifacts.server';
import { assetDataUrl, ownedAssets, uploadCustomAsset } from './assets.server';
import { editCanvaNativeContent } from './canva-native-edit.server';
import { canvaNativeUploadSchema } from './canva-native-edits';
import { canvaNativePhotosEnabled } from './native-renderer.server';

/** Reuse private immutable website storage; never promote an onboarding identity. */
export async function uploadCanvaNativePhoto(actor: SetupActor, raw: unknown, file: File) {
  const input = canvaNativeUploadSchema.parse(raw);
  if (!canvaNativePhotosEnabled()) {
    throw new SetupError('NOT_READY', 'New photo uploads are unavailable right now. Your saved photos and website are safe.');
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new SetupError('INVALID', 'Choose a PNG, JPG or WebP photo.');
  }
  const target = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    const [receipt] = await tx.select({ actorId: artifacts.actorId }).from(artifacts).where(and(eq(artifacts.salonId, actor.salonId), eq(artifacts.operationId, input.operationId)));
    if (receipt && receipt.actorId !== actor.adminId) {
      throw new SetupError('INVALID', 'This upload request has already been used.');
    }
    if (!receipt && (head.workspace.status !== 'editing' || head.revision.revision !== input.expectedRevision)) {
      throw new SetupError('STALE', 'Your design changed. Load the latest version before uploading this photo.');
    }
    const [base] = await tx.select().from(revisions).where(and(eq(revisions.salonId, actor.salonId), eq(revisions.workspaceId, head.workspace.id), eq(revisions.revision, input.expectedRevision)));
    if (!base?.document.website.config.customFrontendId) {
      throw new SetupError('NOT_READY', 'Open your saved Canva website before adding a photo.');
    }
    const { artifact } = await assertCustomArtifact(tx, actor.salonId, base.document.website.config.customFrontendId);
    const design = artifact.source.canva;
    const origin = design?.manualOrigin;
    const block = design?.nativeContent?.find(block => block.id === input.blockId) ?? (design && input.createGallery && input.blockId === 'native-photo-gallery' ? { type: 'gallery' as const, images: [] } : undefined);
    if (!design || !block || block.type === 'reviews') {
      throw new SetupError('INVALID', 'Choose your saved About or Gallery section for this photo.');
    }
    const images = block.type === 'gallery' ? block.images : block.image ? [block.image] : [];
    if (input.replaceId && !images.some(image => image.mediaId === input.replaceId)) {
      throw new SetupError('INVALID', 'That photo changed. Load the latest design before replacing it.');
    }
    if (block.type === 'gallery' && images.length >= 60 && !input.replaceId) {
      throw new SetupError('INVALID', 'Use up to sixty Gallery photos. Remove one before adding another.');
    }
    return { origin, role: block.type === 'about' ? 'profile' as const : 'gallery' as const };
  });
  // The established library normalizes, bounds, hashes and deduplicates bytes.
  // A stale later save may leave a reusable private library image, never a live
  // profile change or an unapproved public image.
  const uploaded = await uploadCustomAsset(actor, file, 'photo');
  const [asset] = await ownedAssets(db, actor.salonId, [uploaded.id]);
  const data = await assetDataUrl(asset!);
  const metadata = await sharp(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')).metadata();
  if (!metadata.width || !metadata.height || metadata.format !== 'webp') {
    throw new SetupError('INVALID', 'Your photo could not be prepared. Choose the original PNG or JPG and try again.');
  }
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    if (!target.origin) {
      return editCanvaNativeContent(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, blockId: input.blockId, change: { type: 'use', mediaId: asset!.id, ...(input.replaceId ? { replaceId: input.replaceId } : {}), ...(input.createGallery ? { createGallery: true } : {}), alt: input.alt } }, tx);
    }
    const localItemId = `native-photo-${asset!.id}`;
    const where = and(eq(media.salonId, actor.salonId), eq(media.siteId, target.origin.siteId), eq(media.revisionId, target.origin.revisionId), eq(media.role, target.role), eq(media.localItemId, localItemId));
    const key = onboardingArtworkStorageKey({ salonId: actor.salonId, siteId: target.origin.siteId }, asset!.id);
    await tx.insert(media).values({ id: randomUUID(), salonId: actor.salonId, siteId: target.origin.siteId, revisionId: target.origin.revisionId, role: target.role, localItemId, claimStatus: 'ready', storageProvider: 'custom_site_asset', storageKey: key, fileName: asset!.name, fileSize: asset!.byteSize, mimeType: 'image/webp', width: metadata.width, height: metadata.height, altText: input.alt, metadata: { customSiteUpload: true } }).onConflictDoNothing({ target: [media.revisionId, media.role, media.localItemId] });
    const [saved] = await tx.select().from(media).where(where);
    if (!saved || saved.storageKey !== key || saved.claimStatus !== 'ready' || saved.width !== metadata.width || saved.height !== metadata.height) {
      throw new SetupError('INVALID', 'The saved photo could not be verified. Your earlier design is safe.');
    }
    return editCanvaNativeContent(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, blockId: input.blockId, change: { type: 'use', mediaId: saved.id, ...(input.replaceId ? { replaceId: input.replaceId } : {}), ...(input.createGallery ? { createGallery: true } : {}), alt: input.alt } }, tx);
  });
}
