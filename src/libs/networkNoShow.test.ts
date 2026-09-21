import { describe, expect, it } from 'vitest';

import {
  readNoShowProtection,
  shouldRequireNoShowDeposit,
} from '@/libs/networkNoShow';

describe('network no-show protection policy', () => {
  it('defaults malformed and legacy settings to warning-only', () => {
    expect(readNoShowProtection(null)).toBe('warn_only');
    expect(readNoShowProtection({})).toBe('warn_only');
    expect(readNoShowProtection({ payments: { deposit: { noShowProtection: 'blacklist' } } } as never)).toBe('warn_only');
  });

  it('reads only the nested payment setting', () => {
    expect(readNoShowProtection({ payments: { deposit: { noShowProtection: 'deposit_1' } } } as never)).toBe('deposit_1');
    expect(readNoShowProtection({ payments: { deposit: { noShowProtection: 'deposit_2' } } } as never)).toBe('deposit_2');
  });

  it('requires a deposit only for available counts at the configured threshold', () => {
    const one = { state: 'available' as const, activeNoShowCount: 1, windowMonths: 12 as const };
    const two = { state: 'available' as const, activeNoShowCount: 2, windowMonths: 12 as const };

    expect(shouldRequireNoShowDeposit('warn_only', two)).toBe(false);
    expect(shouldRequireNoShowDeposit('deposit_1', one)).toBe(true);
    expect(shouldRequireNoShowDeposit('deposit_2', one)).toBe(false);
    expect(shouldRequireNoShowDeposit('deposit_2', two)).toBe(true);
    expect(shouldRequireNoShowDeposit('deposit_1', { state: 'unavailable' })).toBe(false);
    expect(shouldRequireNoShowDeposit('deposit_1', { state: 'inactive' })).toBe(false);
  });
});
