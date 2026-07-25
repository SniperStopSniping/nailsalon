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

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import {
  ClientLifecycleStabilizationError,
  lockTerminalSalonClientWithHandle,
  resolveTerminalSalonClient,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { salonClientSchema } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

function clientNotFoundResponse(): Response {
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
    const { id: clientId } = await params;

    // 1. Parse request body
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

    // 2. Resolve salon and verify admin auth
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    const adminSession = await getAdminSession();
    if (!adminSession) {
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

    // 3. Respect separate module gates for flagging vs blocking.
    const requiresProblemFlagControl = isProblemClient !== undefined || flagReason !== undefined;
    const requiresBlockingControl = isBlocked !== undefined || blockedReason !== undefined;

    if (requiresProblemFlagControl) {
      const moduleGuard = await guardModuleOr403({ salonId: salon.id, module: 'clientFlags' });
      if (moduleGuard) {
        return moduleGuard;
      }
    }

    if (requiresBlockingControl) {
      const moduleGuard = await guardModuleOr403({ salonId: salon.id, module: 'clientBlocking' });
      if (moduleGuard) {
        return moduleGuard;
      }
    }

    // 4. Resolve and lock the terminal client before reading or mutating flags.
    const updated = await withClientLifecycleTransactionRetry(() =>
      db.transaction(async (tx) => {
        const terminalClient = await lockTerminalSalonClientWithHandle(tx, {
          salonId: salon.id,
          clientId,
        });
        const [client] = await tx
          .select()
          .from(salonClientSchema)
          .where(
            and(
              eq(salonClientSchema.id, terminalClient.id),
              eq(salonClientSchema.salonId, salon.id),
            ),
          )
          .limit(1);

        if (!client) {
          throw new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND');
        }

        // 5. Build update data from the locked terminal profile.
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        };

        if (isProblemClient !== undefined) {
          const currentFlags = (client.adminFlags as Record<string, unknown>) ?? {};

          if (isProblemClient) {
            updateData.adminFlags = {
              ...currentFlags,
              isProblemClient: true,
              flagReason: flagReason ?? currentFlags.flagReason,
              flaggedAt: new Date().toISOString(),
              flaggedBy: adminSession.id,
            };
          } else {
            updateData.adminFlags = {
              ...currentFlags,
              isProblemClient: false,
              flagReason: null,
              flaggedAt: null,
              flaggedBy: null,
            };
          }
        }

        if (isBlocked !== undefined) {
          updateData.isBlocked = isBlocked;
          updateData.blockedReason = isBlocked ? (blockedReason ?? null) : null;
        }

        // 6. Update only the active terminal profile for this salon.
        const [saved] = await tx
          .update(salonClientSchema)
          .set(updateData)
          .where(and(
            eq(salonClientSchema.id, terminalClient.id),
            eq(salonClientSchema.salonId, salon.id),
          ))
          .returning();
        if (!saved) {
          throw new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND');
        }
        return saved;
      }),
    );

    return Response.json({
      data: {
        client: {
          id: updated.id,
          phone: updated.phone,
          fullName: updated.fullName,
          adminFlags: updated.adminFlags,
          isBlocked: updated.isBlocked,
          blockedReason: updated.blockedReason,
          noShowCount: updated.noShowCount,
          lateCancelCount: updated.lateCancelCount,
        },
      },
    });
  } catch (error) {
    if (error instanceof ClientLifecycleStabilizationError) {
      return clientNotFoundResponse();
    }
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

    // 2. Resolve salon and verify admin auth
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // 3. Resolve merged-source IDs without disclosing cross-salon matches.
    const terminalClient = await resolveTerminalSalonClient({
      salonId: salon.id,
      clientId,
    });

    // 4. Get the terminal salon client record.
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
          eq(salonClientSchema.id, terminalClient.id),
          eq(salonClientSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!client) {
      return clientNotFoundResponse();
    }

    return Response.json({
      data: {
        client,
      },
    });
  } catch (error) {
    if (error instanceof ClientLifecycleStabilizationError) {
      return clientNotFoundResponse();
    }
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
