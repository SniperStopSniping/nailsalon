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
  outputCount: number;
  latencyMs: number;
};

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
    // Cached input is billed at the cached rate; the uncached remainder at the
    // full rate. A provider that reports more cached than input tokens must
    // not produce a negative charge.
    const cached = Math.min(Math.max(call.cachedInputCount, 0), Math.max(call.inputCount, 0));
    const uncached = Math.max(call.inputCount, 0) - cached;
    return total
      + (uncached * price.input)
      + (cached * price.cachedInput)
      + (Math.max(call.outputCount, 0) * price.output);
  }, 0);

  return { costMicros: Math.round(micros / 1_000_000), priceKnown: true };
}

/**
 * sha256 over the FIXED prompt prefix plus the salon frame. Identifies which
 * prompt revision and which salon shape produced a turn, and contains no owner
 * text by construction.
 */
export function computePromptFingerprint(salonFrameText: string): string {
  return createHash('sha256')
    .update(OWNER_ASSISTANT_SYSTEM_TEXT)
    .update('\n')
    .update(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
    .update('\n')
    .update(salonFrameText)
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
        promptFingerprint: computePromptFingerprint(args.salonFrameText),
      },
    },
  });
}
