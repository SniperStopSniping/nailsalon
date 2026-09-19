/**
 * Opt-in semantic-fact evaluation against a synthetic L1 nail menu. This
 * never opens a database, reads a salon, creates an appointment, or sends a
 * message. It writes only a 0600 local report and refuses to run without an
 * explicitly named key in a private file.
 *
 * node --conditions=react-server --import tsx scripts/customer-semantic-eval.mts \
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
const { SEMANTIC_EVAL_CASES, SEMANTIC_L1_MENU, candidateForSemanticSelection, matchesExpectedSemanticSelection, resolveSyntheticSemanticFixture } = require('../src/libs/customerAssistant/__evals__/semanticCases') as typeof import('../src/libs/customerAssistant/__evals__/semanticCases');
const { emptyFacts, mergeFacts } = require('../src/libs/customerAssistant/semanticFacts') as typeof import('../src/libs/customerAssistant/semanticFacts');
const { resolveSemanticSelection } = require('../src/libs/customerAssistant/semanticSelection') as typeof import('../src/libs/customerAssistant/semanticSelection');

const model = 'gpt-5.6-luna';
const maxOutputTokens = 1_200;
const timeoutMs = 15_000;
const maxSpendMicros = 200_000;
const inputMicrosPerMillion = 200_000;
const cachedInputMicrosPerMillion = 20_000;
const outputMicrosPerMillion = 1_200_000;

type Options = { run: boolean; keyFile: string | null; keyName: string | null; out: string | null };
type SafeCategory = 'passed' | 'wrong_fact' | 'wrong_canonical_selection' | 'safe_clarification' | 'unexpected_nonproposal' | 'invalid_model_response' | 'provider_failure' | 'spend_ceiling' | 'not_run_after_critical';

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

function expectedFactsMatch(facts: import('../src/libs/customerAssistant/semanticFacts').Facts, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => facts[key as keyof typeof facts] === value);
}

function reservationFor(input: string): number {
  return Math.ceil(((Buffer.byteLength(CUSTOMER_INTERPRETATION_PROMPT + input + JSON.stringify(CUSTOMER_INTERPRETATION_JSON_SCHEMA), 'utf8') + 4_096) * 250_000 + maxOutputTokens * outputMicrosPerMillion) / 1_000_000);
}

function hasKnownFacts(facts: import('../src/libs/customerAssistant/semanticFacts').Facts): boolean {
  return JSON.stringify(facts) !== JSON.stringify(emptyFacts());
}

function expectedPatch(expected: Record<string, unknown>): import('../src/libs/customerAssistant/semanticFacts').Patch {
  return {
    schemaVersion: 1,
    treatment: null,
    desiredApplication: null,
    maintenance: null,
    length: null,
    french: null,
    existingProduct: null,
    origin: null,
    removal: null,
    repairCount: null,
    ...expected,
  } as import('../src/libs/customerAssistant/semanticFacts').Patch;
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
  let stopped = false;
  for (const testCase of SEMANTIC_EVAL_CASES) {
    let facts = emptyFacts();
    let goldenFacts = emptyFacts();
    const messages: string[] = [];
    let lastShown: { question: string | null; options: string[]; selection: import('../src/libs/customerAssistant/contracts').CustomerSelection | null } = { question: null, options: [], selection: null };
    for (let turnIndex = 0; turnIndex < testCase.turns.length; turnIndex += 1) {
      const turn = testCase.turns[turnIndex];
      if (!turn) {
        continue;
      }
      if (stopped) {
        results.push({ caseId: testCase.id, turn: turnIndex + 1, status: 'not_run', category: 'not_run_after_critical' satisfies SafeCategory });
        continue;
      }
      messages.push(turn.message);
      goldenFacts = mergeFacts(goldenFacts, expectedPatch(turn.expectedFacts));
      const input = JSON.stringify({
        locale: 'en',
        bookingSalon: testCase.trustedBookingSalon,
        menu: SEMANTIC_L1_MENU,
        customerMessages: messages,
        previousFacts: facts,
        lastShown,
        bookingState: null,
        today: '2026-09-18',
        timeZone: 'America/Toronto',
      });
      const reservation = reservationFor(input);
      if (reservedMicros + reservation > maxSpendMicros) {
        results.push({ caseId: testCase.id, turn: turnIndex + 1, status: 'not_run', category: 'spend_ceiling' satisfies SafeCategory });
        continue;
      }
      reservedMicros += reservation;
      const started = performance.now();
      try {
        const response = await provider.createResponse({ model, input: [{ role: 'system', content: CUSTOMER_INTERPRETATION_PROMPT }, { role: 'user', content: input }], tools: [], toolChoice: 'none', reasoningEffort: 'low', jsonMode: 'schema', jsonSchema: CUSTOMER_INTERPRETATION_JSON_SCHEMA, maxOutputTokens, timeoutMs });
        const text = response.items.filter(item => item.type === 'message').map(item => item.text).join('');
        if (response.status !== 'completed' || response.items.some(item => item.type === 'function_call' || item.type === 'refusal') || text.length > 12_000) {
          throw new Error('invalid_model_response');
        }
        const intent = customerInterpretationSchema.parse(JSON.parse(text));
        facts = mergeFacts(facts, intent.factUpdates);
        const shouldResolveService = intent.action === 'propose'
          || (intent.action === 'clarify' && intent.question !== 'date' && hasKnownFacts(facts));
        const semantic = shouldResolveService
          ? resolveSemanticSelection({
            menu: SEMANTIC_L1_MENU,
            facts,
            candidate: intent.serviceId ? { baseServiceId: intent.serviceId, selectedAddOns: intent.addOns } : null,
          })
          : intent.action === 'no_match'
            ? { kind: 'no_match' as const }
            : { kind: 'clarification' as const, question: intent.question, optionIds: intent.optionIds };
        const resolved = semantic.kind === 'selection'
          ? resolveSyntheticSemanticFixture({ facts, candidate: semantic.selection })
          : semantic;
        let category: SafeCategory = 'passed';
        if (!expectedFactsMatch(facts, turn.expectedFacts)) {
          category = 'wrong_fact';
        } else if (turn.expectedAction === 'propose' && !matchesExpectedSemanticSelection(resolved, turn.expectedSelection, goldenFacts)) {
          category = resolved.kind === 'clarification' ? 'safe_clarification' : 'wrong_canonical_selection';
        } else if (turn.expectedAction === 'clarify' && resolved.kind !== 'clarification') {
          category = 'unexpected_nonproposal';
        } else if (turn.expectedAction === 'no_match' && resolved.kind !== 'no_match') {
          category = 'unexpected_nonproposal';
        }
        const failed = category !== 'passed';
        const critical = turn.critical && (category === 'wrong_fact' || category === 'wrong_canonical_selection');
        const expectedCanonical = resolveSyntheticSemanticFixture({ facts: goldenFacts, candidate: candidateForSemanticSelection(turn.expectedSelection) });
        results.push({
          caseId: testCase.id,
          turn: turnIndex + 1,
          status: failed ? 'failed' : 'passed',
          category,
          critical,
          latencyMs: Math.round(performance.now() - started),
          costMicros: costMicros(response.usage),
          expectedFacts: turn.expectedFacts,
          goldenFacts,
          facts,
          intent,
          semantic,
          resolved,
          expectedCanonical,
        });
        if (resolved.kind === 'proposal') {
          lastShown = { question: null, options: [], selection: resolved.selection };
        } else if (resolved.kind === 'clarification') {
          lastShown = { question: resolved.question, options: semantic.kind === 'clarification' ? semantic.optionIds : [], selection: null };
        }
        if (critical) {
          stopped = true;
        }
      } catch {
        results.push({ caseId: testCase.id, turn: turnIndex + 1, status: 'failed', category: 'invalid_model_response' satisfies SafeCategory, latencyMs: Math.round(performance.now() - started) });
      }
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    model,
    store: false,
    scope: 'synthetic semantic facts and pure L1 resolution only; no database, booking, availability, payment, messaging, or production state',
    promptSha256: createHash('sha256').update(CUSTOMER_INTERPRETATION_PROMPT).digest('hex'),
    fixtureSha256: createHash('sha256').update(JSON.stringify(SEMANTIC_EVAL_CASES)).digest('hex'),
    limits: { maxOutputTokens, timeoutMs, maxSpendMicros, reservedMicros },
    summary: { dispatched: results.filter(result => result.status !== 'not_run').length, passed: results.filter(result => result.status === 'passed').length, stoppedOnCritical: stopped, providerReportedCostMicros: results.reduce((sum, result) => sum + (typeof result.costMicros === 'number' ? result.costMicros : 0), 0) },
    results,
  };
  const output = path.resolve(root, options.out ?? 'artifacts/customer-assistant/semantic-evaluation');
  await mkdir(output, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(path.join(output, `evaluation-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`Synthetic semantic evaluation complete: ${report.summary.passed}/${report.summary.dispatched} passed.\n`);
}

void main().catch(() => {
  process.stderr.write('Synthetic semantic evaluation failed before report generation.\n');
  process.exitCode = 1;
});
