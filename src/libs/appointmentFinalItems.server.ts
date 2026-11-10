import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { type CompletePayload, completionValidationIssues } from '@/libs/appointmentCompletionContract';
import type { ResolvedTaxConfig } from '@/libs/checkoutTotals';
import type { db } from '@/libs/DB';
import { addOnSchema, type appointmentSchema, serviceSchema } from '@/models/Schema';

export type ResolvedFinalItem = {
  kind: 'service' | 'addon' | 'custom';
  catalogServiceId: string | null;
  catalogAddOnId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  durationMinutes: number | null;
  taxable: boolean;
};

export function defaultTaxableFor(kind: ResolvedFinalItem['kind'], taxConfig: ResolvedTaxConfig): boolean {
  if (kind === 'service') {
    return taxConfig.taxServicesByDefault;
  }
  if (kind === 'addon') {
    return taxConfig.taxAddOnsByDefault;
  }
  return taxConfig.taxCustomByDefault;
}

export class CompletionCatalogReferenceError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super('One or more services or add-ons are unavailable. Reload the appointment and check Services & items.');
  }
}

/**
 * Resolve the final line items from the payload. Three shapes:
 * - `finalItems` (the checkout sheet) — used as sent.
 * - legacy `performedServiceIds`/`performedAddOnIds` — priced from the live
 *   catalog (same semantics as the removed destructive rewrite, minus the
 *   destruction).
 * - neither — legacy completion; no final items are recorded.
 */
export async function resolveFinalItems(
  database: Pick<typeof db, 'select'>,
  appointment: typeof appointmentSchema.$inferSelect,
  payload: CompletePayload,
  taxConfig: ResolvedTaxConfig,
): Promise<ResolvedFinalItem[] | null> {
  if (payload.finalItems) {
    // Opaque catalog IDs may be longer than legacy UI assumptions. Validate
    // ownership, not spelling/length; archived booked references remain valid.
    const serviceIds = [...new Set(payload.finalItems.flatMap(item => item.kind === 'service' && item.catalogServiceId != null ? [item.catalogServiceId] : []))];
    const addOnIds = [...new Set(payload.finalItems.flatMap(item => item.kind === 'addon' && item.catalogAddOnId != null ? [item.catalogAddOnId] : []))];
    const services = serviceIds.length
      ? await database.select({ id: serviceSchema.id }).from(serviceSchema)
        .where(and(eq(serviceSchema.salonId, appointment.salonId), inArray(serviceSchema.id, serviceIds)))
      : [];
    const addOns = addOnIds.length
      ? await database.select({ id: addOnSchema.id }).from(addOnSchema)
        .where(and(eq(addOnSchema.salonId, appointment.salonId), inArray(addOnSchema.id, addOnIds)))
      : [];
    const validServices = new Set(services.map(item => item.id));
    const validAddOns = new Set(addOns.map(item => item.id));
    const invalidPaths = payload.finalItems.flatMap((item, index) => {
      if (item.kind === 'service' && item.catalogServiceId != null && !validServices.has(item.catalogServiceId)) {
        return [{ path: ['finalItems', index, 'catalogServiceId'] }];
      }
      if (item.kind === 'addon' && item.catalogAddOnId != null && !validAddOns.has(item.catalogAddOnId)) {
        return [{ path: ['finalItems', index, 'catalogAddOnId'] }];
      }
      return [];
    });
    if (invalidPaths.length) {
      throw new CompletionCatalogReferenceError(completionValidationIssues(invalidPaths));
    }
    return payload.finalItems.map(item => ({
      kind: item.kind,
      catalogServiceId: item.kind === 'service' ? item.catalogServiceId ?? null : null,
      catalogAddOnId: item.kind === 'addon' ? item.catalogAddOnId ?? null : null,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.unitPriceCents * item.quantity,
      durationMinutes: item.durationMinutes ?? null,
      taxable: item.taxable ?? defaultTaxableFor(item.kind, taxConfig),
    }));
  }

  const { performedServiceIds, performedAddOnIds } = payload;
  if (!performedServiceIds?.length && !performedAddOnIds) {
    return null;
  }

  const items: ResolvedFinalItem[] = [];

  if (performedServiceIds?.length) {
    const services = await database
      .select()
      .from(serviceSchema)
      .where(and(
        eq(serviceSchema.salonId, appointment.salonId),
        inArray(serviceSchema.id, performedServiceIds),
      ));
    for (const service of services) {
      items.push({
        kind: 'service',
        catalogServiceId: service.id,
        catalogAddOnId: null,
        name: service.name,
        quantity: 1,
        unitPriceCents: service.price,
        lineTotalCents: service.price,
        durationMinutes: service.durationMinutes,
        taxable: defaultTaxableFor('service', taxConfig),
      });
    }
  }

  if (performedAddOnIds?.length) {
    const addOns = await database
      .select()
      .from(addOnSchema)
      .where(and(
        eq(addOnSchema.salonId, appointment.salonId),
        inArray(addOnSchema.id, performedAddOnIds),
      ));
    for (const addOn of addOns) {
      items.push({
        kind: 'addon',
        catalogServiceId: null,
        catalogAddOnId: addOn.id,
        name: addOn.name,
        quantity: 1,
        unitPriceCents: addOn.priceCents,
        lineTotalCents: addOn.priceCents,
        durationMinutes: addOn.durationMinutes,
        taxable: defaultTaxableFor('addon', taxConfig),
      });
    }
  }

  return items;
}
