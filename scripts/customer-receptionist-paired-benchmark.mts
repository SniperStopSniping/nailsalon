/* eslint-disable style/max-statements-per-line */
/**
 * Paired real-provider evaluation of the archived two-call receptionist and
 * the current one-call receptionist.  Resolution is the production pure turn
 * orchestration with a synthetic L1 catalogue/schedule; it never opens a DB
 * connection or calls booking, messaging, payment, or production APIs.
 *
 * Create a read-only archive first: git archive 952dadc2 | tar -x -C /tmp/customer-receptionist-baseline
 * node --conditions=react-server --import tsx scripts/customer-receptionist-paired-benchmark.mts \
 *   --run --baseline-root /tmp/customer-receptionist-baseline --key-file /absolute/customer-assistant-production.env --key-name OPENAI_API_KEY --samples 20
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineRootIndex = process.argv.indexOf('--baseline-root');
const BASELINE_ROOT = baselineRootIndex >= 0 ? process.argv[baselineRootIndex + 1] : null;
const require = createRequire(import.meta.url);

const providerModule = require('../src/libs/ai/openaiResponses.server') as typeof import('../src/libs/ai/openaiResponses.server');
const currentTurn = require('../src/libs/customerAssistant/receptionistTurn') as typeof import('../src/libs/customerAssistant/receptionistTurn');
const currentHarness = require('../src/libs/customerAssistant/__evals__/receptionistHarness') as typeof import('../src/libs/customerAssistant/__evals__/receptionistHarness');
const currentSemantic = require('../src/libs/customerAssistant/__evals__/semanticCases') as typeof import('../src/libs/customerAssistant/__evals__/semanticCases');
const conversationModule = require('../src/libs/customerAssistant/conversation.server') as typeof import('../src/libs/customerAssistant/conversation.server');
const interpreterMenu = require('../src/libs/customerAssistant/interpreterMenu') as typeof import('../src/libs/customerAssistant/interpreterMenu');
const compactContext = require('../src/libs/customerAssistant/boundedModelContext') as typeof import('../src/libs/customerAssistant/boundedModelContext');
const pricing = require('../src/libs/customerAssistant/modelPricing') as typeof import('../src/libs/customerAssistant/modelPricing');
const semanticFacts = require('../src/libs/customerAssistant/semanticFacts') as typeof import('../src/libs/customerAssistant/semanticFacts');
const contracts = require('../src/libs/customerAssistant/contracts') as typeof import('../src/libs/customerAssistant/contracts');

if (!BASELINE_ROOT || !path.isAbsolute(BASELINE_ROOT)) {
  throw new Error('An absolute --baseline-root archive path is required.');
}
const baselineReply = require(`${BASELINE_ROOT}/src/libs/customerAssistant/reply.ts`) as typeof import('../src/libs/customerAssistant/reply');
const baselineInterpretation = require(`${BASELINE_ROOT}/src/libs/customerAssistant/interpretation.ts`) as typeof import('../src/libs/customerAssistant/interpretation');
const baselineInterpreterMenu = require(`${BASELINE_ROOT}/src/libs/customerAssistant/interpreterMenu.ts`) as typeof import('../src/libs/customerAssistant/interpreterMenu');

type Options = { run: boolean; baselineRoot: string | null; keyFile: string | null; keyName: string | null; category: string | null; samples: number; out: string };
type Scenario = { id: string; message: string; conversation: ReturnType<typeof conversationModule.createCustomerConversation>; availabilityFixture?: 'working_hours'; expected: 'answer' | 'proposal' | 'clarification' | 'slots' | 'unavailable' };
type Stage = { latencyMs: number; costMicros: number | null; status: string };
type Side = { stages: Record<string, Stage>; totalMs: number; resultKind: string; reason: string | null; message: string; options: string[]; quality: string[]; fallback: boolean; renderRejectionReason?: string; modelServiceOptions?: string[]; modelReplyFactKeys?: string[]; resultQuestion?: string | null; resultOptions?: string[] };
type Observation = { category: string; sample: number; baseline: Side; candidate: Side };

function parseArgs(argv: string[]): Options | null {
  const result: Options = { run: false, baselineRoot: null, keyFile: null, keyName: null, category: null, samples: 20, out: 'artifacts/customer-receptionist-paired-benchmark' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run') {
      result.run = true;
    } else if (arg === '--baseline-root' || arg === '--key-file' || arg === '--key-name' || arg === '--category' || arg === '--samples' || arg === '--out') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) {
        return null;
      }
      if (arg === '--baseline-root') {
        result.baselineRoot = value;
      } else if (arg === '--key-file') {
        result.keyFile = value;
      } else if (arg === '--category') {
        result.category = value;
      } else if (arg === '--key-name') {
        result.keyName = value;
      } else if (arg === '--out') {
        result.out = value;
      } else {
        const samples = Number(value); if (!Number.isSafeInteger(samples) || samples < 1 || samples > 20) {
          return null;
        } result.samples = samples;
      }
    } else {
      return null;
    }
  }
  return result;
}

function namedEnv(contents: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = contents.match(new RegExp(`^(?:export\\s+)?${escaped}\\s*=\\s*(.+?)\\s*$`, 'm'))?.[1]?.trim();
  return found ? (found.startsWith('"') && found.endsWith('"')) || (found.startsWith('\'') && found.endsWith('\'')) ? found.slice(1, -1) : found : null;
}

function percentile(values: number[], point: number): number | null {
  if (!values.length) {
    return null;
  }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * point) - 1] ?? null;
}

function stage(latencyMs: number, model: 'gpt-5.6-terra' | 'gpt-5.6-luna', usage: import('../src/libs/ai/provider').ModelProviderUsage | null, status: string): Stage {
  return { latencyMs, costMicros: pricing.customerAssistantModelUsageCostMicros(model, usage), status };
}

function publicFacts() {
  const snapshot = currentSemantic.SEMANTIC_L1_SNAPSHOT as { services: Array<{ id: string; name: string; category: string; priceCents: number; durationMinutes: number; descriptionItems?: string[] }>; addOns: Array<{ id: string; name: string; category: string; priceCents: number; durationMinutes: number; pricingType: string; descriptionItems?: string[] }> };
  const price = (cents: number) => ({ baseCents: cents, baseDisplay: new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100), displayLabel: null, range: null });
  return { salon: { name: 'Synthetic Isla' }, catalogue: { currency: 'CAD' as const, services: snapshot.services.map(item => ({ id: item.id, name: item.name, category: item.category, description: item.descriptionItems?.join('\n') || null, durationMinutes: item.durationMinutes, price: price(item.priceCents) })), addOns: snapshot.addOns.map(item => ({ id: item.id, name: item.name, category: item.category, description: item.descriptionItems?.join('\n') || null, pricingType: item.pricingType, durationMinutes: item.durationMinutes, price: price(item.priceCents) })) } };
}

function baseConversation() {
  return { ...conversationModule.createCustomerConversation('synthetic-isla', 'synthetic-only', Date.UTC(2026, 8, 18)), facts: semanticFacts.emptyFacts() };
}

function scenarios(): Scenario[] {
  const selection = { baseServiceId: 'svc_semantic_gelx', selectedAddOns: [{ addOnId: 'addon_semantic_medium', quantity: 1 }, { addOnId: 'addon_semantic_french', quantity: 1 }] };
  const configured = { ...baseConversation(), facts: { ...semanticFacts.emptyFacts(), treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'new_set', existingProduct: 'none', origin: 'unknown', removal: 'no', length: 'medium', french: 'yes' }, requestedSelection: selection, context: { question: null, options: [], selection }, booking: { acceptedFingerprint: null, datePreference: null, offeredSlots: [], selectedSlot: null }, subjects: ['svc_semantic_gelx'], messages: ['Medium Gel-X with French on bare nails'] } as Scenario['conversation'];
  return [
    { id: 'greeting', message: 'Hi! Can you help me choose a manicure?', conversation: baseConversation(), expected: 'answer' },
    { id: 'price', message: 'How much is Gel-X Extensions?', conversation: baseConversation(), expected: 'answer' },
    { id: 'recommendation', message: 'I want longer nails but I am not sure what would suit me. What do you recommend?', conversation: baseConversation(), expected: 'answer' },
    { id: 'unsupported_hardgel', message: 'I want hard gel extensions.', conversation: baseConversation(), expected: 'unavailable' },
    { id: 'complete_length_design', message: 'Medium Gel-X with French tips on bare nails, please.', conversation: baseConversation(), expected: 'proposal' },
    { id: 'availability_configured_state', message: 'What is the next availability?', conversation: configured, availabilityFixture: 'working_hours', expected: 'slots' },
  ];
}

function contextFor(conversation: Scenario['conversation'], message: string, includeReply: boolean) {
  const menu = currentSemantic.SEMANTIC_L1_MENU;
  const facts = publicFacts();
  const nextState = { ...conversation, messages: [...conversation.messages, message].slice(-16), turnIndex: conversation.turnIndex + 1 };
  const replyInput: import('../src/libs/customerAssistant/reply').ReplyInput = { menu, publicFacts: facts, result: { kind: 'answer', topic: 'conversation', message: '', options: [] }, conversation, nextState, message, locale: 'en' };
  const extra = includeReply ? currentTurn.receptionistContext(replyInput) : {};
  const compacted = compactContext.compactCustomerModelContext({ prompt: includeReply ? currentTurn.RECEPTIONIST_TURN_PROMPT : baselineInterpretation.CUSTOMER_INTERPRETATION_PROMPT, additionalInput: message, maxBytes: includeReply ? contracts.CUSTOMER_ASSISTANT_MAX_INPUT_BYTES : 30_000, legacyMessages: conversation.messages, context: { locale: 'en', bookingSalon: { name: 'Synthetic Isla', slug: 'synthetic-isla' }, previousFacts: conversation.facts ?? {}, requestedSelection: conversation.requestedSelection ?? null, menu: includeReply ? interpreterMenu.projectCustomerInterpreterMenu(menu) : baselineInterpreterMenu.projectCustomerInterpreterMenu(menu), conversationalSubjects: conversation.subjects ?? [], priorConversationalSubjects: conversation.priorSubjects ?? [], lastShown: conversation.context ?? null, bookingState: conversation.booking ?? null, availabilitySearch: conversation.availabilitySearch ?? null, ...extra } });
  if (!compacted.fits) {
    throw new Error('BENCHMARK_CONTEXT_EXCEEDS_AUTHORIZED_CAP');
  }
  return { menu, facts, nextState, replyInput, data: compacted.data };
}

function normalizeUnsupported(intent: { unsupportedRequest?: unknown; selectionChangeExplicitThisTurn?: boolean; action: string; serviceId: string | null; addOns: unknown[]; addOnUpdates?: unknown }, conversation: Scenario['conversation'], nextState: Scenario['conversation']) {
  const unsupported = intent.unsupportedRequest as { kind: string } | null | undefined;
  if (unsupported && intent.selectionChangeExplicitThisTurn) {
    nextState.unsupportedRequest = unsupported as never; nextState.context = undefined; nextState.booking = undefined; intent.action = 'no_match'; intent.serviceId = null; intent.addOns = []; intent.addOnUpdates = { add: [], remove: [] };
  } else if (unsupported) {
    intent.action = 'answer'; intent.unsupportedRequest = null;
  } else if (conversation.unsupportedRequest && intent.action === 'propose') { /* mirrored state is intentionally left to the resolver for this bounded eval */ }
}

