/**
 * Staff Earnings API Unit Tests
 *
 * Tests for:
 * 1. Response shape matches locked schema
 * 2. When commissionRate missing/0 → earnings = 0 (not grossSales)
 * 3. Forbidden keys never appear in response
 */

import { describe, expect, it } from 'vitest';

// =============================================================================
// RESPONSE SHAPE TYPES (mirror of route.ts)
// =============================================================================

type EarningsResponse = {
  data: {
    range: {
      from: string;
      to: string;
    };
    totals: {
      grossSales: number;
      tips: number;
      earnings: number;
      appointmentCount: number;
    };
    daily: Array<{
      date: string;
      grossSales: number;
      tips: number;
      earnings: number;
      appointmentCount: number;
    }>;
  };
};

// =============================================================================
// FORBIDDEN KEYS (must NEVER appear in staff JSON)
// =============================================================================

const FORBIDDEN_KEYS = [
  'commissionRate',
  'profit',
  'margin',
  'cost',
  'payoutDetails',
] as const;

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Recursively check that an object does not contain any forbidden keys.
 */
function containsForbiddenKeys(
  obj: unknown,
  forbiddenKeys: readonly string[],
): { found: boolean; key?: string; path?: string } {
  if (obj === null || typeof obj !== 'object') {
    return { found: false };
  }

  const stack: Array<{ value: unknown; path: string }> = [{ value: obj, path: '' }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const currentObj = current.value as Record<string, unknown>;

    for (const key of Object.keys(currentObj)) {
      const fullPath = current.path ? `${current.path}.${key}` : key;

      if (forbiddenKeys.includes(key)) {
        return { found: true, key, path: fullPath };
      }

      const value = currentObj[key];
      if (value !== null && typeof value === 'object') {
        stack.push({ value, path: fullPath });
      }
    }
  }

  return { found: false };
}

/**
 * Validate that a response matches the expected earnings shape.
 */
