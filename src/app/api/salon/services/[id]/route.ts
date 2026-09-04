import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import {
  descriptionItemsToLegacyText,
  normalizeDescriptionItems,
} from '@/libs/bookingCatalog';
import { deriveBookingCategory } from '@/libs/bookingCategory';
import { db } from '@/libs/DB';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import { buildServicePayload } from '@/libs/servicePayload';
import {
  BOOKING_CATEGORIES,
  SERVICE_CATEGORIES,
  serviceSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
  });

// ---- Luster L1 catalog foundation (dark; migration 0072) ------------------
// The full DB-CHECK vocabulary (`service_confirmation_mode_check`) is
// accepted by the SCHEMA — `'consultation'` is a real, storable value at the
// database layer — but rejected by APPLICATION logic below as
// not-yet-available (deferred to L7). That split is deliberate: a bogus
// string ("consultatio") and a real-but-unshipped value ("consultation")
// are different failures and get different, specific error codes.
const CONFIRMATION_MODE_VALUES = ['instant', 'request_approval', 'consultation'] as const;

const updateServiceSchema = z.object({
  salonSlug: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: optionalText,
  descriptionItems: z.array(z.string()).optional().default([]),
  price: z.number().int().min(0),
  priceDisplayText: optionalText,
  durationMinutes: z.number().int().min(5).max(480),
  preparationBufferMinutes: z.number().int().min(0).max(120).default(0),
  cleanupBufferMinutes: z.number().int().min(0).max(120).default(0),
  category: z.enum(SERVICE_CATEGORIES),
  bookingCategory: z.enum(BOOKING_CATEGORIES).optional(),
  featuredOrder: z.number().int().min(1).max(999).nullable().optional(),
  isIntroPrice: z.boolean().default(false),
  introPriceLabel: optionalText,
  isActive: z.boolean().default(true),
  /**
   * Omitted ⇒ left exactly as stored (never auto-converted off NULL); an
   * explicit `null` clears a previously-set mode back to NULL. Both are
   * legitimate owner actions, distinct from one another only by whether the
   * key was sent at all — Drizzle's `.set()` mirrors that distinction by
   * skipping `undefined` and writing `null`.
   */
  confirmationMode: z.enum(CONFIRMATION_MODE_VALUES).nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = updateServiceSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid service details',
        },
      },
      { status: 400 },
    );
  }
  const { salonSlug, ...input } = parsed.data;
  if (input.confirmationMode === 'consultation') {
    return Response.json(
      {
        error: {
          code: 'CONFIRMATION_MODE_NOT_AVAILABLE',
          message: 'Consultation confirmation mode is not available yet.',
        },
      },
      { status: 400 },
    );
  }
  const { salon, error } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }
  const descriptionItems = normalizeDescriptionItems(input.descriptionItems);
  const description = descriptionItems?.length
    ? descriptionItemsToLegacyText(descriptionItems)
    : input.description;
  try {
    // Luster L1 catalog foundation (dark; migration 0072): a publicly
    // bookable variant needs an active parent — enforced here too (not just
    // in `ownerCatalogFamilies.server.ts`'s attach path) so deactivating a
    // parent through this generic editor cannot silently strand an active
    // child behind an inactive family. A legacy service (no children) never
    // hits this query's WHERE clause producing a match, so this is a no-op
    // for every service that isn't a family parent.
    if (input.isActive === false) {
      const [activeChild] = await db
        .select({ id: serviceSchema.id })
        .from(serviceSchema)
        .where(
          and(
            eq(serviceSchema.salonId, salon.id),
            eq(serviceSchema.parentServiceId, (await context.params).id),
            eq(serviceSchema.isActive, true),
          ),
        )
        .limit(1);
      if (activeChild) {
        return ownerCatalogErrorResponse(new OwnerCatalogConfigError({
          code: 'PARENT_HAS_ACTIVE_CHILDREN',
          message: 'This service has an active variant. Deactivate its variants first, or deactivate the whole family from the variant editor.',
          anchor: { kind: 'service', serviceId: (await context.params).id },
          status: 409,
        }));
      }
    }

    // The same invariant, from the OTHER side of the relationship. Guarding
    // only the parent-deactivation direction left it trivially reachable:
    // deactivate the child, deactivate the now-childless parent, then
    // reactivate the child — three ordinary edits, each individually legal,
    // ending with an active variant stranded under an inactive family. There
    // is no DB CHECK behind this (0072 says nothing about `isActive`), so the
    // application is the only thing enforcing it and it has to hold both ways.
    if (input.isActive === true) {
      const [selfWithParent] = await db
        .select({ parentServiceId: serviceSchema.parentServiceId })
        .from(serviceSchema)
        .where(
          and(
            eq(serviceSchema.id, (await context.params).id),
            eq(serviceSchema.salonId, salon.id),
          ),
        )
        .limit(1);
      if (selfWithParent?.parentServiceId) {
        const [activeParent] = await db
          .select({ id: serviceSchema.id })
          .from(serviceSchema)
          .where(
            and(
              eq(serviceSchema.id, selfWithParent.parentServiceId),
              eq(serviceSchema.salonId, salon.id),
              eq(serviceSchema.isActive, true),
            ),
          )
          .limit(1);
        if (!activeParent) {
          return ownerCatalogErrorResponse(new OwnerCatalogConfigError({
            code: 'PARENT_NOT_ACTIVE',
            message: 'This variant belongs to a service that is currently inactive. Reactivate the main service first, then reactivate this variant.',
            anchor: { kind: 'service', serviceId: (await context.params).id },
            status: 409,
          }));
        }
      }
    }

    const [updated] = await db
      .update(serviceSchema)
      .set({
        name: input.name,
        // Service links remain stable when the display name changes. New service
        // slugs receive a random suffix at creation, preventing tenant collisions.
        description,
        descriptionItems,
        price: input.price,
        priceDisplayText: input.priceDisplayText,
        durationMinutes: input.durationMinutes,
        preparationBufferMinutes: input.preparationBufferMinutes,
        cleanupBufferMinutes: input.cleanupBufferMinutes,
        category: input.category,
        // When a caller (e.g. a pre-update client) changes the category
        // without sending bookingCategory, re-derive it so admin and public
        // categorization stay in sync; unchanged categories keep any custom
        // grouping the owner picked.
        bookingCategory: input.bookingCategory
          ?? sql`CASE WHEN ${serviceSchema.category} <> ${input.category} THEN ${deriveBookingCategory(input.category)}::"booking_category" ELSE ${serviceSchema.bookingCategory} END`,
        // Drizzle skips undefined values, so an omitted featuredOrder stays
        // unchanged while an explicit null clears it.
        featuredOrder: input.featuredOrder,
        isIntroPrice: input.isIntroPrice,
        introPriceLabel: input.isIntroPrice ? input.introPriceLabel : null,
        isActive: input.isActive,
        // Drizzle skips `undefined` (omitted ⇒ unchanged) and writes `null`
        // (explicit clear) — see the schema comment above.
        confirmationMode: input.confirmationMode,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(serviceSchema.id, (await context.params).id),
          eq(serviceSchema.salonId, salon.id),
        ),
      )
      .returning();
    if (!updated) {
      return Response.json(
        { error: { code: 'SERVICE_NOT_FOUND', message: 'Service not found' } },
        { status: 404 },
      );
    }
    return Response.json({ data: { service: buildServicePayload(updated) } });
  } catch (updateError) {
    console.error(
      'Service update failed:',
      updateError instanceof Error ? updateError.message : 'unknown',
    );
    return Response.json(
      {
        error: {
          code: 'UPDATE_FAILED',
          message:
            'The service could not be saved. Check the name and try again.',
        },
      },
      { status: 409 },
    );
  }
}
