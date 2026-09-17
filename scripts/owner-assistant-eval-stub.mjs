/**
 * Loopback stub of the OpenAI Responses API, for REHEARSING the real-model eval
 * runner at zero cost (docs/OWNER_ASSISTANT_EVALS.md §4, "Rehearsal").
 *
 * ============================================================================
 * THIS IS NOT A MODEL AND ITS ANSWERS ARE NOT EVIDENCE.
 * ============================================================================
 * It exists to exercise the PLUMBING the paid run depends on: the refusal
 * guards, fixture seeding, the turn loop, the HTTP adapter, grounding scoring,
 * the spend accounting and the report writer. Nothing it returns says anything
 * about conversation quality, tool selection or grounding — a rehearsal report
 * is expected to show case failures, because a stub cannot choose tools.
 *
 * It binds to 127.0.0.1 only. The runner refuses any base URL that is not
 * loopback (`BASE_URL_MUST_BE_LOOPBACK`), so this can never receive a key meant
 * for a real provider — and it never reads the Authorization header at all.
 *
 *   node scripts/owner-assistant-eval-stub.mjs --port 8737
 *
 * Then, in another shell, point the runner at it:
 *
 *   OWNER_ASSISTANT_EVAL_BASE_URL=http://127.0.0.1:8737 npm run <the eval entry>
 */
import { createServer } from 'node:http';

const portArgument = process.argv.indexOf('--port');
const PORT = portArgument === -1 ? 8737 : Number(process.argv[portArgument + 1]);

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  process.stderr.write('--port must be an integer between 1024 and 65535\n');
  process.exit(1);
}

/**
 * A schema-valid final answer with no tool calls and no business facts.
 *
 * Deliberately factless: a stub that invented a price would make the rehearsal
 * report's grounding column meaningless, and someone would eventually quote it.
 */
const ANSWER = {
  message: 'This is a rehearsal stub. It cannot check anything about your salon.',
  links: [],
  followUps: [],
  needsClarification: false,
};

let requestCount = 0;

const server = createServer((request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/v1/responses')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
    // A runaway body is a bug in the caller, not something to buffer forever.
    if (body.length > 2_000_000) {
      request.destroy();
    }
  });

  request.on('end', () => {
    requestCount += 1;

    // Token counts are plausible rather than real. They flow through the same
    // cost arithmetic the paid run uses, which is the point: the spend ceiling
    // and the cost column are exercised without spending anything.
    const payload = {
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify(ANSWER) }],
        },
      ],
      usage: {
        input_tokens: 1200,
        output_tokens: 60,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      },
    };

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
    process.stdout.write(`[stub] request ${requestCount} answered (${body.length} bytes in)\n`);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`[stub] listening on http://127.0.0.1:${PORT} — loopback only, no key is read\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    process.stdout.write(`\n[stub] ${requestCount} request(s) served; shutting down\n`);
    server.close(() => process.exit(0));
  });
}