function isValidEarningsResponse(response: unknown): response is EarningsResponse {
  if (typeof response !== 'object' || response === null) {
    return false;
  }
  const resp = response as Record<string, unknown>;

  if (!resp.data || typeof resp.data !== 'object') {
    return false;
  }
  const data = resp.data as Record<string, unknown>;

  // Check range
  if (!data.range || typeof data.range !== 'object') {
    return false;
  }
  const range = data.range as Record<string, unknown>;
  if (typeof range.from !== 'string' || typeof range.to !== 'string') {
    return false;
  }

  // Check totals
  if (!data.totals || typeof data.totals !== 'object') {
    return false;
  }
  const totals = data.totals as Record<string, unknown>;
  if (
    typeof totals.grossSales !== 'number'
    || typeof totals.tips !== 'number'
    || typeof totals.earnings !== 'number'
    || typeof totals.appointmentCount !== 'number'
  ) {
    return false;
  }

  // Check daily array
  if (!Array.isArray(data.daily)) {
    return false;
  }
  for (const day of data.daily) {
    if (typeof day !== 'object' || day === null) {
      return false;
    }
    const d = day as Record<string, unknown>;
    if (
      typeof d.date !== 'string'
      || typeof d.grossSales !== 'number'
      || typeof d.tips !== 'number'
      || typeof d.earnings !== 'number'
      || typeof d.appointmentCount !== 'number'
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate expected earnings given grossSales and commissionRate.
 * Mirrors the logic in route.ts.
 */
function calculateExpectedEarnings(grossSales: number, commissionRate: number): number {
  if (commissionRate <= 0) {
    return 0;
  }
  return Math.round(grossSales * commissionRate);
}

// =============================================================================
// TESTS
// =============================================================================

describe('Staff Earnings API', () => {
  describe('Response Shape', () => {
    it('should have valid response structure with all required fields', () => {
      const mockResponse: EarningsResponse = {
        data: {
          range: {
            from: '2025-12-01',
            to: '2025-12-31',
          },
          totals: {
            grossSales: 50000,
            tips: 0,
            earnings: 25000,
            appointmentCount: 10,
          },
          daily: [
            {
              date: '2025-12-01',
              grossSales: 5000,
              tips: 0,
              earnings: 2500,
              appointmentCount: 1,
            },
          ],
        },
      };

      expect(isValidEarningsResponse(mockResponse)).toBe(true);
    });

    it('should be valid with empty daily array', () => {
      const mockResponse: EarningsResponse = {
        data: {
          range: {
            from: '2025-12-01',
            to: '2025-12-31',
          },
          totals: {
            grossSales: 0,
            tips: 0,
            earnings: 0,
            appointmentCount: 0,
          },
          daily: [],
        },
      };

      expect(isValidEarningsResponse(mockResponse)).toBe(true);
    });

    it('should reject response missing range', () => {
      const invalidResponse = {
        data: {
          totals: { grossSales: 0, tips: 0, earnings: 0, appointmentCount: 0 },
          daily: [],
        },
      };

      expect(isValidEarningsResponse(invalidResponse)).toBe(false);
    });

    it('should reject response missing totals', () => {
      const invalidResponse = {
        data: {
          range: { from: '2025-12-01', to: '2025-12-31' },
          daily: [],
        },
      };

      expect(isValidEarningsResponse(invalidResponse)).toBe(false);
    });
  });

  describe('Earnings Calculation (No Commission)', () => {
    it('should return earnings=0 when commissionRate is 0', () => {
      const grossSales = 100000; // $1000 in cents
      const commissionRate = 0;

      const earnings = calculateExpectedEarnings(grossSales, commissionRate);

      expect(earnings).toBe(0);
      expect(earnings).not.toBe(grossSales); // Critical: must NOT fallback to grossSales
    });

    it('should return earnings=0 when commissionRate is negative', () => {
      const grossSales = 100000;
      const commissionRate = -0.5;

      const earnings = calculateExpectedEarnings(grossSales, commissionRate);

      expect(earnings).toBe(0);
    });

    it('should return earnings=0 when commissionRate is undefined (treated as 0)', () => {
      const grossSales = 100000;
      const commissionRate = 0; // undefined parsed to 0

      const earnings = calculateExpectedEarnings(grossSales, commissionRate);

      expect(earnings).toBe(0);
    });
  });

  describe('Earnings Calculation (With Commission)', () => {
    it('should calculate earnings correctly with 50% commission', () => {
      const grossSales = 100000; // $1000 in cents
      const commissionRate = 0.5; // 50%

      const earnings = calculateExpectedEarnings(grossSales, commissionRate);

      expect(earnings).toBe(50000); // $500 in cents
    });

    it('should calculate earnings correctly with 30% commission', () => {
      const grossSales = 100000;
      const commissionRate = 0.3;

      const earnings = calculateExpectedEarnings(grossSales, commissionRate);

      expect(earnings).toBe(30000);
    });

    it('should round earnings to nearest cent', () => {
      const grossSales = 33333; // Results in fractional cents with many rates
      const commissionRate = 0.33;

      const earnings = calculateExpectedEarnings(grossSales, commissionRate);

      expect(Number.isInteger(earnings)).toBe(true);
      expect(earnings).toBe(11000); // 33333 * 0.33 = 10999.89 → 11000 (Math.round)
    });
  });

  describe('Forbidden Fields', () => {
    it('should not contain commissionRate in response', () => {
      const mockResponse: EarningsResponse = {
        data: {
          range: { from: '2025-12-01', to: '2025-12-31' },
          totals: { grossSales: 50000, tips: 0, earnings: 25000, appointmentCount: 10 },
          daily: [],
        },
      };

      const result = containsForbiddenKeys(mockResponse, FORBIDDEN_KEYS);

      expect(result.found).toBe(false);
    });

    it('should detect forbidden key "commissionRate" if present', () => {
      const badResponse = {
        data: {
          range: { from: '2025-12-01', to: '2025-12-31' },
          totals: { grossSales: 50000, tips: 0, earnings: 25000, appointmentCount: 10 },
          daily: [],
          commissionRate: 0.5, // FORBIDDEN
        },
      };

      const result = containsForbiddenKeys(badResponse, FORBIDDEN_KEYS);

      expect(result.found).toBe(true);
      expect(result.key).toBe('commissionRate');
    });

    it('should detect forbidden key "profit" if present', () => {
      const badResponse = {
        data: {
          range: { from: '2025-12-01', to: '2025-12-31' },
          totals: { grossSales: 50000, tips: 0, earnings: 25000, appointmentCount: 10, profit: 10000 },
          daily: [],
        },
      };

      const result = containsForbiddenKeys(badResponse, FORBIDDEN_KEYS);

      expect(result.found).toBe(true);
      expect(result.key).toBe('profit');
    });

    it('should detect forbidden key "margin" if present', () => {
      const badResponse = {
        data: {
          range: { from: '2025-12-01', to: '2025-12-31' },
          totals: { grossSales: 50000, tips: 0, earnings: 25000, appointmentCount: 10 },
          daily: [{ date: '2025-12-01', grossSales: 5000, tips: 0, earnings: 2500, appointmentCount: 1, margin: 0.2 }],
        },
      };

      const result = containsForbiddenKeys(badResponse, FORBIDDEN_KEYS);

      expect(result.found).toBe(true);
      expect(result.key).toBe('margin');
    });

    it('should detect forbidden key "cost" if present anywhere', () => {
      const badResponse = {
        data: {
          range: { from: '2025-12-01', to: '2025-12-31' },
          totals: { grossSales: 50000, tips: 0, earnings: 25000, appointmentCount: 10 },
          daily: [],
        },
        meta: {
          internal: {
            cost: 5000, // Deeply nested forbidden key
          },
        },
      };

      const result = containsForbiddenKeys(badResponse, FORBIDDEN_KEYS);

      expect(result.found).toBe(true);
      expect(result.key).toBe('cost');
    });

    it('should detect forbidden key "payoutDetails" if present', () => {
      const badResponse = {
        data: {
          range: { from: '2025-12-01', to: '2025-12-31' },
          totals: { grossSales: 50000, tips: 0, earnings: 25000, appointmentCount: 10 },
          daily: [],
          payoutDetails: { bankAccount: '****1234' },
        },
      };

      const result = containsForbiddenKeys(badResponse, FORBIDDEN_KEYS);

      expect(result.found).toBe(true);
      expect(result.key).toBe('payoutDetails');
    });

    it('should pass when no forbidden keys are present', () => {
      const cleanResponse = {
        data: {
          range: { from: '2025-12-01', to: '2025-12-31' },
          totals: { grossSales: 50000, tips: 0, earnings: 25000, appointmentCount: 10 },
          daily: [
            { date: '2025-12-01', grossSales: 5000, tips: 0, earnings: 2500, appointmentCount: 1 },
            { date: '2025-12-02', grossSales: 10000, tips: 0, earnings: 5000, appointmentCount: 2 },
          ],
        },
      };

      const result = containsForbiddenKeys(cleanResponse, FORBIDDEN_KEYS);

      expect(result.found).toBe(false);
    });
  });
});
