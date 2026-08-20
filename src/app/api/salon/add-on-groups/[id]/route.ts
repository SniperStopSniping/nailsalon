import { buildAddOnGroupPayload, groupMemberAddOnIds } from '@/libs/addOnGroupPayload';
import { requireAdminSalon } from '@/libs/adminAuth';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import { deleteAddOnGroup, parseAddOnGroupWrite, updateAddOnGroup } from '@/libs/ownerCatalogGroups.server';
import { getAllAddOnsBySalonId } from '@/libs/queries';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/salon/add-on-groups/[id] — owner edit of a group's name,
 * description, selection bounds, sort order and active state. Always an
 * UPDATE of the row identified by (id, salonId).
 */
export async function PATCH(
  request: Request,
  context: { params: { id: string } },
) {
  let parsed: ReturnType<typeof parseAddOnGroupWrite>;
  try {
    parsed = parseAddOnGroupWrite(await request.json().catch(() => null));
  } catch (parseError) {
    if (parseError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(parseError);
    }
    throw parseError;
  }

  const { salonSlug, ...input } = parsed;
  const { salon, error } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  try {
    const updated = await updateAddOnGroup(salon.id, context.params.id, input);
    const addOns = await getAllAddOnsBySalonId(salon.id);
    const members = groupMemberAddOnIds(addOns).get(updated.id) ?? [];
    return Response.json({ data: { group: buildAddOnGroupPayload(updated, members) } });
  } catch (updateError) {
    if (updateError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(updateError);
    }
    console.error('Add-on group update failed:', updateError instanceof Error ? updateError.message : 'unknown');
    return Response.json(
      { error: { code: 'UPDATE_FAILED', message: 'The add-on group could not be saved. Try again.' } },
      { status: 409 },
    );
  }
}

/**
 * DELETE /api/salon/add-on-groups/[id] — refuses while the group still has
 * member add-ons (`GROUP_HAS_MEMBERS`); see `ownerCatalogGroups.server.ts`
 * for why un-grouping is never an implicit side effect of deletion.
 */
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
    await deleteAddOnGroup(salon.id, context.params.id);
    return Response.json({ data: { deleted: true } });
  } catch (deleteError) {
    if (deleteError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(deleteError);
    }
    console.error('Add-on group delete failed:', deleteError instanceof Error ? deleteError.message : 'unknown');
    return Response.json(
      { error: { code: 'DELETE_FAILED', message: 'The add-on group could not be deleted. Try again.' } },
      { status: 409 },
    );
  }
}
