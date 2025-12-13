import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import {
  getSalonClients,
  type ListSalonClientsOptions,
} from '@/libs/queries';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const listQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  search: z.string().optional(),
  sortBy: z.enum(['recent', 'visits', 'spent', 'name']).optional().default('recent'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

// =============================================================================
// GET /api/admin/clients - List salon clients with stats
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = listQuerySchema.safeParse(queryParams);
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

    const { salonSlug, search, sortBy, sortOrder, page, limit } = validated.data;

    // Verify user owns this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // Build options for query
    const options: ListSalonClientsOptions = {
      search,
      sortBy,
      sortOrder,
      page,
      limit,
    };

    // Get clients with stats
    const { clients, total } = await getSalonClients(salon.id, options);

    // Format response
    const formattedClients = clients.map(client => ({
      id: client.id,
      phone: client.phone,
      fullName: client.fullName,
      email: client.email,
      preferredTechnician: client.preferredTechnician ?? null,
      lastVisitAt: client.lastVisitAt?.toISOString() ?? null,
      totalVisits: client.totalVisits ?? 0,
      totalSpent: client.totalSpent ?? 0,
      noShowCount: client.noShowCount ?? 0,
      loyaltyPoints: client.loyaltyPoints ?? 0,
      notes: client.notes,
      createdAt: client.createdAt.toISOString(),
    }));

    return Response.json({
      data: {
        clients: formattedClients,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch clients',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
