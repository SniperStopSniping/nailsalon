import { requireAdminSalon } from '@/libs/adminAuth';
import { buildCatalogRuleResponse } from '@/libs/catalogRulePayload';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import { deleteCatalogRule, parseOwnerRuleWrite, updateCatalogRule } from '@/libs/ownerCatalogRules.server';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/salon/catalog-rules/[id] — owner edit of a rule, re-expressed
 * as the SAME owner-intent shape `POST` accepts (never a raw `ruleType`/
 * `params`/`priority`). Re-validated in full — including the auto-add
 * cycle check — inside the write transaction.
 */
export async function PATCH(
  request: Request,
  context: { params: { id: string } },
) {
  let parsed: ReturnType<typeof parseOwnerRuleWrite>;
  try {
    parsed = parseOwnerRuleWrite(await request.json().catch(() => null));
  } catch (parseError) {
    if (parseError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(parseError);
    }
    throw parseError;
  }

  const { salonSlug, ruleWrite } = parsed;
  const { salon, error } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  try {
    const updated = await updateCatalogRule(salon.id, context.params.id, ruleWrite);
    return Response.json({ data: { rule: buildCatalogRuleResponse(updated) } });
  } catch (updateError) {
    if (updateError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(updateError);
    }
    console.error('Catalog rule update failed:', updateError instanceof Error ? updateError.message : 'unknown');
    return Response.json(
      { error: { code: 'UPDATE_FAILED', message: 'The rule could not be saved. Try again.' } },
      { status: 409 },
    );
  }
}

/** DELETE /api/salon/catalog-rules/[id] — removes a rule. Cannot introduce a graph cycle, so no re-validation is needed. */
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
    await deleteCatalogRule(salon.id, context.params.id);
    return Response.json({ data: { deleted: true } });
  } catch (deleteError) {
    if (deleteError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(deleteError);
    }
    console.error('Catalog rule delete failed:', deleteError instanceof Error ? deleteError.message : 'unknown');
    return Response.json(
      { error: { code: 'DELETE_FAILED', message: 'The rule could not be deleted. Try again.' } },
      { status: 409 },
    );
  }
}
