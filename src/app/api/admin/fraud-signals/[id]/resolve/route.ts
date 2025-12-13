/**
 * Fraud Signal Resolution API (Owner)
 *
 * PATCH /api/admin/fraud-signals/[id]/resolve
 * Marks a fraud signal as reviewed/resolved.
 * - resolvedBy comes from session (NOT from body)
 * - Idempotent: returns 200 if already resolved
 * - Verifies signal belongs to session's salon
 */

import { and, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { getAdminSession } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { fraudSignalSchema, salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// VALIDATION
// =============================================================================

const resolveBodySchema = z.object({
  note: z.string().max(500).optional().transform(v => v?.trim() || null),
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get the active salon ID from the admin session.
 * Uses __active_salon_slug cookie to determine which salon is selected.
 */
async function getActiveSalonId(): Promise<{
  salonId: string | null;
  adminId: string | null;
  error: Response | null;
}> {
  const admin = await getAdminSession();

  if (!admin) {
    return {
      salonId: null,
      adminId: null,
      error: Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 },
      ),
    };
  }

  // Get active salon from cookie
  const cookieStore = await cookies();
  const activeSalonSlug = cookieStore.get('__active_salon_slug')?.value;

  // Super admins can access any salon if slug is set
  if (admin.isSuperAdmin && activeSalonSlug) {
    const [salon] = await db
      .select({ id: salonSchema.id })
      .from(salonSchema)
      .where(eq(salonSchema.slug, activeSalonSlug))
      .limit(1);

    if (salon) {
      return { salonId: salon.id, adminId: admin.id, error: null };
    }
  }

  // Regular admins: find the matching salon from their memberships
  if (activeSalonSlug) {
    const membership = admin.salons.find(
      s => s.salonSlug?.toLowerCase() === activeSalonSlug.toLowerCase(),
    );
    if (membership) {
      return { salonId: membership.salonId, adminId: admin.id, error: null };
    }
  }

  // Fallback: use first salon in memberships
  if (admin.salons.length > 0) {
    return { salonId: admin.salons[0]!.salonId, adminId: admin.id, error: null };
  }

  return {
    salonId: null,
    adminId: admin.id,
    error: Response.json(
      { error: { code: 'NO_SALON_ACCESS', message: 'No salon access' } },
      { status: 403 },
    ),
  };
}

// =============================================================================
// PATCH /api/admin/fraud-signals/[id]/resolve
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const signalId = params.id;

    // 1. Get active salon and admin ID from session
    const { salonId, adminId, error } = await getActiveSalonId();
    if (error || !salonId || !adminId) {
      return error!;
    }

    // 2. Parse request body
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is OK
    }

    const validated = resolveBodySchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: validated.error.flatten() } },
        { status: 400 },
      );
    }

    // 3. Get the signal and verify ownership
    const [signal] = await db
      .select()
      .from(fraudSignalSchema)
      .where(eq(fraudSignalSchema.id, signalId))
      .limit(1);

    if (!signal) {
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'Fraud signal not found' } },
        { status: 404 },
      );
    }

    // 4. Verify signal belongs to this salon
    if (signal.salonId !== salonId) {
      return Response.json(
        { error: { code: 'FORBIDDEN', message: 'Signal does not belong to your salon' } },
        { status: 403 },
      );
    }

    // 5. IDEMPOTENT: If already resolved, return success with existing data
    if (signal.resolvedAt) {
      return Response.json({
        data: {
          signal: {
            id: signal.id,
            resolvedAt: signal.resolvedAt.toISOString(),
            resolvedBy: signal.resolvedBy,
            resolutionNote: signal.resolutionNote,
          },
          alreadyResolved: true,
        },
      });
    }

    // 6. Resolve the signal
    const now = new Date();
    const [updated] = await db
      .update(fraudSignalSchema)
      .set({
        resolvedAt: now,
        resolvedBy: adminId,
        resolutionNote: validated.data.note,
      })
      .where(
        and(
          eq(fraudSignalSchema.id, signalId),
          isNull(fraudSignalSchema.resolvedAt), // Extra safety: prevent race condition double-resolve
        ),
      )
      .returning();

    // If 0 rows updated (race condition), re-fetch and return idempotent
    if (!updated) {
      const [current] = await db
        .select()
        .from(fraudSignalSchema)
        .where(eq(fraudSignalSchema.id, signalId))
        .limit(1);

      return Response.json({
        data: {
          signal: {
            id: current?.id ?? signalId,
            resolvedAt: current?.resolvedAt?.toISOString() ?? now.toISOString(),
            resolvedBy: current?.resolvedBy ?? adminId,
            resolutionNote: current?.resolutionNote,
          },
          alreadyResolved: true,
        },
      });
    }

    return Response.json({
      data: {
        signal: {
          id: updated.id,
          resolvedAt: updated.resolvedAt?.toISOString(),
          resolvedBy: updated.resolvedBy,
          resolutionNote: updated.resolutionNote,
        },
        alreadyResolved: false,
      },
    });
  } catch (error) {
    console.error('[FraudSignals] Resolve error:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve fraud signal' } },
      { status: 500 },
    );
  }
}
