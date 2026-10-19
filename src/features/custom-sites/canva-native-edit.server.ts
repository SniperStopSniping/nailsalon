import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor, SetupTransaction } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { businessSetupRevisionSchema as revisions, onboardingSiteMediaSchema as media } from '@/models/Schema';

import { assertCustomArtifact, storeCustomArtifact } from './artifacts.server';
import type { CanvaDesign } from './canva';
import { compileCanvaDesign } from './canva';
import { applyCanvaNativePhotoChanges } from './canva-native-changes';
import type { CanvaNativePhotoChange, NativePhotoChoice } from './canva-native-edits';
import { canvaNativeEditSchema } from './canva-native-edits';
import { canvaNativePhotosEnabled } from './native-renderer.server';

/** Called only after owner authorization and artifact assertion; no storage URLs escape. */
export async function canvaNativePhotoChoices(salonId: string, design: CanvaDesign | undefined): Promise<NativePhotoChoice[]> {
  if (!design?.manualOrigin) {
    return [];
  }
  // Include replacement history, without increasing the per-site display limit
  // or the existing asset library's storage budget.
  const rows = await db.select().from(media).where(and(eq(media.salonId, salonId), eq(media.siteId, design.manualOrigin.siteId), eq(media.revisionId, design.manualOrigin.revisionId), eq(media.claimStatus, 'ready'), eq(media.mimeType, 'image/webp'), inArray(media.role, ['gallery', 'profile']))).orderBy(desc(media.createdAt), media.id).limit(200);
  return rows.flatMap(row => row.storageKey && row.width && row.height && (row.role === 'gallery' || row.role === 'profile') ? [{ mediaId: row.id, role: row.role, width: row.width, height: row.height, alt: (row.altText?.trim() || row.fileName || 'Salon photo').slice(0, 500), name: row.fileName }] : []);
}

/** Prepare source inside the caller's transaction; source, draft and chat receipt commit together. */
export async function prepareCanvaNativePhotoChanges(actor: SetupActor, input: { expectedRevision: number; operationId: string; changes: CanvaNativePhotoChange[] }, tx: SetupTransaction) {
  await lockSetupSalon(tx, actor);
  const head = await loadSetupHead(tx, actor.salonId);
  const [base] = await tx.select().from(revisions).where(and(eq(revisions.salonId, actor.salonId), eq(revisions.workspaceId, head.workspace.id), eq(revisions.revision, input.expectedRevision)));
  if (!base?.document.website.config.customFrontendId) {
    throw new SetupError('NOT_READY', 'Open your saved Canva website before changing its photos.');
  }
  const { artifact } = await assertCustomArtifact(tx, actor.salonId, base.document.website.config.customFrontendId);
  const design = artifact.source.canva;
  if (!design?.manualOrigin) {
    throw new SetupError('INVALID', 'Open your saved Canva website before changing its photos.');
  }
  const useIds = [...new Set(input.changes.flatMap(item => item.change.type === 'use' ? [item.change.mediaId] : []))];
  // Recheck exact origin/role/ready metadata at save time, after any model call.
  // Uploads use this same transaction so an uncommitted new alias is visible.
  const rows = useIds.length ? await tx.select().from(media).where(and(eq(media.salonId, actor.salonId), eq(media.siteId, design.manualOrigin.siteId), eq(media.revisionId, design.manualOrigin.revisionId), eq(media.claimStatus, 'ready'), eq(media.mimeType, 'image/webp'), inArray(media.id, useIds), inArray(media.role, ['gallery', 'profile']))) : [];
  const choices: NativePhotoChoice[] = rows.flatMap(row => row.storageKey && row.width && row.height && (row.role === 'gallery' || row.role === 'profile') ? [{ mediaId: row.id, role: row.role, width: row.width, height: row.height, alt: row.altText || row.fileName, name: row.fileName }] : []);
  const changed = applyCanvaNativePhotoChanges(design, input.changes, choices, canvaNativePhotosEnabled());
  const source = compileCanvaDesign(changed, base.document.website.content.websiteDetails);
  return storeCustomArtifact(actor, { ...input, source, assetIds: artifact.assetIds }, tx);
}

/** Appearance-only changes use the same owner draft and approval boundary. */
export async function editCanvaNativeContent(actor: SetupActor, raw: unknown, transaction?: SetupTransaction) {
  const input = canvaNativeEditSchema.parse(raw);
  const apply = async (tx: SetupTransaction) => {
    const saved = await prepareCanvaNativePhotoChanges(actor, { ...input, changes: [{ blockId: input.blockId, change: input.change }] }, tx);
    const next = await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations: [{ type: 'custom_frontend', artifactId: saved.id }] }, 'owner', tx);
    return { head: next, artifactId: saved.id };
  };
  return transaction ? apply(transaction) : db.transaction(apply);
}
