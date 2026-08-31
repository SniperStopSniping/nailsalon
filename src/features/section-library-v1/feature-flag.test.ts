import { describe, expect, it } from 'vitest';

import { resolveSectionLibraryV1Enabled } from './feature-flag';

describe('resolveSectionLibraryV1Enabled', () => {
  it('is dark by default', () => {
    expect(resolveSectionLibraryV1Enabled(undefined)).toBe(false);
  });

  it('enables only on the exact literal "true"', () => {
    expect(resolveSectionLibraryV1Enabled('true')).toBe(true);
    expect(resolveSectionLibraryV1Enabled('false')).toBe(false);
    expect(resolveSectionLibraryV1Enabled('TRUE')).toBe(false);
    expect(resolveSectionLibraryV1Enabled('1')).toBe(false);
    expect(resolveSectionLibraryV1Enabled('')).toBe(false);
  });
});
