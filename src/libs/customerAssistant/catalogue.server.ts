import 'server-only';

import { createHash } from 'node:crypto';

import { resolveCatalogDomainView } from '@/libs/bookingCatalog';
import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { validatePublicBookingSelection } from '@/libs/bookingQuote';
import type { PublicCatalogSnapshot } from '@/libs/catalogDomain';
import { resolvePublicCatalogSnapshot } from '@/libs/catalogResolver.server';
import { projectPublicBookingCatalog } from '@/libs/publicBookingCatalog';
import { getActiveAddOnsBySalonId, getServiceAddOnRulesBySalonId, getServicesBySalonId } from '@/libs/queries';
import { getPublicBookableServiceIds } from '@/libs/serviceAssignments';
import type { SalonFeatures } from '@/types/salonPolicy';

import type { CustomerProposal, CustomerSelection } from './contracts';

export type CustomerMenu = {
  // The model receives a reachable projection only. In particular, it never
  // receives `revision.canonical`, which serializes the full authority snapshot.
  l1?: {
    services: Array<Pick<PublicCatalogSnapshot['services'][number], 'id' | 'kind' | 'parentServiceId' | 'variantLabel' | 'selectionMode'>>;
    addOns: Array<Pick<PublicCatalogSnapshot['addOns'][number], 'id' | 'groupId'>>;
    addOnGroups: PublicCatalogSnapshot['addOnGroups'];
    ruleProjections: PublicCatalogSnapshot['ruleProjections'];
  };
  services: { id: string; name: string; description: string; category: string }[];
  addOns: { id: string; name: string; description: string; category: string; pricingType: string; maxQuantity: number }[];
  bindings: { serviceId: string; addOnId: string; required: boolean; defaultQuantity: number; maxQuantity: number }[];
};

/** Exact public-menu sources; raw rows never leave this module. */
export async function loadCustomerMenu(salonId: string, features: SalonFeatures | null): Promise<CustomerMenu> {
  if (resolveCatalogDomainView(features) === 'l1') {
    const [result, bookable] = await Promise.all([
      resolvePublicCatalogSnapshot({ salonId, requestedSource: 'live' }),
      getPublicBookableServiceIds(salonId),
    ]);
    if (!result.ok) {
      throw new Error('CUSTOMER_CATALOGUE_UNAVAILABLE');
    }
    const snapshot = result.snapshot;
    const l1 = projectPublicBookingCatalog(snapshot, bookable);
    if (l1.services.length > 60 || l1.addOns.length > 80 || l1.serviceAddOnBindings.length > 160) {
      throw new Error('CUSTOMER_CATALOGUE_UNAVAILABLE');
    }
    return {
      // Interpretation needs identities and constraints, not duplicate names,
      // prices, durations or revision material. Final totals come from the quote.
      l1: {
        services: l1.services.map(({ id, kind, parentServiceId, variantLabel, selectionMode }) => ({ id, kind, parentServiceId, variantLabel, selectionMode })),
        addOns: l1.addOns.map(({ id, groupId }) => ({ id, groupId })),
        addOnGroups: l1.addOnGroups,
        ruleProjections: l1.ruleProjections,
      },
      services: l1.services.map(service => ({ id: service.id, name: service.parentServiceId ? `${l1.services.find(parent => parent.id === service.parentServiceId)?.name ?? ''} · ${service.variantLabel ?? service.name}` : service.name, description: (service.descriptionItems ?? []).join('\n').slice(0, 600), category: service.category })),
      addOns: l1.addOns.map(addOn => ({ id: addOn.id, name: addOn.name, description: (addOn.descriptionItems ?? []).join('\n').slice(0, 400), category: addOn.category, pricingType: addOn.pricingType, maxQuantity: addOn.baseMaxQuantity })),
      bindings: l1.serviceAddOnBindings.map(binding => ({ serviceId: binding.serviceId, addOnId: binding.addOnId, required: binding.selectionMode === 'required', defaultQuantity: binding.defaultQuantity ?? 1, maxQuantity: binding.effectiveMaxQuantity })),
    };
  }
  const [services, addOns, rules, bookable] = await Promise.all([
    getServicesBySalonId(salonId),
    getActiveAddOnsBySalonId(salonId),
    getServiceAddOnRulesBySalonId(salonId),
    getPublicBookableServiceIds(salonId),
  ]);
  const publicServices = services.filter(item => item.isActive && (bookable === null || bookable.has(item.id)));
  const serviceIds = new Set(publicServices.map(item => item.id));
  const publicRules = rules.filter(rule => serviceIds.has(rule.serviceId));
  const boundAddOnIds = new Set(publicRules.map(rule => rule.addOnId));
  const publicAddOns = addOns.filter(item => item.isActive && boundAddOnIds.has(item.id));
  const byAddOnId = new Map(publicAddOns.map(item => [item.id, item]));
  // Bounded input must not silently omit part of a salon's menu.
  if (publicServices.length > 60 || publicAddOns.length > 80 || publicRules.length > 160) {
    throw new Error('CUSTOMER_CATALOGUE_UNAVAILABLE');
  }
  return {
    services: publicServices.map(item => ({
      id: item.id,
      name: item.name.slice(0, 160),
      description: (item.descriptionItems?.join('\n') || item.description || '').slice(0, 600),
      category: item.category,
    })),
    addOns: publicAddOns.map(item => ({
      id: item.id,
      name: item.name.slice(0, 160),
      description: (item.descriptionItems ?? []).join('\n').slice(0, 400),
      category: item.category,
      pricingType: item.pricingType,
      maxQuantity: item.maxQuantity ?? 10,
    })),
    bindings: publicRules.filter(rule => byAddOnId.has(rule.addOnId)).map(rule => ({
      serviceId: rule.serviceId,
      addOnId: rule.addOnId,
      required: rule.selectionMode === 'required',
      defaultQuantity: rule.defaultQuantity ?? 1,
      maxQuantity: rule.maxQuantityOverride ?? byAddOnId.get(rule.addOnId)!.maxQuantity ?? 10,
    })),
  };
}

