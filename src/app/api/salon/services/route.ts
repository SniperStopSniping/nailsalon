import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import {
  descriptionItemsToLegacyText,
  normalizeDescriptionItems,
} from '@/libs/bookingCatalog';
import { deriveBookingCategory } from '@/libs/bookingCategory';
import { db } from '@/libs/DB';
import { getServicesBySalonId } from '@/libs/queries';
import { getTemplateByKey } from '@/libs/serviceTemplateCatalog';
import {
  ensureServiceAssignments,
  InvalidTechnicianAssignmentError,
} from '@/libs/serviceAssignments';
import {
  BOOKING_CATEGORIES,
  type Service,
  SERVICE_CATEGORIES,
  serviceSchema,
} from '@/models/Schema';
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
  .transform((value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
  });

const createServiceSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  name: z
    .string()
    .trim()
    .min(1, 'Service name is required')
    .max(120, 'Service name is too long'),
  description: optionalTextField,
  descriptionItems: z.array(z.string()).optional().default([]),
  price: z.number().int().min(0, 'Price must be zero or greater'),
  priceDisplayText: optionalTextField,
  durationMinutes: z
    .number()
    .int()
    .min(5, 'Duration must be at least 5 minutes')
    .max(480, 'Duration is too long'),
  preparationBufferMinutes: z
    .number()
    .int()
    .min(0)
    .max(120)
    .optional()
    .default(0),
  cleanupBufferMinutes: z.number().int().min(0).max(120).optional().default(0),
  category: z.enum(SERVICE_CATEGORIES),
  bookingCategory: z.enum(BOOKING_CATEGORIES).optional(),
  featuredOrder: z.number().int().min(1).max(999).nullable().optional(),
  templateKey: z
    .union([
      z.null(),
      z.string().refine(key => Boolean(getTemplateByKey(key)), 'Unknown template key'),
    ])
    .optional(),
  isIntroPrice: z.boolean().optional().default(false),
  introPriceLabel: optionalTextField,
  technicianIds: z.array(z.string().min(1)).optional(),
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
    preparationBufferMinutes: service.preparationBufferMinutes,
    cleanupBufferMinutes: service.cleanupBufferMinutes,
    category: service.category,
    bookingCategory: service.bookingCategory,
    templateKey: service.templateKey ?? null,
    imageUrl: service.imageUrl,
    sortOrder: service.sortOrder,
    featuredOrder: service.featuredOrder ?? null,
    isActive: service.isActive,
    isIntroPrice: service.isIntroPrice ?? false,
    introPriceLabel: service.introPriceLabel ?? null,
    introPriceExpiresAt: service.introPriceExpiresAt
      ? service.introPriceExpiresAt.toISOString()
      : null,
  };
}

function uniqueSlugFromName(name: string): string {
  const base
    = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 72) || 'service';
  return `${base}-${nanoid(6).toLowerCase()}`;
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
    const formattedServices: ServiceResponse[]
      = services.map(buildServicePayload);

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
            message:
              validated.error.issues[0]?.message ?? 'Invalid request body',
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

    const normalizedDescriptionItems = normalizeDescriptionItems(
      data.descriptionItems,
    );

    if (data.templateKey) {
      // The partial unique index allows one templated service per salon even
      // when it is deactivated (and deactivated services are hidden from the
      // admin list), so re-adding the template must revive the existing row
      // instead of failing on the index.
      const [existingTemplated] = await db
        .select()
        .from(serviceSchema)
        .where(
          and(
            eq(serviceSchema.salonId, salon.id),
            eq(serviceSchema.templateKey, data.templateKey),
          ),
        );

      if (existingTemplated?.isActive) {
        return Response.json(
          {
            error: {
              code: 'TEMPLATE_ALREADY_ADDED',
              message: 'This service is already on your menu.',
            },
          } satisfies ErrorResponse,
          { status: 409 },
        );
      }

      if (existingTemplated) {
        const [revivedService] = await db
          .update(serviceSchema)
          .set({
            name: data.name,
            description:
              normalizedDescriptionItems
              && normalizedDescriptionItems.length > 0
                ? descriptionItemsToLegacyText(normalizedDescriptionItems)
                : data.description,
            descriptionItems: normalizedDescriptionItems,
            price: data.price,
            priceDisplayText: data.priceDisplayText,
            durationMinutes: data.durationMinutes,
            preparationBufferMinutes: data.preparationBufferMinutes,
            cleanupBufferMinutes: data.cleanupBufferMinutes,
            category: data.category,
            bookingCategory: data.bookingCategory ?? deriveBookingCategory(data.category),
            featuredOrder: data.featuredOrder ?? null,
            isIntroPrice: data.isIntroPrice,
            introPriceLabel: data.isIntroPrice ? data.introPriceLabel : null,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(serviceSchema.id, existingTemplated.id),
              eq(serviceSchema.salonId, salon.id),
            ),
          )
          .returning();

        if (revivedService) {
          const revivedAssignments = await ensureServiceAssignments(db, {
            salonId: salon.id,
            serviceId: revivedService.id,
            technicianIds: data.technicianIds,
          });

          return Response.json({
            data: {
              service: buildServicePayload(revivedService),
              assignment: revivedAssignments,
            },
          });
        }
      }
    }

    const legacyDescription
      = normalizedDescriptionItems && normalizedDescriptionItems.length > 0
        ? descriptionItemsToLegacyText(normalizedDescriptionItems)
        : data.description;

    const result = await db.transaction(async (tx) => {
      const maxOrderRows = await tx
        .select({
          maxOrder: sql<number>`coalesce(max(${serviceSchema.sortOrder}), 0)`,
        })
        .from(serviceSchema)
        .where(eq(serviceSchema.salonId, salon.id));
      const nextSortOrder = (maxOrderRows[0]?.maxOrder ?? 0) + 1;
      const serviceId = `svc_${nanoid()}`;

      const [createdService] = await tx
        .insert(serviceSchema)
        .values({
          id: serviceId,
          salonId: salon.id,
          name: data.name,
          slug: uniqueSlugFromName(data.name),
          description: legacyDescription,
          descriptionItems: normalizedDescriptionItems,
          price: data.price,
          priceDisplayText: data.priceDisplayText,
          durationMinutes: data.durationMinutes,
          preparationBufferMinutes: data.preparationBufferMinutes,
          cleanupBufferMinutes: data.cleanupBufferMinutes,
          category: data.category,
          bookingCategory: data.bookingCategory ?? deriveBookingCategory(data.category),
          templateKey: data.templateKey ?? null,
          isIntroPrice: data.isIntroPrice,
          introPriceLabel: data.isIntroPrice ? data.introPriceLabel : null,
          sortOrder: nextSortOrder,
          featuredOrder: data.featuredOrder ?? null,
          isActive: true,
        })
        .returning();

      if (!createdService) {
        return null;
      }

      const assignments = await ensureServiceAssignments(tx, {
        salonId: salon.id,
        serviceId,
        technicianIds: data.technicianIds,
      });

      return { service: createdService, assignments };
    });

    const createdService = result?.service;

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

    return Response.json(
      {
        data: {
          service: buildServicePayload(createdService),
          assignment: result.assignments,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Error
      && error.message.includes('service_salon_template_key_idx')
    ) {
      return Response.json(
        {
          error: {
            code: 'TEMPLATE_ALREADY_ADDED',
            message: 'This service is already on your menu.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
    if (error instanceof InvalidTechnicianAssignmentError) {
      return Response.json(
        {
          error: {
            code: 'INVALID_TECHNICIAN_ASSIGNMENT',
            message: 'One or more selected technicians are not active members of this salon.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }
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
