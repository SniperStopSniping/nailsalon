/**
 * The eval harness (A1-4, deliverable D).
 *
 * Runs one dialogue case through the REAL turn loop with an injected provider
 * and records what happened. It is deliberately provider-agnostic: it wraps
 * whatever `OwnerAssistantModelProvider` it is handed, so the scripted fake in
 * CI and the live OpenAI adapter in a manual run take exactly the same path and
 * produce exactly the same record shape. Nothing here knows, or may ask, which
 * one it got.
 *
 * Observation is done at the provider seam rather than by reaching into the
 * loop: every model request and response passes through the wrapper, so the
 * function calls the model asked for come from the RESPONSES and the outputs
 * the loop produced for them come from the NEXT REQUEST's
 * `function_call_output` items. That is the same evidence the model itself
 * sees, which is the point — a tool the harness records as executed is one the
 * model was actually told about.
 *
 * This module never touches the network, the database or a key on its own. It
 * imports the turn loop (which is `server-only`) and nothing else that does.
 */
import type {
  ModelProviderInputItem,
  ModelProviderRequest,
  ModelProviderResponse,
  OwnerAssistantModelProvider,
} from '@/libs/ai/provider';
import type { SalonAuditLogDatabase } from '@/libs/salonAuditLog.server';

import {
  type ChatLink,
  type ChatTurnResponse,
  type ChatUnavailableReason,
  OWNER_ASSISTANT_MODEL_PRICES_MICROS_PER_MILLION,
  type OwnerAssistantToolName,
} from '../contracts';
import {
  type OwnerAssistantAdmin,
  type OwnerAssistantSalon,
  runOwnerAssistantTurn,
  type RunOwnerAssistantTurnArgs,
} from '../turn.server';
import type { EvalDialogueCase, EvalTurnExpectation } from './cases';
import { checkGrounding, type GroundingVerdict } from './grounding';

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type EvalToolCallRecord = {
  callId: string;
  name: string;
  /** Parsed arguments, or the raw string when the model sent unparsable JSON. */
  args: unknown;
  /** True once the loop handed the model an output for this call. */
  executed: boolean;
  ok: boolean;
  errorCode?: string;
  /** The tool result the model was shown. Only present when `ok`. */
  result?: unknown;
};

export type EvalUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
};

export type EvalTurnRecord = {
  index: number;
  message: string;
  /** What the case declared, carried into the record so a report is self-describing. */
  expectedTools: string[];
  outcomeKind: 'answer' | 'unavailable';
  unavailableReason?: ChatUnavailableReason;
  /** The owner-facing text — the answer, or the unavailable sentence. */
  answer: string;
  checked: OwnerAssistantToolName[];
  links: ChatLink[];
  followUps: string[];
  needsClarification: boolean;
  toolCalls: EvalToolCallRecord[];
  /** Provider round trips attempted this turn, including one that threw. */
  modelCalls: number;
  usage: EvalUsage;
  /** Wall time of the whole turn, not of the provider call. */
  latencyMs: number;
  costMicros: number;
  priceKnown: boolean;
  grounding: GroundingVerdict;
  /** Empty when the turn met every expectation the case declared. */
  failures: string[];
};

export type EvalCaseRecord = {
  caseId: string;
  group: EvalDialogueCase['group'];
  title: string;
  salonSlug: string;
  passed: boolean;
  turns: EvalTurnRecord[];
  failures: string[];
  /** Set when the case could not run at all (an unexpected throw). */
  error?: string;
};

// ---------------------------------------------------------------------------
// Cost — the price table in contracts.ts is the only authority
// ---------------------------------------------------------------------------

/**
 * GPT-5.6+ prompt-cache writes bill at 1.25× the uncached input rate. Kept in
 * step with `CACHE_WRITE_MULTIPLIER` in `ledger.server.ts`, which is the
 * production authority; `evals.test.ts` asserts the two agree rather than
 * trusting this comment.
 */
export const EVAL_CACHE_WRITE_MULTIPLIER = 1.25;

