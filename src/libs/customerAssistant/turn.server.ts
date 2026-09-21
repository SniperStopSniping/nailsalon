import 'server-only';

import { randomUUID } from 'node:crypto';

import { customerAssistantCopy } from '@/components/customerAssistant/copy';
import { createOpenAiResponsesProvider } from '@/libs/ai/openaiResponses.server';
import { ModelProviderError, type ModelProviderUsage, type OwnerAssistantModelProvider } from '@/libs/ai/provider';
import { getNextVisitOfferAssistantFacts, type NextVisitOfferAssistantFacts } from '@/libs/nextVisitOffer.server';
import type { SalonFeatures } from '@/types/salonPolicy';

import { getCustomerAssistantConfig } from './access.server';
import { compactCustomerModelContext } from './boundedModelContext';
import { reserveCustomerAssistantTurn } from './budget.server';
import { buildCustomerProposal, loadCustomerClarificationSnapshot, loadCustomerMenu, validateCustomerMenuSelection } from './catalogue.server';
import { customerPartialQuoteSelection } from './consultation';
import { CUSTOMER_ASSISTANT_MAX_INPUT_BYTES, CUSTOMER_ASSISTANT_MAX_OUTPUT_TOKENS, CUSTOMER_ASSISTANT_MODEL, type CustomerAssistantLocale, type CustomerAssistantResponse, type CustomerAssistantResult } from './contracts';
import { advanceCustomerConversation, conversationInvalidReason, signCustomerConversation, verifyCustomerConversation } from './conversation.server';
import { projectCustomerInterpreterMenu } from './interpreterMenu';
import { recordCustomerAssistantUsage } from './ledger.server';
import { aggregateCustomerAssistantStageUsage, CUSTOMER_ASSISTANT_INTERPRETATION_SCHEMA_BYTES, type CustomerAssistantStageUsage } from './modelPricing';
import { loadCustomerPublicFacts } from './publicFacts.server';
import { createReceptionistTurnSchema, isRecoverableResult, RECEPTIONIST_TURN_PROMPT, receptionistContext, receptionistTurnSchema, renderReceptionistTurn } from './receptionistTurn';
import { applyCustomerTurnResult, resolveCustomerTurn } from './resolveTurn';
import { completeCustomerRevision } from './revision.server';
import { emptyFacts } from './semanticFacts';
import { selectionConflictsWithExplicitFacts, semanticCatalog } from './semanticSelection';
import { getCustomerAvailabilityContext, lookupCustomerSlots, lookupNextCustomerSlots } from './slots.server';
import { CustomerTurnTiming } from './timing';
import { readCompletedCustomerTurn, storeCompletedCustomerTurn } from './turnReplay.server';

