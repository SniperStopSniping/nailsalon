import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { SetupOperation } from '@/features/business-setup/contracts';
import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon, setupHash } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { businessSetupRevisionSchema as revisions, customSiteArtifactSchema as artifacts } from '@/models/Schema';

import { assertCustomArtifact } from './artifacts.server';
import type { CustomSiteSource } from './contracts';
import { containsPrivateAddress } from './private-address';
import { EMPTY_WEBSITE_DETAILS, websiteDetailsSchema } from './website-details';

export const restoreCustomSourceSchema = z.object({ expectedRevision: z.number().int().positive(), operationId: z.string().uuid(), artifactId: z.string().uuid() }).strict();
const aboutIds = (source: CustomSiteSource) => [...new Set((source.canva?.nativeContent ?? []).flatMap(block => block.type === 'about' ? block.textSectionIds : []))];

/** Restore design-owned About copy, while retaining current business and contacts. */
export async function restoreCustomSource(actor: SetupActor, raw: unknown) {
  const input = restoreCustomSourceSchema.parse(raw);
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    const [base] = await tx.select().from(revisions).where(and(eq(revisions.salonId, actor.salonId), eq(revisions.workspaceId, head.workspace.id), eq(revisions.revision, input.expectedRevision)));
    if (!base) {
      throw new SetupError('STALE', 'Your draft changed. Load the latest version before restoring a design.');
    }
    const { artifact } = await assertCustomArtifact(tx, actor.salonId, input.artifactId);
    const ids = aboutIds(artifact.source);
    const currentId = base.document.website.config.customFrontendId;
    const [current] = currentId ? await tx.select({ source: artifacts.source, sourceHash: artifacts.sourceHash }).from(artifacts).where(and(eq(artifacts.salonId, actor.salonId), eq(artifacts.id, currentId))) : [];
    if (currentId && (!current || setupHash(current.source) !== current.sourceHash)) {
      throw new SetupError('NOT_READY', 'Your current design could not be checked. Your saved drafts are safe.');
    }
    // A broken current photo must not prevent restoring an intact older design.
    // Only its trusted text identities are needed; do not load current images.
    const currentIds = current ? aboutIds(current.source) : [];
    const operations: SetupOperation[] = [];
    if (ids.length || currentIds.length) {
      // Source is immutable. Its first applied revision is the authoritative
      // counterpart for bound About text, including recovery after a reset.
      const [saved] = await tx.select({ document: revisions.document }).from(revisions).where(and(eq(revisions.salonId, actor.salonId), sql`${revisions.document} #>> '{website,config,customFrontendId}' = ${artifact.id}`)).orderBy(asc(revisions.createdAt), asc(revisions.revision)).limit(1);
      const sections = ids.map(id => saved?.document.website.content.websiteDetails?.sections.find(section => section.id === id));
      if (sections.some(section => !section)) {
        throw new SetupError('NOT_READY', 'That saved design is missing some About wording. Your current draft is safe.');
      }
      const replacedIds = new Set([...ids, ...currentIds]);
      const details = structuredClone(base.document.website.content.websiteDetails ?? EMPTY_WEBSITE_DETAILS);
      details.sections = [...details.sections.filter(section => !replacedIds.has(section.id)), ...sections.map(section => section!)];
      if (!websiteDetailsSchema.safeParse(details).success) {
        throw new SetupError('NOT_READY', 'There is too much website wording to restore together. Shorten the current website details and try again.');
      }
      const business = base.document.business;
      if (business.exactAddress && business.locationDisplayMode !== 'full_address' && containsPrivateAddress(JSON.stringify(details.sections), business.exactAddress)) {
        throw new SetupError('NOT_READY', 'That saved About text includes your private address, so this design could not be restored. Your current draft is unchanged.');
      }
      operations.push({ type: 'website_details', values: details });
    }
    operations.push({ type: 'custom_frontend', artifactId: artifact.id });
    return { head: await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations }, 'owner', tx) };
  });
}
