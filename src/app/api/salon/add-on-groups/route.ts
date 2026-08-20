import { z } from 'zod';

import { buildAddOnGroupPayload, groupMemberAddOnIds } from '@/libs/addOnGroupPayload';
import { requireAdminSalon } from '@/libs/adminAuth';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import { createAddOnGroup, parseAddOnGroupWrite } from '@/libs/ownerCatalogGroups.server';
import { getAllAddOnGroupsBySalonId, getAllAddOnsBySalonId } from '@/libs/queries';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

type ErrorResponse = {
  error: { code: string; message: string; details?: unknown };
};

/**
 * GET /api/salon/add-on-groups — every add-on group for the salon
 * (including inactive ones), with the member add-on ids each one currently
 * holds, so an owner editor can render membership without a second round
 * trip.
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

    const [groups, addOns] = await Promise.all([
      getAllAddOnGroupsBySalonId(salon.id),
      getAllAddOnsBySalonId(salon.id),
    ]);
    const membersByGroup = groupMemberAddOnIds(addOns);

    return Response.json({
      data: {
        groups: groups.map(group =>
          buildAddOnGroupPayload(group, membersByGroup.get(group.id) ?? [])),
      },
    });
  } catch (error) {
    console.error('Error fetching add-on groups:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch add-on groups' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

/**
 * POST /api/salon/add-on-groups — create a new add-on group. Bounds
 * (`minSelections`/`maxSelections`) are validated by the SAME
 * `addOnGroupBoundsSchema` migration 0073's CHECKs mirror — see
 * `ownerCatalogGroups.server.ts`.
 */
export async function POST(request: Request): Promise<Response> {
  let parsed: ReturnType<typeof parseAddOnGroupWrite>;
  try {
    parsed = parseAddOnGroupWrite(await request.json().catch(() => null));
  } catch (parseError) {
    if (parseError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(parseError);
    }
    throw parseError;
  }

  const { salonSlug, ...input } = parsed;
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  try {
    const created = await createAddOnGroup(salon.id, input);
    return Response.json({ data: { group: buildAddOnGroupPayload(created, []) } }, { status: 201 });
  } catch (createError) {
    if (createError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(createError);
    }
    console.error('Add-on group create failed:', createError instanceof Error ? createError.message : 'unknown');
    return Response.json(
      { error: { code: 'CREATE_FAILED', message: 'The add-on group could not be created.' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
