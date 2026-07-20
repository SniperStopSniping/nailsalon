import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { buildAddOnPayload } from '@/libs/addOnPayload';
import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { addOnSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

type ErrorResponse = {
  error: { code: string; message: string; details?: unknown };
};

/**
 * GET /api/salon/add-ons — every add-on for the salon, including inactive
 * ones, so owners can manage and reactivate them (admin-only view).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const validated = querySchema.safeParse(Object.fromEntries(searchParams.entries()));
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

    const { error, salon } = await requireAdminSalon(validated.data.salonSlug);
    if (error || !salon) {
      return error!;
    }

    const addOns = await db
      .select()
      .from(addOnSchema)
      .where(eq(addOnSchema.salonId, salon.id))
      .orderBy(addOnSchema.displayOrder);

    return Response.json({
      data: { addOns: addOns.map(buildAddOnPayload) },
    });
  } catch (error) {
    console.error('Error fetching add-ons:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch add-ons' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
