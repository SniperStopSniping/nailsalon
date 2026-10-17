import 'server-only';

import { createHash } from 'node:crypto';

import type { SetupDocument } from '@/features/business-setup/contracts';

import type { CustomSiteData, CustomSiteSource } from './contracts';
import { customSiteDataFromSetup } from './setup-data';
import { EMPTY_WEBSITE_DETAILS } from './website-details';

const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value ?? null;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function canvaServiceKey(service: Pick<CustomSiteData['services'][number], 'name' | 'priceCents' | 'durationMinutes'>) {
  return hash({ name: service.name, price: service.priceCents, duration: service.durationMinutes });
}
/** Temporary IDs, confirmation flags and ordering never change a visual fact. */
export function canvaDataFingerprint(data: CustomSiteData) {
  return hash({ business: { name: data.business.name, city: data.business.city, address: data.business.address ?? null, bio: data.business.bio, hours: data.business.hours }, services: data.services.map(canvaServiceKey).sort(), details: data.details ?? EMPTY_WEBSITE_DETAILS, rules: data.bookingRules ?? {}, currency: data.currency });
}
export function canvaPriceLabelsFingerprint(data: CustomSiteData) {
  return hash(data.services.map(service => ({ key: canvaServiceKey(service), label: service.priceLabel })).sort((left, right) => left.key.localeCompare(right.key)));
}
/** New reviews bind price wording; old public artwork retains its existing guard. */
export function canvaFactsMatch(source: CustomSiteSource, data: CustomSiteData, requirePriceLabels = false) {
  return source.canva?.dataFingerprint === canvaDataFingerprint(data)
    && (source.canva.priceLabelsFingerprint
      ? source.canva.priceLabelsFingerprint === canvaPriceLabelsFingerprint(data)
      : !requirePriceLabels);
}
export function canvaDraftBlockers(document: SetupDocument, source: CustomSiteSource) {
  if (!source.canva) {
    return [];
  }
  const data = customSiteDataFromSetup(document);
  return [
    ...canvaTargetBlockers(source, data),
    ...(!source.canva.ownerReviewed || !canvaFactsMatch(source, data, true) ? ['Review your Canva artwork in Preview. Check its prices, hours, contact details and address before sharing or publishing.'] : []),
  ];
}
export function canvaTargetBlockers(source: CustomSiteSource, data: CustomSiteData) {
  return (source.canva?.areas ?? []).flatMap(({ label, action }) => {
    if (action.type === 'service' && data.services.filter(service => canvaServiceKey(service) === action.serviceKey).length !== 1) {
      return [`Choose the current service for “${label}” in Preview.`];
    }
    if (['instagram', 'email', 'phone'].includes(action.type) && !data.details?.[action.type as 'instagram' | 'email' | 'phone']) {
      return [`Add your ${action.type} in Details, or remove the “${label}” link.`];
    }
    return [];
  });
}
