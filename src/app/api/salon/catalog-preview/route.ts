import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { previewCatalogSelection } from '@/libs/ownerCatalogPreview.server';
import type { CatalogPreviewResponse } from '@/types/admin';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  serviceId: z.string().min(1, 'serviceId is required'),
  technicianId: z.string().min(1).nullable().optional(),
  selectedAddOns: z.array(z.object({
    addOnId: z.string().min(1),
    quantity: z.number().int().min(1).max(99).optional(),
  })).optional().default([]),
});

/**
 * POST /api/salon/catalog-preview — authenticated, salon-scoped: resolves
 * a selection through the SAME resolver booking uses
 * (`resolvePublicCatalogSnapshot` / `resolveCatalogSelectionForSalon`,
 * `catalogResolver.server.ts`), against the CURRENT live catalog. No
 * alternate price/duration math exists anywhere in this route — see
 * `ownerCatalogPreview.server.ts`.
 */
export async function POST(request: Request): Promise<Response> {
  const validated = requestSchema.safeParse(await request.json().catch(() => null));
  if (!validated.success) {
    return Response.json(
      { error: { code: 'VALIDATION_ERROR', message: validated.error.issues[0]?.message ?? 'Invalid preview request' } },
      { status: 400 },
    );
  }

  const { salonSlug, ...selection } = validated.data;
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  const outcome = await previewCatalogSelection(salon.id, {
    serviceId: selection.serviceId,
    technicianId: selection.technicianId ?? null,
    selectedAddOns: selection.selectedAddOns,
  });

  if (!outcome.ok) {
    const body: CatalogPreviewResponse = { ok: false, code: outcome.code };
    return Response.json({ data: body });
  }

  const { selection: resolved } = outcome;
  const body: CatalogPreviewResponse = {
    ok: true,
    basePriceCents: resolved.basePriceCents,
    baseDurationMinutes: resolved.baseDurationMinutes,
    subtotalCents: resolved.subtotalCents,
    totalDurationMinutes: resolved.totalDurationMinutes,
    addOns: resolved.addOns.map(line => ({
      addOnId: line.addOnId,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
      unitDurationMinutes: line.unitDurationMinutes,
      lineDurationMinutes: line.lineDurationMinutes,
      autoAdded: line.autoAdded,
    })),
    violations: resolved.violations,
    blocksContinue: resolved.blocksContinue,
  };

  return Response.json({ data: body });
}
