'use client';

import { motion } from 'framer-motion';
import { ExternalLink, RefreshCw, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

import { BackButton, ModalHeader } from './AppModal';

type ReviewsModalProps = {
  onClose: () => void;
};

type ReviewRowData = {
  id: string;
  appointmentId: string;
  salonClientId: string;
  clientName: string | null;
  clientPhone: string | null;
  technicianId: string | null;
  technicianName: string | null;
  rating: number;
  comment: string | null;
  isPublic: boolean | null;
  adminHidden: boolean | null;
  createdAt: string;
  googleReviewRewardGranted: boolean;
};

type ReviewsResponse = {
  data?: {
    reviews: ReviewRowData[];
    stats: {
      totalReviews: number;
      averageRating: number;
    };
  };
  error?: {
    message?: string;
  };
};

function formatPhone(phone: string | null): string {
  if (!phone) {
    return 'No phone';
  }
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) {
    return phone;
  }
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <Star
          key={star}
          className={`${star <= rating ? 'fill-[#FFD60A] text-[#FFD60A]' : 'text-gray-200'}`}
          style={{ width: 15, height: 15 }}
        />
      ))}
    </div>
  );
}

export function ReviewsModal({ onClose }: ReviewsModalProps) {
  const { salonSlug } = useSalon();
  const [reviews, setReviews] = useState<ReviewRowData[]>([]);
  const [averageRating, setAverageRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantingReviewId, setGrantingReviewId] = useState<string | null>(null);

  const fetchReviews = useCallback(async () => {
    if (!salonSlug) {
      setLoading(false);
      setError('Salon context is missing');
      return;
    }

    try {
      setError(null);
      const response = await fetch(`/api/admin/reviews?salonSlug=${encodeURIComponent(salonSlug)}`);
      const data = await response.json() as ReviewsResponse;

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to load reviews');
      }

      setReviews(data.data?.reviews ?? []);
      setAverageRating(data.data?.stats.averageRating ?? 0);
      setTotalReviews(data.data?.stats.totalReviews ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    void fetchReviews();
  }, [fetchReviews]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchReviews();
  }, [fetchReviews]);

  const grantableCount = useMemo(
    () => reviews.filter(review => !review.googleReviewRewardGranted).length,
    [reviews],
  );

  const handleGrant = useCallback(async (reviewId: string) => {
    if (!salonSlug || grantingReviewId) {
      return;
    }

    setGrantingReviewId(reviewId);

    try {
      const response = await fetch(`/api/admin/reviews/${reviewId}/reward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to grant reward');
      }

      setReviews(current => current.map(review => (
        review.id === reviewId
          ? { ...review, googleReviewRewardGranted: true }
          : review
      )));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant reward');
    } finally {
      setGrantingReviewId(null);
    }
  }, [grantingReviewId, salonSlug]);

  return (
    <div className="flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Reviews"
          subtitle="Manual Google review rewards"
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[22px] bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[20px] font-semibold text-[#1C1C1E]">Review rewards</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-[#8E8E93]">
                After you verify a Google review manually, grant a one-time $15 reward to that client.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="flex size-10 items-center justify-center rounded-full bg-[#F2F2F7] text-[#636366] transition-colors hover:bg-[#E5E5EA]"
              aria-label="Refresh reviews"
            >
              <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-[16px] bg-[#F2F2F7] p-3 text-center">
              <div className="text-[24px] font-semibold text-[#1C1C1E]">{totalReviews}</div>
              <div className="text-[12px] text-[#8E8E93]">Reviews</div>
            </div>
            <div className="rounded-[16px] bg-[#F2F2F7] p-3 text-center">
              <div className="text-[24px] font-semibold text-[#1C1C1E]">{averageRating.toFixed(1)}</div>
              <div className="text-[12px] text-[#8E8E93]">Average</div>
            </div>
            <div className="rounded-[16px] bg-[#F2F2F7] p-3 text-center">
              <div className="text-[24px] font-semibold text-[#1C1C1E]">{grantableCount}</div>
              <div className="text-[12px] text-[#8E8E93]">Grantable</div>
            </div>
          </div>

          <a
            href="https://business.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 text-[14px] font-medium text-[#007AFF]"
          >
            <span>Open Google Business</span>
            <ExternalLink className="size-4" />
          </a>
        </motion.div>

        {error && (
          <div className="mt-4 rounded-[18px] bg-red-50 px-4 py-3 text-[14px] text-red-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-4 rounded-[22px] bg-white p-6 text-center text-[14px] text-[#8E8E93] shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            Loading reviews...
          </div>
        ) : reviews.length === 0 ? (
          <div className="mt-4 rounded-[22px] bg-white p-6 text-center text-[14px] text-[#8E8E93] shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            No reviews yet for this salon.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {reviews.map(review => (
              <motion.div
                key={review.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-[20px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-[#1C1C1E]">
                      {review.clientName || 'Guest client'}
                    </div>
                    <div className="mt-0.5 text-[13px] text-[#8E8E93]">
                      {formatPhone(review.clientPhone)}
                      {review.technicianName ? ` · ${review.technicianName}` : ''}
                    </div>
                    <div className="mt-2">
                      <StarRating rating={review.rating} />
                    </div>
                    {review.comment && (
                      <p className="mt-3 text-[14px] leading-relaxed text-[#3A3A3C]">{review.comment}</p>
                    )}
                    <div className="mt-3 text-[12px] text-[#8E8E93]">{formatDate(review.createdAt)}</div>
                  </div>

                  <div className="shrink-0 text-right">
                    {review.googleReviewRewardGranted ? (
                      <div className="rounded-full bg-green-100 px-3 py-1 text-[12px] font-medium text-green-700">
                        $15 granted
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          void handleGrant(review.id);
                        }}
                        disabled={grantingReviewId === review.id}
                        className="rounded-full bg-[#1C1C1E] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
                      >
                        {grantingReviewId === review.id ? 'Granting...' : 'Grant $15'}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