function nextVisitOfferFact(args: {
  offer: NextVisitOfferAssistantFacts;
  menu: Awaited<ReturnType<typeof loadCustomerMenu>>;
  locale: CustomerAssistantLocale;
  hasSelectedService: boolean;
}): string {
  const { offer, menu, locale } = args;
  const fr = locale === 'fr';
  const discount = offer.promotion.discountType === 'percent'
    ? `${offer.promotion.value}%`
    : new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: offer.currency }).format(offer.promotion.value / 100);
  const eligibleNames = offer.promotion.eligibleServiceIds.length === 0
    ? (fr ? 'tous les services admissibles' : 'all eligible services')
    : menu.services.filter(service => offer.promotion.eligibleServiceIds.includes(service.id)).slice(0, 8).map(service => service.name).join(', ') || (fr ? 'les services configurés pour cette offre' : 'the services configured for this offer');
  const common = fr
    ? ' Une seule promotion s’applique. Luster compare cette offre avec la réduction automatique disponible pour cette réservation et affiche la réduction utilisée avant la confirmation.'
    : ' One promotional discount applies. Luster compares this offer with the automatic discount available for this booking and shows the discount used before confirmation.';
  if (offer.kind === 'program') {
    return fr
      ? `Programme prochaine visite : après un rendez-vous admissible terminé, économisez ${discount} lorsque le prochain rendez-vous admissible a lieu dans les ${offer.promotion.expiryDays} jours. Il s’applique à ${eligibleNames}.${common}`
      : `Next Visit Offer program: after an eligible completed appointment, save ${discount} when the next eligible appointment takes place within ${offer.promotion.expiryDays} days. It applies to ${eligibleNames}.${common}`;
  }
  if (offer.status === 'eligible') {
    return fr
      ? `Offre prochaine visite : économisez ${discount} lorsque votre prochain rendez-vous admissible a lieu au plus tard le ${offer.deadlineDate}. Elle s’applique à ${eligibleNames}.${common}`
      : `Next Visit Offer: save ${discount} when your next eligible appointment takes place by ${offer.deadlineDate}. It applies to ${eligibleNames}.${common}`;
  }
  if (offer.status === 'no_eligible_service' && args.hasSelectedService) {
    return fr
      ? `Offre prochaine visite : le service sélectionné n’est pas admissible à cette offre.${common}`
      : `Next Visit Offer: the selected service is not eligible for this offer.${common}`;
  }
  if (offer.status === 'no_eligible_service') {
    return fr
      ? `Offre prochaine visite : économisez ${discount} lorsque votre prochain rendez-vous admissible a lieu au plus tard le ${offer.deadlineDate}. Elle s’applique à ${eligibleNames}.${common}`
      : `Next Visit Offer: save ${discount} when your next eligible appointment takes place by ${offer.deadlineDate}. It applies to ${eligibleNames}.${common}`;
  }
  if (offer.status === 'outside_window') {
    return fr
      ? 'Offre prochaine visite : la date sélectionnée ne se trouve pas dans la période admissible, donc cette offre ne s’applique pas.'
      : 'Next Visit Offer: the selected date is not within the eligible window, so this offer does not apply.';
  }
  if (offer.status === 'already_attached_or_used') {
    return fr ? 'Offre prochaine visite : cette offre est déjà liée à un autre rendez-vous ou a été utilisée.' : 'Next Visit Offer: this offer is already attached to another appointment or has been used.';
  }
  if (offer.status === 'expired') {
    return fr ? 'Offre prochaine visite : cette offre a expiré.' : 'Next Visit Offer: this offer has expired.';
  }
  return fr ? 'Offre prochaine visite : cette offre n’est plus disponible.' : 'Next Visit Offer: this offer is no longer available.';
}

