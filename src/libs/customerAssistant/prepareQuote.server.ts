import 'server-only';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { resolveRequiredBookingPolicy } from '@/libs/bookingPolicyAcknowledgment';
import { resolveBookingSmsConsentDecision, resolveBookingSmsMode } from '@/libs/bookingSmsConsent';
import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import { buildDepositDisclosure, buildDepositDisclosureFingerprint, resolveDepositChargeForTotal } from '@/libs/depositPolicy';
import { getDepositPolicyForSalon } from '@/libs/depositPolicy.server';
import { resolvePublicBookingSelection } from '@/libs/publicBookingSelection';
import { getPrimaryLocation } from '@/libs/queries';
import type { SmartFitEvaluation } from '@/libs/smartFit';
import { applySmartFitOverlay } from '@/libs/smartFit';
import { resolveSmartFitConfig } from '@/libs/smartFitConfig';
import { buildTaxConfigurationSnapshot, resolveTaxConfig } from '@/libs/taxConfig';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

import type { CustomerBookingMaterial } from './bookingOperationContracts';
import type { CustomerContact } from './contact';
import type { CustomerDatePreference, CustomerSelection } from './contracts';
import type { CustomerReadyReviewSnapshot } from './reviewContracts';
import { resolveCustomerReviewLocation } from './reviewLocation';

type TrustedSalon = {
  id: string;
  slug: string;
  name: string;
  settings?: unknown;
  features?: unknown;
  plan?: unknown;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
};

type AvailabilitySlot = { availability?: unknown; startTime?: unknown; time?: unknown };

/**
 * Rebuilds only server-derived booking material for a confirmed assistant
 * review. This performs no writes, provider calls, holds, or checkout work.
 */
