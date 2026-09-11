import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { serviceAddOnRowId } from '@/libs/starterMenu';
import { addOnSchema, serviceAddOnSchema, serviceSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

/** A selected add-on that is not owned by this salon. */
class ForeignAddOnError extends Error {}

const putServiceAddOnsSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  /**
   * The complete set of add-ons offered under this service. An explicit []
   * clears them. `addOnIds` is required: this endpoint exists only to write
   * the relationship, so an omitted list is a caller bug, not "leave alone".
   */
  addOnIds: z.array(z.string().min(1)).max(200),
});

/**
 * PUT /api/salon/services/[id]/add-ons — the SERVICE side of the same
 * `service_add_on` relationship that `PATCH /api/salon/add-ons/[id]` edits
 * from the add-on side. One join table, two directions, no duplicate records.
 *
 * Deliberately narrow: it writes join rows and nothing else. The add-on-side
 * editor has to send an add-on's whole row (its zod schema requires `name`,
 * `priceCents` and `durationMinutes`, and coerces an omitted
 * `priceDisplayText` to NULL), so reusing that endpoint to retarget a
 * service's extras would silently rewrite the add-on's own pricing and
 * active state. This one cannot: it never touches `add_on`.
 *
 * Scoped to (salonId, serviceId), so an add-on's bindings to OTHER services
 * are untouched by construction. Rows that survive the edit are left exactly
 * as stored, preserving owner-tuned `display_order`, `selection_mode`,
 * `conditions`, `default_quantity` and `max_quantity_override` — the same
 * guarantee the add-on-side writer makes.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = putServiceAddOnsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid add-on selection',
        },
      },
      { status: 400 },
    );
  }

  const { salonSlug, addOnIds } = parsed.data;
  const { salon, error } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  const serviceId = (await context.params).id;

  try {
    const result = await db.transaction(async (tx) => {
      // The service itself is verified against this salon before anything is
      // written, so a valid session for salon A can never retarget salon B's
      // menu by guessing an id.
      const [service] = await tx
        .select({ id: serviceSchema.id })
        .from(serviceSchema)
        .where(
          and(
            eq(serviceSchema.id, serviceId),
            eq(serviceSchema.salonId, salon.id),
          ),
        )
        .limit(1);
      if (!service) {
        return { found: false, addOnIds: [] as string[] };
      }

      // The foreign key alone would happily accept another salon's add-on,
      // so every incoming id is confirmed to belong to this salon first.
      const requestedIds = [...new Set(addOnIds)];
      const ownedAddOns = requestedIds.length
        ? await tx
          .select({ id: addOnSchema.id, templateKey: addOnSchema.templateKey })
          .from(addOnSchema)
          .where(
            and(
              eq(addOnSchema.salonId, salon.id),
              inArray(addOnSchema.id, requestedIds),
            ),
          )
        : [];
      if (ownedAddOns.length !== requestedIds.length) {
        throw new ForeignAddOnError();
      }

      // Requested order decides display order for NEW rows only; existing
      // rows keep whatever the owner already tuned.
      const orderedOwned = requestedIds.map(
        id => ownedAddOns.find(addOn => addOn.id === id)!,
      );
      const ownedIds = orderedOwned.map(addOn => addOn.id);

      // Drop removed links, then add missing ones — the mirror image of the
      // add-on-side writer, scoped to this ONE service.
      await tx
        .delete(serviceAddOnSchema)
        .where(
          and(
            eq(serviceAddOnSchema.salonId, salon.id),
            eq(serviceAddOnSchema.serviceId, serviceId),
            ownedIds.length
              ? notInArray(serviceAddOnSchema.addOnId, ownedIds)
              : undefined,
          ),
        );

      if (ownedIds.length) {
        await tx
          .insert(serviceAddOnSchema)
          .values(
            orderedOwned.map((addOn, index) => ({
              // Same deterministic id the seeder and the add-on-side writer
              // use, so the two directions can never produce two rows for
              // one (service, add-on) pair.
              id: serviceAddOnRowId(serviceId, addOn.templateKey ?? addOn.id),
              salonId: salon.id,
              serviceId,
              addOnId: addOn.id,
              selectionMode: 'optional' as const,
              displayOrder: index,
            })),
          )
          .onConflictDoNothing();
      }

      const links = await tx
        .select({ addOnId: serviceAddOnSchema.addOnId })
        .from(serviceAddOnSchema)
        .where(
          and(
            eq(serviceAddOnSchema.salonId, salon.id),
            eq(serviceAddOnSchema.serviceId, serviceId),
          ),
        );

      return { found: true, addOnIds: links.map(link => link.addOnId) };
    });

    if (!result.found) {
      return Response.json(
        { error: { code: 'SERVICE_NOT_FOUND', message: 'Service not found' } },
        { status: 404 },
      );
    }

    return Response.json({
      data: { serviceId, addOnIds: result.addOnIds },
    });
  } catch (updateError) {
    if (updateError instanceof ForeignAddOnError) {
      return Response.json(
        {
          error: {
            code: 'INVALID_ADD_ON_SELECTION',
            message: 'One or more selected add-ons do not belong to this salon.',
          },
        },
        { status: 400 },
      );
    }
    console.error(
      'Service add-on assignment failed:',
      updateError instanceof Error ? updateError.message : 'unknown',
    );
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to save add-ons for this service',
        },
      },
      { status: 500 },
    );
  }
}
