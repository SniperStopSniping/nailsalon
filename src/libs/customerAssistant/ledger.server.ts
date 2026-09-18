import 'server-only';

import type { ModelProviderUsage } from '@/libs/ai/provider';
import { db } from '@/libs/DB';
import { writeSalonAuditRow } from '@/libs/salonAuditLog.server';

import { CUSTOMER_ASSISTANT_MODEL } from './contracts';

export function customerUsageCostMicros(usage: ModelProviderUsage | null): number | null {
  if (!usage) {
    return null;
  }
  const written = usage.cacheWriteInputTokens ?? 0;
  const uncached = usage.inputTokens - usage.cachedInputTokens - written;
  if (uncached < 0 || Object.values(usage).some(value => !Number.isSafeInteger(value) || value < 0)) {
    return null;
  }
  // USD per million: input .20, cached .02, output 1.20; writes 1.25x.
  return Math.ceil(uncached * 0.2 + usage.cachedInputTokens * 0.02 + written * 0.25 + usage.outputTokens * 1.2);
}

/** Separate action namespace; no prompts, contact, tokens or model prose. */
export async function recordCustomerAssistantUsage(args: {
  salonId: string;
  attemptId: string;
  outcome: 'reserved' | 'proposal' | 'clarification' | 'no_match' | 'failed';
  usage: ModelProviderUsage | null;
  latencyMs: number;
}): Promise<void> {
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
        model: CUSTOMER_ASSISTANT_MODEL,
        inputCount: args.usage?.inputTokens ?? null,
        cachedInputCount: args.usage?.cachedInputTokens ?? null,
        cacheWriteInputCount: args.usage?.cacheWriteInputTokens ?? null,
        outputCount: args.usage?.outputTokens ?? null,
        costMicros: customerUsageCostMicros(args.usage),
        reservedCostMicros: args.outcome === 'reserved' ? 20_000 : 0,
        latencyMs: Math.round(args.latencyMs),
      },
    },
  });
}
