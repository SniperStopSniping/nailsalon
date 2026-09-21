/**
 * Isolated baseline measurement of the exact 952dadc2 interpreter prompt and
 * schema against a synthetic public menu. It makes real Responses API calls
 * but never imports the turn loop, database, availability, booking, payment,
 * messaging, or production salon data.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createOpenAiResponsesProvider } = require('../src/libs/ai/openaiResponses.server') as typeof import('../src/libs/ai/openaiResponses.server');
const { CUSTOMER_INTERPRETATION_JSON_SCHEMA, CUSTOMER_INTERPRETATION_PROMPT } = require('../src/libs/customerAssistant/interpretation') as typeof import('../src/libs/customerAssistant/interpretation');
const { CUSTOMER_INTERPRETATION_EVAL_CASES, SYNTHETIC_CUSTOMER_MENU } = require('../src/libs/customerAssistant/__evals__/interpretationCases') as typeof import('../src/libs/customerAssistant/__evals__/interpretationCases');

type Options = { run: boolean; keyFile: string | null; keyName: string | null; samples: number; out: string };
type Observation = { id: string; latencyMs: number; status: string; inputTokens: number | null; cachedInputTokens: number | null; cacheWriteInputTokens: number | null; outputTokens: number | null; costMicros: number | null };

function parseArgs(argv: string[]): Options | null {
  const result: Options = { run: false, keyFile: null, keyName: null, samples: 20, out: 'artifacts/customer-receptionist-latency-baseline' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') {
      result.run = true;
    } else if (arg === '--key-file' || arg === '--key-name' || arg === '--samples' || arg === '--out') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) {
        return null;
      }
      if (arg === '--key-file') {
        result.keyFile = value;
      } else if (arg === '--key-name') {
        result.keyName = value;
      } else if (arg === '--out') {
        result.out = value;
      } else {
        const samples = Number(value);
        if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100) {
          return null;
        }
        result.samples = samples;
      }
    } else {
      return null;
    }
  }
  return result;
}

function readNamedEnv(contents: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = contents.match(new RegExp(`^(?:export\\s+)?${escaped}\\s*=\\s*(.+?)\\s*$`, 'm'));
  if (!match?.[1]) {
    return null;
  }
  const value = match[1].trim();
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value.startsWith('\'') && value.endsWith('\'') ? value.slice(1, -1) : value;
}

function costMicros(usage: { inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens?: number; outputTokens: number } | null): number | null {
  if (!usage) {
    return null;
  }
  const write = usage.cacheWriteInputTokens ?? 0;
  const regular = usage.inputTokens - usage.cachedInputTokens - write;
  return regular < 0 ? null : Math.ceil(regular * 2 + usage.cachedInputTokens * 0.2 + write * 2.5 + usage.outputTokens * 12);
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options || !options.run || !options.keyFile || !options.keyName || !path.isAbsolute(options.keyFile)) {
    process.stderr.write('Usage: node --conditions=react-server --import tsx scripts/customer-receptionist-interpreter-baseline.mts --run --key-file <absolute-path> --key-name <name> [--samples 20] [--out <directory>]\n');
    process.exitCode = 1;
    return;
  }
  const key = readNamedEnv(await readFile(options.keyFile, 'utf8'), options.keyName);
  if (!key) {
    throw new Error('Named evaluation key was absent or blank.');
  }
  const provider = createOpenAiResponsesProvider({ apiKey: key });
  const observations: Observation[] = [];
  for (let index = 0; index < options.samples; index += 1) {
    const testCase = CUSTOMER_INTERPRETATION_EVAL_CASES[index % CUSTOMER_INTERPRETATION_EVAL_CASES.length]!;
    const message = testCase.messages.at(-1)!;
    const data = JSON.stringify({ locale: 'en', bookingSalon: { name: 'Synthetic Nail Studio', slug: 'synthetic-nail-studio' }, previousFacts: {}, requestedSelection: null, menu: SYNTHETIC_CUSTOMER_MENU, lastShown: null, bookingState: null, availabilitySearch: null, today: '2026-09-21', timeZone: 'America/Toronto' });
    const started = performance.now();
    try {
      const response = await provider.createResponse({ model: 'gpt-5.6-terra', input: [{ role: 'system', content: CUSTOMER_INTERPRETATION_PROMPT }, { role: 'user', content: data }, { role: 'user', content: message }], tools: [], toolChoice: 'none', reasoningEffort: 'low', jsonMode: 'schema', jsonSchema: CUSTOMER_INTERPRETATION_JSON_SCHEMA, maxOutputTokens: 1200, timeoutMs: 12_000 });
      const usage = response.usage;
      observations.push({ id: testCase.id, latencyMs: performance.now() - started, status: response.status, inputTokens: usage?.inputTokens ?? null, cachedInputTokens: usage?.cachedInputTokens ?? null, cacheWriteInputTokens: usage?.cacheWriteInputTokens ?? null, outputTokens: usage?.outputTokens ?? null, costMicros: costMicros(usage) });
    } catch {
      observations.push({ id: testCase.id, latencyMs: performance.now() - started, status: 'error', inputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: null, costMicros: null });
    }
  }
  const times = observations.filter(item => item.status === 'completed').map(item => item.latencyMs);
  const report = { revision: '952dadc23bace8ff0f43e7158e1eef02efec39c8', generatedAt: new Date().toISOString(), scope: 'real Terra interpreter only, exact baseline prompt/schema, synthetic menu; no database, catalogue query, quote, availability, booking, payment, messaging, or production salon data', limitations: ['This measures the interpreter provider stage, not the sequential Luna reply-composition stage.', 'Synthetic resolver/availability timings must be measured separately.', 'Provider token usage is reported when returned; null is unknown, not zero.'], summary: { samples: observations.length, completed: times.length, p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), maxMs: times.length ? Math.max(...times) : null, reportedCostMicros: observations.reduce((sum, item) => sum + (item.costMicros ?? 0), 0), unknownUsage: observations.filter(item => item.costMicros === null).length }, observations };
  const directory = path.resolve(ROOT, options.out);
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(path.join(directory, `customer-receptionist-interpreter-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`Wrote ${observations.length} isolated real-provider interpreter observations.\n`);
}

void main();
