'use client';

import { Check, ChevronRight, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { triggerLuxuryConfetti } from '@/utils/confetti';

type RedeemSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  rewardTitle: string;
  pointsCost: number;
};

export default function RedeemSheet({
  isOpen,
  onClose,
  onConfirm,
  rewardTitle,
  pointsCost,
}: RedeemSheetProps) {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [sliderValue, setSliderValue] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  // Reset state when sheet opens
  useEffect(() => {
    if (isOpen) {
      setIsConfirmed(false);
      setSliderValue(0);
      setIsDragging(false);
    }
  }, [isOpen]);

  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Calculate slider value from position
  const calculateValue = useCallback((clientX: number) => {
    if (!sliderRef.current) {
      return 0;
    }
    const rect = sliderRef.current.getBoundingClientRect();
    const thumbWidth = 52; // Approximate thumb width
    const trackWidth = rect.width - thumbWidth;
    const offsetX = clientX - rect.left - thumbWidth / 2;
    const percentage = Math.max(0, Math.min(100, (offsetX / trackWidth) * 100));
    return percentage;
  }, []);

  // Touch/Mouse handlers for smooth dragging
  const handleStart = useCallback((clientX: number) => {
    if (isConfirmed) {
      return;
    }
    setIsDragging(true);
    const value = calculateValue(clientX);
    setSliderValue(value);
  }, [isConfirmed, calculateValue]);

  const handleMove = useCallback((clientX: number) => {
    if (!isDragging || isConfirmed) {
      return;
    }
    const value = calculateValue(clientX);
    setSliderValue(value);
  }, [isDragging, isConfirmed, calculateValue]);

  const handleEnd = useCallback(() => {
    if (!isDragging) {
      return;
    }
    setIsDragging(false);

    // Check if slider reached the end
    if (sliderValue >= 90 && !isConfirmed) {
      handleConfirm();
    } else {
      // Spring back to start
      setSliderValue(0);
    }
  }, [isDragging, sliderValue, isConfirmed]);

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleStart(e.clientX);
  };

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    handleStart(e.touches[0]!.clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    handleMove(e.touches[0]!.clientX);
  };

  // Global mouse/touch move and end
  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handleGlobalMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX);
    };

    const handleGlobalMouseUp = () => {
      handleEnd();
    };

    const handleGlobalTouchMove = (e: TouchEvent) => {
      handleMove(e.touches[0]!.clientX);
    };

    const handleGlobalTouchEnd = () => {
      handleEnd();
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchmove', handleGlobalTouchMove, { passive: true });
    window.addEventListener('touchend', handleGlobalTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchmove', handleGlobalTouchMove);
      window.removeEventListener('touchend', handleGlobalTouchEnd);
    };
  }, [isDragging, handleMove, handleEnd]);

  const handleConfirm = () => {
    setIsConfirmed(true);
    setSliderValue(100);

    // 1. TRIGGER THE DOPAMINE
    triggerLuxuryConfetti();

    // 2. Call the onConfirm callback after a short delay for the animation
    setTimeout(() => {
      onConfirm?.();
    }, 1200);

    // 3. Close gracefully after animation
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  if (!isOpen) {
    return null;
  }

  // Dynamic colors based on progress
  const progressColor = sliderValue > 50
    ? `linear-gradient(to right, #D6A249, #E8B85A)` // Gold
    : `linear-gradient(to right, #D6A249, #E8B85A)`; // Gold throughout

  const thumbColor = isDragging || sliderValue > 30
    ? '#D6A249' // Gold when dragging
    : 'white';

  return (
    <>
      {/* 1. BACKDROP (Darken Screen) */}
      <div
        onClick={onClose}
        onKeyDown={e => e.key === 'Escape' && onClose()}
        role="button"
        tabIndex={0}
        aria-label="Close sheet"
        className="fixed inset-0 z-[60] animate-fade-in"
        style={{
          backgroundColor: 'rgba(63, 43, 36, 0.4)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      />

      {/* 2. THE SHEET (Spring Up Animation) */}
      <div
        className="fixed inset-x-0 bottom-0 z-[70] animate-spring-up overflow-hidden"
        style={{
          backgroundColor: '#FFFBF7',
          borderTopLeftRadius: '32px',
          borderTopRightRadius: '32px',
          padding: '24px',
          paddingBottom: '48px',
          boxShadow: '0 -20px 60px -20px rgba(0, 0, 0, 0.15)',
        }}
      >
        {/* Handle Bar */}
        <div
          className="mx-auto mb-8"
          style={{
            width: '48px',
            height: '6px',
            backgroundColor: '#E5DDD5',
            borderRadius: '9999px',
          }}
        />

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* Icon Bubble */}
          <div
            className="mb-6 flex items-center justify-center transition-all duration-500"
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '9999px',
              background: isConfirmed
                ? 'linear-gradient(to top right, #D6A249, #E8B85A)'
                : 'linear-gradient(to top right, #FDF7F0, white)',
              border: isConfirmed ? 'none' : '1px solid #F0E6DE',
              boxShadow: isConfirmed
                ? '0 10px 30px -5px rgba(214, 162, 73, 0.4)'
                : '0 10px 25px -5px rgba(214, 162, 73, 0.1)',
              transform: isConfirmed ? 'scale(1.1)' : 'scale(1)',
            }}
          >
            {isConfirmed
              ? (
                  <Check className="text-white" size={36} strokeWidth={3} />
                )
              : (
                  <Sparkles
                    size={32}
                    strokeWidth={1.5}
                    style={{ color: '#D6A249' }}
                  />
                )}
          </div>

          {/* Typography */}
          <h2
            className="mb-2 font-serif text-2xl tracking-tight"
            style={{ color: '#3F2B24' }}
          >
            {isConfirmed ? 'Reward Redeemed!' : 'Redeem Reward?'}
          </h2>
          <p
            className="mb-10 max-w-[260px] text-[15px] leading-relaxed"
            style={{ color: '#8A7E78' }}
          >
            {isConfirmed
              ? (
                  <>Your reward has been applied successfully!</>
                )
              : (
                  <>
                    You are about to redeem
                    {' '}
                    <span className="font-semibold" style={{ color: '#3F2B24' }}>
                      {rewardTitle}
                    </span>
                    {' '}
                    for
                    {' '}
                    <span className="font-semibold" style={{ color: '#3F2B24' }}>
                      {pointsCost.toLocaleString()}
                      {' '}
                      pts
                    </span>
                    .
                  </>
                )}
          </p>

          {/* 3. THE SLIDER (Touch-Optimized) */}
          {!isConfirmed && (
            <div
              ref={sliderRef}
              className="relative w-full touch-none select-none overflow-hidden"
              style={{
                height: '64px',
                backgroundColor: '#F2ECE6',
                borderRadius: '9999px',
                boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
                border: '1px solid #E6E0DA',
              }}
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleEnd}
            >
              {/* Background Fill (Progress) - Gold gradient */}
              <div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{
                  width: `calc(${sliderValue}% + 32px)`,
                  background: progressColor,
                  opacity: isDragging ? 0.3 : 0.15,
                  transition: isDragging ? 'none' : 'all 0.3s ease-out',
                }}
              />

              {/* Label Text */}
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300"
                style={{
                  opacity: sliderValue > 30 ? 0 : 1,
                }}
              >
                <ChevronRight
                  className="mr-1 animate-pulse"
                  size={18}
                  style={{ color: '#A89F99' }}
                />
                <span
                  className="text-[13px] font-bold uppercase tracking-widest"
                  style={{ color: '#A89F99' }}
                >
                  Slide to Confirm
                </span>
              </div>

              {/* The Draggable Thumb (Touch Target) */}
              <div
                ref={thumbRef}
                className="absolute inset-y-1 z-10 flex aspect-square cursor-grab items-center justify-center rounded-full border-2 active:cursor-grabbing"
                style={{
                  left: `calc(${sliderValue}% * (100% - 56px) / 100% + 4px)`,
                  width: '56px',
                  height: '56px',
                  backgroundColor: thumbColor,
                  borderColor: isDragging ? '#D6A249' : '#E6E0DA',
                  boxShadow: isDragging
                    ? '0 6px 20px rgba(214, 162, 73, 0.4)'
                    : '0 4px 12px rgba(0, 0, 0, 0.1)',
                  transition: isDragging ? 'none' : 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  transform: isDragging ? 'scale(1.05)' : 'scale(1)',
                }}
              >
                <ChevronRight
                  size={24}
                  style={{
                    color: isDragging || sliderValue > 30 ? 'white' : '#3F2B24',
                    transition: 'color 0.2s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Success checkmark for confirmed state */}
          {isConfirmed && (
            <div
              className="flex h-16 w-full items-center justify-center rounded-full"
              style={{
                background: 'linear-gradient(to right, #D6A249, #E8B85A)',
              }}
            >
              <Check className="mr-2 text-white" size={24} strokeWidth={3} />
              <span className="text-[15px] font-bold tracking-wide text-white">
                Confirmed!
              </span>
            </div>
          )}

          {/* Cancel Button */}
          {!isConfirmed && (
            <button
              type="button"
              onClick={onClose}
              className="mt-6 text-sm font-medium transition-colors hover:text-[#3F2B24]"
              style={{ color: '#8A7E78' }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </>
  );
}
