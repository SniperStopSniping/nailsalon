import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import {
  descriptionItemsToLegacyText,
  normalizeDescriptionItems,
} from '@/libs/bookingCatalog';
import { db } from '@/libs/DB';
import {
  type Service,
  SERVICE_CATEGORIES,
  serviceSchema,
} from '@/models/Schema';
import type { ServiceResponse } from '@/types/admin';

export const dynamic = 'force-dynamic';

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
  });

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
  isIntroPrice: z.boolean().default(false),
  introPriceLabel: optionalText,
  isActive: z.boolean().default(true),
});

function buildServicePayload(service: Service): ServiceResponse {
  return {
    id: service.id,
    name: service.name,
    slug: service.slug,
    description: service.description,
    descriptionItems: service.descriptionItems,
    price: service.price,
    priceDisplayText: service.priceDisplayText,
    durationMinutes: service.durationMinutes,
    preparationBufferMinutes: service.preparationBufferMinutes,
    cleanupBufferMinutes: service.cleanupBufferMinutes,
    category: service.category,
    imageUrl: service.imageUrl,
    sortOrder: service.sortOrder,
    isActive: service.isActive,
    isIntroPrice: service.isIntroPrice,
    introPriceLabel: service.introPriceLabel,
    introPriceExpiresAt: service.introPriceExpiresAt?.toISOString() || null,
  };
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } },
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
  const { salon, error } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }
  const descriptionItems = normalizeDescriptionItems(input.descriptionItems);
  const description = descriptionItems?.length
    ? descriptionItemsToLegacyText(descriptionItems)
    : input.description;
  try {
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
        isIntroPrice: input.isIntroPrice,
        introPriceLabel: input.isIntroPrice ? input.introPriceLabel : null,
        isActive: input.isActive,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(serviceSchema.id, context.params.id),
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
