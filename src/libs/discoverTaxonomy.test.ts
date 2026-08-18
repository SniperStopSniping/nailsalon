import { describe, expect, it } from 'vitest';

import {
  ASSIGNABLE_DISCOVER_SERVICE_FAMILIES,
  bookableDiscoverFamilies,
  isDiscoverNailLength,
  isDiscoverServiceFamily,
  serviceDiscoverFamily,
} from './discoverTaxonomy';

const service = (over: Partial<{ templateKey: string | null; name: string | null; isActive: boolean | null }> = {}) => ({
  templateKey: null,
  name: null,
  isActive: true,
  ...over,
});

describe('serviceDiscoverFamily', () => {
  it('prefers the structured template key over the display name', () => {
    expect(serviceDiscoverFamily(service({ templateKey: 'gel_x_extensions', name: 'Acrylic Full Set' })))
      .toBe('gel_x');
  });

  it('matches the longest prefix first so gel_x does not fall through to hard gel', () => {
    expect(serviceDiscoverFamily(service({ templateKey: 'gel_x_short' }))).toBe('gel_x');
    expect(serviceDiscoverFamily(service({ templateKey: 'hard_gel_overlay' }))).toBe('hard_gel');
    expect(serviceDiscoverFamily(service({ templateKey: 'builder_gel_overlay' }))).toBe('builder_gel');
  });

  it('treats biab and structured gel as the builder family', () => {
    expect(serviceDiscoverFamily(service({ templateKey: 'biab_overlay' }))).toBe('builder_gel');
    expect(serviceDiscoverFamily(service({ templateKey: 'structured_gel_natural' }))).toBe('builder_gel');
  });

  it('falls back to the display name for salon-authored services', () => {
    expect(serviceDiscoverFamily(service({ name: 'Gel-X Full Set' }))).toBe('gel_x');
    expect(serviceDiscoverFamily(service({ name: 'Deluxe Pedicure' }))).toBe('pedicure');
    expect(serviceDiscoverFamily(service({ name: 'Daniela\'s BIAB overlay' }))).toBe('builder_gel');
  });

  it('returns null rather than guessing a default', () => {
    expect(serviceDiscoverFamily(service({ name: 'Consultation' }))).toBeNull();
    expect(serviceDiscoverFamily(service())).toBeNull();
  });
});

describe('bookableDiscoverFamilies', () => {
  it('collects families from currently active services only', () => {
    const families = bookableDiscoverFamilies([
      service({ templateKey: 'gel_x_extensions' }),
      service({ templateKey: 'acrylic_full_set_medium', isActive: false }),
      service({ name: 'Classic Manicure' }),
    ] as never);

    expect([...families].sort()).toEqual(['gel_x', 'manicure']);
  });

  it('treats an unknown active flag as not bookable rather than assuming yes', () => {
    const families = bookableDiscoverFamilies([
      service({ templateKey: 'gel_x_extensions', isActive: null }),
    ] as never);

    expect(families.size).toBe(0);
  });

  it('is empty for a salon with no recognisable nail services', () => {
    expect(bookableDiscoverFamilies([service({ name: 'Consultation' })] as never).size).toBe(0);
  });
});

describe('taxonomy guards', () => {
  it('never offers "unspecified" as something an owner can assign', () => {
    expect(ASSIGNABLE_DISCOVER_SERVICE_FAMILIES).not.toContain('unspecified');
  });

  it('validates enum membership', () => {
    expect(isDiscoverServiceFamily('gel_x')).toBe(true);
    expect(isDiscoverServiceFamily('chrome')).toBe(false);
    expect(isDiscoverNailLength('xl')).toBe(true);
    expect(isDiscoverNailLength('gigantic')).toBe(false);
  });
});
