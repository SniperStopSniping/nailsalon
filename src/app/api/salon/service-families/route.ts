import { requireAdminSalon } from '@/libs/adminAuth';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import { commitServiceFamilyOperation, parseServiceFamilyRequest } from '@/libs/ownerCatalogFamilies.server';
import { buildServicePayload } from '@/libs/servicePayload';

export const dynamic = 'force-dynamic';

/**
 * POST /api/salon/service-families — commit an ATTACH (make one service a
 * labelled variant of another) or DETACH (restore a variant to standalone)
 * operation. Transactional: `commitServiceFamilyOperation`
 * (`ownerCatalogFamilies.server.ts`) re-validates every invariant inside
 * the same transaction that writes, so a half-applied family can never be
 * observed by a concurrent reader.
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
    const result = await commitServiceFamilyOperation(salon.id, operation);
    return Response.json({
      data: {
        parent: result.parent ? buildServicePayload(result.parent) : null,
        child: buildServicePayload(result.child),
        changes: result.plan.changes,
        warnings: result.plan.warnings,
      },
    });
  } catch (commitError) {
    if (commitError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(commitError);
    }
    console.error('Service family operation failed:', commitError instanceof Error ? commitError.message : 'unknown');
    return Response.json(
      { error: { code: 'UPDATE_FAILED', message: 'The service family change could not be saved. Try again.' } },
      { status: 409 },
    );
  }
}
