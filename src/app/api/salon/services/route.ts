import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { getServicesBySalonId } from '@/libs/queries';
import type { ServiceResponse } from '@/types/admin';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const querySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
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
// GET /api/salon/services - Get all services for a salon
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = querySchema.safeParse(queryParams);
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

    const { salonSlug } = validated.data;

    // Verify user owns this salon (admin-only endpoint)
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // Get services for the salon
    const services = await getServicesBySalonId(salon.id);

    // Format response using shared type
    const formattedServices: ServiceResponse[] = services.map(service => ({
      id: service.id,
      name: service.name,
      description: service.description,
      price: service.price,
      durationMinutes: service.durationMinutes,
      category: service.category,
      imageUrl: service.imageUrl,
      sortOrder: service.sortOrder,
      isActive: service.isActive,
    }));

    return Response.json({
      data: {
        services: formattedServices,
      },
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch services',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
