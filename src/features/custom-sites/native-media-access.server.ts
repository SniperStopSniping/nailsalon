import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { lockSetupSalon, readSetupSnapshot } from '@/features/business-setup/drafts.server';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { db } from '@/libs/DB';
import { adminSalonMembershipSchema as members, businessSetupPublicationSchema as publications, businessSetupRevisionSchema as revisions, customSiteArtifactSchema as artifacts, salonSchema as salons } from '@/models/Schema';

import { assertCustomArtifact } from './artifacts.server';
import { canvaFactsMatch } from './canva-data.server';
import { assertCanvaNativeMedia, readCanvaNativeMedia } from './native-media.server';
import { customSiteDataFromSetup } from './setup-data';
import { sharedCustomPreviewAccess } from './share.server';

export const nativeMediaReadSchema = z.object({ artifactId: z.string().uuid(), mediaId: z.string().uuid(), shareToken: z.string().regex(/^[a-f0-9]{64}$/u).optional() }).strict();

/** The browser supplies addressing only. Server ownership/publication authorizes bytes. */
export async function readAuthorizedCanvaNativeMedia(raw: unknown, adminId?: string) {
  const input = nativeMediaReadSchema.parse(raw);
  const shared = input.shareToken ? await sharedCustomPreviewAccess(input.shareToken) : null;
  if (input.shareToken && (!shared || shared.artifact.id !== input.artifactId)) {
    return null;
  }
  const row = await db.transaction(async (tx) => {
    const [record] = await tx.select().from(artifacts).where(eq(artifacts.id, input.artifactId));
    if (!record) {
      return null;
    }
    let [salon] = await tx.select().from(salons).where(eq(salons.id, record.salonId));
    if (!salon) {
      return null;
    }
    const [membership] = adminId ? await tx.select({ role: members.role }).from(members).where(and(eq(members.salonId, salon.id), eq(members.adminId, adminId))) : [];
    let authorized = shared?.salonId === salon.id;
    if (!authorized && membership?.role === 'owner') {
      await lockSetupSalon(tx, { salonId: salon.id, adminId: adminId! });
      authorized = true;
    }
    if (!authorized) {
      // Public readers take a shared lock only after the owner path is known;
      // never upgrade two simultaneous shared owner locks to exclusive locks.
      [salon] = await tx.select().from(salons).where(eq(salons.id, record.salonId)).for('share');
      if (!salon) {
        return null;
      }
      if (salon.publicationStatus !== 'published' || salon.deletedAt || ['suspended', 'cancelled'].includes(salon.status ?? '') || !salon.onlineBookingEnabled || resolveBookingPageConfig(salon.settings).live.customFrontendId !== record.id || !record.source.canva?.ownerReviewed) {
        return null;
      }
      const [receipt] = await tx.select({ id: publications.id }).from(publications).innerJoin(revisions, and(eq(revisions.salonId, publications.salonId), eq(revisions.workspaceId, publications.workspaceId), eq(revisions.revision, publications.revision))).where(and(eq(publications.salonId, salon.id), eq(publications.mediaFinalized, true), sql`${revisions.document} #>> '{website,config,customFrontendId}' = ${record.id}`)).limit(1);
      if (!receipt) {
        return null;
      }
      const snapshot = await readSetupSnapshot(tx, salon);
      if (!canvaFactsMatch(record.source, customSiteDataFromSetup(snapshot.document))) {
        return null;
      }
    }
    const { artifact } = await assertCustomArtifact(tx, salon.id, record.id);
    const media = await assertCanvaNativeMedia(tx, salon.id, artifact.source.canva);
    return media.find(image => image.id === input.mediaId) ?? null;
  });
  return row ? readCanvaNativeMedia(row) : null;
}
