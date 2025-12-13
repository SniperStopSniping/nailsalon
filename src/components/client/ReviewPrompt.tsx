'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Check, Star, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { n5 } from '@/theme';
import { cn } from '@/utils/Helpers';

// =============================================================================
// TYPES
// =============================================================================

type ReviewPromptProps = {
  appointmentId: string;
  // Display props only - not used for auth (session cookie handles that)
  technicianName?: string;
  serviceName?: string;
  appointmentDate?: string;
  onReviewSubmitted?: () => void;
  onDismiss?: () => void;
};

// =============================================================================
// REVIEW PROMPT COMPONENT
// =============================================================================

export function ReviewPrompt({
  appointmentId,
  technicianName,
  serviceName,
  appointmentDate,
  onReviewSubmitted,
  onDismiss,
}: ReviewPromptProps) {
  const { salonSlug } = useSalon();

  const [isOpen, setIsOpen] = useState(true);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDismiss = useCallback(() => {
    setIsOpen(false);
    onDismiss?.();
  }, [onDismiss]);

  const handleSubmit = useCallback(async () => {
    if (rating === 0) {
      setError('Please select a rating');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Auth is handled via session cookie - no phone/name in body
      const response = await fetch('/api/client/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Important: send cookies for auth
        body: JSON.stringify({
          appointmentId,
          salonSlug,
          rating,
          comment: comment.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to submit review');
      }

      setIsSubmitted(true);
      onReviewSubmitted?.();

      // Auto-close after success
      setTimeout(() => {
        setIsOpen(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }, [rating, comment, appointmentId, salonSlug, onReviewSubmitted]);

  if (!isOpen) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="border border-[var(--n5-border)] bg-[var(--n5-bg-card)] p-5 shadow-[var(--n5-shadow-md)]"
        style={{ borderRadius: n5.radiusCard }}
      >
        {isSubmitted ? (
          // Success state
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center gap-3 py-4"
          >
            <div
              className="flex size-12 items-center justify-center bg-green-100 text-green-600"
              style={{ borderRadius: n5.radiusPill }}
            >
              <Check className="size-6" />
            </div>
            <p className="font-body text-sm font-medium text-[var(--n5-ink-main)]">
              Thank you for your review!
            </p>
          </motion.div>
        ) : (
          <>
            {/* Header */}
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="font-heading text-base font-semibold text-[var(--n5-ink-main)]">
                  How was your visit?
                </h3>
                {(technicianName || serviceName) && (
                  <p className="font-body mt-0.5 text-xs text-[var(--n5-ink-muted)]">
                    {serviceName && <span>{serviceName}</span>}
                    {serviceName && technicianName && <span> with </span>}
                    {technicianName && <span className="font-medium">{technicianName}</span>}
                    {appointmentDate && (
                      <span className="text-[var(--n5-ink-muted)]/60">
                        {' '}
                        ·
                        {appointmentDate}
                      </span>
                    )}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                className="p-1 text-[var(--n5-ink-muted)] transition-colors hover:text-[var(--n5-ink-main)]"
                aria-label="Dismiss"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Star Rating */}
            <div className="mb-4 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1 transition-transform active:scale-90"
                  aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                >
                  <Star
                    className={cn(
                      'size-8 transition-colors',
                      (hoverRating || rating) >= star
                        ? 'fill-[var(--n5-accent)] text-[var(--n5-accent)]'
                        : 'text-[var(--n5-border)] fill-transparent',
                    )}
                  />
                </button>
              ))}
            </div>

            {/* Rating label */}
            <p className="font-body mb-4 text-center text-xs text-[var(--n5-ink-muted)]">
              {rating === 0 && 'Tap to rate'}
              {rating === 1 && 'Poor'}
              {rating === 2 && 'Fair'}
              {rating === 3 && 'Good'}
              {rating === 4 && 'Great'}
              {rating === 5 && 'Excellent!'}
            </p>

            {/* Comment (optional) */}
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Add a comment (optional)"
              className="font-body focus:ring-[var(--n5-accent)]/30 w-full resize-none border border-[var(--n5-border)] bg-[var(--n5-bg-surface)] px-3 py-2 text-sm text-[var(--n5-ink-main)] focus:outline-none focus:ring-2"
              style={{ borderRadius: n5.radiusMd }}
              rows={3}
              maxLength={1000}
            />

            {/* Error message */}
            {error && (
              <p className="font-body mt-2 text-xs text-red-500">{error}</p>
            )}

            {/* Submit button */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || rating === 0}
              className={cn(
                'mt-4 w-full py-3 font-body text-sm font-medium transition-all',
                rating > 0
                  ? 'bg-[var(--n5-button-primary-bg)] text-[var(--n5-button-primary-text)]'
                  : 'cursor-not-allowed bg-[var(--n5-bg-surface)] text-[var(--n5-ink-muted)]',
              )}
              style={{ borderRadius: n5.radiusMd }}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Review'}
            </button>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

export default ReviewPrompt;
