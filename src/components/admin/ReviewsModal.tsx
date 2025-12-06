'use client';

/**
 * ReviewsModal Component
 *
 * iOS-style reviews display modal.
 * Features:
 * - Star rating display
 * - Review cards with client info
 * - Rating summary stats
 * - Filter by rating
 */

import { motion } from 'framer-motion';
import { 
  Star, 
  MessageCircle,
  ThumbsUp,
  Filter,
} from 'lucide-react';
import { useState } from 'react';

import { ModalHeader, BackButton } from './AppModal';

interface ReviewsModalProps {
  onClose: () => void;
}

// Review type
interface Review {
  id: string;
  clientName: string;
  clientInitials: string;
  rating: number;
  comment: string;
  date: string;
  serviceName: string;
  technicianName: string;
  helpful: number;
}

// Mock reviews data
const MOCK_REVIEWS: Review[] = [
  {
    id: '1',
    clientName: 'Sarah M.',
    clientInitials: 'SM',
    rating: 5,
    comment: 'Absolutely love my nails! The attention to detail is amazing. Emma was so patient with my design requests.',
    date: '2025-12-05',
    serviceName: 'Gel Manicure',
    technicianName: 'Emma',
    helpful: 3,
  },
  {
    id: '2',
    clientName: 'Jessica L.',
    clientInitials: 'JL',
    rating: 5,
    comment: 'Best nail salon in the area! Clean, professional, and the results are always perfect.',
    date: '2025-12-04',
    serviceName: 'BIAB Manicure',
    technicianName: 'Sarah',
    helpful: 5,
  },
  {
    id: '3',
    clientName: 'Amanda K.',
    clientInitials: 'AK',
    rating: 4,
    comment: 'Great service as always. Only giving 4 stars because I had to wait a bit past my appointment time.',
    date: '2025-12-03',
    serviceName: 'Spa Pedicure',
    technicianName: 'Kim',
    helpful: 1,
  },
  {
    id: '4',
    clientName: 'Michelle R.',
    clientInitials: 'MR',
    rating: 5,
    comment: 'The nail art was incredible! Everyone keeps asking where I got my nails done. Will definitely be back!',
    date: '2025-12-02',
    serviceName: 'Nail Art',
    technicianName: 'Emma',
    helpful: 8,
  },
  {
    id: '5',
    clientName: 'Rachel T.',
    clientInitials: 'RT',
    rating: 4,
    comment: 'Very relaxing experience. The pedicure massage was heavenly. Would recommend!',
    date: '2025-12-01',
    serviceName: 'Classic Pedicure',
    technicianName: 'Sarah',
    helpful: 2,
  },
];

// Rating filter options
const RATING_FILTERS = [
  { value: 0, label: 'All' },
  { value: 5, label: '5 Stars' },
  { value: 4, label: '4 Stars' },
  { value: 3, label: '3 Stars' },
];

/**
 * Star Rating Component
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
 * Rating Summary Component
 */
