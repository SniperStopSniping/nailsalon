/**
 * Opt-in real-model evaluation of the customer assistant's interpretation
 * boundary. This runner uses a synthetic public menu only. It never loads the
 * turn loop, customer configuration, a database, availability, appointment,
 * identity, payment, SMS, or any owner-assistant module.
 *
 * Example (the key file path and key name are deliberately explicit):
 * node --conditions=react-server --import tsx scripts/customer-assistant-eval.mts \
 *   --run --key-file /Users/me/.config/luster/owner-assistant-eval.env \
 *   --key-name OPENAI_API_KEY_OWNER
 *
 * Each case has one Luna-low Responses API call, store:false through the shared
 * adapter, a 15-second timeout, and at most 1200 output tokens. Dispatches are
 * conservatively reserved against a $0.10 total ceiling before the first call.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ModelProviderUsage } from '../src/libs/ai/provider';
import type { CustomerInterpretationEvalCase } from '../src/libs/customerAssistant/__evals__/interpretationCases';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'gpt-5.6-luna';
const MAX_OUTPUT_TOKENS = 1_200;
const TIMEOUT_MS = 15_000;
const MAX_SPEND_MICROS = 100_000;
const INPUT_MICROS_PER_MILLION = 200_000;
const CACHED_INPUT_MICROS_PER_MILLION = 20_000;
const OUTPUT_MICROS_PER_MILLION = 1_200_000;
const require = createRequire(import.meta.url);
const { createOpenAiResponsesProvider } = require('../src/libs/ai/openaiResponses.server') as typeof import('../src/libs/ai/openaiResponses.server');
const { ModelProviderError } = require('../src/libs/ai/provider') as typeof import('../src/libs/ai/provider');
const { CUSTOMER_INTERPRETATION_EVAL_CASES, SYNTHETIC_CUSTOMER_MENU } = require('../src/libs/customerAssistant/__evals__/interpretationCases') as typeof import('../src/libs/customerAssistant/__evals__/interpretationCases');
const { CUSTOMER_INTERPRETATION_JSON_SCHEMA, CUSTOMER_INTERPRETATION_PROMPT, customerInterpretationSchema } = require('../src/libs/customerAssistant/interpretation') as typeof import('../src/libs/customerAssistant/interpretation');

type Options = { run: boolean; keyFile: string | null; keyName: string | null; out: string | null; help: boolean };
type Intent = ReturnType<typeof customerInterpretationSchema.parse>;
type CaseResult = {
  id: string;
  status: 'passed' | 'failed' | 'not_run';
  expectedMatch: boolean | null;
  noUnknownIds: boolean | null;
  schemaValid: boolean;
  latencyMs: number | null;
  usage: ModelProviderUsage | null;
  costMicros: number | null;
  intent: Intent | null;
  error: string | null;
};

function usage(): string {
  return 'Usage: node --conditions=react-server --import tsx scripts/customer-assistant-eval.mts --run --key-file <explicit-path> --key-name <environment-key-name> [--out <directory>]';
}

function parseArgs(argv: readonly string[]): Options | null {
  const options: Options = { run: false, keyFile: null, keyName: null, out: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--run') {
      options.run = true;
    } else if (argument === '--help') {
      options.help = true;
    } else if (argument === '--key-file' || argument === '--key-name' || argument === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        return null;
      }
      if (argument === '--key-file') {
        options.keyFile = value;
      }
      if (argument === '--key-name') {
        options.keyName = value;
      }
      if (argument === '--out') {
        options.out = value;
      }
      index += 1;
    } else {
      return null;
    }
  }
  return options;
}

function envValue(contents: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = contents.match(new RegExp(`^(?:export\\s+)?${escapedName}\\s*=\\s*(.+?)\\s*$`, 'm'));
  if (!match?.[1]) {
    return null;
  }
  const raw = match[1].trim();
  const unquoted = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith('\'') && raw.endsWith('\''))
    ? raw.slice(1, -1)
    : raw;
  return unquoted.length > 0 ? unquoted : null;
}

function costMicros(usageValue: ModelProviderUsage | null): number | null {
  if (!usageValue) {
    return null;
  }
  const cached = usageValue.cachedInputTokens;
  const cacheWrite = usageValue.cacheWriteInputTokens ?? 0;
  const regular = usageValue.inputTokens - cached - cacheWrite;
  if (regular < 0) {
    return null;
  }
  return Math.ceil((regular * INPUT_MICROS_PER_MILLION + cached * CACHED_INPUT_MICROS_PER_MILLION + cacheWrite * 250_000 + usageValue.outputTokens * OUTPUT_MICROS_PER_MILLION) / 1_000_000);
}

function conservativeReservationMicros(data: string): number {
  // Byte-level tokenization cannot use more tokens than UTF-8 bytes. Include
  // the schema, ample protocol overhead and the higher cache-write input rate.
  const estimatedInputTokens = Buffer.byteLength(CUSTOMER_INTERPRETATION_PROMPT + data + JSON.stringify(CUSTOMER_INTERPRETATION_JSON_SCHEMA), 'utf8') + 4_096;
  return Math.ceil((estimatedInputTokens * 250_000 + MAX_OUTPUT_TOKENS * OUTPUT_MICROS_PER_MILLION) / 1_000_000);
}

function hasOnlyMenuIds(intent: Intent): boolean {
  const service = intent.serviceId === null || SYNTHETIC_CUSTOMER_MENU.services.some(item => item.id === intent.serviceId);
  const addOns = intent.addOns.every((item) => {
    const binding = SYNTHETIC_CUSTOMER_MENU.bindings.some(binding => binding.serviceId === intent.serviceId && binding.addOnId === item.addOnId);
    return binding && item.quantity >= 1;
  });
  const options = intent.optionIds.every(id => SYNTHETIC_CUSTOMER_MENU.services.some(item => item.id === id)
    || SYNTHETIC_CUSTOMER_MENU.addOns.some(item => item.id === id));
  return service && addOns && options;
}

function expectedMatches(intent: Intent, testCase: CustomerInterpretationEvalCase): boolean {
  if (intent.action !== testCase.expected.action || (testCase.expected.serviceId !== undefined && intent.serviceId !== testCase.expected.serviceId)) {
    return false;
  }
  if (testCase.expected.datePreference !== undefined && JSON.stringify(intent.datePreference) !== JSON.stringify(testCase.expected.datePreference)) {
    return false;
  }
  if (!testCase.expected.addOnIds) {
    return true;
  }
  const actual = [...intent.addOns.map(item => item.addOnId)].sort();
  const expected = [...testCase.expected.addOnIds].sort();
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

function fixedError(error: unknown): string {
  if (error instanceof ModelProviderError) {
    return error.status ? `${error.kind}:${error.status}` : error.kind;
  }
  return 'invalid_model_response';
}

function makeInput(testCase: CustomerInterpretationEvalCase): string {
  return JSON.stringify({ locale: 'en', menu: SYNTHETIC_CUSTOMER_MENU, customerMessages: testCase.messages, lastShown: testCase.lastShown, today: testCase.today ?? '2026-09-18', timeZone: testCase.timeZone ?? 'America/Toronto', bookingState: testCase.bookingState ?? null });
}

function latencyPercentile(results: CaseResult[], percentile: number): number | null {
  const values = results.flatMap(item => item.latencyMs === null ? [] : [item.latencyMs]).sort((left, right) => left - right);
  if (values.length === 0) {
    return null;
  }
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * percentile) - 1))]!;
}

function markdown(results: CaseResult[], reservedMicros: number): string {
  const passed = results.filter(item => item.status === 'passed').length;
  const run = results.filter(item => item.status !== 'not_run').length;
  const totalCost = results.reduce((sum, item) => sum + (item.costMicros ?? 0), 0);
  const p50LatencyMs = latencyPercentile(results, 0.5);
  const p95LatencyMs = latencyPercentile(results, 0.95);
  const rows = results.map(item => `| ${item.id} | ${item.status} | ${item.expectedMatch === null ? '—' : item.expectedMatch ? 'yes' : 'no'} | ${item.noUnknownIds === null ? '—' : item.noUnknownIds ? 'yes' : 'no'} | ${item.latencyMs === null ? '—' : item.latencyMs.toFixed(0)} | ${item.costMicros === null ? 'unknown' : `$${(item.costMicros / 1_000_000).toFixed(6)}`} |`).join('\n');
  return `# Customer assistant synthetic interpretation evaluation\n\nModel: \`${MODEL}\` with low reasoning, one Responses API call per case, \`store:false\`, 1200 maximum output tokens, 15-second timeout.\n\nThis evaluates only natural-language interpretation against a synthetic public menu. It does not evaluate availability, identity, appointment creation, payments, messaging, or activation. The key was read from the explicitly named local evaluation credential and was never written to this report.\n\n${passed}/${run} dispatched cases passed both expected intent matching and no-unknown-ID validation. Conservative pre-dispatch reservation: $${(reservedMicros / 1_000_000).toFixed(6)} of the $0.100000 ceiling. Provider-reported cost: $${(totalCost / 1_000_000).toFixed(6)}${results.some(item => item.status !== 'not_run' && item.costMicros === null) ? ' plus calls with unavailable usage' : ''}. Latency p50: ${p50LatencyMs === null ? 'unavailable' : `${p50LatencyMs.toFixed(0)} ms`}; p95: ${p95LatencyMs === null ? 'unavailable' : `${p95LatencyMs.toFixed(0)} ms`}.\n\n| Case | Status | Expected intent | Only menu IDs | Latency ms | Cost |\n| --- | --- | --- | --- | ---: | ---: |\n${rows}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options || options.help) {
    process.stdout.write(`${usage()}\n`);
    if (!options) {
      process.exitCode = 1;
    }
    return;
  }
  if (!options.run || !options.keyFile || !options.keyName) {
    process.stderr.write(`Refused: --run, --key-file, and --key-name are all required.\n${usage()}\n`);
    process.exitCode = 1;
    return;
  }
  if (!path.isAbsolute(options.keyFile)) {
    process.stderr.write('Refused: --key-file must be an absolute path.\n');
    process.exitCode = 1;
    return;
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(options.keyName)) {
    process.stderr.write('Refused: --key-name must be an uppercase environment-style name.\n');
    process.exitCode = 1;
    return;
  }
  const apiKey = envValue(await readFile(options.keyFile, 'utf8'), options.keyName);
  if (!apiKey) {
    process.stderr.write('Refused: the named key was absent or blank in the explicit key file.\n');
    process.exitCode = 1;
    return;
  }

  const outputDirectory = path.resolve(REPOSITORY_ROOT, options.out ?? 'artifacts/customer-assistant');
  const provider = createOpenAiResponsesProvider({ apiKey });
  const results: CaseResult[] = [];
  let reservedMicros = 0;
  for (const testCase of CUSTOMER_INTERPRETATION_EVAL_CASES) {
    const data = makeInput(testCase);
    const reservation = conservativeReservationMicros(data);
    if (reservedMicros + reservation > MAX_SPEND_MICROS) {
      results.push({ id: testCase.id, status: 'not_run', expectedMatch: null, noUnknownIds: null, schemaValid: false, latencyMs: null, usage: null, costMicros: null, intent: null, error: 'spend_ceiling_reservation' });
      continue;
    }
    reservedMicros += reservation;
    const started = performance.now();
    let providerUsage: ModelProviderUsage | null = null;
    try {
      const response = await provider.createResponse({
        model: MODEL,
        input: [{ role: 'system', content: CUSTOMER_INTERPRETATION_PROMPT }, { role: 'user', content: data }],
        tools: [],
        toolChoice: 'none',
        reasoningEffort: 'low',
        jsonMode: 'schema',
        jsonSchema: CUSTOMER_INTERPRETATION_JSON_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        timeoutMs: TIMEOUT_MS,
      });
      providerUsage = response.usage;
      const latencyMs = performance.now() - started;
      const text = response.items.filter(item => item.type === 'message').map(item => item.text).join('');
      if (response.status !== 'completed' || response.items.some(item => item.type === 'function_call' || item.type === 'refusal') || text.length > 12_000) {
        throw new Error('invalid');
      }
      const intent = customerInterpretationSchema.parse(JSON.parse(text));
      const noUnknownIds = hasOnlyMenuIds(intent);
      const expectedMatch = expectedMatches(intent, testCase);
      results.push({ id: testCase.id, status: noUnknownIds && expectedMatch ? 'passed' : 'failed', expectedMatch, noUnknownIds, schemaValid: true, latencyMs, usage: response.usage, costMicros: costMicros(response.usage), intent, error: null });
    } catch (error) {
      const latencyMs = performance.now() - started;
      providerUsage ??= error instanceof ModelProviderError ? error.usage : null;
      results.push({ id: testCase.id, status: 'failed', expectedMatch: false, noUnknownIds: false, schemaValid: false, latencyMs, usage: providerUsage, costMicros: costMicros(providerUsage), intent: null, error: fixedError(error) });
    }
  }
  const report = { generatedAt: new Date().toISOString(), model: MODEL, promptSha256: createHash('sha256').update(CUSTOMER_INTERPRETATION_PROMPT).digest('hex'), fixtureSha256: createHash('sha256').update(JSON.stringify(CUSTOMER_INTERPRETATION_EVAL_CASES)).digest('hex'), limits: { maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: TIMEOUT_MS, maxSpendMicros: MAX_SPEND_MICROS, conservativeReservedMicros: reservedMicros }, scope: 'synthetic customer interpretation only; no booking or production state', summary: { unknownUsageCases: results.filter(item => item.status !== 'not_run' && item.costMicros === null).length, dispatchedCases: results.filter(item => item.status !== 'not_run').length, strictPasses: results.filter(item => item.status === 'passed').length, latencyP50Ms: latencyPercentile(results, 0.5), latencyP95Ms: latencyPercentile(results, 0.95), providerReportedCostMicros: results.reduce((sum, item) => sum + (item.costMicros ?? 0), 0) }, results };
  await mkdir(outputDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(path.join(outputDirectory, `evaluation-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await writeFile(path.join(outputDirectory, `evaluation-${stamp}.md`), markdown(results, reservedMicros), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`Customer interpretation evaluation complete: ${results.filter(item => item.status === 'passed').length}/${results.filter(item => item.status !== 'not_run').length} passed. Reports written under ${path.relative(REPOSITORY_ROOT, outputDirectory)}.\n`);
}

void main().catch(() => {
  process.stderr.write('Customer interpretation evaluation failed before dispatch or report generation.\n');
  process.exitCode = 1;
});
