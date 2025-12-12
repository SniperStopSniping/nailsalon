import { eq, and, sql, gte, lt, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import {
  technicianSchema,
  technicianServicesSchema,
  appointmentSchema,
  technicianTimeOffSchema,
  STAFF_ROLES,
  SKILL_LEVELS,
  PAY_TYPES,
  ONBOARDING_STATUSES,
  STAFF_STATUSES,
} from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

const updateTechnicianSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  role: z.enum(STAFF_ROLES).optional(),
  commissionRate: z.number().min(0).max(1).optional(),
  payType: z.enum(PAY_TYPES).optional(),
  hourlyRate: z.number().min(0).nullable().optional(),
  salaryAmount: z.number().min(0).nullable().optional(),
  skillLevel: z.enum(SKILL_LEVELS).optional(),
  languages: z.array(z.string()).nullable().optional(),
  specialties: z.array(z.string()).nullable().optional(),
  acceptingNewClients: z.boolean().optional(),
  currentStatus: z.enum(STAFF_STATUSES).optional(),
  notes: z.string().nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
  onboardingStatus: z.enum(ONBOARDING_STATUSES).optional(),
  isActive: z.boolean().optional(),
  // Link to Clerk user account for Tech Dashboard login
  userId: z.string().nullable().optional(),
  weeklySchedule: z.object({
    sunday: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
    monday: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
    tuesday: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
    wednesday: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
    thursday: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
    friday: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
    saturday: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
  }).optional(),
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
// GET /api/admin/technicians/[id] - Get full technician detail
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

    // Get technician (including inactive for admin view)
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

    // Get service capabilities
    const services = await db
      .select()
      .from(technicianServicesSchema)
      .where(eq(technicianServicesSchema.technicianId, id));

    // Get upcoming time off (defensive - handle missing table gracefully)
    const now = new Date();
    let timeOff: { id: string; startDate: Date; endDate: Date; reason: string | null; notes: string | null }[] = [];
    try {
      timeOff = await db
        .select()
        .from(technicianTimeOffSchema)
        .where(
          and(
            eq(technicianTimeOffSchema.technicianId, id),
            gte(technicianTimeOffSchema.endDate, now),
          ),
        );
    } catch (timeOffError) {
      // Table might not exist yet - continue without time off data
      console.warn('Time off query failed (table may not exist):', timeOffError);
    }

    // Calculate stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Today stats
    const todayAppts = await db
      .select({
        count: sql<number>`count(*)`,
        revenue: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}), 0)`,
        completed: sql<number>`count(*) filter (where ${appointmentSchema.status} = 'completed')`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, id),
          gte(appointmentSchema.startTime, today),
          lt(appointmentSchema.startTime, tomorrow),
          inArray(appointmentSchema.status, ['confirmed', 'completed', 'in_progress']),
        ),
      );

    // This week stats
    const weekAppts = await db
      .select({
        count: sql<number>`count(*)`,
        revenue: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}), 0)`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, id),
          gte(appointmentSchema.startTime, weekStart),
          lt(appointmentSchema.startTime, tomorrow),
          eq(appointmentSchema.status, 'completed'),
        ),
      );

    // This month stats
    const monthAppts = await db
      .select({
        count: sql<number>`count(*)`,
        revenue: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}), 0)`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, id),
          gte(appointmentSchema.startTime, monthStart),
          lt(appointmentSchema.startTime, tomorrow),
          eq(appointmentSchema.status, 'completed'),
        ),
      );

    // Count unique clients
    const clientsCount = await db
      .select({
        count: sql<number>`count(distinct ${appointmentSchema.clientPhone})`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, id),
          eq(appointmentSchema.status, 'completed'),
        ),
      );

    // ==========================================================================
    // PERFORMANCE METRICS
    // ==========================================================================

    // Get all-time appointment counts by status for this technician
    const allTimeStats = await db
      .select({
        completed: sql<number>`count(*) filter (where ${appointmentSchema.status} = 'completed')`,
        noShow: sql<number>`count(*) filter (where ${appointmentSchema.status} = 'no_show')`,
        cancelled: sql<number>`count(*) filter (where ${appointmentSchema.status} = 'cancelled')`,
        totalBooked: sql<number>`count(*) filter (where ${appointmentSchema.status} in ('completed', 'no_show', 'cancelled'))`,
        totalRevenue: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}) filter (where ${appointmentSchema.status} = 'completed'), 0)`,
      })
      .from(appointmentSchema)
      .where(eq(appointmentSchema.technicianId, id));

    const completedCount = Number(allTimeStats[0]?.completed ?? 0);
    const noShowCount = Number(allTimeStats[0]?.noShow ?? 0);
    const cancelledCount = Number(allTimeStats[0]?.cancelled ?? 0);
    const totalBooked = Number(allTimeStats[0]?.totalBooked ?? 0);
    const totalRevenueAllTime = Number(allTimeStats[0]?.totalRevenue ?? 0);

    // Calculate rates (0-1 decimals, avoid divide by zero)
    const noShowRate = totalBooked > 0 ? noShowCount / totalBooked : 0;
    const cancelRate = totalBooked > 0 ? cancelledCount / totalBooked : 0;
    const avgTicket = completedCount > 0 ? totalRevenueAllTime / completedCount : 0;

    // Rebooking rate: clients who had at least 2 appointments within 60 days of each other
    // First, get all unique clients with their appointment dates
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const rebookingStats = await db
      .select({
        totalClients: sql<number>`count(distinct ${appointmentSchema.clientPhone})`,
        rebookedClients: sql<number>`
          count(distinct case 
            when exists (
              select 1 from ${appointmentSchema} a2 
              where a2.client_phone = ${appointmentSchema}.client_phone 
              and a2.technician_id = ${appointmentSchema}.technician_id
              and a2.status = 'completed'
              and a2.id != ${appointmentSchema}.id
              and a2.start_time > ${appointmentSchema}.start_time
              and a2.start_time <= ${appointmentSchema}.start_time + interval '60 days'
            ) then ${appointmentSchema}.client_phone 
          end)
        `,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, id),
          eq(appointmentSchema.status, 'completed'),
        ),
      );

    const totalUniqueClients = Number(rebookingStats[0]?.totalClients ?? 0);
    const rebookedClients = Number(rebookingStats[0]?.rebookedClients ?? 0);
    const rebookingRate = totalUniqueClients > 0 ? rebookedClients / totalUniqueClients : 0;

    // Calculate earnings
    const commissionRate = technician.commissionRate ? parseFloat(technician.commissionRate) : 0;
    const todayRevenue = Number(todayAppts[0]?.revenue ?? 0);
    const weekRevenue = Number(weekAppts[0]?.revenue ?? 0);
    const monthRevenue = Number(monthAppts[0]?.revenue ?? 0);

    return Response.json({
      data: {
        technician: {
          id: technician.id,
          name: technician.name,
          email: technician.email,
          phone: technician.phone,
          avatarUrl: technician.avatarUrl,
          bio: technician.bio,
          role: technician.role,
          skillLevel: technician.skillLevel,
          languages: technician.languages,
          specialties: technician.specialties,
          currentStatus: technician.currentStatus,
          isActive: technician.isActive,
          acceptingNewClients: technician.acceptingNewClients,
          rating: technician.rating ? parseFloat(technician.rating) : null,
          reviewCount: technician.reviewCount,
          commissionRate,
          payType: technician.payType,
          hourlyRate: technician.hourlyRate ? parseFloat(technician.hourlyRate) : null,
          salaryAmount: technician.salaryAmount ? parseFloat(technician.salaryAmount) : null,
          displayOrder: technician.displayOrder,
          notes: technician.notes,
          userId: technician.userId,
          hiredAt: technician.hiredAt,
          terminatedAt: technician.terminatedAt,
          returnDate: technician.returnDate,
          onboardingStatus: technician.onboardingStatus,
          weeklySchedule: technician.weeklySchedule,
          createdAt: technician.createdAt,
          updatedAt: technician.updatedAt,
        },
        services: services.map(s => ({
          serviceId: s.serviceId,
          enabled: s.enabled,
          priority: s.priority,
        })),
        timeOff: timeOff.map(t => ({
          id: t.id,
          startDate: t.startDate,
          endDate: t.endDate,
          reason: t.reason,
          notes: t.notes,
        })),
        stats: {
          today: {
            appointments: Number(todayAppts[0]?.count ?? 0),
            completed: Number(todayAppts[0]?.completed ?? 0),
            revenue: todayRevenue,
            techEarned: Math.round(todayRevenue * commissionRate),
            salonEarned: Math.round(todayRevenue * (1 - commissionRate)),
          },
          thisWeek: {
            appointments: Number(weekAppts[0]?.count ?? 0),
            revenue: weekRevenue,
            techEarned: Math.round(weekRevenue * commissionRate),
            salonEarned: Math.round(weekRevenue * (1 - commissionRate)),
          },
          thisMonth: {
            appointments: Number(monthAppts[0]?.count ?? 0),
            revenue: monthRevenue,
            techEarned: Math.round(monthRevenue * commissionRate),
            salonEarned: Math.round(monthRevenue * (1 - commissionRate)),
          },
          totalClients: Number(clientsCount[0]?.count ?? 0),
          // Performance metrics (all rates are 0-1 decimals)
          performance: {
            rebookingRate,  // clients who rebooked within 60 days / total unique clients
            avgTicket,      // totalRevenue / completedAppointments (in cents)
            noShowRate,     // no_show count / total booked
            cancelRate,     // cancelled count / total booked
          },
        },
      },
    });
  } catch (error) {
    console.error('Error fetching technician:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch technician',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// PUT /api/admin/technicians/[id] - Update technician (partial updates allowed)
// =============================================================================

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = updateTechnicianSchema.safeParse(body);

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
    const [existing] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, id),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!existing) {
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

    // Check for duplicate email (if email is being updated)
    if (updates.email && updates.email !== existing.email) {
      const existingWithEmail = await db
        .select()
        .from(technicianSchema)
        .where(
          and(
            eq(technicianSchema.salonId, salon.id),
            eq(technicianSchema.email, updates.email),
          ),
        )
        .limit(1);

      if (existingWithEmail.length > 0 && existingWithEmail[0]!.id !== id) {
        return Response.json(
          {
            error: {
              code: 'DUPLICATE_EMAIL',
              message: 'A staff member with this email already exists',
            },
          } satisfies ErrorResponse,
          { status: 409 },
        );
      }
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.bio !== undefined) updateData.bio = updates.bio;
    if (updates.avatarUrl !== undefined) updateData.avatarUrl = updates.avatarUrl;
    if (updates.role !== undefined) updateData.role = updates.role;
    if (updates.commissionRate !== undefined) updateData.commissionRate = String(updates.commissionRate);
    if (updates.payType !== undefined) updateData.payType = updates.payType;
    if (updates.hourlyRate !== undefined) updateData.hourlyRate = updates.hourlyRate !== null ? String(updates.hourlyRate) : null;
    if (updates.salaryAmount !== undefined) updateData.salaryAmount = updates.salaryAmount !== null ? String(updates.salaryAmount) : null;
    if (updates.skillLevel !== undefined) updateData.skillLevel = updates.skillLevel;
    if (updates.languages !== undefined) updateData.languages = updates.languages;
    if (updates.specialties !== undefined) updateData.specialties = updates.specialties;
    if (updates.acceptingNewClients !== undefined) updateData.acceptingNewClients = updates.acceptingNewClients;
    if (updates.currentStatus !== undefined) updateData.currentStatus = updates.currentStatus;
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.displayOrder !== undefined) updateData.displayOrder = updates.displayOrder;
    if (updates.onboardingStatus !== undefined) updateData.onboardingStatus = updates.onboardingStatus;
    if (updates.weeklySchedule !== undefined) updateData.weeklySchedule = updates.weeklySchedule;
    if (updates.userId !== undefined) updateData.userId = updates.userId;

    // Handle isActive changes (soft delete/restore)
    if (updates.isActive !== undefined) {
      updateData.isActive = updates.isActive;
      if (!updates.isActive && existing.isActive) {
        // Being deactivated
        updateData.terminatedAt = new Date();
      } else if (updates.isActive && !existing.isActive) {
        // Being reactivated
        updateData.terminatedAt = null;
        updateData.returnDate = null;
      }
    }

    const [updated] = await db
      .update(technicianSchema)
      .set(updateData)
      .where(eq(technicianSchema.id, id))
      .returning();

    return Response.json({
      data: {
        technician: {
          id: updated!.id,
          name: updated!.name,
          email: updated!.email,
          phone: updated!.phone,
          avatarUrl: updated!.avatarUrl,
          bio: updated!.bio,
          role: updated!.role,
          skillLevel: updated!.skillLevel,
          currentStatus: updated!.currentStatus,
          isActive: updated!.isActive,
          acceptingNewClients: updated!.acceptingNewClients,
          commissionRate: updated!.commissionRate ? parseFloat(updated!.commissionRate) : 0,
          displayOrder: updated!.displayOrder,
          notes: updated!.notes,
          onboardingStatus: updated!.onboardingStatus,
          weeklySchedule: updated!.weeklySchedule,
          updatedAt: updated!.updatedAt,
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating technician:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update technician',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE /api/admin/technicians/[id] - Delete technician (soft or hard)
// =============================================================================

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');
    const hard = searchParams.get('hard') === 'true';

    if (!salonSlug) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'salonSlug is required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

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
    const [existing] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, id),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!existing) {
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

    if (hard) {
      // Hard delete - remove from DB
      // First delete related records
      await db
        .delete(technicianServicesSchema)
        .where(eq(technicianServicesSchema.technicianId, id));

      await db
        .delete(technicianTimeOffSchema)
        .where(eq(technicianTimeOffSchema.technicianId, id));

      // Delete the technician
      await db
        .delete(technicianSchema)
        .where(eq(technicianSchema.id, id));

      return Response.json({
        data: {
          deleted: true,
          hard: true,
          technicianId: id,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      // Soft delete - set isActive to false
      const [updated] = await db
        .update(technicianSchema)
        .set({
          isActive: false,
          terminatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(technicianSchema.id, id))
        .returning();

      return Response.json({
        data: {
          deleted: true,
          hard: false,
          technician: {
            id: updated!.id,
            name: updated!.name,
            isActive: updated!.isActive,
            terminatedAt: updated!.terminatedAt,
          },
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('Error deleting technician:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete technician',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
