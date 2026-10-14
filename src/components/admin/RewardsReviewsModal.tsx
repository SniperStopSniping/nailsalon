'use client';

import { BackButton, ModalHeader } from './AppModal';
import { ReviewsModal } from './ReviewsModal';

// Saved links now open recorded feedback. New customer programs are postponed.
// Their historical data remains available through the owner records APIs.
export function RewardsReviewsModal({ onClose, reviewsAvailable = true }: {
  onClose: () => void;
  initialView?: 'home' | 'rewards' | 'referrals' | 'reviews' | 'offers';
  rewardsAvailable?: boolean;
  reviewsAvailable?: boolean;
}) {
  if (!reviewsAvailable) {
    return (
      <div className="min-h-full bg-[var(--owner-ground)] text-[var(--owner-ink)]">
        <ModalHeader title="Client reviews" leftAction={<BackButton onClick={onClose} label="More" />} />
        <p className="p-4">Recorded reviews are unavailable for this workspace.</p>
      </div>
    );
  }
  return <ReviewsModal onClose={onClose} />;
}
