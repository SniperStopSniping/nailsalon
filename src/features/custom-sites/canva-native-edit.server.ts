import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { businessSetupRevisionSchema as revisions, onboardingSiteMediaSchema as media } from '@/models/Schema';

import { assertCustomArtifact, storeCustomArtifact } from './artifacts.server';
import type { CanvaDesign } from './canva';
import { compileCanvaDesign } from './canva';
import type { NativePhotoChoice } from './canva-native-edits';
import { canvaNativeEditSchema } from './canva-native-edits';

/** Called only after owner authorization and artifact assertion; no storage URLs escape. */
export async function canvaNativePhotoChoices(salonId: string, design: CanvaDesign | undefined): Promise<NativePhotoChoice[]> {
  if (!design?.manualOrigin || !design.nativeContent?.length) {
    return [];
  }
  const rows = await db.select().from(media).where(and(eq(media.salonId, salonId), eq(media.siteId, design.manualOrigin.siteId), eq(media.revisionId, design.manualOrigin.revisionId), eq(media.claimStatus, 'ready'), eq(media.mimeType, 'image/webp'), inArray(media.role, ['gallery', 'profile']))).limit(61);
  return rows.flatMap(row => row.storageKey && row.width && row.height && (row.role === 'gallery' || row.role === 'profile') ? [{ mediaId: row.id, role: row.role, width: row.width, height: row.height, alt: (row.altText?.trim() || row.fileName || 'Salon photo').slice(0, 500), name: row.fileName }] : []);
}

/** Appearance-only changes use the same owner draft and approval boundary. */
export async function editCanvaNativeContent(actor: SetupActor, raw: unknown) {
  const input = canvaNativeEditSchema.parse(raw);
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    const [base] = await tx.select().from(revisions).where(and(eq(revisions.salonId, actor.salonId), eq(revisions.workspaceId, head.workspace.id), eq(revisions.revision, input.expectedRevision)));
    if (!base?.document.website.config.customFrontendId) {
      throw new SetupError('NOT_READY', 'Open your saved Canva website before changing its photos.');
    }
    const { artifact } = await assertCustomArtifact(tx, actor.salonId, base.document.website.config.customFrontendId);
    const design = artifact.source.canva;
    const original = design?.nativeContent?.find(block => block.id === input.blockId);
    if (!design || !original || original.type === 'reviews') {
      throw new SetupError('INVALID', 'That photo section changed. Reload your saved design.');
    }
    const block = structuredClone(original);
    const change = input.change;
    const images = block.type === 'about' ? block.image ? [block.image] : [] : block.images;
    if (change.type === 'layout') {
      if (block.type !== 'gallery') {
        throw new SetupError('INVALID', 'Choose a Gallery section to change its layout.');
      }
      block.layout = change.layout;
    } else if (change.type === 'use') {
      const origin = design.manualOrigin!;
      const [row] = await tx.select().from(media).where(and(eq(media.salonId, actor.salonId), eq(media.siteId, origin.siteId), eq(media.revisionId, origin.revisionId), eq(media.id, change.mediaId), eq(media.role, block.type === 'about' ? 'profile' : 'gallery')));
      if (!row || row.claimStatus !== 'ready' || row.mimeType !== 'image/webp' || !row.storageKey || !row.width || !row.height) {
        throw new SetupError('INVALID', 'Choose a saved photo belonging to this website and section.');
      }
      const image = { mediaId: row.id, role: row.role as 'profile' | 'gallery', width: row.width, height: row.height, alt: change.alt };
      if (block.type === 'about') {
        if (change.replaceId && block.image?.mediaId !== change.replaceId) {
          throw new SetupError('INVALID', 'That photo changed. Reload before replacing it.');
        }
        block.image = image;
      } else {
        if (images.some(image => image.mediaId === change.mediaId && image.mediaId !== change.replaceId)) {
          throw new SetupError('INVALID', 'That photo is already in this Gallery.');
        }
        if (change.replaceId) {
          const index = block.images.findIndex(image => image.mediaId === change.replaceId);
          if (index < 0) {
            throw new SetupError('INVALID', 'That photo changed. Reload before replacing it.');
          }
          block.images[index] = image;
        } else {
          block.images.push(image);
        }
      }
    } else {
      const index = images.findIndex(image => image.mediaId === change.mediaId);
      if (index < 0) {
        throw new SetupError('INVALID', 'That photo is no longer displayed in this section.');
      }
      if (change.type === 'remove') {
        if (block.type === 'about') {
          delete block.image;
        } else {
          block.images.splice(index, 1);
        }
      } else if (change.type === 'describe') {
        images[index]!.alt = change.alt;
      } else {
        const destination = index + (change.direction === 'earlier' ? -1 : 1);
        if (block.type !== 'gallery' || destination < 0 || destination >= images.length) {
          throw new SetupError('INVALID', 'That photo cannot move further in this section.');
        }
        [images[index], images[destination]] = [images[destination]!, images[index]!];
      }
    }
    const nativeContent = design.nativeContent!.map(item => item.id === block.id ? block : item);
    const source = compileCanvaDesign({ ...design, nativeContent, ownerReviewed: false }, base.document.website.content.websiteDetails);
    const saved = await storeCustomArtifact(actor, { ...input, source, assetIds: artifact.assetIds }, tx);
    const next = await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations: [{ type: 'custom_frontend', artifactId: saved.id }] }, 'owner', tx);
    return { head: next, artifactId: saved.id };
  });
}
