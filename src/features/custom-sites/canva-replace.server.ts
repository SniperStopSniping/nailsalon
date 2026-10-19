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
  pageIndex: z.number().int().min(0).max(9).optional(),
  replacementId: z.string().uuid(),
  sameDesignConfirmed: z.literal(true).optional(),
  newDesignConfirmed: z.literal(true).optional(),
}).strict().refine(input => Boolean(input.sameDesignConfirmed) !== Boolean(input.newDesignConfirmed), 'Choose a sharper export or confirm a new design.');

/** Same-layout copies keep links; new layouts reset only their page's links. Draft only. */
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
  const matches = design?.pages.flatMap((page, index) => page.assetId === input.pageAssetId ? [index] : []) ?? [];
  const pageIndex = input.pageIndex ?? (matches.length === 1 ? matches[0]! : -1);
  const page = design?.pages[pageIndex];
  if (!design || !page) {
    throw new SetupError('INVALID', 'Choose the specific page you want to replace. Your saved images and links are safe.');
  }
  if (page.assetId !== input.pageAssetId) {
    throw new SetupError('INVALID', 'That image is not on the selected page. Reload your saved design before trying again.');
  }
  const [original] = await ownedAssets(db, actor.salonId, [input.replacementId]);
  if (original!.role !== 'reference' || !original!.mimeType.startsWith('image/')) {
    throw new SetupError('INVALID', 'Choose a PNG, JPG or WebP export of your Canva page.');
  }
  const url = await assetDataUrl(original!);
  const metadata = await sharp(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'), { limitInputPixels: 40000000 }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new SetupError('INVALID', 'This image could not be read. Choose a PNG, JPG or WebP export.');
  }
  if (input.sameDesignConfirmed && !sameCanvaProportions(page, { width: metadata.width, height: metadata.height })) {
    throw new SetupError('INVALID', 'This image has different proportions. Choose Replace design image to place new links on it, or use a sharper export of the same layout.');
  }
  if (input.sameDesignConfirmed && metadata.width < page.width) {
    throw new SetupError('INVALID', 'This export is smaller than the saved image. Choose the original Canva export at a higher resolution.');
  }
  const image = await canvaWebsiteImage(actor, original!);
  const pages = design.pages.map((item, index) => index === pageIndex ? { ...item, assetId: image.id, width: metadata.width!, height: metadata.height!, ...(input.newDesignConfirmed ? { alt: `${base.business.name} — design page ${index + 1}`.slice(0, 3000) } : {}) } : item);
  const source = compileCanvaDesign({ ...design, ownerReviewed: false, pages, ...(input.newDesignConfirmed ? { areas: design.areas.filter(area => area.page !== pageIndex), visibleText: '' } : {}) }, base.website.content.websiteDetails);
  const stillUsed = pages.some((page, index) => index !== pageIndex && page.assetId === input.pageAssetId);
  const oldHash = media.find(asset => asset.id === input.pageAssetId)?.hash;
  const oldReferences = new Set(media.filter(asset => asset.role === 'reference' && oldHash && asset.hash === oldHash).map(asset => asset.id));
  const assetIds = [...new Set([...artifact.assetIds.filter(id => stillUsed || (id !== input.pageAssetId && !oldReferences.has(id))), original!.id, image.id])];
  const operations: SetupOperation[] = [];
  if (base.designBrief) {
    // Keep page order, including when only one use of a repeated image changes.
    const brief = base.designBrief;
    const orderedReferences = pages.flatMap((page) => {
      if (page.assetId === image.id) {
        return [original!.id];
      }
      const hash = media.find(asset => asset.id === page.assetId)?.hash;
      const reference = brief.referenceIds.find(id => hash && media.some(asset => asset.id === id && asset.hash === hash));
      return reference ? [reference] : [];
    });
    const referenceIds = [...new Set([...orderedReferences, ...brief.referenceIds.filter(id => stillUsed || !oldReferences.has(id)), original!.id])];
    if (referenceIds.length > 6) {
      throw new SetupError('INVALID', 'Remove an unused design reference before replacing this page.');
    }
    operations.push({ type: 'design_brief', values: { ...base.designBrief, referenceIds, ownedReferenceIds: [...new Set([...base.designBrief.ownedReferenceIds.filter(id => referenceIds.includes(id)), original!.id])], websiteAssetIds: base.designBrief.websiteAssetIds.filter(id => stillUsed || id !== input.pageAssetId) } });
  }
  const saved = await storeCustomArtifact(actor, { ...input, source, assetIds });
  operations.unshift({ type: 'custom_frontend', artifactId: saved.id });
  return { head: await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations }), artifactId: saved.id };
}