/** Bounded interpretation + grounded conversation, no owner dispatcher or writable model tool. */
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
  timing?: CustomerTurnTiming;
}, provider?: OwnerAssistantModelProvider): Promise<CustomerAssistantResponse> {
  const timing = args.timing ?? new CustomerTurnTiming();
  const requestStarted = performance.now();
  const unavailable = (reason: Extract<CustomerAssistantResult, { kind: 'unavailable' }>['reason']): CustomerAssistantResponse => ({
    conversation: args.conversation,
    result: { kind: 'unavailable', reason },
  });
  const config = getCustomerAssistantConfig();
  if (!config) {
    return unavailable('unavailable');
  }
  let conversation: ReturnType<typeof verifyCustomerConversation>;
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
    conversation: args.conversation,
    clientIp: args.clientIp,
  });
  if (!reservation.ok) {
    return unavailable(reservation.reason);
  }

  const messages = [...conversation.messages, args.message].slice(-16);
  const nextState = { ...advanceCustomerConversation(conversation), messages };
  const model = provider ?? createOpenAiResponsesProvider({ apiKey: config.apiKey });
  // Validate bounded Unicode/token size before any model call. The customer
  // receives the prior token on failure and can continue manually.
  try {
    signCustomerConversation(nextState, config.signingSecret);
  } catch {
    return unavailable('conversation_used');
  }
  const attemptId = randomUUID();
  let interpreterUsage: ModelProviderUsage | null = null;
  let interpreterInvoked = false;
  let providerCallStarted = false;
  let result: CustomerAssistantResult = { kind: 'unavailable', reason: 'unavailable' };
  const started = performance.now();
  timing.add('setup', started - requestStarted);
  try {
    const [menu, publicFacts, availabilityContext] = await timing.measure('catalogue', () => Promise.all([
      loadCustomerMenu(args.salonId, args.features),
      loadCustomerPublicFacts(args).catch(() => null),
      getCustomerAvailabilityContext(args.salonId),
    ]));
    if (conversation.context?.selection) {
      try {
        validateCustomerMenuSelection(menu, conversation.context.selection);
      } catch {
        nextState.context = undefined;
        nextState.booking = undefined;
        nextState.requestedSelection = undefined;
        // A stale selection must not prevent an unrelated public information question.
        conversation = { ...conversation, context: undefined, booking: undefined, requestedSelection: undefined };
      }
    }
    const publicContext = publicFacts ? receptionistContext({ menu, publicFacts, result: { kind: 'answer', topic: 'conversation', message: '', options: [] }, conversation, nextState, message: args.message, locale: args.locale }) : { replyFacts: {}, publicServices: [], unsupportedRequest: conversation.unsupportedRequest ?? null };
    const responseSchema = createReceptionistTurnSchema(Object.keys(publicContext.replyFacts));
    const interpreterContext = compactCustomerModelContext({
      prompt: RECEPTIONIST_TURN_PROMPT,
      additionalInput: args.message,
      maxBytes: CUSTOMER_ASSISTANT_MAX_INPUT_BYTES,
      legacyMessages: conversation.dialogue?.length ? undefined : conversation.messages,
      context: {
        locale: args.locale,
        bookingSalon: { name: args.salonName ?? args.salonSlug, slug: args.salonSlug },
        previousFacts: conversation.facts ?? emptyFacts(),
        requestedSelection: conversation.requestedSelection ?? null,
        menu: projectCustomerInterpreterMenu(menu),
        ...(conversation.dialogue?.length ? { dialogue: conversation.dialogue } : {}),
        conversationalSubjects: conversation.subjects ?? [],
        priorConversationalSubjects: conversation.priorSubjects ?? [],
        lastShown: conversation.context ?? null,
        bookingState: conversation.booking ?? null,
        availabilitySearch: conversation.availabilitySearch ?? null,
        ...availabilityContext,
        ...publicContext,
      },
    });
    if (!interpreterContext.fits || Buffer.byteLength(JSON.stringify(responseSchema), 'utf8') > CUSTOMER_ASSISTANT_INTERPRETATION_SCHEMA_BYTES) {
      throw new Error('CUSTOMER_CONTEXT_TOO_LARGE');
    }
    const data = interpreterContext.data;
    // Durable reservation BEFORE network: a failed outcome write still leaves
    // conservative unknown-spend evidence, and a failed reservation makes no call.
    await timing.measure('persistence', () => recordCustomerAssistantUsage({ salonId: args.salonId, attemptId, outcome: 'reserved', usage: null, latencyMs: 0 }));
    interpreterInvoked = true;
    providerCallStarted = true;
    const response = await timing.measure('model', () => model.createResponse({
      model: CUSTOMER_ASSISTANT_MODEL,
      input: [{ role: 'system', content: RECEPTIONIST_TURN_PROMPT }, { role: 'user', content: data }, { role: 'user', content: args.message }],
      tools: [],
      toolChoice: 'none',
      reasoningEffort: 'low',
      jsonMode: 'schema',
      jsonSchema: responseSchema,
      maxOutputTokens: CUSTOMER_ASSISTANT_MAX_OUTPUT_TOKENS,
      timeoutMs: 15_000,
    }));
    interpreterUsage = response.usage;
    if (response.status !== 'completed' || response.items.some(item => item.type === 'function_call' || item.type === 'refusal')) {
      throw new Error('CUSTOMER_MODEL_INVALID');
    }
    const text = response.items.filter(item => item.type === 'message').map(item => item.text).join('');
    if (text.length > 12_000) {
      throw new Error('CUSTOMER_MODEL_INVALID');
    }
    const intent = receptionistTurnSchema.parse(JSON.parse(text));
    if (intent.unsupportedRequest && intent.selectionChangeExplicitThisTurn) {
      nextState.unsupportedRequest = intent.unsupportedRequest;
      nextState.context = undefined;
      nextState.booking = undefined;
      intent.action = 'no_match';
      intent.serviceId = null;
      intent.addOns = [];
      intent.addOnUpdates = { add: [], remove: [] };
    } else if (intent.unsupportedRequest) {
      // Educational questions about another system do not change a booking.
      intent.action = 'answer';
      intent.unsupportedRequest = null;
    } else if (conversation.unsupportedRequest && intent.action === 'propose' && intent.selectionChangeExplicitThisTurn && intent.unsupportedResolution !== 'none') {
      const kind = conversation.unsupportedRequest.kind;
      const resolvedRemoval = intent.factUpdates.existingProduct === 'none' && intent.factUpdates.removal === 'no';
      const resolvedDesign = ['plain', 'skip'].includes(intent.factUpdates.designPreference ?? '') || Boolean(intent.addOnUpdates?.add.some(item => menu.addOns.some(addOn => addOn.id === item.addOnId && semanticCatalog.isDesign(addOn)) && menu.bindings.some(binding => binding.serviceId === intent.serviceId && binding.addOnId === item.addOnId)));
      const resolvedTreatment = Boolean(intent.serviceId && menu.services.some(service => service.id === intent.serviceId));
      if (kind === 'removal' ? resolvedRemoval : kind === 'design' ? resolvedDesign : resolvedTreatment) {
        nextState.unsupportedRequest = undefined;
      }
    }
    // Reuse the clarification snapshot within this request only. Quoting and
    // pre/post availability checks deliberately retain their fresh reads.
    let snapshot: ReturnType<typeof loadCustomerClarificationSnapshot> | undefined;
    const clarificationSnapshot = () => snapshot ??= loadCustomerClarificationSnapshot(args.salonId);
    result = await timing.measure('resolution', () => resolveCustomerTurn(args, menu, intent, conversation, nextState, {
      buildCustomerProposal,
      loadCustomerClarificationSnapshot: clarificationSnapshot,
      lookupCustomerSlots: input => timing.measure('availability', () => lookupCustomerSlots(input)),
      lookupNextCustomerSlots: input => timing.measure('availability', () => lookupNextCustomerSlots(input)),
    }));
    if (nextState.unsupportedRequest && (result.kind === 'proposal' || result.kind === 'slots')) {
      result = { kind: 'unavailable', reason: nextState.unsupportedRequest.kind === 'removal' ? 'unsupported_removal' : 'no_match' };
      nextState.context = undefined;
      nextState.booking = undefined;
    }
    if (!publicFacts && result.kind === 'answer' && !result.message) {
      result = { ...result, message: args.locale === 'fr' ? 'Je ne peux pas vérifier cette information pour le moment. Le menu habituel reste disponible.' : 'I can’t verify that information right now. You can still use the regular menu.' };
    }
    if (publicFacts) {
      const factResolutionStarted = performance.now();
      const requestedReplyFacts = new Set(intent.reply?.segments.flatMap(segment => segment.kind === 'fact' ? [segment.key] : []) ?? []);
      const needsOffer = requestedReplyFacts.has('next_visit_offer');
      let currentProposal;
      let quoteIsDraft = false;
      if (result.kind === 'answer' && (result.topic === 'price' || result.topic === 'duration' || requestedReplyFacts.has('selection') || needsOffer)) {
        try {
          let quoteSelection = nextState.context?.selection;
          if (!quoteSelection && nextState.requestedSelection && menu.l1) {
            quoteSelection = customerPartialQuoteSelection({ menu, snapshot: await clarificationSnapshot(), facts: nextState.facts ?? emptyFacts(), candidate: nextState.requestedSelection }) ?? undefined;
            quoteIsDraft = Boolean(quoteSelection);
          }
          if (!quoteSelection) {
            throw new Error('CUSTOMER_CONFIGURED_QUOTE_UNAVAILABLE');
          }
          const checked = await buildCustomerProposal(args.salonId, args.features, quoteSelection);
          if (!selectionConflictsWithExplicitFacts(menu, nextState.facts ?? emptyFacts(), { baseServiceId: checked.service.id, selectedAddOns: checked.addOns.map(item => ({ addOnId: item.id, quantity: item.quantity })) })) {
            currentProposal = checked;
          }
        } catch {
          // An incomplete draft has no configured total; base menu facts remain useful.
        }
      }
      let nextVisitOfferMessage: string | undefined;
      try {
        const offer = needsOffer
          ? await getNextVisitOfferAssistantFacts({
            salonId: args.salonId,
            ...(conversation.nextVisitOffer ? { reference: conversation.nextVisitOffer } : {}),
            services: currentProposal && !quoteIsDraft ? [{ id: currentProposal.service.id, priceCents: currentProposal.service.priceCents }] : [],
            ...(nextState.booking?.selectedSlot ? { startTime: nextState.booking.selectedSlot.startTime } : {}),
          })
          : null;
        if (offer) {
          nextVisitOfferMessage = nextVisitOfferFact({ offer, menu, locale: args.locale, hasSelectedService: Boolean(currentProposal) && !quoteIsDraft });
        } else if (needsOffer) {
          nextVisitOfferMessage = args.locale === 'fr'
            ? 'Aucune offre prochaine visite vérifiée n’est liée à cette session de réservation. Réserver à nouveau n’ajoute pas automatiquement une réduction.'
            : 'There is no verified Next Visit Offer attached to this booking session. Rebooking itself does not add a discount.';
        }
      } catch {
        // Offers are optional public context. A read failure cannot weaken or
        // change the assistant's normal conversation and booking behavior.
      }
      timing.add('resolution', performance.now() - factResolutionStarted);
      const replyStarted = performance.now();
      const rendered = renderReceptionistTurn({ menu, publicFacts, result, conversation, nextState, message: args.message, locale: args.locale, currentProposal, quoteIsDraft, ...(nextVisitOfferMessage ? { nextVisitOfferFact: nextVisitOfferMessage } : {}) }, intent);
      const offersOptions = result.kind === 'answer' || (result.kind === 'clarification' && result.question === 'service') || isRecoverableResult(result);
      result = { ...result, message: rendered.message, ...(offersOptions ? { options: rendered.options } : {}) };
      if (offersOptions && rendered.options.length) {
        nextState.priorSubjects = conversation.subjects;
        nextState.subjects = menu.services.filter(service => rendered.options.includes(service.name)).map(service => service.id);
      }
      timing.add('reply', performance.now() - replyStarted);
    }
  } catch (error) {
    if (error instanceof ModelProviderError && interpreterInvoked) {
      interpreterUsage = error.usage;
    }
    // Provider and catalogue exceptions may carry untrusted text. Never log
    // them or forward their messages, stack-attached rows or responses.
    result = { kind: 'unavailable', reason: 'unavailable' };
  }
  const stageUsages: CustomerAssistantStageUsage[] = [];
  if (interpreterInvoked) {
    stageUsages.push({ stage: 'receptionist', model: CUSTOMER_ASSISTANT_MODEL, usage: interpreterUsage });
  }
  const usage = aggregateCustomerAssistantStageUsage(stageUsages);
  try {
    await timing.measure('persistence', () => recordCustomerAssistantUsage({
      salonId: args.salonId,
      attemptId,
      usage,
      stageUsages,
      latencyMs: performance.now() - requestStarted,
      timings: timing.snapshot(),
      deterministic: !providerCallStarted,
      outcome: result.kind === 'unavailable'
        ? (result.reason === 'no_match' ? 'no_match' : 'failed')
        : (result.kind === 'slots' || result.kind === 'date_prompt')
            ? 'availability'
            : result.kind,
    }));
  } catch {
    result = { kind: 'unavailable', reason: 'unavailable' };
  }
  if (result.kind === 'unavailable' && !result.message) {
    // Remember the same safe error the customer sees. An unanswered user turn
    // alone is not an honest transcript for the next conversational repair.
    result = { ...result, message: customerAssistantCopy[args.locale].unavailable[result.reason] ?? customerAssistantCopy[args.locale].unavailable.unavailable! };
  }
  applyCustomerTurnResult(nextState, result);
  const spoken = result.message;
  nextState.dialogue = [...(conversation.dialogue ?? conversation.messages.map(content => ({ role: 'user' as const, content }))), { role: 'user' as const, content: args.message }, ...(spoken ? [{ role: 'assistant' as const, content: spoken.slice(0, 2400) }] : [])].slice(-24);
  try {
    const response = { conversation: signCustomerConversation(nextState, config.signingSecret), result };
    if (!await timing.measure('persistence', () => completeCustomerRevision(nextState, response.conversation))) {
      return unavailable('unavailable');
    }
    await timing.measure('persistence', () => storeCompletedCustomerTurn(args, response));
    return response;
  } catch {
    return unavailable('session_limit');
  }
}
