import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { salonSchema } from '@/models/Schema';
import type { SalonFeatures, SalonVisibilityPolicy } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

const updateSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  visibility: z.object({
    staff: z.object({
      showClientPhone: z.boolean().optional(),
      showClientEmail: z.boolean().optional(),
      showClientFullName: z.boolean().optional(),
      showAppointmentPrice: z.boolean().optional(),
      showClientHistory: z.boolean().optional(),
      showClientNotes: z.boolean().optional(),
      showOtherTechAppointments: z.boolean().optional(),
    }).optional(),
  }),
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
// GET /api/admin/settings/visibility - Get visibility settings
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = getQuerySchema.safeParse(queryParams);
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

    // Verify admin has access to this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // Get current visibility settings
    const visibility = (salon.visibility as SalonVisibilityPolicy) ?? null;

    // Check entitlement for visibility controls
    const features = (salon.features as SalonFeatures) ?? {};
    const entitled = features.visibilityControls ?? false;

    return Response.json({
      data: {
        visibility,
        entitled,
      },
    });
  } catch (error) {
    console.error('Error fetching visibility settings:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch visibility settings',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// PUT /api/admin/settings/visibility - Update visibility settings
// =============================================================================

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await request.json();

    // Validate request body
    const validated = updateSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug, visibility } = validated.data;

    // Verify admin has access to this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // Check entitlement for visibility controls
    const features = (salon.features as SalonFeatures) ?? {};
    const entitled = features.visibilityControls ?? false;

    if (!entitled) {
      return Response.json(
        {
          error: {
            code: 'FEATURE_NOT_ENTITLED',
            message: 'Visibility controls require a premium plan. Contact support to upgrade.',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // Update visibility settings
    const [updated] = await db
      .update(salonSchema)
      .set({
        visibility: visibility as SalonVisibilityPolicy,
      })
      .where(eq(salonSchema.id, salon.id))
      .returning();

    return Response.json({
      data: {
        visibility: (updated?.visibility as SalonVisibilityPolicy) ?? null,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating visibility settings:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update visibility settings',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