export async function prepareCustomerBookingQuote(args: {
  salon: TrustedSalon;
  features: SalonFeatures | null;
  selection: CustomerSelection;
  preference: CustomerDatePreference;
  startTime: string;
  contact: CustomerContact;
  smsConsent?: { granted: boolean; wordingVersion: string; selection: 'default_on' | 'default_off' | 'explicit_on' | 'explicit_off' };
  now?: Date;
}): Promise<CustomerBookingMaterial | null> {
  const now = args.now ?? new Date();
  const settings = (args.salon.settings as SalonSettings | null | undefined) ?? null;
  const bookingConfig = resolveBookingConfigFromSettings(settings);
  const selectedEvaluations = new Map<string, SmartFitEvaluation>();
  const { getAnonymousCustomerBookingAvailability } = await import('@/libs/publicBookingAvailability.server');
  const response = await getAnonymousCustomerBookingAvailability({
    salon: { id: args.salon.id, slug: args.salon.slug },
    date: args.preference.date,
    baseServiceId: args.selection.baseServiceId,
    selectedAddOns: JSON.stringify(args.selection.selectedAddOns),
    trustedClientPhone: args.contact.phone,
    onSmartFitEvaluation: ({ startTime, evaluation }) => {
      if (evaluation.eligible && !selectedEvaluations.has(startTime)) {
        selectedEvaluations.set(startTime, evaluation);
      }
    },
  });
  if (!response.ok) {
    return null;
  }
  const body = await response.json() as { slots?: AvailabilitySlot[] };
  const selected = body.slots?.find(slot => slot.availability === 'available' && slot.startTime === args.startTime);
  if (!selected || typeof selected.time !== 'string') {
    return null;
  }

  const selection = await resolvePublicBookingSelection({
    salonId: args.salon.id,
    baseServiceId: args.selection.baseServiceId,
    selectedAddOns: args.selection.selectedAddOns,
    clientPhone: args.contact.phone,
  });
  const smartFit = applySmartFitOverlay({
    base: selection.automaticDiscount,
    config: resolveSmartFitConfig(settings),
    evaluation: selectedEvaluations.get(args.startTime) ?? null,
    appliedAt: now,
  });
  const taxConfig = resolveTaxConfig(settings, now);
  const totals = computeCheckoutTotals({
    items: [
      { lineTotalCents: selection.services[0]!.priceCents, taxable: taxConfig.taxServicesByDefault },
      ...selection.addOns.map(addOn => ({ lineTotalCents: addOn.lineTotalCents, taxable: taxConfig.taxAddOnsByDefault })),
    ],
    taxConfig,
    discountCents: smartFit.discountAmountCents,
  });
  const [location, depositPolicy] = await Promise.all([
    getPrimaryLocation(args.salon.id),
    getDepositPolicyForSalon({ salonId: args.salon.id, salon: args.salon }),
  ]);
  const charge = resolveDepositChargeForTotal(depositPolicy, smartFit.finalTotalCents, { mode: 'disclosure' });
  if (!charge.required && charge.reason === 'undetermined') {
    return null;
  }
  const disclosure = buildDepositDisclosure(charge);
  if (charge.required && !disclosure) {
    return null;
  }
  const projected = resolveCustomerReviewLocation(args.salon, location);
  if (!projected) {
    return null;
  }
  const mode = resolveBookingSmsMode(settings);
  const smsDecision = resolveBookingSmsConsentDecision(mode, args.smsConsent);
  if (mode !== 'disabled' && !smsDecision) {
    return null;
  }
  const policy = resolveRequiredBookingPolicy({ storedPlan: args.salon.plan ?? null, features: args.features, settings });
  const discount = smartFit.kind === 'smart_fit' ? smartFit.smartFit : smartFit.kind === 'first_visit' ? smartFit.firstVisit : null;
  const review: CustomerReadyReviewSnapshot = {
    status: 'READY',
    fingerprint: 'pending',
    expiresAt: now.toISOString(),
    salon: { id: args.salon.id, name: args.salon.name, slug: args.salon.slug },
    location: projected,
    services: selection.services.map(service => ({ id: service.id, name: service.name, priceCents: service.priceCents })),
    addOns: selection.addOns.map(addOn => ({ id: addOn.id, name: addOn.name, quantity: addOn.quantity, priceCents: addOn.lineTotalCents })),
    technician: { kind: 'any_artist' },
    date: args.preference.date,
    time: selected.time,
    timeZone: bookingConfig.timezone,
    durationMinutes: selection.visibleDurationMinutes,
    financial: { subtotalCents: selection.subtotalBeforeDiscountCents, discountAmountCents: smartFit.discountAmountCents, discountLabel: discount?.discountLabel ?? null, taxAmountCents: totals.taxAmountCents, totalDueCents: totals.totalDueCents, currency: bookingConfig.currency },
    deposit: charge.required ? { status: 'required', amountCents: charge.amountCents, currency: charge.currency.toUpperCase(), label: disclosure!.label } : { status: 'not_required', reason: charge.reason },
    confirmationMode: bookingConfig.confirmationMode,
    bookingPolicy: policy ? { required: true, title: policy.title, text: policy.text, acknowledgmentText: policy.acknowledgment.text, version: policy.version } : { required: false },
    reminders: { mode, selection: args.smsConsent?.selection ?? null, requestedEnabled: smsDecision?.status === 'granted' },
  };
  return { selection: args.selection, preference: args.preference, startTime: args.startTime, technicianSelection: 'any', review, smsConsent: args.smsConsent, expectedTotalCents: smartFit.finalTotalCents, expectedDiscountType: smartFit.kind === 'smart_fit' ? smartFit.smartFit.discountType : smartFit.kind === 'first_visit' ? smartFit.firstVisit.discountType : smartFit.kind === 'reward' ? 'reward' : null, expectedBookingFinancialQuote: { currency: bookingConfig.currency, totalDueCents: totals.totalDueCents, taxConfigurationIdentity: buildTaxConfigurationSnapshot(taxConfig).configurationIdentity }, expectedDepositFingerprint: buildDepositDisclosureFingerprint(charge) };
}