async function call(provider: ReturnType<typeof providerModule.createOpenAiResponsesProvider>, request: Parameters<ReturnType<typeof providerModule.createOpenAiResponsesProvider>['createResponse']>[0], model: 'gpt-5.6-terra' | 'gpt-5.6-luna') {
  const started = performance.now();
  try {
    const response = await provider.createResponse(request); return { response, stage: stage(performance.now() - started, model, response.usage, response.status), text: response.items.filter(item => item.type === 'message').map(item => item.type === 'message' ? item.text : '').join('') };
  } catch {
    return { response: null, stage: { latencyMs: performance.now() - started, costMicros: null, status: 'error' }, text: '' };
  }
}

function quality(side: { result: { kind: string; reason?: string }; message: string; options: string[]; fallback: boolean }, scenario: Scenario): string[] {
  const failures: string[] = [];
  const greetingClarification = scenario.id === 'greeting' && side.result.kind === 'clarification';
  if (side.result.kind !== scenario.expected && !greetingClarification) {
    failures.push(`expected_${scenario.expected}_got_${side.result.kind}`);
  }
  if (scenario.id === 'unsupported_hardgel') {
    if (!/hard gel/i.test(side.message)) {
      failures.push('hardgel_label_not_preserved');
    }
    if (!/gel[ -]?x/i.test(side.message) && !side.options.includes('Gel-X Extensions')) {
      failures.push('hardgel_gelx_alternative_missing');
    }
  }
  return failures;
}

