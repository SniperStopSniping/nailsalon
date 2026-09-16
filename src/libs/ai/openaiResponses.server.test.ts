/**
 * The provider adapter is the only code in this feature that talks to a third
 * party, so two things are pinned here: exactly what leaves the process
 * (`store: false`, the model, the tools, the strict format, the bearer header)
 * and exactly what a failure is allowed to carry back (a kind and at most an
 * HTTP status — never the key, the body, or provider prose).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createOpenAiResponsesProvider } = await import('./openaiResponses.server');
const { ModelProviderError } = await import('./provider');

const API_KEY = 'sk-owner-test-key-do-not-log';

const REQUEST = {
  model: 'gpt-5.6-luna',
  input: [
    { role: 'system' as const, content: 'system text' },
    { role: 'user' as const, content: 'what services do I offer?' },
  ],
  tools: [{
    type: 'function' as const,
    name: 'list_services',
    description: 'List services.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  }],
  maxOutputTokens: 1200,
  timeoutMs: 20_000,
  jsonMode: 'schema' as const,
  jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let consoleSpies: Array<{ restore: () => void; calls: unknown[][] }>;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  consoleSpies = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const spy of consoleSpies) {
    spy.restore();
  }
});

const provider = () => createOpenAiResponsesProvider({ apiKey: API_KEY, baseUrl: 'https://provider.test' });

describe('request shape', () => {
  it('posts the documented body to /v1/responses with a bearer header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'resp_1', status: 'completed', output: [] }));

    await provider().createResponse(REQUEST);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://provider.test/v1/responses');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);

    expect(body).toMatchObject({
      model: 'gpt-5.6-luna',
      tool_choice: 'auto',
      parallel_tool_calls: true,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 1200,
    });
    expect(body.input).toEqual(REQUEST.input);
    expect(body.tools).toEqual(REQUEST.tools);
  });

  it('never retains the conversation provider-side', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'completed', output: [] }));

    await provider().createResponse(REQUEST);

    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string).store).toBe(false);
  });

  it('sends a strict json_schema format in schema mode', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'completed', output: [] }));

    await provider().createResponse(REQUEST);

    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string).text).toEqual({
      format: {
        type: 'json_schema',
        name: 'owner_assistant_answer',
        schema: REQUEST.jsonSchema,
        strict: true,
      },
    });
  });

  it('omits text.format entirely in prompt mode', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'completed', output: [] }));

    await provider().createResponse({ ...REQUEST, jsonMode: 'prompt', jsonSchema: undefined });

    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string).text).toBeUndefined();
  });

  it('defaults to the OpenAI origin when no baseUrl is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'completed', output: [] }));

    await createOpenAiResponsesProvider({ apiKey: API_KEY }).createResponse(REQUEST);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/responses');
  });
});

describe('response parsing', () => {
  it('parses function calls, message text and usage', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      id: 'resp_2',
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'function_call', call_id: 'call_1', name: 'list_services', arguments: '{"includeInactive":false}' },
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"ok"}' }] },
      ],
      usage: { input_tokens: 812, input_tokens_details: { cached_tokens: 640 }, output_tokens: 77 },
    }));

    const result = await provider().createResponse(REQUEST);

    expect(result.status).toBe('completed');
    expect(result.usage).toEqual({ inputTokens: 812, cachedInputTokens: 640, outputTokens: 77 });
    expect(result.items).toEqual([
      {
        type: 'function_call',
        callId: 'call_1',
        name: 'list_services',
        argumentsJson: '{"includeInactive":false}',
        raw: { type: 'function_call', call_id: 'call_1', name: 'list_services', arguments: '{"includeInactive":false}' },
      },
      { type: 'message', text: '{"message":"ok"}' },
    ]);
  });

  it('keeps the raw function_call item so it can be echoed back verbatim', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      status: 'completed',
      output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'find_destination', arguments: '{"query":"logo"}', status: 'completed' }],
    }));

    const [item] = (await provider().createResponse(REQUEST)).items;

    expect(item?.type).toBe('function_call');
    expect(item?.type === 'function_call' && item.raw).toMatchObject({ id: 'fc_1', status: 'completed' });
  });

  it('surfaces a refusal part as a refusal item', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] }],
    }));

    expect((await provider().createResponse(REQUEST)).items).toEqual([{ type: 'refusal' }]);
  });

  it('reports an incomplete response with its reason', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      status: 'incomplete',
      output: [],
      incomplete_details: { reason: 'max_output_tokens' },
    }));

    const result = await provider().createResponse(REQUEST);

    expect(result.status).toBe('incomplete');
    expect(result.incompleteReason).toBe('max_output_tokens');
  });

  it('ignores unknown output item types rather than failing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      status: 'completed',
      output: [{ type: 'a_type_that_does_not_exist_yet', payload: {} }, { type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
    }));

    expect((await provider().createResponse(REQUEST)).items).toEqual([{ type: 'message', text: 'hi' }]);
  });

  it('defaults missing usage counters to zero', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'completed', output: [] }));

    expect((await provider().createResponse(REQUEST)).usage)
      .toEqual({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
  });
});

describe('failure mapping', () => {
  it.each([400, 401, 429, 500, 503])('maps HTTP %s to provider_error carrying only the status', async (status) => {
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"your prompt said …"}}', { status }));

    await expect(provider().createResponse(REQUEST)).rejects.toMatchObject({
      kind: 'provider_error',
      status,
    });
  });

  it('maps an abort to provider_timeout', async () => {
    fetchMock.mockImplementation(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));

    await expect(provider().createResponse(REQUEST)).rejects.toMatchObject({ kind: 'provider_timeout' });
  });

  it('aborts on its own timeout and reports provider_timeout', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));

    await expect(provider().createResponse({ ...REQUEST, timeoutMs: 5 }))
      .rejects.toMatchObject({ kind: 'provider_timeout' });
  });

  it('honours a caller-supplied abort signal', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));

    const pending = provider().createResponse(REQUEST, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ kind: 'provider_timeout' });
  });

  it('maps a network fault to provider_error and discards its message', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED https://provider.test'));

    const error = await provider().createResponse(REQUEST).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ModelProviderError);
    expect((error as InstanceType<typeof ModelProviderError>).kind).toBe('provider_error');
    expect((error as Error).message).toBe('provider_error');
    expect((error as Error).message).not.toContain('provider.test');
  });

  it('maps an unparsable success body to provider_error', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));

    await expect(provider().createResponse(REQUEST)).rejects.toMatchObject({ kind: 'provider_error' });
  });

  it('maps a structurally wrong success body to provider_error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: 'not-an-array' }));

    await expect(provider().createResponse(REQUEST)).rejects.toMatchObject({ kind: 'provider_error' });
  });
});

describe('disclosure discipline', () => {
  it('writes nothing to the console on success or on any failure', async () => {
    // vitest-setup fails the suite on ANY console write, so simply exercising
    // every path proves the adapter is silent. The explicit spies below make
    // the intent legible and assert the key is nowhere in what was captured.
    const captured: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      const spy = vi.spyOn(console, level).mockImplementation((...calledWith: unknown[]) => {
        captured.push(calledWith);
      });
      consoleSpies.push({ restore: () => spy.mockRestore(), calls: captured });
    }

    fetchMock.mockResolvedValue(jsonResponse({ status: 'completed', output: [] }));
    await provider().createResponse(REQUEST);

    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    await provider().createResponse(REQUEST).catch(() => null);

    fetchMock.mockRejectedValue(new Error('network'));
    await provider().createResponse(REQUEST).catch(() => null);

    expect(captured).toEqual([]);
    expect(JSON.stringify(captured)).not.toContain(API_KEY);
  });

  it('keeps the key out of the thrown error', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    const error = await provider().createResponse(REQUEST).catch((thrown: unknown) => thrown) as Error;

    expect(`${error.message} ${error.stack ?? ''}`).not.toContain(API_KEY);
  });
});
