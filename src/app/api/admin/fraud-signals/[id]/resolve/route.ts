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
import { z } from 'zod';

import { requireActiveAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { fraudSignalSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// VALIDATION
// =============================================================================

const resolveBodySchema = z.object({
  note: z.string().max(500).optional().transform(v => v?.trim() || null),
});

// =============================================================================
// PATCH /api/admin/fraud-signals/[id]/resolve
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const signalId = params.id;

    // 1. Resolve active salon and acting admin through the shared guard
    const { salon, admin, error } = await requireActiveAdminSalon();
    if (error || !salon || !admin) {
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
    if (signal.salonId !== salon.id) {
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
        resolvedBy: admin.id,
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
            resolvedBy: current?.resolvedBy ?? admin.id,
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
