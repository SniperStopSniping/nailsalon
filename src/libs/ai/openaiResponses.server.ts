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
    input_tokens_details: z.object({ cached_tokens: z.number().optional() }).partial().optional(),
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

    for (const part of message.data.content ?? []) {
      const text = outputTextPartSchema.safeParse(part);
      if (text.success) {
        items.push({ type: 'message', text: text.data.text });
        continue;
      }
      if (refusalPartSchema.safeParse(part).success) {
        items.push({ type: 'refusal' });
      }
    }
  }

  return items;
}

function buildBody(request: ModelProviderRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    input: request.input,
    tools: request.tools,
    tool_choice: 'auto',
    parallel_tool_calls: true,
    // Nothing about an owner conversation is retained provider-side (§3.6).
    store: false,
    reasoning: { effort: 'low' },
    max_output_tokens: request.maxOutputTokens,
  };

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

      let response: Response;
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
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortOuter);
      }

      if (!response.ok) {
        // The status code is the whole diagnostic. The body may quote the
        // prompt back at us, so it is never read.
        throw new ModelProviderError('provider_error', response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ModelProviderError('provider_error', response.status);
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
        },
        status: parsed.data.status === 'incomplete' ? 'incomplete' : 'completed',
        incompleteReason: parsed.data.incomplete_details?.reason,
      };
    },
  };
}
