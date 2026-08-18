import { describe, expect, it } from 'vitest';

import type { DiscoverServiceFamily } from './discoverTaxonomy';
import {
  computePortfolioEligibility,
  type EligibilityContext,
  type EligibilityPhoto,
  planEligiblePhotoIds,
  summarizeDiscoverReadiness,
} from './portfolioEligibility';

const BOOKABLE = new Set<DiscoverServiceFamily>(['gel_x', 'acrylic']);

function photo(id: string, over: Partial<EligibilityPhoto> = {}): EligibilityPhoto {
  return {
    id,
    sortOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ownerVisible: true,
    discoverIncluded: true,
    serviceFamily: 'gel_x',
    nailLength: 'long',
    moderationState: 'allowed',
    deletedAt: null,
    cropX: '0.00000',
    cropY: '0.00000',
    cropWidth: '1.00000',
    cropHeight: '1.00000',
    ...over,
  };
}

const context = (over: Partial<EligibilityContext> = {}): EligibilityContext => ({
  businessEligible: true,
  businessDiscoverEnabled: true,
  bookableFamilies: BOOKABLE,
  locationEligible: true,
  ...over,
});

function ordered(count: number): EligibilityPhoto[] {
  return Array.from({ length: count }, (_, i) => photo(`p${i}`, { sortOrder: i }));
}

describe('planEligiblePhotoIds', () => {
  it('keeps the first N in owner order and no more', () => {
    expect([...planEligiblePhotoIds(ordered(5), 3)]).toEqual(['p0', 'p1', 'p2']);
  });

  it('treats -1 as unlimited', () => {
    expect(planEligiblePhotoIds(ordered(5), -1).size).toBe(5);
  });

  it('never lets soft-deleted photos consume allowance', () => {
    const photos = [
      photo('gone', { sortOrder: 0, deletedAt: new Date() }),
      photo('kept', { sortOrder: 1 }),
    ];

    expect([...planEligiblePhotoIds(photos, 1)]).toEqual(['kept']);
  });

  it('breaks ties deterministically by creation time then id', () => {
    const a = photo('b', { sortOrder: 0, createdAt: new Date('2026-01-02T00:00:00Z') });
    const b = photo('a', { sortOrder: 0, createdAt: new Date('2026-01-01T00:00:00Z') });

    expect([...planEligiblePhotoIds([a, b], 1)]).toEqual(['a']);
  });
});

describe('the profile / Discover split', () => {
  it('keeps a Discover-excluded photo on the profile', () => {
    const result = computePortfolioEligibility(
      [photo('p', { discoverIncluded: false })],
      10,
      context(),
    ).get('p')!;

    expect(result.profileEligible).toBe(true);
    expect(result.discoverEligible).toBe(false);
  });

  it('removes a hidden photo from both surfaces', () => {
    const result = computePortfolioEligibility(
      [photo('p', { ownerVisible: false })],
      10,
      context(),
    ).get('p')!;

    expect(result.profileEligible).toBe(false);
    expect(result.discoverEligible).toBe(false);
  });

  it('lets moderation remove a photo from Discover alone', () => {
    const result = computePortfolioEligibility(
      [photo('p', { moderationState: 'discover_off' })],
      10,
      context(),
    ).get('p')!;

    expect(result.profileEligible).toBe(true);
    expect(result.discoverEligible).toBe(false);
  });

  it('lets moderation remove a photo everywhere', () => {
    const result = computePortfolioEligibility(
      [photo('p', { moderationState: 'disabled' })],
      10,
      context(),
    ).get('p')!;

    expect(result.profileEligible).toBe(false);
    expect(result.discoverEligible).toBe(false);
  });

  it('requires both tags, a crop, and business opt-in for Discover', () => {
    const cases: [string, Partial<EligibilityPhoto>, Partial<EligibilityContext>][] = [
      ['untagged family', { serviceFamily: 'unspecified' }, {}],
      ['untagged length', { nailLength: 'unspecified' }, {}],
      ['no crop', { cropX: null, cropY: null, cropWidth: null, cropHeight: null }, {}],
      ['discover off', {}, { businessDiscoverEnabled: false }],
      ['location not eligible', {}, { locationEligible: false }],
    ];

    for (const [label, photoOver, contextOver] of cases) {
      const result = computePortfolioEligibility(
        [photo('p', photoOver)],
        10,
        context(contextOver),
      ).get('p')!;

      expect(result.discoverEligible, label).toBe(false);
    }
  });

  it('drops a family the salon can no longer be booked for, without hiding the photo', () => {
    const result = computePortfolioEligibility(
      [photo('p', { serviceFamily: 'pedicure' })],
      10,
      context(),
    ).get('p')!;

    expect(result.discoverMetadataComplete).toBe(false);
    expect(result.discoverEligible).toBe(false);
    expect(result.profileEligible).toBe(true);
  });

  it('excludes everything when the business itself is ineligible', () => {
    const result = computePortfolioEligibility(
      [photo('p')],
      10,
      context({ businessEligible: false }),
    ).get('p')!;

    expect(result.profileEligible).toBe(false);
    expect(result.discoverEligible).toBe(false);
  });
});

