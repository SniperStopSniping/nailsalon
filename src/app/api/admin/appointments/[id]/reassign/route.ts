/**
 * Admin Appointment Reassignment API
 *
 * Step 16A - Force reassign technician for an appointment.
 *
 * PUT /api/admin/appointments/[id]/reassign
 * - Reassigns appointment to a different technician
 * - Can override locked appointments (with reason)
 * - Validates new tech availability
 * - Full audit logging
 */

import { auth } from '@clerk/nextjs/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { logAdminOverride, logTechReassignment } from '@/libs/appointmentAudit';
import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import {
  appointmentSchema,
  technicianSchema,
} from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

// Buffer time between appointments (must match booking API)
const BUFFER_MINUTES = 10;

// =============================================================================
// Request Validation
// =============================================================================

const reassignSchema = z.object({
  salonSlug: z.string().min(1),
  technicianId: z.string().min(1),
  reason: z.string().min(1).max(500), // Required for audit trail
  overrideLock: z.boolean().optional(), // Must be true to reassign locked appointments
});

// =============================================================================
// PUT /api/admin/appointments/[id]/reassign
// =============================================================================

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    // 1. Auth check (Clerk)
    const { userId } = await auth();
    if (!userId) {
      return Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    const { id: appointmentId } = await params;

    // 2. Parse request body
    const body = await request.json();
    const parsed = reassignSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data. technicianId and reason are required.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug, technicianId, reason, overrideLock } = parsed.data;

    // 3. Resolve salon
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

    // 4. Verify user is admin for this salon
    const isOwner = salon.ownerClerkUserId === userId;

    let isAdmin = isOwner;
    let adminName = 'Admin';

    if (!isOwner) {
      const [tech] = await db
        .select()
        .from(technicianSchema)
        .where(
          and(
            eq(technicianSchema.salonId, salon.id),
            eq(technicianSchema.userId, userId),
            eq(technicianSchema.isActive, true),
          ),
        )
        .limit(1);

      isAdmin = tech?.role === 'admin' || tech?.role === 'owner';
      if (tech) {
        adminName = tech.name;
      }
    }

    if (!isAdmin) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Admin access required to reassign appointments',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // 5. Get the appointment
    const [appointment] = await db
      .select()
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.id, appointmentId),
          eq(appointmentSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!appointment) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: 'Appointment not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 6. Check if appointment is in a terminal state
    const terminalStates = ['complete', 'cancelled', 'no_show'];
    if (terminalStates.includes(appointment.status)
      || (appointment.canvasState && terminalStates.includes(appointment.canvasState))) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_TERMINAL',
            message: 'Cannot reassign a completed, cancelled, or no-show appointment',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 7. Check if appointment is locked
    if (appointment.lockedAt && !overrideLock) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_LOCKED',
            message: 'Appointment is locked (service in progress). Set overrideLock=true to force reassignment.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 8. Validate new technician exists and belongs to salon
    const [newTech] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, technicianId),
          eq(technicianSchema.salonId, salon.id),
          eq(technicianSchema.isActive, true),
        ),
      )
      .limit(1);

    if (!newTech) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Target technician not found or inactive',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 9. Check for conflicts with new technician's schedule
    const startTime = new Date(appointment.startTime);
    const endTime = new Date(appointment.endTime);

    // Full overlap check
    const techAppointments = await db
      .select({
        id: appointmentSchema.id,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          eq(appointmentSchema.technicianId, technicianId),
          inArray(appointmentSchema.status, ['pending', 'confirmed']),
        ),
      );

    const hasOverlap = techAppointments.some((existing) => {
      if (existing.id === appointmentId) {
        return false;
      }
      const existingStart = new Date(existing.startTime);
      const existingEnd = new Date(existing.endTime);
      const existingEndWithBuffer = new Date(existingEnd.getTime() + BUFFER_MINUTES * 60 * 1000);
      return startTime < existingEndWithBuffer && endTime > existingStart;
    });

    if (hasOverlap) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_UNAVAILABLE',
            message: `${newTech.name} has a conflicting appointment at this time`,
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 10. Get previous technician info for audit
    let previousTechName: string | null = null;
    if (appointment.technicianId) {
      const [prevTech] = await db
        .select({ name: technicianSchema.name })
        .from(technicianSchema)
        .where(eq(technicianSchema.id, appointment.technicianId))
        .limit(1);
      previousTechName = prevTech?.name ?? null;
    }

    // 11. Update the appointment
    const [updated] = await db
      .update(appointmentSchema)
      .set({
        technicianId,
        updatedAt: new Date(),
      })
      .where(eq(appointmentSchema.id, appointmentId))
      .returning();

    // 12. Audit logging
    await logTechReassignment(
      appointmentId,
      salon.id,
      userId,
      'admin',
      appointment.technicianId,
      technicianId,
      reason,
      adminName,
    );

    // Log admin override if appointment was locked
    if (appointment.lockedAt && overrideLock) {
      await logAdminOverride(
        appointmentId,
        salon.id,
        userId,
        adminName,
        'tech_reassignment_override',
        {
          lockedAt: appointment.lockedAt.toISOString(),
          lockedBy: appointment.lockedBy,
          previousTechId: appointment.technicianId,
        },
        { technicianId },
        reason,
      );
    }

    return Response.json({
      data: {
        appointment: {
          id: updated!.id,
          technicianId: updated!.technicianId,
          previousTechnicianId: appointment.technicianId,
          previousTechnicianName: previousTechName,
          newTechnicianName: newTech.name,
          wasLocked: !!appointment.lockedAt,
          reason,
        },
      },
    });
  } catch (error) {
    console.error('Error reassigning appointment:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to reassign appointment',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
