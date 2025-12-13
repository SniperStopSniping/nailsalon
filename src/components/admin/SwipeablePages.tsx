'use client';

/**
 * SwipeablePages Component
 *
 * iOS-style horizontal swipe navigation between pages.
 * Features:
 * - iOS spring physics (stiffness: 280, damping: 26)
 * - Drag gesture with velocity-based page snapping
 * - Page indicator dots
 * - Pull-to-refresh on first page
 */

import type { PanInfo } from 'framer-motion';
import { motion, useAnimation } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

// iOS Spring Physics Config
const SPRING_CONFIG = {
  type: 'spring' as const,
  stiffness: 280,
  damping: 26,
};

// Swipe threshold for page change
const SWIPE_THRESHOLD = 50;
const VELOCITY_THRESHOLD = 500;

// Pull-to-refresh thresholds
const PULL_THRESHOLD = 80;
const PULL_MAX = 120;

type SwipeablePagesProps = {
  children: ReactNode[];
  onPageChange?: (page: number) => void;
  onRefresh?: () => Promise<void>;
  initialPage?: number;
  lastUpdated?: Date | null;
};

export function SwipeablePages({
  children,
  onPageChange,
  onRefresh,
  initialPage = 0,
  lastUpdated,
}: SwipeablePagesProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [canPull, setCanPull] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const controls = useAnimation();
  const pullStartY = useRef<number | null>(null);

  // Measure container width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Animate to current page
  useEffect(() => {
    if (containerWidth > 0) {
      controls.start({
        x: -currentPage * containerWidth,
        transition: SPRING_CONFIG,
      });
    }
  }, [currentPage, containerWidth, controls]);

  // Check if first page is at top (for pull-to-refresh)
  const checkScrollTop = useCallback(() => {
    if (currentPage === 0 && pageRefs.current[0]) {
      return pageRefs.current[0].scrollTop <= 0;
    }
    return false;
  }, [currentPage]);

  // Handle touch start for pull-to-refresh
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (currentPage === 0 && checkScrollTop() && !isRefreshing) {
      pullStartY.current = e.touches[0]?.clientY ?? null;
      setCanPull(true);
    } else {
      setCanPull(false);
    }
  }, [currentPage, checkScrollTop, isRefreshing]);

  // Handle touch move for pull-to-refresh
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!canPull || pullStartY.current === null || isRefreshing) {
      return;
    }

    const currentY = e.touches[0]?.clientY ?? 0;
    const diff = currentY - pullStartY.current;

    if (diff > 0 && checkScrollTop()) {
      // Apply resistance to pull
      const resistance = 0.5;
      const pull = Math.min(diff * resistance, PULL_MAX);
      setPullDistance(pull);
    }
  }, [canPull, checkScrollTop, isRefreshing]);

  // Handle touch end for pull-to-refresh
  const handleTouchEnd = useCallback(async () => {
    if (pullDistance >= PULL_THRESHOLD && onRefresh && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD); // Keep at threshold during refresh

      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
    pullStartY.current = null;
  }, [pullDistance, onRefresh, isRefreshing]);

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const { offset, velocity } = info;
    const pageCount = children.length;

    let newPage = currentPage;

    // Determine if we should change page based on drag distance or velocity
    if (Math.abs(offset.x) > SWIPE_THRESHOLD || Math.abs(velocity.x) > VELOCITY_THRESHOLD) {
      if (offset.x > 0 || velocity.x > VELOCITY_THRESHOLD) {
        // Swiped right - go to previous page
        newPage = Math.max(0, currentPage - 1);
      } else {
        // Swiped left - go to next page
        newPage = Math.min(pageCount - 1, currentPage + 1);
      }
    }

    setCurrentPage(newPage);
    onPageChange?.(newPage);
  };

  // Format last updated time
  const formatLastUpdated = (date: Date | null | undefined): string => {
    if (!date) {
      return '';
    }
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative size-full overflow-hidden"
      style={{ touchAction: 'pan-y' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {currentPage === 0 && (pullDistance > 0 || isRefreshing) && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center justify-end"
          style={{
            height: pullDistance,
            top: 0,
            transition: isRefreshing ? 'none' : 'height 0.1s ease-out',
          }}
        >
          <motion.div
            className="flex flex-col items-center pb-2"
            animate={{
              rotate: isRefreshing ? 360 : pullDistance >= PULL_THRESHOLD ? 180 : 0,
            }}
            transition={{
              rotate: isRefreshing
                ? { repeat: Infinity, duration: 1, ease: 'linear' }
                : { duration: 0.2 },
            }}
          >
            <RefreshCw
              className={`size-6 ${pullDistance >= PULL_THRESHOLD || isRefreshing ? 'text-[#007AFF]' : 'text-[#8E8E93]'}`}
            />
          </motion.div>
          {lastUpdated && !isRefreshing && pullDistance >= PULL_THRESHOLD && (
            <span className="pb-1 text-[11px] text-[#8E8E93]">
              Last updated
              {' '}
              {formatLastUpdated(lastUpdated)}
            </span>
          )}
          {isRefreshing && (
            <span className="pb-1 text-[11px] text-[#007AFF]">
              Updating...
            </span>
          )}
        </div>
      )}

      <motion.div
        className="flex h-full"
        style={{
          width: `${children.length * 100}%`,
          marginTop: pullDistance,
          transition: isRefreshing ? 'none' : 'margin-top 0.1s ease-out',
        }}
        drag="x"
        dragConstraints={{
          left: -(children.length - 1) * containerWidth,
          right: 0,
        }}
        dragElastic={0.1}
        onDragEnd={handleDragEnd}
        animate={controls}
      >
        {children.map((child, index) => (
          <div
            key={index}
            ref={(el) => {
              pageRefs.current[index] = el;
            }}
            className="h-full overflow-y-auto"
            style={{ width: containerWidth || '100vw' }}
          >
            {child}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/**
 * Page Indicator Dots
 */
type PageIndicatorProps = {
  pageCount: number;
  currentPage: number;
  onPageSelect?: (page: number) => void;
};

export function PageIndicator({
  pageCount,
  currentPage,
  onPageSelect,
}: PageIndicatorProps) {
  return (
    <div className="flex justify-center gap-2 py-4">
      {Array.from({ length: pageCount }).map((_, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onPageSelect?.(index)}
          className="p-1"
          aria-label={`Go to page ${index + 1}`}
        >
          <motion.div
            className="rounded-full"
            animate={{
              width: index === currentPage ? 8 : 6,
              height: index === currentPage ? 8 : 6,
              backgroundColor: index === currentPage ? '#000000' : 'rgba(0, 0, 0, 0.2)',
            }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </button>
      ))}
    </div>
  );
}
