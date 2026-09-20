import { z } from 'zod';

/** Natural-language composition remains on Luna; interpretation is separately bounded. */
export const CUSTOMER_ASSISTANT_MODEL = 'gpt-5.6-luna';
export const CUSTOMER_ASSISTANT_INTERPRETATION_MODEL = 'gpt-5.6-terra';
export type CustomerAssistantModelStage = 'interpreter' | 'composer';
export const CUSTOMER_ASSISTANT_MAX_INPUT_BYTES = 30_000;
export const CUSTOMER_ASSISTANT_MAX_OUTPUT_TOKENS = 1_200;

export const customerSelectionSchema = z.object({
  baseServiceId: z.string().min(1).max(100),
  selectedAddOns: z.array(z.object({
    addOnId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(20),
  }).strict()).max(20),
}).strict();

export type CustomerSelection = z.infer<typeof customerSelectionSchema>;
export type CustomerAssistantLocale = 'en' | 'fr';

export const customerChatRequestSchema = z.object({
  conversation: z.string().min(1).max(24_576),
  message: z.string().trim().min(1).max(600),
  locale: z.enum(['en', 'fr']),
}).strict();

export type CustomerProposal = {
  selection: CustomerSelection;
  fingerprint: string;
  service: { id: string; name: string; priceCents: number };
  addOns: { id: string; name: string; quantity: number; priceCents: number; unitPriceCents?: number }[];
  currency: string;
  subtotalCents: number;
  durationMinutes: number;
  expiresAt: string;
  configuration?: string[];
};

export const customerDatePreferenceSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  earliest: z.string().regex(/^\d{2}:\d{2}$/),
  latest: z.string().regex(/^\d{2}:\d{2}$/),
}).strict();
export type CustomerDatePreference = z.infer<typeof customerDatePreferenceSchema>;

/** Public, signed presentation context for a checked availability result. */
export const customerAvailabilitySearchSchema = z.object({
  requestedPreference: customerDatePreferenceSchema,
  displayedPreference: customerDatePreferenceSchema,
  fallback: z.boolean(),
  // Set only while a focused requested-vs-displayed follow-up is pending.
  pendingTimingFeedback: z.enum(['too_late', 'too_early']).optional(),
}).strict();
export type CustomerAvailabilitySearch = z.infer<typeof customerAvailabilitySearchSchema>;

export const customerAvailableSlotSchema = z.object({
  time: z.string().min(1).max(80),
  startTime: z.string().datetime(),
}).strict();
export type CustomerAvailableSlot = z.infer<typeof customerAvailableSlotSchema>;

export const customerActionRequestSchema = z.discriminatedUnion('action', [
  z.object({ conversation: z.string().min(1).max(24_576), action: z.literal('accept_selection'), fingerprint: z.string().length(64) }).strict(),
  z.object({ conversation: z.string().min(1).max(24_576), action: z.literal('choose_date'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ conversation: z.string().min(1).max(24_576), action: z.literal('select_slot'), startTime: z.string().datetime() }).strict(),
]);
export type CustomerAssistantAction =
  | { action: 'accept_selection'; fingerprint: string }
  | { action: 'choose_date'; date: string }
  | { action: 'select_slot'; startTime: string };

/** Explicitly accepts a currently signed, authoritative proposal for the normal booking flow. */
export const customerHandoffRequestSchema = z.object({
  locale: z.enum(['en', 'fr']).optional(),
  conversation: z.string().min(1).max(24_576),
  fingerprint: z.string().length(64),
  flowToken: z.string().min(1).max(1_024).optional(),
  operationCapability: z.string().min(1).max(200).optional(),
}).strict();

export type CustomerAssistantHandoff = {
  selection: CustomerSelection;
  flow: { flowToken: string; expiresAt: string };
  datePreference?: CustomerDatePreference;
  operation?: import('./bookingOperationContracts').CustomerBookingOperationReference;
};

export type CustomerAssistantHandoffResponse = {
  conversation: string;
  result: { kind: 'handoff'; handoff: CustomerAssistantHandoff }
    | Extract<CustomerAssistantResult, { kind: 'proposal' | 'clarification' | 'unavailable' }>;
};

/** A public choice whose optional amounts were resolved by the same L1 authority as booking. */
export type CustomerConsultationChoice = {
  label: string;
  message: string;
  subtotalCents?: number;
  durationMinutes?: number;
  deltaCents?: number;
  currency?: string;
};

export type CustomerAssistantResult = (
  | { kind: 'answer'; message: string; options: string[]; alternatives?: CustomerConsultationChoice[]; topic?: 'compare_treatments' | 'length_options' | 'service_options' | 'unknown_product' | 'service_information' | 'price' | 'duration' | 'recall' | 'salon_information' | 'recommendation' | 'conversation' }
  | { kind: 'proposal'; proposal: CustomerProposal }
  | { kind: 'date_prompt'; proposal: CustomerProposal; today: string; timeZone: string }
  | { kind: 'slots'; proposal: CustomerProposal; preference: CustomerDatePreference; timeZone: string; slots: CustomerAvailableSlot[]; checkedAt: string; slotDisappeared?: boolean; search?: CustomerAvailabilitySearch }
  | { kind: 'slot_selected'; proposal: CustomerProposal; preference: CustomerDatePreference; timeZone: string; slot: CustomerAvailableSlot }
  | { kind: 'clarification'; question: 'service' | 'removal' | 'product' | 'origin' | 'length' | 'finish' | 'quantity' | 'details' | 'date'; options: string[]; choices?: CustomerConsultationChoice[] }
  | { kind: 'unavailable'; reason: 'no_match' | 'unsupported_combination' | 'unavailable' | 'rate_limited' | 'conversation_used' | 'selection_changed' | 'invalid_conversation' | 'conversation_expired' | 'session_limit' | 'stale_conversation' | 'unsupported_service' | 'unsupported_removal' | 'transition_needs_confirmation' | 'incompatible_selection' | 'unknown_product' | 'no_availability' | 'handoff_expired' | 'invalid_handoff' }) & { message?: string; availabilitySearch?: CustomerAvailabilitySearch };

export type CustomerAssistantResponse = { conversation: string; result: CustomerAssistantResult };
