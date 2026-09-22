import 'server-only';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { resolveRequiredBookingPolicy } from '@/libs/bookingPolicyAcknowledgment';
import { resolveBookingSmsConsentDecision, resolveBookingSmsMode } from '@/libs/bookingSmsConsent';
import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import { buildDepositDisclosure, buildDepositDisclosureFingerprint, resolveDepositChargeForTotal } from '@/libs/depositPolicy';
import { getDepositPolicyForSalon } from '@/libs/depositPolicy.server';
import { resolveNetworkNoShowDepositRequirement } from '@/libs/networkNoShowDeposit.server';
import { resolvePublicBookingSelection } from '@/libs/publicBookingSelection';
import { getLocationById, getPrimaryLocation, getTechnicianById } from '@/libs/queries';
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
  technicianId?: string;
  locationId?: string;
  preference: CustomerDatePreference;
  startTime: string;
  contact: CustomerContact;
  smsConsent?: { granted: boolean; wordingVersion: string; selection: 'default_on' | 'default_off' | 'explicit_on' | 'explicit_off' };
  /** Opaque guest capability. It is resolved server-side and never stored in material. */
  campaignToken?: string;
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
    technicianId: args.technicianId,
    locationId: args.locationId,
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
    technicianId: args.technicianId,
  });
  const smartFit = applySmartFitOverlay({
    base: selection.automaticDiscount,
    config: resolveSmartFitConfig(settings),
    evaluation: selectedEvaluations.get(args.startTime) ?? null,
    appliedAt: now,
  });
  let nextVisitOffer: { campaignId: string; entitlementId: string } | undefined;
  let nextVisitDiscountAmountCents = 0;
  let nextVisitDiscountLabel: string | null = null;
  if (args.campaignToken) {
    const { resolveNextVisitOfferPreview } = await import('@/libs/nextVisitOffer.server');
    const preview = await resolveNextVisitOfferPreview({
      salonId: args.salon.id,
      token: args.campaignToken,
      clientPhone: args.contact.phone,
      startTime: args.startTime,
      // Base services only. Luster's shared promotion calculator intentionally
      // excludes add-ons from this offer's eligible subtotal.
      services: selection.services.map(service => ({ id: service.id, priceCents: service.priceCents })),
      now,
    });
    if (preview?.status === 'eligible' && preview.discountAmountCents > smartFit.discountAmountCents) {
      nextVisitOffer = preview.reference;
      nextVisitDiscountAmountCents = preview.discountAmountCents;
      nextVisitDiscountLabel = preview.label;
    }
  }
  const discountAmountCents = nextVisitOffer ? nextVisitDiscountAmountCents : smartFit.discountAmountCents;
  const finalPreTaxTotalCents = Math.max(0, selection.subtotalBeforeDiscountCents - discountAmountCents);
  const taxConfig = resolveTaxConfig(settings, now);
  const totals = computeCheckoutTotals({
    items: [
      { lineTotalCents: selection.services[0]!.priceCents, taxable: taxConfig.taxServicesByDefault },
      ...selection.addOns.map(addOn => ({ lineTotalCents: addOn.lineTotalCents, taxable: taxConfig.taxAddOnsByDefault })),
    ],
    taxConfig,
    discountCents: discountAmountCents,
  });
  const networkRiskRequired = await resolveNetworkNoShowDepositRequirement({
    salonId: args.salon.id,
    settings,
    phone: args.contact.phone,
    email: args.contact.email,
  });
  const [location, depositPolicy] = await Promise.all([
    args.locationId ? getLocationById(args.locationId, args.salon.id) : getPrimaryLocation(args.salon.id),
    getDepositPolicyForSalon({ salonId: args.salon.id, salon: args.salon, networkRiskRequired }),
  ]);
  if (args.locationId && !location) {
    return null;
  }
  const technician = args.technicianId ? await getTechnicianById(args.technicianId, args.salon.id) : null;
  if (args.technicianId && (!technician || !technician.isActive)) {
    return null;
  }
  const charge = resolveDepositChargeForTotal(depositPolicy, finalPreTaxTotalCents, { mode: 'disclosure' });
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
  const discount = nextVisitOffer
    ? { discountLabel: nextVisitDiscountLabel }
    : smartFit.kind === 'smart_fit' ? smartFit.smartFit : smartFit.kind === 'first_visit' ? smartFit.firstVisit : null;
  const review: CustomerReadyReviewSnapshot = {
    status: 'READY',
    fingerprint: 'pending',
    expiresAt: now.toISOString(),
    salon: { id: args.salon.id, name: args.salon.name, slug: args.salon.slug },
    location: projected,
    services: selection.services.map(service => ({ id: service.id, name: service.name, priceCents: service.priceCents })),
    addOns: selection.addOns.filter(addOn => addOn.priceMode !== 'manual_confirmation').map(addOn => ({ id: addOn.id, name: addOn.name, quantity: addOn.quantity, priceCents: addOn.lineTotalCents })),
    manualConfirmationItems: (selection.manualConfirmationItems ?? []).map(item => ({ id: item.addOnId, name: item.name, quantity: item.quantity, durationMinutes: item.lineDurationMinutes, priceStatus: item.priceStatus })),
    technician: technician ? { kind: 'specific', id: technician.id, name: technician.name } : { kind: 'any_artist' },
    date: args.preference.date,
    time: selected.time,
    timeZone: bookingConfig.timezone,
    durationMinutes: selection.visibleDurationMinutes,
    financial: { subtotalCents: selection.subtotalBeforeDiscountCents, discountAmountCents, discountLabel: discount?.discountLabel ?? null, taxAmountCents: totals.taxAmountCents, totalDueCents: totals.totalDueCents, currency: bookingConfig.currency },
    deposit: charge.required ? { status: 'required', amountCents: charge.amountCents, currency: charge.currency.toUpperCase(), label: disclosure!.label } : { status: 'not_required', reason: charge.reason },
    confirmationMode: !charge.required && selection.l1ConfirmationMode === 'request_approval' ? 'request_approval' : bookingConfig.confirmationMode,
    bookingPolicy: policy ? { required: true, title: policy.title, text: policy.text, acknowledgmentText: policy.acknowledgment.text, version: policy.version } : { required: false },
    reminders: { mode, selection: args.smsConsent?.selection ?? null, requestedEnabled: smsDecision?.status === 'granted' },
  };
  return { catalogAcknowledgment: selection.catalogAcknowledgment, selection: args.selection, preference: args.preference, startTime: args.startTime, technicianSelection: technician ? 'specific' : 'any', ...(technician ? { technicianId: technician.id } : {}), ...(args.locationId ? { locationId: args.locationId } : {}), review, smsConsent: args.smsConsent, expectedTotalCents: finalPreTaxTotalCents, expectedDiscountType: nextVisitOffer ? 'next_visit' : smartFit.kind === 'smart_fit' ? smartFit.smartFit.discountType : smartFit.kind === 'first_visit' ? smartFit.firstVisit.discountType : smartFit.kind === 'reward' ? 'reward' : null, expectedBookingFinancialQuote: { currency: bookingConfig.currency, totalDueCents: totals.totalDueCents, taxConfigurationIdentity: buildTaxConfigurationSnapshot(taxConfig).configurationIdentity }, expectedDepositFingerprint: buildDepositDisclosureFingerprint(charge), ...(nextVisitOffer ? { nextVisitOffer } : {}) };
}
