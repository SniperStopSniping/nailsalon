import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { buildAddOnPayload } from '@/libs/addOnPayload';
import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { addOnSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
  });

const updateAddOnSchema = z.object({
  salonSlug: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  priceCents: z.number().int().min(0),
  priceDisplayText: optionalText,
  durationMinutes: z.number().int().min(0).max(240),
  maxQuantity: z.number().int().min(1).max(50).nullable().optional(),
  isActive: z.boolean().default(true),
});

/**
 * PATCH /api/salon/add-ons/[id] — owner edit of an add-on's name, price,
 * duration, quantity cap, and active state. Compatibility links and pricing
 * type stay managed by the template model; historical appointment snapshots
 * are never touched.
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
  const { salonSlug, ...input } = parsed.data;
  const { salon, error } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }
  try {
    const [updated] = await db
      .update(addOnSchema)
      .set({
        name: input.name,
        priceCents: input.priceCents,
        priceDisplayText: input.priceDisplayText,
        durationMinutes: input.durationMinutes,
        // Drizzle skips undefined: an omitted maxQuantity stays unchanged
        // while an explicit null clears the cap.
        maxQuantity: input.maxQuantity,
        isActive: input.isActive,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(addOnSchema.id, context.params.id),
          eq(addOnSchema.salonId, salon.id),
        ),
      )
      .returning();
    if (!updated) {
      return Response.json(
        { error: { code: 'ADD_ON_NOT_FOUND', message: 'Add-on not found' } },
        { status: 404 },
      );
    }
    return Response.json({ data: { addOn: buildAddOnPayload(updated) } });
  } catch (updateError) {
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
