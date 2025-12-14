'use client';

import confetti from 'canvas-confetti';
import clsx, { type ClassValue } from 'clsx';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import {
  Check,
  ChevronRight,
  Crown,
  Flame,
  Gift,
  Home,
  Lock,
  Palette,
  RefreshCw,
  Sparkles,
  User,
  Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';

import { useSalon } from '@/providers/SalonProvider';

// --- UTILITY ---

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

/**
 * THE LUXURY CONFETTI ENGINE
 */
const triggerLuxuryConfetti = () => {
  if (typeof window !== 'undefined') {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq?.matches) {
      return;
    }
  } else {
    return;
  }

  const duration = 1200;
  const end = Date.now() + duration;
  // Confetti colors - decorative, kept as hex for canvas-confetti library
  const colors = ['#D6A249', '#FDF7F0', '#3F2B24', '#FFFFFF'];

  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0.1, y: 0.8 },
      colors,
      zIndex: 9999,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 0.9, y: 0.8 },
      colors,
      zIndex: 9999,
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  }());

  setTimeout(() => {
    confetti({
      particleCount: 150,
      spread: 100,
      origin: { y: 0.7 },
      colors,
      gravity: 1.2,
      scalar: 1.2,
      zIndex: 9999,
    });
  }, 200);
};

// --- DATA & TYPES ---

export type TierColor = 'green' | 'purple' | 'gold';

export type RewardData = {
  id: string;
  points: number;
  title: string;
  subtitle: string;
  tierColor: TierColor;
  icon: React.ElementType;
};

// API reward type from database
type ApiReward = {
  id: string;
  points: number;
  status: 'active' | 'used' | 'expired';
  type: string;
  eligibleServiceName: string | null;
  expiresAt: string | null;
  usedInAppointmentId: string | null;
  clientName: string | null;
  createdAt: string;
  isExpired: boolean;
  daysUntilExpiry: number | null;
};

// Upcoming appointment type
type UpcomingAppointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  totalPrice: number;
  services: Array<{
    id: string;
    name: string;
    price: number;
  }>;
  technician: {
    id: string;
    name: string;
  } | null;
};

// Static catalog rewards (for browsing what's available to earn)
const REWARDS_CATALOG: RewardData[] = [
  // TIER 1: SMALL TREATS (2,500)
  { id: 'cat-1', points: 2500, title: '$5 Off', subtitle: 'Any Service', tierColor: 'green', icon: Sparkles },
  { id: 'cat-2', points: 2500, title: 'Cuticle Oil', subtitle: 'Take-home care', tierColor: 'green', icon: Gift },

  // TIER 2: MEDIUM VALUE (4,750)
  { id: 'cat-3', points: 4750, title: '$10 Off', subtitle: 'Any Service', tierColor: 'green', icon: Sparkles },
  { id: 'cat-4', points: 4750, title: 'Nail Art Add-on', subtitle: '2 fingers / simple', tierColor: 'purple', icon: Palette },

  // TIER 3: HIGH VALUE (8,750)
  { id: 'cat-5', points: 8750, title: '$20 Off', subtitle: 'Any Service', tierColor: 'green', icon: Sparkles },
  { id: 'cat-6', points: 8750, title: 'French Tip', subtitle: 'Add-on styling', tierColor: 'purple', icon: Zap },

  // TIER 4: LUXURY HERO (25,000)
  { id: 'cat-7', points: 25000, title: 'Free Gel Manicure', subtitle: 'Single color · any short/medium', tierColor: 'gold', icon: Crown },
  { id: 'cat-8', points: 25000, title: 'Free BIAB Short', subtitle: 'Short BIAB set or fill', tierColor: 'gold', icon: Crown },

  // TIER 5: TOP STATUS (38,500)
  { id: 'cat-9', points: 38500, title: '$100 Off', subtitle: 'Elite Status Reward', tierColor: 'gold', icon: Sparkles },
];

// --- COMPONENTS ---

/**
 * 1. REDEEM SHEET
 */
type RedeemSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  reward: ApiReward | null;
  appointment: UpcomingAppointment | null;
  clientPhone: string;
  onSuccess: (discountApplied: number, newTotal: number) => void;
};

