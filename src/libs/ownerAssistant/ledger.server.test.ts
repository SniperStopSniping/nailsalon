import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));

const { CACHE_WRITE_MULTIPLIER, computeCostMicros, computePromptFingerprint } = await import('./ledger.server');

const call = (overrides: Partial<{ inputCount: number; cachedInputCount: number; cacheWriteInputCount: number; outputCount: number }>) => ({
  index: 1,
  inputCount: 0,
  cachedInputCount: 0,
  cacheWriteInputCount: 0,
  outputCount: 0,
  latencyMs: 1,
  ...overrides,
});

describe('computeCostMicros', () => {
  it('prices uncached input, cached input, cache writes and output at the documented Luna rates', () => {
    // 1,000,000 uncached input = $0.20; 1,000,000 cached = $0.02; 1,000,000 output = $1.20.
    expect(computeCostMicros('gpt-5.6-luna', [call({ inputCount: 1_000_000, outputCount: 0 })])).toEqual({ costMicros: 200_000, priceKnown: true });
    expect(computeCostMicros('gpt-5.6-luna', [call({ inputCount: 1_000_000, cachedInputCount: 1_000_000 })])).toEqual({ costMicros: 20_000, priceKnown: true });
    expect(computeCostMicros('gpt-5.6-luna', [call({ outputCount: 1_000_000 })])).toEqual({ costMicros: 1_200_000, priceKnown: true });
    // Cache writes bill at 1.25× the input rate: 1,000,000 written = $0.25.
    expect(CACHE_WRITE_MULTIPLIER).toBe(1.25);
    expect(computeCostMicros('gpt-5.6-luna', [call({ inputCount: 1_000_000, cacheWriteInputCount: 1_000_000 })])).toEqual({ costMicros: 250_000, priceKnown: true });
  });

  it('clamps cache writes to what is left after cached input, so the charge can never go negative', () => {
    const result = computeCostMicros('gpt-5.6-luna', [call({ inputCount: 1_000_000, cachedInputCount: 800_000, cacheWriteInputCount: 900_000 })]);

    // 800,000 cached ($0.016) + 200,000 written at 1.25× ($0.05); nothing uncached.
    expect(result).toEqual({ costMicros: 66_000, priceKnown: true });
  });

  it('reports an unknown model as unpriced', () => {
    expect(computeCostMicros('some-future-model', [call({ inputCount: 10 })])).toEqual({ costMicros: 0, priceKnown: false });
  });
});

describe('computePromptFingerprint', () => {
  it('changes with the salon frame and with the prompt extras, and is stable otherwise', () => {
    const base = computePromptFingerprint('frame-a', 'tools-a');

    expect(computePromptFingerprint('frame-a', 'tools-a')).toBe(base);
    expect(computePromptFingerprint('frame-b', 'tools-a')).not.toBe(base);
    expect(computePromptFingerprint('frame-a', 'tools-b')).not.toBe(base);
  });
});
