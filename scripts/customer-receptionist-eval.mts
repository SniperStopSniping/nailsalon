/**
 * Opt-in semantic-fact evaluation against a synthetic L1 nail menu. This
 * never opens a database, reads a salon, creates an appointment, or sends a
 * message. It writes only a 0600 local report and refuses to run without an
 * explicitly named key in a private file.
 *
 * node --conditions=react-server --import tsx scripts/customer-receptionist-eval.mts \
 *   --run --key-file /absolute/private/key.env --key-name OPENAI_API_KEY_CUSTOMER
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createOpenAiResponsesProvider } = require('../src/libs/ai/openaiResponses.server') as typeof import('../src/libs/ai/openaiResponses.server');
const { CUSTOMER_INTERPRETATION_JSON_SCHEMA, CUSTOMER_INTERPRETATION_PROMPT, customerInterpretationSchema } = require('../src/libs/customerAssistant/interpretation') as typeof import('../src/libs/customerAssistant/interpretation');
const { SEMANTIC_L1_MENU } = require('../src/libs/customerAssistant/__evals__/semanticCases') as typeof import('../src/libs/customerAssistant/__evals__/semanticCases');
const { RECEPTIONIST_CASES } = require('../src/libs/customerAssistant/__evals__/receptionistCases') as typeof import('../src/libs/customerAssistant/__evals__/receptionistCases');
const { evaluateReceptionistTurn } = require('../src/libs/customerAssistant/__evals__/receptionistHarness') as typeof import('../src/libs/customerAssistant/__evals__/receptionistHarness');
const { createCustomerConversation } = require('../src/libs/customerAssistant/conversation.server') as typeof import('../src/libs/customerAssistant/conversation.server');
const { emptyFacts } = require('../src/libs/customerAssistant/semanticFacts') as typeof import('../src/libs/customerAssistant/semanticFacts');

const model = 'gpt-5.6-luna';
const maxOutputTokens = 1_200;
const timeoutMs = 15_000;
const maxSpendMicros = 200_000;
const inputMicrosPerMillion = 200_000;
const cachedInputMicrosPerMillion = 20_000;
const outputMicrosPerMillion = 1_200_000;

type Options = { run: boolean; keyFile: string | null; keyName: string | null; out: string | null };
function parseOptions(argv: string[]): Options | null {
  const parsed: Options = { run: false, keyFile: null, keyName: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--run') {
      parsed.run = true;
    } else if (argument === '--key-file' || argument === '--key-name' || argument === '--out') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) {
        return null;
      }
      if (argument === '--key-file') {
        parsed.keyFile = value;
      }
      if (argument === '--key-name') {
        parsed.keyName = value;
      }
      if (argument === '--out') {
        parsed.out = value;
      }
    } else {
      return null;
    }
  }
  return parsed;
}

function readNamedEnv(contents: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = contents.match(new RegExp(`^(?:export\\s+)?${escaped}\\s*=\\s*(.+?)\\s*$`, 'm'));
  if (!match?.[1]) {
    return null;
  }
  const value = match[1].trim();
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')) ? value.slice(1, -1) : value;
}

function costMicros(usage: import('../src/libs/ai/provider').ModelProviderUsage | null): number | null {
  if (!usage) {
    return null;
  }
  const cached = usage.cachedInputTokens;
  const cacheWrite = usage.cacheWriteInputTokens ?? 0;
  const regular = usage.inputTokens - cached - cacheWrite;
  return regular < 0 ? null : Math.ceil((regular * inputMicrosPerMillion + cached * cachedInputMicrosPerMillion + cacheWrite * 250_000 + usage.outputTokens * outputMicrosPerMillion) / 1_000_000);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options || !options.run || !options.keyFile || !options.keyName || !path.isAbsolute(options.keyFile) || !/^[A-Z][A-Z0-9_]*$/.test(options.keyName)) {
    process.stderr.write('Refused: use --run --key-file <absolute path> --key-name <UPPERCASE_NAME>.\n');
    process.exitCode = 1;
    return;
  }
  const apiKey = readNamedEnv(await readFile(options.keyFile, 'utf8'), options.keyName);
  if (!apiKey) {
    process.stderr.write('Refused: the named credential was absent or blank.\n');
    process.exitCode = 1;
    return;
  }

  const provider = createOpenAiResponsesProvider({ apiKey });
  const results: Array<Record<string, unknown>> = [];
  let reservedMicros = 0;
  for (const testCase of RECEPTIONIST_CASES) {
    let conversation = createCustomerConversation('synthetic-isla', 'synthetic-evaluation-secret', Date.parse('2026-09-18T23:00:00Z'));
    for (const [index, turn] of testCase.turns.entries()) {
      const input = JSON.stringify({ locale: 'en', bookingSalon: { name: 'Synthetic Isla', slug: 'synthetic-isla' }, menu: SEMANTIC_L1_MENU, customerMessages: [...conversation.messages, turn.message], previousFacts: conversation.facts ?? emptyFacts(), lastShown: conversation.context ?? null, requestedSelection: conversation.requestedSelection ?? null, bookingState: conversation.booking ?? null, today: '2026-09-18', timeZone: 'America/Toronto' });
      const reservation = Math.ceil(((Buffer.byteLength(CUSTOMER_INTERPRETATION_PROMPT + input + JSON.stringify(CUSTOMER_INTERPRETATION_JSON_SCHEMA)) + 4096) * 250000 + maxOutputTokens * outputMicrosPerMillion) / 1000000);
      if (reservedMicros + reservation > maxSpendMicros) {
        results.push({ id: testCase.id, turn: index + 1, status: 'not_run', reason: 'spend_ceiling' });
        continue;
      }
      reservedMicros += reservation;
      let stage = 'provider';
      let providerStatus: string | undefined;
      try {
        const response = await provider.createResponse({ model, input: [{ role: 'system', content: CUSTOMER_INTERPRETATION_PROMPT }, { role: 'user', content: input }], tools: [], toolChoice: 'none', reasoningEffort: 'low', jsonMode: 'schema', jsonSchema: CUSTOMER_INTERPRETATION_JSON_SCHEMA, maxOutputTokens, timeoutMs });
        providerStatus = response.status;
        stage = 'interpretation';
        if (response.status !== 'completed' || response.items.some(item => item.type === 'function_call' || item.type === 'refusal')) {
          throw new Error('invalid_response');
        }
        const intent = customerInterpretationSchema.parse(JSON.parse(response.items.filter(item => item.type === 'message').map(item => item.text).join('')));
        stage = 'runtime_resolution';
        const scored = await evaluateReceptionistTurn(intent, conversation, turn);
        conversation = scored.next;
        results.push({ id: testCase.id, turn: index + 1, message: turn.message, status: scored.failures.length ? 'review' : 'passed', failures: scored.failures, facts: conversation.facts, intent, result: scored.result, costMicros: costMicros(response.usage) });
      } catch (error) {
        results.push({ id: testCase.id, turn: index + 1, message: turn.message, status: 'failed', reason: 'provider_or_invalid_response', stage, providerStatus, errorType: error instanceof Error ? error.name : 'unknown' });
        break;
      }
    }
  }
  const report = { model, store: false, promptSha256: createHash('sha256').update(CUSTOMER_INTERPRETATION_PROMPT).digest('hex'), scope: 'synthetic catalog only; exact runtime turn resolver; no database, bookings, messages or payments', reservedMicros, summary: { turns: results.length, passed: results.filter(item => item.status === 'passed').length, review: results.filter(item => item.status === 'review').length, costMicros: results.reduce((sum, item) => sum + (typeof item.costMicros === 'number' ? item.costMicros : 0), 0) }, results };
  const output = path.resolve(root, options.out ?? 'artifacts/customer-assistant/receptionist-evaluation');
  await mkdir(output, { recursive: true });
  const file = path.join(output, `evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ file, ...report.summary })}\n`);
}
void main().catch(() => {
  process.stderr.write('Evaluation failed without exposing provider details.\n');
  process.exitCode = 1;
});
