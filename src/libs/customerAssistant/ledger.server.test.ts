import { describe, expect, it, vi } from 'vitest';

const record = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/salonAuditLog.server', () => ({ writeSalonAuditRow: record }));
const { CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD } = await import('./modelPricing');
const { customerUsageCostMicros, recordCustomerAssistantUsage } = await import('./ledger.server');

describe('customer-only spend accounting', () => {
  it('counts cached and cache-write tokens and never treats unknown usage as free', () => {
    expect(customerUsageCostMicros(null)).toBeNull();
    expect(customerUsageCostMicros({ inputTokens: 1000, cachedInputTokens: 500, cacheWriteInputTokens: 100, outputTokens: 100 })).toBe(235);
    expect(customerUsageCostMicros({ inputTokens: 1, cachedInputTokens: 2, outputTokens: 0 })).toBeNull();
  });

  it('writes only separate action evidence with a worst-case reservation', async () => {
    await recordCustomerAssistantUsage({ salonId: 'salon-a', attemptId: 'attempt', outcome: 'reserved', usage: null, latencyMs: 0 });

    expect(record).toHaveBeenCalledWith({}, expect.objectContaining({ salonId: 'salon-a', action: 'customer_assistant_turn', metadata: expect.objectContaining({ newValue: expect.objectContaining({ costMicros: null, providerCall: null, reservedCostMicros: CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD }) }) }));
  });

  it('keeps aggregate cost unknown when any invoked stage has no provider usage, while deterministic work costs zero', async () => {
    await recordCustomerAssistantUsage({
      salonId: 'salon-a',
      attemptId: 'unknown-stage',
      outcome: 'failed',
      usage: null,
      stageUsages: [
        { stage: 'interpreter', model: 'gpt-5.6-terra', usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 } },
        { stage: 'composer', model: 'gpt-5.6-luna', usage: null },
      ],
      latencyMs: 0,
    });

    expect(record).toHaveBeenLastCalledWith({}, expect.objectContaining({ metadata: expect.objectContaining({ newValue: expect.objectContaining({
      providerCall: true,
      costMicros: null,
      stages: [
        expect.objectContaining({ stage: 'interpreter', costMicros: 80 }),
        expect.objectContaining({ stage: 'composer', costMicros: null }),
      ],
    }) }) }));

    await recordCustomerAssistantUsage({ salonId: 'salon-a', attemptId: 'deterministic', outcome: 'failed', usage: null, latencyMs: 0, deterministic: true });

    expect(record).toHaveBeenLastCalledWith({}, expect.objectContaining({ metadata: expect.objectContaining({ newValue: expect.objectContaining({ providerCall: false, costMicros: 0, stages: [] }) }) }));
  });

  it('records Terra and Luna usage independently and never assigns a blended turn to Luna', async () => {
    await recordCustomerAssistantUsage({
      salonId: 'salon-a',
      attemptId: 'staged',
      outcome: 'answer',
      usage: { inputTokens: 30, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 10 },
      stageUsages: [
        { stage: 'interpreter', model: 'gpt-5.6-terra', usage: { inputTokens: 10, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 5 } },
        { stage: 'composer', model: 'gpt-5.6-luna', usage: { inputTokens: 20, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 5 } },
      ],
      latencyMs: 0,
    });

    expect(record).toHaveBeenLastCalledWith({}, expect.objectContaining({ metadata: expect.objectContaining({ newValue: expect.objectContaining({
      model: null,
      providerCall: true,
      costMicros: 90,
      stages: [
        expect.objectContaining({ stage: 'interpreter', model: 'gpt-5.6-terra', costMicros: 80 }),
        expect.objectContaining({ stage: 'composer', model: 'gpt-5.6-luna', costMicros: 10 }),
      ],
    }) }) }));
  });
});
