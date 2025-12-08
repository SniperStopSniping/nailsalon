import { eq, and, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import {
  technicianSchema,
  technicianServicesSchema,
  serviceSchema,
} from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

const updateServicesSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  services: z.array(z.object({
    serviceId: z.string().min(1),
    enabled: z.boolean(),
    priority: z.number().int().min(0).optional().default(0),
  })),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// =============================================================================
// GET /api/admin/technicians/[id]/services - Get service capabilities
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    const validated = getQuerySchema.safeParse({ salonSlug });
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

    // Get salon
    const salon = await getSalonBySlug(validated.data.salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'Salon not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Verify technician exists and belongs to salon
    const [technician] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, id),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Get all salon services
    const allServices = await db
      .select()
      .from(serviceSchema)
      .where(
        and(
          eq(serviceSchema.salonId, salon.id),
          eq(serviceSchema.isActive, true),
        ),
      )
      .orderBy(serviceSchema.sortOrder);

    // Get technician's service assignments
    const techServices = await db
      .select()
      .from(technicianServicesSchema)
      .where(eq(technicianServicesSchema.technicianId, id));

    // Build a map of assigned services
    const assignedMap = new Map(
      techServices.map(ts => [ts.serviceId, { enabled: ts.enabled, priority: ts.priority }])
    );

    // Combine all services with assignment status
    const servicesWithCapability = allServices.map(service => {
      const assignment = assignedMap.get(service.id);
      return {
        serviceId: service.id,
        serviceName: service.name,
        serviceCategory: service.category,
        servicePrice: service.price,
        serviceDuration: service.durationMinutes,
        assigned: !!assignment,
        enabled: assignment?.enabled ?? false,
        priority: assignment?.priority ?? 0,
      };
    });

    return Response.json({
      data: {
        technicianId: id,
        technicianName: technician.name,
        services: servicesWithCapability,
      },
    });
  } catch (error) {
    console.error('Error fetching technician services:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch technician services',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// PUT /api/admin/technicians/[id]/services - Update service capabilities
// =============================================================================

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = updateServicesSchema.safeParse(body);

    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug, services } = validated.data;

    // Get salon
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'Salon not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Verify technician exists and belongs to salon
    const [technician] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, id),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Validate that all service IDs belong to this salon
    const serviceIds = services.map(s => s.serviceId);
    if (serviceIds.length > 0) {
      const validServices = await db
        .select({ id: serviceSchema.id })
        .from(serviceSchema)
        .where(
          and(
            inArray(serviceSchema.id, serviceIds),
            eq(serviceSchema.salonId, salon.id),
          ),
        );

      const validIds = new Set(validServices.map(s => s.id));
      const invalidIds = serviceIds.filter(id => !validIds.has(id));

      if (invalidIds.length > 0) {
        return Response.json(
          {
            error: {
              code: 'INVALID_SERVICES',
              message: 'Some service IDs are invalid',
              details: { invalidIds },
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // Delete existing service assignments
    await db
      .delete(technicianServicesSchema)
      .where(eq(technicianServicesSchema.technicianId, id));

    // Insert new service assignments
    if (services.length > 0) {
      await db
        .insert(technicianServicesSchema)
        .values(
          services.map(s => ({
            technicianId: id,
            serviceId: s.serviceId,
            enabled: s.enabled,
            priority: s.priority,
          })),
        );
    }

    // Update technician's updatedAt
    await db
      .update(technicianSchema)
      .set({ updatedAt: new Date() })
      .where(eq(technicianSchema.id, id));

    // Fetch updated assignments
    const updatedServices = await db
      .select()
      .from(technicianServicesSchema)
      .where(eq(technicianServicesSchema.technicianId, id));

    return Response.json({
      data: {
        technicianId: id,
        services: updatedServices.map(s => ({
          serviceId: s.serviceId,
          enabled: s.enabled,
          priority: s.priority,
        })),
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating technician services:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update technician services',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