function RatingSummary({ reviews }: { reviews: Review[] }) {
  const totalReviews = reviews.length;
  const avgRating = totalReviews > 0 
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews 
    : 0;
  
  // Count per rating
  const ratingCounts = [5, 4, 3, 2, 1].map(rating => ({
    rating,
    count: reviews.filter(r => r.rating === rating).length,
    percent: totalReviews > 0 
      ? (reviews.filter(r => r.rating === rating).length / totalReviews) * 100 
      : 0,
  }));

  return (
    <div className="bg-white rounded-[22px] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4">
      <div className="flex items-start gap-6">
        {/* Overall Rating */}
        <div className="text-center">
          <div className="text-[48px] font-bold text-[#1C1C1E] leading-none">
            {avgRating.toFixed(1)}
          </div>
          <StarRating rating={Math.round(avgRating)} size={14} />
          <div className="text-[13px] text-[#8E8E93] mt-1">
            {totalReviews} reviews
          </div>
        </div>
        
        {/* Rating Breakdown */}
        <div className="flex-1 space-y-1.5">
          {ratingCounts.map(({ rating, count, percent }) => (
            <div key={rating} className="flex items-center gap-2">
              <span className="text-[12px] text-[#8E8E93] w-3">{rating}</span>
              <Star className="w-3 h-3 text-[#FFD60A] fill-[#FFD60A]" />
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percent}%` }}
                  transition={{ duration: 0.5, delay: 0.1 * (5 - rating) }}
                  className="h-full bg-[#FFD60A] rounded-full"
                />
              </div>
              <span className="text-[12px] text-[#8E8E93] w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Filter Pills Component
 */
function FilterPills({ 
  active, 
  onChange 
}: { 
  active: number; 
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
      <div className="flex items-center gap-1 text-[#8E8E93] mr-1">
        <Filter className="w-4 h-4" />
      </div>
      {RATING_FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          onClick={() => onChange(filter.value)}
          className={`
            px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap
            transition-all
            ${active === filter.value
              ? 'bg-[#FFD60A] text-black'
              : 'bg-white text-[#1C1C1E] border border-gray-200'
            }
          `}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Review Card Component
 */
function ReviewCard({ review }: { review: Review }) {
  const reviewDate = new Date(review.date);
  const formattedDate = reviewDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#f6d365] to-[#fda085] flex items-center justify-center text-white text-[13px] font-bold">
            {review.clientInitials}
          </div>
          <div>
            <div className="text-[15px] font-semibold text-[#1C1C1E]">{review.clientName}</div>
            <div className="text-[12px] text-[#8E8E93]">{formattedDate}</div>
          </div>
        </div>
        <StarRating rating={review.rating} size={14} />
      </div>
      
      {/* Comment */}
      <p className="text-[15px] text-[#1C1C1E] leading-relaxed mb-3">
        {review.comment}
      </p>
      
      {/* Service & Tech */}
      <div className="flex items-center gap-2 text-[12px] text-[#8E8E93] mb-3">
        <span className="px-2 py-0.5 bg-gray-100 rounded-full">{review.serviceName}</span>
        <span>with {review.technicianName}</span>
      </div>
      
      {/* Helpful */}
      <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
        <button
          type="button"
          className="flex items-center gap-1.5 text-[13px] text-[#8E8E93] active:text-[#007AFF] transition-colors"
        >
          <ThumbsUp className="w-4 h-4" />
          Helpful ({review.helpful})
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 text-[13px] text-[#8E8E93] active:text-[#007AFF] transition-colors ml-4"
        >
          <MessageCircle className="w-4 h-4" />
          Reply
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Empty State Component
 */
function EmptyState({ filter }: { filter: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8">
      <div className="w-16 h-16 rounded-full bg-[#F2F2F7] flex items-center justify-center mb-4">
        <Star className="w-8 h-8 text-[#8E8E93]" />
      </div>
      <h3 className="text-[17px] font-semibold text-[#1C1C1E] mb-1">
        No Reviews
      </h3>
      <p className="text-[15px] text-[#8E8E93] text-center">
        {filter > 0 
          ? `No ${filter}-star reviews yet`
          : 'Reviews will appear here after client visits'
        }
      </p>
    </div>
  );
}

export function ReviewsModal({ onClose }: ReviewsModalProps) {
  const [ratingFilter, setRatingFilter] = useState(0);
  
  // Filter reviews
  const filteredReviews = ratingFilter === 0 
    ? MOCK_REVIEWS 
    : MOCK_REVIEWS.filter(r => r.rating === ratingFilter);

  return (
    <div className="min-h-full w-full bg-[#F2F2F7] text-black font-sans flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Reviews"
          subtitle={`${MOCK_REVIEWS.length} total`}
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-10 px-4">
        {/* Rating Summary */}
        <RatingSummary reviews={MOCK_REVIEWS} />
        
        {/* Filters */}
        <FilterPills active={ratingFilter} onChange={setRatingFilter} />
        
        {/* Reviews List */}
        {filteredReviews.length === 0 ? (
          <EmptyState filter={ratingFilter} />
        ) : (
          <div className="space-y-3">
            {filteredReviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

