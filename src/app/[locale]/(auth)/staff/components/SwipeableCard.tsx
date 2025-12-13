'use client';

import { useCallback, useRef, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

type SwipeableCardProps = {
  children: React.ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  onLongPress?: () => void;
  onTap?: () => void;
  /** Whether swipe right action is disabled */
  swipeRightDisabled?: boolean;
  /** Whether swipe left action is disabled */
  swipeLeftDisabled?: boolean;
  /** Label for swipe right action */
  swipeRightLabel?: string;
  /** Label for swipe left action */
  swipeLeftLabel?: string;
  /** Whether any action is in progress */
  isLoading?: boolean;
};

// =============================================================================
// Constants
// =============================================================================

const SWIPE_THRESHOLD = 80; // pixels
const LONG_PRESS_DURATION = 550; // ms
const SWIPE_RATIO = 1.2; // abs(dx) must be > abs(dy) * ratio

// =============================================================================
// Swipeable Card Component
// =============================================================================

export function SwipeableCard({
  children,
  onSwipeRight,
  onSwipeLeft,
  onLongPress,
  onTap,
  swipeRightDisabled = false,
  swipeLeftDisabled = false,
  swipeRightLabel = 'Start',
  swipeLeftLabel = 'Photos',
  isLoading = false,
}: SwipeableCardProps) {
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentXRef = useRef(0);
  const isHorizontalSwipeRef = useRef(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const didLongPressRef = useRef(false);
  const startTimeRef = useRef(0);

  // =============================================================================
  // Haptic Feedback
  // =============================================================================

  const triggerHaptic = useCallback(() => {
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  }, []);

  // =============================================================================
  // Long Press Handler
  // =============================================================================

  const startLongPressTimer = useCallback(() => {
    didLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      triggerHaptic();
      onLongPress?.();
    }, LONG_PRESS_DURATION);
  }, [onLongPress, triggerHaptic]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // =============================================================================
  // Touch Handlers
  // =============================================================================

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isLoading) {
      return;
    }

    const touch = e.touches[0];
    if (!touch) {
      return;
    }

    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    currentXRef.current = touch.clientX;
    startTimeRef.current = Date.now();
    isHorizontalSwipeRef.current = false;
    setIsPressed(true);

    startLongPressTimer();
  }, [isLoading, startLongPressTimer]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isLoading) {
      return;
    }

    const touch = e.touches[0];
    if (!touch) {
      return;
    }

    const dx = touch.clientX - startXRef.current;
    const dy = touch.clientY - startYRef.current;

    // Determine if this is a horizontal swipe
    // Only check once at the beginning of the gesture
    if (!isDragging && !isHorizontalSwipeRef.current) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        // Check if horizontal movement dominates
        if (Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) {
          isHorizontalSwipeRef.current = true;
          setIsDragging(true);
          clearLongPressTimer();
        } else {
          // Vertical scroll - cancel gesture tracking
          clearLongPressTimer();
          setIsPressed(false);
          return;
        }
      }
    }

    if (isHorizontalSwipeRef.current) {
      currentXRef.current = touch.clientX;

      // Limit swipe distance and apply resistance at edges
      let limitedDx = dx;

      // Apply resistance if action is disabled
      if (dx > 0 && swipeRightDisabled) {
        limitedDx = dx * 0.3;
      } else if (dx < 0 && swipeLeftDisabled) {
        limitedDx = dx * 0.3;
      }

      // Max swipe distance
      limitedDx = Math.max(-150, Math.min(150, limitedDx));

      setTranslateX(limitedDx);
    }
  }, [isLoading, isDragging, swipeRightDisabled, swipeLeftDisabled, clearLongPressTimer]);

  const handleTouchEnd = useCallback(() => {
    clearLongPressTimer();
    setIsPressed(false);

    if (isLoading) {
      setTranslateX(0);
      setIsDragging(false);
      return;
    }

    const dx = currentXRef.current - startXRef.current;
    const duration = Date.now() - startTimeRef.current;

    // Check for tap (short duration, minimal movement)
    if (!isDragging && !didLongPressRef.current && duration < 300 && Math.abs(dx) < 10) {
      onTap?.();
      setTranslateX(0);
      setIsDragging(false);
      return;
    }

    // Check for swipe completion
    if (isDragging) {
      if (dx > SWIPE_THRESHOLD && !swipeRightDisabled && onSwipeRight) {
        triggerHaptic();
        onSwipeRight();
      } else if (dx < -SWIPE_THRESHOLD && !swipeLeftDisabled && onSwipeLeft) {
        triggerHaptic();
        onSwipeLeft();
      }
    }

    // Reset
    setTranslateX(0);
    setIsDragging(false);
    isHorizontalSwipeRef.current = false;
  }, [
    isLoading,
    isDragging,
    swipeRightDisabled,
    swipeLeftDisabled,
    onSwipeRight,
    onSwipeLeft,
    onTap,
    clearLongPressTimer,
    triggerHaptic,
  ]);

  // =============================================================================
  // Render
  // =============================================================================

  // Calculate reveal opacity based on swipe distance
  const rightRevealOpacity = Math.min(1, Math.max(0, translateX / SWIPE_THRESHOLD));
  const leftRevealOpacity = Math.min(1, Math.max(0, -translateX / SWIPE_THRESHOLD));

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{ touchAction: 'pan-y' }}
    >
      {/* Right Swipe Reveal (Green - Start) */}
      <div
        className="absolute inset-y-0 left-0 flex w-24 items-center justify-center rounded-l-2xl"
        style={{
          backgroundColor: swipeRightDisabled ? '#9CA3AF' : '#059669',
          opacity: rightRevealOpacity,
        }}
      >
        <span className="text-sm font-semibold text-white">
          {swipeRightLabel}
        </span>
      </div>

      {/* Left Swipe Reveal (Blue - Photos) */}
      <div
        className="absolute inset-y-0 right-0 flex w-24 items-center justify-center rounded-r-2xl"
        style={{
          backgroundColor: swipeLeftDisabled ? '#9CA3AF' : '#2563EB',
          opacity: leftRevealOpacity,
        }}
      >
        <span className="text-sm font-semibold text-white">
          {swipeLeftLabel}
        </span>
      </div>

      {/* Card Content */}
      <div
        className="relative select-none"
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
          scale: isPressed && !isDragging ? '0.98' : '1',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

export default SwipeableCard;
