import { z } from 'zod';

import type {
  AddOn,
  AddOnCategory,
  AddOnPricingType,
  Service,
  ServiceAddOn,
  ServiceCategory,
  ServiceAddOnSelectionMode,
} from '@/models/Schema';

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

