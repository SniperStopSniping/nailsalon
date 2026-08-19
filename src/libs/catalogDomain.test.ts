import { describe, expect, it } from 'vitest';

import { CATALOG_RULE_REASON_CODES } from '@/libs/catalogRuleContract';

import {
  CATALOG_PROJECTION_EFFECTS,
  CATALOG_RULE_REASON_TEXT,
  compareIds,
  DEFAULT_REASON_CODE_BY_EFFECT,
  isCatalogRuleReasonCode,
} from './catalogDomain';

describe('CATALOG_PROJECTION_EFFECTS', () => {
  it('is exactly the five allowed effects', () => {
    expect([...CATALOG_PROJECTION_EFFECTS].sort()).toEqual(
      ['auto_add', 'disable', 'hide', 'limit_quantity', 'require'].sort(),
    );
  });

  it('has a bounded reason-text entry for every reason code', () => {
    for (const code of CATALOG_RULE_REASON_CODES) {
      expect(CATALOG_RULE_REASON_TEXT[code], code).toBeTypeOf('string');
      expect(CATALOG_RULE_REASON_TEXT[code].length, code).toBeGreaterThan(0);
    }
  });

  it('maps every effect to a reason code that is itself bounded', () => {
    for (const effect of CATALOG_PROJECTION_EFFECTS) {
      const code = DEFAULT_REASON_CODE_BY_EFFECT[effect];

      expect(isCatalogRuleReasonCode(code), effect).toBe(true);
    }
  });
});

describe('isCatalogRuleReasonCode', () => {
  it('accepts every code in the landed enum', () => {
    for (const code of CATALOG_RULE_REASON_CODES) {
      expect(isCatalogRuleReasonCode(code)).toBe(true);
    }
  });

  it('rejects free text, numbers and objects', () => {
    expect(isCatalogRuleReasonCode('because the owner said so')).toBe(false);
    expect(isCatalogRuleReasonCode(42)).toBe(false);
    expect(isCatalogRuleReasonCode({ code: 'included_with_selection' })).toBe(false);
    expect(isCatalogRuleReasonCode(undefined)).toBe(false);
  });
});

describe('compareIds', () => {
  it('orders ascending and is stable across environments (plain ordinal, not locale)', () => {
    expect(compareIds('a', 'b')).toBeLessThan(0);
    expect(compareIds('b', 'a')).toBeGreaterThan(0);
    expect(compareIds('a', 'a')).toBe(0);
    // Ordinal comparison, not locale-aware collation.
    expect(compareIds('A', 'a')).toBeLessThan(0);
  });

  it('produces a total order that sort() can use deterministically', () => {
    const ids = ['svc_b', 'svc_a', 'svc_c'];

    expect([...ids].sort(compareIds)).toEqual(['svc_a', 'svc_b', 'svc_c']);
  });
});

// Canonical serialization and hashing (`stableStringify`,
// `computeCatalogFingerprint`-equivalent) now live in `catalogFingerprint.ts`
// / `catalogFingerprint.server.ts` — see `catalogFingerprint.test.ts` and
// `catalogFingerprint.server.test.ts` (the latter carries the differential
// Web-Crypto-vs-Node-crypto test).