export function computeUsageCostMicros(
  model: string,
  usage: EvalUsage,
): { costMicros: number; priceKnown: boolean } {
  const price = OWNER_ASSISTANT_MODEL_PRICES_MICROS_PER_MILLION[model];
  if (!price) {
    return { costMicros: 0, priceKnown: false };
  }

  const input = Math.max(usage.inputTokens, 0);
  const cached = Math.min(Math.max(usage.cachedInputTokens, 0), input);
  const cacheWrite = Math.min(Math.max(usage.cacheWriteInputTokens, 0), input - cached);
  const uncached = input - cached - cacheWrite;

  const micros
    = (uncached * price.input)
    + (cached * price.cachedInput)
    + (cacheWrite * price.input * EVAL_CACHE_WRITE_MULTIPLIER)
    + (Math.max(usage.outputTokens, 0) * price.output);

  return { costMicros: Math.round(micros / 1_000_000), priceKnown: true };
}

// ---------------------------------------------------------------------------
// Provider instrumentation
// ---------------------------------------------------------------------------

type TurnObservation = {
  modelCalls: number;
  usage: EvalUsage;
  toolCalls: EvalToolCallRecord[];
};

function emptyUsage(): EvalUsage {
  return { inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0 };
}

function parseArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson === '' ? '{}' : argumentsJson);
  } catch {
    return argumentsJson;
  }
}

function absorbRequest(observation: TurnObservation, request: ModelProviderRequest): void {
  for (const item of request.input as readonly ModelProviderInputItem[]) {
    if (typeof item !== 'object' || !('type' in item) || item.type !== 'function_call_output') {
      continue;
    }
    const record = observation.toolCalls.find(candidate => candidate.callId === item.call_id);
    if (!record) {
      continue;
    }
    record.executed = true;
    let output: unknown;
    try {
      output = JSON.parse(item.output);
    } catch {
      output = item.output;
    }
    const errorCode = output && typeof output === 'object' && 'error' in output
      ? (output as { error?: { code?: string } }).error?.code
      : undefined;
    if (errorCode) {
      record.ok = false;
      record.errorCode = errorCode;
      continue;
    }
    record.ok = true;
    record.result = output;
  }
}

function absorbResponse(observation: TurnObservation, response: ModelProviderResponse): void {
  observation.usage.inputTokens += response.usage.inputTokens;
  observation.usage.cachedInputTokens += response.usage.cachedInputTokens;
  observation.usage.cacheWriteInputTokens += response.usage.cacheWriteInputTokens ?? 0;
  observation.usage.outputTokens += response.usage.outputTokens;

  for (const item of response.items) {
    if (item.type !== 'function_call') {
      continue;
    }
    observation.toolCalls.push({
      callId: item.callId,
      name: item.name,
      args: parseArguments(item.argumentsJson),
      executed: false,
      ok: false,
    });
  }
}

/**
 * Wraps any provider so one turn's model calls, tokens and tool traffic are
 * recorded. The wrapper is transparent: it forwards the request untouched and
 * re-throws whatever the provider threw, so the loop behaves identically.
 */
export function instrumentProvider(
  provider: OwnerAssistantModelProvider,
  observation: TurnObservation,
): OwnerAssistantModelProvider {
  return {
    async createResponse(request, signal) {
      observation.modelCalls += 1;
      absorbRequest(observation, request);
      const response = await provider.createResponse(request, signal);
      absorbResponse(observation, response);
      return response;
    },
  };
}

// ---------------------------------------------------------------------------
// Running a case
// ---------------------------------------------------------------------------

export type EvalProviderContext = {
  caseId: string;
  turnIndex: number;
  message: string;
};

/** A single provider for the whole case, or one built per turn. */
export type EvalProviderInput =
  | OwnerAssistantModelProvider
  | ((context: EvalProviderContext) => OwnerAssistantModelProvider);

export type EvalTurnRunner = (args: RunOwnerAssistantTurnArgs) => Promise<ChatTurnResponse>;

export type EvalCheckOptions = {
  /**
   * Check `mustMention` / `mustNotMention`. FALSE in CI: the scripted fake
   * writes the answer text, so asserting on it would only prove the script.
   */
  checkAnswerText: boolean;
  /** Fail a turn whose answer states a fact no tool result supports. */
  scoreGrounding: boolean;
};

export type RunEvalCaseArgs = {
  evalCase: EvalDialogueCase;
  salon: OwnerAssistantSalon;
  admin: OwnerAssistantAdmin;
  provider: EvalProviderInput;
  model: string;
  now?: Date;
  locale?: string;
  database?: SalonAuditLogDatabase;
  checks: EvalCheckOptions;
  /** Seam for tests; defaults to the production loop. */
  runTurn?: EvalTurnRunner;
};

function resolveProvider(
  provider: EvalProviderInput,
  context: EvalProviderContext,
): OwnerAssistantModelProvider {
  return typeof provider === 'function' ? provider(context) : provider;
}

