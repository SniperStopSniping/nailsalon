'use client';

import confetti from 'canvas-confetti';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import {
  AlertCircle,
  Calendar,
  Check,
  Clock,
  CreditCard,
  Gift,
  Home,
  RefreshCw,
  Sparkles,
  Star,
  User,
} from 'lucide-react';
import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { n5 } from '@/theme';

// --- Types ---

export type ServiceSummary = {
  id: string;
  name: string;
  price: number;
  duration: number;
};

export type TechnicianSummary = {
  id: string;
  name: string;
  imageUrl: string;
} | null;

interface BookConfirmClientProps {
  services: ServiceSummary[];
  technician: TechnicianSummary;
  salonSlug: string;
  dateStr: string;
  timeStr: string;
}

// --- Helpers ---

const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

const triggerLuxuryConfetti = () => {
  if (typeof window !== 'undefined') {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq?.matches) return;
  } else {
    return;
  }

  const duration = 1200;
  const end = Date.now() + duration;
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

// --- Subcomponents ---

/**
 * Premium Balance-style Card for Booking Summary
 */
const BookingCard = ({
  services,
  technician,
  totalPrice,
  totalDuration,
  dateStr,
  timeStr,
  pointsEarned,
}: {
  services: ServiceSummary[];
  technician: TechnicianSummary;
  totalPrice: number;
  totalDuration: number;
  dateStr: string;
  timeStr: string;
  pointsEarned: number;
}) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (typeof window === 'undefined' || shouldReduceMotion) return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma;
      const beta = e.beta;
      if (gamma === null || beta === null) return;
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

  const serviceNames = services.map(s => s.name).join(' + ');

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Not selected';
    const date = new Date(`${dateString}T00:00:00`);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const formatTime = (timeString: string) => {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const hour = Number.parseInt(hours || '0', 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  return (
    <motion.div
      style={{
        rotateX: shouldReduceMotion ? 0 : rotateX,
        rotateY: shouldReduceMotion ? 0 : rotateY,
        perspective: 1000,
      }}
      className="relative z-10 w-full select-none"
    >
      <div
        className="relative overflow-hidden border border-white/10 bg-[var(--n5-ink-main)]"
        style={{
          borderRadius: n5.radiusCard,
          boxShadow: n5.shadowLg,
        }}
      >
        {/* Decorative blurs */}
        <div className="absolute inset-0 opacity-50">
          <div className="absolute left-[-20%] top-[-50%] h-full w-4/5 rounded-full bg-[#5D4037] blur-[90px]" />
          <div className="absolute bottom-[-20%] right-[-10%] h-4/5 w-3/5 rounded-full bg-[#8D6E63] opacity-40 mix-blend-overlay blur-[60px]" />
        </div>

        {/* Content */}
        <div className="relative z-10 p-6 text-[var(--n5-ink-inverse)]">
          {/* Header with Tech & Price */}
          <div className="mb-5 flex items-center gap-4">
            {technician ? (
              <div
                className="relative size-14 shrink-0 overflow-hidden border-2 border-white/30"
                style={{ borderRadius: n5.radiusPill }}
              >
                <Image src={technician.imageUrl} alt={technician.name} fill className="object-cover" />
              </div>
            ) : (
              <div
                className="flex size-14 shrink-0 items-center justify-center bg-white/10 text-2xl"
                style={{ borderRadius: n5.radiusPill }}
              >
                🎲
              </div>
            )}
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70 font-body">Your Artist</p>
              <p className="font-heading text-lg font-semibold">{technician?.name || 'Any Available'}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70 font-body">Total</p>
              <p className="font-heading text-3xl font-bold text-[var(--n5-accent)]">${totalPrice}</p>
            </div>
          </div>

          {/* Service */}
          <div className="mb-4 flex items-center gap-3">
            <div
              className="flex size-10 items-center justify-center bg-white/10 text-lg"
              style={{ borderRadius: n5.radiusMd }}
            >
              💅
            </div>
            <div className="flex-1">
              <p className="text-xs opacity-70 font-body">Service</p>
              <p className="font-semibold font-body">{serviceNames}</p>
            </div>
            <div className="flex items-center gap-1 text-sm opacity-70 font-body">
              <Clock className="size-3.5" />
              <span>{totalDuration} min</span>
            </div>
          </div>

          {/* Date & Time */}
          <div className="mb-4 flex items-center gap-3">
            <div
              className="flex size-10 items-center justify-center bg-white/10 text-lg"
              style={{ borderRadius: n5.radiusMd }}
            >
              📅
            </div>
            <div className="flex-1">
              <p className="text-xs opacity-70 font-body">When</p>
              <p className="font-semibold font-body">{formatDate(dateStr)} at {formatTime(timeStr)}</p>
            </div>
          </div>

          {/* Points Earned */}
          <div
            className="flex items-center gap-3 border-t border-white/10 pt-4"
          >
            <div
              className="flex size-10 items-center justify-center text-lg bg-[var(--n5-accent)]"
              style={{ borderRadius: n5.radiusMd }}
            >
              ⭐
            </div>
            <div className="flex-1">
              <p className="text-xs opacity-70 font-body">You'll earn</p>
              <p className="font-semibold text-[var(--n5-accent)] font-body">+{pointsEarned} points</p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

/**
 * Loading State - High-end spa aesthetic
 */
const LoadingState = () => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--n5-bg-page)]">
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center"
    >
      {/* Elegant pulsing dots */}
      <div className="flex items-center gap-2 mb-8">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="size-2 rounded-full bg-[var(--n5-accent)]"
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.4, 1, 0.4],
            }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: i * 0.2,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
      
      {/* Refined typography */}
      <motion.p
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="font-heading text-sm tracking-[0.2em] uppercase text-[var(--n5-ink-muted)]"
      >
        Confirming
      </motion.p>
    </motion.div>
  </div>
);

