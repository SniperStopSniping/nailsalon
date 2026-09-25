import 'server-only';

import { z } from 'zod';

import { createOpenAiResponsesProvider } from '@/libs/ai/openaiResponses.server';
import type { OwnerAssistantModelProvider } from '@/libs/ai/provider';
import { type BookingSmsConsentInput, resolveBookingSmsMode } from '@/libs/bookingSmsConsent';
import type { SalonFeatures } from '@/types/salonPolicy';

import type { CustomerBookingOperationReference, CustomerBookingStatus } from '../customerAssistant/bookingOperationContracts';
import { compactCustomerModelContext } from '../customerAssistant/boundedModelContext';
import type { CustomerMenu } from '../customerAssistant/catalogue.server';
import { buildCustomerProposal, loadCustomerClarificationSnapshot, loadCustomerMenu } from '../customerAssistant/catalogue.server';
import { confirmCustomerBooking } from '../customerAssistant/confirmBooking.server';
import type { CustomerContact } from '../customerAssistant/contact';
import { createCustomerContactBinding } from '../customerAssistant/contact.server';
import type { CustomerAssistantResult } from '../customerAssistant/contracts';
import { advanceCustomerConversation, createCustomerConversation, type CustomerConversation } from '../customerAssistant/conversation.server';
import { CUSTOMER_INTERPRETATION_JSON_SCHEMA, CUSTOMER_INTERPRETATION_PROMPT, customerInterpretationSchema } from '../customerAssistant/interpretation';
import { projectCustomerInterpreterMenu } from '../customerAssistant/interpreterMenu';
import { customerBookingOperationReference, type CustomerBookingTransaction, prepareCustomerBookingOperation, readCustomerBookingOperation } from '../customerAssistant/operationStore.server';
import { prepareCustomerBookingQuote } from '../customerAssistant/prepareQuote.server';
import { type CustomerPublicFacts, loadCustomerPublicFacts } from '../customerAssistant/publicFacts.server';
import { assessReadyCustomerProposal } from '../customerAssistant/readiness.server';
import { applyCustomerTurnResult, resolveCustomerTurn } from '../customerAssistant/resolveTurn';
import type { CustomerReadyReviewSnapshot } from '../customerAssistant/reviewContracts';
import { emptyFacts } from '../customerAssistant/semanticFacts';
import { semanticCatalog } from '../customerAssistant/semanticSelection';
import { getCustomerAvailabilityContext, lookupCustomerSlots, lookupNextCustomerSlots } from '../customerAssistant/slots.server';

/** The persisted, server-trusted call state. It contains no caller-ID identity claim. */
export type VoiceDraft = {
  conversation: CustomerConversation;
  lastResult: CustomerAssistantResult | null;
  contact: CustomerContact | null;
  operation: CustomerBookingOperationReference | null;
  review: CustomerReadyReviewSnapshot | null;
  /** Monotonic durable operation revision, retained after a material draft edit. */
  lastOperationRevision: number;
  /** Opaque durable lookup capability retained only for revision reconciliation. */
  lastOperationCapability: string | null;
};

export type VoiceSalon = {
  id: string;
  slug: string;
  name: string;
  features: SalonFeatures | null;
  /** Actual routed salon fields, forwarded unchanged to canonical review pricing. */
  settings: unknown;
  plan: unknown;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
};
/** Per-turn interpreter count for latency/cost telemetry; no transcript is retained. */
export type VoiceConsultationResponse = { draft: VoiceDraft; result: CustomerAssistantResult; publicFacts: CustomerPublicFacts | null; modelCalls?: 0 | 1; availabilityIssue?: 'unverified'; availabilityFailure?: 'lookup_failed' | 'quote_changed' | 'no_verified_slots' };