export async function runEvalCase(args: RunEvalCaseArgs): Promise<EvalCaseRecord> {
  const runTurn = args.runTurn ?? runOwnerAssistantTurn;
  const record: EvalCaseRecord = {
    caseId: args.evalCase.id,
    group: args.evalCase.group,
    title: args.evalCase.title,
    salonSlug: args.salon.slug,
    passed: true,
    turns: [],
    failures: [],
  };

  let conversationToken: string | undefined;
  /** Every tool result of this conversation — what grounding is scored against. */
  const conversationToolResults: unknown[] = [];
  const ownerMessages: string[] = [];

  for (const [index, expectation] of args.evalCase.turns.entries()) {
    const observation: TurnObservation = { modelCalls: 0, usage: emptyUsage(), toolCalls: [] };
    const provider = instrumentProvider(
      resolveProvider(args.provider, {
        caseId: args.evalCase.id,
        turnIndex: index,
        message: expectation.message,
      }),
      observation,
    );

    ownerMessages.push(expectation.message);
    const startedAt = Date.now();
    let response: ChatTurnResponse;
    try {
      response = await runTurn({
        salon: args.salon,
        admin: args.admin,
        message: expectation.message,
        conversationToken,
        locale: args.locale,
        provider,
        now: args.now,
        database: args.database,
      });
    } catch (error) {
      record.passed = false;
      record.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      record.failures.push(`turn ${index + 1} threw (${record.error})`);
      return record;
    }
    const latencyMs = Date.now() - startedAt;

    for (const call of observation.toolCalls) {
      if (call.ok && call.result !== undefined) {
        conversationToolResults.push(call.result);
      }
    }

    // Both branches of `ChatTurnResponse` carry the owner-facing sentence.
    const answer = response.message;
    const grounding = checkGrounding({
      answer,
      toolResults: conversationToolResults,
      ownerMessages,
    });
    const { costMicros, priceKnown } = computeUsageCostMicros(args.model, observation.usage);

    const turnRecord: EvalTurnRecord = {
      index,
      message: expectation.message,
      expectedTools: [...expectation.expectTools],
      outcomeKind: response.kind,
      ...(response.kind === 'unavailable' ? { unavailableReason: response.reason } : {}),
      answer,
      checked: response.kind === 'answer' ? response.checked.map(item => item.tool) : [],
      links: response.kind === 'answer' ? response.links : [],
      followUps: response.kind === 'answer' ? response.followUps : [],
      needsClarification: response.kind === 'answer' ? response.needsClarification : false,
      toolCalls: observation.toolCalls,
      modelCalls: observation.modelCalls,
      usage: observation.usage,
      latencyMs,
      costMicros,
      priceKnown,
      grounding,
      failures: [],
    };

    turnRecord.failures = checkTurnExpectations(expectation, turnRecord, args.checks);
    record.turns.push(turnRecord);

    if (turnRecord.failures.length > 0) {
      record.passed = false;
      for (const failure of turnRecord.failures) {
        record.failures.push(`turn ${index + 1}: ${failure}`);
      }
    }

    if (response.kind === 'answer') {
      conversationToken = response.conversation;
    } else if (response.conversation) {
      conversationToken = response.conversation;
    }
  }

  return record;
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

function matchesPartially(actual: unknown, expected: Readonly<Record<string, unknown>>): boolean {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    return false;
  }
  const record = actual as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => {
    const candidate = record[key];
    return typeof candidate === 'string' && typeof value === 'string'
      ? candidate.toLowerCase() === value.toLowerCase()
      : candidate === value;
  });
}

