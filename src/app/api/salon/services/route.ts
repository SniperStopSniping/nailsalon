import { nanoid } from 'nanoid';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { descriptionItemsToLegacyText, normalizeDescriptionItems } from '@/libs/bookingCatalog';
import { db } from '@/libs/DB';
import { getServicesBySalonId } from '@/libs/queries';
import { SERVICE_CATEGORIES, serviceSchema, type Service } from '@/models/Schema';
import type { ServiceResponse } from '@/types/admin';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const querySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

const optionalTextField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform(value => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
  });

const createServiceSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  name: z.string().trim().min(1, 'Service name is required').max(120, 'Service name is too long'),
  description: optionalTextField,
  descriptionItems: z.array(z.string()).optional().default([]),
  price: z.number().int().min(0, 'Price must be zero or greater'),
  priceDisplayText: optionalTextField,
  durationMinutes: z.number().int().min(5, 'Duration must be at least 5 minutes').max(480, 'Duration is too long'),
  category: z.enum(SERVICE_CATEGORIES),
  isIntroPrice: z.boolean().optional().default(false),
  introPriceLabel: optionalTextField,
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

function buildServicePayload(service: Service): ServiceResponse {
  return {
    id: service.id,
    name: service.name,
    slug: service.slug ?? null,
    description: service.description,
    descriptionItems: service.descriptionItems ?? null,
    price: service.price,
    priceDisplayText: service.priceDisplayText ?? null,
    durationMinutes: service.durationMinutes,
    category: service.category,
    imageUrl: service.imageUrl,
    sortOrder: service.sortOrder,
    isActive: service.isActive,
    isIntroPrice: service.isIntroPrice ?? false,
    introPriceLabel: service.introPriceLabel ?? null,
    introPriceExpiresAt: service.introPriceExpiresAt
      ? service.introPriceExpiresAt.toISOString()
      : null,
  };
}

function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// =============================================================================
// GET /api/salon/services - Get all services for a salon
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = querySchema.safeParse(queryParams);
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

    // Verify user owns this salon (admin-only endpoint)
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // Get services for the salon
    const services = await getServicesBySalonId(salon.id);

    // Format response using shared type
    const formattedServices: ServiceResponse[] = services.map(buildServicePayload);

    return Response.json({
      data: {
        services: formattedServices,
      },
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch services',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/salon/services - Create a new service for a salon
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const validated = createServiceSchema.safeParse(body);

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

    const { salonSlug, ...data } = validated.data;

    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    const maxOrderRows = await db
      .select({ maxOrder: sql<number>`coalesce(max(${serviceSchema.sortOrder}), 0)` })
      .from(serviceSchema)
      .where(eq(serviceSchema.salonId, salon.id));
    const nextSortOrder = (maxOrderRows[0]?.maxOrder ?? 0) + 1;

    const normalizedDescriptionItems = normalizeDescriptionItems(data.descriptionItems);
    const legacyDescription = normalizedDescriptionItems && normalizedDescriptionItems.length > 0
      ? descriptionItemsToLegacyText(normalizedDescriptionItems)
      : data.description;

    const [createdService] = await db
      .insert(serviceSchema)
      .values({
        id: `svc_${nanoid()}`,
        salonId: salon.id,
        name: data.name,
        slug: slugFromName(data.name),
        description: legacyDescription,
        descriptionItems: normalizedDescriptionItems,
        price: data.price,
        priceDisplayText: data.priceDisplayText,
        durationMinutes: data.durationMinutes,
        category: data.category,
        isIntroPrice: data.isIntroPrice,
        introPriceLabel: data.isIntroPrice ? data.introPriceLabel : null,
        sortOrder: nextSortOrder,
        isActive: true,
      })
      .returning();

    if (!createdService) {
      return Response.json(
        {
          error: {
            code: 'CREATE_FAILED',
            message: 'Failed to create service',
          },
        } satisfies ErrorResponse,
        { status: 500 },
      );
    }

    return Response.json({
      data: {
        service: buildServicePayload(createdService),
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating service:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create service',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
