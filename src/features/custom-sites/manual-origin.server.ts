import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { DatabaseSessionHandle } from '@/libs/DB';
import { businessSetupRevisionSchema as revisions, businessSetupWorkspaceSchema as workspaces, customSiteArtifactSchema as artifacts, salonSchema } from '@/models/Schema';

export function onboardingCanvaOperationId(siteId: string, revisionId: string) {
  const bytes = createHash('sha256').update(`luster-manual-canva:${siteId}:${revisionId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Internal read adapter. Call only after authorizing this salon/site through membership. */
export async function linkedOnboardingCanvaDraft(database: Pick<DatabaseSessionHandle, 'select'>, input: { salonId: string; siteId: string; revisionId: string }) {
  // The committed handoff operation is the marker, not AI-controlled source
  // metadata. It survives later design replacement, publication and restoration.
  const [linked] = await database.select({
    salonSlug: salonSchema.slug,
    revision: revisions.revision,
    document: revisions.document,
  }).from(artifacts)
    .innerJoin(workspaces, eq(workspaces.salonId, artifacts.salonId))
    .innerJoin(revisions, and(eq(revisions.salonId, workspaces.salonId), eq(revisions.workspaceId, workspaces.id), eq(revisions.revision, workspaces.headRevision)))
    .innerJoin(salonSchema, eq(salonSchema.id, workspaces.salonId))
    .where(and(eq(artifacts.salonId, input.salonId), eq(artifacts.operationId, onboardingCanvaOperationId(input.siteId, input.revisionId))))
    .limit(1);
  return linked ?? null;
}