function receptionistSchemaDiagnostic(decoded: unknown, issue: { code: string; path: PropertyKey[] }): string {
  let value = decoded;
  for (const key of issue.path) {
    value = value && typeof value === 'object' ? (value as Record<PropertyKey, unknown>)[key] : undefined;
  }
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const trimLength = typeof value === 'string' ? value.trim().length : null;
  return `receptionist_schema_${issue.path.join('_')}_${issue.code}_type_${type}${trimLength === null ? '' : `_trim_${trimLength}`}`;
}

async function baseline(provider: ReturnType<typeof providerModule.createOpenAiResponsesProvider>, scenario: Scenario): Promise<Side> {
  const totalStarted = performance.now(); const input = contextFor(scenario.conversation, scenario.message, false);
  const interpreter = await call(provider, { model: 'gpt-5.6-terra', input: [{ role: 'system', content: baselineInterpretation.CUSTOMER_INTERPRETATION_PROMPT }, { role: 'user', content: input.data }, { role: 'user', content: scenario.message }], tools: [], toolChoice: 'none', reasoningEffort: 'low', jsonMode: 'schema', jsonSchema: baselineInterpretation.CUSTOMER_INTERPRETATION_JSON_SCHEMA, maxOutputTokens: 1200, timeoutMs: 12_000 }, 'gpt-5.6-terra');
  if (!interpreter.response || interpreter.response.status !== 'completed') {
    return { stages: { interpreter: interpreter.stage }, totalMs: performance.now() - totalStarted, resultKind: 'unavailable', reason: 'provider', message: '', options: [], quality: ['interpreter_failed'], fallback: true };
  }
  let intent: ReturnType<typeof baselineInterpretation.customerInterpretationSchema.parse>;
  try {
    intent = baselineInterpretation.customerInterpretationSchema.parse(JSON.parse(interpreter.text));
  } catch {
    return { stages: { interpreter: interpreter.stage }, totalMs: performance.now() - totalStarted, resultKind: 'unavailable', reason: 'parse', message: '', options: [], quality: ['interpreter_parse_failed'], fallback: true };
  }
  const next = input.nextState; normalizeUnsupported(intent, scenario.conversation, next);
  const resolving = performance.now(); const evaluated = await currentHarness.evaluateReceptionistTurn(intent, scenario.conversation, { message: scenario.message, kinds: ['answer', 'proposal', 'clarification', 'slots', 'unavailable'], availabilityFixture: scenario.availabilityFixture }); const resolution: Stage = { latencyMs: performance.now() - resolving, costMicros: 0, status: 'synthetic' };
  const replyInput = { menu: input.menu, publicFacts: input.facts, result: evaluated.result, conversation: scenario.conversation, nextState: evaluated.next, message: scenario.message, locale: 'en' as const };
  const replyData = baselineReply.buildReplyInput(replyInput);
  const composer = await call(provider, { model: 'gpt-5.6-luna', input: [{ role: 'system', content: baselineReply.RECEPTIONIST_REPLY_PROMPT }, { role: 'user', content: replyData.data }], tools: [], toolChoice: 'none', reasoningEffort: 'low', jsonMode: 'schema', jsonSchema: baselineReply.createReplySchema(replyData.facts), maxOutputTokens: 900, timeoutMs: 10_000 }, 'gpt-5.6-luna');
  let message = baselineReply.fallbackReceptionistReply(replyInput, replyData.facts); let options: string[] = []; let fallback = true;
  if (composer.response?.status === 'completed') {
    try {
      ({ message, options } = baselineReply.parseReceptionistReply(composer.text, replyData.facts, input.menu, replyData.requiredFactKeys)); fallback = false;
    } catch { /* reported as deterministic fallback */ }
  }
  const provisional = { result: evaluated.result, message, options, fallback }; const checks = [...evaluated.failures, ...quality(provisional, scenario)];
  return { stages: { interpreter: interpreter.stage, synthetic_resolution: resolution, composer: composer.stage }, totalMs: performance.now() - totalStarted, resultKind: evaluated.result.kind, reason: evaluated.result.kind === 'unavailable' ? evaluated.result.reason : null, message, options, quality: checks, fallback };
}

