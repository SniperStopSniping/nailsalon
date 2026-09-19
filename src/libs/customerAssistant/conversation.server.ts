import 'server-only';

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { customerAvailableSlotSchema, customerDatePreferenceSchema, customerSelectionSchema } from './contracts';
import { factsSchema } from './semanticFacts';

export const CONVERSATION_TTL_MS = 30 * 60 * 1000;
export const CONVERSATION_ABSOLUTE_TTL_MS = 2 * 60 * 60 * 1000;
export const CUSTOMER_CONVERSATION_MAX_TURNS = 32;
export const CUSTOMER_CONVERSATION_MAX_MESSAGES = 16;
export const CUSTOMER_CONVERSATION_MAX_MESSAGE_CHARS = 600;
export const CUSTOMER_CONVERSATION_MAX_TOKEN_BYTES = 24_576;

const customerMessageSchema = z.string().min(1).max(CUSTOMER_CONVERSATION_MAX_MESSAGE_CHARS);

const customerConversationContextSchema = z.object({
  question: z.enum(['service', 'removal', 'product', 'origin', 'length', 'finish', 'quantity', 'details', 'date']).nullable(),
  answerTopic: z.enum(['compare_treatments', 'length_options', 'service_options', 'unknown_product', 'service_information']).optional(),
  options: z.array(z.string().min(1).max(160)).max(8),
  selection: customerSelectionSchema.nullable(),
}).strict();

// This is deliberately only a signed presentation capability.  It is not a
// slot hold and contains no contact, payment, technician, or appointment data.
const customerConversationBookingSchema = z.object({
  acceptedFingerprint: z.string().length(64).nullable(),
  datePreference: customerDatePreferenceSchema.nullable(),
  offeredSlots: z.array(customerAvailableSlotSchema).max(8),
  selectedSlot: customerAvailableSlotSchema.nullable(),
}).strict();

const conversationSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  lastActivityAtMs: z.number().int().nonnegative().optional(),
  salonId: z.string().min(1),
  sessionId: z.string().uuid(),
  issuedAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  turnIndex: z.number().int().min(0).max(CUSTOMER_CONVERSATION_MAX_TURNS),
  messages: z.array(customerMessageSchema).max(CUSTOMER_CONVERSATION_MAX_MESSAGES),
  facts: factsSchema.optional(),
  requestedSelection: customerSelectionSchema.optional(),
  availabilityPreference: customerDatePreferenceSchema.optional(),
  context: customerConversationContextSchema.optional(),
  booking: customerConversationBookingSchema.optional(),
}).strict().superRefine((value, context) => {
  const activity = value.lastActivityAtMs ?? value.issuedAtMs;
  const expectedExpiry = value.version === 1 ? value.issuedAtMs + CONVERSATION_TTL_MS : Math.min(activity + CONVERSATION_TTL_MS, value.issuedAtMs + CONVERSATION_ABSOLUTE_TTL_MS);
  if (value.expiresAtMs !== expectedExpiry || activity < value.issuedAtMs || activity > value.expiresAtMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid conversation lifetime' });
  }
});

export type CustomerConversationMessage = z.infer<typeof customerMessageSchema>;
export type CustomerConversationContext = z.infer<typeof customerConversationContextSchema>;
export type CustomerConversation = z.infer<typeof conversationSchema>;

export class CustomerConversationInvalidError extends Error {
  constructor(readonly detail: 'malformed' | 'signature' | 'expired' | 'mismatch' | 'payload') {
    super('CUSTOMER_CONVERSATION_INVALID');
    this.name = 'CustomerConversationInvalidError';
  }
}

export function createCustomerConversation(
  salonId: string,
  _secret: string,
  now = Date.now(),
): CustomerConversation {
  return {
    version: 2,
    lastActivityAtMs: now,
    salonId,
    sessionId: randomUUID(),
    issuedAtMs: now,
    expiresAtMs: now + CONVERSATION_TTL_MS,
    turnIndex: 0,
    messages: [],
  };
}

export function signCustomerConversation(payload: CustomerConversation, secret: string): string {
  const parsed = conversationSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CustomerConversationInvalidError('payload');
  }

  const encoded = Buffer.from(JSON.stringify(parsed.data), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  const token = `${encoded}.${signature}`;
  if (Buffer.byteLength(token, 'utf8') > CUSTOMER_CONVERSATION_MAX_TOKEN_BYTES) {
    throw new CustomerConversationInvalidError('payload');
  }
  return token;
}

export function verifyCustomerConversation(
  token: string,
  salonId: string,
  secret: string,
  now = Date.now(),
): CustomerConversation {
  if (Buffer.byteLength(token, 'utf8') > CUSTOMER_CONVERSATION_MAX_TOKEN_BYTES) {
    throw new CustomerConversationInvalidError('malformed');
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CustomerConversationInvalidError('malformed');
  }
  const [encoded, suppliedSignature] = parts as [string, string];
  const expected = createHmac('sha256', secret).update(encoded).digest();
  const actual = Buffer.from(suppliedSignature, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new CustomerConversationInvalidError('signature');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new CustomerConversationInvalidError('malformed');
  }
  const parsed = conversationSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new CustomerConversationInvalidError('payload');
  }
  if (parsed.data.issuedAtMs > now + 60_000 || (parsed.data.lastActivityAtMs ?? 0) > now + 60_000) {
    throw new CustomerConversationInvalidError('payload');
  }
  if (parsed.data.expiresAtMs <= now) {
    throw new CustomerConversationInvalidError('expired');
  }
  if (parsed.data.salonId !== salonId) {
    throw new CustomerConversationInvalidError('mismatch');
  }
  return parsed.data;
}

/** Activity extends only idle time; it never resets the absolute session or turn budgets. */
export function advanceCustomerConversation(conversation: CustomerConversation, now = Date.now()): CustomerConversation {
  return { ...conversation, version: 2, lastActivityAtMs: now, expiresAtMs: Math.min(now + CONVERSATION_TTL_MS, conversation.issuedAtMs + CONVERSATION_ABSOLUTE_TTL_MS), turnIndex: conversation.turnIndex + 1 };
}

export function conversationInvalidReason(error: unknown): 'conversation_expired' | 'invalid_conversation' {
  return error instanceof CustomerConversationInvalidError && error.detail === 'expired' ? 'conversation_expired' : 'invalid_conversation';
}
