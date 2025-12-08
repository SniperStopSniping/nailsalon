import { eq, and, or, ilike, desc, asc, sql, gte, lt, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { nanoid } from 'nanoid';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import {
  technicianSchema,
  appointmentSchema,
  STAFF_ROLES,
  SKILL_LEVELS,
  PAY_TYPES,
  type WeeklySchedule,
} from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const listQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  status: z.enum(['active', 'inactive', 'all']).optional().default('active'),
  currentStatus: z.enum(['available', 'busy', 'break', 'off']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['name', 'revenue', 'appointments', 'displayOrder']).optional().default('displayOrder'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
});

const createTechnicianSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  name: z.string().min(1, 'Name is required'),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  role: z.enum(STAFF_ROLES).optional().default('tech'),
  commissionRate: z.number().min(0).max(1).optional().default(0),
  payType: z.enum(PAY_TYPES).optional().default('commission'),
  skillLevel: z.enum(SKILL_LEVELS).optional().default('standard'),
  languages: z.array(z.string()).optional(),
  bio: z.string().optional().nullable(),
  specialties: z.array(z.string()).optional(),
  acceptingNewClients: z.boolean().optional().default(true),
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
// GET /api/admin/technicians - List technicians with stats
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = listQuerySchema.safeParse(queryParams);
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

    const { salonSlug, status, currentStatus, search, sortBy, sortOrder, page, limit } = validated.data;

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

    // Build base conditions
    const conditions = [eq(technicianSchema.salonId, salon.id)];

    // Filter by active status
    if (status === 'active') {
      conditions.push(eq(technicianSchema.isActive, true));
    } else if (status === 'inactive') {
      conditions.push(eq(technicianSchema.isActive, false));
    }

    // Filter by current status
    if (currentStatus) {
      conditions.push(eq(technicianSchema.currentStatus, currentStatus));
    }

    // Search by name or email
    if (search && search.trim()) {
      conditions.push(
        or(
          ilike(technicianSchema.name, `%${search}%`),
          ilike(technicianSchema.email, `%${search}%`),
        )!,
      );
    }

    // Get total count for pagination
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(technicianSchema)
      .where(and(...conditions));
    const total = Number(countResult[0]?.count ?? 0);

    // Determine sort column
    let orderBy;
    const orderDir = sortOrder === 'desc' ? desc : asc;
    switch (sortBy) {
      case 'name':
        orderBy = orderDir(technicianSchema.name);
        break;
      case 'displayOrder':
      default:
        orderBy = orderDir(technicianSchema.displayOrder);
        break;
    }

    // Get technicians with pagination
    const offset = (page - 1) * limit;
    const technicians = await db
      .select()
      .from(technicianSchema)
      .where(and(...conditions))
      .orderBy(orderBy, asc(technicianSchema.name))
      .limit(limit)
      .offset(offset);

    // Get today's stats for each technician
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get first day of month for monthly stats
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const techIds = technicians.map(t => t.id);
    
    // Get appointments stats
    let todayStats: { technicianId: string; count: number; revenue: number }[] = [];
    let monthStats: { technicianId: string; count: number; revenue: number }[] = [];

    if (techIds.length > 0) {
      // Today's stats
      const todayAppointments = await db
        .select({
          technicianId: appointmentSchema.technicianId,
          count: sql<number>`count(*)`,
          revenue: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}), 0)`,
        })
        .from(appointmentSchema)
        .where(
          and(
            inArray(appointmentSchema.technicianId, techIds),
            gte(appointmentSchema.startTime, today),
            lt(appointmentSchema.startTime, tomorrow),
            inArray(appointmentSchema.status, ['confirmed', 'completed', 'in_progress']),
          ),
        )
        .groupBy(appointmentSchema.technicianId);

      todayStats = todayAppointments.map(a => ({
        technicianId: a.technicianId!,
        count: Number(a.count),
        revenue: Number(a.revenue),
      }));

      // This month's stats
      const monthAppointments = await db
        .select({
          technicianId: appointmentSchema.technicianId,
          count: sql<number>`count(*)`,
          revenue: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}), 0)`,
        })
        .from(appointmentSchema)
        .where(
          and(
            inArray(appointmentSchema.technicianId, techIds),
            gte(appointmentSchema.startTime, monthStart),
            lt(appointmentSchema.startTime, tomorrow),
            eq(appointmentSchema.status, 'completed'),
          ),
        )
        .groupBy(appointmentSchema.technicianId);

      monthStats = monthAppointments.map(a => ({
        technicianId: a.technicianId!,
        count: Number(a.count),
        revenue: Number(a.revenue),
      }));
    }

    // Build stats map
    const todayStatsMap = new Map(todayStats.map(s => [s.technicianId, s]));
    const monthStatsMap = new Map(monthStats.map(s => [s.technicianId, s]));

    // Format response
    const techniciansWithStats = technicians.map(tech => {
      const todayStat = todayStatsMap.get(tech.id);
      const monthStat = monthStatsMap.get(tech.id);

      return {
        id: tech.id,
        name: tech.name,
        email: tech.email,
        phone: tech.phone,
        avatarUrl: tech.avatarUrl,
        bio: tech.bio,
        role: tech.role,
        skillLevel: tech.skillLevel,
        languages: tech.languages,
        specialties: tech.specialties,
        currentStatus: tech.currentStatus,
        isActive: tech.isActive,
        acceptingNewClients: tech.acceptingNewClients,
        rating: tech.rating ? parseFloat(tech.rating) : null,
        reviewCount: tech.reviewCount,
        commissionRate: tech.commissionRate ? parseFloat(tech.commissionRate) : 0,
        displayOrder: tech.displayOrder,
        hiredAt: tech.hiredAt,
        onboardingStatus: tech.onboardingStatus,
        stats: {
          today: {
            appointments: todayStat?.count ?? 0,
            revenue: todayStat?.revenue ?? 0,
          },
          thisMonth: {
            appointments: monthStat?.count ?? 0,
            revenue: monthStat?.revenue ?? 0,
          },
        },
      };
    });

    return Response.json({
      data: {
        technicians: techniciansWithStats,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching technicians:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch technicians',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/admin/technicians - Create a new technician
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const validated = createTechnicianSchema.safeParse(body);

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

    const { salonSlug, ...data } = validated.data;

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

    // Check for duplicate email within the salon (if email provided)
    if (data.email) {
      const existingWithEmail = await db
        .select()
        .from(technicianSchema)
        .where(
          and(
            eq(technicianSchema.salonId, salon.id),
            eq(technicianSchema.email, data.email),
          ),
        )
        .limit(1);

      if (existingWithEmail.length > 0) {
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

    // Get the next display order
    const maxOrderResult = await db
      .select({ maxOrder: sql<number>`coalesce(max(${technicianSchema.displayOrder}), 0)` })
      .from(technicianSchema)
      .where(eq(technicianSchema.salonId, salon.id));
    const nextOrder = (maxOrderResult[0]?.maxOrder ?? 0) + 1;

    // Default schedule (Mon-Fri 9-6)
    const defaultSchedule: WeeklySchedule = data.weeklySchedule || {
      sunday: null,
      monday: { start: '09:00', end: '18:00' },
      tuesday: { start: '09:00', end: '18:00' },
      wednesday: { start: '09:00', end: '18:00' },
      thursday: { start: '09:00', end: '18:00' },
      friday: { start: '09:00', end: '18:00' },
      saturday: null,
    };

    // Create technician
    const techId = `tech_${nanoid()}`;
    const [newTech] = await db
      .insert(technicianSchema)
      .values({
        id: techId,
        salonId: salon.id,
        name: data.name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        bio: data.bio ?? null,
        role: data.role,
        commissionRate: String(data.commissionRate),
        payType: data.payType,
        skillLevel: data.skillLevel,
        languages: data.languages ?? null,
        specialties: data.specialties ?? null,
        acceptingNewClients: data.acceptingNewClients,
        weeklySchedule: defaultSchedule,
        displayOrder: nextOrder,
        currentStatus: 'available',
        isActive: true,
        onboardingStatus: 'pending',
        hiredAt: new Date(),
      })
      .returning();

    return Response.json({
      data: {
        technician: {
          id: newTech!.id,
          name: newTech!.name,
          email: newTech!.email,
          phone: newTech!.phone,
          avatarUrl: newTech!.avatarUrl,
          role: newTech!.role,
          skillLevel: newTech!.skillLevel,
          currentStatus: newTech!.currentStatus,
          isActive: newTech!.isActive,
          acceptingNewClients: newTech!.acceptingNewClients,
          weeklySchedule: newTech!.weeklySchedule,
          displayOrder: newTech!.displayOrder,
          hiredAt: newTech!.hiredAt,
          onboardingStatus: newTech!.onboardingStatus,
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error creating technician:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create technician',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
