import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { requireStaffApiSession } from '@/libs/staffApiGuards';
import {
  SCHEDULE_OVERRIDE_TYPES,
  type ScheduleOverrideType,
  technicianScheduleOverrideSchema,
} from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

// =============================================================================
// HELPERS
// =============================================================================

// Validate HH:mm format
function isValidTimeFormat(time: string): boolean {
  return /^(?:[01]\d|2[0-3]):(?:[0-5]\d)$/.test(time);
}

// Compare times (returns true if start < end)
function isStartBeforeEnd(start: string, end: string): boolean {
  const [startH = 0, startM = 0] = start.split(':').map(Number);
  const [endH = 0, endM = 0] = end.split(':').map(Number);
  return startH * 60 + startM < endH * 60 + endM;
}

// Validate date format YYYY-MM-DD
function isValidDateFormat(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
}

// Get all dates between start and end (inclusive)
function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    if (dateStr) {
      dates.push(dateStr);
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

// =============================================================================
// GET /api/staff/overrides - List upcoming schedule overrides
// =============================================================================
// Returns overrides for the next 60 days by default
// Query params: ?days=60 (optional)
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireStaffApiSession();
    if (!auth.ok) {
      return auth.response;
    }

    const technician = {
      id: auth.session.technicianId,
      name: auth.session.technicianName,
    };
    const salonId = auth.session.salonId;

    // Step 16.3: Check if scheduleOverrides module is enabled
    const moduleGuard = await guardModuleOr403({ salonId, module: 'scheduleOverrides' });
    if (moduleGuard) {
      return moduleGuard;
    }

    // Parse query params
    const url = new URL(request.url);
    const days = Number.parseInt(url.searchParams.get('days') || '60', 10);

    // Calculate date range
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0] ?? '';
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + days);
    const futureDateStr = futureDate.toISOString().split('T')[0] ?? '';

    // Fetch overrides
    const overrides = await db
      .select()
      .from(technicianScheduleOverrideSchema)
      .where(
        and(
          eq(technicianScheduleOverrideSchema.technicianId, technician.id),
          eq(technicianScheduleOverrideSchema.salonId, salonId),
          gte(technicianScheduleOverrideSchema.date, todayStr),
          lte(technicianScheduleOverrideSchema.date, futureDateStr),
        ),
      )
      .orderBy(asc(technicianScheduleOverrideSchema.date));

    return Response.json({
      data: {
        overrides,
        technician: { id: technician.id, name: technician.name },
      },
    });
  } catch (error) {
    console.error('Error fetching schedule overrides:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch schedule overrides',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/staff/overrides - Create schedule override(s)
// =============================================================================
// Body: { startDate, endDate, type, startTime?, endTime?, note? }
// Creates one row per day in the date range (upsert behavior)
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireStaffApiSession();
    if (!auth.ok) {
      return auth.response;
    }

    const technician = {
      id: auth.session.technicianId,
      name: auth.session.technicianName,
    };
    const salonId = auth.session.salonId;

    // Step 16.3: Check if scheduleOverrides module is enabled
    const moduleGuard = await guardModuleOr403({ salonId, module: 'scheduleOverrides' });
    if (moduleGuard) {
      return moduleGuard;
    }

    // Parse body
    const body = await request.json();
    const { startDate, endDate, type, startTime, endTime, note } = body as {
      startDate?: string;
      endDate?: string;
      type?: string;
      startTime?: string;
      endTime?: string;
      note?: string;
    };

    // Validate required fields
    if (!startDate || !endDate || !type) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'startDate, endDate, and type are required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Validate date formats
    if (!isValidDateFormat(startDate) || !isValidDateFormat(endDate)) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Dates must be in YYYY-MM-DD format',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Validate date range
    if (startDate > endDate) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'startDate must be before or equal to endDate',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Validate type
    if (!SCHEDULE_OVERRIDE_TYPES.includes(type as ScheduleOverrideType)) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: `type must be one of: ${SCHEDULE_OVERRIDE_TYPES.join(', ')}`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Validate times for 'hours' type
    if (type === 'hours') {
      if (!startTime || !endTime) {
        return Response.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'startTime and endTime are required when type is "hours"',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }

      if (!isValidTimeFormat(startTime) || !isValidTimeFormat(endTime)) {
        return Response.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Times must be in HH:mm format (e.g., "09:00", "17:30")',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }

      if (!isStartBeforeEnd(startTime, endTime)) {
        return Response.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'startTime must be before endTime',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // Get all dates in range
    const dates = getDateRange(startDate, endDate);

    // Upsert each date (transaction)
    const createdOverrides = await db.transaction(async (tx) => {
      const results = [];

      for (const date of dates) {
        // Check if override exists
        const existing = await tx
          .select()
          .from(technicianScheduleOverrideSchema)
          .where(
            and(
              eq(technicianScheduleOverrideSchema.technicianId, technician.id),
              eq(technicianScheduleOverrideSchema.date, date),
            ),
          )
          .limit(1);

        if (existing.length > 0 && existing[0]) {
          // Update existing
          const [updated] = await tx
            .update(technicianScheduleOverrideSchema)
            .set({
              type: type as ScheduleOverrideType,
              startTime: type === 'hours' ? startTime : null,
              endTime: type === 'hours' ? endTime : null,
              note: note || null,
              updatedAt: new Date(),
            })
            .where(eq(technicianScheduleOverrideSchema.id, existing[0].id))
            .returning();
          results.push(updated);
        } else {
          // Insert new
          const [created] = await tx
            .insert(technicianScheduleOverrideSchema)
            .values({
              id: nanoid(),
              salonId,
              technicianId: technician.id,
              date,
              type: type as ScheduleOverrideType,
              startTime: type === 'hours' ? startTime : null,
              endTime: type === 'hours' ? endTime : null,
              note: note || null,
            })
            .returning();
          results.push(created);
        }
      }

      return results;
    });

    return Response.json({
      data: {
        overrides: createdOverrides,
        count: createdOverrides.length,
      },
    });
  } catch (error) {
    console.error('Error creating schedule overrides:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create schedule overrides',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
