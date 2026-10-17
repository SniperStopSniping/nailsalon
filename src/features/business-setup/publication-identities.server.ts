import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { businessSetupPublicationSchema as publications, businessSetupRevisionSchema as revisions } from '@/models/Schema';

import { SetupError } from './contracts';
import type { SetupTransaction } from './drafts.server';

/** Old approved draft IDs resolve through publication receipts, never a second catalog. */
export async function publishedSetupIdentities(tx: SetupTransaction, salonId: string, temporaryIds: string[], lineage: { workspaceId: string; namespace?: string; legacyRevision: number; restoring?: boolean }) {
  const keys = [...new Set(temporaryIds.filter(id => id.startsWith('draft_')))];
  const rows = keys.length ? await tx.select({ services: publications.serviceIds, staff: publications.staffIds, revision: publications.revision, namespace: sql<string | null>`${revisions.document}->>'identityNamespace'` }).from(publications).innerJoin(revisions, and(eq(revisions.workspaceId, publications.workspaceId), eq(revisions.salonId, publications.salonId), eq(revisions.revision, publications.revision))).where(and(eq(publications.salonId, salonId), eq(publications.workspaceId, lineage.workspaceId), sql`(${publications.serviceIds} ?| ARRAY[${sql.join(keys.map(id => sql`${id}`), sql`, `)}]::text[] OR ${publications.staffIds} ?| ARRAY[${sql.join(keys.map(id => sql`${id}`), sql`, `)}]::text[])`)) : [];
  const matching = rows.filter(row => lineage.namespace ? row.namespace === lineage.namespace : row.revision === lineage.legacyRevision);
  if (lineage.restoring && !lineage.namespace && !matching.length && rows.length) {
    throw new SetupError('INVALID', 'This older draft cannot safely restore its service or team identities. Keep your current business details and restore the website design instead.');
  }
  return (kind: 'services' | 'staff', id: string) => {
    if (!id.startsWith('draft_')) {
      return id;
    }
    const matches = [...new Set(matching.flatMap(row => row[kind]?.[id] ? [row[kind][id]!] : []))];
    if (matches.length > 1) {
      throw new SetupError('INVALID', 'This older draft has conflicting saved identities. Start from your current business details instead.');
    }
    return matches[0] ?? null;
  };
}
