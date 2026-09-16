/**
 * Owner Assistant (A1-1) — shared contracts.
 *
 * Pure module: no I/O, no `server-only`, safe to import from the client. Every
 * request/response shape, tool argument schema, the model's final-answer
 * schema and the pilot limits live here so the server, the UI and the tests
 * agree on one definition.
 *
 * Trust boundary (docs/OWNER_ASSISTANT_CHAT.md §3): the model interprets and
 * explains; Luster code authorizes, resolves the salon, runs the tools and
 * decides what the owner sees. Nothing in this file grants authority.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Pilot limits (Owner decision A-3, 2026-09-16) and fixed parameters
// ---------------------------------------------------------------------------

export const OWNER_ASSISTANT_LIMITS = {
  /** Owner-salon turns per UTC day. */
  turnsPerDay: 30,
  /** Owner-salon turns per UTC month. */
  turnsPerMonth: 300,
  /** All salons together, per UTC day. */
  globalTurnsPerDay: 2000,
  /** Model round trips per turn (first call + tool-result follow-ups). */
  modelCallsPerTurn: 3,
  /** Luster tool executions per turn, across all model calls. */
  toolCallsPerTurn: 5,
  /** Upper bound on visible + reasoning output tokens per model call. */
  maxOutputTokens: 1200,
  /** Abort a single model call after this long. */
  modelCallTimeoutMs: 20_000,
  /** Abort the whole turn after this long (route declares maxDuration = 60). */
  turnTimeoutMs: 45_000,
  /** Signed conversation validity. */
  conversationTtlSeconds: 24 * 60 * 60,
  /** Messages kept in the signed window (12 owner/assistant exchanges). */
  conversationMaxMessages: 24,
  /** Serialized window size cap; oldest messages drop first. */
  conversationMaxBytes: 16_384,
  /** Owner message length cap. */
  messageMaxChars: 1000,
} as const;

export const OWNER_ASSISTANT_DEFAULT_MODEL = 'gpt-5.6-luna';

/**
 * Price table used for ledger cost accounting (USD micros per 1M tokens),
 * from developers.openai.com/api/docs/pricing on 2026-09-15. Unknown models
 * are ledgered with cost 0 and `priceKnown: false`.
 */
export const OWNER_ASSISTANT_MODEL_PRICES_MICROS_PER_MILLION: Record<string, { input: number; cachedInput: number; output: number }> = {
  'gpt-5.6-luna': { input: 200_000, cachedInput: 20_000, output: 1_200_000 },
  'gpt-5.6-terra': { input: 2_000_000, cachedInput: 200_000, output: 12_000_000 },
  'gpt-5-nano': { input: 50_000, cachedInput: 5_000, output: 400_000 },
  'gpt-5.4-mini': { input: 750_000, cachedInput: 75_000, output: 4_500_000 },
};

export const OWNER_ASSISTANT_SUGGESTED_QUESTIONS = [
  'What services do I offer?',
  'Where do I upload my logo?',
  'Where do I change my hours?',
  'Is my booking page live?',
] as const;

/** Shown in the sheet; Owner decision A-4 (AI disclosure). */
export const OWNER_ASSISTANT_DISCLOSURE
  = 'AI assistant. It uses your Luster setup to answer questions and cannot change anything.';

// ---------------------------------------------------------------------------
// Tools (read-only). Names, argument schemas and the OpenAI function schemas.
// ---------------------------------------------------------------------------

export const OWNER_ASSISTANT_TOOL_NAMES = ['get_salon_overview', 'list_services', 'find_destination'] as const;
export type OwnerAssistantToolName = (typeof OWNER_ASSISTANT_TOOL_NAMES)[number];

export const getSalonOverviewArgsSchema = z.object({}).strict();
export const listServicesArgsSchema = z.object({ includeInactive: z.boolean() }).strict();
export const findDestinationArgsSchema = z.object({ query: z.string().trim().min(1).max(200) }).strict();

export const OWNER_ASSISTANT_TOOL_ARG_SCHEMAS = {
  get_salon_overview: getSalonOverviewArgsSchema,
  list_services: listServicesArgsSchema,
  find_destination: findDestinationArgsSchema,
} as const;

