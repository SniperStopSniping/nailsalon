/**
 * Staff Notifications API
 *
 * GET /api/staff/notifications - List notifications for current technician
 * PATCH /api/staff/notifications - Mark notification(s) as read
 *
 * SECURITY:
 * - All identity derived from session (never trust client params)
 * - Staff can only see their own notifications
 */

import { eq, and, isNull, desc, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { requireStaffSession } from '@/libs/staffAuth';
import { notificationSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// VALIDATION
// =============================================================================

const markReadSchema = z.union([
  z.object({ markAllRead: z.literal(true) }),
  z.object({ id: z.string().min(1), read: z.literal(true) }),
  z.object({ ids: z.array(z.string().min(1)).min(1) }),
]);

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// =============================================================================
// GET /api/staff/notifications
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    // 1. Require valid staff session
    const auth = await requireStaffSession();
    if (!auth.ok) {
      return auth.response;
    }

    const { salonId, technicianId } = auth.session;

    // 2. Parse query params
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
    const unreadOnly = url.searchParams.get('unreadOnly') === 'true';

    // 3. Build query conditions
    const conditions = [
      eq(notificationSchema.recipientTechnicianId, technicianId),
      eq(notificationSchema.salonId, salonId),
      eq(notificationSchema.recipientRole, 'STAFF'),
    ];

    if (unreadOnly) {
      conditions.push(isNull(notificationSchema.readAt));
    }

    // 4. Fetch notifications
    const notifications = await db
      .select({
        id: notificationSchema.id,
        type: notificationSchema.type,
        title: notificationSchema.title,
        body: notificationSchema.body,
        metadata: notificationSchema.metadata,
        readAt: notificationSchema.readAt,
        createdAt: notificationSchema.createdAt,
      })
      .from(notificationSchema)
      .where(and(...conditions))
      .orderBy(desc(notificationSchema.createdAt))
      .limit(limit);

    // 5. Count unread
    const unreadNotifications = await db
      .select({ id: notificationSchema.id })
      .from(notificationSchema)
      .where(
        and(
          eq(notificationSchema.recipientTechnicianId, technicianId),
          eq(notificationSchema.salonId, salonId),
          eq(notificationSchema.recipientRole, 'STAFF'),
          isNull(notificationSchema.readAt),
        ),
      );

    const unreadCount = unreadNotifications.length;

    return Response.json({
      data: {
        notifications: notifications.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          metadata: n.metadata,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
        unreadCount,
      },
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch notifications',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// PATCH /api/staff/notifications - Mark as read
// =============================================================================

export async function PATCH(request: Request): Promise<Response> {
  try {
    // 1. Require valid staff session
    const auth = await requireStaffSession();
    if (!auth.ok) {
      return auth.response;
    }

    const { salonId, technicianId } = auth.session;

    // 2. Parse and validate body
    const body = await request.json();
    const validated = markReadSchema.safeParse(body);

    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request. Use { markAllRead: true }, { id: "...", read: true }, or { ids: [...] }',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const now = new Date();
    let updatedCount = 0;

    if ('markAllRead' in validated.data && validated.data.markAllRead) {
      // Mark all unread notifications as read
      const result = await db
        .update(notificationSchema)
        .set({ readAt: now })
        .where(
          and(
            eq(notificationSchema.recipientTechnicianId, technicianId),
            eq(notificationSchema.salonId, salonId),
            eq(notificationSchema.recipientRole, 'STAFF'),
            isNull(notificationSchema.readAt),
          ),
        )
        .returning({ id: notificationSchema.id });

      updatedCount = result.length;
    } else if ('id' in validated.data) {
      // Mark single notification as read
      const result = await db
        .update(notificationSchema)
        .set({ readAt: now })
        .where(
          and(
            eq(notificationSchema.id, validated.data.id),
            eq(notificationSchema.recipientTechnicianId, technicianId),
            eq(notificationSchema.salonId, salonId),
          ),
        )
        .returning({ id: notificationSchema.id });

      updatedCount = result.length;
    } else if ('ids' in validated.data) {
      // Mark multiple notifications as read
      const result = await db
        .update(notificationSchema)
        .set({ readAt: now })
        .where(
          and(
            inArray(notificationSchema.id, validated.data.ids),
            eq(notificationSchema.recipientTechnicianId, technicianId),
            eq(notificationSchema.salonId, salonId),
          ),
        )
        .returning({ id: notificationSchema.id });

      updatedCount = result.length;
    }

    return Response.json({
      data: {
        updatedCount,
      },
    });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update notifications',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
