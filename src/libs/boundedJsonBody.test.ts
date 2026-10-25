import { readBoundedJsonBody, RequestBodyTooLarge } from './boundedJsonBody';

function streamingRequest(chunks: string[], cancel = vi.fn()) {
  let index = 0;
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: { 'Content-Length': '1' },
    body: new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[index++]));
        } else {
          controller.close();
        }
      },
      cancel,
    }),
    duplex: 'half',
  } as RequestInit);
}

describe('bounded JSON intake', () => {
  it('cancels an oversized stream before JSON parsing despite a false Content-Length', async () => {
    const cancel = vi.fn();
    const request = streamingRequest(['{"a":', '"123456789"}', 'unused'], cancel);
    const parse = vi.spyOn(JSON, 'parse');

    await expect(readBoundedJsonBody(request, 8)).rejects.toBeInstanceOf(RequestBodyTooLarge);
    // Vitest may parse source maps while preparing the rejection stack.
    // No submitted JSON (complete or partial) may reach JSON.parse.
    expect(parse.mock.calls.filter(([input]) => input.startsWith('{"a":'))).toHaveLength(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(request.body?.locked).toBe(false);

    parse.mockRestore();
  });

  it('counts UTF-8 bytes and accepts exact-boundary valid JSON', async () => {
    const json = '{"a":"é"}';

    await expect(readBoundedJsonBody(streamingRequest([json]), new TextEncoder().encode(json).length)).resolves.toEqual({ a: 'é' });
    await expect(readBoundedJsonBody(streamingRequest([json]), json.length)).rejects.toBeInstanceOf(RequestBodyTooLarge);
  });

  it('returns null for missing or malformed bodies without exposing parse errors', async () => {
    await expect(readBoundedJsonBody(new Request('http://localhost/test'), 20)).resolves.toBeNull();
    await expect(readBoundedJsonBody(streamingRequest(['not-json']), 20)).resolves.toBeNull();
  });
});
