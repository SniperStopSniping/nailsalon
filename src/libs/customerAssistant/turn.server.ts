import 'server-only';

import { randomUUID } from 'node:crypto';

import { createOpenAiResponsesProvider } from '@/libs/ai/openaiResponses.server';
import { ModelProviderError, type ModelProviderUsage, type OwnerAssistantModelProvider } from '@/libs/ai/provider';
import type { SalonFeatures } from '@/types/salonPolicy';

import { getCustomerAssistantConfig } from './access.server';
import { reserveCustomerAssistantTurn } from './budget.server';
import { buildCustomerProposal, loadCustomerClarificationSnapshot, loadCustomerMenu, validateCustomerMenuSelection } from './catalogue.server';
import { planCustomerClarification } from './clarification';
import { CUSTOMER_ASSISTANT_MAX_INPUT_BYTES, CUSTOMER_ASSISTANT_MAX_OUTPUT_TOKENS, CUSTOMER_ASSISTANT_MODEL, type CustomerAssistantLocale, type CustomerAssistantResponse, type CustomerAssistantResult } from './contracts';
import { signCustomerConversation, verifyCustomerConversation } from './conversation.server';
import { CUSTOMER_INTERPRETATION_JSON_SCHEMA, CUSTOMER_INTERPRETATION_PROMPT, customerInterpretationSchema } from './interpretation';
import { recordCustomerAssistantUsage } from './ledger.server';
import { emptyFacts, hasKnownClarificationAnswer, mergeFacts } from './semanticFacts';
import { resolveSemanticSelection, selectionConflictsWithExplicitFacts } from './semanticSelection';
import { getCustomerAvailabilityContext, lookupCustomerSlots } from './slots.server';

