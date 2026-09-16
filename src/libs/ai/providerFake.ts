/**
 * Scripted provider fake (docs/OWNER_ASSISTANT_CHAT.md §8).
 *
 * Pure and dependency-free so both the unit suites and a future eval harness
 * can drive the turn loop with no network. The queue is consumed in order;
 * every request is recorded so a test can assert what the loop actually sent
 * (tool outputs echoed back, the window, the developer messages).
 */
import type {
  ModelProviderRequest,
  ModelProviderResponse,
  ModelProviderUsage,
  OwnerAssistantModelProvider,
} from './provider';

export const FAKE_USAGE: ModelProviderUsage = {
  inputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 30,
};

export type ScriptedProviderStep = ModelProviderResponse | Error;

export type ScriptedProvider = OwnerAssistantModelProvider & {
  /** Every request the turn loop made, in order. */
  requests: ModelProviderRequest[];
  /** Append more steps mid-test. */
  push: (...steps: ScriptedProviderStep[]) => void;
};

/** A completed response whose single message is `payload` serialized as JSON. */
export function fakeAnswer(payload: unknown, usage: Partial<ModelProviderUsage> = {}): ModelProviderResponse {
  return {
    items: [{ type: 'message', text: JSON.stringify(payload) }],
    usage: { ...FAKE_USAGE, ...usage },
    status: 'completed',
  };
}

/** A completed response whose message text is sent verbatim (malformed-JSON cases). */
export function fakeRawMessage(text: string, usage: Partial<ModelProviderUsage> = {}): ModelProviderResponse {
  return {
    items: [{ type: 'message', text }],
    usage: { ...FAKE_USAGE, ...usage },
    status: 'completed',
  };
}

/** A completed response asking for one or more tool calls. */
export function fakeToolCalls(
  calls: Array<{ callId: string; name: string; argumentsJson: string }>,
  usage: Partial<ModelProviderUsage> = {},
): ModelProviderResponse {
  return {
    items: calls.map(call => ({
      type: 'function_call' as const,
      callId: call.callId,
      name: call.name,
      argumentsJson: call.argumentsJson,
      raw: { type: 'function_call', call_id: call.callId, name: call.name, arguments: call.argumentsJson },
    })),
    usage: { ...FAKE_USAGE, ...usage },
    status: 'completed',
  };
}

export function fakeRefusal(usage: Partial<ModelProviderUsage> = {}): ModelProviderResponse {
  return { items: [{ type: 'refusal' }], usage: { ...FAKE_USAGE, ...usage }, status: 'completed' };
}

export function fakeIncomplete(reason = 'max_output_tokens', usage: Partial<ModelProviderUsage> = {}): ModelProviderResponse {
  return { items: [], usage: { ...FAKE_USAGE, ...usage }, status: 'incomplete', incompleteReason: reason };
}

export function createScriptedProvider(...steps: ScriptedProviderStep[]): ScriptedProvider {
  const queue: ScriptedProviderStep[] = [...steps];
  const requests: ModelProviderRequest[] = [];

  return {
    requests,
    push: (...more: ScriptedProviderStep[]) => {
      queue.push(...more);
    },
    createResponse: async (request: ModelProviderRequest) => {
      requests.push(request);
      const next = queue.shift();
      if (!next) {
        throw new Error('ScriptedProvider: no scripted response left');
      }
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
  };
}
