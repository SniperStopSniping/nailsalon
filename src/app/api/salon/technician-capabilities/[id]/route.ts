import { requireAdminSalon } from '@/libs/adminAuth';
import { unassignTechnicianCapability } from '@/libs/ownerCapabilities.server';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';

export const dynamic = 'force-dynamic';

/** DELETE /api/salon/technician-capabilities/[id] — unassign a capability from a technician. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
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
    await unassignTechnicianCapability(salon.id, (await context.params).id);
    return Response.json({ data: { deleted: true } });
  } catch (deleteError) {
    if (deleteError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(deleteError);
    }
    console.error('Technician capability unassign failed:', deleteError instanceof Error ? deleteError.message : 'unknown');
    return Response.json(
      { error: { code: 'DELETE_FAILED', message: 'The assignment could not be removed. Try again.' } },
      { status: 409 },
    );
  }
}
