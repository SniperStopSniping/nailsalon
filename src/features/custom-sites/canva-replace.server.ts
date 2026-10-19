import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { SetupOperation } from '@/features/business-setup/contracts';
import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import sharp from '@/libs/safeSharp.server';
import { businessSetupRevisionSchema as revisions } from '@/models/Schema';

import { assertCustomArtifact, storeCustomArtifact } from './artifacts.server';
import { assetDataUrl, ownedAssets } from './assets.server';
import { compileCanvaDesign } from './canva';
import { canvaWebsiteImage } from './canva-assets.server';
import { sameCanvaProportions } from './canva-quality';

export const canvaReplaceSchema = z.object({
  expectedRevision: z.number().int().positive(),
  operationId: z.string().uuid(),
  pageAssetId: z.string().uuid(),
  replacementId: z.string().uuid(),
  sameDesignConfirmed: z.literal(true),
}).strict();

/** A sharper copy of the same layout reuses saved links; it never reviews or publishes. */
export async function replaceCanvaPage(actor: SetupActor, raw: unknown) {
  const input = canvaReplaceSchema.parse(raw);
  const base = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    const [base] = await tx.select().from(revisions).where(and(eq(revisions.salonId, actor.salonId), eq(revisions.workspaceId, head.workspace.id), eq(revisions.revision, input.expectedRevision)));
    if (!base?.document.website.config.customFrontendId) {
      throw new SetupError('NOT_READY', 'Create your Canva website draft before replacing its image.');
    }
    return base.document;
  });
  const { artifact, media } = await assertCustomArtifact(db, actor.salonId, base.website.config.customFrontendId!);
  const design = artifact.source.canva;
  const page = design?.pages.find(page => page.assetId === input.pageAssetId);
  if (!design || !page) {
    throw new SetupError('INVALID', 'That page is not part of this Canva design.');
  }
  const [original] = await ownedAssets(db, actor.salonId, [input.replacementId]);
  if (original!.role !== 'reference' || !original!.mimeType.startsWith('image/')) {
    throw new SetupError('INVALID', 'Choose a PNG, JPG or WebP export of the same Canva page.');
  }
  const url = await assetDataUrl(original!);
  const metadata = await sharp(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'), { limitInputPixels: 40000000 }).metadata();
  if (!metadata.width || !metadata.height || !sameCanvaProportions(page, { width: metadata.width, height: metadata.height })) {
    throw new SetupError('INVALID', 'This image has different proportions. Your saved links are safe. Attach it in chat so Luster can find the links in its new layout.');
  }
  if (metadata.width < page.width) {
    throw new SetupError('INVALID', 'This export is smaller than the saved image. Choose the original Canva export at a higher resolution.');
  }
  const image = await canvaWebsiteImage(actor, original!);
  const source = compileCanvaDesign({ ...design, ownerReviewed: false, pages: design.pages.map(item => item.assetId === input.pageAssetId ? { ...item, assetId: image.id, width: metadata.width!, height: metadata.height! } : item) }, base.website.content.websiteDetails);
  const oldHash = media.find(asset => asset.id === input.pageAssetId)?.hash;
  const oldReferences = new Set(media.filter(asset => asset.role === 'reference' && asset.hash === oldHash).map(asset => asset.id));
  const assetIds = [...new Set([...artifact.assetIds.filter(id => id !== input.pageAssetId && !oldReferences.has(id)), original!.id, image.id])];
  const operations: SetupOperation[] = [];
  if (base.designBrief) {
    // Replacing page one must not move it behind the other pages next time AI runs.
    const referenceIds = [...new Set(base.designBrief.referenceIds.some(id => oldReferences.has(id)) ? base.designBrief.referenceIds.map(id => oldReferences.has(id) ? original!.id : id) : [...base.designBrief.referenceIds, original!.id])];
    if (referenceIds.length > 6) {
      throw new SetupError('INVALID', 'Remove an unused design reference before replacing this page.');
    }
    operations.push({ type: 'design_brief', values: { ...base.designBrief, referenceIds, ownedReferenceIds: [...new Set([...base.designBrief.ownedReferenceIds.filter(id => referenceIds.includes(id)), original!.id])], websiteAssetIds: base.designBrief.websiteAssetIds.filter(id => id !== input.pageAssetId) } });
  }
  const saved = await storeCustomArtifact(actor, { ...input, source, assetIds });
  operations.unshift({ type: 'custom_frontend', artifactId: saved.id });
  return { head: await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations }), artifactId: saved.id };
}
