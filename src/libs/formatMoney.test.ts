import { describe, expect, it } from 'vitest';

import { formatMoney } from './formatMoney';

describe('formatMoney', () => {
  it('formats CAD by default', () => {
    expect(formatMoney(4500)).toBe('$45.00');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(123456)).toBe('$1,234.56');
  });

  it('formats USD when the salon currency is USD', () => {
    expect(formatMoney(4500, 'USD')).toBe('$45.00');
  });

  it('respects an explicit locale', () => {
    expect(formatMoney(4500, 'CAD', 'fr-CA')).toContain('45,00');
  });
});