/**
 * OpenAI Responses API function tools (strict mode: every property required,
 * additionalProperties false). Keep in lockstep with the zod schemas above;
 * contracts.test.ts asserts a sample parses under both.
 */
export const OWNER_ASSISTANT_TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'get_salon_overview',
    description: 'Get this salon\'s current setup: publication status, timezone, business hours summary, booking rules, technicians, connected integrations and booking-page facts. Call this first when the owner asks about setup, status, hours, rules or "is my page live".',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'list_services',
    description: 'List this salon\'s services and add-ons with prices, durations, categories, active status and whether each service is currently bookable online. Set includeInactive to true only when the owner asks about hidden or switched-off services.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { includeInactive: { type: 'boolean', description: 'Include services and add-ons that are switched off.' } },
      required: ['includeInactive'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'find_destination',
    description: 'Find where in the Luster dashboard a setting or task lives (for example "logo", "business hours", "minimum notice", "publish"). Returns navigation keys you may cite in `links`. Never invent a location: if nothing matches, say so.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What the owner wants to find or change, in their words.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Tool results (server projections; Tier 0 only — no client data ever)
// ---------------------------------------------------------------------------

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type SalonOverviewResult = {
  salonName: string;
  salonSlug: string;
  /** 'published' means customers can reach the booking page. */
  publicationStatus: string;
  timezone: string;
  /** Today's date in the salon timezone, YYYY-MM-DD. */
  today: string;
  currency: string;
  businessMode: string | null;
  technicianCount: number;
  /** Staff display names (staff, not clients). */
  technicianNames: string[];
  hours: {
    /** Which record supplies the opening-hours ceiling. 'none' = no ceiling. */
    source: 'location' | 'salon' | 'none';
    openDays: Weekday[];
    /** e.g. { monday: '10:00–18:00' }; closed days omitted. */
    byDay: Partial<Record<Weekday, string>>;
  };
  bookingRules: {
    minimumNoticeMinutes: number;
    slotIntervalMinutes: number;
    bufferMinutes: number;
  };
  integrations: {
    googleCalendar: 'not_connected' | 'reconnect_required' | 'attention_required' | 'setup_incomplete' | 'ready';
    paymentsConnected: boolean;
  };
  bookingPage: {
    logoSaved: boolean;
    profilePhotoSaved: boolean;
    hasBio: boolean;
    heroImageSaved: boolean;
  };
};

export type ListServicesResult = {
  currency: string;
  /** Present when the salon has no active technician, which hides every service online. */
  note?: 'no_active_technicians';
  services: Array<{
    id: string;
    name: string;
    priceCents: number;
    priceDisplayText: string | null;
    durationMinutes: number;
    category: string;
    isActive: boolean;
    /** Visible to customers on the public booking page right now. */
    bookable: boolean;
    hasVariants: boolean;
    isIntroPrice: boolean;
  }>;
  addOns: Array<{
    id: string;
    name: string;
    priceCents: number;
    durationMinutes: number;
    category: string;
    pricingType: string;
    isActive: boolean;
  }>;
};

export type FindDestinationResult = {
  matches: Array<{
    key: string;
    label: string;
    description: string;
    /** 'parent' = lands on the parent screen; the sub-view is not URL-addressable yet. */
    addressable: 'exact' | 'exact_on_open' | 'parent';
  }>;
};

// ---------------------------------------------------------------------------
// Model final answer (strict JSON schema for the Responses API + zod twin)
// ---------------------------------------------------------------------------

export const assistantAnswerSchema = z.object({
  message: z.string().min(1).max(2000),
  links: z.array(z.object({ key: z.string().min(1).max(64) }).strict()).max(4),
  followUps: z.array(z.string().min(1).max(120)).max(3),
  needsClarification: z.boolean(),
}).strict();
export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;

export const ASSISTANT_ANSWER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'Plain-text reply to the owner. No markdown links, no URLs.' },
    links: {
      type: 'array',
      description: 'Navigation keys from find_destination results that help the owner act. Empty when none apply.',
      items: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false },
    },
    followUps: { type: 'array', description: 'Up to three short follow-up questions the owner might ask next.', items: { type: 'string' } },
    needsClarification: { type: 'boolean', description: 'True when the message asks the owner a clarifying question instead of answering.' },
  },
  required: ['message', 'links', 'followUps', 'needsClarification'],
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// Signed conversation window
// ---------------------------------------------------------------------------

