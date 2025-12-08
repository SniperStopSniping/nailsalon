import { eq, and, sql, desc, ilike } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { technicianSchema, appointmentSchema, clientSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getClientsSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  search: z.string().optional(),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// =============================================================================
// GET /api/admin/technicians/[id]/clients - Get clients this tech has served
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    const validated = getClientsSchema.safeParse(queryParams);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug, search, page, limit } = validated.data;

    // Get salon
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'Salon not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Verify technician exists and belongs to salon
    const [technician] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, id),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Build query to get unique clients with their stats
    // Get all completed appointments for this technician grouped by client
    const clientStatsQuery = db
      .select({
        clientPhone: appointmentSchema.clientPhone,
        clientName: appointmentSchema.clientName,
        totalVisits: sql<number>`count(*)`,
        totalSpent: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}), 0)`,
        lastVisit: sql<string>`max(${appointmentSchema.startTime})`,
        firstVisit: sql<string>`min(${appointmentSchema.startTime})`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, id),
          eq(appointmentSchema.status, 'completed'),
        ),
      )
      .groupBy(appointmentSchema.clientPhone, appointmentSchema.clientName);

    // Get all results first for search and pagination
    const allClientStats = await clientStatsQuery;

    // Filter by search if provided
    let filteredClients = allClientStats;
    if (search && search.trim()) {
      const searchLower = search.toLowerCase();
      filteredClients = allClientStats.filter(client => {
        const name = client.clientName?.toLowerCase() ?? '';
        const phone = client.clientPhone?.toLowerCase() ?? '';
        return name.includes(searchLower) || phone.includes(searchLower);
      });
    }

    // Sort by last visit (most recent first)
    filteredClients.sort((a, b) => {
      const dateA = a.lastVisit ? new Date(a.lastVisit).getTime() : 0;
      const dateB = b.lastVisit ? new Date(b.lastVisit).getTime() : 0;
      return dateB - dateA;
    });

    // Pagination
    const total = filteredClients.length;
    const offset = (page - 1) * limit;
    const paginatedClients = filteredClients.slice(offset, offset + limit);

    // Try to get additional client info from client table
    const clientPhones = paginatedClients.map(c => c.clientPhone);
    const clientRecords = clientPhones.length > 0
      ? await db
          .select()
          .from(clientSchema)
          .where(sql`${clientSchema.phone} = ANY(${clientPhones})`)
      : [];

    const clientMap = new Map(clientRecords.map(c => [c.phone, c]));

    // Format response
    const clients = paginatedClients.map(stat => {
      const clientRecord = clientMap.get(stat.clientPhone);
      return {
        clientPhone: stat.clientPhone,
        clientName: stat.clientName || clientRecord?.firstName || 'Unknown',
        totalVisits: Number(stat.totalVisits),
        totalSpent: Number(stat.totalSpent),
        lastVisit: stat.lastVisit,
        firstVisit: stat.firstVisit,
      };
    });

    return Response.json({
      data: {
        technicianId: id,
        technicianName: technician.name,
        clients,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching technician clients:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch technician clients',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
