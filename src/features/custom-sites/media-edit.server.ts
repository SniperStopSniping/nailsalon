import 'server-only';

import { and, eq } from 'drizzle-orm';
import { parseFragment, serialize } from 'parse5';
import { z } from 'zod';

import type { SetupOperation } from '@/features/business-setup/contracts';
import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { businessSetupRevisionSchema as revisions } from '@/models/Schema';

import { assertCustomArtifact, storeCustomArtifact } from './artifacts.server';
import { ownedAssets } from './assets.server';

export const mediaEditSchema = z.object({ expectedRevision: z.number().int().positive(), operationId: z.string().uuid(), assetId: z.string().uuid(), replacementId: z.string().uuid().nullable() }).strict();
/** Explicit owner image controls edit the saved source and leave earlier versions intact. */
export async function editCustomMedia(actor: SetupActor, raw: unknown) {
  const input = mediaEditSchema.parse(raw);
  const base = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    const [base] = await tx.select().from(revisions).where(and(eq(revisions.salonId, actor.salonId), eq(revisions.workspaceId, head.workspace.id), eq(revisions.revision, input.expectedRevision)));
    if (!base?.document.website.config.customFrontendId) {
      throw new SetupError('NOT_READY', 'Create a website draft before replacing a photo in it.');
    }
    return base.document;
  });
  const { artifact, media } = await assertCustomArtifact(db, actor.salonId, base.website.config.customFrontendId!);
  if (artifact.source.canva) {
    throw new SetupError('INVALID', 'Update the artwork in Canva, upload the new export, then check its clickable areas.');
  }
  if (!media.some(asset => asset.id === input.assetId && asset.role !== 'reference')) {
    throw new SetupError('INVALID', 'That photo is not part of this design.');
  }
  if (input.replacementId) {
    const [replacement] = await ownedAssets(db, actor.salonId, [input.replacementId]);
    if (replacement!.role === 'reference' || !replacement!.mimeType.startsWith('image/')) {
      throw new SetupError('INVALID', 'Choose a website photo or logo, not a design reference.');
    }
  }
  const root = parseFragment(artifact.source.html);
  let changed = false;
  const visit = (node: any) => {
    node.childNodes = node.childNodes?.filter((child: any) => {
      const src = child.tagName === 'img' && child.attrs?.find((attr: any) => attr.name === 'src' && attr.value === `asset:${input.assetId}`);
      if (src) {
        changed = true;
        if (!input.replacementId) {
          return false;
        }
        src.value = `asset:${input.replacementId}`;
      }
      visit(child);
      return true;
    });
    if (node.content) {
      visit(node.content);
    }
  };
  visit(root);
  if (!changed) {
    throw new SetupError('INVALID', 'This photo is not displayed in the selected design.');
  }
  const assetIds = [...new Set([...artifact.assetIds.filter(id => id !== input.assetId), ...(input.replacementId ? [input.replacementId] : [])])];
  const saved = await storeCustomArtifact(actor, { ...input, source: { ...artifact.source, html: serialize(root) }, assetIds });
  const operations: SetupOperation[] = [{ type: 'custom_frontend', artifactId: saved.id }];
  if (base.designBrief) {
    operations.push({ type: 'design_brief', values: { ...base.designBrief, websiteAssetIds: [...new Set([...base.designBrief.websiteAssetIds.filter(id => id !== input.assetId), ...(input.replacementId ? [input.replacementId] : [])])] } });
  }
  return { head: await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations }), artifactId: saved.id };
}
