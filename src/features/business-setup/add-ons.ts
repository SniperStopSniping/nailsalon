import { z } from 'zod';

import { ADD_ON_CATEGORIES } from '@/models/serviceCatalogTypes';

import { setupServicePriceLabel } from './service-pricing';

const identity = z.string().min(1).max(100);
/** Existing add_on fields; no invented service category or parallel catalogue. */
export const setupAddOnSchema = z.object({
  id: identity,
  name: z.string().trim().min(1).max(120),
  category: z.enum(ADD_ON_CATEGORIES),
  descriptionItems: z.array(z.string().trim().min(1).max(500)).max(20).nullable(),
  priceCents: z.number().int().min(0).max(100000000).nullable(),
  priceDisplayText: z.string().trim().max(240).nullable().optional(),
  durationMinutes: z.number().int().min(0).max(240).nullable(),
  pricingType: z.enum(['fixed', 'per_unit']),
  unitLabel: z.string().trim().max(120).nullable(),
  maxQuantity: z.number().int().min(1).max(50).nullable(),
  isActive: z.boolean(),
  serviceIds: z.array(identity).max(200).refine(ids => new Set(ids).size === ids.length, 'Choose each service only once.'),
}).strict();
export type SetupAddOn = z.infer<typeof setupAddOnSchema> & {
  origin: 'existing' | 'owner' | 'assistant';
  confirmed: boolean;
  priceLabelNeedsReview?: boolean;
  /** Read-only hints. Only canonical catalogue controls edit these rules. */
  groupId?: string | null;
  advancedRules?: boolean;
};

export function changesProtectedAddOnChoices(previous: SetupAddOn, proposed: SetupAddOn) {
  return Boolean((previous.groupId || previous.advancedRules) && (previous.pricingType !== proposed.pricingType || previous.unitLabel !== proposed.unitLabel || previous.maxQuantity !== proposed.maxQuantity || JSON.stringify([...previous.serviceIds].sort()) !== JSON.stringify([...proposed.serviceIds].sort()) || previous.isActive !== proposed.isActive));
}

export function addOnReviewValue(value: unknown, services: { id: string; name: string }[], currency: string) {
  if (!Array.isArray(value) || !value.length) {
    return 'No add-ons';
  }
  return (value as SetupAddOn[]).map(addOn => `${addOn.name}: ${setupServicePriceLabel(addOn, currency)}${addOn.pricingType === 'per_unit' ? ` per ${addOn.unitLabel || 'unit'} (maximum ${addOn.maxQuantity ?? 'not set'})` : ''}, ${addOn.durationMinutes ?? '?'} extra minutes${addOn.pricingType === 'per_unit' ? ' per unit' : ''}; ${addOn.isActive ? 'offered' : 'not offered'} with ${addOn.serviceIds.map(id => services.find(service => service.id === id)?.name ?? 'Previously saved service').join(', ') || 'no services selected'}${addOn.groupId || addOn.advancedRules ? '; existing group and selection rules kept' : ''}${addOn.confirmed ? '' : '; needs your review'}`).join('\n');
}
