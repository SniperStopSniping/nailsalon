import 'server-only';

import { createHash } from 'node:crypto';

import { db } from '@/libs/DB';
import { type SalonAuditLogDatabase, writeSalonAuditRow } from '@/libs/salonAuditLog.server';

import { OWNER_ASSISTANT_MODEL_PRICES_MICROS_PER_MILLION } from './contracts';
import { OWNER_ASSISTANT_DEVELOPER_RULES_TEXT, OWNER_ASSISTANT_SYSTEM_TEXT } from './prompt';

/**
 * Durable spend and tool evidence (docs/OWNER_ASSISTANT_CHAT.md §6, decision A-2).
 *
 * ONE `salon_audit_log` row per turn, written through `writeSalonAuditRow` so
 * `sanitizeAuditMetadata` always runs. The row carries counts, codes and
 * durations — never the owner's words, the model's words, or any tool result
 * content.
 *
 * Key naming is load-bearing: the sanitiser redacts any key whose name
 * contains `token`, `session`, `url`, `uri`, `link`, `secret`, `cookie`,
 * `credential`, `authorization`, `password` or `passcode`. Token counts are
 * therefore `inputCount` / `cachedInputCount` / `outputCount`, and timings are
 * `latencyMs` / `durationMs`. A test pins this.
 */

export const OWNER_ASSISTANT_AUDIT_ACTION = 'owner_assistant_turn';

export type LedgerModelCall = {
  index: number;
  inputCount: number;
  cachedInputCount: number;
  /** Prefix tokens written to the prompt cache (billed at 1.25× the input rate). */
  cacheWriteInputCount: number;
  outputCount: number;
  latencyMs: number;
};

/** GPT-5.6+ prompt-cache writes are billed at 1.25× the uncached input rate. */
export const CACHE_WRITE_MULTIPLIER = 1.25;

export type LedgerToolCall = {
  name: string;
  ok: boolean;
  durationMs: number;
  errorCode?: string;
};

export type RecordOwnerAssistantTurnArgs = {
  salonId: string;
  /** Clerk user id of the owner who took the turn. */
  performedBy: string;
  conversationId: string;
  turnIndex: number;
  model: string;
  /** `answer` or the unavailable reason that ended the turn. */
  outcome: string;
  modelCalls: LedgerModelCall[];
  toolCalls: LedgerToolCall[];
  /** The dynamic salon frame; hashed with the fixed prefix, never stored. */
  salonFrameText: string;
  /** Tool definitions and any mode-specific instruction that shaped the prompt; hashed, never stored. */
  promptExtras?: string;
  database?: SalonAuditLogDatabase;
};

export function computeCostMicros(
  model: string,
  modelCalls: readonly LedgerModelCall[],
): { costMicros: number; priceKnown: boolean } {
  const price = OWNER_ASSISTANT_MODEL_PRICES_MICROS_PER_MILLION[model];
  if (!price) {
    return { costMicros: 0, priceKnown: false };
  }

  const micros = modelCalls.reduce((total, call) => {
    // Cached input is billed at the cached rate, cache WRITES at 1.25× the
    // input rate, and the remainder at the full rate. A provider that reports
    // more cached/written than input tokens must not produce a negative charge.
    const input = Math.max(call.inputCount, 0);
    const cached = Math.min(Math.max(call.cachedInputCount, 0), input);
    const cacheWrite = Math.min(Math.max(call.cacheWriteInputCount ?? 0, 0), input - cached);
    const uncached = input - cached - cacheWrite;
    return total
      + (uncached * price.input)
      + (cached * price.cachedInput)
      + (cacheWrite * price.input * CACHE_WRITE_MULTIPLIER)
      + (Math.max(call.outputCount, 0) * price.output);
  }, 0);

  return { costMicros: Math.round(micros / 1_000_000), priceKnown: true };
}

/**
 * sha256 over the FIXED prompt prefix plus the salon frame. Identifies which
 * prompt revision and which salon shape produced a turn, and contains no owner
 * text by construction.
 */
export function computePromptFingerprint(salonFrameText: string, promptExtras = ''): string {
  return createHash('sha256')
    .update(OWNER_ASSISTANT_SYSTEM_TEXT)
    .update('\n')
    .update(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
    .update('\n')
    .update(salonFrameText)
    .update('\n')
    .update(promptExtras)
    .digest('hex');
}

export async function recordOwnerAssistantTurn(args: RecordOwnerAssistantTurnArgs): Promise<void> {
  const { costMicros, priceKnown } = computeCostMicros(args.model, args.modelCalls);

  await writeSalonAuditRow(args.database ?? db, {
    salonId: args.salonId,
    action: OWNER_ASSISTANT_AUDIT_ACTION,
    performedBy: args.performedBy,
    performedByEmail: null,
    metadata: {
      field: 'owner_assistant',
      details: 'Owner assistant turn',
      newValue: {
        conversationId: args.conversationId,
        turnIndex: args.turnIndex,
        model: args.model,
        outcome: args.outcome,
        modelCalls: args.modelCalls,
        toolCalls: args.toolCalls,
        costMicros,
        priceKnown,
        promptFingerprint: computePromptFingerprint(args.salonFrameText, args.promptExtras),
      },
    },
  });
}
