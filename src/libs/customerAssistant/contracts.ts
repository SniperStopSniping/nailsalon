import { z } from 'zod';

export const CUSTOMER_ASSISTANT_MODEL = 'gpt-5.6-luna';
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
  addOns: { id: string; name: string; quantity: number; priceCents: number }[];
  currency: string;
  subtotalCents: number;
  durationMinutes: number;
  expiresAt: string;
};

export type CustomerAssistantResult =
  | { kind: 'proposal'; proposal: CustomerProposal }
  | { kind: 'clarification'; question: 'service' | 'removal' | 'length' | 'finish' | 'quantity' | 'details'; options: string[] }
  | { kind: 'unavailable'; reason: 'no_match' | 'unavailable' | 'rate_limited' | 'conversation_used' | 'selection_changed' | 'invalid_conversation' };

export type CustomerAssistantResponse = { conversation: string; result: CustomerAssistantResult };