async function candidate(provider: ReturnType<typeof providerModule.createOpenAiResponsesProvider>, scenario: Scenario): Promise<Side> {
  const totalStarted = performance.now(); const input = contextFor(scenario.conversation, scenario.message, true);
  const receptionist = await call(provider, { model: 'gpt-5.6-terra', input: [{ role: 'system', content: currentTurn.RECEPTIONIST_TURN_PROMPT }, { role: 'user', content: input.data }, { role: 'user', content: scenario.message }], tools: [], toolChoice: 'none', reasoningEffort: 'low', jsonMode: 'schema', jsonSchema: currentTurn.createReceptionistTurnSchema(Object.keys(currentTurn.receptionistContext(input.replyInput).replyFacts)), maxOutputTokens: 1800, timeoutMs: 15_000 }, 'gpt-5.6-terra');
  if (!receptionist.response || receptionist.response.status !== 'completed') {
    return { stages: { receptionist: receptionist.stage }, totalMs: performance.now() - totalStarted, resultKind: 'unavailable', reason: 'provider', message: '', options: [], quality: ['receptionist_failed'], fallback: true };
  }
  let intent: ReturnType<typeof currentTurn.receptionistTurnSchema.parse>;
  try {
    const decoded = JSON.parse(receptionist.text);
    const parsed = currentTurn.receptionistTurnSchema.safeParse(decoded);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const diagnostic = issue ? receptionistSchemaDiagnostic(decoded, issue) : 'receptionist_schema_unknown';
      return { stages: { receptionist: receptionist.stage }, totalMs: performance.now() - totalStarted, resultKind: 'unavailable', reason: 'parse', message: '', options: [], quality: [diagnostic], fallback: true };
    }
    intent = parsed.data;
  } catch {
    return { stages: { receptionist: receptionist.stage }, totalMs: performance.now() - totalStarted, resultKind: 'unavailable', reason: 'parse', message: '', options: [], quality: ['receptionist_invalid_json'], fallback: true };
  }
  const next = input.nextState; normalizeUnsupported(intent, scenario.conversation, next);
  const resolving = performance.now(); const evaluated = await currentHarness.evaluateReceptionistTurn(intent, scenario.conversation, { message: scenario.message, kinds: ['answer', 'proposal', 'clarification', 'slots', 'unavailable'], availabilityFixture: scenario.availabilityFixture }); const resolution: Stage = { latencyMs: performance.now() - resolving, costMicros: 0, status: 'synthetic' };
  if (next.unsupportedRequest) {
    evaluated.next.unsupportedRequest = next.unsupportedRequest;
    evaluated.next.context = undefined;
    evaluated.next.booking = undefined;
  }
  const renderStarted = performance.now();
  const rendered = currentTurn.renderReceptionistTurn({ menu: input.menu, publicFacts: input.facts, result: evaluated.result, conversation: scenario.conversation, nextState: evaluated.next, message: scenario.message, locale: 'en' }, intent);
  const renderLatencyMs = performance.now() - renderStarted;
  const provisional = { result: evaluated.result, message: rendered.message, options: rendered.options, fallback: !rendered.usedModelReply }; const checks = [...evaluated.failures, ...quality(provisional, scenario)];
  return { stages: { receptionist: receptionist.stage, synthetic_resolution: resolution, render: { latencyMs: renderLatencyMs, costMicros: 0, status: 'deterministic' } }, totalMs: performance.now() - totalStarted, resultKind: evaluated.result.kind, reason: evaluated.result.kind === 'unavailable' ? evaluated.result.reason : null, message: rendered.message, options: rendered.options, quality: checks, fallback: !rendered.usedModelReply, ...(rendered.rejectionReason ? { renderRejectionReason: rendered.rejectionReason } : {}), modelServiceOptions: intent.reply?.serviceOptions ?? [], modelReplyFactKeys: intent.reply?.segments.flatMap(segment => segment.kind === 'fact' ? [segment.key] : []), resultQuestion: evaluated.result.kind === 'clarification' ? evaluated.result.question : null, resultOptions: 'options' in evaluated.result ? evaluated.result.options : [] };
}

