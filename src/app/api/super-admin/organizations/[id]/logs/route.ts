import { desc, eq, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { requireSuperAdmin } from '@/libs/superAdmin';
import { salonSchema, salonAuditLogSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// GET /api/super-admin/organizations/[id]/logs - Get audit logs
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = (page - 1) * limit;

    // Check salon exists
    const [salon] = await db
      .select({ id: salonSchema.id, name: salonSchema.name })
      .from(salonSchema)
      .where(eq(salonSchema.id, id))
      .limit(1);

    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(salonAuditLogSchema)
      .where(eq(salonAuditLogSchema.salonId, id));

    const totalCount = Number(countResult?.count ?? 0);

    // Get logs with pagination
    const logs = await db
      .select()
      .from(salonAuditLogSchema)
      .where(eq(salonAuditLogSchema.salonId, id))
      .orderBy(desc(salonAuditLogSchema.createdAt))
      .limit(limit)
      .offset(offset);

    // Format logs for response
    const formattedLogs = logs.map(log => ({
      id: log.id,
      action: log.action,
      performedBy: log.performedBy,
      performedByEmail: log.performedByEmail,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString(),
    }));

    return Response.json({
      logs: formattedLogs,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: offset + logs.length < totalCount,
      },
      salon: {
        id: salon.id,
        name: salon.name,
      },
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return Response.json(
      { error: 'Failed to fetch audit logs' },
      { status: 500 },
    );
  }
}