/**
 * Already Has Appointment State - Premium Design
 */
const ExistingAppointmentState = ({
  onViewProfile,
}: {
  onViewProfile: () => void;
}) => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--n5-bg-page)] px-5">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md text-center"
    >
      {/* Icon */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
        className="mx-auto mb-6 flex size-24 items-center justify-center bg-[var(--n5-warning)]/10"
        style={{ borderRadius: n5.radiusPill }}
      >
        <Calendar className="size-12 text-[var(--n5-warning)]" />
      </motion.div>

      <h1 className="mb-3 font-heading text-2xl font-bold text-[var(--n5-ink-main)]">
        You Already Have an Appointment!
      </h1>
      <p className="mb-8 text-sm leading-relaxed text-[var(--n5-ink-muted)] font-body">
        Please change or cancel your existing appointment from your profile instead of booking a new one.
      </p>

      {/* Primary Button */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        type="button"
        onClick={() => {
          triggerHaptic();
          onViewProfile();
        }}
        className="mb-3 w-full py-4 font-bold transition-all active:scale-[0.98] font-body text-[var(--n5-ink-inverse)] bg-[var(--n5-accent)]"
        style={{
          borderRadius: n5.radiusMd,
          boxShadow: n5.shadowSm,
        }}
      >
        View / Change Appointment
      </motion.button>

      {/* Secondary Button */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        type="button"
        onClick={() => {
          triggerHaptic();
          onViewProfile();
        }}
        className="w-full border py-3 font-bold transition-all active:scale-[0.98] font-body text-[var(--n5-accent)]"
        style={{
          borderRadius: n5.radiusMd,
          borderColor: 'var(--n5-accent)',
        }}
      >
        View Profile
      </motion.button>
    </motion.div>
  </div>
);

/**
 * Error State - Premium Design
 */
const ErrorState = ({
  message,
  onGoBack,
}: {
  message: string;
  onGoBack: () => void;
}) => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--n5-bg-page)] px-5">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md text-center"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
        className="mx-auto mb-6 flex size-24 items-center justify-center bg-[var(--n5-error)]/10"
        style={{ borderRadius: n5.radiusPill }}
      >
        <AlertCircle className="size-12 text-[var(--n5-error)]" />
      </motion.div>

      <h1 className="mb-3 font-heading text-2xl font-bold text-[var(--n5-ink-main)]">
        Oops!
      </h1>
      <p className="mb-8 text-sm text-[var(--n5-ink-muted)] font-body">
        {message}
      </p>

      <button
        type="button"
        onClick={() => {
          triggerHaptic();
          onGoBack();
        }}
        className="w-full py-4 font-bold transition-all active:scale-[0.98] font-body text-[var(--n5-ink-inverse)] bg-[var(--n5-accent)]"
        style={{
          borderRadius: n5.radiusMd,
          boxShadow: n5.shadowSm,
        }}
      >
        Go Back
      </button>
    </motion.div>
  </div>
);

/**
 * Success State - Premium Design
 */
