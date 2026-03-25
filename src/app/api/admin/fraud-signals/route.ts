/**
 * Fraud Signals List API (Owner)
 *
 * GET /api/admin/fraud-signals
 * Lists unresolved fraud signals for the authenticated salon.
 * salonId is ALWAYS derived from session - query params are IGNORED.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireActiveAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { fraudSignalSchema, salonClientSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// VALIDATION
// =============================================================================

// Helper: treat null/"" as undefined so .default() kicks in
const coerceIntOrUndefined = (v: unknown) => (v == null || v === '' ? undefined : v);

const listQuerySchema = z.object({
  page: z.preprocess(coerceIntOrUndefined, z.coerce.number().int().min(1).default(1)),
  limit: z.preprocess(coerceIntOrUndefined, z.coerce.number().int().min(1).max(100).default(50)),
  includeResolved: z.preprocess(coerceIntOrUndefined, z.enum(['true', 'false']).default('false')),
});

// =============================================================================
// GET /api/admin/fraud-signals
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    // 1. Resolve the active salon through the shared admin guard
    const { salon, error } = await requireActiveAdminSalon();
    if (error || !salon) {
      return error!;
    }

    // 2. Parse query params (only pagination, NOT salonId)
    const { searchParams } = new URL(request.url);
    const validated = listQuerySchema.safeParse({
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
      includeResolved: searchParams.get('includeResolved'),
    });

    if (!validated.success) {
      return Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: validated.error.flatten() } },
        { status: 400 },
      );
    }

    const { page, limit, includeResolved } = validated.data;
    const offset = (page - 1) * limit;

    // 3. Build query conditions
    const conditions = [eq(fraudSignalSchema.salonId, salon.id)];
    if (includeResolved !== 'true') {
      conditions.push(isNull(fraudSignalSchema.resolvedAt));
    }

    // 4. Get signals with client info (JOIN to avoid N+1)
    // Order by (created_at DESC, id DESC) for stable pagination
    const signals = await db
      .select({
        id: fraudSignalSchema.id,
        type: fraudSignalSchema.type,
        severity: fraudSignalSchema.severity,
        reason: fraudSignalSchema.reason,
        metadata: fraudSignalSchema.metadata,
        createdAt: fraudSignalSchema.createdAt,
        resolvedAt: fraudSignalSchema.resolvedAt,
        resolvedBy: fraudSignalSchema.resolvedBy,
        resolutionNote: fraudSignalSchema.resolutionNote,
        appointmentId: fraudSignalSchema.appointmentId,
        // Client info from JOIN
        clientName: salonClientSchema.fullName,
        clientPhone: salonClientSchema.phone,
      })
      .from(fraudSignalSchema)
      .leftJoin(salonClientSchema, eq(fraudSignalSchema.salonClientId, salonClientSchema.id))
      .where(and(...conditions))
      .orderBy(desc(fraudSignalSchema.createdAt), desc(fraudSignalSchema.id))
      .limit(limit)
      .offset(offset);

    // 5. Get total count for pagination
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(fraudSignalSchema)
      .where(and(...conditions));

    const total = countResult?.count ?? 0;
    const totalPages = Math.ceil(total / limit);

    // 6. Get unresolved count (always useful for badge)
    const [unresolvedResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(fraudSignalSchema)
      .where(
        and(
          eq(fraudSignalSchema.salonId, salon.id),
          isNull(fraudSignalSchema.resolvedAt),
        ),
      );

    const unresolvedCount = unresolvedResult?.count ?? 0;

    return Response.json({
      data: {
        signals: signals.map(s => ({
          id: s.id,
          type: s.type,
          severity: s.severity,
          reason: s.reason,
          metadata: s.metadata,
          createdAt: s.createdAt?.toISOString(),
          resolvedAt: s.resolvedAt?.toISOString() ?? null,
          resolvedBy: s.resolvedBy,
          resolutionNote: s.resolutionNote,
          appointmentId: s.appointmentId,
          client: {
            name: s.clientName ?? 'Unknown',
            phone: s.clientPhone ?? '',
          },
        })),
        unresolvedCount,
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error('[FraudSignals] List error:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to list fraud signals' } },
      { status: 500 },
    );
  }
}
