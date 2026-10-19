import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';

import type { SetupOperation } from '@/features/business-setup/contracts';
import { applySetupOperations, SetupError } from '@/features/business-setup/contracts';
import type { SetupActor, SetupTransaction } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { businessSetupRevisionSchema as revisions, customSiteAssetSchema as assets, onboardingSiteMediaSchema as media } from '@/models/Schema';

import { assertCustomArtifact, storeCustomArtifact } from './artifacts.server';
import type { CanvaDesign } from './canva';
import { compileCanvaDesign } from './canva';
import { applyCanvaNativeContentChanges } from './canva-native-changes';
import type { CanvaNativePhotoChange, NativePhotoChoice } from './canva-native-edits';
import { canvaNativeEditSchema } from './canva-native-edits';
import { canvaNativeAssetMetadata } from './native-media.server';
import { canvaNativePhotosEnabled } from './native-renderer.server';

async function libraryChoices(tx: SetupTransaction | typeof db, salonId: string, artworkIds: Set<string>, ids?: string[]): Promise<NativePhotoChoice[]> {
  if (ids && !ids.length) {
    return [];
  }
  const rows = await tx.select().from(assets).where(and(eq(assets.salonId, salonId), eq(assets.role, 'photo'), eq(assets.mimeType, 'image/webp'), ids ? inArray(assets.id, ids) : undefined)).orderBy(desc(assets.createdAt), assets.id).limit(24);
  const choices: NativePhotoChoice[] = [];
  for (const asset of rows) {
    // The current Canva page is artwork, not a default replacement portrait
    // or Gallery photo, even though the normalized page shares private storage.
    if (artworkIds.has(asset.id)) {
      continue;
    }
    let metadata;
    try {
      metadata = await canvaNativeAssetMetadata(asset);
    } catch (error) {
      // An invalid library item is not an available choice. Storage/provider
      // outages still surface rather than silently emptying the library.
      if (error instanceof SetupError && ['INVALID', 'NOT_READY'].includes(error.code)) {
        continue;
      }
      throw error;
    }
    for (const role of ['profile', 'gallery'] as const) {
      choices.push({ mediaId: asset.id, storageKind: 'asset', role, width: metadata.width, height: metadata.height, alt: asset.name.slice(0, 500) || 'Salon photo', name: asset.name });
    }
  }
  return choices;
}

/** Called only after owner authorization and artifact assertion; no storage URLs escape. */
export async function canvaNativePhotoChoices(salonId: string, design: CanvaDesign | undefined): Promise<NativePhotoChoice[]> {
  if (!design) {
    return [];
  }
  if (!design.manualOrigin) {
    return libraryChoices(db, salonId, new Set(design.pages.map(page => page.assetId)));
  }
  // Include replacement history, without increasing the per-site display limit
  // or the existing asset library's storage budget.
  const rows = await db.select().from(media).where(and(eq(media.salonId, salonId), eq(media.siteId, design.manualOrigin.siteId), eq(media.revisionId, design.manualOrigin.revisionId), eq(media.claimStatus, 'ready'), eq(media.mimeType, 'image/webp'), inArray(media.role, ['gallery', 'profile']))).orderBy(desc(media.createdAt), media.id).limit(200);
  return rows.flatMap(row => row.storageKey && row.width && row.height && (row.role === 'gallery' || row.role === 'profile') ? [{ mediaId: row.id, role: row.role, width: row.width, height: row.height, alt: (row.altText?.trim() || row.fileName || 'Salon photo').slice(0, 500), name: row.fileName }] : []);
}

/** Prepare source inside the caller's transaction; source, draft and chat receipt commit together. */
export async function prepareCanvaNativePhotoChanges(actor: SetupActor, input: { expectedRevision: number; operationId: string; changes: CanvaNativePhotoChange[]; priorOperations?: SetupOperation[]; ownerMessage?: string }, tx: SetupTransaction) {
  await lockSetupSalon(tx, actor);
  const head = await loadSetupHead(tx, actor.salonId);
  const [base] = await tx.select().from(revisions).where(and(eq(revisions.salonId, actor.salonId), eq(revisions.workspaceId, head.workspace.id), eq(revisions.revision, input.expectedRevision)));
  if (!base?.document.website.config.customFrontendId) {
    throw new SetupError('NOT_READY', 'Open your saved Canva website before changing its photos.');
  }
  const { artifact } = await assertCustomArtifact(tx, actor.salonId, base.document.website.config.customFrontendId);
  const design = artifact.source.canva;
  if (!design) {
    throw new SetupError('INVALID', 'Open your saved Canva website before changing its photos.');
  }
  const useIds = [...new Set(input.changes.flatMap(item => item.change.type === 'use' ? [item.change.mediaId] : []))];
  // Recheck exact origin/role/ready metadata at save time, after any model call.
  // Uploads use this same transaction so an uncommitted new alias is visible.
  const rows = useIds.length && design.manualOrigin ? await tx.select().from(media).where(and(eq(media.salonId, actor.salonId), eq(media.siteId, design.manualOrigin.siteId), eq(media.revisionId, design.manualOrigin.revisionId), eq(media.claimStatus, 'ready'), eq(media.mimeType, 'image/webp'), inArray(media.id, useIds), inArray(media.role, ['gallery', 'profile']))) : [];
  const choices: NativePhotoChoice[] = design.manualOrigin ? rows.flatMap(row => row.storageKey && row.width && row.height && (row.role === 'gallery' || row.role === 'profile') ? [{ mediaId: row.id, role: row.role, width: row.width, height: row.height, alt: row.altText || row.fileName, name: row.fileName }] : []) : await libraryChoices(tx, actor.salonId, new Set(design.pages.map(page => page.assetId)), useIds);
  const proposed = applySetupOperations(base.document, input.priorOperations ?? [], 'assistant', input.ownerMessage ? { ownerMessage: input.ownerMessage } : undefined);
  const changed = applyCanvaNativeContentChanges(design, proposed.website.content.websiteDetails, input.changes, choices, canvaNativePhotosEnabled());
  const source = compileCanvaDesign(changed.design, changed.details);
  const saved = await storeCustomArtifact(actor, { ...input, source, assetIds: artifact.assetIds }, tx, changed.details);
  const textChanged = input.changes.some(item => item.change.type === 'create_about' || item.change.type === 'about_text');
  const operations: SetupOperation[] = [...(input.priorOperations ?? []), ...(textChanged ? [{ type: 'website_details' as const, values: { sections: changed.details.sections } }] : []), { type: 'custom_frontend', artifactId: saved.id }];
  return { ...saved, operations };
}

/** Appearance-only changes use the same owner draft and approval boundary. */
export async function editCanvaNativeContent(actor: SetupActor, raw: unknown, transaction?: SetupTransaction) {
  const input = canvaNativeEditSchema.parse(raw);
  const apply = async (tx: SetupTransaction) => {
    const saved = await prepareCanvaNativePhotoChanges(actor, { ...input, changes: [{ blockId: input.blockId, change: input.change }] }, tx);
    const next = await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations: saved.operations }, 'owner', tx);
    return { head: next, artifactId: saved.id };
  };
  return transaction ? apply(transaction) : db.transaction(apply);
}