const SuccessContent = ({
  services,
  technician,
  totalPrice,
  totalDuration,
  dateStr,
  timeStr,
  pointsEarned,
  appointmentId,
  onViewRewards,
  onPayNow,
  onViewAppointment,
  onGoToProfile,
}: {
  services: ServiceSummary[];
  technician: TechnicianSummary;
  totalPrice: number;
  totalDuration: number;
  dateStr: string;
  timeStr: string;
  pointsEarned: number;
  appointmentId: string | null;
  onViewRewards: () => void;
  onPayNow: () => void;
  onViewAppointment: () => void;
  onGoToProfile: () => void;
}) => {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[var(--n5-bg-page)]" style={{ fontFamily: n5.fontBody }}>
      {/* Navbar */}
      <nav
        className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b px-5 pb-2 pt-12 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--n5-bg-page) 80%, transparent)',
          borderColor: 'var(--n5-border-muted)',
        }}
      >
        <div className="w-10" />
        <span className="font-heading text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]">
          Confirmed!
        </span>
        <div className="w-10" />
      </nav>

      {/* Main Content */}
      <main className="mx-auto max-w-lg space-y-6 px-5 pb-8 pt-28">
        {/* Success Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="mx-auto mb-4 flex size-20 items-center justify-center bg-[var(--n5-success)]"
            style={{ borderRadius: n5.radiusPill }}
          >
            <Check className="size-10 text-white" strokeWidth={3} />
          </motion.div>
          <h1 className="mb-1 font-heading text-2xl font-bold text-[var(--n5-ink-main)]">
            You're All Set! 💅
          </h1>
          <p className="text-sm text-[var(--n5-ink-muted)] font-body">
            Your appointment is confirmed
          </p>
        </motion.div>

        {/* Booking Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <BookingCard
            services={services}
            technician={technician}
            totalPrice={totalPrice}
            totalDuration={totalDuration}
            dateStr={dateStr}
            timeStr={timeStr}
            pointsEarned={pointsEarned}
          />
        </motion.div>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-3"
        >
          {/* Pay Now */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              onPayNow();
            }}
            className="flex w-full items-center justify-center gap-2 py-4 font-bold transition-all active:scale-[0.98] font-body text-[var(--n5-ink-inverse)] bg-[var(--n5-accent)]"
            style={{
              borderRadius: n5.radiusMd,
              boxShadow: n5.shadowSm,
            }}
          >
            <CreditCard className="size-5" />
            <span>Pay Now · ${totalPrice}</span>
          </button>

          <p className="text-center text-xs text-[var(--n5-ink-muted)] font-body">
            or pay at the salon
          </p>

          {/* View Rewards */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              onViewRewards();
            }}
            className="flex w-full items-center justify-center gap-2 border py-3 font-bold transition-all active:scale-[0.98] font-body bg-[var(--n5-bg-card)] text-[var(--n5-ink-main)]"
            style={{
              borderRadius: n5.radiusMd,
              borderColor: 'var(--n5-border)',
            }}
          >
            <Star className="size-4 text-[var(--n5-accent)]" />
            <span>View Rewards (+{pointsEarned} pts)</span>
          </button>

          {/* View/Change Appointment */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              onViewAppointment();
            }}
            className="flex w-full items-center justify-center gap-2 border py-3 font-bold transition-all active:scale-[0.98] font-body text-[var(--n5-accent)]"
            style={{
              borderRadius: n5.radiusMd,
              borderColor: 'var(--n5-accent)',
            }}
          >
            <RefreshCw className="size-4" />
            <span>View or Change Appointment</span>
          </button>

          {/* Go to Profile */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              onGoToProfile();
            }}
            className="w-full py-3 text-center font-medium text-[var(--n5-ink-muted)] transition-colors font-body hover:text-[var(--n5-accent)]"
          >
            Back to Profile →
          </button>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="pt-4 text-center"
        >
          <div className="mb-2 flex items-center justify-center gap-2">
            <Sparkles className="size-4 text-[var(--n5-accent)]" />
            <span className="text-sm text-[var(--n5-ink-muted)] font-body">We can't wait to see you!</span>
            <Sparkles className="size-4 text-[var(--n5-accent)]" />
          </div>
          <p className="text-xs text-[var(--n5-ink-muted)] font-body">
            📱 We'll send you a text reminder
          </p>
          <p className="mt-0.5 text-xs text-[var(--n5-ink-muted)] font-body">
            Free cancellation up to 24 hours before
          </p>
          {appointmentId && (
            <p className="mt-2 text-[10px] text-[var(--n5-border)] font-body">
              ID: {appointmentId}
            </p>
          )}
        </motion.div>
      </main>

      {/* Floating Dock */}
      <div
        className="fixed bottom-6 left-1/2 z-50 flex h-16 w-[90%] max-w-[400px] -translate-x-1/2 items-center justify-between px-8 bg-[var(--n5-bg-card)]/90 backdrop-blur-xl"
        style={{
          borderRadius: n5.radiusCard,
          boxShadow: n5.shadowDock,
          borderWidth: 1,
          borderColor: 'var(--n5-border)',
        }}
      >
        <button
          type="button"
          onClick={() => {
            triggerHaptic();
            router.push('/book/service');
          }}
          className="p-2 text-[var(--n5-ink-muted)] transition-colors"
          aria-label="Go to Home"
        >
          <Home strokeWidth={2} className="size-6" />
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHaptic();
            onViewRewards();
          }}
          className="p-2 text-[var(--n5-ink-muted)] transition-colors"
          aria-label="View Rewards"
        >
          <Gift strokeWidth={2} className="size-6" />
        </button>
        <div className="relative p-2">
          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              onGoToProfile();
            }}
            className="text-[var(--n5-accent)]"
            aria-label="Go to Profile"
          >
            <User strokeWidth={2} className="size-6" />
          </button>
          <div className="absolute bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[var(--n5-accent)]" />
        </div>
      </div>
    </div>
  );
};

