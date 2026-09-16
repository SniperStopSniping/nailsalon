/**
 * Model provider boundary for the Owner Assistant (docs/OWNER_ASSISTANT_CHAT.md §5).
 *
 * Pure types only: no I/O, no `server-only`, no provider SDK. The turn loop
 * depends on this interface, so tests and evals inject a scripted fake and the
 * real adapter (`openaiResponses.server.ts`) stays the only code that ever
 * touches the network or the API key.
 */

/** One item in the Responses API `input` array, passed through verbatim. */
export type ModelProviderInputItem =
  | { role: 'system' | 'developer' | 'user' | 'assistant'; content: string }
  /**
   * A `function_call` item returned by a previous response, echoed back
   * unchanged so the provider can match it to its output. Extra provider-owned
   * fields ride along untouched.
   */
  | { type: 'function_call'; call_id: string; name: string; arguments: string; [key: string]: unknown }
  | { type: 'function_call_output'; call_id: string; output: string };

export type ModelProviderTool = {
  type: 'function';
  name: string;
  description: string;
  strict: boolean;
  parameters: Record<string, unknown>;
};

export type ModelProviderRequest = {
  model: string;
  input: ModelProviderInputItem[];
  tools: ModelProviderTool[];
  maxOutputTokens: number;
  /** Abort a single call after this long. */
  timeoutMs: number;
  /**
   * 'schema' asks the provider to enforce `jsonSchema` through `text.format`;
   * 'prompt' sends no format at all (the schema is described in the prompt).
   */
  jsonMode: 'schema' | 'prompt';
  /** Required when `jsonMode` is 'schema'. */
  jsonSchema?: Record<string, unknown>;
};

export type ModelProviderItem =
  | { type: 'function_call'; callId: string; name: string; argumentsJson: string; raw: Record<string, unknown> }
  | { type: 'message'; text: string }
  | { type: 'refusal' };

export type ModelProviderUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type ModelProviderResponse = {
  items: ModelProviderItem[];
  usage: ModelProviderUsage;
  status: 'completed' | 'incomplete';
  /** Provider's own reason when `status` is 'incomplete' (e.g. 'max_output_tokens'). */
  incompleteReason?: string;
};

/**
 * The only failure shape the turn loop understands. Provider text, response
 * bodies and the API key never travel on it — `message` is a fixed string and
 * `status` is an HTTP status code at most.
 */
export class ModelProviderError extends Error {
  readonly kind: 'provider_error' | 'provider_timeout';
  readonly status?: number;

  constructor(kind: 'provider_error' | 'provider_timeout', status?: number) {
    super(kind);
    this.name = 'ModelProviderError';
    this.kind = kind;
    this.status = status;
  }
}

export type OwnerAssistantModelProvider = {
  createResponse: (request: ModelProviderRequest, signal?: AbortSignal) => Promise<ModelProviderResponse>;
};
