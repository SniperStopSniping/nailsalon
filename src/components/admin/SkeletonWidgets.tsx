'use client';

/**
 * SkeletonWidgets Component
 *
 * iOS-style skeleton loading state for the analytics page.
 * Features:
 * - Shimmer animation effect
 * - Matches exact layout of AnalyticsWidgets
 * - Smooth fade-in transition
 */

import type { Transition } from 'framer-motion';
import { motion } from 'framer-motion';

// Shimmer animation keyframes
const shimmerTransition: Transition = {
  repeat: Infinity,
  duration: 1.5,
  ease: 'linear',
};

const shimmerAnimation = {
  initial: { x: '-100%' },
  animate: { x: '100%' },
};

/**
 * Skeleton Box with Shimmer
 */
function SkeletonBox({ 
  className = '', 
  style = {} 
}: { 
  className?: string; 
  style?: React.CSSProperties;
}) {
  return (
    <div 
      className={`relative overflow-hidden bg-gray-200 rounded-lg ${className}`}
      style={style}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
        initial={shimmerAnimation.initial}
        animate={shimmerAnimation.animate}
        transition={shimmerTransition}
      />
    </div>
  );
}

/**
 * Skeleton Card Container
 */
function SkeletonCard({ 
  children, 
  className = '' 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-[22px] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] ${className}`}>
      {children}
    </div>
  );
}

/**
 * Time Filter Skeleton
 */
function TimeFilterSkeleton() {
  return (
    <div className="bg-[#767680]/10 p-0.5 rounded-lg flex mb-6">
      {['Daily', 'Weekly', 'Monthly', 'Yearly'].map((_, index) => (
        <div
          key={index}
          className={`flex-1 py-1.5 rounded-[6px] ${index === 1 ? 'bg-white shadow-sm' : ''}`}
        >
          <SkeletonBox className="h-4 mx-2" />
        </div>
      ))}
    </div>
  );
}

/**
 * Revenue Card Skeleton
 */
function RevenueCardSkeleton() {
  return (
    <SkeletonCard>
      <TimeFilterSkeleton />
      
      <div className="flex justify-between items-start mb-4">
        <div>
          <SkeletonBox className="h-3 w-24 mb-2" />
          <SkeletonBox className="h-10 w-32" />
        </div>
        <SkeletonBox className="h-6 w-16 rounded-full" />
      </div>
      
      {/* Chart skeleton */}
      <div className="h-[120px] flex items-end justify-between gap-1 mb-2">
        {[0.6, 0.8, 0.5, 0.9, 0.7, 0.85, 0.65].map((height, i) => (
          <SkeletonBox 
            key={i} 
            className="flex-1 rounded-t-sm" 
            style={{ height: `${height * 100}%` }}
          />
        ))}
      </div>
      
      {/* Chart labels */}
      <div className="flex justify-between px-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((_, i) => (
          <SkeletonBox key={i} className="h-3 w-6" />
        ))}
      </div>
    </SkeletonCard>
  );
}

/**
 * Utilization Card Skeleton
 */
function UtilizationCardSkeleton() {
  return (
    <SkeletonCard className="flex flex-col items-center justify-between aspect-square">
      <div className="w-full text-left">
        <SkeletonBox className="h-3 w-20" />
      </div>
      
      {/* Rings skeleton */}
      <div className="relative w-[100px] h-[100px]">
        <SkeletonBox className="absolute inset-0 rounded-full" style={{ borderRadius: '50%' }} />
        <div className="absolute inset-[12px]">
          <SkeletonBox className="w-full h-full rounded-full" style={{ borderRadius: '50%' }} />
        </div>
        <div className="absolute inset-[24px]">
          <SkeletonBox className="w-full h-full rounded-full" style={{ borderRadius: '50%' }} />
        </div>
      </div>
      
      {/* Legend */}
      <div className="flex gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-1">
            <SkeletonBox className="w-2 h-2 rounded-full" />
            <SkeletonBox className="h-3 w-6" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

/**
 * Service Mix Card Skeleton
 */
function ServiceMixCardSkeleton() {
  return (
    <SkeletonCard className="aspect-square flex flex-col">
      <SkeletonBox className="h-3 w-24 mb-4" />
      
      <div className="flex-1 space-y-4">
        {[0.45, 0.30, 0.15].map((width, i) => (
          <div key={i}>
            <div className="flex justify-between mb-1">
              <SkeletonBox className="h-3 w-16" />
              <SkeletonBox className="h-3 w-8" />
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <SkeletonBox 
                className="h-full rounded-full" 
                style={{ width: `${width * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

/**
 * Staff Leaderboard Skeleton
 */
function StaffLeaderboardSkeleton() {
  return (
    <SkeletonCard className="!p-0 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
        <SkeletonBox className="h-4 w-28" />
        <SkeletonBox className="h-5 w-5 rounded" />
      </div>
      
      {/* Staff rows */}
      <div className="divide-y divide-gray-100">
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SkeletonBox className="w-3 h-3" />
              <SkeletonBox className="w-10 h-10 rounded-full" />
              <div>
                <SkeletonBox className="h-4 w-24 mb-1" />
                <SkeletonBox className="h-3 w-16" />
              </div>
            </div>
            <SkeletonBox className="h-4 w-16" />
          </div>
        ))}
      </div>
      
      {/* Footer */}
      <div className="p-3 text-center border-t border-gray-100">
        <SkeletonBox className="h-4 w-24 mx-auto" />
      </div>
    </SkeletonCard>
  );
}

/**
 * Main Skeleton Widgets Component
 */
export function SkeletonWidgets() {
  return (
    <div className="min-h-full w-full bg-[#F2F2F7] text-black font-sans pb-10">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="px-5 pt-6 space-y-6 max-w-md mx-auto"
      >
        {/* Header & Date */}
        <div>
          <SkeletonBox className="h-10 w-48 mb-2" />
          <SkeletonBox className="h-4 w-36" />
        </div>

        {/* Revenue Card */}
        <RevenueCardSkeleton />

        {/* Utilization & Service Mix Grid */}
        <div className="grid grid-cols-2 gap-4">
          <UtilizationCardSkeleton />
          <ServiceMixCardSkeleton />
        </div>

        {/* Staff Leaderboard */}
        <StaffLeaderboardSkeleton />
      </motion.div>
    </div>
  );
}

