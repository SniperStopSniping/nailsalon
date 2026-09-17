import 'server-only';

import { createOpenAiResponsesProvider } from '@/libs/ai/openaiResponses.server';
import {
  ModelProviderError,
  type ModelProviderInputItem,
  type ModelProviderItem,
  type ModelProviderRequest,
  type ModelProviderTool,
  type OwnerAssistantModelProvider,
} from '@/libs/ai/provider';
import type { SalonAuditLogDatabase } from '@/libs/salonAuditLog.server';

import { reserveTurn } from './budget.server';
import {
  ASSISTANT_ANSWER_JSON_SCHEMA,
  type AssistantAnswer,
  assistantAnswerSchema,
  CHAT_UNAVAILABLE_MESSAGES,
  type ChatChecked,
  type ChatLink,
  type ChatTurnResponse,
  type ChatUnavailableReason,
  type ConversationPayload,
  OWNER_ASSISTANT_LIMITS,
  OWNER_ASSISTANT_TOOL_DEFINITIONS,
  OWNER_ASSISTANT_TOOL_LABELS,
  type OwnerAssistantToolName,
} from './contracts';
import { appendTurns, createConversation, renewExpiry, signConversation, verifyConversation } from './conversation.server';
import {
  getEnabledToolNames,
  getJsonMode,
  getModelId,
  getOwnerAssistantApiKey,
  getOwnerAssistantAvailability,
  getReasoningEffort,
} from './enablement.server';
import { type ExecutionNow, monotonicNowMs } from './executionClock';
import { type LedgerModelCall, type LedgerToolCall, recordOwnerAssistantTurn } from './ledger.server';
import {
  buildJsonModeInstruction,
  buildSalonFrame,
  OWNER_ASSISTANT_DEVELOPER_RULES_TEXT,
  OWNER_ASSISTANT_LAST_CALL_TEXT,
  OWNER_ASSISTANT_SYSTEM_TEXT,
} from './prompt';
import { buildRegistryHref, getRegistryEntry, isRegistryKey } from './registry';
import { getSalonOverview } from './tools/getSalonOverview.server';
import { executeOwnerAssistantTool } from './tools/index.server';

/**
 * One owner-assistant turn (docs/OWNER_ASSISTANT_CHAT.md §4, steps 4–12).
 *
 * Contract with the route: this NEVER throws for a provider, budget, tool or
 * model problem — every one of those is a `ChatTurnResponse` of kind
 * 'unavailable' with HTTP 200, because the owner needs an honest sentence, not
 * an error page. The single exception is `ConversationInvalidError`, which the
 * route turns into 409 so the client can start a fresh conversation.
 */

export type OwnerAssistantSalon = {
  id: string;
  slug: string;
  name: string;
};

export type OwnerAssistantAdmin = {
  /** Stable admin user id — what the conversation token is bound to. */
  id: string;
  /** Clerk user id for the ledger's `performedBy`. */
  clerkUserId?: string | null;
};

export type RunOwnerAssistantTurnArgs = {
  salon: OwnerAssistantSalon;
  admin: OwnerAssistantAdmin;
  message: string;
  conversationToken?: string;
  locale?: string;
  provider?: OwnerAssistantModelProvider;
  /** Monotonic execution clock; injectable only for deterministic timeout tests. */
  executionNow?: ExecutionNow;
  /** Business/scenario time used for salon dates, budgets and conversation expiry. */
  now?: Date;
  database?: SalonAuditLogDatabase;
};

const TOOL_DEFINITIONS = OWNER_ASSISTANT_TOOL_DEFINITIONS as unknown as readonly ModelProviderTool[];

function unavailable(reason: ChatUnavailableReason, conversation?: string): ChatTurnResponse {
  return {
    kind: 'unavailable',
    reason,
    message: CHAT_UNAVAILABLE_MESSAGES[reason],
    ...(conversation ? { conversation } : {}),
  };
}

/**
 * `prompt` JSON mode can come back inside a markdown fence. Stripped by index
 * rather than by regex: a fence pattern over arbitrary model output is a
 * backtracking hazard, and the shape here is fully positional.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```') || !trimmed.endsWith('```') || trimmed.length < 6) {
    return trimmed;
  }
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline < 0) {
    return trimmed;
  }
  return trimmed.slice(firstNewline + 1, trimmed.length - 3).trim();
}

/**
 * The provider's schema is a superset of ours (no array/length caps), so a
 * grammar-valid answer with a fourth follow-up or an overlong message is
 * TRIMMED to the contract instead of rejected — rejecting would burn the turn
 * and the budget unit over a cosmetic overflow. An empty message still fails.
 */