/**
 * Name Capture Modal
 */
const NameCaptureModal = ({
  isOpen,
  firstName,
  setFirstName,
  isSaving,
  onSave,
  onSkip,
}: {
  isOpen: boolean;
  firstName: string;
  setFirstName: (name: string) => void;
  isSaving: boolean;
  onSave: () => void;
  onSkip: () => void;
}) => (
  <AnimatePresence>
    {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--n5-ink-main) 40%, transparent)',
          // GPU layer for Android stability - prevents modal shift when keyboard opens
          transform: 'translateZ(0)',
          WebkitTransform: 'translateZ(0)',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSkip();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-sm overflow-hidden bg-[var(--n5-bg-card)]"
          style={{
            borderRadius: n5.radiusCard,
            boxShadow: n5.shadowLg,
            // Prevent keyboard from pushing modal too high on Android
            maxHeight: '85vh',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: n5.spaceLg }}>
            <div className="mb-4 text-center">
              <div className="mb-3 text-4xl">👋</div>
              <h2 className="font-heading text-xl font-bold text-[var(--n5-ink-main)]">
                Before you go...
              </h2>
              <p className="mt-1 text-sm text-[var(--n5-ink-muted)] font-body">
                What's your name?
              </p>
            </div>

            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="mb-4 w-full px-4 py-3 text-lg outline-none transition-colors bg-[var(--n5-bg-surface)] text-[var(--n5-ink-main)] placeholder:text-[var(--n5-ink-muted)] font-body"
              style={{ borderRadius: n5.radiusMd }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && firstName.trim()) onSave();
              }}
              autoFocus
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onSkip}
                className="flex-1 py-3 font-medium text-[var(--n5-ink-muted)] transition-colors font-body hover:bg-[var(--n5-bg-surface)]"
                style={{ borderRadius: n5.radiusMd }}
              >
                Skip
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={!firstName.trim() || isSaving}
                className="flex-1 py-3 font-bold text-[var(--n5-ink-inverse)] transition-all disabled:opacity-50 font-body bg-[var(--n5-accent)]"
                style={{ borderRadius: n5.radiusMd }}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>

            <p className="mt-4 text-center text-xs text-[var(--n5-ink-muted)] font-body">
              We'll remember you for next time!
            </p>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

// --- Main Component ---

