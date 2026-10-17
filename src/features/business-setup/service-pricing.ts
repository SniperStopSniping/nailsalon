import { formatMoney } from '@/libs/formatMoney';

type Price = { priceCents: number | null; priceDisplayText?: string | null; priceLabelNeedsReview?: boolean };
type PricingDocument = { services: (Price & { id: string })[]; servicePricingVersion?: 1; booking: { currency: string } };
const normalize = (value: string) => value.trim().replace(/\s+/gu, ' ').toLowerCase();
const prefixPattern = /^(from|starting at|à partir de|dès)\s+/iu;
const singleAmountPattern = /^(?:[A-Z]{0,3}\p{Sc}\s*|[A-Z]{3}\s+)?\d+(?:,\d{3})*(?:\.\d{1,2})?(?:\s+[A-Z]{3})?$/u;

/** Recognize only an exact saved amount; never infer a range or another currency. */
function knownPriceText(label: string, cents: number, currency: string) {
  const prefix = label.match(prefixPattern)?.[0] ?? '';
  const amount = label.slice(prefix.length);
  const number = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 }).format(cents / 100);
  const short = new Intl.NumberFormat('en-CA', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100);
  const choices = [formatMoney(cents, currency), short, `${currency} ${number}`, `${number} ${currency}`, number];
  return choices.some(choice => normalize(choice) === normalize(amount)) ? prefix : null;
}

/** Keep price wording coherent without guessing how an arbitrary owner label works. */
export function updateSetupServicePricing(previous: Price | undefined, proposed: Price, currency: string): Pick<Price, 'priceDisplayText' | 'priceLabelNeedsReview'> {
  const label = proposed.priceDisplayText === undefined ? previous?.priceDisplayText ?? null : proposed.priceDisplayText?.trim() || null;
  const sameLabel = label === (previous?.priceDisplayText ?? null);
  const priceChanged = previous !== undefined && previous.priceCents !== proposed.priceCents;
  if (!label) {
    return { priceDisplayText: null };
  }
  if (!priceChanged || !sameLabel) {
    const singleAmount = singleAmountPattern.test(label.replace(prefixPattern, ''));
    const mismatchedAmount = proposed.priceCents !== null && singleAmount && knownPriceText(label, proposed.priceCents, currency) === null;
    return { priceDisplayText: label, ...(mismatchedAmount || (sameLabel && previous?.priceLabelNeedsReview === true) ? { priceLabelNeedsReview: true } : {}) };
  }
  if (proposed.priceCents !== null && knownPriceText(label, proposed.priceCents, currency) !== null) {
    return { priceDisplayText: label };
  }
  const prefix = previous.priceCents === null ? null : knownPriceText(label, previous.priceCents, currency);
  if (prefix !== null && proposed.priceCents !== null) {
    return { priceDisplayText: `${prefix}${formatMoney(proposed.priceCents, currency)}` };
  }
  // Wording without an amount can stay. A range or other embedded amount
  // requires an explicit new label or clearing the label before publication.
  return { priceDisplayText: label, ...(/\d/u.test(label) || previous.priceLabelNeedsReview === true ? { priceLabelNeedsReview: true } : {}) };
}

/** Read adapter for immutable revisions saved before price labels were included. */
export function hydrateSetupServicePricing<T extends PricingDocument>(saved: T, baseline: PricingDocument): T & { servicePricingVersion: 1 } {
  if (saved.servicePricingVersion === 1) {
    return { ...saved, servicePricingVersion: 1 };
  }
  return { ...saved, servicePricingVersion: 1, services: saved.services.map((service) => {
    const previous = baseline.services.find(item => item.id === service.id);
    return { ...service, ...updateSetupServicePricing(previous, service, saved.booking.currency) };
  }) };
}

export function setupServicePriceLabel(service: Price, currency: string) {
  if (service.priceLabelNeedsReview) {
    return 'Price wording needs review';
  }
  return service.priceDisplayText || (service.priceCents === null ? 'Price needed' : formatMoney(service.priceCents, currency));
}
