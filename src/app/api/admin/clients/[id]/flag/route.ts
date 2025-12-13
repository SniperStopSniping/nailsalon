/**
 * Admin Client Flags API
 *
 * Step 16A - Admin-only client flags for problem client management.
 *
 * PUT /api/admin/clients/[id]/flag
 * - Set/clear problem client flag
 * - Block/unblock client from booking
 * - Admin-only access (Clerk auth)
 */

import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { getSalonBySlug } from '@/libs/queries';
import { salonClientSchema, technicianSchema } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

// =============================================================================
// Request Validation
// =============================================================================

const updateFlagsSchema = z.object({
  salonSlug: z.string().min(1),
  // Problem client flag
  isProblemClient: z.boolean().optional(),
  flagReason: z.string().max(500).optional(),
  // Blocking
  isBlocked: z.boolean().optional(),
  blockedReason: z.string().max(500).optional(),
});

// =============================================================================
// PUT /api/admin/clients/[id]/flag
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

    const { id: clientId } = await params;

    // 2. Parse request body
    const body = await request.json();
    const parsed = updateFlagsSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug, isProblemClient, flagReason, isBlocked, blockedReason } = parsed.data;

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

    // 3.5. Step 16.3: Check if clientFlags module is enabled
    const moduleGuard = await guardModuleOr403({ salonId: salon.id, module: 'clientFlags' });
    if (moduleGuard) {
      return moduleGuard;
    }

    // 4. Verify user is admin for this salon
    // Check if user is the salon owner or a technician with admin role
    const isOwner = salon.ownerClerkUserId === userId;

    let isAdmin = isOwner;
    if (!isOwner) {
      // Check if user is a technician with admin role
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
    }

    if (!isAdmin) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Admin access required to manage client flags',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // 5. Get the salon client record
    const [client] = await db
      .select()
      .from(salonClientSchema)
      .where(
        and(
          eq(salonClientSchema.id, clientId),
          eq(salonClientSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!client) {
      return Response.json(
        {
          error: {
            code: 'CLIENT_NOT_FOUND',
            message: 'Client not found in this salon',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 6. Build update data
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // Handle problem client flag
    if (isProblemClient !== undefined) {
      const currentFlags = (client.adminFlags as Record<string, unknown>) ?? {};

      if (isProblemClient) {
        updateData.adminFlags = {
          ...currentFlags,
          isProblemClient: true,
          flagReason: flagReason ?? currentFlags.flagReason,
          flaggedAt: new Date().toISOString(),
          flaggedBy: userId,
        };
      } else {
        // Clear the flag
        updateData.adminFlags = {
          ...currentFlags,
          isProblemClient: false,
          flagReason: null,
          flaggedAt: null,
          flaggedBy: null,
        };
      }
    }

    // Handle blocking
    if (isBlocked !== undefined) {
      updateData.isBlocked = isBlocked;
      updateData.blockedReason = isBlocked ? (blockedReason ?? null) : null;
    }

    // 7. Update the client
    const [updated] = await db
      .update(salonClientSchema)
      .set(updateData)
      .where(eq(salonClientSchema.id, clientId))
      .returning();

    return Response.json({
      data: {
        client: {
          id: updated!.id,
          phone: updated!.phone,
          fullName: updated!.fullName,
          adminFlags: updated!.adminFlags,
          isBlocked: updated!.isBlocked,
          blockedReason: updated!.blockedReason,
          noShowCount: updated!.noShowCount,
          lateCancelCount: updated!.lateCancelCount,
        },
      },
    });
  } catch (error) {
    console.error('Error updating client flags:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update client flags',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/admin/clients/[id]/flag
// Get current flag status for a client
// =============================================================================

export async function GET(
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

    const { id: clientId } = await params;
    const url = new URL(request.url);
    const salonSlug = url.searchParams.get('salonSlug');

    if (!salonSlug) {
      return Response.json(
        {
          error: {
            code: 'MISSING_SALON_SLUG',
            message: 'salonSlug query parameter is required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 2. Resolve salon
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

    // 3. Get the salon client record
    const [client] = await db
      .select({
        id: salonClientSchema.id,
        phone: salonClientSchema.phone,
        fullName: salonClientSchema.fullName,
        adminFlags: salonClientSchema.adminFlags,
        isBlocked: salonClientSchema.isBlocked,
        blockedReason: salonClientSchema.blockedReason,
        noShowCount: salonClientSchema.noShowCount,
        lateCancelCount: salonClientSchema.lateCancelCount,
      })
      .from(salonClientSchema)
      .where(
        and(
          eq(salonClientSchema.id, clientId),
          eq(salonClientSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!client) {
      return Response.json(
        {
          error: {
            code: 'CLIENT_NOT_FOUND',
            message: 'Client not found in this salon',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    return Response.json({
      data: {
        client,
      },
    });
  } catch (error) {
    console.error('Error fetching client flags:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch client flags',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
