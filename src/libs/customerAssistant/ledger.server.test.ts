import { describe, expect, it, vi } from 'vitest';

const record = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/salonAuditLog.server', () => ({ writeSalonAuditRow: record }));
const { customerUsageCostMicros, recordCustomerAssistantUsage } = await import('./ledger.server');

describe('customer-only spend accounting', () => {
  it('counts cached and cache-write tokens and never treats unknown usage as free', () => {
    expect(customerUsageCostMicros(null)).toBeNull();
    expect(customerUsageCostMicros({ inputTokens: 1000, cachedInputTokens: 500, cacheWriteInputTokens: 100, outputTokens: 100 })).toBe(235);
    expect(customerUsageCostMicros({ inputTokens: 1, cachedInputTokens: 2, outputTokens: 0 })).toBeNull();
  });

  it('writes only separate action evidence with a worst-case reservation', async () => {
    await recordCustomerAssistantUsage({ salonId: 'salon-a', attemptId: 'attempt', outcome: 'reserved', usage: null, latencyMs: 0 });

    expect(record).toHaveBeenCalledWith({}, expect.objectContaining({ salonId: 'salon-a', action: 'customer_assistant_turn', metadata: expect.objectContaining({ newValue: expect.objectContaining({ costMicros: null, reservedCostMicros: 20000 }) }) }));
  });
});
