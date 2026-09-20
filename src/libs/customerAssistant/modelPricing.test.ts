import { describe, expect, it } from 'vitest';

import { aggregateCustomerAssistantStageUsage, CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD, CUSTOMER_ASSISTANT_TURN_COST_UPPER_BOUND_MICRO_USD, customerAssistantModelUsageCostMicros, customerAssistantStageUsageCostMicros } from './modelPricing';

const usage = { inputTokens: 1_000, cachedInputTokens: 200, cacheWriteInputTokens: 100, outputTokens: 50 };

describe('customer assistant model pricing', () => {
  it('prices Terra and Luna by their own stage rates', () => {
    expect(customerAssistantModelUsageCostMicros('gpt-5.6-terra', usage)).toBe(2_290);
    expect(customerAssistantModelUsageCostMicros('gpt-5.6-luna', usage)).toBe(229);
    expect(customerAssistantStageUsageCostMicros([
      { stage: 'interpreter', model: 'gpt-5.6-terra', usage },
      { stage: 'composer', model: 'gpt-5.6-luna', usage },
    ])).toBe(2_519);
  });

  it('keeps any invoked unknown or malformed stage unknown, while no-stage work costs zero', () => {
    expect(customerAssistantStageUsageCostMicros([])).toBe(0);
    expect(customerAssistantStageUsageCostMicros([
      { stage: 'interpreter', model: 'gpt-5.6-terra', usage: null },
    ])).toBeNull();
    expect(customerAssistantStageUsageCostMicros([
      { stage: 'interpreter', model: 'gpt-5.6-terra', usage: { inputTokens: 1, cachedInputTokens: 2, outputTokens: 0 } },
    ])).toBeNull();
    expect(aggregateCustomerAssistantStageUsage([
      { stage: 'interpreter', model: 'gpt-5.6-terra', usage },
      { stage: 'composer', model: 'gpt-5.6-luna', usage: null },
    ])).toBeNull();
  });

  it('reserves more than the schema-aware two-stage worst-case estimate', () => {
    expect(CUSTOMER_ASSISTANT_TURN_COST_UPPER_BOUND_MICRO_USD).toBeGreaterThan(0);
    expect(CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD).toBeGreaterThanOrEqual(CUSTOMER_ASSISTANT_TURN_COST_UPPER_BOUND_MICRO_USD);
  });
});