const RedeemSheet = ({ isOpen, onClose, reward, appointment, clientPhone, onSuccess }: RedeemSheetProps) => {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sliderValue, setSliderValue] = useState(0);
  const [discountResult, setDiscountResult] = useState<{ discount: number; newTotal: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => sheetRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (!isConfirmed && !isRedeeming && e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, isConfirmed, isRedeeming]);

  useEffect(() => {
    if (isOpen) {
      setIsConfirmed(false);
      setIsRedeeming(false);
      setError(null);
      setSliderValue(0);
      setDiscountResult(null);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    if (!reward || !appointment || !clientPhone || isRedeeming) {
      return;
    }

    setIsRedeeming(true);
    setError(null);

    try {
      const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

      const response = await fetch('/api/rewards/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewardId: reward.id,
          appointmentId: appointment.id,
          phone: normalizedPhone,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to redeem reward');
      }

      // Success!
      setIsConfirmed(true);
      setSliderValue(100);
      setDiscountResult({
        discount: data.data.discountApplied,
        newTotal: data.data.newTotalPrice,
      });
      triggerHaptic();
      triggerLuxuryConfetti();

      // Notify parent of success
      onSuccess(data.data.discountApplied, data.data.newTotalPrice);

      setTimeout(() => {
        triggerHaptic();
        onClose();
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSliderValue(0);
      setIsRedeeming(false);
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (Number.isNaN(val) || isRedeeming || isConfirmed) {
      return;
    }
    setSliderValue(val);
    if (val >= 98 && !isConfirmed) {
      handleConfirm();
    }
  };

  const rewardTitle = reward?.eligibleServiceName || 'Reward';
  const pointsCost = reward?.points || 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!isConfirmed ? onClose : undefined}
            className="fixed inset-0 z-[60] backdrop-blur-sm"
            style={{ backgroundColor: `color-mix(in srgb, var(--n5-ink-main) 40%, transparent)` }}
            aria-hidden="true"
          />
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="redeem-title"
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-x-0 bottom-0 z-[70] overflow-hidden bg-[var(--n5-bg-card)] p-6 pb-12 shadow-[var(--n5-shadow-modal)] outline-none"
            style={{ borderRadius: 'var(--n5-radius-sheet) var(--n5-radius-sheet) 0 0' }}
          >
            <div aria-live="polite" className="sr-only">
              {isConfirmed ? `Success! Reward ${rewardTitle} redeemed for ${pointsCost} points.` : ''}
            </div>

            <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-[var(--n5-border-muted)]" />
            <div className="relative z-10 flex flex-col items-center text-center">
              <div
                className="mb-4 flex size-16 items-center justify-center rounded-full border border-[var(--n5-border)] shadow-[var(--n5-shadow-lg)]"
                style={{
                  background: `linear-gradient(to top right, var(--n5-bg-page), white)`,
                }}
              >
                {isConfirmed
                  ? (
                      <Check className="animate-pulse text-[var(--n5-success)]" size={32} />
                    )
                  : isRedeeming
                    ? (
                        <RefreshCw size={28} className="animate-spin text-[var(--n5-accent)]" />
                      )
                    : (
                        <Sparkles size={28} strokeWidth={1.5} className="text-[var(--n5-accent)]" />
                      )}
              </div>

              <p className="font-body mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--n5-ink-muted)]">
                {isConfirmed ? 'Success' : 'Apply Reward'}
              </p>
              <h2 id="redeem-title" className="font-heading mb-3 text-xl tracking-tight text-[var(--n5-ink-main)]">
                {isConfirmed ? 'Reward Applied!' : rewardTitle}
              </h2>

              {/* Show discount result on success */}
              {isConfirmed && discountResult && (
                <div className="bg-[var(--n5-success)]/10 mb-4 rounded-xl px-4 py-3">
                  <p className="font-body text-sm text-[var(--n5-success)]">
                    <span className="font-semibold">
                      $
                      {discountResult.discount.toFixed(2)}
                      {' '}
                      off
                    </span>
                    {' '}
                    applied!
                  </p>
                  <p className="font-body mt-1 text-xs text-[var(--n5-ink-muted)]">
                    New appointment total:
                    {' '}
                    <span className="font-semibold">
                      $
                      {discountResult.newTotal.toFixed(2)}
                    </span>
                  </p>
                </div>
              )}

              {/* Show appointment info when not confirmed */}
              {!isConfirmed && appointment && (
                <div className="mb-4 w-full rounded-xl border border-[var(--n5-border)] bg-[var(--n5-bg-selected)] p-3">
                  <p className="font-body mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--n5-ink-muted)]">
                    Applying to your appointment
                  </p>
                  <p className="font-body text-sm font-medium text-[var(--n5-ink-main)]">
                    {new Date(appointment.startTime).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                    {' at '}
                    {new Date(appointment.startTime).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="font-body mt-1 text-xs text-[var(--n5-ink-muted)]">
                    {appointment.services.map(s => s.name).join(', ')}
                  </p>
                  <p className="font-body mt-1 text-xs text-[var(--n5-ink-main)]">
                    Current total:
                    {' '}
                    <span className="font-semibold">
                      $
                      {(appointment.totalPrice / 100).toFixed(2)}
                    </span>
                  </p>
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="mb-4 rounded-xl bg-red-50 px-4 py-2">
                  <p className="font-body text-sm text-red-600">{error}</p>
                </div>
              )}

              {!isConfirmed && (
                <p className="font-body mb-6 text-xs text-[var(--n5-ink-muted)]">
                  This will use your
                  {' '}
                  <span className="font-semibold">
                    {pointsCost.toLocaleString()}
                    {' '}
                    pts
                  </span>
                  {' '}
                  reward
                </p>
              )}

              {/* Only show slider if not confirmed */}
              {!isConfirmed && (
                <div
                  className={cn(
                    'relative h-[56px] w-full select-none overflow-hidden rounded-full border border-[var(--n5-border-muted)] bg-[var(--n5-bg-selected)] p-1.5 shadow-inner',
                    isRedeeming && 'opacity-50 pointer-events-none',
                  )}
                >
                  <div
                    className="absolute left-0 top-0 h-full transition-all duration-75 ease-out"
                    style={{
                      width: `${sliderValue}%`,
                      backgroundColor: `color-mix(in srgb, var(--n5-accent) 20%, transparent)`,
                    }}
                  />
                  <div className={cn('absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-300', sliderValue > 50 ? 'opacity-0' : 'opacity-100')}>
                    <span className="font-body text-[12px] font-bold uppercase tracking-widest text-[var(--n5-accent)]">
                      {isRedeeming ? 'Applying...' : 'Slide to Apply'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sliderValue}
                    onChange={handleSliderChange}
                    disabled={isConfirmed || isRedeeming}
                    aria-label="Slide to confirm redemption"
                    className="absolute inset-0 z-20 size-full cursor-pointer opacity-0"
                  />
                  <div
                    className="pointer-events-none absolute inset-y-1.5 left-1.5 z-10 flex aspect-square h-full items-center justify-center rounded-full border border-[var(--n5-border-muted)] bg-[var(--n5-bg-card)] text-[var(--n5-accent)] shadow-[0_2px_10px_rgba(0,0,0,0.1)] transition-all duration-75 ease-out"
                    style={{
                      left: `calc(${sliderValue}% - ${sliderValue * 0.7}px)`,
                    }}
                  >
                    {isRedeeming ? <RefreshCw size={20} className="animate-spin" /> : <div className="h-3 w-1 rounded-full bg-[var(--n5-border-muted)]" />}
                  </div>
                </div>
              )}

              {!isConfirmed && !isRedeeming && (
                <button
                  onClick={onClose}
                  className="font-body mt-4 text-xs font-bold uppercase tracking-widest text-[var(--n5-ink-muted)] transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/**
 * 1b. CATALOG REDEEM SHEET - For redeeming catalog rewards with points
 */
type CatalogRedeemSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  reward: RewardData | null;
  appointment: UpcomingAppointment | null;
  clientPhone: string;
  currentPoints: number;
  onSuccess: (discountApplied: number, newTotal: number) => void;
};

const CatalogRedeemSheet = ({
  isOpen,
  onClose,
  reward,
  appointment,
  clientPhone,
  currentPoints,
  onSuccess,
}: CatalogRedeemSheetProps) => {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sliderValue, setSliderValue] = useState(0);
  const [discountResult, setDiscountResult] = useState<{ discount: number; newTotal: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => sheetRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (!isConfirmed && !isRedeeming && e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, isConfirmed, isRedeeming]);

  useEffect(() => {
    if (isOpen) {
      setIsConfirmed(false);
      setIsRedeeming(false);
      setError(null);
      setSliderValue(0);
      setDiscountResult(null);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    if (!reward || !appointment || !clientPhone || isRedeeming) {
      return;
    }

    if (currentPoints < reward.points) {
      setError(`You need ${reward.points.toLocaleString()} points but only have ${currentPoints.toLocaleString()}`);
      return;
    }

    setIsRedeeming(true);
    setError(null);

    try {
      const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

      const response = await fetch('/api/rewards/redeem-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewardTitle: reward.title,
          rewardPoints: reward.points,
          appointmentId: appointment.id,
          phone: normalizedPhone,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to redeem reward');
      }

      // Success!
      setIsConfirmed(true);
      setSliderValue(100);
      setDiscountResult({
        discount: data.data.discountApplied,
        newTotal: data.data.newTotalPrice,
      });
      triggerHaptic();
      triggerLuxuryConfetti();

      // Notify parent of success
      onSuccess(data.data.discountApplied, data.data.newTotalPrice);

      setTimeout(() => {
        triggerHaptic();
        onClose();
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSliderValue(0);
      setIsRedeeming(false);
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (Number.isNaN(val) || isRedeeming || isConfirmed) {
      return;
    }
    setSliderValue(val);
    if (val >= 98 && !isConfirmed) {
      handleConfirm();
    }
  };

  const rewardTitle = reward?.title || 'Reward';
  const pointsCost = reward?.points || 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!isConfirmed && !isRedeeming ? onClose : undefined}
            className="fixed inset-0 z-[60] backdrop-blur-sm"
            style={{ backgroundColor: `color-mix(in srgb, var(--n5-ink-main) 40%, transparent)` }}
            aria-hidden="true"
          />
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-redeem-title"
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-x-0 bottom-0 z-[70] overflow-hidden bg-[var(--n5-bg-card)] p-6 pb-12 shadow-[var(--n5-shadow-modal)] outline-none"
            style={{ borderRadius: 'var(--n5-radius-sheet) var(--n5-radius-sheet) 0 0' }}
          >
            <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-[var(--n5-border-muted)]" />
            <div className="relative z-10 flex flex-col items-center text-center">
              <div
                className="mb-4 flex size-16 items-center justify-center rounded-full border border-[var(--n5-border)] shadow-[var(--n5-shadow-lg)]"
                style={{
                  background: `linear-gradient(to top right, var(--n5-bg-page), white)`,
                }}
              >
                {isConfirmed
                  ? <Check className="animate-pulse text-[var(--n5-success)]" size={32} />
                  : isRedeeming
                    ? <RefreshCw size={28} className="animate-spin text-[var(--n5-accent)]" />
                    : <Sparkles size={28} strokeWidth={1.5} className="text-[var(--n5-accent)]" />}
              </div>

              <p className="font-body mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--n5-ink-muted)]">
                {isConfirmed ? 'Success' : 'Spend Points'}
              </p>
              <h2 id="catalog-redeem-title" className="font-heading mb-3 text-xl tracking-tight text-[var(--n5-ink-main)]">
                {isConfirmed ? 'Reward Applied!' : rewardTitle}
              </h2>

              {/* Show discount result on success */}
              {isConfirmed && discountResult && (
                <div className="bg-[var(--n5-success)]/10 mb-4 rounded-xl px-4 py-3">
                  <p className="font-body text-sm text-[var(--n5-success)]">
                    <span className="font-semibold">
                      $
                      {discountResult.discount.toFixed(2)}
                      {' '}
                      off
                    </span>
                    {' '}
                    applied!
                  </p>
                  <p className="font-body mt-1 text-xs text-[var(--n5-ink-muted)]">
                    New appointment total:
                    {' '}
                    <span className="font-semibold">
                      $
                      {discountResult.newTotal.toFixed(2)}
                    </span>
                  </p>
                </div>
              )}

              {/* Show appointment info when not confirmed */}
              {!isConfirmed && appointment && (
                <div className="mb-4 w-full rounded-xl border border-[var(--n5-border)] bg-[var(--n5-bg-selected)] p-3">
                  <p className="font-body mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--n5-ink-muted)]">
                    Applying to your appointment
                  </p>
                  <p className="font-body text-sm font-medium text-[var(--n5-ink-main)]">
                    {new Date(appointment.startTime).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                    {' at '}
                    {new Date(appointment.startTime).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="font-body mt-1 text-xs text-[var(--n5-ink-muted)]">
                    {appointment.services.map(s => s.name).join(', ')}
                  </p>
                  <p className="font-body mt-1 text-xs text-[var(--n5-ink-main)]">
                    Current total:
                    {' '}
                    <span className="font-semibold">
                      $
                      {(appointment.totalPrice / 100).toFixed(2)}
                    </span>
                  </p>
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="mb-4 rounded-xl bg-red-50 px-4 py-2">
                  <p className="font-body text-sm text-red-600">{error}</p>
                </div>
              )}

              {!isConfirmed && (
                <p className="font-body mb-6 text-xs text-[var(--n5-ink-muted)]">
                  This will use
                  {' '}
                  <span className="font-semibold">
                    {pointsCost.toLocaleString()}
                    {' '}
                    pts
                  </span>
                  {' '}
                  from your balance
                </p>
              )}

              {/* Only show slider if not confirmed */}
              {!isConfirmed && (
                <div
                  className={cn(
                    'relative h-[56px] w-full select-none overflow-hidden rounded-full border border-[var(--n5-border-muted)] bg-[var(--n5-bg-selected)] p-1.5 shadow-inner',
                    isRedeeming && 'opacity-50 pointer-events-none',
                  )}
                >
                  <div
                    className="absolute left-0 top-0 h-full transition-all duration-75 ease-out"
                    style={{
                      width: `${sliderValue}%`,
                      backgroundColor: `color-mix(in srgb, var(--n5-accent) 20%, transparent)`,
                    }}
                  />
                  <div className={cn('absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-300', sliderValue > 50 ? 'opacity-0' : 'opacity-100')}>
                    <span className="font-body text-[12px] font-bold uppercase tracking-widest text-[var(--n5-accent)]">
                      {isRedeeming ? 'Applying...' : 'Slide to Redeem'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sliderValue}
                    onChange={handleSliderChange}
                    disabled={isConfirmed || isRedeeming}
                    aria-label="Slide to confirm redemption"
                    className="absolute inset-0 z-20 size-full cursor-pointer opacity-0"
                  />
                  <div
                    className="pointer-events-none absolute inset-y-1.5 left-1.5 z-10 flex aspect-square h-full items-center justify-center rounded-full border border-[var(--n5-border-muted)] bg-[var(--n5-bg-card)] text-[var(--n5-accent)] shadow-[0_2px_10px_rgba(0,0,0,0.1)] transition-all duration-75 ease-out"
                    style={{
                      left: `calc(${sliderValue}% - ${sliderValue * 0.7}px)`,
                    }}
                  >
                    {isRedeeming ? <RefreshCw size={20} className="animate-spin" /> : <div className="h-3 w-1 rounded-full bg-[var(--n5-border-muted)]" />}
                  </div>
                </div>
              )}

              {!isConfirmed && !isRedeeming && (
                <button
                  type="button"
                  onClick={onClose}
                  className="font-body mt-4 text-xs font-bold uppercase tracking-widest text-[var(--n5-ink-muted)] transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/**
 * 2. BALANCE CARD
 */
export type BalanceCardProps = {
  points?: number;
  nextReward?: number;
  streak?: number;
};

const BalanceCard = ({ points = 0, nextReward = 2500, streak = 0 }: BalanceCardProps) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (shouldReduceMotion) {
      return;
    }

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma;
      const beta = e.beta;
      if (gamma === null || beta === null) {
        return;
      }
      const clampedX = Math.min(Math.max(gamma, -20), 20);
      const clampedY = Math.min(Math.max(beta, -20), 20);
      x.set(clampedX * 2);
      y.set(clampedY * 2);
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [x, y, shouldReduceMotion]);

  const rotateX = useTransform(y, [-100, 100], [5, -5]);
  const rotateY = useTransform(x, [-100, 100], [-5, 5]);

  const safeNextReward = nextReward > 0 ? nextReward : 1;
  const pointsNeeded = Math.max(0, safeNextReward - points);
  const progressPercent = Math.min(100, Math.max(0, (points / safeNextReward) * 100));

  return (
    <div className="space-y-3">
      <motion.div
        style={{
          rotateX: shouldReduceMotion ? 0 : rotateX,
          rotateY: shouldReduceMotion ? 0 : rotateY,
          perspective: 1000,
        }}
        className="relative z-10 aspect-[1.7/1] max-h-[200px] w-full select-none"
      >
        <div
          className="absolute inset-0 overflow-hidden border border-white/10 bg-[var(--n5-ink-main)] shadow-[var(--n5-shadow-lg)]"
          style={{ borderRadius: 'var(--n5-radius-card)' }}
        >

          {streak > 0 && (
            <div className="absolute right-6 top-6 z-20 flex items-center space-x-1.5 rounded-full border border-white/5 bg-black/20 px-3 py-1.5 backdrop-blur-md">
              <Flame className="size-3 text-[var(--n5-warning)]" style={{ fill: 'var(--n5-warning)' }} />
              <span className="font-body text-[10px] font-bold tracking-wide text-[var(--n5-ink-inverse)]">
                {streak}
                {' '}
                Day Streak
              </span>
            </div>
          )}

          {/* Decorative blurs - kept as hex for blur effect consistency */}
          <div className="absolute inset-0 opacity-50">
            <div className="absolute left-[-20%] top-[-50%] h-full w-4/5 rounded-full bg-[#5D4037] blur-[90px]" />
            <div className="absolute bottom-[-20%] right-[-10%] h-4/5 w-3/5 rounded-full bg-[#8D6E63] opacity-40 mix-blend-overlay blur-[60px]" />
          </div>

          <div className="relative z-10 flex h-full flex-col justify-between p-6 text-[var(--n5-ink-inverse)]">
            <div>
              <p className="font-body text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">Available Balance</p>
              <h1 className="font-heading mt-1 text-5xl tracking-tighter text-[var(--n5-ink-inverse)] drop-shadow-sm">
                {points.toLocaleString()}
                {' '}
                <span className="font-body text-lg font-medium opacity-60">pts</span>
              </h1>
            </div>

            <div className="space-y-3">
              <div className="font-body flex items-end justify-between text-xs font-medium opacity-80">
                <span>
                  Next Reward:
                  {safeNextReward.toLocaleString()}
                </span>
                <span className="text-[var(--n5-accent)]">
                  {pointsNeeded.toLocaleString()}
                  {' '}
                  pts to go
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full border border-white/5 bg-black/20 backdrop-blur-sm">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                  className="h-full"
                  style={{ background: `linear-gradient(to right, var(--n5-accent), var(--n5-accent-soft))` }}
                />
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {points === 0 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="font-body text-center text-xs font-medium text-[var(--n5-ink-muted)]"
        >
          Book your first visit to start earning rewards.
        </motion.p>
      )}
    </div>
  );
};

/**
 * 3. REWARD CARD
 */
type RewardCardProps = {
  isLocked: boolean;
  onRedeem?: () => void;
} & RewardData;

const RewardCard = ({ points, title, subtitle, tierColor, isLocked, icon: Icon, onRedeem }: RewardCardProps) => {
  // Tier colors are semantic/decorative - green for discounts, purple for add-ons, gold for premium
  const colors = {
    green: { bg: 'bg-[#E8F5E9]', text: 'text-[#2E7D32]' },
    purple: { bg: 'bg-[#F3E5F5]', text: 'text-[#7B1FA2]' },
    gold: { bg: 'bg-[var(--n5-accent-soft)]', text: 'text-[var(--n5-accent-hover)]' },
  };
  const theme = colors[tierColor] || colors.gold;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={cn(
        'relative w-full p-5 flex flex-col justify-between overflow-hidden group min-h-[180px]',
        isLocked
          ? 'bg-[var(--n5-bg-card)]/40 backdrop-blur-[2px] border border-white/40'
          : 'bg-[var(--n5-bg-card)] shadow-[var(--n5-shadow-md)] border border-transparent transition-all duration-300',
      )}
      style={{
        borderRadius: 'var(--n5-radius-card)',
        borderColor: !isLocked ? `color-mix(in srgb, var(--n5-accent) 0%, transparent)` : undefined,
      }}
      onMouseEnter={(e) => {
        if (!isLocked) {
          (e.currentTarget as HTMLElement).style.borderColor = `color-mix(in srgb, var(--n5-accent) 30%, transparent)`;
        }
      }}
      onMouseLeave={(e) => {
        if (!isLocked) {
          (e.currentTarget as HTMLElement).style.borderColor = `color-mix(in srgb, var(--n5-accent) 0%, transparent)`;
        }
      }}
    >
      {!isLocked && (
        <div className="pointer-events-none absolute inset-0 z-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent group-hover:animate-[shimmer_2s_infinite] motion-reduce:animate-none" />
      )}

      <div className="z-10 flex items-start justify-between">
        <span className={cn(
          'px-3 py-1.5 rounded-full text-[10px] font-bold font-body tracking-wider uppercase',
          isLocked ? 'bg-[var(--n5-bg-card)]/50 text-[var(--n5-ink-muted)]' : `${theme.bg} ${theme.text}`,
        )}
        >
          {points.toLocaleString()}
          {' '}
          PTS
        </span>
        {isLocked && <Lock className="text-[var(--n5-ink-muted)]/50 size-5" />}
      </div>

      <div className={cn('z-10 mt-4', isLocked && 'opacity-50')}>
        <div
          className="mb-3 flex size-10 items-center justify-center rounded-full bg-[var(--n5-bg-selected)] text-[var(--n5-ink-main)]"
        >
          <Icon className="size-5" strokeWidth={1.5} />
        </div>
        <h3 className="font-heading text-xl leading-tight text-[var(--n5-ink-main)]">{title}</h3>
        <p className="font-body mt-0.5 text-xs font-medium text-[var(--n5-ink-muted)]">{subtitle}</p>
      </div>

      <div className="z-10 mt-4">
        {isLocked
          ? (
              <div
                className="font-body text-[var(--n5-ink-muted)]/60 flex h-10 w-full cursor-not-allowed items-center justify-center bg-black/5 text-[10px] font-bold uppercase tracking-widest"
                style={{ borderRadius: 'var(--n5-radius-md)' }}
              >
                Locked
              </div>
            )
          : (
              <button
                onClick={() => {
                  triggerHaptic(); onRedeem?.();
                }}
                aria-label={`Redeem ${title} for ${points.toLocaleString()} points`}
                className="font-body flex h-10 w-full items-center justify-center space-x-1 bg-[var(--n5-button-primary-bg)] text-[11px] font-bold uppercase tracking-wide text-[var(--n5-button-primary-text)] shadow-[var(--n5-shadow-sm)] transition-transform active:scale-95"
                style={{ borderRadius: 'var(--n5-radius-md)' }}
              >
                <span>Redeem</span>
                <ChevronRight className="size-3" />
              </button>
            )}
      </div>

      {isLocked && <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-white/40" />}
    </motion.div>
  );
};

const TierHeader = ({ title, pts }: { title: string; pts: string }) => (
  <div
    className="flex items-end justify-between border-b border-[var(--n5-border)] px-2 pb-3 pt-1"
  >
    <h2 className="font-heading text-lg text-[var(--n5-ink-main)]">{title}</h2>
    <span className="font-body text-[10px] font-bold uppercase tracking-widest text-[var(--n5-ink-muted)] opacity-80">
      {pts}
      {' '}
      PTS
    </span>
  </div>
);

/**
 * 5. HOW POINTS WORK SECTION
 */
const HowPointsWork = () => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    className="border border-[var(--n5-border)] bg-[var(--n5-bg-card)] p-5"
    style={{ borderRadius: 'var(--n5-radius-card)' }}
  >
    <h3 className="font-heading mb-4 text-base font-semibold text-[var(--n5-ink-main)]">
      How Points Work
    </h3>

    {/* Earn Section */}
    <div className="mb-4">
      <p className="font-body mb-2 text-[10px] uppercase tracking-widest text-[var(--n5-ink-muted)]">
        Earn Points
      </p>
      <ul className="space-y-2">
        <li className="font-body flex items-center gap-3 text-[13px] text-[var(--n5-ink-main)]">
          <span className="flex size-6 items-center justify-center rounded-full bg-[var(--n5-accent-soft)] text-[var(--n5-accent)]">
            <Sparkles className="size-3" />
          </span>
          <span>
            <strong>25,000 pts</strong>
            {' '}
            welcome bonus on first visit
          </span>
        </li>
        <li className="font-body flex items-center gap-3 text-[13px] text-[var(--n5-ink-main)]">
          <span className="flex size-6 items-center justify-center rounded-full bg-[var(--n5-accent-soft)] text-[var(--n5-accent)]">
            <Sparkles className="size-3" />
          </span>
          <span>
            <strong>20 pts</strong>
            {' '}
            for every $1 spent
          </span>
        </li>
        <li className="font-body flex items-center gap-3 text-[13px] text-[var(--n5-ink-main)]">
          <span className="flex size-6 items-center justify-center rounded-full bg-[var(--n5-accent-soft)] text-[var(--n5-accent)]">
            <Sparkles className="size-3" />
          </span>
          <span>
            <strong>2,500 pts</strong>
            {' '}
            for completing your profile
          </span>
        </li>
        <li className="font-body flex items-center gap-3 text-[13px] text-[var(--n5-ink-main)]">
          <span className="flex size-6 items-center justify-center rounded-full bg-[var(--n5-accent-soft)] text-[var(--n5-accent)]">
            <Sparkles className="size-3" />
          </span>
          <span>
            <strong>25,000 pts</strong>
            {' '}
            for each successful referral
          </span>
        </li>
      </ul>
    </div>

    {/* Redeem Section */}
    <div>
      <p className="font-body mb-2 text-[10px] uppercase tracking-widest text-[var(--n5-ink-muted)]">
        Redeem Rewards
      </p>
      <p className="font-body text-[13px] text-[var(--n5-ink-main)]">
        Use your points to unlock discounts, free services, and exclusive add-ons.
        Rewards are automatically available once you reach the required points.
      </p>
    </div>
  </motion.div>
);

const FloatingDock = () => {
  const router = useRouter();

  return (
    <div
      role="navigation"
      aria-label="Bottom Navigation"
      className="bg-[var(--n5-bg-card)]/90 fixed bottom-6 left-1/2 z-50 flex h-16 w-[90%] max-w-[400px] -translate-x-1/2 items-center justify-between rounded-[2rem] border border-white/50 px-8 shadow-[var(--n5-shadow-dock)] backdrop-blur-xl"
    >
      <button
        onClick={() => {
          triggerHaptic(); router.push('/book');
        }}
        aria-label="Go to Home"
        className="p-2 text-[var(--n5-ink-muted)] transition-colors"
      >
        <Home strokeWidth={2} className="size-6" />
      </button>
      <div className="relative p-2">
        <button onClick={triggerHaptic} aria-label="Current Page: Rewards" className="text-[var(--n5-accent)]">
          <Gift strokeWidth={2} className="size-6" />
        </button>
        <div className="absolute bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[var(--n5-accent)]" />
      </div>
      <button
        onClick={() => {
          triggerHaptic(); router.push('/profile');
        }}
        aria-label="Go to Profile"
        className="p-2 text-[var(--n5-ink-muted)] transition-colors"
      >
        <User strokeWidth={2} className="size-6" />
      </button>
    </div>
  );
};

// --- MAIN PAGE ---

export default function RewardsContent() {
  const router = useRouter();
  const { salonSlug } = useSalon();

  // Start with 0 - actual points will load from API
  const [currentPoints, setCurrentPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clientPhone, setClientPhone] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Active rewards from the API (actual redeemable rewards)
  const [activeRewards, setActiveRewards] = useState<ApiReward[]>([]);
  const [selectedApiReward, setSelectedApiReward] = useState<ApiReward | null>(null);

  // Upcoming appointment
  const [upcomingAppointment, setUpcomingAppointment] = useState<UpcomingAppointment | null>(null);

  // Load client phone from cookie
  useEffect(() => {
    const clientPhoneCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_phone='));
    if (clientPhoneCookie) {
      const phone = decodeURIComponent(clientPhoneCookie.split('=')[1] || '');
      if (phone) {
        setClientPhone(phone);
      }
    }
  }, []);

  // Fetch rewards/points from API
  const fetchRewards = useCallback(async () => {
    if (!clientPhone || !salonSlug) {
      setLoading(false);
      return;
    }

    const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
    if (normalizedPhone.length !== 10) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `/api/rewards?phone=${encodeURIComponent(normalizedPhone)}&salonSlug=${encodeURIComponent(salonSlug)}`,
      );
      if (response.ok) {
        const data = await response.json();
        // Set points
        if (data.meta?.activePoints !== undefined) {
          setCurrentPoints(data.meta.activePoints);
        }
        if (data.meta?.streak !== undefined) {
          setStreak(data.meta.streak);
        }
        // Set active rewards (only ones that can be redeemed)
        const rewards = data.data?.rewards || [];
        const active = rewards.filter((r: ApiReward) =>
          r.status === 'active' && !r.isExpired && !r.usedInAppointmentId,
        );
        setActiveRewards(active);
      }
    } catch (error) {
      console.error('Failed to fetch rewards:', error);
    } finally {
      setLoading(false);
    }
  }, [clientPhone, salonSlug]);

  // Fetch upcoming appointment
  const fetchAppointment = useCallback(async () => {
    if (!clientPhone) {
      return;
    }

    try {
      const response = await fetch(
        `/api/client/next-appointment?phone=${encodeURIComponent(clientPhone)}`,
      );
      if (response.ok) {
        const data = await response.json();
        if (data.data?.appointment) {
          setUpcomingAppointment({
            id: data.data.appointment.id,
            startTime: data.data.appointment.startTime,
            endTime: data.data.appointment.endTime,
            status: data.data.appointment.status,
            totalPrice: data.data.appointment.totalPrice,
            services: data.data.services || [],
            technician: data.data.technician,
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch appointment:', error);
    }
  }, [clientPhone]);

  useEffect(() => {
    if (clientPhone && salonSlug) {
      fetchRewards();
      fetchAppointment();
    } else {
      setLoading(false);
    }
  }, [clientPhone, salonSlug, fetchRewards, fetchAppointment]);

  // Dynamic Calculation: Finds the next milestone based on current points
  const nextRewardPoints = REWARDS_CATALOG
    .map(r => r.points)
    .filter(p => p > currentPoints)
    .sort((a, b) => a - b)[0] ?? currentPoints;

  const handleRefresh = useCallback(() => {
    triggerHaptic();
    setIsRefreshing(true);
    Promise.all([fetchRewards(), fetchAppointment()]).finally(() => {
      setTimeout(() => {
        setIsRefreshing(false);
        triggerHaptic();
      }, 500);
    });
  }, [fetchRewards, fetchAppointment]);

  const handleRedeemSuccess = useCallback((discountApplied: number, newTotal: number) => {
    // Refresh data after successful redemption
    fetchRewards();
    fetchAppointment();
    // Update the appointment price locally for immediate feedback
    // Note: newTotal is now in dollars from the API
    if (upcomingAppointment) {
      setUpcomingAppointment({
        ...upcomingAppointment,
        totalPrice: newTotal * 100, // Convert back to cents for local state
      });
    }
    // Update points locally (will be refreshed from API too)
    setCurrentPoints(prev => Math.max(0, prev - (discountApplied * 100 / 50))); // Rough estimate
  }, [fetchRewards, fetchAppointment, upcomingAppointment]);

  // State for catalog redemption
  const [selectedCatalogReward, setSelectedCatalogReward] = useState<RewardData | null>(null);

  // Handle catalog reward redemption (spending points)
  const handleCatalogRedeem = useCallback((reward: RewardData) => {
    triggerHaptic();
    setSelectedCatalogReward(reward);
  }, []);

  const handleBack = useCallback(() => {
    triggerHaptic();
    router.back();
  }, [router]);

  return (
    <>
      <style jsx global>
        {`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        .rewards-page ::selection {
          background-color: color-mix(in srgb, var(--theme-primary) 20%, transparent);
        }
      `}
      </style>

      <div className="rewards-page font-body min-h-screen bg-[var(--n5-bg-page)]">

        {/* Navbar */}
        <nav
          className="fixed top-0 z-40 flex w-full items-center justify-between border-b border-[var(--n5-border)] px-5 pb-2 pt-12 backdrop-blur-md"
          style={{
            backgroundColor: `color-mix(in srgb, var(--n5-bg-page) 80%, transparent)`,
          }}
        >
          <button
            onClick={handleBack}
            aria-label="Go back"
            className="flex size-10 items-center justify-center rounded-full bg-[var(--n5-bg-card)] text-[var(--n5-ink-main)] shadow-sm transition-transform active:scale-90"
          >
            <ChevronRight className="size-5 rotate-180" />
          </button>
          <span className="font-heading pt-1 text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]">Rewards</span>
          <button
            onClick={handleRefresh}
            aria-label="Refresh Rewards"
            className="flex size-10 items-center justify-center text-[var(--n5-ink-main)] transition-transform active:rotate-180"
          >
            <RefreshCw className={cn('w-5 h-5', isRefreshing && 'animate-spin text-[var(--n5-accent)]')} />
          </button>
        </nav>

        {/* Main Content */}
        <main className="space-y-5 px-5 pb-28 pt-24">
          {loading ? (
            // Loading skeleton
            <div className="animate-pulse space-y-4">
              <div className="aspect-[1.7/1] w-full bg-[var(--n5-border-muted)]" style={{ borderRadius: 'var(--n5-radius-card)' }} />
              <div className="h-6 w-32 rounded bg-[var(--n5-border-muted)]" />
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-[180px] bg-[var(--n5-border-muted)]" style={{ borderRadius: 'var(--n5-radius-card)' }} />
                ))}
              </div>
            </div>
          ) : (
            <>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
                {/* Fully Dynamic Balance Card */}
                <BalanceCard points={currentPoints} nextReward={nextRewardPoints} streak={streak} />
              </motion.div>

              {/* YOUR ACTIVE REWARDS - Actually redeemable */}
              {activeRewards.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="font-heading text-lg font-semibold text-[var(--n5-ink-main)]">
                      Your Rewards
                    </h2>
                    <span className="rounded-full bg-[var(--n5-accent-soft)] px-2.5 py-1 text-xs font-bold text-[var(--n5-accent)]">
                      {activeRewards.length}
                      {' '}
                      Available
                    </span>
                  </div>

                  {!upcomingAppointment && (
                    <div className="border-[var(--n5-warning)]/30 bg-[var(--n5-warning)]/10 rounded-xl border p-3">
                      <p className="font-body text-sm text-[var(--n5-warning)]">
                        <span className="font-semibold">Book an appointment</span>
                        {' '}
                        to use your rewards!
                      </p>
                      <button
                        onClick={() => router.push('/book')}
                        className="font-body mt-2 text-xs font-bold uppercase tracking-wider text-[var(--n5-accent)]"
                      >
                        Book Now →
                      </button>
                    </div>
                  )}

                  {upcomingAppointment && (
                    <div className="rounded-xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] p-3">
                      <p className="font-body mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--n5-ink-muted)]">
                        Your Next Appointment
                      </p>
                      <p className="font-body text-sm font-medium text-[var(--n5-ink-main)]">
                        {new Date(upcomingAppointment.startTime).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                        {' at '}
                        {new Date(upcomingAppointment.startTime).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                      <p className="font-body mt-0.5 text-xs text-[var(--n5-ink-muted)]">
                        {upcomingAppointment.services.map(s => s.name).join(', ')}
                      </p>
                      <p className="font-body mt-1 text-xs font-semibold text-[var(--n5-ink-main)]">
                        Total: $
                        {(upcomingAppointment.totalPrice / 100).toFixed(2)}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {activeRewards.map(reward => (
                      <motion.div
                        key={reward.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center justify-between rounded-xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] p-4 shadow-sm"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex size-10 items-center justify-center rounded-full bg-[var(--n5-accent-soft)]">
                            <Gift className="size-5 text-[var(--n5-accent)]" />
                          </div>
                          <div>
                            <p className="font-body text-sm font-semibold text-[var(--n5-ink-main)]">
                              {reward.eligibleServiceName || 'Free Service'}
                            </p>
                            <p className="font-body text-xs text-[var(--n5-ink-muted)]">
                              {reward.type === 'referral_referee' ? 'Referral Bonus' : reward.type === 'referral_referrer' ? 'Referral Reward' : 'Reward'}
                              {reward.daysUntilExpiry !== null && (
                                <span className="ml-1 text-[var(--n5-warning)]">
                                  · Expires in
                                  {' '}
                                  {reward.daysUntilExpiry}
                                  {' '}
                                  days
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            triggerHaptic();
                            if (upcomingAppointment) {
                              setSelectedApiReward(reward);
                            } else {
                              router.push('/book');
                            }
                          }}
                          disabled={!upcomingAppointment}
                          className={cn(
                            'rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition-all',
                            upcomingAppointment
                              ? 'bg-[var(--n5-button-primary-bg)] text-[var(--n5-button-primary-text)] active:scale-95'
                              : 'bg-gray-200 text-gray-400 cursor-not-allowed',
                          )}
                        >
                          {upcomingAppointment ? 'Use' : 'Book First'}
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* CATALOG - Browse what's available to redeem with your points */}
              <div className="space-y-5">
                <div className="flex items-center justify-between pt-4">
                  <h2 className="font-heading text-lg font-semibold text-[var(--n5-ink-main)]">
                    Redeem Points
                  </h2>
                  <span className="font-body text-xs text-[var(--n5-ink-muted)]">
                    {currentPoints.toLocaleString()}
                    {' '}
                    pts available
                  </span>
                </div>

                {!upcomingAppointment && currentPoints > 0 && (
                  <div className="border-[var(--n5-warning)]/30 bg-[var(--n5-warning)]/10 rounded-xl border p-3">
                    <p className="font-body text-sm text-[var(--n5-warning)]">
                      <span className="font-semibold">Book an appointment</span>
                      {' '}
                      to redeem your points!
                    </p>
                    <button
                      type="button"
                      onClick={() => router.push('/book')}
                      className="font-body mt-2 text-xs font-bold uppercase tracking-wider text-[var(--n5-accent)]"
                    >
                      Book Now →
                    </button>
                  </div>
                )}

                {/* Tiers Logic - Dynamic Locking */}
                {[
                  { title: 'Small Treats', pts: '2,500', items: REWARDS_CATALOG.filter(r => r.points <= 2500) },
                  { title: 'Medium Value', pts: '4,750', items: REWARDS_CATALOG.filter(r => r.points > 2500 && r.points <= 4750) },
                  { title: 'High Value', pts: '8,750', items: REWARDS_CATALOG.filter(r => r.points > 4750 && r.points <= 8750) },
                  { title: 'Luxury Hero', pts: '25,000', items: REWARDS_CATALOG.filter(r => r.points > 8750 && r.points <= 25000) },
                  { title: 'Top Status', pts: '38,500', items: REWARDS_CATALOG.filter(r => r.points > 25000) },
                ].map(tier => (
                  <div key={tier.title}>
                    <TierHeader title={tier.title} pts={tier.pts} />
                    <div className={cn('grid gap-3 mt-3', tier.items.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
                      {tier.items.map(reward => (
                        <RewardCard
                          key={reward.id}
                          {...reward}
                          isLocked={currentPoints < reward.points}
                          onRedeem={
                            currentPoints >= reward.points && upcomingAppointment
                              ? () => handleCatalogRedeem(reward)
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* How Points Work Section */}
              <HowPointsWork />
            </>
          )}
        </main>

        <FloatingDock />

        {/* REDEEM SHEET - For API rewards (from referrals etc) */}
        <RedeemSheet
          isOpen={!!selectedApiReward}
          onClose={() => setSelectedApiReward(null)}
          reward={selectedApiReward}
          appointment={upcomingAppointment}
          clientPhone={clientPhone}
          onSuccess={handleRedeemSuccess}
        />

        {/* CATALOG REDEEM SHEET - For spending points on catalog rewards */}
        <CatalogRedeemSheet
          isOpen={!!selectedCatalogReward}
          onClose={() => setSelectedCatalogReward(null)}
          reward={selectedCatalogReward}
          appointment={upcomingAppointment}
          clientPhone={clientPhone}
          currentPoints={currentPoints}
          onSuccess={handleRedeemSuccess}
        />
      </div>
    </>
  );
}
