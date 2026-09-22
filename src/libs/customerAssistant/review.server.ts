import 'server-only';

import { createHash } from 'node:crypto';

import type { BookingSmsConsentInput } from '@/libs/bookingSmsConsent';
import type { SalonFeatures } from '@/types/salonPolicy';

import { getCustomerAssistantConfig } from './access.server';
import { reserveCustomerAssistantTurn } from './budget.server';
import type { CustomerContact } from './contact';
import type { CustomerAssistantResult } from './contracts';
import { signCustomerConversation, verifyCustomerConversation } from './conversation.server';
import { recordCustomerAssistantUsage } from './ledger.server';
import { customerBookingOperationReference, prepareCustomerBookingOperation } from './operationStore.server';
import { prepareCustomerBookingQuote } from './prepareQuote.server';
import { assessReadyCustomerProposal } from './readiness.server';
import type { CustomerReviewResponse } from './reviewContracts';
import { completeCustomerRevision } from './revision.server';
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

/** Revalidates the final card and durably identifies an explicit future action. */
export async function prepareCustomerAssistantReview(args: {
  salon: ReviewSalon;
  features: SalonFeatures | null;
  conversation: string;
  contact: CustomerContact;
  clientIp: string;
  smsConsent?: BookingSmsConsentInput;
  expectedRevision?: number;
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
    conversation: args.conversation,
    clientIp: args.clientIp,
    now: args.now,
  });
  if (!reservation.ok) {
    return unavailable(args.conversation, reservation.reason);
  }
  const next = { ...prior, turnIndex: prior.turnIndex + 1 };
  const sign = async (result: CustomerReviewResponse['result']): Promise<CustomerReviewResponse> => {
    try {
      const conversation = signCustomerConversation(next, config.signingSecret);
      if (!await completeCustomerRevision(next, conversation)) {
        return unavailable(args.conversation, 'stale_conversation');
      }
      return { conversation, result };
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

  try {
    const assessment = await assessReadyCustomerProposal({ salonId: args.salon.id, features: args.features, state: prior });
    if (assessment.clarification) {
      next.booking = undefined;
      next.context = { question: assessment.clarification.question, options: assessment.clarification.options, selection };
      return sign(assessment.clarification);
    }
    if (!assessment.proposal) {
      return sign({ kind: 'unavailable', reason: 'selection_changed' });
    }
  } catch {
    return sign({ kind: 'unavailable', reason: 'unavailable' });
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
    const preparedMaterial = await prepareCustomerBookingQuote({
      salon: args.salon,
      features: args.features,
      selection,
      preference,
      startTime: fresh.selected.startTime,
      contact: args.contact,
      smsConsent: args.smsConsent,
      now: args.now,
    });
    const manualItems = preparedMaterial?.review.manualConfirmationItems ?? [];
    const currentProduct = prior.facts?.existingProduct;
    const material = preparedMaterial && manualItems.length > 0
      ? {
          ...preparedMaterial,
          manualConfirmationContext: {
            currentProduct: currentProduct && ['gel_x', 'builder_gel', 'acrylic', 'gel_polish'].includes(currentProduct) ? currentProduct as 'gel_x' | 'builder_gel' | 'acrylic' | 'gel_polish' : 'unknown' as const,
            itemIds: manualItems.map(item => item.id),
          },
        }
      : preparedMaterial;
    if (!material || material.review.timeZone !== fresh.timeZone || material.review.financial.currency !== fresh.proposal.currency) {
      return sign({ kind: 'unavailable', reason: 'selection_changed' });
    }
    const operation = await prepareCustomerBookingOperation({
      salonId: args.salon.id,
      sessionId: prior.sessionId,
      secret: config.signingSecret,
      contact: args.contact,
      material,
      expectedRevision: args.expectedRevision ?? 0,
      now: args.now,
    });
    const review = operation.material.review;
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
    return sign({ kind: 'booking_review', review, operation: customerBookingOperationReference(operation, config.signingSecret) });
  } catch {
    return sign({ kind: 'unavailable', reason: 'unavailable' });
  }
}