export function checkTurnExpectations(
  expectation: EvalTurnExpectation,
  record: EvalTurnRecord,
  options: EvalCheckOptions,
): string[] {
  const failures: string[] = [];

  if (record.outcomeKind !== expectation.expectOutcome) {
    failures.push(`outcome ${record.outcomeKind} (expected ${expectation.expectOutcome})`);
  }
  if (
    expectation.expectUnavailableReason !== undefined
    && record.unavailableReason !== expectation.expectUnavailableReason
  ) {
    failures.push(`unavailable reason ${record.unavailableReason ?? 'none'} (expected ${expectation.expectUnavailableReason})`);
  }

  const executed = record.toolCalls.filter(call => call.executed && call.ok).map(call => call.name);
  const executedSet = new Set(executed);
  const allowed = new Set<string>([
    ...expectation.expectTools,
    ...(expectation.optionalTools ?? []),
  ]);

  for (const required of expectation.expectTools) {
    if (!executedSet.has(required)) {
      failures.push(`tool ${required} did not run (ran: ${executed.join(', ') || 'none'})`);
    }
  }
  for (const actual of executedSet) {
    if (!allowed.has(actual)) {
      failures.push(`unexpected tool ${actual}`);
    }
  }
  for (const forbidden of expectation.forbidTools ?? []) {
    if (executedSet.has(forbidden)) {
      failures.push(`forbidden tool ${forbidden} ran`);
    }
  }

  for (const [toolName, expectedArguments] of Object.entries(expectation.expectToolArguments ?? {})) {
    const matched = record.toolCalls.some(
      call => call.name === toolName && call.executed && matchesPartially(call.args, expectedArguments),
    );
    if (!matched) {
      failures.push(`${toolName} was not called with ${JSON.stringify(expectedArguments)}`);
    }
  }

  const linkKeys = record.links.map(link => link.key);
  if (expectation.allowLinks) {
    const allowedLinks = new Set(expectation.allowLinks);
    for (const key of linkKeys) {
      if (!allowedLinks.has(key)) {
        failures.push(`link ${key} is not in the allowed set`);
      }
    }
  }
  for (const required of expectation.requireLinks ?? []) {
    if (!linkKeys.includes(required)) {
      failures.push(`link ${required} is missing (rendered: ${linkKeys.join(', ') || 'none'})`);
    }
  }

  if (
    expectation.expectNeedsClarification !== undefined
    && record.needsClarification !== expectation.expectNeedsClarification
  ) {
    failures.push(`needsClarification ${record.needsClarification} (expected ${expectation.expectNeedsClarification})`);
  }

  if (options.checkAnswerText) {
    const haystack = record.answer.toLowerCase();
    for (const fragment of expectation.mustMention ?? []) {
      if (!haystack.includes(fragment.toLowerCase())) {
        failures.push(`answer does not mention "${fragment}"`);
      }
    }
    for (const fragment of expectation.mustNotMention ?? []) {
      if (haystack.includes(fragment.toLowerCase())) {
        failures.push(`answer must not mention "${fragment}"`);
      }
    }
  }

  if (options.scoreGrounding && expectation.scoreGrounding !== false && !record.grounding.ok) {
    const listed = record.grounding.unsupported
      .map(fact => `${fact.kind}:${fact.value}`)
      .join(', ');
    failures.push(`unsupported facts (${listed})`);
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Aggregation (the report's summary half)
// ---------------------------------------------------------------------------

export type EvalAggregate = {
  cases: number;
  passed: number;
  turns: number;
  passRateByGroup: Record<string, { cases: number; passed: number; rate: number }>;
  latencyP50Ms: number;
  latencyP95Ms: number;
  meanCostMicrosPerTurn: number;
  medianCostMicrosPerTurn: number;
  totalCostMicros: number;
  groundedTurns: number;
  unsupportedFactCount: number;
};

/** Nearest-rank percentile; deterministic and defined for a single sample. */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index] ?? 0;
}

export function aggregate(records: readonly EvalCaseRecord[]): EvalAggregate {
  const turns = records.flatMap(record => record.turns);
  const latencies = turns.map(turn => turn.latencyMs).sort((a, b) => a - b);
  const costs = turns.map(turn => turn.costMicros).sort((a, b) => a - b);
  const passRateByGroup: EvalAggregate['passRateByGroup'] = {};

  for (const record of records) {
    const bucket = passRateByGroup[record.group] ?? { cases: 0, passed: 0, rate: 0 };
    bucket.cases += 1;
    bucket.passed += record.passed ? 1 : 0;
    bucket.rate = bucket.cases === 0 ? 0 : bucket.passed / bucket.cases;
    passRateByGroup[record.group] = bucket;
  }

  const totalCostMicros = costs.reduce((total, value) => total + value, 0);

  return {
    cases: records.length,
    passed: records.filter(record => record.passed).length,
    turns: turns.length,
    passRateByGroup,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    meanCostMicrosPerTurn: turns.length === 0 ? 0 : Math.round(totalCostMicros / turns.length),
    medianCostMicrosPerTurn: percentile(costs, 0.5),
    totalCostMicros,
    groundedTurns: turns.filter(turn => turn.grounding.ok).length,
    unsupportedFactCount: turns.reduce((total, turn) => total + turn.grounding.unsupported.length, 0),
  };
}
