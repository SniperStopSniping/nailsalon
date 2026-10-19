import type { SetupModel } from '@/features/business-setup/ai-models';
import type { ModelProviderUsage } from '@/libs/ai/provider';

export type AiCreditPricingSnapshot = {
  version: string;
  usdToCadMillionths: number;
  rates: Record<SetupModel, { input: number; cached: number; cacheWrite: number; output: number }>;
};
export type AiCreditRequestKind = 'conversation' | 'design' | 'extract';

/** Invalid/missing usage stays unknown, never a measured zero-cost call. */
export function measuredAiCost(usage: ModelProviderUsage | null, rates: AiCreditPricingSnapshot['rates'][SetupModel]) {
  if (!usage || ![usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.cacheWriteInputTokens ?? 0].every(value => Number.isSafeInteger(value) && value >= 0)
    || usage.cachedInputTokens + (usage.cacheWriteInputTokens ?? 0) > usage.inputTokens) {
    return null;
  }
  const cost = Math.ceil((usage.inputTokens - usage.cachedInputTokens - (usage.cacheWriteInputTokens ?? 0)) * rates.input
    + usage.cachedInputTokens * rates.cached + (usage.cacheWriteInputTokens ?? 0) * rates.cacheWrite + usage.outputTokens * rates.output);
  return Number.isSafeInteger(cost) && cost >= 0 && cost <= 2_000_000_000 ? cost : null;
}