function trimToContract(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return candidate;
  }
  const value = { ...(candidate as Record<string, unknown>) };
  if (typeof value.message === 'string') {
    value.message = value.message.trim().slice(0, 2000);
  }
  if (Array.isArray(value.links)) {
    value.links = value.links.slice(0, 4);
  }
  if (Array.isArray(value.followUps)) {
    value.followUps = value.followUps
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim().slice(0, 120))
      .filter(item => item.length > 0)
      .slice(0, 3);
  }
  return value;
}

function parseAnswer(text: string, jsonMode: 'schema' | 'prompt'): AssistantAnswer | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(jsonMode === 'prompt' ? stripCodeFences(text) : text);
  } catch {
    return null;
  }
  const parsed = assistantAnswerSchema.safeParse(trimToContract(candidate));
  return parsed.success ? parsed.data : null;
}

/** Registry keys only, deduplicated, with the registry's own label and href. */
function buildLinks(
  answer: AssistantAnswer,
  args: { locale: string; salonSlug: string },
): ChatLink[] {
  const seen = new Set<string>();
  const links: ChatLink[] = [];

  for (const candidate of answer.links) {
    if (seen.has(candidate.key) || !isRegistryKey(candidate.key)) {
      continue;
    }
    const entry = getRegistryEntry(candidate.key);
    const href = entry ? buildRegistryHref(entry, args) : null;
    if (!entry || !href) {
      continue;
    }
    seen.add(candidate.key);
    links.push({ key: entry.key, label: entry.label, href });
  }

  return links;
}

function buildChecked(toolCalls: readonly LedgerToolCall[]): ChatChecked[] {
  const seen = new Set<string>();
  const checked: ChatChecked[] = [];

  for (const call of toolCalls) {
    if (!call.ok || seen.has(call.name)) {
      continue;
    }
    const label = OWNER_ASSISTANT_TOOL_LABELS[call.name as OwnerAssistantToolName];
    if (!label) {
      continue;
    }
    seen.add(call.name);
    checked.push({ tool: call.name as OwnerAssistantToolName, label });
  }

  return checked;
}

function buildInput(args: {
  salonFrame: string;
  jsonMode: 'schema' | 'prompt';
  windowTurns: ConversationPayload['turns'];
  message: string;
}): ModelProviderInputItem[] {
  const developerRules = args.jsonMode === 'prompt'
    ? `${OWNER_ASSISTANT_DEVELOPER_RULES_TEXT}\n${buildJsonModeInstruction(ASSISTANT_ANSWER_JSON_SCHEMA as unknown as Record<string, unknown>)}`
    : OWNER_ASSISTANT_DEVELOPER_RULES_TEXT;

  return [
    { role: 'system', content: OWNER_ASSISTANT_SYSTEM_TEXT },
    { role: 'developer', content: developerRules },
    { role: 'developer', content: args.salonFrame },
    ...args.windowTurns.map(turn => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: args.message },
  ];
}