export const conversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4000),
  /** Tool names that ran for an assistant turn (rendered as "Checked:"). */
  checked: z.array(z.string().max(64)).max(8).optional(),
}).strict();
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

export const conversationPayloadSchema = z.object({
  v: z.literal(1),
  /** Conversation id (random, opaque). */
  cid: z.string().min(8).max(64),
  salonId: z.string().min(1),
  adminId: z.string().min(1),
  /** Issued-at and expiry, unix seconds. */
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  /** Number of turns completed in this conversation (monotonic). */
  turnCount: z.number().int().nonnegative(),
  turns: z.array(conversationTurnSchema).max(OWNER_ASSISTANT_LIMITS.conversationMaxMessages),
}).strict();
export type ConversationPayload = z.infer<typeof conversationPayloadSchema>;

// ---------------------------------------------------------------------------
// HTTP contracts
// ---------------------------------------------------------------------------

export const chatRequestSchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(OWNER_ASSISTANT_LIMITS.messageMaxChars),
  /** Signed conversation token returned by the previous turn; omit to start fresh. */
  conversation: z.string().max(65_536).optional(),
  locale: z.enum(['en', 'fr']).optional(),
}).strict();
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const CHAT_UNAVAILABLE_REASONS = [
  'not_configured',
  'redis_unavailable',
  'budget_exhausted',
  'provider_error',
  'provider_timeout',
  'model_output_invalid',
  'turn_timeout',
] as const;
export type ChatUnavailableReason = (typeof CHAT_UNAVAILABLE_REASONS)[number];

export type ChatLink = { key: string; label: string; href: string };
export type ChatChecked = { tool: OwnerAssistantToolName; label: string };

export type ChatTurnResponse =
  | {
    kind: 'answer';
    message: string;
    checked: ChatChecked[];
    links: ChatLink[];
    followUps: string[];
    needsClarification: boolean;
    /** New signed conversation token to send with the next message. */
    conversation: string;
    usage: { modelCalls: number; toolCalls: number };
  }
  | {
    kind: 'unavailable';
    reason: ChatUnavailableReason;
    /** Owner-facing sentence; never provider text. */
    message: string;
    /** Present when the previous conversation stays valid. */
    conversation?: string;
  };

export type ContextResponse = {
  enabled: true;
  salonSlug: string;
  salonName: string;
  tools: OwnerAssistantToolName[];
  model: { available: true } | { available: false; reason: 'not_configured' | 'redis_unavailable' };
  suggestedQuestions: string[];
  disclosure: string;
};

/** Error envelope for non-2xx responses (matches the admin API convention). */
export type ChatErrorCode = 'BAD_REQUEST' | 'CONVERSATION_INVALID' | 'UNAUTHORIZED' | 'OWNER_REQUIRED' | 'IMPERSONATION_NOT_ALLOWED';

export const CHAT_UNAVAILABLE_MESSAGES: Record<ChatUnavailableReason, string> = {
  not_configured: 'The assistant isn\'t set up for this salon yet.',
  redis_unavailable: 'The assistant isn\'t available right now. Please try again in a moment.',
  budget_exhausted: 'You\'ve reached the assistant limit for now. It resets daily.',
  provider_error: 'I couldn\'t reach the assistant service just now. Please try again in a moment.',
  provider_timeout: 'The assistant took too long to answer. Please try again.',
  model_output_invalid: 'I got a malformed answer from the assistant. Please ask again.',
  turn_timeout: 'The assistant took too long to answer. Please try again.',
};

export const OWNER_ASSISTANT_TOOL_LABELS: Record<OwnerAssistantToolName, string> = {
  get_salon_overview: 'your salon setup',
  list_services: 'your services list',
  find_destination: 'where things live in Luster',
};
