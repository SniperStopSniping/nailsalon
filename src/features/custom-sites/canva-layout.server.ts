import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor } from '@/features/business-setup/drafts.server';
import { loadSetupHead, lockSetupSalon } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { businessSetupRevisionSchema as revisions } from '@/models/Schema';

import { assertCustomArtifact, saveCustomSource } from './artifacts.server';
import { canvaPagePresentationSchema, compileCanvaDesign } from './canva';

export const canvaLayoutSchema = z.object({
  expectedRevision: z.number().int().positive(),
  operationId: z.string().uuid(),
  pageIndex: z.number().int().min(0).max(9),
  pageAssetId: z.string().uuid(),
  presentation: canvaPagePresentationSchema,
}).strict();

/** Appearance-only edit. Preserve artwork, links and business settings in the shared draft. */
export async function editCanvaLayout(actor: SetupActor, raw: unknown) {
  const input = canvaLayoutSchema.parse(raw);
  const document = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    const [revision] = await tx.select().from(revisions).where(and(eq(revisions.salonId, actor.salonId), eq(revisions.workspaceId, head.workspace.id), eq(revisions.revision, input.expectedRevision)));
    if (!revision?.document.website.config.customFrontendId) {
      throw new SetupError('NOT_READY', 'Open your saved Canva design before changing its layout.');
    }
    return revision.document;
  });
  const { artifact } = await assertCustomArtifact(db, actor.salonId, document.website.config.customFrontendId!);
  const design = artifact.source.canva;
  const page = design?.pages[input.pageIndex];
  if (!design || !page || page.assetId !== input.pageAssetId) {
    throw new SetupError('INVALID', 'That image changed. Reload your saved design before adjusting its layout.');
  }
  const pages = design.pages.map((page, index) => index === input.pageIndex ? { ...page, presentation: input.presentation } : page);
  const source = compileCanvaDesign({ ...design, pages, ownerReviewed: false }, document.website.content.websiteDetails);
  const saved = await saveCustomSource(actor, { source, assetIds: artifact.assetIds, expectedRevision: input.expectedRevision, operationId: input.operationId });
  return { head: saved.head, artifactId: saved.artifact.id };
}
