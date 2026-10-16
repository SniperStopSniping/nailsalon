import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor } from '@/features/business-setup/drafts.server';
import { loadSetupHead, lockSetupSalon, readSetupSnapshot } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { businessSetupPreviewShareSchema as shares, businessSetupRevisionSchema as revisions } from '@/models/Schema';

import { assertCustomArtifact } from './artifacts.server';
import { canvaDraftBlockers } from './canva-data.server';
import { setupCustomSitePayload } from './payload.server';

// The browser generates 256 random bits once per request, retaining the token
// across uncertain retries. Only its hash is stored. This is view-only access.
export const previewShareInput = z.object({ expectedRevision: z.number().int().positive(), token: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function shareCustomPreview(actor: SetupActor, raw: unknown) {
  const input = previewShareInput.parse(raw);
  return db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    const [existing] = await tx.select().from(shares).where(eq(shares.tokenHash, hash(input.token)));
    if (existing) {
      if (existing.salonId !== actor.salonId || existing.revision !== input.expectedRevision || existing.revokedAt || existing.expiresAt.getTime() <= Date.now()) {
        throw new SetupError('STALE', 'That preview link is no longer available. Create a new link.');
      }
      return { path: `/website-preview/${input.token}`, revision: existing.revision, expiresAt: existing.expiresAt };
    }
    if (head.revision.revision !== input.expectedRevision || (head.workspace.status === 'editing' && (await readSetupSnapshot(tx, salon)).hash !== head.workspace.baselineHash)) {
      throw new SetupError('STALE', 'Your saved changes have moved on. Reload before sharing.');
    }
    const document = head.revision.document;
    const id = document.website.config.customFrontendId;
    if (!id) {
      throw new SetupError('NOT_READY', 'Create your website before sharing a preview.');
    }
    // Sharing a draft must not accidentally expose a residential address.
    // A deliberate public-address publishing decision remains a separate flow.
    if (document.business.locationDisplayMode === 'full_address') {
      throw new SetupError('INVALID', 'Hide your full address in Details before sharing a draft preview.');
    }
    const { artifact } = await assertCustomArtifact(tx, actor.salonId, id);
    const blockers = canvaDraftBlockers(document, artifact.source);
    if (blockers.length) {
      throw new SetupError('NOT_READY', blockers.join(' '));
    }
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    await tx.insert(shares).values({ tokenHash: hash(input.token), salonId: actor.salonId, workspaceId: head.workspace.id, revision: input.expectedRevision, actorId: actor.adminId, expiresAt });
    return { path: `/website-preview/${input.token}`, revision: input.expectedRevision, expiresAt };
  });
}

export async function revokeCustomPreview(actor: SetupActor, token: string) {
  previewShareInput.shape.token.parse(token);
  await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    await tx.update(shares).set({ revokedAt: new Date() }).where(and(eq(shares.salonId, actor.salonId), eq(shares.tokenHash, hash(token))));
  });
}

export async function sharedCustomPreview(token: string) {
  if (!previewShareInput.shape.token.safeParse(token).success) {
    return null;
  }
  const [row] = await db.select({ share: shares, document: revisions.document }).from(shares).innerJoin(revisions, and(eq(shares.salonId, revisions.salonId), eq(shares.workspaceId, revisions.workspaceId), eq(shares.revision, revisions.revision))).where(eq(shares.tokenHash, hash(token)));
  if (!row || row.share.revokedAt || row.share.expiresAt.getTime() <= Date.now() || row.document.business.locationDisplayMode === 'full_address') {
    return null;
  }
  // Only the ordinary public website projection leaves this boundary. No draft
  // operations, transcripts, approvals, exact address, tokens or provider data.
  const document = structuredClone(row.document);
  document.business.exactAddress = '';
  const id = document.website.config.customFrontendId;
  if (!id) {
    return null;
  }
  const { artifact } = await assertCustomArtifact(db, row.share.salonId, id);
  if (canvaDraftBlockers(document, artifact.source).length) {
    return null;
  }
  return setupCustomSitePayload(row.share.salonId, document);
}
