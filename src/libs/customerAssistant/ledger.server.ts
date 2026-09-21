import 'server-only';

import type { ModelProviderUsage } from '@/libs/ai/provider';
import { db } from '@/libs/DB';
import { writeSalonAuditRow } from '@/libs/salonAuditLog.server';

import { CUSTOMER_ASSISTANT_MODEL } from './contracts';
import { CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD, customerAssistantModelUsageCostMicros, type CustomerAssistantStageUsage, customerAssistantStageUsageCostMicros } from './modelPricing';

/** Backward-compatible Luna-only helper for existing isolated callers. */
export function customerUsageCostMicros(usage: ModelProviderUsage | null): number | null {
  return customerAssistantModelUsageCostMicros('gpt-5.6-luna', usage);
}

/** Separate action namespace; no prompts, contact, tokens or model prose. */
export async function recordCustomerAssistantUsage(args: {
  salonId: string;
  attemptId: string;
  outcome: 'answer' | 'reserved' | 'proposal' | 'clarification' | 'availability' | 'slot_selected' | 'review_prepared' | 'no_match' | 'failed';
  usage: ModelProviderUsage | null;
  /** Each invoked model stage is recorded with its actual model and usage. */
  stageUsages?: readonly CustomerAssistantStageUsage[];
  latencyMs: number;
  timings?: Record<string, number>;
  deterministic?: boolean;
}): Promise<void> {
  const stages = args.deterministic
    ? []
    : args.stageUsages ?? (args.usage ? [{ stage: 'composer' as const, model: CUSTOMER_ASSISTANT_MODEL, usage: args.usage }] : []);
  const stageEvidenceKnown = args.deterministic || args.stageUsages !== undefined || args.usage !== null;
  const costMicros = args.deterministic
    ? 0
    : stageEvidenceKnown
      ? customerAssistantStageUsageCostMicros(stages)
      : null;
  await writeSalonAuditRow(db, {
    salonId: args.salonId,
    action: 'customer_assistant_turn',
    performedBy: 'anonymous_customer_assistant',
    performedByEmail: null,
    metadata: {
      field: 'customer_assistant',
      details: 'Customer assistant model usage',
      newValue: {
        attemptId: args.attemptId,
        outcome: args.outcome,
        // A two-stage turn has no single truthful model attribution.
        model: stages.length === 1 ? stages[0]!.model : null,
        providerCall: args.deterministic ? false : stageEvidenceKnown ? stages.length > 0 : null,
        inputCount: args.usage?.inputTokens ?? null,
        cachedInputCount: args.usage?.cachedInputTokens ?? null,
        cacheWriteInputCount: args.usage?.cacheWriteInputTokens ?? null,
        outputCount: args.usage?.outputTokens ?? null,
        costMicros,
        stages: stages.map(stage => ({
          stage: stage.stage,
          model: stage.model,
          inputCount: stage.usage?.inputTokens ?? null,
          cachedInputCount: stage.usage?.cachedInputTokens ?? null,
          cacheWriteInputCount: stage.usage?.cacheWriteInputTokens ?? null,
          outputCount: stage.usage?.outputTokens ?? null,
          costMicros: customerAssistantModelUsageCostMicros(stage.model, stage.usage),
        })),
        reservedCostMicros: args.outcome === 'reserved' ? CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD : 0,
        latencyMs: Math.round(args.latencyMs),
        ...(args.timings ? { timings: args.timings } : {}),
      },
    },
  });
}
