'use client';

/**
 * useTechnicianReviews — one review truth for the whole workspace.
 *
 * The audit (AG-w2-more-tools-04) found the Workspace asserting two different
 * review realities for the same salon: the Reviews app said "0 Reviews / 0.0
 * Average / No reviews yet for this salon", while Staff showed "Daniela 4.8
 * (127)". The staff figures came from `technician.rating` / `review_count`,
 * columns an owner can type into by hand in the Settings tab and that nothing
 * reconciles with the `review` table. An owner cannot tell which number is
 * real, and the invented one reads as fabricated social proof.
 *
 * So the staff surfaces stop reading those columns and derive their rating
 * from the same rows the Reviews app counts — `GET /api/admin/reviews`. If a
 * technician has no reviews, no rating is shown at all (never a 0.0, never an
 * empty row of stars).
 */

import { useCallback, useEffect, useState } from 'react';

export type TechnicianReviewSummary = {
  /** Reviews attributed to this technician, as counted by the Reviews app. */
  count: number;
  /** Mean star rating of those reviews. Only meaningful when count > 0. */
  average: number;
};

type ReviewRow = {
  technicianId: string | null;
  rating: number;
};

export type TechnicianReviewSummaries = {
  /** Keyed by technician id. A missing key means "no reviews". */
  byTechnician: Record<string, TechnicianReviewSummary>;
  /**
   * False until the salon's reviews have actually been read. Surfaces must not
   * render a rating before this is true, so a slow fetch can never flash a
   * number that later disappears.
   */
  loaded: boolean;
};

const EMPTY: TechnicianReviewSummaries = { byTechnician: {}, loaded: false };

/** Groups review rows into a per-technician count and average. */
export function summarizeTechnicianReviews(
  reviews: ReviewRow[],
): Record<string, TechnicianReviewSummary> {
  const totals: Record<string, { sum: number; count: number }> = {};

  for (const review of reviews) {
    const technicianId = review.technicianId;
    if (!technicianId || typeof review.rating !== 'number') {
      continue;
    }
    const bucket = totals[technicianId] ?? { sum: 0, count: 0 };
    bucket.sum += review.rating;
    bucket.count += 1;
    totals[technicianId] = bucket;
  }

  return Object.fromEntries(
    Object.entries(totals).map(([technicianId, { sum, count }]) => [
      technicianId,
      { count, average: sum / count },
    ]),
  );
}

/**
 * Reads the salon's reviews and summarises them per technician.
 *
 * A failure is deliberately silent for the caller: the surfaces that use this
 * show no rating rather than a stale or invented one, which is the honest
 * fallback. (The Reviews app itself reports the failure.)
 */
export function useTechnicianReviews(
  salonSlug: string | null,
): TechnicianReviewSummaries {
  const [summaries, setSummaries] = useState<TechnicianReviewSummaries>(EMPTY);

  const load = useCallback(async (slug: string, signal: AbortSignal) => {
    try {
      const response = await fetch(
        `/api/admin/reviews?salonSlug=${encodeURIComponent(slug)}`,
        { signal },
      );
      if (!response.ok) {
        throw new Error('Failed to load reviews');
      }
      const payload = await response.json();
      const reviews = (payload?.data?.reviews ?? []) as ReviewRow[];
      setSummaries({
        byTechnician: summarizeTechnicianReviews(reviews),
        loaded: true,
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        return;
      }
      // No reviews we can vouch for → show none.
      setSummaries({ byTechnician: {}, loaded: false });
    }
  }, []);

  useEffect(() => {
    if (!salonSlug) {
      setSummaries(EMPTY);
      return;
    }
    const controller = new AbortController();
    void load(salonSlug, controller.signal);
    return () => controller.abort();
  }, [salonSlug, load]);

  return summaries;
}