const VOICE_INTERPRETER_MODEL = 'gpt-5.6-terra';
const MAX_VOICE_MESSAGE_CHARS = 1_200;
const voiceInterpretationSchema = customerInterpretationSchema.extend({ selectedOfferedSlot: z.string().max(100).nullable().default(null) });
const VOICE_INTERPRETATION_PROMPT = `${CUSTOMER_INTERPRETATION_PROMPT}\nFor this phone adapter, selectedOfferedSlot identifies a caller's choice of a previously offered opening, never booking consent. When lastResultKind is slots and the latest caller message clearly accepts one of bookingState.offeredSlots (for example, that would be great, let's do that one, or can you book that for me), return that exact startTime. A general yes can select only a single current recommendation. Otherwise return null. Return null for questions, uncertainty, rejection, or a simultaneous service, date, time, or contact correction. Selecting an opening is not a service change: selectionChangeExplicitThisTurn is false and factUpdates remain null. Luster will recheck availability, collect contact information, and obtain a separate final booking confirmation.`;

function voiceSmsConsent(settings: unknown, choice: BookingSmsConsentInput | undefined): BookingSmsConsentInput | undefined {
  const mode = resolveBookingSmsMode(settings);
  if (mode === 'disabled') {
    return undefined;
  }
  if (choice?.selection === 'explicit_on' || choice?.selection === 'explicit_off') {
    return choice;
  }
  return {
    granted: mode === 'default_on',
    selection: mode,
    wordingVersion: 'booking-sms-reminders-v1',
  };
}

export function createVoiceDraft(salonId: string, callId: string, now = Date.now()): VoiceDraft {
  // Calls are created by the trusted telephony webhook. The call SID/call ID is
  // the idempotency session, never a value supplied by the speaking model.
  const conversation = { ...createCustomerConversation(salonId, 'voice-draft', now), sessionId: callId };
  return { conversation, lastResult: null, contact: null, operation: null, review: null, lastOperationRevision: 0, lastOperationCapability: null };
}

function unavailable(draft: VoiceDraft, reason: Extract<CustomerAssistantResult, { kind: 'unavailable' }>['reason']): { draft: VoiceDraft; result: CustomerAssistantResult } {
  return { draft: { ...draft, lastResult: { kind: 'unavailable', reason } }, result: { kind: 'unavailable', reason } };
}

