import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { getClientInsightsDirectoryPage } from '@/libs/clientInsights.server';
import {
  getSalonClients,
  type ListSalonClientsOptions,
} from '@/libs/queries';
import { CLIENT_INSIGHT_SEGMENT_IDS } from '@/types/clientInsights';
import type { SalonSettings } from '@/types/salonPolicy';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
};

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
  segment: z.enum(CLIENT_INSIGHT_SEGMENT_IDS).optional(),
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
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }

    const { salonSlug, search, sortBy, sortOrder, page, limit, segment } = validated.data;

    // Verify user owns this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      error!.headers.set('Cache-Control', PRIVATE_HEADERS['Cache-Control']);
      return error!;
    }

    const bookingConfig = resolveBookingConfigFromSettings(
      salon.settings as SalonSettings | null | undefined,
    );
    const insightsPage = segment
      ? await getClientInsightsDirectoryPage({
        salonId: salon.id,
        timeZone: bookingConfig.timezone,
        segment,
        search,
        sortBy,
        sortOrder,
        page,
        limit,
      })
      : null;

    const unfilteredOptions: ListSalonClientsOptions = {
      search,
      sortBy,
      sortOrder,
      page,
      limit,
    };
    const directory = insightsPage
      ?? await getSalonClients(salon.id, unfilteredOptions);
    const { clients, total } = directory;

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
        filter: {
          segment: segment ?? null,
          rulesVersion: insightsPage?.rulesVersion ?? null,
          generatedAt: insightsPage?.generatedAt.toISOString() ?? null,
        },
      },
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch clients',
        },
      } satisfies ErrorResponse,
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
