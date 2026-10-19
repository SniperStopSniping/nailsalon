import { asc, isNull } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { salonDeletionStatus } from '@/libs/salonDeletionCleanup.server';
import { requireSuperAdmin } from '@/libs/superAdmin';
import { salonDeletionCleanupSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }
  try {
    const jobs = await db.select().from(salonDeletionCleanupSchema)
      .where(isNull(salonDeletionCleanupSchema.completedAt))
      .orderBy(asc(salonDeletionCleanupSchema.createdAt)).limit(101);
    return Response.json({ jobs: jobs.slice(0, 100).map(row => ({ sourceSalonId: row.sourceSalonId, ...salonDeletionStatus(row) })), truncated: jobs.length > 100 });
  } catch {
    return Response.json({ error: 'Cleanup status unavailable' }, { status: 503 });
  }
}