/** One bounded model call, no owner dispatcher, no writable model tool. */
export async function runCustomerAssistantTurn(args: {
  salonId: string;
  /** Route-resolved public slug; never supplied by model or request JSON. */
  salonSlug: string;
  salonName?: string;
  features: SalonFeatures | null;
  conversation: string;
  message: string;
  locale: CustomerAssistantLocale;
  clientIp: string;
}, provider?: OwnerAssistantModelProvider): Promise<CustomerAssistantResponse> {
  const unavailable = (reason: Extract<CustomerAssistantResult, { kind: 'unavailable' }>['reason']): CustomerAssistantResponse => ({
    conversation: args.conversation,
    result: { kind: 'unavailable', reason },
  });
  const config = getCustomerAssistantConfig();
  if (!config) {
    return unavailable('unavailable');
  }
  let conversation;
  try {
    conversation = verifyCustomerConversation(args.conversation, args.salonId, config.signingSecret);
  } catch {
    return unavailable('invalid_conversation');
  }
  const reservation = await reserveCustomerAssistantTurn({
    salonId: args.salonId,
    sessionId: conversation.sessionId,
    turnIndex: conversation.turnIndex,
    clientIp: args.clientIp,
  });
  if (!reservation.ok) {
    return unavailable(reservation.reason);
  }

  const messages = [...conversation.messages, args.message];
  const nextState = { ...conversation, messages, turnIndex: conversation.turnIndex + 1 };
  // Validate bounded Unicode/token size before any model call. The customer
  // receives the prior token on failure and can continue manually.
  try {
    signCustomerConversation(nextState, config.signingSecret);
  } catch {
    return unavailable('conversation_used');
  }
  const attemptId = randomUUID();
  let usage: ModelProviderUsage | null = null;
  let result: CustomerAssistantResult = { kind: 'unavailable', reason: 'unavailable' };
  const started = performance.now();
  try {
    const menu = await loadCustomerMenu(args.salonId, args.features);
    if (conversation.context?.selection) {
      try {
        validateCustomerMenuSelection(menu, conversation.context.selection);
      } catch {
        nextState.context = undefined;
        return { conversation: signCustomerConversation(nextState, config.signingSecret), result: { kind: 'unavailable', reason: 'selection_changed' } };
      }
    }
    const availabilityContext = await getCustomerAvailabilityContext(args.salonId);
    const data = JSON.stringify({
      locale: args.locale,
      bookingSalon: { name: args.salonName ?? args.salonSlug, slug: args.salonSlug },
      previousFacts: conversation.facts ?? emptyFacts(),
      menu,
      customerMessages: messages,
      lastShown: conversation.context ?? null,
      bookingState: conversation.booking ?? null,
      ...availabilityContext,
    });
    if (Buffer.byteLength(CUSTOMER_INTERPRETATION_PROMPT + data, 'utf8') > CUSTOMER_ASSISTANT_MAX_INPUT_BYTES) {
      return { conversation: signCustomerConversation(nextState, config.signingSecret), result };
    }
    // Durable reservation BEFORE network: a failed outcome write still leaves
    // conservative unknown-spend evidence, and a failed reservation makes no call.
    await recordCustomerAssistantUsage({ salonId: args.salonId, attemptId, outcome: 'reserved', usage: null, latencyMs: 0 });
    const response = await (provider ?? createOpenAiResponsesProvider({ apiKey: config.apiKey })).createResponse({
      model: CUSTOMER_ASSISTANT_MODEL,
      input: [{ role: 'system', content: CUSTOMER_INTERPRETATION_PROMPT }, { role: 'user', content: data }],
      tools: [],
      toolChoice: 'none',
      reasoningEffort: 'low',
      jsonMode: 'schema',
      jsonSchema: CUSTOMER_INTERPRETATION_JSON_SCHEMA,
      maxOutputTokens: CUSTOMER_ASSISTANT_MAX_OUTPUT_TOKENS,
      timeoutMs: 15_000,
    });
    usage = response.usage;
    if (response.status !== 'completed' || response.items.some(item => item.type === 'function_call' || item.type === 'refusal')) {
      throw new Error('CUSTOMER_MODEL_INVALID');
    }
    const text = response.items.filter(item => item.type === 'message').map(item => item.text).join('');
    if (text.length > 12_000) {
      throw new Error('CUSTOMER_MODEL_INVALID');
    }
    const intent = customerInterpretationSchema.parse(JSON.parse(text));
    const previousFacts = conversation.facts ?? emptyFacts();
    const facts = mergeFacts(previousFacts, intent.factUpdates);
    nextState.facts = facts;
    if (JSON.stringify(facts) !== JSON.stringify(previousFacts)) {
      // A previously accepted catalog selection cannot authorize changed intent.
      nextState.booking = undefined;
      nextState.context = undefined;
    }
    const resolveServiceIntent = intent.action === 'propose'
      || (intent.action === 'clarify' && intent.question !== 'date' && (menu.l1 || hasKnownClarificationAnswer(intent.question, facts)));
    if (resolveServiceIntent) {
      let resolved = resolveSemanticSelection({
        menu,
        facts,
        candidate: intent.serviceId ? { baseServiceId: intent.serviceId, selectedAddOns: intent.addOns } : null,
      });
      if (menu.l1) {
        const requestedQuestion = intent.action === 'clarify' ? intent.question : resolved.kind === 'clarification' ? resolved.question : 'details';
        if (requestedQuestion === 'date') {
          throw new Error('CUSTOMER_MODEL_INVALID');
        }
        resolved = planCustomerClarification({
          menu,
          action: intent.action === 'propose' ? 'propose' : 'clarify',
          snapshot: await loadCustomerClarificationSnapshot(args.salonId),
          facts,
          candidate: intent.serviceId ? { baseServiceId: intent.serviceId, selectedAddOns: intent.addOns } : null,
          question: requestedQuestion,
          optionIds: intent.optionIds,
        });
      }
      if (resolved.kind === 'no_match') {
        result = { kind: 'unavailable', reason: 'no_match' };
      } else if (resolved.kind === 'clarification') {
        const labels = resolved.optionIds.map(id => [...menu.services, ...menu.addOns].find(item => item.id === id)?.name);
        if (labels.includes(undefined)) {
          throw new Error('CUSTOMER_MODEL_INVALID');
        }
        result = { kind: 'clarification', question: resolved.question, options: labels as string[] };
      } else {
        const proposal = await buildCustomerProposal(args.salonId, args.features, resolved.selection);
        // L1 may apply required/automatic selections. Never silently promise a
        // choice that contradicts the facts after that authoritative resolution.
        if (selectionConflictsWithExplicitFacts(menu, facts, {
          baseServiceId: proposal.service.id,
          selectedAddOns: proposal.addOns.map(item => ({ addOnId: item.id, quantity: item.quantity })),
        })) {
          result = { kind: 'unavailable', reason: 'selection_changed' };
        } else {
          result = { kind: 'proposal', proposal };
        }
      }
    } else if (intent.action === 'availability' && conversation.context?.selection && nextState.booking?.acceptedFingerprint && intent.datePreference) {
      const fresh = await lookupCustomerSlots({
        salon: { id: args.salonId, slug: args.salonSlug },
        features: args.features,
        selection: conversation.context.selection,
        preference: intent.datePreference,
      });
      if (!fresh) {
        result = { kind: 'unavailable', reason: 'unavailable' };
      } else if (fresh.quoteChanged || fresh.proposal.fingerprint !== nextState.booking.acceptedFingerprint) {
        nextState.booking = undefined;
        result = { kind: 'proposal', proposal: fresh.proposal };
      } else {
        result = {
          kind: 'slots',
          proposal: fresh.proposal,
          preference: intent.datePreference,
          timeZone: fresh.timeZone,
          slots: fresh.slots,
          checkedAt: new Date().toISOString(),
        };
      }
    } else if (intent.action === 'availability' && conversation.context?.selection && nextState.booking?.acceptedFingerprint) {
      result = { kind: 'clarification', question: 'date', options: [] };
    } else if (intent.action === 'clarify') {
      if (intent.question === 'date' && !(conversation.context?.selection && nextState.booking?.acceptedFingerprint)) {
        result = { kind: 'unavailable', reason: 'no_match' };
      } else {
      // Only current public labels can become chips. Unknown/cross-tenant IDs
      // and unrelated add-ons invalidate the answer instead of being echoed.
        const eligibleAddOnIds = new Set(menu.bindings.filter(binding => binding.serviceId === intent.serviceId).map(binding => binding.addOnId));
        const choices = [...menu.services, ...menu.addOns.filter(item => eligibleAddOnIds.has(item.id))];
        const options = intent.optionIds.map(id => choices.find(item => item.id === id)?.name);
        if (options.includes(undefined)) {
          throw new Error('CUSTOMER_MODEL_INVALID');
        }
        result = { kind: 'clarification', question: intent.question, options: options as string[] };
      }
    } else {
      result = { kind: 'unavailable', reason: 'no_match' };
    }
  } catch (error) {
    if (error instanceof ModelProviderError) {
      usage = error.usage;
    }
    // Provider and catalogue exceptions may carry untrusted text. Never log
    // them or forward their messages, stack-attached rows or responses.
    result = { kind: 'unavailable', reason: 'unavailable' };
  }
  try {
    await recordCustomerAssistantUsage({
      salonId: args.salonId,
      attemptId,
      usage,
      latencyMs: performance.now() - started,
      outcome: result.kind === 'unavailable'
        ? (result.reason === 'no_match' ? 'no_match' : 'failed')
        : result.kind === 'slots'
          ? 'availability'
          : result.kind,
    });
  } catch {
    result = { kind: 'unavailable', reason: 'unavailable' };
  }
  if (result.kind === 'proposal') {
    nextState.context = { question: null, options: [], selection: result.proposal.selection };
    if (nextState.booking?.acceptedFingerprint !== result.proposal.fingerprint) {
      nextState.booking = undefined;
    }
  } else if (result.kind === 'clarification') {
    nextState.context = {
      question: result.question,
      options: result.options,
      selection: result.question === 'date' ? conversation.context?.selection ?? null : null,
    };
  }
  if (result.kind === 'slots') {
    nextState.booking = {
      acceptedFingerprint: result.proposal.fingerprint,
      datePreference: result.preference,
      offeredSlots: result.slots,
      selectedSlot: null,
    };
  }
  try {
    return { conversation: signCustomerConversation(nextState, config.signingSecret), result };
  } catch {
    return unavailable('conversation_used');
  }
}
