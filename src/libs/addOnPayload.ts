import type { AddOn } from '@/models/Schema';
import type { AddOnResponse } from '@/types/admin';

/**
 * Shared admin add-on serializer. Lives outside the route files because
 * Next.js only allows route handlers (GET/POST/…) to be exported from them.
 *
 * `compatibleServiceIds` is passed in rather than queried here so a list
 * endpoint can load a salon's service_add_on rows once instead of per add-on.
 */
export function buildAddOnPayload(
  addOn: AddOn,
  compatibleServiceIds: string[] = [],
  manualConfirmationServiceIds: string[] = [],
): AddOnResponse {
  return {
    id: addOn.id,
    name: addOn.name,
    slug: addOn.slug ?? '',
    descriptionItems: addOn.descriptionItems ?? null,
    priceCents: addOn.priceCents,
    priceDisplayText: addOn.priceDisplayText ?? null,
    durationMinutes: addOn.durationMinutes,
    category: addOn.category,
    pricingType: addOn.pricingType,
    unitLabel: addOn.unitLabel ?? null,
    maxQuantity: addOn.maxQuantity ?? null,
    displayOrder: addOn.displayOrder ?? null,
    isActive: addOn.isActive,
    templateKey: addOn.templateKey ?? null,
    compatibleServiceIds,
    manualConfirmationServiceIds,
    groupId: addOn.groupId ?? null,
  };
}

/** addOnId → compatible service ids that require a technician price confirmation. */
export function groupManualConfirmationServiceIds(
  rules: Array<{ addOnId: string; serviceId: string; priceMode: 'catalog_priced' | 'manual_confirmation' }>,
): Map<string, string[]> {
  const byAddOn = new Map<string, string[]>();
  for (const rule of rules) {
    if (rule.priceMode !== 'manual_confirmation') {
      continue;
    }
    const existing = byAddOn.get(rule.addOnId);
    if (existing) {
      existing.push(rule.serviceId);
    } else {
      byAddOn.set(rule.addOnId, [rule.serviceId]);
    }
  }
  return byAddOn;
}

/** addOnId → serviceIds, from a salon's full service_add_on rule set. */
export function groupCompatibleServiceIds(
  rules: Array<{ addOnId: string; serviceId: string }>,
): Map<string, string[]> {
  const byAddOn = new Map<string, string[]>();
  for (const rule of rules) {
    const existing = byAddOn.get(rule.addOnId);
    if (existing) {
      existing.push(rule.serviceId);
    } else {
      byAddOn.set(rule.addOnId, [rule.serviceId]);
    }
  }
  return byAddOn;
}
