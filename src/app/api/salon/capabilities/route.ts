import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { capabilityWriteSchema, createCapability } from '@/libs/ownerCapabilities.server';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import { capabilitySchema } from '@/models/Schema';
import type { CapabilityResponse } from '@/types/admin';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ salonSlug: z.string().min(1, 'Salon slug is required') });

type ErrorResponse = { error: { code: string; message: string; details?: unknown } };

function buildCapabilityPayload(capability: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
}): CapabilityResponse {
  return {
    id: capability.id,
    slug: capability.slug,
    name: capability.name,
    description: capability.description,
    isActive: capability.isActive,
  };
}

/** GET /api/salon/capabilities — every capability for the salon, including inactive ones. */
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

    const capabilities = await db
      .select()
      .from(capabilitySchema)
      .where(eq(capabilitySchema.salonId, salon.id))
      .orderBy(capabilitySchema.name);

    return Response.json({ data: { capabilities: capabilities.map(buildCapabilityPayload) } });
  } catch (error) {
    console.error('Error fetching capabilities:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch capabilities' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

/** POST /api/salon/capabilities — create a new capability. */
export async function POST(request: Request): Promise<Response> {
  const validated = capabilityWriteSchema.safeParse(await request.json().catch(() => null));
  if (!validated.success) {
    return Response.json(
      { error: { code: 'VALIDATION_ERROR', message: validated.error.issues[0]?.message ?? 'Invalid capability details' } } satisfies ErrorResponse,
      { status: 400 },
    );
  }

  const { salonSlug, ...input } = validated.data;
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  try {
    const created = await createCapability(salon.id, input);
    return Response.json({ data: { capability: buildCapabilityPayload(created) } }, { status: 201 });
  } catch (createError) {
    if (createError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(createError);
    }
    console.error('Capability create failed:', createError instanceof Error ? createError.message : 'unknown');
    return Response.json(
      { error: { code: 'CREATE_FAILED', message: 'The capability could not be created.' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
