/**
 * Synthetic, sanitized Responses API envelopes; no captured credentials or
 * customer content. Shape follows the official TypeScript API reference:
 * https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create
 * Keep the nulls: reduced mocks without them missed the live adapter defect.
 */
export const completedTextResponse = {
  id: 'resp_synthetic_text',
  object: 'response',
  created_at: 1789662600,
  status: 'completed',
  completed_at: 1789662601,
  error: null,
  incomplete_details: null,
  instructions: null,
  max_output_tokens: 1200,
  model: 'gpt-5.6-luna',
  previous_response_id: null,
  reasoning: { effort: 'low', summary: null },
  store: false,
  temperature: null,
  top_p: null,
  user: null,
  metadata: {},
  output: [{
    id: 'msg_synthetic',
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{
      type: 'output_text',
      text: JSON.stringify({
        message: 'Gel Manicure is $45 for 60 minutes. Gel-X Extensions is $75 for 120 minutes.',
        links: [],
        followUps: [],
        needsClarification: false,
      }),
      annotations: [],
      logprobs: [],
    }],
  }],
  usage: {
    input_tokens: 1100,
    input_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
    output_tokens: 100,
    output_tokens_details: { reasoning_tokens: 40 },
    total_tokens: 1200,
  },
};

export const toolCallResponse = {
  ...completedTextResponse,
  id: 'resp_synthetic_tool',
  output: [
    { type: 'reasoning', id: 'rs_synthetic', summary: [], encrypted_content: 'synthetic-opaque-state' },
    {
      type: 'function_call',
      id: 'fc_synthetic',
      call_id: 'call_synthetic',
      name: 'list_services',
      arguments: '{"includeInactive":false}',
      status: 'completed',
    },
  ],
};

export const incompleteResponse = {
  ...completedTextResponse,
  status: 'incomplete',
  completed_at: null,
  incomplete_details: { reason: 'max_output_tokens' },
  output: [{ ...completedTextResponse.output[0], status: 'incomplete' }],
};

export const failedResponse = {
  ...completedTextResponse,
  status: 'failed',
  completed_at: null,
  error: { code: 'server_error', message: 'Synthetic provider failure.' },
  output: [],
  usage: null,
};

export const refusedResponse = {
  ...completedTextResponse,
  output: [{
    ...completedTextResponse.output[0],
    content: [{ type: 'refusal', refusal: 'Synthetic refusal.' }],
  }],
};
