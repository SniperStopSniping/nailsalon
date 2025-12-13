import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  getSalonClientById,
  normalizePhone,
  updateSalonClient,
} from '@/libs/queries';
import {
  appointmentSchema,
  appointmentServicesSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

const updateSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  fullName: z.string().optional(),
  email: z.string().email().optional().nullable(),
  preferredTechnicianId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
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

// =============================================================================
// GET /api/admin/clients/[id] - Get client profile with appointment history
// =============================================================================
// VISIBILITY: Admin role = full_access (no redaction applied)
// The getEffectiveVisibility(policy, 'admin') returns 'full_access' for admin role.
// All client data is returned without redaction.
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: clientId } = await params;
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = getQuerySchema.safeParse(queryParams);
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

    // Verify user owns this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // Get client (scoped to salon)
    const client = await getSalonClientById(salon.id, clientId);
    if (!client) {
      return Response.json(
        {
          error: {
            code: 'CLIENT_NOT_FOUND',
            message: 'Client not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Get preferred technician details if set
    let preferredTechnician = null;
    if (client.preferredTechnicianId) {
      const [tech] = await db
        .select({
          id: technicianSchema.id,
          name: technicianSchema.name,
          avatarUrl: technicianSchema.avatarUrl,
        })
        .from(technicianSchema)
        .where(eq(technicianSchema.id, client.preferredTechnicianId))
        .limit(1);
      preferredTechnician = tech ?? null;
    }

    // Build phone variants for matching appointments
    const normalizedPhone = normalizePhone(client.phone);
    const phoneVariants = [normalizedPhone, `+1${normalizedPhone}`, client.phone];

    const now = new Date();

    // Get upcoming appointments
    const upcomingAppointments = await db
      .select({
        id: appointmentSchema.id,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
        totalPrice: appointmentSchema.totalPrice,
        technicianId: appointmentSchema.technicianId,
        notes: appointmentSchema.notes,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.clientPhone, phoneVariants),
          gte(appointmentSchema.startTime, now),
          inArray(appointmentSchema.status, ['pending', 'confirmed']),
        ),
      )
      .orderBy(appointmentSchema.startTime)
      .limit(5);

    // Get past appointments (most recent 20)
    const pastAppointments = await db
      .select({
        id: appointmentSchema.id,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
        totalPrice: appointmentSchema.totalPrice,
        technicianId: appointmentSchema.technicianId,
        notes: appointmentSchema.notes,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.clientPhone, phoneVariants),
          lt(appointmentSchema.startTime, now),
        ),
      )
      .orderBy(desc(appointmentSchema.startTime))
      .limit(20);

    // Get technician and service details for all appointments
    const allAppointmentIds = [
      ...upcomingAppointments.map(a => a.id),
      ...pastAppointments.map(a => a.id),
    ];

    const allTechIds = [
      ...upcomingAppointments.map(a => a.technicianId),
      ...pastAppointments.map(a => a.technicianId),
    ].filter((id): id is string => id !== null);

    // Get technicians
    let techMap = new Map<string, { id: string; name: string; avatarUrl: string | null }>();
    if (allTechIds.length > 0) {
      const technicians = await db
        .select({
          id: technicianSchema.id,
          name: technicianSchema.name,
          avatarUrl: technicianSchema.avatarUrl,
        })
        .from(technicianSchema)
        .where(inArray(technicianSchema.id, allTechIds));
      techMap = new Map(technicians.map(t => [t.id, t]));
    }

    // Get services for each appointment
    const appointmentServicesMap = new Map<string, { name: string; price: number }[]>();
    if (allAppointmentIds.length > 0) {
      const services = await db
        .select({
          appointmentId: appointmentServicesSchema.appointmentId,
          serviceName: serviceSchema.name,
          priceAtBooking: appointmentServicesSchema.priceAtBooking,
        })
        .from(appointmentServicesSchema)
        .innerJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
        .where(inArray(appointmentServicesSchema.appointmentId, allAppointmentIds));

      for (const svc of services) {
        const existing = appointmentServicesMap.get(svc.appointmentId) ?? [];
        existing.push({ name: svc.serviceName, price: svc.priceAtBooking });
        appointmentServicesMap.set(svc.appointmentId, existing);
      }
    }

    // Format appointments
    const formatAppointment = (appt: typeof upcomingAppointments[0]) => ({
      id: appt.id,
      startTime: appt.startTime.toISOString(),
      endTime: appt.endTime.toISOString(),
      status: appt.status,
      totalPrice: appt.totalPrice,
      technician: appt.technicianId ? techMap.get(appt.technicianId) ?? null : null,
      services: appointmentServicesMap.get(appt.id) ?? [],
      notes: appt.notes,
    });

    // Calculate average spend
    const averageSpend
      = client.totalVisits && client.totalVisits > 0
        ? Math.round((client.totalSpent ?? 0) / client.totalVisits)
        : 0;

    return Response.json({
      data: {
        client: {
          id: client.id,
          phone: client.phone,
          fullName: client.fullName,
          email: client.email,
          preferredTechnician,
          notes: client.notes,
          lastVisitAt: client.lastVisitAt?.toISOString() ?? null,
          totalVisits: client.totalVisits ?? 0,
          totalSpent: client.totalSpent ?? 0,
          averageSpend,
          noShowCount: client.noShowCount ?? 0,
          loyaltyPoints: client.loyaltyPoints ?? 0,
          createdAt: client.createdAt.toISOString(),
        },
        upcomingAppointments: upcomingAppointments.map(formatAppointment),
        pastAppointments: pastAppointments.map(formatAppointment),
      },
    });
  } catch (error) {
    console.error('Error fetching client:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch client',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// PATCH /api/admin/clients/[id] - Update client profile
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: clientId } = await params;
    const body = await request.json();

    // Validate request body
    const validated = updateSchema.safeParse(body);
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

    const { salonSlug, ...updates } = validated.data;

    // Verify user owns this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // Verify client exists (scoped to salon)
    const existingClient = await getSalonClientById(salon.id, clientId);
    if (!existingClient) {
      return Response.json(
        {
          error: {
            code: 'CLIENT_NOT_FOUND',
            message: 'Client not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Validate technician if provided
    if (updates.preferredTechnicianId) {
      const [tech] = await db
        .select({ id: technicianSchema.id })
        .from(technicianSchema)
        .where(
          and(
            eq(technicianSchema.id, updates.preferredTechnicianId),
            eq(technicianSchema.salonId, salon.id),
          ),
        )
        .limit(1);

      if (!tech) {
        return Response.json(
          {
            error: {
              code: 'INVALID_TECHNICIAN',
              message: 'Technician not found for this salon',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // Update client
    const updatedClient = await updateSalonClient(salon.id, clientId, {
      fullName: updates.fullName,
      email: updates.email,
      preferredTechnicianId: updates.preferredTechnicianId,
      notes: updates.notes,
    });

    if (!updatedClient) {
      return Response.json(
        {
          error: {
            code: 'UPDATE_FAILED',
            message: 'Failed to update client',
          },
        } satisfies ErrorResponse,
        { status: 500 },
      );
    }

    return Response.json({
      data: {
        client: {
          id: updatedClient.id,
          phone: updatedClient.phone,
          fullName: updatedClient.fullName,
          email: updatedClient.email,
          preferredTechnicianId: updatedClient.preferredTechnicianId,
          notes: updatedClient.notes,
          updatedAt: updatedClient.updatedAt.toISOString(),
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating client:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update client',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
