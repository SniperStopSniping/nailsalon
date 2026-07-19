import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { getTemplateByKey } from '@/libs/serviceTemplateCatalog';
import { getSalonTemplateKeys, seedStarterMenuForSalon } from '@/libs/starterMenu';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

const bulkAddSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  templateKeys: z.array(z.string().min(1).max(80)).min(1).max(60),
});

type ErrorResponse = {
  error: { code: string; message: string; details?: unknown };
};

/**
 * GET — template keys already on this salon's menu (services and add-ons),
 * used by the Service Library to render "Added" states.
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

    const ownedTemplateKeys = await getSalonTemplateKeys(db, salon.id);

    return Response.json({ data: { ownedTemplateKeys: [...ownedTemplateKeys] } });
  } catch (error) {
    console.error('Error fetching owned template keys:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load template state' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

/**
 * POST — add catalog templates to the salon menu with their defaults
 * (library bulk-add, single add-on adds, "Restore recommended services").
 * Skip-by-templateKey: templates the salon already has are left untouched and
 * reported back; nothing is ever reactivated or duplicated. The bulk-add UI
 * only offers recommended starters, so acrylic/dip never arrives unrequested.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    const validated = bulkAddSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: validated.error.issues[0]?.message ?? 'Invalid request body',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug, templateKeys } = validated.data;
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    const unknownKeys = templateKeys.filter(key => !getTemplateByKey(key));
    if (unknownKeys.length > 0) {
      return Response.json(
        {
          error: {
            code: 'UNKNOWN_TEMPLATE_KEYS',
            message: 'Unknown template keys.',
            details: { unknownKeys },
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const result = await seedStarterMenuForSalon({
      db,
      salonId: salon.id,
      mode: 'restore',
      templateKeys,
    });

    return Response.json({
      data: {
        createdServiceCount: result.createdServiceIds.length,
        createdAddOnCount: result.createdAddOnIds.length,
        skippedTemplateKeys: result.skippedTemplateKeys,
      },
    });
  } catch (error) {
    console.error('Error bulk-adding templates:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to add services' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
