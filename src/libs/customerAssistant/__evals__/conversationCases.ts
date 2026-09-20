/**
 * Synthetic, multi-turn reception tests. These describe customer-visible
 * outcomes rather than a required model wording. The runner checks public
 * fact grounding, retained semantic state, and normal booking handoff
 * readiness; it does not use a real salon, database, or customer text.
 */

export type ConversationExpectation = {
  resultKinds: string[];
  answerTopic?: 'compare_treatments' | 'length_options' | 'service_options' | 'unknown_product' | 'service_information' | 'price' | 'duration' | 'recall' | 'salon_information' | 'recommendation' | 'conversation';
  /** Some direct replies can be classified as general conversation while still answering correctly. */
  permittedAnswerTopics?: NonNullable<ConversationExpectation['answerTopic']>[];
  /** Facts that must remain true after this turn. */
  facts?: Record<string, unknown>;
  /** Authoritative public catalogue subjects, never a booking selection. */
  subjects?: string[];
  /** A proposal must use this public service and include these compatible add-ons. */
  proposal?: { serviceId: string; addOnIds?: string[]; subtotalCents?: number; durationMinutes?: number };
  /** A conversational answer must retain this in-progress draft. */
  preservesSelection?: { serviceId: string; addOnIds?: string[] };
  /** Meaning checks are grounded against the synthetic public facts by the runner. */
  reply?: {
    nonEmpty?: boolean;
    priceForServiceId?: string;
    durationForServiceId?: string;
    /** A direct answer should not mechanically repeat its service subject. */
    noRepeatedServiceId?: string;
    comparisonForServiceIds?: [string, string];
    configuredTotalCents?: number;
    configuredDurationMinutes?: number;
    publicFactKey?: string;
    missingPublicFact?: boolean;
    mentionsAny?: string[];
    excludes?: string[];
    recallsLastUserQuestion?: boolean;
    explainsUnsupported?: boolean;
  };
  availability?: { requested?: { date: string; earliest: string; latest: string }; fallback?: boolean; clarificationDirection?: 'earlier' | 'later' };
  noRepeatedQuestion?: 'service' | 'product' | 'origin' | 'length' | 'finish' | 'quantity';
  handoffReady?: boolean;
};

export type ConversationEvalTurn = {
  message: string;
  expect: ConversationExpectation;
  /** Sign and verify the synthetic conversation before continuing this turn. */
  session?: 'reopen';
  /** Inject an unsuccessful prior turn without calling a provider or changing booking state. */
  priorFailure?: { message: string };
};

export type ConversationEvalCase = {
  id: string;
  category: string;
  availabilityFixture?: 'working_hours';
  turns: ConversationEvalTurn[];
};

const ids = {
  gelManicure: 'svc_semantic_gel_manicure',
  biab: 'svc_semantic_biab',
  gelx: 'svc_semantic_gelx',
  gelxFill: 'svc_semantic_gelx_fill',
  french: 'addon_semantic_french',
  chrome: 'addon_semantic_chrome',
  short: 'addon_semantic_short',
  medium: 'addon_semantic_medium',
  long: 'addon_semantic_long',
  repair: 'addon_semantic_repair',
} as const;

/**
 * The categories map to the receptionist acceptance cases. Some deliberately
 * repeat historically weak price/recall/repair wording so one lucky response
 * cannot hide a conversational regression.
 */