function isExactPriceRepeat(message: string): boolean {
  return /^(?:what(?:'s| is) the price(?: again)?|what was that price|how much(?: was that)?|precio(?: otra vez)?|cu[aá]nto era)\??$/iu.test(message.trim());
}

function materiallyChanged(before: CustomerConversation, after: CustomerConversation): boolean {
  return JSON.stringify({ facts: before.facts, selection: before.requestedSelection, context: before.context?.selection, booking: before.booking })
    !== JSON.stringify({ facts: after.facts, selection: after.requestedSelection, context: after.context?.selection, booking: after.booking });
}

function normalizeClarificationText(value: string): string {
  return value.trim().normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[’']/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

function exactClarificationIntent(message: string, conversation: CustomerConversation, menu: CustomerMenu) {
  const context = conversation.context;
  const question = context?.question;
  // This accepts only a complete, current-question answer after harmless
  // speech punctuation/politeness. Any compound request remains with Terra so
  // Luster never drops a correction such as a design or a date.
  const normalized = normalizeClarificationText(message);
  const polite = normalized
    .replace(/^(?:please|por favor|okay|ok|um|uh|well)\s+/u, '')
    .replace(/\s+(?:please|por favor|thanks|gracias)$/u, '');
  // A named, exact public service is a safe local interpretation. A short
  // phone request should not need a model call just to retain that service.
  // A prior service can carry treatment facts, so a service change still
  // needs the bounded interpreter to clear or replace those facts.
  const priorService = conversation.requestedSelection?.baseServiceId ?? context?.selection?.baseServiceId;
  const initialServiceRequest = !priorService && (conversation.facts?.treatment ?? 'unknown') === 'unknown'
    && (conversation.facts?.desiredApplication ?? 'unknown') === 'unknown';
  const simpleService = polite.replace(/^(?:(?:i want|i would like|id like|can i book|book me|its just|it is just|just|a|the)\s+)+/u, '');
  const exactServices = (question === 'service' || (!question && initialServiceRequest))
    ? menu.services.filter(item => normalizeClarificationText(item.name) === simpleService && (!priorService || priorService === item.id))
    : [];
  if ((!context || !question) && exactServices.length !== 1) {
    return null;
  }
  const base = {
    factUpdates: { schemaVersion: 1, treatment: null, desiredApplication: null, maintenance: null, length: null, lengthChoice: null, french: null, designPreference: null, existingProduct: null, currentProductUncertain: null, origin: null, removal: null, repairCount: null },
    lengthExplicitThisTurn: false,
    selectionChangeExplicitThisTurn: true,
    priceComparison: null,
    action: 'clarify',
    timingFeedback: 'none',
    timeDirection: 'none',
    availabilityScope: 'next_available',
    dateExplicitThisTurn: false,
    timeWindowExplicitThisTurn: false,
    availabilityAnchor: null,
    answerTopic: null,
    addOnUpdates: { add: [], remove: [] },
    informationServiceIds: [],
    serviceId: context?.selection?.baseServiceId ?? null,
    addOns: context?.selection?.selectedAddOns ?? [],
    question: question ?? 'details',
    optionIds: [],
    datePreference: null,
  } as const;
  if (exactServices.length === 1 && (!context || !question || context.options.some(option => normalizeClarificationText(option) === normalizeClarificationText(exactServices[0]!.name)))) {
    return customerInterpretationSchema.parse({ ...base, action: 'propose', serviceId: exactServices[0]!.id, addOns: [] });
  }
  if (!context || !question) {
    return null;
  }
  if (question === 'removal' && ['yes', 'si'].includes(polite)) {
    return customerInterpretationSchema.parse({ ...base, factUpdates: { ...base.factUpdates, removal: 'yes' } });
  }
  if (question === 'removal' && ['no', 'no gracias'].includes(polite)) {
    return customerInterpretationSchema.parse({ ...base, factUpdates: { ...base.factUpdates, removal: 'no' } });
  }
  const lengthChoice = /^(?:(?:actually|okay|ok)\s+)?(?:make (?:them|it)\s+)?(short|corto|corta|medium|mediano|mediana|long|largo|larga)$/u.exec(polite)?.[1];
  if (question === 'length' && lengthChoice) {
    const length = ({ short: 'short', corto: 'short', corta: 'short', medium: 'medium', mediano: 'medium', mediana: 'medium', long: 'long', largo: 'long', larga: 'long' } as const)[lengthChoice as 'short' | 'corto' | 'corta' | 'medium' | 'mediano' | 'mediana' | 'long' | 'largo' | 'larga']!;
    return customerInterpretationSchema.parse({ ...base, lengthExplicitThisTurn: true, factUpdates: { ...base.factUpdates, length } });
  }
  if (question === 'product' && ['i dont know', 'i dont know what i have on my nails', 'no se', 'no lo se'].includes(polite)) {
    return customerInterpretationSchema.parse({ ...base, factUpdates: { ...base.factUpdates, existingProduct: 'unknown', currentProductUncertain: true } });
  }
  if (question === 'product') {
    const products = new Map<string, 'none' | 'gel_polish' | 'builder_gel' | 'gel_x' | 'acrylic'>([
      ['nothing', 'none'],
      ['nothing on my nails', 'none'],
      ['bare nails', 'none'],
      ['my nails are bare', 'none'],
      ['gel polish', 'gel_polish'],
      ['i have gel polish', 'gel_polish'],
      ['shellac', 'gel_polish'],
      ['builder gel', 'builder_gel'],
      ['biab', 'builder_gel'],
      ['gel x', 'gel_x'],
      ['acrylic', 'acrylic'],
    ] as const);
    const existingProduct = products.get(polite);
    if (existingProduct) {
      return customerInterpretationSchema.parse({ ...base, factUpdates: { ...base.factUpdates, existingProduct, currentProductUncertain: false } });
    }
  }
  if (question === 'origin' && ['from another salon', 'from a different salon', 'de otro salon'].includes(polite)) {
    return customerInterpretationSchema.parse({ ...base, factUpdates: { ...base.factUpdates, origin: 'other_salon' } });
  }
  if ((question === 'finish' || question === 'details') && ['french tips', 'french tip', 'puntas francesas'].includes(polite)) {
    return customerInterpretationSchema.parse({ ...base, factUpdates: { ...base.factUpdates, french: 'yes' } });
  }
  if ((question === 'finish' || question === 'details') && ['no design', 'no designs', 'sin diseno', 'sin disenos'].includes(polite)) {
    return customerInterpretationSchema.parse({ ...base, factUpdates: { ...base.factUpdates, french: 'no', designPreference: 'plain' } });
  }
  if (question !== 'service') {
    return null;
  }
  const service = menu.services.find(item => normalizeClarificationText(item.name) === polite);
  if (!service || !context.options.some(option => normalizeClarificationText(option) === polite)) {
    return null;
  }
  return customerInterpretationSchema.parse({
    ...base,
    action: 'propose',
    serviceId: service.id,
    addOns: [],
  });
}

/**
 * Resolves spoken transcript intent through the same menu, consultation and
 * availability authorities as Customer AI. The returned result is structured
 * facts for the realtime voice layer to phrase; this adapter writes no prose.
 */
export async function runVoiceConsultation(args: {
  salon: VoiceSalon;
  draft: VoiceDraft;
  message: string;
  now?: Date;
  /** Explicitly injected for voice; never reads Customer AI pilot/config. */
  voiceApiKey?: string;
}, provider?: OwnerAssistantModelProvider): Promise<VoiceConsultationResponse> {
  const message = args.message.trim();
  if (!message || message.length > MAX_VOICE_MESSAGE_CHARS || args.draft.conversation.salonId !== args.salon.id) {
    return { ...unavailable(args.draft, 'invalid_conversation'), publicFacts: null };
  }
  const now = args.now ?? new Date();
  const prior = args.draft.conversation;
  if (prior.expiresAtMs <= now.getTime()) {
    return { ...unavailable(args.draft, 'conversation_expired'), publicFacts: null };
  }
  // Repeating a just-quoted amount is deterministic only while that proposal
  // remains valid. It does not refresh a quote or mutate booking authority.
  if (args.draft.lastResult?.kind === 'proposal'
    && isExactPriceRepeat(message)
    && Date.parse(args.draft.lastResult.proposal.expiresAt) > now.getTime()) {
    return { draft: args.draft, result: args.draft.lastResult, publicFacts: null };
  }
  const model = provider ?? (args.voiceApiKey ? createOpenAiResponsesProvider({ apiKey: args.voiceApiKey }) : null);
  try {
    const [menu, availability, publicFacts] = await Promise.all([
      loadCustomerMenu(args.salon.id, args.salon.features),
      getCustomerAvailabilityContext(args.salon.id, now),
      loadCustomerPublicFacts({ salonId: args.salon.id, salonSlug: args.salon.slug, features: args.salon.features, locale: 'en' }).catch(() => null),
    ]);
    const next = {
      ...advanceCustomerConversation(prior, now.getTime()),
      messages: [...prior.messages, message].slice(-16),
      dialogue: [...(prior.dialogue ?? []), { role: 'user' as const, content: message }].slice(-16),
    };
    const context = compactCustomerModelContext({
      prompt: VOICE_INTERPRETATION_PROMPT,
      additionalInput: message,
      maxBytes: 64_000,
      context: {
        locale: 'en',
        bookingSalon: { name: args.salon.name, slug: args.salon.slug },
        previousFacts: prior.facts ?? emptyFacts(),
        requestedSelection: prior.requestedSelection ?? null,
        menu: projectCustomerInterpreterMenu(menu),
        dialogue: prior.dialogue ?? [],
        lastShown: prior.context ?? null,
        bookingState: prior.booking ?? null,
        lastResultKind: args.draft.lastResult?.kind ?? null,
        availabilitySearch: prior.availabilitySearch ?? null,
        ...availability,
      },
    });
    if (!context.fits) {
      return { ...unavailable(args.draft, 'conversation_used'), publicFacts };
    }
    const fastPath = exactClarificationIntent(message, prior, menu);
    let intent = fastPath;
    if (!intent) {
      if (!model) {
        return { ...unavailable(args.draft, 'unavailable'), publicFacts };
      }
      const response = await model.createResponse({
        model: VOICE_INTERPRETER_MODEL,
        input: [
          { role: 'system', content: VOICE_INTERPRETATION_PROMPT },
          { role: 'user', content: context.data },
          { role: 'user', content: message },
        ],
        tools: [],
        toolChoice: 'none',
        reasoningEffort: 'low',
        jsonMode: 'schema',
        jsonSchema: {
          ...CUSTOMER_INTERPRETATION_JSON_SCHEMA,
          required: [...CUSTOMER_INTERPRETATION_JSON_SCHEMA.required, 'selectedOfferedSlot'],
          properties: {
            ...CUSTOMER_INTERPRETATION_JSON_SCHEMA.properties,
            selectedOfferedSlot: { type: ['string', 'null'], enum: [null, ...(args.draft.lastResult?.kind === 'slots' ? prior.booking?.offeredSlots.map(slot => slot.startTime) ?? [] : [])] },
          },
        },
        maxOutputTokens: 1_800,
        timeoutMs: 15_000,
      });
      const text = response.items.filter(item => item.type === 'message').map(item => item.text).join('');
      if (response.status !== 'completed' || response.items.some(item => item.type === 'function_call' || item.type === 'refusal') || text.length > 12_000) {
        return { ...unavailable(args.draft, 'unavailable'), publicFacts };
      }
      const { selectedOfferedSlot, ...interpreted } = voiceInterpretationSchema.parse(JSON.parse(text));
      intent = customerInterpretationSchema.parse(interpreted);
      if (selectedOfferedSlot) {
        if (args.draft.lastResult?.kind !== 'slots' || !prior.booking?.offeredSlots.some(slot => slot.startTime === selectedOfferedSlot)) {
          return { ...unavailable(args.draft, 'selection_changed'), publicFacts, modelCalls: 1 };
        }
        const hasCorrection = intent.selectionChangeExplicitThisTurn || intent.dateExplicitThisTurn || intent.timeWindowExplicitThisTurn
          || intent.timeDirection !== 'none' || intent.timingFeedback !== 'none'
          || Object.entries(intent.factUpdates).some(([key, value]) => key !== 'schemaVersion' && value !== null)
          || !!intent.addOnUpdates?.add.length || !!intent.addOnUpdates?.remove.length;
        if (!hasCorrection) {
          return { ...await chooseVoiceSlot({ salon: args.salon, draft: args.draft, startTime: selectedOfferedSlot, now }), publicFacts, modelCalls: 1 };
        }
      }
    }
    const previousServiceId = prior.requestedSelection?.baseServiceId ?? prior.context?.selection?.baseServiceId;
    const requestedService = menu.services.find(item => item.id === intent.serviceId);
    const requestedTreatment = requestedService ? semanticCatalog.serviceFamily(requestedService) : 'unknown';
    const requestedApplication = requestedService ? semanticCatalog.serviceApplication(requestedService) : 'unknown';
    const conflictsWithKnownTreatment = !!prior.facts && requestedTreatment !== 'unknown' && prior.facts.treatment !== 'unknown'
      && requestedTreatment !== prior.facts.treatment && intent.factUpdates.treatment === null;
    const conflictsWithKnownApplication = !!prior.facts && requestedApplication !== 'unknown' && prior.facts.desiredApplication !== 'unknown'
      && requestedApplication !== prior.facts.desiredApplication && intent.factUpdates.desiredApplication === null
      && intent.factUpdates.treatment === null;
    if (previousServiceId && intent.serviceId && intent.serviceId !== previousServiceId
      && intent.action === 'propose' && (conflictsWithKnownTreatment || conflictsWithKnownApplication)) {
      return { ...unavailable(args.draft, 'selection_changed'), publicFacts, modelCalls: fastPath ? 0 : 1 };
    }
    let snapshot: ReturnType<typeof loadCustomerClarificationSnapshot> | undefined;
    let result = await resolveCustomerTurn({ salonId: args.salon.id, salonSlug: args.salon.slug, features: args.salon.features, locale: 'en' }, menu, intent, prior, next, {
      buildCustomerProposal,
      loadCustomerClarificationSnapshot: () => snapshot ??= loadCustomerClarificationSnapshot(args.salon.id),
      lookupCustomerSlots: input => lookupCustomerSlots({ ...input, now }),
      lookupNextCustomerSlots: input => lookupNextCustomerSlots({ ...input, now }),
    });
    if (intent.action === 'availability' && result.kind === 'unavailable' && result.reason === 'no_match' && !next.context?.selection) {
      // A date without a resolved service never reached the calendar. Give
      // Live a concrete service question instead of an unavailable result it
      // could incorrectly describe as an empty day.
      result = { kind: 'clarification', question: 'service', options: [], message: 'Which nail service would you like? I can check that day once I know the service.' };
    }
    if (result.kind === 'slots') {
      // Voice says one recommendation. Retaining unseen slots would make
      // "later" anchor after the last hidden slot instead of the spoken one.
      result = { ...result, slots: [...result.slots].sort((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, 1) };
    }
    applyCustomerTurnResult(next, result);
    let availabilityIssue: 'unverified' | undefined;
    let availabilityFailure: VoiceConsultationResponse['availabilityFailure'];
    // A service proposal is enough to look for a real opening. Voice callers
    // should hear a checked first slot without having to ask a second time.
    if (result.kind === 'proposal') {
      const selection = result.proposal.selection;
      const boundSalon = { id: args.salon.id, slug: args.salon.slug };
      const requested = ((intent.dateExplicitThisTurn || intent.timeWindowExplicitThisTurn)
        ? intent.datePreference
        : next.availabilityPreference) ?? null;
      let nextAvailable: Awaited<ReturnType<typeof lookupNextCustomerSlots>> = null;
      try {
        const exact = requested ? await lookupCustomerSlots({ salon: boundSalon, features: args.salon.features, selection, preference: requested, now }) : null;
        if (exact && !exact.quoteChanged && exact.slots.length) {
          nextAvailable = { ...exact, preference: requested! };
        } else if (!requested || (exact && !exact.quoteChanged)) {
          nextAvailable = await lookupNextCustomerSlots({
            salon: boundSalon,
            features: args.salon.features,
            selection,
            now,
            ...(requested
              ? {
                  fromDate: new Date(Date.parse(`${requested.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
                  earliest: requested.earliest,
                  latest: requested.latest,
                }
              : {}),
          });
        }
      } catch {
        availabilityFailure = 'lookup_failed';
      }
      if (nextAvailable && !nextAvailable.quoteChanged && nextAvailable.proposal.fingerprint === result.proposal.fingerprint) {
        const preference = nextAvailable.preference;
        result = {
          kind: 'slots',
          proposal: result.proposal,
          preference,
          timeZone: nextAvailable.timeZone,
          slots: [...nextAvailable.slots].sort((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, 1),
          checkedAt: now.toISOString(),
          search: { requestedPreference: requested ?? preference, displayedPreference: preference, fallback: !!requested && requested.date !== preference.date },
        };
        applyCustomerTurnResult(next, result);
      } else {
        // A bounded search cannot distinguish a closed week from a transient
        // availability failure. Keep the quote and selection so the caller can
        // still hear the real price while the voice explains the uncertainty.
        availabilityIssue = 'unverified';
        availabilityFailure ??= nextAvailable?.quoteChanged || (nextAvailable && nextAvailable.proposal.fingerprint !== result.proposal.fingerprint)
          ? 'quote_changed'
          : 'no_verified_slots';
      }
    }
    const changed = materiallyChanged(prior, next);
    const draft: VoiceDraft = {
      ...args.draft,
      conversation: next,
      lastResult: result,
      ...(changed ? { review: null, operation: null } : {}),
    };
    return { draft, result, publicFacts, modelCalls: fastPath ? 0 : 1, ...(availabilityIssue ? { availabilityIssue, availabilityFailure } : {}) };
  } catch {
    return { ...unavailable(args.draft, 'unavailable'), publicFacts: null };
  }
}

/** Revalidates an explicitly spoken slot choice; a transcript cannot mint a slot. */
export async function chooseVoiceSlot(args: { salon: VoiceSalon; draft: VoiceDraft; startTime: string; now?: Date }): Promise<{ draft: VoiceDraft; result: CustomerAssistantResult }> {
  const prior = args.draft.conversation;
  const selection = prior.context?.selection;
  const preference = prior.booking?.datePreference;
  if (prior.salonId !== args.salon.id || !selection || !preference || !prior.booking?.offeredSlots.some(slot => slot.startTime === args.startTime)) {
    return unavailable(args.draft, 'selection_changed');
  }
  try {
    const fresh = await lookupCustomerSlots({ salon: { id: args.salon.id, slug: args.salon.slug }, features: args.salon.features, selection, preference, requiredStartTime: args.startTime, now: args.now });
    if (!fresh) {
      return unavailable(args.draft, 'unavailable');
    }
    if (fresh.quoteChanged || !fresh.selected) {
      return unavailable(args.draft, fresh.quoteChanged ? 'selection_changed' : 'no_availability');
    }
    const next = advanceCustomerConversation(prior, args.now?.getTime());
    next.booking = { acceptedFingerprint: fresh.proposal.fingerprint, datePreference: preference, offeredSlots: [fresh.selected], selectedSlot: fresh.selected };
    next.context = { question: null, options: [], selection: fresh.proposal.selection };
    const result: CustomerAssistantResult = { kind: 'slot_selected', proposal: fresh.proposal, preference, timeZone: fresh.timeZone, slot: fresh.selected };
    return { draft: { ...args.draft, conversation: next, lastResult: result, review: null, operation: null }, result };
  } catch {
    return unavailable(args.draft, 'unavailable');
  }
}

/** Creates a fresh server quote and durable operation after the caller gives contact details. */
export async function prepareVoiceReview(args: { salon: VoiceSalon; draft: VoiceDraft; contact: CustomerContact; smsConsent?: BookingSmsConsentInput; secret: string; now?: Date }): Promise<{ draft: VoiceDraft; result: CustomerAssistantResult; review: CustomerReadyReviewSnapshot | null }> {
  const prior = args.draft.conversation;
  const selection = prior.context?.selection;
  const preference = prior.booking?.datePreference;
  const selectedSlot = prior.booking?.selectedSlot;
  if (!selection || !preference || !selectedSlot || !prior.booking?.acceptedFingerprint) {
    return { ...unavailable(args.draft, 'selection_changed'), review: null };
  }
  try {
    const assessment = await assessReadyCustomerProposal({ salonId: args.salon.id, features: args.salon.features, state: prior });
    if (assessment.clarification || !assessment.proposal) {
      return { ...unavailable(args.draft, 'selection_changed'), review: null };
    }
    const fresh = await lookupCustomerSlots({ salon: { id: args.salon.id, slug: args.salon.slug }, features: args.salon.features, selection, preference, requiredStartTime: selectedSlot.startTime, now: args.now });
    if (!fresh || fresh.quoteChanged || !fresh.selected || fresh.proposal.fingerprint !== prior.booking.acceptedFingerprint) {
      return { ...unavailable(args.draft, 'selection_changed'), review: null };
    }
    const smsConsent = voiceSmsConsent(args.salon.settings, args.smsConsent);
    const preparedMaterial = await prepareCustomerBookingQuote({ salon: args.salon, features: args.salon.features, selection, preference, startTime: fresh.selected.startTime, contact: args.contact, smsConsent, now: args.now });
    const manualItems = preparedMaterial?.review.manualConfirmationItems ?? [];
    const currentProduct = prior.facts?.existingProduct;
    const material = preparedMaterial && (manualItems.length > 0 || prior.facts?.removal === 'yes')
      ? {
          ...preparedMaterial,
          manualConfirmationContext: {
            currentProduct: currentProduct && ['gel_x', 'builder_gel', 'acrylic', 'gel_polish'].includes(currentProduct)
              ? currentProduct as 'gel_x' | 'builder_gel' | 'acrylic' | 'gel_polish'
              : 'unknown' as const,
            itemIds: manualItems.map(item => item.id),
            removalRequired: prior.facts?.removal === 'yes',
          },
        }
      : preparedMaterial;
    if (!material || material.review.timeZone !== fresh.timeZone || material.review.financial.currency !== fresh.proposal.currency) {
      return { ...unavailable(args.draft, 'selection_changed'), review: null };
    }
    const prepare = (expectedRevision: number) => prepareCustomerBookingOperation({
      salonId: args.salon.id,
      sessionId: prior.sessionId,
      secret: args.secret,
      contact: args.contact,
      material,
      expectedRevision,
      now: args.now,
    });
    let operation;
    try {
      operation = await prepare(args.draft.operation?.revision ?? args.draft.lastOperationRevision);
    } catch {
      // Two interrupted turns can reach review from the same persisted draft.
      // Retry only if the durable operation still proves this exact contact.
      const capability = args.draft.operation?.capability ?? args.draft.lastOperationCapability;
      if (!capability) {
        throw new Error('VOICE_REVIEW_RECONCILIATION_UNAVAILABLE');
      }
      const current = await readCustomerBookingOperation({ salonId: args.salon.id, capability, secret: args.secret, now: args.now });
      const binding = createCustomerContactBinding({ secret: args.secret, salonId: args.salon.id, sessionId: current.sessionId, contact: args.contact });
      if (binding !== current.contactBinding) {
        throw new Error('VOICE_REVIEW_CONTACT_CHANGED');
      }
      operation = await prepare(current.revision);
    }
    const review = operation.material.review;
    const reference = customerBookingOperationReference(operation, args.secret);
    const next = advanceCustomerConversation(prior, args.now?.getTime());
    const result: CustomerAssistantResult = { kind: 'answer', topic: 'conversation', message: '', options: [] };
    return { draft: { ...args.draft, conversation: next, contact: args.contact, review, operation: reference, lastOperationRevision: reference.revision, lastOperationCapability: reference.capability, lastResult: result }, result, review };
  } catch {
    return { ...unavailable(args.draft, 'unavailable'), review: null };
  }
}

/** Commit accepts only the operation and contact already persisted in VoiceDraft. */
export async function commitVoiceBooking(args: { salon: Pick<VoiceSalon, 'id' | 'slug'>; draft: VoiceDraft; request: Request; secret: string; policyAccepted: boolean; executionGuard?: (tx: CustomerBookingTransaction) => Promise<void> }): Promise<CustomerBookingStatus> {
  if (!args.draft.operation || !args.draft.contact || !args.draft.review || args.draft.conversation.salonId !== args.salon.id) {
    throw new Error('VOICE_BOOKING_REVIEW_MISSING');
  }
  return confirmCustomerBooking({
    request: args.request,
    salon: args.salon,
    secret: args.secret,
    capability: args.draft.operation.capability,
    revision: args.draft.operation.revision,
    fingerprint: args.draft.operation.fingerprint,
    contact: args.draft.contact,
    policyAccepted: args.policyAccepted,
    ...(args.executionGuard ? { executionGuard: args.executionGuard } : {}),
  });
}
