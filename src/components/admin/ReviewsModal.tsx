'use client';

/**
 * ReviewsModal Component
 *
 * iOS-style reviews display modal.
 * Features:
 * - Coming Soon placeholder for Google Reviews integration
 * - Beautiful placeholder UI with call to action
 */

import { motion } from 'framer-motion';
import {
  ExternalLink,
  Sparkles,
  Star,
} from 'lucide-react';

import { BackButton, ModalHeader } from './AppModal';

type ReviewsModalProps = {
  onClose: () => void;
};

/**
 * Star Rating Component (decorative)
 */
function StarRating({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <Star
          key={star}
          className={`${star <= rating ? 'fill-[#FFD60A] text-[#FFD60A]' : 'text-gray-200'}`}
          style={{ width: size, height: size }}
        />
      ))}
    </div>
  );
}

/**
 * Coming Soon Card Component
 */
function ComingSoonCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      className="rounded-[22px] bg-white p-6 text-center shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
    >
      {/* Icon */}
      <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-[#FFD60A] to-[#FF9500]">
        <Star className="size-10 fill-white text-white" />
      </div>

      {/* Title */}
      <h2 className="mb-2 text-[22px] font-bold text-[#1C1C1E]">
        Reviews Coming Soon
      </h2>

      {/* Description */}
      <p className="mx-auto mb-6 max-w-xs text-[15px] leading-relaxed text-[#8E8E93]">
        We&apos;re working on integrating Google Reviews so you can manage all your reviews in one place.
      </p>

      {/* Preview Stars */}
      <div className="mb-6 flex justify-center">
        <StarRating rating={5} size={24} />
      </div>

      {/* Features List */}
      <div className="mb-6 rounded-[16px] bg-[#F2F2F7] p-4 text-left">
        <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
          Coming Features
        </h3>
        <div className="space-y-3">
          {[
            'View all Google Reviews in one place',
            'Respond to reviews directly',
            'Get notified of new reviews',
            'Track your rating over time',
          ].map((feature, index) => (
            <motion.div
              key={feature}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * index }}
              className="flex items-center gap-2"
            >
              <Sparkles className="size-4 shrink-0 text-[#FFD60A]" />
              <span className="text-[14px] text-[#1C1C1E]">{feature}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Google Link */}
      <a
        href="https://business.google.com"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-[15px] font-medium text-[#007AFF] transition-opacity active:opacity-50"
      >
        <span>Manage on Google Business</span>
        <ExternalLink className="size-4" />
      </a>
    </motion.div>
  );
}

/**
 * Placeholder Review Cards (decorative)
 */
function PlaceholderReviews() {
  return (
    <div className="space-y-3 opacity-50">
      {[1, 2].map(i => (
        <div
          key={i}
          className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
        >
          <div className="mb-3 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 animate-pulse rounded-full bg-gray-200" />
              <div>
                <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
                <div className="mt-1 h-3 w-16 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
            <StarRating rating={5} size={14} />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReviewsModal({ onClose }: ReviewsModalProps) {
  return (
    <div className="flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Reviews"
          subtitle="Google Reviews"
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {/* Coming Soon Card */}
        <ComingSoonCard />

        {/* Placeholder Reviews */}
        <div className="mt-6">
          <h3 className="mb-3 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
            Preview
          </h3>
          <PlaceholderReviews />
        </div>
      </div>
    </div>
  );
}