export const CUSTOMER_CONVERSATION_EVAL_CASES: ConversationEvalCase[] = [
  {
    id: 'beginner-guidance-biting',
    category: 'live outcome-only guidance without a forced service questionnaire',
    turns: [
      { message: 'i bite my nails and want them longer but idk what i need', expect: { resultKinds: ['answer', 'clarification'], reply: { mentionsAny: ['length', 'gel-x', 'extensions'], excludes: ['Which service are you looking for?'] } } },
    ],
  },
  {
    id: 'beginner-guidance-typo',
    category: 'outcome-only guidance variation',
    turns: [
      { message: 'my nails r super short n i want length. no clue what to choose', expect: { resultKinds: ['answer', 'clarification'], reply: { mentionsAny: ['length', 'gel-x', 'extensions'], excludes: ['Which service are you looking for?'] } } },
    ],
  },
  {
    id: 'beginner-guidance-wedding-natural',
    category: 'live multi-turn result guidance without irrelevant service chips',
    turns: [
      { message: 'Can you make my nails look nice for a wedding?', expect: { resultKinds: ['answer', 'clarification'], reply: { nonEmpty: true } } },
      { message: 'something natural', expect: { resultKinds: ['answer', 'clarification'], reply: { mentionsAny: ['natural', 'manicure', 'biab', 'gel'], excludes: ['Which service are you looking for?'] } } },
    ],
  },
  {
    id: 'availability-fallback-relative-earlier',
    category: 'live fallback search retains provenance and clarifies relative direction',
    availabilityFixture: 'working_hours',
    turns: [
      { message: 'gel manicure on bare nails', expect: { resultKinds: ['proposal'], proposal: { serviceId: ids.gelManicure } } },
      { message: 'anything Saturday after 5?', expect: { resultKinds: ['slots'], availability: { requested: { date: '2026-09-19', earliest: '17:00', latest: '23:59' }, fallback: true }, reply: { nonEmpty: true } } },
      { message: 'anything earlier?', expect: { resultKinds: ['clarification', 'date_prompt'], availability: { clarificationDirection: 'earlier' }, reply: { nonEmpty: true, excludes: ['There aren’t any earlier times', 'There are no earlier times'] } } },
      { message: 'earlier on Saturday please', expect: { resultKinds: ['slots'], availability: { requested: { date: '2026-09-19', earliest: '00:00', latest: '16:59' }, fallback: false }, reply: { nonEmpty: true } } },
    ],
  },
  ...(['requested', 'displayed', 'corrected'] as const).map(anchor => ({
    id: `availability-fallback-anchor-${anchor}`,
    category: 'relative follow-up resolves a signed original or displayed day after clarification',
    availabilityFixture: 'working_hours' as const,
    turns: [
      { message: 'gel manicure on bare nails', expect: { resultKinds: ['proposal'], proposal: { serviceId: ids.gelManicure } } },
      { message: 'anything Saturday after 5?', expect: { resultKinds: ['slots'], availability: { requested: { date: '2026-09-19', earliest: '17:00', latest: '23:59' }, fallback: true }, reply: { nonEmpty: true } } },
      { message: 'anything earlier?', expect: { resultKinds: ['clarification'], availability: { clarificationDirection: 'earlier' as const }, reply: { nonEmpty: true } } },
      { message: anchor === 'requested' ? 'the original day I asked about' : anchor === 'corrected' ? 'the shown day, actually later' : 'the day you just showed', expect: { resultKinds: ['slots'], availability: { requested: anchor === 'requested' ? { date: '2026-09-19', earliest: '00:00', latest: '16:59' } : anchor === 'corrected' ? { date: '2026-09-21', earliest: '09:01', latest: '23:59' } : { date: '2026-09-21', earliest: '00:00', latest: '08:59' }, fallback: anchor === 'displayed' }, reply: { nonEmpty: true } } },
    ],
  })),
  ...(['the original day', 'earlier on Saturday please'] as const).map((message, index) => ({
    id: `interrupted-availability-recovery-${index}`,
    category: 'continues an unanswered time request after a synthetic provider failure',
    availabilityFixture: 'working_hours' as const,
    turns: [
      { message: 'gel manicure on bare nails', expect: { resultKinds: ['proposal'], proposal: { serviceId: ids.gelManicure } } },
      { message: 'anything Saturday after 5?', expect: { resultKinds: ['slots'], availability: { requested: { date: '2026-09-19', earliest: '17:00', latest: '23:59' }, fallback: true } } },
      { message, priorFailure: { message: 'anything earlier?' }, expect: { resultKinds: ['slots', 'clarification'], preservesSelection: { serviceId: ids.gelManicure }, reply: { nonEmpty: true, excludes: ['matching service', 'not available to book'] } } },
    ],
  })),
  {
    id: 'price-recall-repair-direct',
    category: 'price, recall, and conversational repair',
    turns: [
      { message: 'how much is gel manicure', expect: { resultKinds: ['answer'], answerTopic: 'price', subjects: [ids.gelManicure], reply: { priceForServiceId: ids.gelManicure, noRepeatedServiceId: ids.gelManicure, nonEmpty: true } } },
      { message: 'What did I just ask you?', expect: { resultKinds: ['answer'], answerTopic: 'recall', permittedAnswerTopics: ['recall', 'conversation'], subjects: [ids.gelManicure], reply: { recallsLastUserQuestion: true } } },
      { message: 'No I asked how much', expect: { resultKinds: ['answer'], answerTopic: 'price', subjects: [ids.gelManicure], reply: { priceForServiceId: ids.gelManicure } } },
    ],
  },
  {
    id: 'price-recall-repair-typo',
    category: 'repeated price/recall/repair variation',
    turns: [
      { message: 'gel mani price?', expect: { resultKinds: ['answer'], answerTopic: 'price', subjects: [ids.gelManicure], reply: { priceForServiceId: ids.gelManicure, noRepeatedServiceId: ids.gelManicure } } },
      { message: 'what was my question', expect: { resultKinds: ['answer'], answerTopic: 'recall', permittedAnswerTopics: ['recall', 'conversation'], reply: { recallsLastUserQuestion: true } } },
      { message: 'i said whats the price lol', expect: { resultKinds: ['answer'], answerTopic: 'price', subjects: [ids.gelManicure], reply: { priceForServiceId: ids.gelManicure, noRepeatedServiceId: ids.gelManicure } } },
    ],
  },
  {
    id: 'price-recall-repair-conversational',
    category: 'repeated price/recall/repair variation',
    turns: [
      { message: 'How much does a GEL manicure cost?', expect: { resultKinds: ['answer'], answerTopic: 'price', subjects: [ids.gelManicure], reply: { priceForServiceId: ids.gelManicure, noRepeatedServiceId: ids.gelManicure } } },
      { message: 'what did I ask before that?', expect: { resultKinds: ['answer'], answerTopic: 'recall', permittedAnswerTopics: ['recall', 'conversation'], reply: { recallsLastUserQuestion: true } } },
      { message: 'That did not answer me — price please', expect: { resultKinds: ['answer'], answerTopic: 'price', subjects: [ids.gelManicure], reply: { priceForServiceId: ids.gelManicure, noRepeatedServiceId: ids.gelManicure } } },
    ],
  },
  {
    id: 'compare-gel-manicure-and-biab',
    category: 'service comparison',
    turns: [
      { message: 'What is the difference between gel manicure and BIAB?', expect: { resultKinds: ['answer'], answerTopic: 'compare_treatments', subjects: [ids.gelManicure, ids.biab], reply: { mentionsAny: ['gel', 'biab'] } } },
      { message: 'how much more is BIAB?', expect: { resultKinds: ['answer'], answerTopic: 'price', reply: { comparisonForServiceIds: [ids.gelManicure, ids.biab] } } },
    ],
  },
  {
    id: 'price-followup-comparison',
    category: 'price follow-up comparison from conversational subjects',
    turns: [
      { message: 'How much is a gel manicure?', expect: { resultKinds: ['answer'], answerTopic: 'price', subjects: [ids.gelManicure], reply: { priceForServiceId: ids.gelManicure } } },
      { message: 'What about BIAB?', expect: { resultKinds: ['answer'], answerTopic: 'service_information', permittedAnswerTopics: ['service_information', 'price'], subjects: [ids.biab], reply: { mentionsAny: ['biab', 'builder'] } } },
      { message: 'How much more is that?', expect: { resultKinds: ['answer'], answerTopic: 'price', reply: { comparisonForServiceIds: [ids.gelManicure, ids.biab] } } },
    ],
  },
  {
    id: 'recommend-natural-nails',
    category: 'grounded recommendation',
    turns: [
      { message: 'My nails break all the time. Which one would you recommend for my real nails?', expect: { resultKinds: ['answer', 'clarification'], answerTopic: 'recommendation', reply: { mentionsAny: ['natural', 'biab', 'builder'] } } },
      { message: 'I want strength, not longer nails', expect: { resultKinds: ['answer', 'proposal', 'clarification'], facts: { desiredApplication: 'natural_nails' }, reply: { mentionsAny: ['biab', 'builder', 'natural'] } } },
    ],
  },
  {
    id: 'outcome-without-service-jargon',
    category: 'outcome request without product terminology',
    turns: [
      { message: 'I want my nails longer but idk what I need', expect: { resultKinds: ['answer', 'clarification'], answerTopic: 'length_options', facts: { desiredApplication: 'extensions' }, reply: { mentionsAny: ['length', 'gel-x', 'extension'] } } },
      { message: 'medium please', expect: { resultKinds: ['clarification', 'proposal'], facts: { length: 'medium', desiredApplication: 'extensions' }, noRepeatedQuestion: 'length' } },
    ],
  },
  {
    id: 'current-product-is-not-requested-service',
    category: 'existing product versus desired service',
    turns: [
      { message: 'I have acrylic from another salon and want medium Gel-X with French', expect: { resultKinds: ['unavailable', 'clarification'], facts: { existingProduct: 'acrylic', origin: 'other_salon', treatment: 'gel_x', length: 'medium', french: 'yes' }, reply: { explainsUnsupported: true, excludes: ['could not find matching service'] } } },
      { message: 'what does removal mean?', expect: { resultKinds: ['answer', 'clarification', 'unavailable'], answerTopic: 'conversation', permittedAnswerTopics: ['conversation', 'service_information'], facts: { existingProduct: 'acrylic', treatment: 'gel_x' }, reply: { mentionsAny: ['removal', 'take'] } } },
    ],
  },
  {
    id: 'multiple-facts-one-message',
    category: 'guard-regression multiple facts in one sentence',
    turns: [
      { message: 'I have Gel-X from another salon and want medium Gel-X with French', expect: { resultKinds: ['proposal', 'clarification'], facts: { existingProduct: 'gel_x', origin: 'other_salon', treatment: 'gel_x', length: 'medium', french: 'yes' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.french], subtotalCents: 11000, durationMinutes: 150 } } },
      { message: 'A new set please, remove the old Gel-X.', expect: { resultKinds: ['proposal'], facts: { removal: 'yes', existingProduct: 'gel_x', origin: 'other_salon', length: 'medium', french: 'yes' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.french], subtotalCents: 11000, durationMinutes: 150 } } },
    ],
  },
  {
    id: 'facts-across-turns',
    category: 'guard-regression state retained across turns',
    turns: [
      { message: 'I want medium Gel-X', expect: { resultKinds: ['clarification'], facts: { treatment: 'gel_x', length: 'medium' }, noRepeatedQuestion: 'length' } },
      { message: 'add French', expect: { resultKinds: ['clarification'], facts: { treatment: 'gel_x', length: 'medium', french: 'yes' }, noRepeatedQuestion: 'length' } },
      { message: 'nothing on my nails now', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', length: 'medium', french: 'yes', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.french], subtotalCents: 9000, durationMinutes: 120 } } },
    ],
  },
  {
    id: 'corrections-add-remove-french',
    category: 'incremental corrections and authoritative total',
    turns: [
      { message: 'medium Gel-X, nothing on my nails', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', length: 'medium', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium], subtotalCents: 8000, durationMinutes: 105 } } },
      { message: 'add French', expect: { resultKinds: ['proposal'], facts: { french: 'yes', length: 'medium' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.french], subtotalCents: 9000, durationMinutes: 120 } } },
      { message: 'how much now?', expect: { resultKinds: ['answer'], answerTopic: 'price', facts: { french: 'yes', length: 'medium' }, reply: { configuredTotalCents: 9000 } } },
      { message: 'remove French', expect: { resultKinds: ['proposal'], facts: { french: 'no', length: 'medium' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium], subtotalCents: 8000, durationMinutes: 105 } } },
    ],
  },
  {
    id: 'repair-quantity',
    category: 'repair quantity and correction',
    turns: [
      { message: 'BIAB on my natural nails and two are broken', expect: { resultKinds: ['clarification'], facts: { treatment: 'builder_gel', desiredApplication: 'natural_nails', repairCount: 2 }, noRepeatedQuestion: 'quantity' } },
      { message: 'nothing on my nails right now', expect: { resultKinds: ['proposal'], facts: { existingProduct: 'none', repairCount: 2 }, proposal: { serviceId: ids.biab, addOnIds: [ids.repair], subtotalCents: 6100, durationMinutes: 100 } } },
      { message: 'actually only one repair', expect: { resultKinds: ['proposal'], facts: { repairCount: 1 }, proposal: { serviceId: ids.biab, addOnIds: [ids.repair], subtotalCents: 5800, durationMinutes: 95 } } },
    ],
  },
  {
    id: 'informational-detour-preserves-draft',
    category: 'information during booking keeps state',
    turns: [
      { message: 'medium Gel-X on bare nails', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', length: 'medium', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium] } } },
      { message: 'How long does that take?', expect: { resultKinds: ['answer'], answerTopic: 'duration', facts: { treatment: 'gel_x', length: 'medium', existingProduct: 'none' }, subjects: [ids.gelx], preservesSelection: { serviceId: ids.gelx, addOnIds: [ids.medium] }, reply: { configuredDurationMinutes: 105 } } },
      { message: 'Okay add French', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', length: 'medium', french: 'yes', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.french] } } },
    ],
  },
  {
    id: 'availability-followups',
    category: 'availability follow-ups',
    turns: [
      { message: 'medium Gel-X on bare nails', expect: { resultKinds: ['proposal'], proposal: { serviceId: ids.gelx, addOnIds: [ids.medium] } } },
      { message: 'anything Saturday after 5?', expect: { resultKinds: ['slots'], availability: { requested: { date: '2026-09-19', earliest: '17:00', latest: '23:59' }, fallback: false }, reply: { nonEmpty: true } } },
      { message: 'anything earlier?', expect: { resultKinds: ['slots'], reply: { nonEmpty: true } } },
      { message: 'what about Sunday instead', expect: { resultKinds: ['slots'], reply: { nonEmpty: true } } },
    ],
  },
  {
    id: 'informational-conversation-never-books',
    category: 'conversation that never becomes a booking',
    turns: [
      { message: 'what is BIAB?', expect: { resultKinds: ['answer'], answerTopic: 'service_information', subjects: [ids.biab], reply: { mentionsAny: ['biab', 'builder'] } } },
      { message: 'where are you located?', expect: { resultKinds: ['answer'], answerTopic: 'salon_information', reply: { nonEmpty: true } } },
      { message: 'can I see your prices?', expect: { resultKinds: ['answer'], answerTopic: 'price', reply: { nonEmpty: true } } },
    ],
  },
  {
    id: 'public-business-facts-and-safe-unknowns',
    category: 'public business facts and absent-fact honesty',
    turns: [
      { message: 'Where are you located?', expect: { resultKinds: ['answer'], answerTopic: 'salon_information', reply: { publicFactKey: 'salon_location' } } },
      { message: 'What are your opening hours?', expect: { resultKinds: ['answer'], answerTopic: 'salon_information', reply: { publicFactKey: 'salon_hours' } } },
      { message: 'What is your cancellation policy?', expect: { resultKinds: ['answer'], answerTopic: 'salon_information', reply: { publicFactKey: 'salon_policy_0' } } },
      { message: 'Do you take a deposit?', expect: { resultKinds: ['answer'], answerTopic: 'salon_information', permittedAnswerTopics: ['salon_information', 'conversation'], reply: { missingPublicFact: true, mentionsAny: ['do not have', 'don\'t have', 'cannot verify', 'can’t verify', 'not listed'] } } },
      { message: 'Where should I park?', expect: { resultKinds: ['answer'], answerTopic: 'salon_information', permittedAnswerTopics: ['salon_information', 'conversation'], reply: { missingPublicFact: true, mentionsAny: ['do not have', 'don\'t have', 'cannot verify', 'can’t verify', 'not listed'] } } },
    ],
  },
  {
    id: 'complete-change-of-mind',
    category: 'complete change of mind',
    turns: [
      { message: 'long Gel-X with French, bare natural nails', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', length: 'long', french: 'yes', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.long, ids.french] } } },
      { message: 'actually forget Gel-X, I want BIAB', expect: { resultKinds: ['proposal', 'clarification'], facts: { treatment: 'builder_gel' }, proposal: { serviceId: ids.biab } } },
    ],
  },
  {
    id: 'explicit-same-length-survives-treatment-switch',
    category: 'explicit same-length instruction is not mistaken for stale state',
    turns: [
      { message: 'long Gel-X on bare nails', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', desiredApplication: 'extensions', length: 'long', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.long] } } },
      { message: 'Actually I want BIAB, but keep them long', expect: { resultKinds: ['clarification', 'unavailable', 'proposal'], facts: { treatment: 'builder_gel', desiredApplication: 'natural_nails', length: 'long' } } },
    ],
  },
  {
    id: 'fill-versus-new-set-guidance',
    category: 'maintenance advice does not silently switch a service',
    turns: [
      { message: 'I have Gel-X already. Should I get a fill or a new set?', expect: { resultKinds: ['answer', 'clarification'], facts: { existingProduct: 'gel_x' }, reply: { mentionsAny: ['fill', 'new set', 'gel-x'] } } },
      { message: 'I want a fill', expect: { resultKinds: ['proposal'], facts: { maintenance: 'refill', existingProduct: 'gel_x' }, proposal: { serviceId: ids.gelxFill } } },
    ],
  },
  {
    id: 'proposal-ready-for-normal-handoff',
    category: 'proposal acceptance and normal booking handoff readiness',
    turns: [
      { message: 'Gel manicure with French on bare nails', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_polish', french: 'yes', existingProduct: 'none' }, proposal: { serviceId: ids.gelManicure, addOnIds: [ids.french] }, handoffReady: true } },
    ],
  },
  {
    id: 'book-that-one-resolves-conversational-referent',
    category: 'clear conversational referent becomes a service request',
    turns: [
      { message: 'How much is a gel manicure?', expect: { resultKinds: ['answer'], answerTopic: 'price', subjects: [ids.gelManicure], reply: { priceForServiceId: ids.gelManicure } } },
      { message: 'Okay, book that one', expect: { resultKinds: ['clarification', 'proposal'], facts: { treatment: 'gel_polish' }, noRepeatedQuestion: 'service' } },
    ],
  },
  {
    id: 'reopen-preserves-booking-state',
    category: 'close and reopen assistant with draft preserved',
    turns: [
      { message: 'medium Gel-X on bare nails', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', length: 'medium', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium] } } },
      { message: 'add chrome', session: 'reopen', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', length: 'medium', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.chrome] } } },
    ],
  },
  {
    id: 'known-selection-survives-recall-public-facts-and-corrections',
    category: 'known selection survives conversational detours and corrections',
    turns: [
      { message: 'medium Gel-X on bare nails with French', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', length: 'medium', french: 'yes', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.french], subtotalCents: 9000, durationMinutes: 120 } } },
      { message: 'what did I ask you?', expect: { resultKinds: ['answer'], answerTopic: 'recall', permittedAnswerTopics: ['recall', 'conversation'], facts: { treatment: 'gel_x', length: 'medium', french: 'yes', existingProduct: 'none' }, preservesSelection: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.french] }, reply: { recallsLastUserQuestion: true } } },
      { message: 'where are you located?', expect: { resultKinds: ['answer'], answerTopic: 'salon_information', facts: { treatment: 'gel_x', length: 'medium', french: 'yes', existingProduct: 'none' }, preservesSelection: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.french] }, reply: { publicFactKey: 'salon_location' } } },
      { message: 'how long does that take?', expect: { resultKinds: ['answer'], answerTopic: 'duration', facts: { treatment: 'gel_x', length: 'medium', french: 'yes', existingProduct: 'none' }, preservesSelection: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.french] }, reply: { configuredDurationMinutes: 120 } } },
      { message: 'add chrome', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', length: 'medium', french: 'yes', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.french, ids.chrome], subtotalCents: 10200, durationMinutes: 130 } } },
      { message: 'remove French', expect: { resultKinds: ['proposal'], facts: { treatment: 'gel_x', length: 'medium', french: 'no', existingProduct: 'none' }, proposal: { serviceId: ids.gelx, addOnIds: [ids.medium, ids.chrome], subtotalCents: 9200, durationMinutes: 115 } } },
      { message: 'actually short, how much now?', expect: { resultKinds: ['answer', 'proposal'], facts: { treatment: 'gel_x', length: 'short', french: 'no', existingProduct: 'none' }, preservesSelection: { serviceId: ids.gelx, addOnIds: [ids.short, ids.chrome] }, reply: { configuredTotalCents: 8200, configuredDurationMinutes: 100 } } },
    ],
  },
  {
    id: 'unsupported-request-useful-explicit-no-transition',
    category: 'current product remains authoritative during an explicit no-removal change',
    turns: [
      { message: 'I have acrylic on my nails from another salon and want BIAB, but no removal.', expect: { resultKinds: ['unavailable', 'clarification'], facts: { existingProduct: 'acrylic', treatment: 'builder_gel', removal: 'no' }, reply: { nonEmpty: true } } },
      { message: 'What is the normal BIAB price though?', expect: { resultKinds: ['answer'], reply: { priceForServiceId: ids.biab }, facts: { existingProduct: 'acrylic', removal: 'no' } } },
    ],
  },
  {
    id: 'unsupported-request-useful-recovery',
    category: 'unsupported request with useful recovery',
    turns: [
      { message: 'Can I get an acrylic refill?', expect: { resultKinds: ['unavailable'], facts: { treatment: 'acrylic', maintenance: 'refill' }, reply: { explainsUnsupported: true, excludes: ['internal error', 'invalid request'] } } },
      { message: 'What about BIAB instead?', expect: { resultKinds: ['answer', 'proposal', 'clarification'], answerTopic: 'service_information', subjects: [ids.biab], reply: { mentionsAny: ['biab', 'builder'] } } },
    ],
  },
  {
    id: 'genuinely-ambiguous-one-focused-clarification',
    category: 'ambiguous request gets one useful clarification',
    turns: [
      { message: 'Can you make my nails look nice for a wedding?', expect: { resultKinds: ['clarification', 'answer'], reply: { nonEmpty: true } } },
      { message: 'I want them longer, maybe medium', expect: { resultKinds: ['clarification', 'answer'], facts: { desiredApplication: 'extensions', length: 'medium' }, noRepeatedQuestion: 'length' } },
    ],
  },
];
