import { describe, expect, it } from 'vitest';

import { descriptionItemsToLegacyText, normalizeDescriptionItems } from '@/libs/bookingCatalog';

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
