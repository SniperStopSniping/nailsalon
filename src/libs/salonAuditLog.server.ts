import 'server-only';

import type { DbTransaction } from '@/libs/auditLog';
import { sanitizeAuditMetadata } from '@/libs/auditLog';
import type { DatabaseSessionHandle } from '@/libs/DB';
import { type NewSalonAuditLog, salonAuditLogSchema } from '@/models/Schema';

/**
 * Either the ambient `db` handle or the transaction handle a
 * `db.transaction(async tx => …)` callback receives — the same pair
 * `src/libs/auditLog.ts` accepts, so a caller inside a transaction writes its
 * evidence atomically with the work it records.
 */
export type SalonAuditLogDatabase = Pick<DatabaseSessionHandle, 'insert'> | DbTransaction;

export type SalonAuditRow = Omit<NewSalonAuditLog, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: Date;
};

/**
 * Write one `salon_audit_log` row.
 *
 * `logAuditEvent` and friends write the OTHER audit table (`audit_log`), which
 * has a different shape and a closed `action` union. The salon audit table is
 * the durable per-salon evidence trail super-admin surfaces read back, and it
 * had no shared writer at all: every caller hand-rolled an id and skipped the
 * metadata sanitiser. This helper is that shared writer.
 *
 * `metadata` always passes through `sanitizeAuditMetadata`, so a key whose
 * name looks like a secret (`token`, `session`, `url`, `link`, …) is redacted
 * even when a caller adds one by accident. This THROWS on failure rather than
 * swallowing it: a caller that wants fire-and-forget can catch.
 */
export async function writeSalonAuditRow(
  database: SalonAuditLogDatabase,
  row: SalonAuditRow,
): Promise<void> {
  await database.insert(salonAuditLogSchema).values({
    ...row,
    id: row.id ?? crypto.randomUUID(),
    metadata: row.metadata
      ? sanitizeAuditMetadata(row.metadata) as NewSalonAuditLog['metadata']
      : row.metadata,
  });
}