export async function runOwnerAssistantTurn(
  args: RunOwnerAssistantTurnArgs,
): Promise<ChatTurnResponse> {
  const now = args.now ?? new Date();
  const executionNow = args.executionNow ?? monotonicNowMs;
  const deadline = executionNow() + OWNER_ASSISTANT_LIMITS.turnTimeoutMs;
  const locale = args.locale === 'fr' ? 'fr' : 'en';

  // 4 — availability (key, signing secret, redis client).
  const availability = getOwnerAssistantAvailability();
  if (!availability.available) {
    return unavailable(availability.reason, args.conversationToken);
  }

  // 5 — conversation: verify (throws ConversationInvalidError → route 409) or start fresh.
  const conversation = args.conversationToken
    ? verifyConversation(args.conversationToken, {
      salonId: args.salon.id,
      adminId: args.admin.id,
      now,
    })
    : createConversation({ salonId: args.salon.id, adminId: args.admin.id, now });

  const performedBy = args.admin.clerkUserId ?? args.admin.id;
  const model = getModelId();
  const jsonMode = getJsonMode();
  const reasoningEffort = getReasoningEffort();
  const enabledTools = getEnabledToolNames();
  const modelCalls: LedgerModelCall[] = [];
  const toolCalls: LedgerToolCall[] = [];

  let promptExtras = '';
  const ledger = async (outcome: string, salonFrame: string) => {
    try {
      await recordOwnerAssistantTurn({
        salonId: args.salon.id,
        performedBy,
        conversationId: conversation.cid,
        turnIndex: conversation.turnCount,
        model,
        outcome,
        modelCalls,
        toolCalls,
        salonFrameText: salonFrame,
        promptExtras,
        database: args.database,
      });
    } catch {
      // Evidence is important but it is not the owner's problem: a failed
      // ledger write must not turn a good answer into an error.
    }
  };

  // 6 — reserve the turn BEFORE any provider call.
  const reservation = await reserveTurn({ salonId: args.salon.id, now });
  if (!reservation.ok) {
    if (reservation.reason === 'redis_unavailable') {
      // Evidence even here: the reservation may have been counted by a Redis
      // that answered after our 1 s timeout, so the row shows the attempt.
      await ledger('redis_unavailable', '');
      return unavailable('redis_unavailable', args.conversationToken);
    }
    await ledger('budget_exhausted', '');
    return unavailable('budget_exhausted', args.conversationToken);
  }

  // 7 — build the input. The salon frame is Tier-0 and also feeds the ledger
  // fingerprint, so it is built once and reused.
  let salonFrame = '';
  try {
    const overview = await getSalonOverview(args.salon.id, { now });
    salonFrame = buildSalonFrame(overview, enabledTools);
  } catch {
    // A salon we cannot even frame is still answerable in principle; fall back
    // to the identity the session already proved.
    salonFrame = buildSalonFrame({
      salonName: args.salon.name,
      salonSlug: args.salon.slug,
      timezone: 'unknown',
      today: 'unknown',
      businessMode: null,
      technicianCount: 0,
    }, enabledTools);
  }

  const input = buildInput({
    salonFrame,
    jsonMode,
    windowTurns: conversation.turns,
    message: args.message,
  });

  const provider = args.provider
    ?? createOpenAiResponsesProvider({ apiKey: getOwnerAssistantApiKey() ?? '' });
  const tools = TOOL_DEFINITIONS.filter(tool => enabledTools.includes(tool.name as OwnerAssistantToolName));
  promptExtras = `${JSON.stringify(tools)}\n${jsonMode}\n${reasoningEffort}`;

  // `ledgerOutcome` lets the durable row say WHY an owner-facing reason
  // happened (a truncated response vs malformed JSON vs a refusal) without
  // widening the owner-facing vocabulary.
  const finish = async (reason: ChatUnavailableReason, ledgerOutcome: string = reason): Promise<ChatTurnResponse> => {
    await ledger(ledgerOutcome, salonFrame);
    return unavailable(reason, args.conversationToken);
  };

  // 8 — bounded model/tool loop.
  let answer: AssistantAnswer | null = null;
  let executedToolCalls = 0;

  for (let call = 1; call <= OWNER_ASSISTANT_LIMITS.modelCallsPerTurn; call++) {
    if (executionNow() >= deadline) {
      return finish('turn_timeout');
    }

    const isLastCall = call === OWNER_ASSISTANT_LIMITS.modelCallsPerTurn;
    if (isLastCall) {
      input.push({ role: 'developer', content: OWNER_ASSISTANT_LAST_CALL_TEXT });
    }

    const request: ModelProviderRequest = {
      model,
      input: [...input],
      tools,
      // On the last call the model is told to answer; withholding tools makes
      // that structural rather than a matter of obedience.
      toolChoice: isLastCall ? 'none' : 'auto',
      reasoningEffort,
      maxOutputTokens: OWNER_ASSISTANT_LIMITS.maxOutputTokens,
      timeoutMs: Math.max(1, Math.min(OWNER_ASSISTANT_LIMITS.modelCallTimeoutMs, deadline - executionNow())),
      jsonMode,
      ...(jsonMode === 'schema'
        ? { jsonSchema: ASSISTANT_ANSWER_JSON_SCHEMA as unknown as Record<string, unknown> }
        : {}),
    };

    const startedAt = executionNow();
    let response;
    try {
      response = await provider.createResponse(request);
    } catch (error) {
      modelCalls.push({
        index: call,
        inputCount: 0,
        cachedInputCount: 0,
        cacheWriteInputCount: 0,
        outputCount: 0,
        latencyMs: executionNow() - startedAt,
      });
      const kind = error instanceof ModelProviderError ? error.kind : 'provider_error';
      // The per-call timeout is clamped to whatever is left of the whole-turn
      // deadline, so a call that aborts AT the deadline was cut short by the
      // turn, not by the provider. Report it as what it is.
      return finish(kind === 'provider_timeout' && executionNow() >= deadline ? 'turn_timeout' : kind);
    }

    modelCalls.push({
      index: call,
      inputCount: response.usage.inputTokens,
      cachedInputCount: response.usage.cachedInputTokens,
      cacheWriteInputCount: response.usage.cacheWriteInputTokens ?? 0,
      outputCount: response.usage.outputTokens,
      latencyMs: executionNow() - startedAt,
    });

    if (response.status === 'failed') {
      return finish('provider_error');
    }
    if (response.status === 'incomplete') {
      return finish('model_output_invalid', `model_output_incomplete:${response.incompleteReason ?? 'unknown'}`);
    }
    if (response.items.some(item => item.type === 'refusal')) {
      return finish('model_output_invalid', 'model_refusal');
    }

    const functionCalls = response.items.filter(
      (item): item is Extract<ModelProviderItem, { type: 'function_call' }> => item.type === 'function_call',
    );

    if (functionCalls.length === 0) {
      const messageItem = response.items.find(
        (item): item is Extract<ModelProviderItem, { type: 'message' }> => item.type === 'message',
      );
      if (!messageItem) {
        return finish('model_output_invalid');
      }
      answer = parseAnswer(messageItem.text, jsonMode);
      if (!answer) {
        return finish('model_output_invalid');
      }
      break;
    }

    // The model asked for tools on its last allowed call: there is no round
    // trip left to give it, so the turn ends honestly rather than silently.
    if (isLastCall) {
      return finish('model_output_invalid', 'model_tool_call_on_last_call');
    }

    // Walk the response in ORDER: reasoning items are echoed back verbatim
    // ahead of the function calls they produced (required when tools are used
    // statelessly), and every function call the model made gets exactly one
    // output — executed, or refused with a code once the per-turn cap is hit,
    // so the model learns why instead of re-requesting silently.
    for (const item of response.items) {
      if (item.type === 'passthrough') {
        input.push(item.raw as ModelProviderInputItem);
        continue;
      }
      if (item.type !== 'function_call') {
        continue;
      }
      const functionCall = item;

      if (executedToolCalls >= OWNER_ASSISTANT_LIMITS.toolCallsPerTurn) {
        toolCalls.push({ name: functionCall.name, ok: false, durationMs: 0, errorCode: 'tool_budget_exhausted' });
        input.push(functionCall.raw as ModelProviderInputItem);
        input.push({
          type: 'function_call_output',
          call_id: functionCall.callId,
          output: JSON.stringify({ error: { code: 'tool_budget_exhausted' } }),
        });
        continue;
      }
      executedToolCalls += 1;

      const toolStartedAt = executionNow();
      const outcome = await executeOwnerAssistantTool({
        name: functionCall.name,
        argumentsJson: functionCall.argumentsJson,
        salonId: args.salon.id,
        enabledTools,
        now,
      });
      const durationMs = executionNow() - toolStartedAt;

      toolCalls.push(
        outcome.ok
          ? { name: functionCall.name, ok: true, durationMs }
          : { name: functionCall.name, ok: false, durationMs, errorCode: outcome.error.code },
      );

      input.push(functionCall.raw as ModelProviderInputItem);
      input.push({
        type: 'function_call_output',
        call_id: functionCall.callId,
        output: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }),
      });
    }
  }

  if (!answer) {
    return finish('model_output_invalid');
  }

  // 9/10 — links filtered through the registry; checked from successful tools.
  const links = buildLinks(answer, { locale, salonSlug: args.salon.slug });
  const checked = buildChecked(toolCalls);

  // 11 — ledger.
  await ledger('answer', salonFrame);

  // 12 — append, truncate, renew, sign.
  const nextConversation = renewExpiry(
    {
      ...appendTurns(conversation, [
        { role: 'user', content: args.message },
        {
          role: 'assistant',
          content: answer.message,
          ...(checked.length > 0 ? { checked: checked.map(item => item.tool) } : {}),
        },
      ]),
      turnCount: conversation.turnCount + 1,
    },
    now,
  );

  return {
    kind: 'answer',
    message: answer.message,
    checked,
    links,
    followUps: answer.followUps,
    needsClarification: answer.needsClarification,
    conversation: signConversation(nextConversation),
    usage: { modelCalls: modelCalls.length, toolCalls: executedToolCalls },
  };
}
