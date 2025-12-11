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
  Star, 
  ExternalLink,
  Sparkles,
} from 'lucide-react';

import { ModalHeader, BackButton } from './AppModal';

interface ReviewsModalProps {
  onClose: () => void;
}

/**
 * Star Rating Component (decorative)
 */
function StarRating({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${star <= rating ? 'text-[#FFD60A] fill-[#FFD60A]' : 'text-gray-200'}`}
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
      className="bg-white rounded-[22px] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] text-center"
    >
      {/* Icon */}
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-[#FFD60A] to-[#FF9500] flex items-center justify-center">
        <Star className="w-10 h-10 text-white fill-white" />
      </div>
      
      {/* Title */}
      <h2 className="text-[22px] font-bold text-[#1C1C1E] mb-2">
        Reviews Coming Soon
      </h2>
      
      {/* Description */}
      <p className="text-[15px] text-[#8E8E93] leading-relaxed max-w-xs mx-auto mb-6">
        We&apos;re working on integrating Google Reviews so you can manage all your reviews in one place.
      </p>
      
      {/* Preview Stars */}
      <div className="flex justify-center mb-6">
        <StarRating rating={5} size={24} />
      </div>
      
      {/* Features List */}
      <div className="bg-[#F2F2F7] rounded-[16px] p-4 text-left mb-6">
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-3">
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
              <Sparkles className="w-4 h-4 text-[#FFD60A] flex-shrink-0" />
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
        className="inline-flex items-center gap-2 text-[15px] font-medium text-[#007AFF] active:opacity-50 transition-opacity"
      >
        <span>Manage on Google Business</span>
        <ExternalLink className="w-4 h-4" />
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
      {[1, 2].map((i) => (
        <div
          key={i}
          className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse" />
              <div>
                <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                <div className="h-3 w-16 bg-gray-100 rounded mt-1 animate-pulse" />
              </div>
            </div>
            <StarRating rating={5} size={14} />
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-gray-100 rounded w-full animate-pulse" />
            <div className="h-3 bg-gray-100 rounded w-3/4 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReviewsModal({ onClose }: ReviewsModalProps) {
  return (
    <div className="min-h-full w-full bg-[#F2F2F7] text-black font-sans flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Reviews"
          subtitle="Google Reviews"
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-10 px-4">
        {/* Coming Soon Card */}
        <ComingSoonCard />
        
        {/* Placeholder Reviews */}
        <div className="mt-6">
          <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-3 px-1">
            Preview
          </h3>
          <PlaceholderReviews />
        </div>
      </div>
    </div>
  );
}