export function BookConfirmClient({
  services,
  technician,
  salonSlug,
  dateStr,
  timeStr,
}: BookConfirmClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  useSalon();
  const locale = (params?.locale as string) || 'en';
  const techId = searchParams.get('techId') || '';
  const clientPhone = searchParams.get('clientPhone') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';

  const [isBooking, setIsBooking] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [hasExistingAppointment, setHasExistingAppointment] = useState(false);

  const bookingInitiatedRef = useRef(false);

  const [showNameModal, setShowNameModal] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const nameCheckInitiatedRef = useRef(false);

  const totalPrice = services.reduce((sum, service) => sum + service.price, 0);
  const totalDuration = services.reduce((sum, service) => sum + service.duration, 0);
  const pointsEarned = Math.round(totalPrice * 0.1);

  const createBooking = useCallback(async () => {
    if (bookingInitiatedRef.current) return;
    bookingInitiatedRef.current = true;

    setIsBooking(true);
    setBookingError(null);

    try {
      const [hours, minutes] = timeStr.split(':').map(Number);
      const startTime = new Date(`${dateStr}T00:00:00`);
      startTime.setHours(hours || 9, minutes || 0, 0, 0);

      const requestBody = {
        salonSlug,
        serviceIds: services.map(s => s.id),
        technicianId: techId === 'any' ? null : techId,
        clientPhone,
        startTime: startTime.toISOString(),
        ...(originalAppointmentId && { originalAppointmentId }),
      };

      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();

        if (errorData.error?.code === 'EXISTING_APPOINTMENT') {
          setHasExistingAppointment(true);
          setBookingError(errorData.error?.message || 'You already have an upcoming appointment.');
          return;
        }

        throw new Error(errorData.error?.message || 'Failed to create booking');
      }

      const data = await response.json();
      setAppointmentId(data.data.appointment.id);
      setBookingComplete(true);

      // Trigger confetti
      setTimeout(() => {
        triggerHaptic();
        triggerLuxuryConfetti();
      }, 300);
    } catch (error) {
      console.error('Booking error:', error);
      setBookingError(error instanceof Error ? error.message : 'Failed to create booking');
    } finally {
      setIsBooking(false);
    }
  }, [dateStr, timeStr, salonSlug, services, techId, clientPhone, originalAppointmentId]);

  useEffect(() => {
    if (services.length > 0 && dateStr && timeStr) {
      createBooking();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (bookingComplete && !nameCheckInitiatedRef.current) {
      nameCheckInitiatedRef.current = true;

      const clientNameCookie = document.cookie
        .split('; ')
        .find(row => row.startsWith('client_name='));

      if (!clientNameCookie) {
        const timer = setTimeout(() => setShowNameModal(true), 1500);
        return () => clearTimeout(timer);
      }
    }
    return;
  }, [bookingComplete]);

  const handleSaveName = async () => {
    if (!firstName.trim() || isSavingName) return;

    setIsSavingName(true);
    try {
      await fetch('/api/client/update-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: clientPhone,
          firstName: firstName.trim(),
        }),
      });

      setShowNameModal(false);
    } catch (error) {
      console.error('Error saving name:', error);
      setShowNameModal(false);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleViewAppointment = () => {
    const bookedServiceIds = services.map(s => s.id).join(',');
    const bookedTechId = technician?.id || 'any';

    let changeUrl = `/${locale}/change-appointment?serviceIds=${bookedServiceIds}&techId=${bookedTechId}&date=${dateStr}&time=${timeStr}&clientPhone=${encodeURIComponent(clientPhone)}`;

    if (appointmentId) {
      changeUrl += `&originalAppointmentId=${encodeURIComponent(appointmentId)}`;
    }

    router.push(changeUrl);
  };

  // Loading state
  if (isBooking) {
    return <LoadingState />;
  }

  // Existing appointment error
  if (hasExistingAppointment) {
    return (
      <ExistingAppointmentState
        onViewProfile={() => router.push(`/${locale}/profile`)}
      />
    );
  }

  // Generic error
  if (bookingError) {
    return (
      <ErrorState
        message={bookingError}
        onGoBack={() => router.back()}
      />
    );
  }

  // Success state
  if (bookingComplete) {
    return (
      <>
        <SuccessContent
          services={services}
          technician={technician}
          totalPrice={totalPrice}
          totalDuration={totalDuration}
          dateStr={dateStr}
          timeStr={timeStr}
          pointsEarned={pointsEarned}
          appointmentId={appointmentId}
          onViewRewards={() => router.push(`/${locale}/rewards`)}
          onPayNow={() => router.push(`/${locale}/payment?amount=${totalPrice}`)}
          onViewAppointment={handleViewAppointment}
          onGoToProfile={() => router.push(`/${locale}/profile`)}
        />
        <NameCaptureModal
          isOpen={showNameModal}
          firstName={firstName}
          setFirstName={setFirstName}
          isSaving={isSavingName}
          onSave={handleSaveName}
          onSkip={() => setShowNameModal(false)}
        />
      </>
    );
  }

  // Default loading
  return <LoadingState />;
}