export function validateCustomerMenuSelection(menu: CustomerMenu, selection: CustomerSelection): void {
  if (!menu.services.some(service => service.id === selection.baseServiceId)) {
    throw new Error('CUSTOMER_SELECTION_CHANGED');
  }
  const ids = new Set<string>();
  for (const choice of selection.selectedAddOns) {
    const addOn = menu.addOns.find(item => item.id === choice.addOnId);
    const binding = menu.bindings.find(item => item.serviceId === selection.baseServiceId && item.addOnId === choice.addOnId);
    if (!addOn || (!binding && !menu.l1) || ids.has(choice.addOnId)
      || !Number.isInteger(choice.quantity) || choice.quantity < 1
      || choice.quantity > (binding?.maxQuantity ?? addOn.maxQuantity) || (addOn.pricingType !== 'per_unit' && choice.quantity !== 1)) {
      throw new Error('CUSTOMER_SELECTION_CHANGED');
    }
    ids.add(choice.addOnId);
  }
  // Match the service page's required-option defaults, but never silently add
  // or clamp a model choice. Ask again if the proposed set is incomplete.
  if (!menu.l1 && menu.bindings.some(binding => binding.serviceId === selection.baseServiceId && binding.required && !ids.has(binding.addOnId))) {
    throw new Error('CUSTOMER_SELECTION_CHANGED');
  }
}

export async function buildCustomerProposal(salonId: string, features: SalonFeatures | null, selection: CustomerSelection): Promise<CustomerProposal> {
  const menu = await loadCustomerMenu(salonId, features);
  validateCustomerMenuSelection(menu, selection);
  const [{ quote, l1 }, config] = await Promise.all([
    validatePublicBookingSelection({ salonId, selection }),
    getBookingConfigForSalon(salonId),
  ]);
  const material = {
    selection,
    service: { id: quote.baseService.id, name: quote.baseService.name, priceCents: quote.baseService.priceCents },
    addOns: quote.addOns.map(item => ({ id: item.addOnId, name: item.name, quantity: item.quantity, priceCents: item.lineTotalCents })),
    currency: config.currency,
    subtotalCents: quote.subtotalCents,
    durationMinutes: quote.visibleDurationMinutes,
  };
  return {
    ...material,
    // The visible proposal does not disclose an internal time-zone setting,
    // but it is booking authority: a changed zone invalidates offered UTC
    // times across turns and must therefore invalidate acceptance too.
    fingerprint: createHash('sha256').update(JSON.stringify({ salonId, timeZone: config.timezone, catalogFingerprint: l1?.fingerprint ?? null, ...material })).digest('hex'),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}
