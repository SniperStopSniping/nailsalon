import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { buildCatalogRuleResponse } from '@/libs/catalogRulePayload';
import { OwnerCatalogConfigError, ownerCatalogErrorResponse } from '@/libs/ownerCatalogErrors.server';
import { createCatalogRule, listCatalogRules, parseOwnerRuleWrite } from '@/libs/ownerCatalogRules.server';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ salonSlug: z.string().min(1, 'Salon slug is required') });

type ErrorResponse = { error: { code: string; message: string; details?: unknown } };

/** GET /api/salon/catalog-rules — every rule for the salon, ordered (priority, id) — the frozen evaluation order. */
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

    const rules = await listCatalogRules(salon.id);
    return Response.json({ data: { rules: rules.map(buildCatalogRuleResponse) } });
  } catch (error) {
    console.error('Error fetching catalog rules:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch catalog rules' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

/**
 * POST /api/salon/catalog-rules — create a rule from owner INTENT
 * (`bundle_add_on` | `exclude_add_on` | `require_add_on` |
 * `prevent_combination` | `limit_add_on_quantity` | `require_capability`),
 * mapped onto the six landed rule types by `ownerCatalogRules.server.ts`.
 * The client can never send a raw `ruleType`, `params`, or `priority` —
 * the intent schema has no such fields.
 */
export async function POST(request: Request): Promise<Response> {
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
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  try {
    const created = await createCatalogRule(salon.id, ruleWrite);
    return Response.json({ data: { rule: buildCatalogRuleResponse(created) } }, { status: 201 });
  } catch (createError) {
    if (createError instanceof OwnerCatalogConfigError) {
      return ownerCatalogErrorResponse(createError);
    }
    console.error('Catalog rule create failed:', createError instanceof Error ? createError.message : 'unknown');
    return Response.json(
      { error: { code: 'CREATE_FAILED', message: 'The rule could not be created.' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
