import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import type { PurgeTx } from '@/libs/salonPurge';
import { countSalonImpact } from '@/libs/salonPurge';
import { requireSuperAdmin } from '@/libs/superAdmin';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// GET /api/super-admin/organizations/[id]/impact - Dry run of a permanent delete
// =============================================================================
// Returns the real row counts a purge would remove, straight from
// SALON_PURGE_PLAN, so the confirmation dialog shows what is actually at stake
// instead of a hardcoded bullet list. Read-only.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }

  try {
    const { id } = await params;

    const [salon] = await db
      .select({ id: salonSchema.id, name: salonSchema.name, slug: salonSchema.slug, deletedAt: salonSchema.deletedAt })
      .from(salonSchema)
      .where(eq(salonSchema.id, id))
      .limit(1);

    if (!salon) {
      return Response.json({ error: 'Salon not found' }, { status: 404 });
    }

    const impact = await countSalonImpact(db as unknown as PurgeTx, id);

    // The salon row itself is always in the plan; it is not interesting to an
    // operator reading "what am I about to destroy".
    const { salon: _salonRow, ...tables } = impact.counts;

    return Response.json({
      salon: {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        deletedAt: salon.deletedAt?.toISOString() ?? null,
      },
      tables,
      totalRows: impact.totalRows,
    });
  } catch (error) {
    console.error('Error computing salon delete impact:', error);
    return Response.json(
      { error: 'Failed to compute deletion impact' },
      { status: 500 },
    );
  }
}
