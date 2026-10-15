import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { BookingPageBuilderOperation } from '@/libs/bookingPageBuilder';
import { type BookingPageDraftPatch, updateBookingPageDraftInTransaction } from '@/libs/bookingPageConfig';
import { type BookingPageContentPatch, updateBookingPageContentDraftInTransaction } from '@/libs/bookingPageContent';
import { db } from '@/libs/DB';
import { adminSalonMembershipSchema, businessSetupRevisionSchema, businessSetupWorkspaceSchema, salonSchema } from '@/models/Schema';

import { SetupError } from './contracts';
import { loadSetupHead, readSetupSnapshot, setupHash } from './drafts.server';

/**
 * Legacy editor adapter. Existing authorized collaborators retain manual
 * rights; every accepted edit advances the same draft and invalidates approval.
 */
export async function editSharedSetupWebsite(input: {
  salonId: string;
  adminId: string;
  expectedRevision?: number;
  patch: { config?: BookingPageDraftPatch; content?: BookingPageContentPatch; builderOperation?: BookingPageBuilderOperation };
}) {
  return db.transaction(async (tx) => {
    const [workspace] = await tx.select().from(businessSetupWorkspaceSchema).where(eq(businessSetupWorkspaceSchema.salonId, input.salonId));
    if (!workspace) {
      return false;
    }
    const [membership] = await tx.select().from(adminSalonMembershipSchema).where(and(eq(adminSalonMembershipSchema.salonId, input.salonId), eq(adminSalonMembershipSchema.adminId, input.adminId))).for('share');
    if (!membership) {
      throw new SetupError('FORBIDDEN', 'You do not have access to edit this business.');
    }
    const [salon] = await tx.select().from(salonSchema).where(eq(salonSchema.id, input.salonId)).for('update');
    if (!salon) {
      throw new SetupError('NOT_FOUND', 'This business is unavailable.');
    }
    const head = await loadSetupHead(tx, salon.id);
    if (head.revision.document.website.config.customFrontendId) {
      throw new SetupError('NOT_READY', 'This is a custom website. Open Edit with AI to change its design or edit its saved source.');
    }
    if (workspace.status !== 'editing') {
      return false;
    }
    if (input.expectedRevision !== head.revision.revision) {
      throw new SetupError('STALE', 'Your website changed elsewhere. Reload the latest changes before saving.');
    }
    if (head.workspace.status !== 'editing') {
      throw new SetupError('STALE', 'The setup changed. Reload your website editor.');
    }
    const before = await readSetupSnapshot(tx, salon);
    if (before.hash !== head.workspace.baselineHash) {
      throw new SetupError('STALE', 'Your business settings changed elsewhere. Review those changes first.');
    }
    if (input.patch.builderOperation) {
      await updateBookingPageDraftInTransaction(tx, salon.id, null, { builderOperation: input.patch.builderOperation });
    } else if (input.patch.config) {
      await updateBookingPageDraftInTransaction(tx, salon.id, input.patch.config);
    }
    if (input.patch.content) {
      await updateBookingPageContentDraftInTransaction(tx, salon.id, input.patch.content);
    }
    const [updated] = await tx.select().from(salonSchema).where(eq(salonSchema.id, salon.id));
    const after = await readSetupSnapshot(tx, updated!);
    const document = structuredClone(head.revision.document);
    document.website = { config: after.page.draft, content: after.content.draft };
    document.business.locationDisplayMode = after.content.draft.locationDisplayMode;
    const revision = head.revision.revision + 1;
    await tx.insert(businessSetupRevisionSchema).values({ salonId: salon.id, workspaceId: head.workspace.id, revision, operationId: randomUUID(), operationHash: setupHash(input.patch), actorId: input.adminId, origin: 'manual_website', document });
    await tx.update(businessSetupWorkspaceSchema).set({ headRevision: revision, baselineHash: after.hash, updatedAt: new Date() }).where(eq(businessSetupWorkspaceSchema.id, head.workspace.id));
    return true;
  });
}

/**
 * Legacy publication must not publish a staged page separately from its
 * reviewed services/hours. The owner can continue editing with AI disabled.
 */
export async function hasEditingSetup(salonId: string) {
  const [row] = await db.select({ id: businessSetupWorkspaceSchema.id }).from(businessSetupWorkspaceSchema).where(and(eq(businessSetupWorkspaceSchema.salonId, salonId), eq(businessSetupWorkspaceSchema.status, 'editing')));
  return Boolean(row);
}

export async function getSetupEditingRevision(salonId: string): Promise<number | null> {
  const [row] = await db.select({ revision: businessSetupWorkspaceSchema.headRevision }).from(businessSetupWorkspaceSchema).where(and(eq(businessSetupWorkspaceSchema.salonId, salonId), eq(businessSetupWorkspaceSchema.status, 'editing')));
  return row?.revision ?? null;
}
