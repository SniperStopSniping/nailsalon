import { z } from 'zod';

import { resolveEntitlement } from '@/libs/featureEntitlements';
import type {
  AddOn,
  AddOnCategory,
  AddOnPricingType,
  Service,
  ServiceAddOn,
  ServiceAddOnSelectionMode,
  ServiceCategory,
} from '@/models/Schema';
import type { SalonFeatures } from '@/types/salonPolicy';

export const DESCRIPTION_ITEM_MAX_COUNT = 10;
export const DESCRIPTION_ITEM_MAX_LENGTH = 120;

export const descriptionItemsSchema = z
  .array(z.string())
  .max(DESCRIPTION_ITEM_MAX_COUNT, `Maximum ${DESCRIPTION_ITEM_MAX_COUNT} description items allowed`)
  .transform((items) => {
    const normalized = items
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => item.slice(0, DESCRIPTION_ITEM_MAX_LENGTH));

    return normalized;
  });

export function normalizeDescriptionItems(input: unknown): string[] | null {
  if (input == null) {
    return null;
  }

  const parsed = descriptionItemsSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }

  return parsed.data.length > 0 ? parsed.data : null;
}

export function descriptionItemsToLegacyText(items: string[] | null | undefined, fallback?: string | null): string | null {
  if (items && items.length > 0) {
    return items.join('\n');
  }

  return fallback ?? null;
}

export type ServiceCatalogSummary = {
  id: string;
  salonId: string;
  name: string;
  slug: string | null;
  category: ServiceCategory;
  descriptionItems: string[] | null;
  priceCents: number;
  priceDisplayText: string | null;
  durationMinutes: number;
  isIntroPrice: boolean | null;
  introPriceLabel: string | null;
  introPriceExpiresAt: Date | null;
  isActive: boolean | null;
};

export type AddOnCatalogSummary = {
  id: string;
  salonId: string;
  name: string;
  slug: string;
  category: AddOnCategory;
  descriptionItems: string[] | null;
  priceCents: number;
  priceDisplayText: string | null;
  durationMinutes: number;
  pricingType: AddOnPricingType;
  unitLabel: string | null;
  maxQuantity: number | null;
  isActive: boolean | null;
};

export type ServiceAddOnRuleSummary = {
  id: string;
  salonId: string;
  serviceId: string;
  addOnId: string;
  selectionMode: ServiceAddOnSelectionMode;
  defaultQuantity: number | null;
  maxQuantityOverride: number | null;
  displayOrder: number | null;
};

export function mapServiceToCatalogSummary(service: Service): ServiceCatalogSummary {
  return {
    id: service.id,
    salonId: service.salonId,
    name: service.name,
    slug: service.slug ?? null,
    category: service.category,
    descriptionItems: normalizeDescriptionItems(service.descriptionItems) ?? null,
    priceCents: service.price,
    priceDisplayText: service.priceDisplayText ?? null,
    durationMinutes: service.durationMinutes,
    isIntroPrice: service.isIntroPrice ?? false,
    introPriceLabel: service.introPriceLabel ?? null,
    introPriceExpiresAt: service.introPriceExpiresAt ?? null,
    isActive: service.isActive ?? true,
  };
}

export function mapAddOnToCatalogSummary(addOn: AddOn): AddOnCatalogSummary {
  return {
    id: addOn.id,
    salonId: addOn.salonId,
    name: addOn.name,
    slug: addOn.slug,
    category: addOn.category,
    descriptionItems: normalizeDescriptionItems(addOn.descriptionItems) ?? null,
    priceCents: addOn.priceCents,
    priceDisplayText: addOn.priceDisplayText ?? null,
    durationMinutes: addOn.durationMinutes,
    pricingType: addOn.pricingType,
    unitLabel: addOn.unitLabel ?? null,
    maxQuantity: addOn.maxQuantity ?? null,
    isActive: addOn.isActive ?? true,
  };
}

export function mapServiceAddOnRule(rule: ServiceAddOn): ServiceAddOnRuleSummary {
  return {
    id: rule.id,
    salonId: rule.salonId,
    serviceId: rule.serviceId,
    addOnId: rule.addOnId,
    selectionMode: rule.selectionMode,
    defaultQuantity: rule.defaultQuantity ?? null,
    maxQuantityOverride: rule.maxQuantityOverride ?? null,
    displayOrder: rule.displayOrder ?? 0,
  };
}

// =============================================================================
// CATALOG DOMAIN VIEW — Luster L1 PR3's one narrow, inert seam in this file.
//
// This is a PURE, feature-flag-driven decision between two shapes a caller
// could assemble a catalog response DTO from:
//   - `'legacy'` — the flat view this file has always produced
//     (`mapServiceToCatalogSummary` / `mapAddOnToCatalogSummary` /
//     `mapServiceAddOnRule` above), consumed today by `bookingQuote.ts` and
//     the owner `salon/services` + `salon/add-ons` API routes, all of them
//     UNCHANGED by this addition.
//   - `'l1'` — the richer DTO `catalogResolverCore.ts` /
//     `catalogResolver.server.ts` can assemble (variants, add-on groups,
//     declarative rules).
//
// Every one of the three L1 catalog feature keys — catalogVariantsV1,
// catalogAddOnGroupsV1, catalogBookingModesV1 — is dark: `resolveEntitlement`
// returns false for every salon, on every tier, even under the widest Super
// Admin preset (see `l1CatalogFeatureKeys.test.ts`). `resolveCatalogDomainView`
// can therefore only ever return `'legacy'` today, for every real salon —
// proven by this file's own test below. NOTHING calls this function yet
// (confirmed by search; see the PR3 report); it exists so a later PR that
// switches a salon onto the L1 resolver has one already-tested place to ask
// the question, instead of duplicating flag-reading logic ad hoc at each
// call site.
// =============================================================================

export const CATALOG_DOMAIN_VIEWS = ['legacy', 'l1'] as const;
export type CatalogDomainView = typeof CATALOG_DOMAIN_VIEWS[number];

export function resolveCatalogDomainView(
  features: SalonFeatures | null | undefined,
): CatalogDomainView {
  const anyL1CatalogFeatureOn = resolveEntitlement(features, 'catalog', 'variantsV1')
    || resolveEntitlement(features, 'catalog', 'addOnGroupsV1')
    || resolveEntitlement(features, 'catalog', 'bookingModesV1');

  return anyL1CatalogFeatureOn ? 'l1' : 'legacy';
}
