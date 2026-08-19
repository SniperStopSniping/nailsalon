import { describe, expect, it } from 'vitest';

import {
  descriptionItemsToLegacyText,
  normalizeDescriptionItems,
  resolveCatalogDomainView,
} from '@/libs/bookingCatalog';

describe('bookingCatalog description normalization', () => {
  it('trims values and removes empty items', () => {
    expect(normalizeDescriptionItems(['  Dry manicure  ', '', '  ', 'Cuticle work '])).toEqual([
      'Dry manicure',
      'Cuticle work',
    ]);
  });

  it('returns null for invalid input', () => {
    expect(normalizeDescriptionItems('not-an-array')).toBeNull();
  });

  it('converts structured items back to legacy text safely', () => {
    expect(descriptionItemsToLegacyText(['Dry manicure', 'Cuticle work'])).toBe('Dry manicure\nCuticle work');
    expect(descriptionItemsToLegacyText(null, 'Fallback description')).toBe('Fallback description');
  });
});

// =============================================================================
// L1 PR3 — the narrow inert seam. All three catalog feature keys are dark
// (l1CatalogFeatureKeys.test.ts), so this must resolve to 'legacy' for every
// input shape below — there is no way to reach 'l1' without an explicit
// true, and no salon has one today.
// =============================================================================

describe('resolveCatalogDomainView', () => {
  it('resolves to legacy for null/undefined features', () => {
    expect(resolveCatalogDomainView(null)).toBe('legacy');
    expect(resolveCatalogDomainView(undefined)).toBe('legacy');
  });

  it('resolves to legacy for an empty features object', () => {
    expect(resolveCatalogDomainView({})).toBe('legacy');
  });

  it('resolves to legacy even with every OTHER feature group turned on', () => {
    expect(resolveCatalogDomainView({
      marketing: { smsReminders: true, referrals: true, rewards: true },
      money: { staffEarnings: true, deposits: true },
      analytics: { dashboard: true, utilization: true },
      controls: { clientBlocking: true, clientFlags: true },
    })).toBe('legacy');
  });

  it('resolves to legacy when the catalog group is present but every key is explicitly false', () => {
    expect(resolveCatalogDomainView({
      catalog: { variantsV1: false, addOnGroupsV1: false, bookingModesV1: false },
    })).toBe('legacy');
  });

  it('resolves to l1 only when a catalog key is explicitly true (no live caller does this today)', () => {
    expect(resolveCatalogDomainView({ catalog: { variantsV1: true } })).toBe('l1');
    expect(resolveCatalogDomainView({ catalog: { addOnGroupsV1: true } })).toBe('l1');
    expect(resolveCatalogDomainView({ catalog: { bookingModesV1: true } })).toBe('l1');
  });
});
