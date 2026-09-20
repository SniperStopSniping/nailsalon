import type { ModelProviderUsage } from '@/libs/ai/provider';

import type { CustomerAssistantModelStage } from './contracts';
import { CUSTOMER_ASSISTANT_MAX_INPUT_BYTES, CUSTOMER_ASSISTANT_MAX_OUTPUT_TOKENS } from './contracts';
import { CUSTOMER_INTERPRETATION_JSON_SCHEMA } from './interpretation';

export type CustomerAssistantModel = 'gpt-5.6-terra' | 'gpt-5.6-luna';
export type CustomerAssistantStageUsage = {
  stage: CustomerAssistantModelStage;
  model: CustomerAssistantModel;
  usage: ModelProviderUsage | null;
};

type ModelRate = { input: number; cachedInput: number; cacheWriteInput: number; output: number };

/** USD micros (microdollars) per token, derived from the approved per-million public rates. */
const MODEL_RATES: Record<CustomerAssistantModel, ModelRate> = {
  // Terra: $2 input, $.20 cached input, $2.50 cache write, $12 output / 1M.
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, cacheWriteInput: 2.5, output: 12 },
  // Luna: $.20 input, $.02 cached input, $.25 cache write, $1.20 output / 1M.
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, cacheWriteInput: 0.25, output: 1.2 },
};

const INTERPRETATION_FRAMING_BYTES = 4_096;
const COMPOSER_MAX_INPUT_BYTES = 24_000;
const COMPOSER_FRAMING_BYTES = 4_096;
const COMPOSER_MAX_OUTPUT_TOKENS = 800;
/** Actual strict-schema serialization used in the conservative reservation. */
export const CUSTOMER_ASSISTANT_INTERPRETATION_SCHEMA_BYTES = Buffer.byteLength(JSON.stringify(CUSTOMER_INTERPRETATION_JSON_SCHEMA), 'utf8');
export const CUSTOMER_ASSISTANT_TURN_COST_UPPER_BOUND_MICRO_USD = Math.ceil(
  (CUSTOMER_ASSISTANT_MAX_INPUT_BYTES + CUSTOMER_ASSISTANT_INTERPRETATION_SCHEMA_BYTES + INTERPRETATION_FRAMING_BYTES) * MODEL_RATES['gpt-5.6-terra'].cacheWriteInput
  + CUSTOMER_ASSISTANT_MAX_OUTPUT_TOKENS * MODEL_RATES['gpt-5.6-terra'].output
  + (COMPOSER_MAX_INPUT_BYTES + COMPOSER_FRAMING_BYTES) * MODEL_RATES['gpt-5.6-luna'].cacheWriteInput
  + COMPOSER_MAX_OUTPUT_TOKENS * MODEL_RATES['gpt-5.6-luna'].output,
);
/** Rounded headroom above the derived two-stage maximum. */
export const CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD = 150_000;

export function customerAssistantModelUsageCostMicros(model: CustomerAssistantModel, usage: ModelProviderUsage | null): number | null {
  if (!usage) {
    return null;
  }
  const written = usage.cacheWriteInputTokens ?? 0;
  const uncached = usage.inputTokens - usage.cachedInputTokens - written;
  if (uncached < 0 || Object.values(usage).some(value => !Number.isSafeInteger(value) || value < 0)) {
    return null;
  }
  const rate = MODEL_RATES[model];
  const cost = Math.ceil(uncached * rate.input + usage.cachedInputTokens * rate.cachedInput + written * rate.cacheWriteInput + usage.outputTokens * rate.output);
  return Number.isSafeInteger(cost) && cost >= 0 ? cost : null;
}

/** Unknown usage from any invoked stage makes the whole turn's cost unknown. */
export function customerAssistantStageUsageCostMicros(stages: readonly CustomerAssistantStageUsage[]): number | null {
  if (stages.length === 0) {
    return 0;
  }
  let total = 0;
  for (const stage of stages) {
    const cost = customerAssistantModelUsageCostMicros(stage.model, stage.usage);
    if (cost === null) {
      return null;
    }
    total += cost;
  }
  return Number.isSafeInteger(total) ? total : null;
}

/** Aggregates token evidence only when every invoked stage supplied it. */
export function aggregateCustomerAssistantStageUsage(stages: readonly CustomerAssistantStageUsage[]): ModelProviderUsage | null {
  if (stages.length === 0 || stages.some(stage => stage.usage === null)) {
    return null;
  }
  if (stages.some(stage => customerAssistantModelUsageCostMicros(stage.model, stage.usage) === null)) {
    return null;
  }
  const aggregate = stages.reduce<ModelProviderUsage>((total, stage) => ({
    inputTokens: total.inputTokens + stage.usage!.inputTokens,
    cachedInputTokens: total.cachedInputTokens + stage.usage!.cachedInputTokens,
    cacheWriteInputTokens: (total.cacheWriteInputTokens ?? 0) + (stage.usage!.cacheWriteInputTokens ?? 0),
    outputTokens: total.outputTokens + stage.usage!.outputTokens,
  }), { inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0 });
  return stages.length > 1 || stages.some(stage => stage.usage?.cacheWriteInputTokens !== undefined)
    ? aggregate
    : { inputTokens: aggregate.inputTokens, cachedInputTokens: aggregate.cachedInputTokens, outputTokens: aggregate.outputTokens };
}
