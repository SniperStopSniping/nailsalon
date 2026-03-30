export const NO_PUBLIC_TECHNICIAN_REVIEWS_LABEL = 'No reviews yet';

export type PublicTechnicianRatingDisplay =
  | {
      kind: 'unrated';
      label: typeof NO_PUBLIC_TECHNICIAN_REVIEWS_LABEL;
    }
  | {
      kind: 'rated';
      ratingValue: number;
      ratingText: string;
      reviewCount: number;
      reviewCountText: string;
    };

export function roundTechnicianRating(value: number): number {
  return Math.round(value * 10) / 10;
}

export function getPublicTechnicianRatingDisplay(args: {
  rating: number | null;
  reviewCount: number;
}): PublicTechnicianRatingDisplay {
  const normalizedReviewCount = Number.isFinite(args.reviewCount)
    ? Math.max(0, Math.trunc(args.reviewCount))
    : 0;

  if (
    normalizedReviewCount <= 0
    || args.rating === null
    || !Number.isFinite(args.rating)
    || args.rating <= 0
  ) {
    return {
      kind: 'unrated',
      label: NO_PUBLIC_TECHNICIAN_REVIEWS_LABEL,
    };
  }

  const ratingValue = roundTechnicianRating(Math.min(5, Math.max(1, args.rating)));

  return {
    kind: 'rated',
    ratingValue,
    ratingText: ratingValue.toFixed(1),
    reviewCount: normalizedReviewCount,
    reviewCountText: normalizedReviewCount.toLocaleString('en-US'),
  };
}
