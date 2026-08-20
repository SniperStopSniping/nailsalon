import { requireAdminSalon } from '@/libs/adminAuth';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import { parseServiceFamilyRequest, planServiceFamilyOperation } from '@/libs/ownerCatalogFamilies.server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/salon/service-families/inspect — "what would happen" for the
 * IDENTICAL attach/detach request `POST /api/salon/service-families`
 * accepts, WITHOUT writing anything. Runs the exact same validation
 * (`planServiceFamilyOperation`), so an inspect that reports "no
 * violations" can never be followed by a commit that then fails for a
 * reason inspect didn't also report — short of a genuine race with another
 * concurrent write, which the commit endpoint re-validates against inside
 * its own transaction regardless.
 */
export async function POST(request: Request): Promise<Response> {
  let parsed: ReturnType<typeof parseServiceFamilyRequest>;
  try {
    parsed = parseServiceFamilyRequest(await request.json().catch(() => null));
  } catch (parseError) {
    if (parseError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(parseError);
    }
    throw parseError;
  }

  const { salonSlug, operation } = parsed;
  const { salon, error } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  try {
    const plan = await planServiceFamilyOperation(salon.id, operation);
    return Response.json({ data: { changes: plan.changes, warnings: plan.warnings } });
  } catch (planError) {
    if (planError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(planError);
    }
    console.error('Service family inspect failed:', planError instanceof Error ? planError.message : 'unknown');
    return Response.json(
      { error: { code: 'INSPECT_FAILED', message: 'Could not evaluate this change. Try again.' } },
      { status: 500 },
    );
  }
}