describe('downgrade behaviour', () => {
  it('retains over-allowance photos instead of deleting or hiding them', () => {
    const photos = ordered(5);
    const result = computePortfolioEligibility(photos, 2, context());

    expect(result.get('p1')!.profileEligible).toBe(true);
    expect(result.get('p4')!.planEligible).toBe(false);
    expect(result.get('p4')!.retainedOverAllowance).toBe(true);
    // Owner intent is untouched — the photo is still visible and still opted
    // in; only the derived plan eligibility changed.
    expect(photos[4]!.ownerVisible).toBe(true);
    expect(photos[4]!.discoverIncluded).toBe(true);
  });

  it('lets reordering change which photos survive a downgrade', () => {
    const photos = ordered(3);
    const before = computePortfolioEligibility(photos, 1, context());

    expect(before.get('p0')!.planEligible).toBe(true);
    expect(before.get('p2')!.planEligible).toBe(false);

    const reordered = photos.map(p =>
      p.id === 'p2' ? { ...p, sortOrder: -1 } : p,
    );
    const after = computePortfolioEligibility(reordered, 1, context());

    expect(after.get('p2')!.planEligible).toBe(true);
    expect(after.get('p0')!.planEligible).toBe(false);
  });

  it('restores eligibility automatically when the allowance grows again', () => {
    const photos = ordered(5);

    expect(computePortfolioEligibility(photos, 2, context()).get('p4')!.planEligible).toBe(false);
    expect(computePortfolioEligibility(photos, 10, context()).get('p4')!.planEligible).toBe(true);
  });

  it('blocks every photo at a zero allowance without deleting any', () => {
    const result = computePortfolioEligibility(ordered(3), 0, context());

    expect([...result.values()].every(r => !r.planEligible)).toBe(true);
    expect([...result.values()].every(r => r.retainedOverAllowance)).toBe(true);
  });
});

describe('summarizeDiscoverReadiness', () => {
  it('counts exactly what an owner has to fix', () => {
    const readiness = summarizeDiscoverReadiness(
      [
        photo('ok', { sortOrder: 0 }),
        photo('noCrop', { sortOrder: 1, cropX: null, cropY: null, cropWidth: null, cropHeight: null }),
        photo('noFamily', { sortOrder: 2, serviceFamily: 'unspecified' }),
        photo('noLength', { sortOrder: 3, nailLength: 'unspecified' }),
        photo('unbookable', { sortOrder: 4, serviceFamily: 'pedicure' }),
        photo('deleted', { sortOrder: 5, deletedAt: new Date() }),
      ],
      10,
      context(),
    );

    expect(readiness.storedPhotos).toBe(5);
    expect(readiness.discoverEligiblePhotos).toBe(1);
    expect(readiness.missingCrop).toBe(1);
    expect(readiness.missingServiceFamily).toBe(1);
    expect(readiness.missingNailLength).toBe(1);
    expect(readiness.unbookableFamily).toBe(1);
  });

  it('reports photos retained over the allowance', () => {
    const readiness = summarizeDiscoverReadiness(ordered(4), 2, context());

    expect(readiness.retainedOverAllowance).toBe(2);
    expect(readiness.profileEligiblePhotos).toBe(2);
  });
});
