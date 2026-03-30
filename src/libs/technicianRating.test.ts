import { describe, expect, it } from 'vitest';

import {
  NO_PUBLIC_TECHNICIAN_REVIEWS_LABEL,
  getPublicTechnicianRatingDisplay,
  roundTechnicianRating,
} from './technicianRating';

describe('technicianRating', () => {
  it('returns the neutral no-reviews state when review count is zero', () => {
    expect(getPublicTechnicianRatingDisplay({
      rating: 5,
      reviewCount: 0,
    })).toEqual({
      kind: 'unrated',
      label: NO_PUBLIC_TECHNICIAN_REVIEWS_LABEL,
    });
  });

  it('formats rated technicians with one decimal place and localized count text', () => {
    expect(getPublicTechnicianRatingDisplay({
      rating: 4.94,
      reviewCount: 1234,
    })).toEqual({
      kind: 'rated',
      ratingValue: 4.9,
      ratingText: '4.9',
      reviewCount: 1234,
      reviewCountText: '1,234',
    });
  });

  it('rounds stored ratings to one decimal place', () => {
    expect(roundTechnicianRating(4.95)).toBe(5);
    expect(roundTechnicianRating(4.94)).toBe(4.9);
  });
});
