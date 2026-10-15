import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor, SetupTransaction } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon, setupHash } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { customSiteArtifactSchema as artifacts } from '@/models/Schema';

import { ownedAssets } from './assets.server';
import type { CustomSiteSource } from './contracts';
import { validateCustomSource } from './validate.server';

export async function assertCustomArtifact(tx: SetupTransaction | typeof db, salonId: string, id: string) {
  const [artifact] = await tx.select().from(artifacts).where(and(eq(artifacts.salonId, salonId), eq(artifacts.id, id)));
  if (!artifact || setupHash(artifact.source) !== artifact.sourceHash) {
    throw new SetupError('INVALID', 'This saved design is unavailable.');
  }
  const media = await ownedAssets(tx, salonId, artifact.assetIds);
  if (media.filter(a => a.role !== 'reference').reduce((sum, a) => sum + a.byteSize, 0) > 2000000) {
    throw new SetupError('INVALID', 'Choose fewer website photos to keep this design fast.');
  }
  validateCustomSource(artifact.source, new Set(media.filter(a => a.role !== 'reference' && a.mimeType.startsWith('image/')).map(a => a.id)));
  return { artifact, media };
}
export async function storeCustomArtifact(actor: SetupActor, input: { source: CustomSiteSource; assetIds: string[]; operationId: string; expectedRevision: number }) {
  return db.transaction(async (tx) => {
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
    if (business.exactAddress && business.locationDisplayMode !== 'full_address' && JSON.stringify(source).toLowerCase().includes(business.exactAddress.toLowerCase())) {
      throw new SetupError('INVALID', 'This design includes your private service address. Remove it or review your address visibility first.');
    }
    if (media.filter(a => a.role !== 'reference').reduce((sum, a) => sum + a.byteSize, 0) > 2000000) {
      throw new SetupError('INVALID', 'Choose fewer website photos to keep this design fast.');
    }
    const [artifact] = await tx.insert(artifacts).values({ id: randomUUID(), salonId: actor.salonId, actorId: actor.adminId, source, sourceHash: setupHash(source), assetIds: input.assetIds, parentId: head.revision.document.website.config.customFrontendId ?? null, operationId: input.operationId }).returning();
    return artifact!;
  });
}
export async function saveCustomSource(actor: SetupActor, input: { source: CustomSiteSource; assetIds: string[]; operationId: string; expectedRevision: number }, origin: 'owner' | 'assistant' = 'owner') {
  const artifact = await storeCustomArtifact(actor, input);
  const head = await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations: [{ type: 'custom_frontend', artifactId: artifact.id }] }, origin);
  return { artifact, head };
}
