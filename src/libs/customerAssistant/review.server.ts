import 'server-only';

import { createHash } from 'node:crypto';

import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { resolveRequiredBookingPolicy } from '@/libs/bookingPolicyAcknowledgment';
import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import { buildDepositDisclosure, resolveDepositChargeForTotal } from '@/libs/depositPolicy';
import { getDepositPolicyForSalon } from '@/libs/depositPolicy.server';
import { buildDirectionsDestination, resolveDirectionsLocation } from '@/libs/directions';
import { getPrimaryLocation } from '@/libs/queries';
import { applyLocationDisplayMode } from '@/libs/salonContent';
import { resolveTaxConfig } from '@/libs/taxConfig';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

import { getCustomerAssistantConfig } from './access.server';
import { reserveCustomerAssistantTurn } from './budget.server';
import type { CustomerContact } from './contact';
import { createCustomerContactBinding } from './contact.server';
import type { CustomerAssistantResult } from './contracts';
import { signCustomerConversation, verifyCustomerConversation } from './conversation.server';
import { recordCustomerAssistantUsage } from './ledger.server';
import type { CustomerReviewResponse, CustomerReviewSnapshot } from './reviewContracts';
import { lookupCustomerSlots } from './slots.server';

type ReviewSalon = {
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

function unavailable(conversation: string, reason: Extract<CustomerAssistantResult, { kind: 'unavailable' }>['reason']): CustomerReviewResponse {
  return { conversation, result: { kind: 'unavailable', reason } };
}

function reviewFingerprint(args: { contactBinding: string; review: Omit<CustomerReviewSnapshot, 'fingerprint' | 'expiresAt'> }): string {
  return createHash('sha256').update(JSON.stringify({
    domain: 'luster.customer-review.v1',
    contactBinding: args.contactBinding,
    review: args.review,
  }), 'utf8').digest('hex');
}

/**
 * Produces an explicitly incomplete review only. It does not create a hold,
 * appointment, customer record, payment session, message, or consent state.
 */
export async function prepareCustomerAssistantReview(args: {
  salon: ReviewSalon;
  features: SalonFeatures | null;
  conversation: string;
  contact: CustomerContact;
  clientIp: string;
  now?: Date;
}): Promise<CustomerReviewResponse> {
  const config = getCustomerAssistantConfig();
  if (!config) {
    return unavailable(args.conversation, 'unavailable');
  }
  let prior;
  try {
    prior = verifyCustomerConversation(args.conversation, args.salon.id, config.signingSecret, args.now?.getTime());
  } catch {
    return unavailable(args.conversation, 'invalid_conversation');
  }
  const reservation = await reserveCustomerAssistantTurn({
    salonId: args.salon.id,
    sessionId: prior.sessionId,
    turnIndex: prior.turnIndex,
    clientIp: args.clientIp,
    now: args.now,
  });
  if (!reservation.ok) {
    return unavailable(args.conversation, reservation.reason);
  }
  const next = { ...prior, turnIndex: prior.turnIndex + 1 };
  const sign = (result: CustomerReviewResponse['result']): CustomerReviewResponse => {
    try {
      return { conversation: signCustomerConversation(next, config.signingSecret), result };
    } catch {
      return unavailable(args.conversation, 'conversation_used');
    }
  };
  const selection = prior.context?.selection;
  const preference = prior.booking?.datePreference;
  const selectedSlot = prior.booking?.selectedSlot;
  const acceptedFingerprint = prior.booking?.acceptedFingerprint;
  if (!selection || !preference || !selectedSlot || !acceptedFingerprint) {
    return sign({ kind: 'unavailable', reason: 'selection_changed' });
  }

  let fresh;
  try {
    fresh = await lookupCustomerSlots({
      salon: { id: args.salon.id, slug: args.salon.slug },
      features: args.features,
      selection,
      preference,
      requiredStartTime: selectedSlot.startTime,
      now: args.now,
    });
  } catch {
    return sign({ kind: 'unavailable', reason: 'unavailable' });
  }
  if (!fresh) {
    return sign({ kind: 'unavailable', reason: 'unavailable' });
  }
  if (fresh.quoteChanged || fresh.proposal.fingerprint !== acceptedFingerprint) {
    next.booking = undefined;
    return sign({ kind: 'proposal', proposal: fresh.proposal });
  }
  if (!fresh.selected) {
    next.booking = {
      acceptedFingerprint,
      datePreference: preference,
      offeredSlots: fresh.slots,
      selectedSlot: null,
    };
    return sign({
      kind: 'slots',
      proposal: fresh.proposal,
      preference,
      timeZone: fresh.timeZone,
      slots: fresh.slots,
      checkedAt: (args.now ?? new Date()).toISOString(),
      slotDisappeared: true,
    });
  }

  try {
    const [bookingConfig, location, depositPolicy] = await Promise.all([
      getBookingConfigForSalon(args.salon.id),
      getPrimaryLocation(args.salon.id),
      getDepositPolicyForSalon({ salonId: args.salon.id, salon: args.salon }),
    ]);
    if (bookingConfig.timezone !== fresh.timeZone || bookingConfig.currency !== fresh.proposal.currency || (!depositPolicy.active && depositPolicy.reason === 'undetermined')) {
      return sign({ kind: 'unavailable', reason: 'unavailable' });
    }
    const displayMode = resolveBookingPageContent(args.salon.settings).live.locationDisplayMode;
    const resolvedLocation = resolveDirectionsLocation(location);
    const projectedLocation = resolvedLocation
      ? applyLocationDisplayMode({
        name: resolvedLocation.name,
        address: resolvedLocation.address,
        city: resolvedLocation.city,
        state: resolvedLocation.state,
        zipCode: resolvedLocation.zipCode,
      }, displayMode)
      : buildDirectionsDestination(args.salon)
        ? applyLocationDisplayMode({
          name: args.salon.name,
          address: args.salon.address ?? null,
          city: args.salon.city ?? null,
          state: args.salon.state ?? null,
          zipCode: args.salon.zipCode ?? null,
        }, displayMode)
        : null;
    if (!projectedLocation) {
      return sign({ kind: 'unavailable', reason: 'unavailable' });
    }
    const taxConfig = resolveTaxConfig((args.salon.settings as SalonSettings | null | undefined) ?? null, args.now ?? new Date());
    const totals = computeCheckoutTotals({
      items: [
        { lineTotalCents: fresh.proposal.service.priceCents, taxable: taxConfig.taxServicesByDefault },
        ...fresh.proposal.addOns.map(addOn => ({ lineTotalCents: addOn.priceCents, taxable: taxConfig.taxAddOnsByDefault })),
      ],
      taxConfig,
    });
    // Deposits follow the authoritative booking path's post-discount service
    // total, excluding tax. This review is explicitly undiscounted because it
    // must not query anonymous identity/reward/Smart Fit eligibility.
    const charge = resolveDepositChargeForTotal(depositPolicy, fresh.proposal.subtotalCents, { mode: 'disclosure' });
    if (!charge.required && charge.reason === 'undetermined') {
      return sign({ kind: 'unavailable', reason: 'unavailable' });
    }
    const disclosure = buildDepositDisclosure(charge);
    const contactBinding = createCustomerContactBinding({
      secret: config.signingSecret,
      salonId: args.salon.id,
      sessionId: prior.sessionId,
      contact: args.contact,
    });
    if (charge.required && !disclosure) {
      return sign({ kind: 'unavailable', reason: 'unavailable' });
    }
    const deposit = charge.required
      ? { status: 'required' as const, amountCents: charge.amountCents, currency: charge.currency.toUpperCase(), label: disclosure!.label }
      : { status: 'not_required' as const, reason: charge.reason };
    const base: Omit<CustomerReviewSnapshot, 'fingerprint' | 'expiresAt'> = {
      status: 'INCOMPLETE',
      salon: { id: args.salon.id, name: args.salon.name, slug: args.salon.slug },
      location: projectedLocation,
      services: [{ id: fresh.proposal.service.id, name: fresh.proposal.service.name, priceCents: fresh.proposal.service.priceCents }],
      addOns: fresh.proposal.addOns.map(addOn => ({ id: addOn.id, name: addOn.name, quantity: addOn.quantity, priceCents: addOn.priceCents })),
      technician: { kind: 'any_artist' },
      date: preference.date,
      time: fresh.selected.time,
      timeZone: fresh.timeZone,
      durationMinutes: fresh.proposal.durationMinutes,
      financial: {
        subtotalCents: fresh.proposal.subtotalCents,
        estimatedTaxCents: totals.taxAmountCents,
        estimatedTotalCents: totals.totalDueCents,
        currency: bookingConfig.currency,
      },
      deposit,
      confirmationMode: bookingConfig.confirmationMode,
      bookingPolicy: (() => {
        const policy = resolveRequiredBookingPolicy({
          storedPlan: args.salon.plan ?? null,
          features: args.features,
          settings: (args.salon.settings as SalonSettings | null | undefined) ?? null,
        });
        return policy
          ? { required: true as const, title: policy.title, text: policy.text, acknowledgmentText: policy.acknowledgment.text, version: policy.version }
          : { required: false as const };
      })(),
      blockers: ['reminder_integration', 'identity_pricing'],
    };
    const review: CustomerReviewSnapshot = {
      ...base,
      fingerprint: reviewFingerprint({ contactBinding, review: base }),
      expiresAt: new Date((args.now ?? new Date()).getTime() + 5 * 60_000).toISOString(),
    };
    try {
      await recordCustomerAssistantUsage({
        salonId: args.salon.id,
        attemptId: createHash('sha256').update(`${prior.sessionId}:${prior.turnIndex}:review`, 'utf8').digest('hex'),
        outcome: 'review_prepared',
        usage: null,
        latencyMs: 0,
        deterministic: true,
      });
    } catch {
      // Audit unavailability cannot turn a read-only preflight into a booking.
    }
    return sign({ kind: 'review_prepared', review });
  } catch {
    return sign({ kind: 'unavailable', reason: 'unavailable' });
  }
}
