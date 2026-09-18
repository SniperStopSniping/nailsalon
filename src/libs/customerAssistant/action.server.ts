import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SalonFeatures } from '@/types/salonPolicy';

import { getCustomerAssistantConfig } from './access.server';
import { reserveCustomerAssistantTurn } from './budget.server';
import { buildCustomerProposal } from './catalogue.server';
import type { CustomerAssistantAction, CustomerAssistantResponse, CustomerAssistantResult } from './contracts';
import { signCustomerConversation, verifyCustomerConversation } from './conversation.server';
import { recordCustomerAssistantUsage } from './ledger.server';
import { getCustomerAvailabilityContext, hasOfferedCustomerSlot, lookupCustomerSlots } from './slots.server';

type BoundSalon = { id: string; slug: string };

function unavailable(conversation: string, reason: Extract<CustomerAssistantResult, { kind: 'unavailable' }>['reason']): CustomerAssistantResponse {
  return { conversation, result: { kind: 'unavailable', reason } };
}

/** All actions are deterministic. They use the same replay/IP/session limits as a chat turn. */
export async function runCustomerAssistantAction(args: {
  salon: BoundSalon;
  features: SalonFeatures | null;
  conversation: string;
  action: CustomerAssistantAction;
  clientIp: string;
  now?: Date;
}): Promise<CustomerAssistantResponse> {
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
  const sign = (result: CustomerAssistantResult): CustomerAssistantResponse => {
    try {
      return { conversation: signCustomerConversation(next, config.signingSecret), result };
    } catch {
      return unavailable(args.conversation, 'conversation_used');
    }
  };
  const selected = prior.context?.selection;
  if (!selected) {
    return sign({ kind: 'unavailable', reason: 'selection_changed' });
  }

  let proposal;
  try {
    proposal = await buildCustomerProposal(args.salon.id, args.features, selected);
  } catch {
    next.context = undefined;
    next.booking = undefined;
    return sign({ kind: 'unavailable', reason: 'selection_changed' });
  }
  const acceptedFingerprint = prior.booking?.acceptedFingerprint ?? null;
  const quoteChanged = acceptedFingerprint !== null && acceptedFingerprint !== proposal.fingerprint;
  if (quoteChanged) {
    // A changed quote can be displayed, but it cannot remain accepted.
    next.booking = undefined;
    return sign({ kind: 'proposal', proposal });
  }

  if (args.action.action === 'accept_selection') {
    if (args.action.fingerprint !== proposal.fingerprint) {
      next.booking = undefined;
      return sign({ kind: 'proposal', proposal });
    }
    let availability;
    try {
      availability = await getCustomerAvailabilityContext(args.salon.id, args.now);
    } catch {
      return sign({ kind: 'unavailable', reason: 'unavailable' });
    }
    next.booking = { acceptedFingerprint: proposal.fingerprint, datePreference: null, offeredSlots: [], selectedSlot: null };
    return sign({ kind: 'date_prompt', proposal, ...availability });
  }

  if (acceptedFingerprint !== proposal.fingerprint) {
    return sign({ kind: 'unavailable', reason: 'selection_changed' });
  }
  if (args.action.action === 'choose_date') {
    const preference = { date: args.action.date, earliest: '00:00', latest: '23:59' };
    return slotsForPreference({ args, proposal, next, preference, sign });
  }

  const preference = prior.booking?.datePreference;
  const offered = prior.booking?.offeredSlots ?? [];
  if (!preference || !hasOfferedCustomerSlot(offered, args.action.startTime)) {
    return sign({ kind: 'unavailable', reason: 'selection_changed' });
  }
  let fresh;
  try {
    fresh = await lookupCustomerSlots({
      salon: args.salon,
      features: args.features,
      selection: proposal.selection,
      preference,
      now: args.now,
      requiredStartTime: args.action.startTime,
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
  const slot = fresh.selected;
  if (!slot) {
    next.booking = { acceptedFingerprint, datePreference: preference, offeredSlots: fresh.slots, selectedSlot: null };
    return sign({ kind: 'slots', proposal: fresh.proposal, preference, timeZone: fresh.timeZone, slots: fresh.slots, checkedAt: (args.now ?? new Date()).toISOString(), slotDisappeared: true });
  }
  next.booking = { acceptedFingerprint, datePreference: preference, offeredSlots: fresh.slots, selectedSlot: slot };
  await recordDeterministicOutcome(args.salon.id, 'slot_selected');
  return sign({ kind: 'slot_selected', proposal: fresh.proposal, preference, timeZone: fresh.timeZone, slot });
}

async function slotsForPreference(args: {
  args: Parameters<typeof runCustomerAssistantAction>[0];
  proposal: Awaited<ReturnType<typeof buildCustomerProposal>>;
  next: ReturnType<typeof verifyCustomerConversation> & { turnIndex: number };
  preference: { date: string; earliest: string; latest: string };
  sign: (result: CustomerAssistantResult) => CustomerAssistantResponse;
}): Promise<CustomerAssistantResponse> {
  let fresh;
  try {
    fresh = await lookupCustomerSlots({
      salon: args.args.salon,
      features: args.args.features,
      selection: args.proposal.selection,
      preference: args.preference,
      now: args.args.now,
    });
  } catch {
    return args.sign({ kind: 'unavailable', reason: 'unavailable' });
  }
  if (!fresh) {
    return args.sign({ kind: 'unavailable', reason: 'unavailable' });
  }
  if (fresh.quoteChanged || fresh.proposal.fingerprint !== args.proposal.fingerprint) {
    args.next.booking = undefined;
    return args.sign({ kind: 'proposal', proposal: fresh.proposal });
  }
  args.next.booking = { acceptedFingerprint: args.proposal.fingerprint, datePreference: args.preference, offeredSlots: fresh.slots, selectedSlot: null };
  await recordDeterministicOutcome(args.args.salon.id, 'availability');
  return args.sign({ kind: 'slots', proposal: fresh.proposal, preference: args.preference, timeZone: fresh.timeZone, slots: fresh.slots, checkedAt: (args.args.now ?? new Date()).toISOString() });
}

async function recordDeterministicOutcome(salonId: string, outcome: 'availability' | 'slot_selected'): Promise<void> {
  try {
    await recordCustomerAssistantUsage({ salonId, attemptId: randomUUID(), outcome, usage: null, latencyMs: 0, deterministic: true });
  } catch {
    // This audit evidence does not authorize an external action and must not
    // make a purely read-only availability response look confirmed.
  }
}
