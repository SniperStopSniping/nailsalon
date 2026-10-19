import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor, SetupTransaction } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon, setupHash } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { customSiteArtifactSchema as artifacts } from '@/models/Schema';

import { assertWebsiteAssetBudget, ownedAssets } from './assets.server';
import { compileCanvaDesign } from './canva';
import { canvaDataFingerprint, canvaPriceLabelsFingerprint, canvaTargetBlockers } from './canva-data.server';
import type { CustomSiteSource } from './contracts';
import { assertCanvaNativeMedia } from './native-media.server';
import { containsPrivateAddress } from './private-address';
import { customSiteDataFromSetup } from './setup-data';
import { validateCustomSource } from './validate.server';

export async function assertCustomArtifact(tx: SetupTransaction | typeof db, salonId: string, id: string) {
  const [artifact] = await tx.select().from(artifacts).where(and(eq(artifacts.salonId, salonId), eq(artifacts.id, id)));
  if (!artifact || setupHash(artifact.source) !== artifact.sourceHash) {
    throw new SetupError('INVALID', 'This saved design is unavailable.');
  }
  const media = await ownedAssets(tx, salonId, artifact.assetIds);
  assertWebsiteAssetBudget(media);
  validateCustomSource(artifact.source, new Set(media.filter(a => a.role !== 'reference' && a.mimeType.startsWith('image/')).map(a => a.id)));
  await assertCanvaNativeMedia(tx, salonId, artifact.source.canva);
  return { artifact, media };
}
export async function storeCustomArtifact(actor: SetupActor, input: { source: CustomSiteSource; assetIds: string[]; operationId: string; expectedRevision: number }, transaction?: SetupTransaction) {
  const apply = async (tx: SetupTransaction) => {
    await lockSetupSalon(tx, actor);
    const media = await ownedAssets(tx, actor.salonId, input.assetIds);
    const source = validateCustomSource(input.source, new Set(media.filter(a => a.role !== 'reference' && a.mimeType.startsWith('image/')).map(a => a.id)));
    const [previous] = await tx.select().from(artifacts).where(and(eq(artifacts.salonId, actor.salonId), eq(artifacts.operationId, input.operationId)));
    if (previous) {
      if (previous.sourceHash !== setupHash(source) || setupHash(previous.assetIds) !== setupHash(input.assetIds) || previous.actorId !== actor.adminId) {
        throw new SetupError('INVALID', 'This request was already used for another design.');
      }
      return previous;
    }
    const head = await loadSetupHead(tx, actor.salonId);
    if (head.workspace.status !== 'editing' || head.revision.revision !== input.expectedRevision) {
      throw new SetupError('STALE', 'Your saved design changed. Reload before saving this version.');
    }
    const business = head.revision.document.business;
    if (business.exactAddress && business.locationDisplayMode !== 'full_address' && containsPrivateAddress(JSON.stringify({ bio: head.revision.document.website.content.bio, details: head.revision.document.website.content.websiteDetails }), business.exactAddress)) {
      throw new SetupError('INVALID', 'Your public website details contain your private service address. Remove it or review address visibility first.');
    }
    if (source.canva) {
      await assertCanvaNativeMedia(tx, actor.salonId, source.canva, true);
      const trusted = validateCustomSource(compileCanvaDesign(source.canva, head.revision.document.website.content.websiteDetails), new Set(media.filter(a => a.role !== 'reference').map(a => a.id)));
      if (source.html !== trusted.html || source.css !== trusted.css || source.javascript !== '') {
        throw new SetupError('INVALID', 'Keep the Canva artwork intact. Use the clickable-area controls to change its links.');
      }
      if (business.exactAddress && business.locationDisplayMode !== 'full_address' && containsPrivateAddress(source.canva.visibleText, business.exactAddress)) {
        throw new SetupError('INVALID', 'Your Canva artwork contains your private address. Remove it in Canva and upload the updated export.');
      }
    }
    if (business.exactAddress && business.locationDisplayMode !== 'full_address' && containsPrivateAddress(JSON.stringify(source), business.exactAddress)) {
      throw new SetupError('INVALID', 'This design includes your private service address. Remove it or review your address visibility first.');
    }
    assertWebsiteAssetBudget(media);
    const [artifact] = await tx.insert(artifacts).values({ id: randomUUID(), salonId: actor.salonId, actorId: actor.adminId, source, sourceHash: setupHash(source), assetIds: input.assetIds, parentId: head.revision.document.website.config.customFrontendId ?? null, operationId: input.operationId }).returning();
    return artifact!;
  };
  return transaction ? apply(transaction) : db.transaction(apply);
}
export async function saveCustomSource(actor: SetupActor, input: { source: CustomSiteSource; assetIds: string[]; operationId: string; expectedRevision: number }, origin: 'owner' | 'assistant' = 'owner', artworkReview = false) {
  if (input.source.canva && !artworkReview) {
    input = { ...input, source: { ...input.source, canva: { ...input.source.canva, ownerReviewed: false } } };
  }
  const artifact = await storeCustomArtifact(actor, input);
  const head = await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations: [{ type: 'custom_frontend', artifactId: artifact.id }] }, origin);
  return { artifact, head };
}

/** Only this authenticated owner action can acknowledge fixed artwork facts. */
export async function reviewCanvaArtwork(actor: SetupActor, input: { expectedRevision: number; operationId: string }) {
  // Replaying a lost response returns the original saved review revision.
  const [retained] = await db.select().from(artifacts).where(and(eq(artifacts.salonId, actor.salonId), eq(artifacts.operationId, input.operationId)));
  const current = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    if (retained?.source.canva?.ownerReviewed) {
      return { artifact: retained, document: head.revision.document };
    }
    if (head.revision.revision !== input.expectedRevision || !head.revision.document.website.config.customFrontendId) {
      throw new SetupError('STALE', 'Your design changed. Check the latest preview before continuing.');
    }
    return { ...(await assertCustomArtifact(tx, actor.salonId, head.revision.document.website.config.customFrontendId)), document: head.revision.document };
  });
  if (!current.artifact.source.canva) {
    throw new SetupError('INVALID', 'This design does not use Canva artwork.');
  }
  const data = customSiteDataFromSetup(current.document);
  const blockers = canvaTargetBlockers(current.artifact.source, data);
  if (blockers.length) {
    throw new SetupError('NOT_READY', blockers.join(' '));
  }
  const source = retained ? retained.source : compileCanvaDesign({ ...current.artifact.source.canva, ownerReviewed: true, dataFingerprint: canvaDataFingerprint(data), priceLabelsFingerprint: canvaPriceLabelsFingerprint(data) }, data.details);
  return saveCustomSource(actor, { ...input, source, assetIds: current.artifact.assetIds }, 'owner', true);
}
