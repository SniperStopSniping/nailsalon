import 'server-only';

import { z } from 'zod';

import {
  ModelProviderError,
  type ModelProviderItem,
  type ModelProviderRequest,
  type ModelProviderResponse,
  type OwnerAssistantModelProvider,
} from './provider';

/**
 * OpenAI Responses API adapter (docs/OWNER_ASSISTANT_CHAT.md §5).
 *
 * A typed `fetch` client rather than the SDK: the CI ladder pins
 * manifest/lockfile pairs, and this surface needs four request fields and five
 * response fields, all of which are reviewable here.
 *
 * Disclosure discipline: the request body, the response body, the API key and
 * any provider-authored text NEVER reach a log, an exception message or the
 * owner. Failures collapse into `ModelProviderError` carrying a kind and, at
 * most, an HTTP status code.
 */

const DEFAULT_BASE_URL = 'https://api.openai.com';

/** Only the subset the turn loop reads; unknown item types are ignored. */
const responseSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  output: z.array(z.unknown()).optional(),
  usage: z.object({
    input_tokens: z.number().optional(),
    input_tokens_details: z.object({
      cached_tokens: z.number().optional(),
      cache_write_tokens: z.number().optional(),
    }).partial().optional(),
    output_tokens: z.number().optional(),
  }).partial().optional(),
  incomplete_details: z.object({ reason: z.string().optional() }).partial().optional(),
});

const functionCallItemSchema = z.object({
  type: z.literal('function_call'),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string(),
});

const messageItemSchema = z.object({
  type: z.literal('message'),
  content: z.array(z.unknown()).optional(),
});

const outputTextPartSchema = z.object({ type: z.literal('output_text'), text: z.string() });
const refusalPartSchema = z.object({ type: z.literal('refusal') });

function parseItems(output: unknown[]): ModelProviderItem[] {
  const items: ModelProviderItem[] = [];

  for (const raw of output) {
    // Reasoning items are provider-owned state: kept opaque and echoed back
    // verbatim (with `encrypted_content`) ahead of the tool calls they
    // produced. Nothing inside them is read or logged.
    if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'reasoning') {
      items.push({ type: 'passthrough', raw: raw as Record<string, unknown> });
      continue;
    }

    const functionCall = functionCallItemSchema.safeParse(raw);
    if (functionCall.success) {
      items.push({
        type: 'function_call',
        callId: functionCall.data.call_id,
        name: functionCall.data.name,
        argumentsJson: functionCall.data.arguments,
        raw: raw as Record<string, unknown>,
      });
      continue;
    }

    const message = messageItemSchema.safeParse(raw);
    if (!message.success) {
      // Reasoning items and anything else the API adds later are ignored by
      // design: this adapter must not break when the provider grows a type.
      continue;
    }

    // One message may carry several output_text parts; the answer is their
    // concatenation, never just the first part.
    const texts: string[] = [];
    for (const part of message.data.content ?? []) {
      const text = outputTextPartSchema.safeParse(part);
      if (text.success) {
        texts.push(text.data.text);
        continue;
      }
      if (refusalPartSchema.safeParse(part).success) {
        items.push({ type: 'refusal' });
      }
    }
    if (texts.length > 0) {
      items.push({ type: 'message', text: texts.join('') });
    }
  }

  return items;
}

function buildBody(request: ModelProviderRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    input: request.input,
    tools: request.tools,
    tool_choice: request.toolChoice ?? 'auto',
    parallel_tool_calls: true,
    // Nothing about an owner conversation is retained provider-side (§3.6).
    store: false,
    reasoning: { effort: request.reasoningEffort ?? 'low' },
    max_output_tokens: request.maxOutputTokens,
  };

  // Stateless use with reasoning: ask for encrypted reasoning content so the
  // reasoning items can be echoed back with the tool outputs (the API's
  // requirement when `store` is false). Irrelevant at effort 'none'.
  if ((request.reasoningEffort ?? 'low') !== 'none') {
    body.include = ['reasoning.encrypted_content'];
  }

  if (request.jsonMode === 'schema' && request.jsonSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: 'owner_assistant_answer',
        schema: request.jsonSchema,
        strict: true,
      },
    };
  }

  return body;
}

export function createOpenAiResponsesProvider(options: {
  apiKey: string;
  baseUrl?: string;
}): OwnerAssistantModelProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    async createResponse(request: ModelProviderRequest, signal?: AbortSignal): Promise<ModelProviderResponse> {
      const controller = new AbortController();
      const abortOuter = () => controller.abort();
      signal?.addEventListener('abort', abortOuter, { once: true });
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);

      // The timer must cover the BODY read as well as the headers: `fetch()`
      // resolves on headers, and a provider that stalls the body afterwards
      // would otherwise escape both the call timeout and the turn deadline.
      let response: Response;
      let payload: unknown;
      try {
        try {
          response = await fetch(`${baseUrl}/v1/responses`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(buildBody(request)),
            signal: controller.signal,
          });
        } catch (error) {
          // An abort is the only failure we can name; everything else is a
          // network fault whose message could carry a URL or a proxy banner, so
          // it is deliberately discarded rather than wrapped.
          const aborted = error instanceof Error
            && (error.name === 'AbortError' || error.name === 'TimeoutError');
          throw new ModelProviderError(aborted ? 'provider_timeout' : 'provider_error');
        }

        if (!response.ok) {
          // The status code is the whole diagnostic. The body may quote the
          // prompt back at us, so it is never read.
          throw new ModelProviderError('provider_error', response.status);
        }

        try {
          payload = await response.json();
        } catch (error) {
          const aborted = error instanceof Error
            && (error.name === 'AbortError' || error.name === 'TimeoutError');
          throw new ModelProviderError(aborted ? 'provider_timeout' : 'provider_error', response.status);
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortOuter);
      }

      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ModelProviderError('provider_error', response.status);
      }

      return {
        items: parseItems(parsed.data.output ?? []),
        usage: {
          inputTokens: parsed.data.usage?.input_tokens ?? 0,
          cachedInputTokens: parsed.data.usage?.input_tokens_details?.cached_tokens ?? 0,
          outputTokens: parsed.data.usage?.output_tokens ?? 0,
          cacheWriteInputTokens: parsed.data.usage?.input_tokens_details?.cache_write_tokens ?? 0,
        },
        // Anything other than completed/incomplete (failed, cancelled, queued)
        // is a provider-side failure, not a malformed answer.
        status: parsed.data.status === 'incomplete'
          ? 'incomplete'
          : parsed.data.status === undefined || parsed.data.status === 'completed'
            ? 'completed'
            : 'failed',
        incompleteReason: parsed.data.incomplete_details?.reason,
      };
    },
  };
}
