import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { assignTechnicianCapability, technicianCapabilityWriteSchema } from '@/libs/ownerCapabilities.server';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import { technicianCapabilitySchema } from '@/models/Schema';
import type { TechnicianCapabilityResponse } from '@/types/admin';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ salonSlug: z.string().min(1, 'Salon slug is required') });

type ErrorResponse = { error: { code: string; message: string; details?: unknown } };

function buildAssignmentPayload(row: { id: string; technicianId: string; capabilityId: string }): TechnicianCapabilityResponse {
  return { id: row.id, technicianId: row.technicianId, capabilityId: row.capabilityId };
}

/** GET /api/salon/technician-capabilities — every assignment row for the salon. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const validated = querySchema.safeParse(Object.fromEntries(searchParams.entries()));
    if (!validated.success) {
      return Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: validated.error.flatten() } } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { error, salon } = await requireAdminSalon(validated.data.salonSlug);
    if (error || !salon) {
      return error!;
    }

    const assignments = await db
      .select()
      .from(technicianCapabilitySchema)
      .where(eq(technicianCapabilitySchema.salonId, salon.id));

    return Response.json({ data: { assignments: assignments.map(buildAssignmentPayload) } });
  } catch (error) {
    console.error('Error fetching technician capabilities:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch technician capabilities' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

/**
 * POST /api/salon/technician-capabilities — assign a capability to a
 * technician. Both must belong to the calling salon (validated in
 * `assignTechnicianCapability`, `ownerCapabilities.server.ts`).
 */
export async function POST(request: Request): Promise<Response> {
  const validated = technicianCapabilityWriteSchema.safeParse(await request.json().catch(() => null));
  if (!validated.success) {
    return Response.json(
      { error: { code: 'VALIDATION_ERROR', message: validated.error.issues[0]?.message ?? 'Invalid assignment details' } } satisfies ErrorResponse,
      { status: 400 },
    );
  }

  const { salonSlug, ...input } = validated.data;
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  try {
    const created = await assignTechnicianCapability(salon.id, input);
    return Response.json({ data: { assignment: buildAssignmentPayload(created) } }, { status: 201 });
  } catch (createError) {
    if (createError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(createError);
    }
    console.error('Technician capability assignment failed:', createError instanceof Error ? createError.message : 'unknown');
    return Response.json(
      { error: { code: 'CREATE_FAILED', message: 'The assignment could not be created.' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
