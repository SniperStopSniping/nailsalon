import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  type ConversationPayload,
  conversationPayloadSchema,
  type ConversationTurn,
  OWNER_ASSISTANT_LIMITS,
} from './contracts';
import { getOwnerAssistantSigningSecret } from './enablement.server';

/**
 * The signed, client-held conversation window (docs/OWNER_ASSISTANT_CHAT.md §3.6).
 *
 * Nothing is stored server-side. The transcript travels with the client inside
 * an HMAC-signed token that also carries `(salonId, adminId)`, so a token
 * cannot be replayed into another salon or by another admin even if it leaks.
 * Modelled on `signOAuthState`/`verifyOAuthState` in
 * `src/libs/lusterSecurity.ts`; the differences are the explicit binding check
 * and the size/count truncation this window needs.
 */

export class ConversationInvalidError extends Error {
  constructor(readonly detail: 'malformed' | 'signature' | 'expired' | 'mismatch' | 'payload') {
    super('CONVERSATION_INVALID');
    this.name = 'ConversationInvalidError';
  }
}

function nowSeconds(now?: Date): number {
  return Math.floor((now?.getTime() ?? Date.now()) / 1000);
}

export function signConversation(payload: ConversationPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', getOwnerAssistantSigningSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyConversation(
  token: string,
  binding: { salonId: string; adminId: string; now?: Date },
): ConversationPayload {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) {
    throw new ConversationInvalidError('malformed');
  }

  const expected = createHmac('sha256', getOwnerAssistantSigningSecret()).update(encoded).digest();
  const actual = Buffer.from(signature, 'base64url');
  // Length check first: timingSafeEqual throws on a length mismatch, and an
  // exception here would be a different (observable) failure mode.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new ConversationInvalidError('signature');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new ConversationInvalidError('malformed');
  }

  const parsed = conversationPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ConversationInvalidError('payload');
  }

  const now = nowSeconds(binding.now);
  if (parsed.data.exp <= now) {
    throw new ConversationInvalidError('expired');
  }
  // `renewExpiry` slides `exp` forward on every turn; the absolute cap keeps
  // a token from living forever on activity alone.
  if (now - parsed.data.iat > OWNER_ASSISTANT_LIMITS.conversationMaxAgeSeconds) {
    throw new ConversationInvalidError('expired');
  }

  if (parsed.data.salonId !== binding.salonId || parsed.data.adminId !== binding.adminId) {
    throw new ConversationInvalidError('mismatch');
  }

  return parsed.data;
}

export function createConversation(args: {
  salonId: string;
  adminId: string;
  now?: Date;
}): ConversationPayload {
  const iat = nowSeconds(args.now);
  return {
    v: 1,
    cid: randomBytes(16).toString('base64url'),
    salonId: args.salonId,
    adminId: args.adminId,
    iat,
    exp: iat + OWNER_ASSISTANT_LIMITS.conversationTtlSeconds,
    turnCount: 0,
    turns: [],
  };
}

/**
 * Append turns and re-enforce both window caps by dropping the OLDEST turns
 * first. The byte cap is measured on the serialized payload, which is what
 * actually travels, so a single very long turn cannot blow the request size.
 */
export function appendTurns(
  payload: ConversationPayload,
  turns: ConversationTurn[],
): ConversationPayload {
  const next: ConversationPayload = { ...payload, turns: [...payload.turns, ...turns] };

  if (next.turns.length > OWNER_ASSISTANT_LIMITS.conversationMaxMessages) {
    next.turns = next.turns.slice(next.turns.length - OWNER_ASSISTANT_LIMITS.conversationMaxMessages);
  }

  while (
    next.turns.length > 1
    && Buffer.byteLength(JSON.stringify(next), 'utf8') > OWNER_ASSISTANT_LIMITS.conversationMaxBytes
  ) {
    next.turns = next.turns.slice(1);
  }

  return next;
}

/** Slide the expiry forward so an active conversation is not cut off mid-use. */
export function renewExpiry(payload: ConversationPayload, now?: Date): ConversationPayload {
  return { ...payload, exp: nowSeconds(now) + OWNER_ASSISTANT_LIMITS.conversationTtlSeconds };
}
