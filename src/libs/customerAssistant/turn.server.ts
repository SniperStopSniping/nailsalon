import 'server-only';

import { randomUUID } from 'node:crypto';

import { createOpenAiResponsesProvider } from '@/libs/ai/openaiResponses.server';
import { ModelProviderError, type ModelProviderUsage, type OwnerAssistantModelProvider } from '@/libs/ai/provider';
import type { SalonFeatures } from '@/types/salonPolicy';

import { getCustomerAssistantConfig } from './access.server';
import { reserveCustomerAssistantTurn } from './budget.server';
import { buildCustomerProposal, loadCustomerClarificationSnapshot, loadCustomerMenu, validateCustomerMenuSelection } from './catalogue.server';
import { CUSTOMER_ASSISTANT_MAX_INPUT_BYTES, CUSTOMER_ASSISTANT_MAX_OUTPUT_TOKENS, CUSTOMER_ASSISTANT_MODEL, type CustomerAssistantLocale, type CustomerAssistantResponse, type CustomerAssistantResult } from './contracts';
import { advanceCustomerConversation, conversationInvalidReason, signCustomerConversation, verifyCustomerConversation } from './conversation.server';
import { CUSTOMER_INTERPRETATION_JSON_SCHEMA, CUSTOMER_INTERPRETATION_PROMPT, customerInterpretationSchema } from './interpretation';
import { recordCustomerAssistantUsage } from './ledger.server';
import { applyCustomerTurnResult, resolveCustomerTurn } from './resolveTurn';
import { emptyFacts } from './semanticFacts';
import { getCustomerAvailabilityContext, lookupCustomerSlots, lookupNextCustomerSlots } from './slots.server';
import { readCompletedCustomerTurn, storeCompletedCustomerTurn } from './turnReplay.server';

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
  } catch (error) {
    return unavailable(conversationInvalidReason(error));
  }
  const completed = await readCompletedCustomerTurn(args, config.signingSecret);
  if (completed) {
    return completed;
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

  const messages = [...conversation.messages, args.message].slice(-16);
  const nextState = { ...advanceCustomerConversation(conversation), messages };
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
      requestedSelection: conversation.requestedSelection ?? null,
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
    result = await resolveCustomerTurn(args, menu, intent, conversation, nextState, { buildCustomerProposal, loadCustomerClarificationSnapshot, lookupCustomerSlots, lookupNextCustomerSlots });
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
        : (result.kind === 'slots' || result.kind === 'date_prompt')
            ? 'availability'
            : result.kind,
    });
  } catch {
    result = { kind: 'unavailable', reason: 'unavailable' };
  }
  applyCustomerTurnResult(nextState, result);
  try {
    const response = { conversation: signCustomerConversation(nextState, config.signingSecret), result };
    await storeCompletedCustomerTurn(args, response);
    return response;
  } catch {
    return unavailable('session_limit');
  }
}
