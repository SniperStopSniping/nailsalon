import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { buildAddOnPayload, groupCompatibleServiceIds } from '@/libs/addOnPayload';
import { requireAdminSalon } from '@/libs/adminAuth';
import { normalizeDescriptionItems } from '@/libs/bookingCatalog';
import { db } from '@/libs/DB';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import { assertAddOnGroupBelongsToSalon } from '@/libs/ownerCatalogGroups.server';
import {
  getAllAddOnsBySalonId,
  getServiceAddOnRulesBySalonId,
} from '@/libs/queries';
import { serviceAddOnRowId } from '@/libs/starterMenu';
import {
  ADD_ON_CATEGORIES,
  ADD_ON_PRICING_TYPES,
  addOnSchema,
  serviceAddOnSchema,
  serviceSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

type ErrorResponse = {
  error: { code: string; message: string; details?: unknown };
};

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform(value => (typeof value === 'string' ? (value.trim() || null) : null));

const createAddOnSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  name: z.string().trim().min(1, 'Add-on name is required').max(120, 'Add-on name is too long'),
  category: z.enum(ADD_ON_CATEGORIES),
  descriptionItems: z.array(z.string()).max(20).optional(),
  priceCents: z.number().int().min(0, 'Price must be zero or greater'),
  priceDisplayText: optionalText,
  durationMinutes: z.number().int().min(0).max(240),
  pricingType: z.enum(ADD_ON_PRICING_TYPES).optional().default('fixed'),
  unitLabel: optionalText,
  maxQuantity: z.number().int().min(1).max(50).nullable().optional(),
  isActive: z.boolean().optional().default(true),
  /** `null`/omitted ⇒ ungrouped, a perfectly valid legacy-compatible state. */
  groupId: z.string().min(1).nullable().optional(),
  /** Base services this add-on is offered under, bound at creation time. */
  serviceIds: z.array(z.string().min(1)).max(200).optional(),
});

function uniqueSlugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72) || 'add-on';
  return `${base}-${nanoid(6).toLowerCase()}`;
}

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

    // getAllAddOnsBySalonId breaks ties on createdAt. display_order is not
    // unique per salon — two seeding runs each start their own counter — so
    // ordering by it alone lets the list reshuffle between loads.
    const [addOns, rules] = await Promise.all([
      getAllAddOnsBySalonId(salon.id),
      getServiceAddOnRulesBySalonId(salon.id),
    ]);
    const serviceIdsByAddOn = groupCompatibleServiceIds(rules);

    return Response.json({
      data: {
        addOns: addOns.map(addOn =>
          buildAddOnPayload(addOn, serviceIdsByAddOn.get(addOn.id) ?? []),
        ),
      },
    });
  } catch (error) {
    console.error('Error fetching add-ons:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch add-ons' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

/**
 * POST /api/salon/add-ons — create a new, owner-authored add-on. This is
 * the FIRST insert path this table has ever had for owner use (previously
 * only template seeding created add-ons). Optionally binds `group_id`
 * (validated same-salon, see `ownerCatalogGroups.server.ts`) and a set of
 * compatible services, transactionally.
 */
export async function POST(request: Request): Promise<Response> {
  const validated = createAddOnSchema.safeParse(await request.json().catch(() => null));
  if (!validated.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: validated.error.issues[0]?.message ?? 'Invalid add-on details',
          details: validated.error.flatten(),
        },
      } satisfies ErrorResponse,
      { status: 400 },
    );
  }

  const { salonSlug, serviceIds, ...data } = validated.data;
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  try {
    if (data.groupId) {
      await assertAddOnGroupBelongsToSalon(salon.id, data.groupId);
    }

    const normalizedDescriptionItems = normalizeDescriptionItems(data.descriptionItems);
    const addOnId = `addon_${nanoid()}`;

    const result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(addOnSchema)
        .values({
          id: addOnId,
          salonId: salon.id,
          name: data.name,
          slug: uniqueSlugFromName(data.name),
          category: data.category,
          descriptionItems: normalizedDescriptionItems,
          priceCents: data.priceCents,
          priceDisplayText: data.priceDisplayText,
          durationMinutes: data.durationMinutes,
          pricingType: data.pricingType,
          unitLabel: data.unitLabel,
          maxQuantity: data.maxQuantity ?? null,
          isActive: data.isActive,
          groupId: data.groupId ?? null,
          displayOrder: 0,
        })
        .returning();

      if (!created) {
        return null;
      }

      let linkedServiceIds: string[] = [];
      const requestedIds = [...new Set(serviceIds ?? [])];
      if (requestedIds.length > 0) {
        const ownedServices = await tx
          .select({ id: serviceSchema.id })
          .from(serviceSchema)
          .where(and(eq(serviceSchema.salonId, salon.id), inArray(serviceSchema.id, requestedIds)));

        if (ownedServices.length !== requestedIds.length) {
          throw new OwnerCatalogConfigError({
            code: 'INVALID_SERVICE_SELECTION',
            message: 'One or more selected services do not belong to this salon.',
            anchor: { kind: 'relationship' },
            status: 400,
          });
        }

        const ownedIds = ownedServices.map(service => service.id);
        await tx
          .insert(serviceAddOnSchema)
          .values(ownedIds.map((serviceId, index) => ({
            id: serviceAddOnRowId(serviceId, addOnId),
            salonId: salon.id,
            serviceId,
            addOnId,
            selectionMode: 'optional' as const,
            displayOrder: index,
          })))
          .onConflictDoNothing();
        linkedServiceIds = ownedIds;
      }

      return { addOn: created, linkedServiceIds };
    });

    if (!result?.addOn) {
      return Response.json(
        { error: { code: 'CREATE_FAILED', message: 'Failed to create add-on' } } satisfies ErrorResponse,
        { status: 500 },
      );
    }

    return Response.json(
      { data: { addOn: buildAddOnPayload(result.addOn, result.linkedServiceIds) } },
      { status: 201 },
    );
  } catch (createError) {
    if (createError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(createError);
    }
    console.error('Error creating add-on:', createError);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to create add-on' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
