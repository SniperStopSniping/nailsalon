import { requireAdminSalon } from '@/libs/adminAuth';
import { capabilityWriteSchema, deleteCapability, updateCapability } from '@/libs/ownerCapabilities.server';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import type { CapabilityResponse } from '@/types/admin';

export const dynamic = 'force-dynamic';

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

/** PATCH /api/salon/capabilities/[id] — owner edit of name, description, active state. */
export async function PATCH(
  request: Request,
  context: { params: { id: string } },
) {
  const validated = capabilityWriteSchema.safeParse(await request.json().catch(() => null));
  if (!validated.success) {
    return Response.json(
      { error: { code: 'VALIDATION_ERROR', message: validated.error.issues[0]?.message ?? 'Invalid capability details' } },
      { status: 400 },
    );
  }

  const { salonSlug, ...input } = validated.data;
  const { salon, error } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  try {
    const updated = await updateCapability(salon.id, context.params.id, input);
    return Response.json({ data: { capability: buildCapabilityPayload(updated) } });
  } catch (updateError) {
    if (updateError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(updateError);
    }
    console.error('Capability update failed:', updateError instanceof Error ? updateError.message : 'unknown');
    return Response.json(
      { error: { code: 'UPDATE_FAILED', message: 'The capability could not be saved. Try again.' } },
      { status: 409 },
    );
  }
}

/** DELETE /api/salon/capabilities/[id] — refuses while assigned to a technician or required by a rule. */
export async function DELETE(
  request: Request,
  context: { params: { id: string } },
) {
  const url = new URL(request.url);
  const salonSlug = url.searchParams.get('salonSlug');
  if (!salonSlug) {
    return Response.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Salon slug is required' } },
      { status: 400 },
    );
  }

  const { salon, error } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  try {
    await deleteCapability(salon.id, context.params.id);
    return Response.json({ data: { deleted: true } });
  } catch (deleteError) {
    if (deleteError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(deleteError);
    }
    console.error('Capability delete failed:', deleteError instanceof Error ? deleteError.message : 'unknown');
    return Response.json(
      { error: { code: 'DELETE_FAILED', message: 'The capability could not be deleted. Try again.' } },
      { status: 409 },
    );
  }
}