function summary(observations: Observation[]) {
  const side = (key: 'baseline' | 'candidate') => {
    const rows = observations.map(row => row[key]); const totals = rows.map(row => row.totalMs); const stageNames = [...new Set(rows.flatMap(row => Object.keys(row.stages)))];
    return { n: rows.length, totalMs: { p50: percentile(totals, 0.5), p95: percentile(totals, 0.95), max: totals.length ? Math.max(...totals) : null }, stages: Object.fromEntries(stageNames.map((name) => {
      const values = rows.map(row => row.stages[name]?.latencyMs).filter((value): value is number => value !== undefined); return [name, { p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: values.length ? Math.max(...values) : null }];
    })), reportedCostMicros: rows.reduce((sum, row) => sum + Object.values(row.stages).reduce((part, item) => part + (item.costMicros ?? 0), 0), 0), unknownCostStages: rows.flatMap(row => Object.values(row.stages)).filter(item => item.costMicros === null).length, fallbacks: rows.filter(row => row.fallback).length, qualityFailures: rows.flatMap(row => row.quality).length };
  };
  return { baseline: side('baseline'), candidate: side('candidate') };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options || !options.run || !options.baselineRoot || !options.keyFile || !options.keyName || !path.isAbsolute(options.baselineRoot) || !path.isAbsolute(options.keyFile)) {
    process.stderr.write('Usage: --run --baseline-root <absolute-archive-path> --key-file <absolute-path> --key-name <name> [--samples 1..20] [--out <directory>]\n'); process.exitCode = 1; return;
  }
  const key = namedEnv(await readFile(options.keyFile, 'utf8'), options.keyName); if (!key) {
    throw new Error('Named evaluation key was absent or blank.');
  }
  const provider = providerModule.createOpenAiResponsesProvider({ apiKey: key }); const observations: Observation[] = [];
  const selectedScenarios = scenarios().filter(scenario => !options.category || scenario.id === options.category);
  if (!selectedScenarios.length) {
    throw new Error('The requested --category is not a supported bounded benchmark scenario.');
  }
  for (let sample = 1; sample <= options.samples; sample += 1) {
    const batch = await Promise.all(selectedScenarios.map(async (scenario) => {
      const [oldSide, newSide] = [await baseline(provider, scenario), await candidate(provider, scenario)];
      return { category: scenario.id, sample, baseline: oldSide, candidate: newSide };
    }));
    observations.push(...batch);
    const spent = observations.flatMap(row => [...Object.values(row.baseline.stages), ...Object.values(row.candidate.stages)]).reduce((sum, item) => sum + (item.costMicros ?? 0), 0);
    if (spent > 4_500_000) {
      throw new Error('Reported evaluation spend exceeded the $4.50 safety ceiling.');
    }
  }
  const report = { generatedAt: new Date().toISOString(), baselineRevision: '952dadc23bace8ff0f43e7158e1eef02efec39c8', candidateRevision: 'current worktree', samplesPerCategory: options.samples, categories: selectedScenarios.map(item => item.id), providerBounds: { baseline: { contextBytes: 30_000, interpreter: { maxOutputTokens: 1200, timeoutMs: 12_000 }, composer: { maxOutputTokens: 900, timeoutMs: 10_000 } }, candidate: { contextBytes: contracts.CUSTOMER_ASSISTANT_MAX_INPUT_BYTES, receptionist: { maxOutputTokens: 1800, timeoutMs: 15_000 } } }, scope: 'Real Responses API calls: Terra interpreter/receptionist and archived Luna composer. Synthetic L1 catalogue, resolver, and schedule only; synthetic_resolution excludes real database, availability, booking, SMS/email, payments, and production data.', notes: ['Baseline is sequential Terra interpreter plus Luna composer; candidate is one Terra receptionist call.', 'Provider stages include actual provider latency and reported token-based cost. Synthetic resolution/render timing is local only.', 'Quality failures are recorded per observation; numeric business facts are accepted only through server rendering/parser guards.'], summary: summary(observations), observations };
  const directory = path.resolve(ROOT, options.out); await mkdir(directory, { recursive: true }); const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const file = path.join(directory, `paired-${stamp}.json`); await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); process.stdout.write(`Wrote ${observations.length} paired observations to ${path.relative(ROOT, file)}\n`);
}

void main();
