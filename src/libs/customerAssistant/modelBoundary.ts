import type { CustomerConversation } from './conversation.server';

export const CUSTOMER_MODEL_CONTEXT_VERSION = 1;

/**
 * The signed display/booking window is deliberately NOT a model transcript.
 * Older windows may contain Calendar-derived times and rendered summaries.
 * Only history written by this boundary may enter a new provider request.
 */
export function customerServiceConversation(conversation: CustomerConversation): CustomerConversation {
  const trusted = conversation.modelContextVersion === CUSTOMER_MODEL_CONTEXT_VERSION;
  return {
    version: conversation.version,
    lastActivityAtMs: conversation.lastActivityAtMs,
    salonId: conversation.salonId,
    sessionId: conversation.sessionId,
    issuedAtMs: conversation.issuedAtMs,
    expiresAtMs: conversation.expiresAtMs,
    turnIndex: conversation.turnIndex,
    messages: [],
    dialogue: trusted ? conversation.modelDialogue ?? [] : [],
    facts: conversation.facts,
    requestedSelection: conversation.requestedSelection,
    subjects: conversation.subjects,
    priorSubjects: conversation.priorSubjects,
    unsupportedRequest: trusted ? conversation.unsupportedRequest : undefined,
    context: trusted ? conversation.modelServiceContext : undefined,
  };
}

/** Kept separate from booking/display state even after a legacy handoff. */
export function rememberCustomerServiceContext(state: CustomerConversation): void {
  const context = state.context;
  if (context && context.question !== 'date') {
    state.modelServiceContext = {
      question: context.question,
      ...(context.answerTopic ? { answerTopic: context.answerTopic } : {}),
      options: [...context.options],
      selection: context.selection,
    };
  }
}
