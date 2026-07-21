import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';

import { buildAddOnPayload } from '@/libs/addOnPayload';
import { requireAdminSalon } from '@/libs/adminAuth';
import { normalizeDescriptionItems } from '@/libs/bookingCatalog';
import { db } from '@/libs/DB';
import { serviceAddOnRowId } from '@/libs/starterMenu';
import { addOnSchema, serviceAddOnSchema, serviceSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

/** A selected service that is not owned by this salon. */
class ForeignServiceError extends Error {}

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
  });

const updateAddOnSchema = z.object({
  salonSlug: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  descriptionItems: z.array(z.string()).max(20).optional(),
  priceCents: z.number().int().min(0),
  priceDisplayText: optionalText,
  durationMinutes: z.number().int().min(0).max(240),
  maxQuantity: z.number().int().min(1).max(50).nullable().optional(),
  isActive: z.boolean().default(true),
  /**
   * Base services this add-on is offered under. Omitted ⇒ links are left
   * exactly as they are; an explicit [] clears them.
   */
  serviceIds: z.array(z.string().min(1)).max(200).optional(),
});

/**
 * PATCH /api/salon/add-ons/[id] — owner edit of an add-on's name, description,
 * price, duration, quantity cap, compatible services, and active state.
 *
 * Always an UPDATE of the row identified by (id, salonId): there is no insert
 * path for add-ons here, so saving can never produce a second copy. Pricing
 * type stays managed by the template model, and historical appointment
 * snapshots are never touched.
 */
export async function PATCH(
  request: Request,
  context: { params: { id: string } },
) {
  const parsed = updateAddOnSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid add-on details',
        },
      },
      { status: 400 },
    );
  }
  const { salonSlug, serviceIds, ...input } = parsed.data;
  const { salon, error } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  const addOnId = context.params.id;

  try {
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(addOnSchema)
        .set({
          name: input.name,
          // Drizzle skips undefined: an omitted descriptionItems leaves the
          // stored copy alone, while [] clears it.
          descriptionItems: input.descriptionItems
            ? normalizeDescriptionItems(input.descriptionItems)
            : undefined,
          priceCents: input.priceCents,
          priceDisplayText: input.priceDisplayText,
          durationMinutes: input.durationMinutes,
          // The editor always sends a number or an explicit null, so the cap
          // is set or cleared deliberately rather than carried over.
          maxQuantity: input.maxQuantity,
          isActive: input.isActive,
          updatedAt: new Date(),
        })
        .where(
          and(eq(addOnSchema.id, addOnId), eq(addOnSchema.salonId, salon.id)),
        )
        .returning();

      if (!updated) {
        return { addOn: null, compatibleServiceIds: [] as string[] };
      }

      if (serviceIds) {
        // The foreign key alone would happily accept another salon's service,
        // so every incoming id is confirmed to belong to this salon first.
        const requestedIds = [...new Set(serviceIds)];
        const ownedServices = requestedIds.length
          ? await tx
            .select({ id: serviceSchema.id })
            .from(serviceSchema)
            .where(
              and(
                eq(serviceSchema.salonId, salon.id),
                inArray(serviceSchema.id, requestedIds),
              ),
            )
          : [];
        if (ownedServices.length !== requestedIds.length) {
          throw new ForeignServiceError();
        }
        const ownedIds = ownedServices.map(service => service.id);

        // Drop removed links, then add missing ones. Surviving rows are left
        // untouched so owner-tuned display order and quantity overrides are
        // not reset by an unrelated edit.
        await tx
          .delete(serviceAddOnSchema)
          .where(
            and(
              eq(serviceAddOnSchema.salonId, salon.id),
              eq(serviceAddOnSchema.addOnId, addOnId),
              ownedIds.length
                ? notInArray(serviceAddOnSchema.serviceId, ownedIds)
                : undefined,
            ),
          );

        if (ownedIds.length) {
          await tx
            .insert(serviceAddOnSchema)
            .values(
              ownedIds.map((serviceId, index) => ({
                id: serviceAddOnRowId(serviceId, updated.templateKey ?? updated.id),
                salonId: salon.id,
                serviceId,
                addOnId,
                selectionMode: 'optional' as const,
                displayOrder: index,
              })),
            )
            .onConflictDoNothing();
        }
      }

      const links = await tx
        .select({ serviceId: serviceAddOnSchema.serviceId })
        .from(serviceAddOnSchema)
        .where(
          and(
            eq(serviceAddOnSchema.salonId, salon.id),
            eq(serviceAddOnSchema.addOnId, addOnId),
          ),
        );

      return {
        addOn: updated,
        compatibleServiceIds: links.map(link => link.serviceId),
      };
    });

    if (!result.addOn) {
      return Response.json(
        { error: { code: 'ADD_ON_NOT_FOUND', message: 'Add-on not found' } },
        { status: 404 },
      );
    }

    return Response.json({
      data: {
        addOn: buildAddOnPayload(result.addOn, result.compatibleServiceIds),
      },
    });
  } catch (updateError) {
    if (updateError instanceof ForeignServiceError) {
      return Response.json(
        {
          error: {
            code: 'INVALID_SERVICE_SELECTION',
            message: 'One or more selected services do not belong to this salon.',
          },
        },
        { status: 400 },
      );
    }
    console.error(
      'Add-on update failed:',
      updateError instanceof Error ? updateError.message : 'unknown',
    );
    return Response.json(
      {
        error: {
          code: 'UPDATE_FAILED',
          message: 'The add-on could not be saved. Check the name and try again.',
        },
      },
      { status: 409 },
    );
  }
}
