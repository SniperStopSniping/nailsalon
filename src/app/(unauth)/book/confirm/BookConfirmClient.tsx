'use client';

import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Calendar,
  Check,
  CreditCard,
  Home,
  MapPin,
  RefreshCw,
  Sparkles,
  Star,
  User,
} from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { TechnicianAvatar } from '@/components/booking/TechnicianAvatar';
import { SectionCard } from '@/components/ui/section-card';
import { StateCard } from '@/components/ui/state-card';
import { useBookingState } from '@/hooks/useBookingState';
import { useClientSession } from '@/hooks/useClientSession';
import type { BookingStep } from '@/libs/bookingFlow';
import { appendSalonSlug, buildBookingUrl, buildChangeAppointmentUrl } from '@/libs/bookingParams';
import { buildGoogleMapsDirectionsUrl, openGoogleMapsDirections } from '@/libs/directions';
import { formatMoney } from '@/libs/formatMoney';
import { triggerHaptic } from '@/libs/haptics';
import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';
import {
  buildSmartFitExpectationFields,
  buildSmartFitSuggestionContextKey,
  type CustomerSmartFitOffer,
  describeSmartFitTimeDifference,
  dismissSmartFitSuggestion,
  isSmartFitOutrankedForSession,
  markSmartFitAvailabilityRefresh,
  markSmartFitOutrankedForSession,
  parseSmartFitCentsParam,
  parseSmartFitStaleBreakdown,
  resolveSmartFitReviewOffer,
  SMART_FIT_BADGE_LABEL,
  SMART_FIT_REVIEW_DISCOUNT_LABEL,
  SMART_FIT_STALE_FALLBACK_MESSAGE,
  smartFitReplacedByHigherPriorityDiscount,
  type SmartFitStaleBreakdown,
  syncSmartFitSuggestionDismissal,
} from '@/libs/smartFitCustomer';
import { zonedTimeToUtc } from '@/libs/timeZone';
import { useSalon } from '@/providers/SalonProvider';
import { n5 } from '@/theme';
import { formatDuration } from '@/utils/Helpers';

import { ExistingAppointmentOptions } from './ExistingAppointmentOptions';

// --- Types ---

export type ServiceSummary = {
  id: string;
  name: string;
  price: number;
  duration: number;
};

export type AddOnSummary = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  duration: number;
};

export type TechnicianSummary = {
  id: string;
  name: string;
  imageUrl: string | null;
} | null;

export type LocationSummary = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
} | null;

type BookConfirmClientProps = {
  services: ServiceSummary[];
  addOns?: AddOnSummary[];
  baseServiceId?: string | null;
  selectedAddOns?: Array<{
    addOnId: string;
    quantity?: number;
  }>;
  subtotalBeforeDiscount: number;
  discountAmount: number;
  firstVisitDiscountPreview?: {
    label: string;
    percent: number;
    amountCents: number;
  } | null;
  campaignPromotionPreview?: {
    name: string;
    displayOffer: string;
    code: string | null;
    expiresAt: string;
    discountAmountCents: number;
  } | null;
  campaignMessage?: string | null;
  totalPrice: number;
  totalDuration: number;
  technician: TechnicianSummary;
  technicianSelectionSource?: 'explicit' | 'auto' | null;
  salonSlug: string;
  dateStr: string;
  timeStr: string;
  canonicalStartTime?: string | null;
  bookingFlow: BookingStep[];
  location: LocationSummary;
  /** Whether the salon's rewards program is enabled — hides points messaging when false */
  rewardsEnabled?: boolean;
  /** Whether SMS reminders are enabled — hides "we'll text you" copy when false */
  smsEnabled?: boolean;
  clientChangeCutoffHours?: number;
  /** Salon phone for the "Call the salon" escape hatch on the duplicate-booking screen */
  salonPhone?: string | null;
};

const EMPTY_ADD_ONS: AddOnSummary[] = [];
const EMPTY_SELECTED_ADD_ONS: NonNullable<BookConfirmClientProps['selectedAddOns']> = [];

/** One nearby Smart Fit alternative, carried from the time step's availability response. */
type SmartFitSuggestion = {
  time: string;
  startTime: string | null;
  timeLabel: string;
  timeDifference: string;
  offer: CustomerSmartFitOffer;
};

// --- Helpers ---

const formatTime12h = (timeString: string) => {
  if (!timeString) {
    return '';
  }
  const [hours, minutes] = timeString.split(':');
  const hour = Number.parseInt(hours || '0', 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

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

const SummaryRow = ({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string | null;
}) => (
  <div
    className="flex items-start gap-3 rounded-2xl border px-4 py-3"
    style={{
      borderColor: 'var(--n5-border-muted)',
      backgroundColor: 'color-mix(in srgb, var(--n5-bg-card) 72%, white)',
    }}
  >
    <div
      className="flex size-10 shrink-0 items-center justify-center"
      style={{
        borderRadius: n5.radiusMd,
        backgroundColor: 'color-mix(in srgb, var(--n5-accent) 12%, white)',
        color: 'var(--n5-accent)',
      }}
    >
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <p className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--n5-ink-muted)]">
        {label}
      </p>
      <p className="font-body mt-1 text-sm font-semibold text-[var(--n5-ink-main)]">
        {value}
      </p>
      {detail && (
        <p className="font-body mt-1 text-xs leading-relaxed text-[var(--n5-ink-muted)]">
          {detail}
        </p>
      )}
    </div>
  </div>
);

const BookingCard = ({
  services,
  addOns,
  technician,
  totalPrice,
  totalDuration,
  dateStr,
  timeStr,
  pointsEarned,
  location,
  rewardsEnabled = true,
  confirmed = false,
  totalPriceDisplay,
}: {
  services: ServiceSummary[];
  addOns: AddOnSummary[];
  technician: TechnicianSummary;
  totalPrice: number;
  totalDuration: number;
  dateStr: string;
  timeStr: string;
  pointsEarned: number;
  location: LocationSummary;
  rewardsEnabled?: boolean;
  confirmed?: boolean;
  /** Preformatted total (Smart Fit pricing) — falls back to the legacy `$n` render. */
  totalPriceDisplay?: string;
}) => {
  const serviceNames = [
    ...services.map(s => s.name),
    ...addOns.map(addOn => addOn.quantity > 1 ? `${addOn.name} x${addOn.quantity}` : addOn.name),
  ].join(' + ');

  const formatDate = (dateString: string) => {
    if (!dateString) {
      return 'Not selected';
    }
    const date = new Date(`${dateString}T00:00:00`);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const formatTime = (timeString: string) => {
    if (!timeString) {
      return '';
    }
    const [hours, minutes] = timeString.split(':');
    const hour = Number.parseInt(hours || '0', 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  return (
    <motion.div className="relative z-10 w-full">
      <SectionCard
        title="Appointment summary"
        description={confirmed
          ? 'You’re all set — here are your appointment details.'
          : 'Review the details below before you confirm.'}
        className="border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
        actions={(
          <div className="text-right">
            <p className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--n5-ink-muted)]">
              Total
            </p>
            <p className="font-heading mt-1 text-2xl font-bold text-[var(--n5-accent)]">
              {totalPriceDisplay ?? `$${totalPrice}`}
            </p>
          </div>
        )}
        contentClassName="space-y-3"
      >
        <div className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--n5-border-muted)' }}>
          {technician
            ? (
                <div
                  className="relative size-12 shrink-0 overflow-hidden"
                  style={{ borderRadius: n5.radiusPill }}
                >
                  <TechnicianAvatar
                    name={technician.name}
                    imageUrl={technician.imageUrl}
                    className="size-full"
                    sizes="48px"
                  />
                </div>
              )
            : (
                <div
                  className="flex size-12 shrink-0 items-center justify-center"
                  style={{
                    borderRadius: n5.radiusPill,
                    backgroundColor: 'color-mix(in srgb, var(--n5-accent) 12%, white)',
                  }}
                >
                  <User className="size-5 text-[var(--n5-accent)]" />
                </div>
              )}
          <div className="min-w-0 flex-1">
            <p className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--n5-ink-muted)]">
              Artist
            </p>
            <p className="font-body mt-1 text-sm font-semibold text-[var(--n5-ink-main)]">
              {technician?.name ?? 'Any available artist'}
            </p>
          </div>
          <div
            className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--n5-accent) 10%, white)',
              color: 'var(--n5-accent)',
            }}
          >
            {formatDuration(totalDuration)}
          </div>
        </div>

        <SummaryRow
          icon={<Star className="size-4" />}
          label="Service"
          value={serviceNames}
          detail={rewardsEnabled
            ? `Estimated reward after completion: +${pointsEarned.toLocaleString()} points`
            : null}
        />
        <SummaryRow
          icon={<Calendar className="size-4" />}
          label="When"
          value={`${formatDate(dateStr)} at ${formatTime(timeStr)}`}
        />
        {location && (
          <SummaryRow
            icon={<MapPin className="size-4" />}
            label="Location"
            value={location.name}
            detail={location.address
              ? `${location.address}${location.city ? `, ${location.city}` : ''}`
              : null}
          />
        )}
      </SectionCard>
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
      <div className="mb-8 flex items-center gap-2">
        {[0, 1, 2].map(i => (
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
        className="font-heading text-sm uppercase tracking-[0.2em] text-[var(--n5-ink-muted)]"
      >
        Confirming your appointment
      </motion.p>
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
    <div className="w-full max-w-md space-y-3">
      <StateCard
        tone="error"
        icon={<AlertCircle className="mx-auto size-10 text-[var(--n5-error)]" />}
        title="We couldn&apos;t confirm your appointment"
        description={message}
        contentClassName="py-7"
      />
      <button
        type="button"
        onClick={() => {
          triggerHaptic('select');
          onGoBack();
        }}
        className="font-body w-full bg-[var(--n5-accent)] py-4 font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98]"
        style={{
          borderRadius: n5.radiusMd,
          boxShadow: n5.shadowSm,
        }}
      >
        Return to booking
      </button>
    </div>
  </div>
);

// Deliberately simple: enough to catch typos like "a@" without rejecting
// unusual-but-valid addresses. The server re-validates.
const isLikelyEmail = (value: string) => /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]{2,}$/.test(value.trim());

/**
 * The single rule deciding whether the contact details are complete enough to
 * book. Both the confirm button's disabled state and the hint shown underneath
 * read from here, so the button can never be greyed out for a reason the copy
 * does not explain — which is exactly what left customers stuck before.
 *
 * Returns the first unmet requirement, or null when the form is ready.
 */
export function getContactDetailsBlocker(contact: {
  name: string;
  email: string;
  phone: string;
}): string | null {
  if (!contact.name.trim()) {
    return 'Add your name to continue.';
  }
  if (!isLikelyEmail(contact.email)) {
    return 'Enter a valid email address to continue.';
  }
  if (contact.phone.replace(/\D/g, '').length < 10) {
    return 'Enter a 10-digit mobile number to continue.';
  }
  return null;
}

/** Last four digits only — never render a customer's full number back at them. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length < 4) {
    return '';
  }
  return `(•••) •••-${digits.slice(-4)}`;
}

// Per-tab persistence for guest contact details (name/email/phone only — no
// booking data). Cleared on successful booking; sessionStorage dies with the tab.
const GUEST_CONTACT_STORAGE_KEY = 'luster_booking_contact';

/**
 * Slot-taken state: another client got the time first. The selections are
 * still in the URL and the contact details are kept in sessionStorage, so
 * going back lands on the time step with everything preserved.
 */
const SlotTakenState = ({
  onPickAnotherTime,
}: {
  onPickAnotherTime: () => void;
}) => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--n5-bg-page)] px-5">
    <div className="w-full max-w-md space-y-3">
      <StateCard
        tone="error"
        icon={<AlertCircle className="mx-auto size-10 text-[var(--n5-error)]" />}
        title="That time was just booked"
        description="Someone else reserved this time while you were confirming. Your service selection is saved — pick another time to finish booking."
        contentClassName="py-7"
      />
      <button
        type="button"
        onClick={() => {
          triggerHaptic('select');
          onPickAnotherTime();
        }}
        className="font-body w-full bg-[var(--n5-accent)] py-4 font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98]"
        style={{
          borderRadius: n5.radiusMd,
          boxShadow: n5.shadowSm,
        }}
      >
        Choose another time
      </button>
    </div>
  </div>
);

/**
 * Stale Smart Fit state (P7.3): the server rejected the expected discounted
 * price with 409 SMART_FIT_CHANGED. No booking was created. Selections stay
 * in the URL and contact details stay in sessionStorage, so returning to the
 * time step is lossless; the refreshed time list receives focus there.
 */
const SmartFitStaleState = ({
  message,
  breakdown,
  onChooseAnotherTime,
}: {
  message: string;
  breakdown: SmartFitStaleBreakdown | null;
  onChooseAnotherTime: () => void;
}) => {
  // Keyboard users arrive here from the now-unmounted Confirm button; land
  // them on the one action instead of stranding focus at the document root.
  const actionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    actionRef.current?.focus();
  }, []);

  const replacedByBetterDiscount = smartFitReplacedByHigherPriorityDiscount(breakdown);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--n5-bg-page)] px-5">
      <div className="w-full max-w-md space-y-3">
        <div role="alert">
          <StateCard
            tone="error"
            icon={<AlertCircle className="mx-auto size-10 text-[var(--n5-error)]" />}
            title="Availability just changed"
            description={(
              <>
                <p>{message}</p>
                {replacedByBetterDiscount && breakdown && (
                  <p className="mt-2">
                    {`A different offer now applies to your booking. Current price for this time: ${formatMoney(breakdown.finalTotalCents)}`}
                    {breakdown.discountLabel ? ` (${breakdown.discountLabel})` : ''}
                    .
                  </p>
                )}
              </>
            )}
            contentClassName="py-7"
          />
        </div>
        <button
          ref={actionRef}
          type="button"
          onClick={() => {
            triggerHaptic('select');
            onChooseAnotherTime();
          }}
          className="font-body w-full bg-[var(--n5-accent)] py-4 font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98]"
          style={{
            borderRadius: n5.radiusMd,
            boxShadow: n5.shadowSm,
          }}
        >
          Choose another time
        </button>
      </div>
    </div>
  );
};

/**
 * Review State - explicit submit before writing booking
 */
const ConfirmContent = ({
  services,
  addOns,
  technician,
  totalPrice,
  totalDuration,
  dateStr,
  timeStr,
  pointsEarned,
  onConfirm,
  onEditSelection,
  isSubmitting,
  location,
  subtotalBeforeDiscount,
  discountAmount,
  firstVisitDiscountPreview,
  campaignPromotionPreview,
  campaignMessage,
  rewardsEnabled,
  isReschedule,
  guestName,
  guestEmail,
  guestPhone,
  smsConsent,
  smsEnabled,
  bookingError,
  onGuestNameChange,
  onGuestEmailChange,
  onGuestPhoneChange,
  onSmsConsentChange,
  smartFitOffer,
  totalPriceDisplay,
  smartFitSuggestion,
  onAcceptSmartFitSuggestion,
  onDismissSmartFitSuggestion,
  signedInAs,
}: {
  services: ServiceSummary[];
  addOns: AddOnSummary[];
  technician: TechnicianSummary;
  totalPrice: number;
  totalDuration: number;
  dateStr: string;
  timeStr: string;
  pointsEarned: number;
  onConfirm: () => void;
  onEditSelection: () => void;
  isSubmitting: boolean;
  location: LocationSummary;
  subtotalBeforeDiscount: number;
  discountAmount: number;
  firstVisitDiscountPreview: BookConfirmClientProps['firstVisitDiscountPreview'];
  campaignPromotionPreview: BookConfirmClientProps['campaignPromotionPreview'];
  campaignMessage: string | null;
  rewardsEnabled: boolean;
  isReschedule: boolean;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  smsConsent: boolean;
  smsEnabled: boolean;
  bookingError?: string | null;
  onGuestNameChange: (value: string) => void;
  onGuestEmailChange: (value: string) => void;
  onGuestPhoneChange: (value: string) => void;
  onSmsConsentChange: (value: boolean) => void;
  smartFitOffer: CustomerSmartFitOffer | null;
  totalPriceDisplay: string;
  smartFitSuggestion: SmartFitSuggestion | null;
  onAcceptSmartFitSuggestion: () => void;
  onDismissSmartFitSuggestion: () => void;
  /** Display name for a signed-in client, already masked. Null when a guest. */
  signedInAs: string | null;
}) => {
  // Focus and announcement management for the one nearby suggestion: both
  // actions unmount the banner (and the focused button with it), so focus
  // moves to the confirm button and a polite live region states the outcome.
  const confirmActionRef = useRef<HTMLButtonElement>(null);
  const [smartFitOutcomeAnnouncement, setSmartFitOutcomeAnnouncement] = useState<string | null>(null);

  // Drives both the confirm button's disabled state and the hint under it, so
  // the two can never disagree about why booking is not available yet.
  const contactBlocker = getContactDetailsBlocker({
    name: guestName,
    email: guestEmail,
    phone: guestPhone,
  });

  const handleAcceptSuggestion = () => {
    if (smartFitSuggestion) {
      setSmartFitOutcomeAnnouncement(
        `Time updated to ${smartFitSuggestion.timeLabel}. ${SMART_FIT_REVIEW_DISCOUNT_LABEL} applied.`,
      );
    }
    onAcceptSmartFitSuggestion();
    confirmActionRef.current?.focus();
  };

  const handleDismissSuggestion = () => {
    setSmartFitOutcomeAnnouncement('Keeping your selected time.');
    onDismissSmartFitSuggestion();
    confirmActionRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-[var(--n5-bg-page)]" style={{ fontFamily: n5.fontBody }}>
      <nav
        className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b px-5 pb-2 pt-12 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--n5-bg-page) 80%, transparent)',
          borderColor: 'var(--n5-border-muted)',
        }}
      >
        <button
          type="button"
          onClick={() => {
            triggerHaptic('select');
            onEditSelection();
          }}
          className="font-body text-sm font-medium text-[var(--n5-ink-muted)]"
        >
          Edit
        </button>
        <span className="font-heading text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]">
          Confirm
        </span>
        <div className="w-10" />
      </nav>

      <main className="mx-auto max-w-lg space-y-5 px-5 pb-10 pt-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="mx-auto mb-4 flex size-20 items-center justify-center"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--n5-accent) 10%, transparent)',
              borderRadius: n5.radiusPill,
            }}
          >
            <Check className="size-9 text-[var(--n5-accent)]" strokeWidth={2.5} />
          </motion.div>
          <h1 className="font-heading mb-2 text-2xl font-bold text-[var(--n5-ink-main)]">
            Review your appointment
          </h1>
          <p className="font-body mx-auto max-w-sm text-sm leading-relaxed text-[var(--n5-ink-muted)]">
            {isReschedule
              ? 'Your current appointment stays booked until you confirm this new time.'
              : 'Nothing is booked yet. Confirm below to reserve this time.'}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <BookingCard
            services={services}
            addOns={addOns}
            technician={technician}
            totalPrice={totalPrice}
            totalDuration={totalDuration}
            dateStr={dateStr}
            timeStr={timeStr}
            pointsEarned={pointsEarned}
            location={location}
            rewardsEnabled={rewardsEnabled}
            totalPriceDisplay={totalPriceDisplay}
          />
        </motion.div>

        {/* Outcome of the suggestion (accepted/kept) for screen readers */}
        <div aria-live="polite" className="sr-only">
          {smartFitOutcomeAnnouncement}
        </div>

        {smartFitSuggestion && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            <div
              role="group"
              aria-label="Smart Fit suggestion"
              data-testid="smart-fit-suggestion"
              className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
            >
              <p className="font-body text-sm font-semibold text-emerald-950">
                {`Save ${formatMoney(smartFitSuggestion.offer.discountAmountCents)} by booking ${smartFitSuggestion.timeDifference}`}
              </p>
              <p className="font-body mt-1 text-xs text-emerald-800">
                {smartFitSuggestion.timeLabel}
                {' · '}
                {formatMoney(smartFitSuggestion.offer.discountedPriceCents)}
                {' instead of '}
                {formatMoney(smartFitSuggestion.offer.originalPriceCents)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('confirm');
                    handleAcceptSuggestion();
                  }}
                  className="font-body rounded-xl bg-[var(--n5-accent)] px-4 py-2.5 text-sm font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98]"
                >
                  Choose this time
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('select');
                    handleDismissSuggestion();
                  }}
                  className="font-body rounded-xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-900 transition-all active:scale-[0.98]"
                >
                  Keep my time
                </button>
              </div>
            </div>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-3"
        >
          <SectionCard
            title="Your contact details"
            description="No account or phone verification is required. We use your email for the confirmation and secure management link."
            className="border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
            contentClassName="space-y-3 pt-0"
          >
            {signedInAs && (
              <p data-testid="signed-in-notice" className="rounded-xl border border-[var(--n5-border-muted)] bg-[var(--n5-bg-page)] p-3 text-xs leading-5 text-[var(--n5-ink-muted)]">
                You&apos;re signed in as
                {' '}
                <span className="font-semibold text-[var(--n5-ink-main)]">{signedInAs}</span>
                . We&apos;ve filled in your details.
              </p>
            )}
            <label className="block text-xs font-semibold text-[var(--n5-ink-muted)]">
              <span className="flex items-baseline justify-between gap-2">
                Name
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--n5-ink-muted)]">Required</span>
              </span>
              <input aria-label="Customer name" required aria-required="true" autoComplete="name" value={guestName} onChange={event => onGuestNameChange(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--n5-border)] bg-[var(--n5-bg-page)] p-3 text-sm text-[var(--n5-ink-main)] outline-none focus:border-[var(--n5-accent)]" />
            </label>
            <label className="block text-xs font-semibold text-[var(--n5-ink-muted)]">
              <span className="flex items-baseline justify-between gap-2">
                Email
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--n5-ink-muted)]">Required</span>
              </span>
              <input aria-label="Customer email" required aria-required="true" type="email" autoComplete="email" value={guestEmail} onChange={event => onGuestEmailChange(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--n5-border)] bg-[var(--n5-bg-page)] p-3 text-sm text-[var(--n5-ink-main)] outline-none focus:border-[var(--n5-accent)]" />
            </label>
            <label className="block text-xs font-semibold text-[var(--n5-ink-muted)]">
              <span className="flex items-baseline justify-between gap-2">
                Mobile phone
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--n5-ink-muted)]">Required</span>
              </span>
              <input aria-label="Customer phone" required aria-required="true" type="tel" inputMode="tel" autoComplete="tel" value={guestPhone} onChange={event => onGuestPhoneChange(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--n5-border)] bg-[var(--n5-bg-page)] p-3 text-sm text-[var(--n5-ink-main)] outline-none focus:border-[var(--n5-accent)]" />
            </label>
            {smsEnabled && (
              <label className="flex items-start gap-3 rounded-xl border border-[var(--n5-border-muted)] p-3 text-xs leading-5 text-[var(--n5-ink-muted)]">
                <input aria-label="SMS consent" type="checkbox" checked={smsConsent} onChange={event => onSmsConsentChange(event.target.checked)} className="mt-1" />
                <span>I agree to receive transactional appointment confirmations and reminders by text. Consent is optional, message/data rates may apply, and I can reply STOP at any time.</span>
              </label>
            )}
          </SectionCard>

          <SectionCard
            title="Before you confirm"
            description="This will reserve the time above and block duplicate bookings on the same account."
            className="border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
            contentClassName="grid gap-2 pt-0 sm:grid-cols-2"
          >
            {campaignPromotionPreview && discountAmount > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm sm:col-span-2">
                <span className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  Welcome-back offer
                </span>
                <p className="font-body mt-1 font-semibold text-emerald-950">
                  {campaignPromotionPreview.name}
                  {' · '}
                  {campaignPromotionPreview.displayOffer}
                </p>
                <p className="font-body mt-1 text-xs text-emerald-800">
                  Subtotal $
                  {subtotalBeforeDiscount.toFixed(2)}
                  {' · Savings $'}
                  {discountAmount.toFixed(2)}
                  {campaignPromotionPreview.code ? ` · Code ${campaignPromotionPreview.code}` : ''}
                </p>
              </div>
            )}
            {firstVisitDiscountPreview && discountAmount > 0 && (
              <div className="rounded-xl border p-3 text-sm sm:col-span-2" style={{ borderColor: 'var(--n5-border-muted)' }}>
                <span className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--n5-ink-muted)]">
                  Offer
                </span>
                <p className="font-body mt-1 font-semibold text-[var(--n5-ink-main)]">
                  First visit discount applied: -
                  {firstVisitDiscountPreview.percent}
                  %
                </p>
                <p className="font-body mt-1 text-xs text-[var(--n5-ink-muted)]">
                  Subtotal $
                  {subtotalBeforeDiscount.toFixed(2)}
                  {' '}
                  · Savings $
                  {discountAmount.toFixed(2)}
                </p>
              </div>
            )}
            {smartFitOffer && (
              <div
                data-testid="smart-fit-review"
                className="rounded-xl border p-3 text-sm sm:col-span-2"
                style={{ borderColor: 'var(--n5-border-muted)' }}
              >
                <span className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--n5-ink-muted)]">
                  {SMART_FIT_BADGE_LABEL}
                </span>
                <p className="font-body mt-1 font-semibold text-[var(--n5-ink-main)]">
                  {`${SMART_FIT_REVIEW_DISCOUNT_LABEL} applied`}
                </p>
                <p className="font-body mt-1 text-xs text-[var(--n5-ink-muted)]">
                  {`Subtotal ${formatMoney(smartFitOffer.originalPriceCents)}`}
                  {` · ${SMART_FIT_REVIEW_DISCOUNT_LABEL} −${formatMoney(smartFitOffer.discountAmountCents)}`}
                  {` · Total ${formatMoney(smartFitOffer.discountedPriceCents)}`}
                </p>
              </div>
            )}
            <div className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--n5-border-muted)' }}>
              <span className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--n5-ink-muted)]">
                Duration
              </span>
              <p className="font-body mt-1 font-semibold text-[var(--n5-ink-main)]">
                {formatDuration(totalDuration)}
              </p>
            </div>
            {rewardsEnabled && (
              <div className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--n5-border-muted)' }}>
                <span className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--n5-ink-muted)]">
                  Rewards
                </span>
                <p className="font-body mt-1 font-semibold text-[var(--n5-ink-main)]">
                  +
                  {pointsEarned.toLocaleString()}
                  {' '}
                  points after completion
                </p>
              </div>
            )}
          </SectionCard>

          {campaignMessage && (
            <div
              role="status"
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {campaignMessage}
              {' Regular booking prices apply.'}
            </div>
          )}

          {bookingError && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {bookingError}
              {' '}
              Your details below are saved — you can try again.
            </div>
          )}

          <button
            ref={confirmActionRef}
            type="button"
            onClick={() => {
              triggerHaptic('confirm');
              onConfirm();
            }}
            disabled={isSubmitting || contactBlocker !== null}
            className="font-body flex w-full items-center justify-center gap-2 bg-[var(--n5-accent)] py-4 font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderRadius: n5.radiusMd,
              boxShadow: n5.shadowSm,
            }}
          >
            {isSubmitting
              ? (
                  <>
                    <RefreshCw className="size-5 animate-spin" />
                    <span>Confirming appointment...</span>
                  </>
                )
              : (
                  <>
                    <Check className="size-5" />
                    <span>
                      {`Confirm appointment · ${totalPriceDisplay}`}
                    </span>
                  </>
                )}
          </button>

          {!isSubmitting && contactBlocker && (
            <p data-testid="contact-blocker-hint" role="status" className="text-center text-xs text-[var(--n5-ink-muted)]">
              {contactBlocker}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              triggerHaptic('select');
              onEditSelection();
            }}
            className="font-body flex w-full items-center justify-center gap-2 border py-3 font-bold text-[var(--n5-accent)] transition-all active:scale-[0.98]"
            style={{
              borderRadius: n5.radiusMd,
              borderColor: 'var(--n5-accent)',
            }}
          >
            <RefreshCw className="size-4" />
            <span>Change time or services</span>
          </button>
        </motion.div>
      </main>
    </div>
  );
};

/**
 * Success State - Premium Design
 */
const SuccessContent = ({
  services,
  addOns,
  technician,
  totalPrice,
  totalDuration,
  dateStr,
  timeStr,
  pointsEarned,
  appointmentId,
  onViewRewards,
  onManagePayment,
  onViewAppointment,
  onOpenDirections,
  onGoToProfile,
  onGoHome,
  location,
  rewardsEnabled,
  smsEnabled,
  smsConsentGranted,
  showClientAccountActions,
  manageUrl,
  canonicalStartTime,
  clientChangeCutoffHours,
  totalPriceDisplay,
}: {
  services: ServiceSummary[];
  addOns: AddOnSummary[];
  technician: TechnicianSummary;
  totalPrice: number;
  totalDuration: number;
  dateStr: string;
  timeStr: string;
  pointsEarned: number;
  appointmentId: string | null;
  totalPriceDisplay: string;
  onViewRewards: () => void;
  onManagePayment: () => void;
  onViewAppointment: () => void;
  onOpenDirections: () => void;
  onGoToProfile: () => void;
  onGoHome: () => void;
  location: LocationSummary;
  rewardsEnabled: boolean;
  smsEnabled: boolean;
  smsConsentGranted: boolean;
  showClientAccountActions: boolean;
  manageUrl: string | null;
  canonicalStartTime: string | null;
  clientChangeCutoffHours: number;
}) => {
  const directionsUrl = buildGoogleMapsDirectionsUrl(location);
  const calendarStart = canonicalStartTime ? new Date(canonicalStartTime) : null;
  const calendarEnd = calendarStart ? new Date(calendarStart.getTime() + totalDuration * 60 * 1000) : null;
  const googleCalendarUrl = calendarStart && calendarEnd
    ? `https://calendar.google.com/calendar/render?${new URLSearchParams({
      action: 'TEMPLATE',
      text: services.map(service => service.name).join(', ') || 'Nail appointment',
      dates: `${calendarStart.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}/${calendarEnd.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
      details: 'Booked through Luster. Use your private confirmation link to reschedule or cancel.',
    }).toString()}`
    : null;

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
          Confirmed
        </span>
        <div className="w-10" />
      </nav>

      {/* Main Content */}
      <main className="mx-auto max-w-lg space-y-5 px-5 pb-10 pt-28">
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
          <h1 className="font-heading mb-1 text-2xl font-bold text-[var(--n5-ink-main)]">
            Appointment confirmed
          </h1>
          <p className="font-body text-sm text-[var(--n5-ink-muted)]">
            Your time is reserved
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
            addOns={addOns}
            technician={technician}
            totalPrice={totalPrice}
            totalDuration={totalDuration}
            dateStr={dateStr}
            timeStr={timeStr}
            pointsEarned={pointsEarned}
            location={location}
            rewardsEnabled={rewardsEnabled}
            confirmed
            totalPriceDisplay={totalPriceDisplay}
          />
        </motion.div>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-3"
        >
          <button
            type="button"
            onClick={() => {
              triggerHaptic('confirm');
              onViewAppointment();
            }}
            className="font-body flex w-full items-center justify-center gap-2 bg-[var(--n5-accent)] py-4 font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98]"
            style={{
              borderRadius: n5.radiusMd,
              boxShadow: n5.shadowSm,
            }}
          >
            <RefreshCw className="size-5" />
            <span>Manage this appointment</span>
          </button>

          {manageUrl && (
            <div className="grid grid-cols-2 gap-3">
              {googleCalendarUrl && (
                <a href={googleCalendarUrl} target="_blank" rel="noreferrer" className="font-body flex items-center justify-center gap-2 rounded-xl border py-3 text-center text-sm font-semibold text-[var(--n5-ink-main)]" style={{ borderColor: 'var(--n5-border)' }}>
                  <Calendar className="size-4" />
                  Google Calendar
                </a>
              )}
              <a href={`${manageUrl}/calendar.ics`} className="font-body flex items-center justify-center gap-2 rounded-xl border py-3 text-center text-sm font-semibold text-[var(--n5-ink-main)]" style={{ borderColor: 'var(--n5-border)' }}>
                <Calendar className="size-4" />
                Apple Calendar
              </a>
            </div>
          )}

          <div className={`grid gap-3 ${directionsUrl && showClientAccountActions ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
            {directionsUrl && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('select');
                  onOpenDirections();
                }}
                className="font-body flex w-full items-center justify-center gap-2 border bg-[var(--n5-bg-card)] py-3.5 font-bold text-[var(--n5-ink-main)] transition-all active:scale-[0.98]"
                style={{
                  borderRadius: n5.radiusMd,
                  borderColor: 'var(--n5-border)',
                }}
              >
                <MapPin className="size-4 text-[var(--n5-accent)]" />
                <span>Directions</span>
              </button>
            )}

            {showClientAccountActions && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('confirm');
                  onManagePayment();
                }}
                className="font-body flex w-full items-center justify-center gap-2 border bg-[var(--n5-bg-card)] py-3.5 font-bold text-[var(--n5-ink-main)] transition-all active:scale-[0.98]"
                style={{
                  borderRadius: n5.radiusMd,
                  borderColor: 'var(--n5-border)',
                }}
              >
                <CreditCard className="size-4 text-[var(--n5-accent)]" />
                <span>How to pay</span>
              </button>
            )}
          </div>

          {showClientAccountActions && rewardsEnabled && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic('select');
                onViewRewards();
              }}
              className="font-body flex w-full items-center justify-center gap-2 border bg-[var(--n5-bg-card)] py-3 font-bold text-[var(--n5-ink-main)] transition-all active:scale-[0.98]"
              style={{
                borderRadius: n5.radiusMd,
                borderColor: 'var(--n5-border)',
              }}
            >
              <Star className="size-4 text-[var(--n5-accent)]" />
              <span>View rewards &amp; pending points</span>
            </button>
          )}

          <div className={`grid gap-3 pt-1 ${showClientAccountActions ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <button
              type="button"
              onClick={() => {
                triggerHaptic('select');
                onGoHome();
              }}
              className="font-body flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold text-[var(--n5-ink-main)] transition-all active:scale-[0.98]"
              style={{ borderColor: 'var(--n5-border)' }}
            >
              <Home className="size-4" />
              <span>Back to booking</span>
            </button>
            {showClientAccountActions && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('select');
                  onGoToProfile();
                }}
                className="font-body flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold text-[var(--n5-accent)] transition-all active:scale-[0.98]"
                style={{ borderColor: 'var(--n5-accent)' }}
              >
                <User className="size-4" />
                <span>Profile</span>
              </button>
            )}
          </div>
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
            <span className="font-body text-sm text-[var(--n5-ink-muted)]">We&apos;re looking forward to your visit.</span>
            <Sparkles className="size-4 text-[var(--n5-accent)]" />
          </div>
          {smsEnabled && smsConsentGranted && (
            <p className="font-body text-xs text-[var(--n5-ink-muted)]">
              We&apos;ll text you before your visit
            </p>
          )}
          <p className="font-body mt-0.5 text-xs text-[var(--n5-ink-muted)]">
            You can change or cancel up to
            {' '}
            {clientChangeCutoffHours}
            {' '}
            hours before
          </p>
          {appointmentId && (
            <p className="font-body mt-2 text-[10px] text-[var(--n5-border)]">
              ID:
              {' '}
              {appointmentId}
            </p>
          )}
        </motion.div>
      </main>

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
          if (e.target === e.currentTarget) {
            onSkip();
          }
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
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: n5.spaceLg }}>
            <div className="mb-4 text-center">
              <div className="mb-3 text-4xl">👋</div>
              <h2 className="font-heading text-xl font-bold text-[var(--n5-ink-main)]">
                Before you go...
              </h2>
              <p className="font-body mt-1 text-sm text-[var(--n5-ink-muted)]">
                What's your name?
              </p>
            </div>

            <input
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="First name"
              className="font-body mb-4 w-full bg-[var(--n5-bg-surface)] px-4 py-3 text-lg text-[var(--n5-ink-main)] outline-none transition-colors placeholder:text-[var(--n5-ink-muted)]"
              style={{ borderRadius: n5.radiusMd }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && firstName.trim()) {
                  onSave();
                }
              }}
              autoFocus
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onSkip}
                className="font-body flex-1 py-3 font-medium text-[var(--n5-ink-muted)] transition-colors hover:bg-[var(--n5-bg-surface)]"
                style={{ borderRadius: n5.radiusMd }}
              >
                Skip
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={!firstName.trim() || isSaving}
                className="font-body flex-1 bg-[var(--n5-accent)] py-3 font-bold text-[var(--n5-ink-inverse)] transition-all disabled:opacity-50"
                style={{ borderRadius: n5.radiusMd }}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>

            <p className="font-body mt-4 text-center text-xs text-[var(--n5-ink-muted)]">
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
  addOns = EMPTY_ADD_ONS,
  baseServiceId = null,
  selectedAddOns = EMPTY_SELECTED_ADD_ONS,
  subtotalBeforeDiscount,
  discountAmount = 0,
  firstVisitDiscountPreview = null,
  campaignPromotionPreview = null,
  campaignMessage = null,
  totalPrice,
  totalDuration,
  technician,
  technicianSelectionSource = null,
  salonSlug,
  dateStr,
  timeStr,
  canonicalStartTime = null,
  // bookingFlow is passed for consistency but not used in confirm step
  bookingFlow: _bookingFlow,
  location,
  rewardsEnabled = true,
  smsEnabled = true,
  clientChangeCutoffHours = 24,
  salonPhone = null,
}: BookConfirmClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  useSalon();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;
  const techId = searchParams.get('techId') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const manageToken = searchParams.get('manageToken') || '';
  const campaignToken = searchParams.get('campaign') || '';
  const urlLocationId = searchParams.get('locationId') || '';
  const urlServiceIdsParam = searchParams.get('serviceIds') || '';
  const urlServiceIds = urlServiceIdsParam ? urlServiceIdsParam.split(',').filter(Boolean) : [];

  // Smart Fit (P7.3): server-derived preview values relayed from the time
  // step's availability response. Display hints only — the booking API stays
  // authoritative and rejects a stale expectation with 409 SMART_FIT_CHANGED.
  const smartFitDiscountCentsParam = parseSmartFitCentsParam(searchParams.get('smartFitDiscountCents'));
  const smartFitTotalCentsParam = parseSmartFitCentsParam(searchParams.get('smartFitTotalCents'));
  const smartFitSuggestTimeParam = searchParams.get('smartFitSuggestTime') || '';
  const smartFitSuggestStartTimeParam = searchParams.get('smartFitSuggestStartTime') || '';
  const smartFitSuggestDiscountCentsParam = parseSmartFitCentsParam(searchParams.get('smartFitSuggestDiscountCents'));
  const smartFitSuggestTotalCentsParam = parseSmartFitCentsParam(searchParams.get('smartFitSuggestTotalCents'));
  const {
    isLoggedIn,
    isCheckingSession,
    phone: sessionPhone,
    validateSession,
    clientName,
    clientEmail,
  } = useClientSession();

  // Sync booking state from URL on mount (for consistency)
  const { syncFromUrl } = useBookingState(salonSlug);
  useEffect(() => {
    syncFromUrl({
      techId: techId || null,
      technicianSelectionSource,
      baseServiceId,
      selectedAddOns,
      serviceIds: services.map(service => service.id),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const [isBooking, setIsBooking] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [slotTaken, setSlotTaken] = useState(false);
  const [smartFitStale, setSmartFitStale] = useState<{
    message: string;
    breakdown: SmartFitStaleBreakdown | null;
  } | null>(null);
  const [smartFitSuggestionDismissed, setSmartFitSuggestionDismissed] = useState(false);
  // Set once the booking API has proven a higher-priority discount out-ranks
  // Smart Fit for this visitor (session-scoped) — stops re-promising it.
  const [smartFitOutranked, setSmartFitOutranked] = useState(false);

  useEffect(() => {
    if (isSmartFitOutrankedForSession(salonSlug)) {
      setSmartFitOutranked(true);
    }
  }, [salonSlug]);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const [hasExistingAppointment, setHasExistingAppointment] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);

  useEffect(() => {
    if (isLoggedIn) {
      setGuestName(current => current || clientName || '');
      setGuestEmail(current => current || clientEmail || '');
      setGuestPhone(current => current || sessionPhone || '');
    }
  }, [clientEmail, clientName, isLoggedIn, sessionPhone]);

  // Contact details survive navigation and recoverable errors within this tab,
  // so a failed attempt or a trip back to the time step never re-asks for them.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(GUEST_CONTACT_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { name?: string; email?: string; phone?: string };
        setGuestName(current => current || saved.name || '');
        setGuestEmail(current => current || saved.email || '');
        setGuestPhone(current => current || saved.phone || '');
      }
    } catch {
      // Storage unavailable (private mode etc.) — degrade silently.
    }
  }, []);

  useEffect(() => {
    if (!guestName && !guestEmail && !guestPhone) {
      return;
    }
    try {
      sessionStorage.setItem(
        GUEST_CONTACT_STORAGE_KEY,
        JSON.stringify({ name: guestName, email: guestEmail, phone: guestPhone }),
      );
    } catch {
      // Storage unavailable — degrade silently.
    }
  }, [guestName, guestEmail, guestPhone]);

  const bookingInitiatedRef = useRef(false);
  // Stable idempotency key for this booking session - prevents double-submit
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const [showNameModal, setShowNameModal] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const nameCheckInitiatedRef = useRef(false);

  // Smart Fit precedence stays winner-take-all: any higher-priority discount
  // (campaign, first visit) means no Smart Fit presentation and no
  // expectation fields — the server prices the booking on its own.
  const hasOtherDiscount = discountAmount > 0
    || Boolean(firstVisitDiscountPreview)
    || Boolean(campaignPromotionPreview)
    || smartFitOutranked;
  const subtotalCents = Math.round(subtotalBeforeDiscount * 100);
  const smartFitOffer = resolveSmartFitReviewOffer({
    subtotalCents,
    discountCentsParam: smartFitDiscountCentsParam,
    totalCentsParam: smartFitTotalCentsParam,
    hasOtherDiscount,
  });

  const smartFitSuggestionTimeDifference = !smartFitOffer && smartFitSuggestTimeParam
    ? describeSmartFitTimeDifference(timeStr, smartFitSuggestTimeParam)
    : null;
  const smartFitSuggestedOffer = smartFitSuggestionTimeDifference
    ? resolveSmartFitReviewOffer({
      subtotalCents,
      discountCentsParam: smartFitSuggestDiscountCentsParam,
      totalCentsParam: smartFitSuggestTotalCentsParam,
      hasOtherDiscount,
    })
    : null;

  // Dismissal is scoped to the exact booking context; a material change
  // (service, add-ons, technician, location, date) resets it.
  const smartFitSuggestionContextKey = buildSmartFitSuggestionContextKey({
    salonSlug,
    dateKey: dateStr,
    techId: techId || 'any',
    locationId: urlLocationId || null,
    baseServiceId,
    serviceIds: urlServiceIds,
    selectedAddOns,
  });
  useEffect(() => {
    // Only flows that actually carry a suggestion touch the dismissal store —
    // a legacy confirm mount must not clear another flow's dismissal.
    if (!smartFitSuggestTimeParam) {
      return;
    }
    if (syncSmartFitSuggestionDismissal(smartFitSuggestionContextKey)) {
      setSmartFitSuggestionDismissed(true);
    }
  }, [smartFitSuggestionContextKey, smartFitSuggestTimeParam]);

  const smartFitSuggestion: SmartFitSuggestion | null
    = smartFitSuggestedOffer && smartFitSuggestionTimeDifference && !smartFitSuggestionDismissed
      ? {
          time: smartFitSuggestTimeParam,
          startTime: smartFitSuggestStartTimeParam || null,
          timeLabel: formatTime12h(smartFitSuggestTimeParam),
          timeDifference: smartFitSuggestionTimeDifference,
          offer: smartFitSuggestedOffer,
        }
      : null;

  const resolvedTotalPrice = smartFitOffer
    ? smartFitOffer.discountedPriceCents / 100
    : totalPrice;
  const totalPriceDisplay = smartFitOffer
    ? formatMoney(smartFitOffer.discountedPriceCents)
    : `$${totalPrice}`;
  const resolvedTotalDuration = totalDuration;
  const resolvedSubtotalBeforeDiscount = subtotalBeforeDiscount;
  // totalPrice is in dollars, convert to cents for points calculation
  const pointsEarned = computeEarnedPointsFromCents(Math.round(resolvedTotalPrice * 100));

  const handleAcceptSmartFitSuggestion = useCallback(() => {
    if (!smartFitSuggestion) {
      return;
    }
    // Switch the selection to the suggested Smart Fit slot: same booking
    // context, new time, expectation params from the same availability data.
    router.replace(buildBookingUrl(`/${locale}/book/confirm`, {
      salonSlug,
      serviceIds: urlServiceIds.length > 0 ? urlServiceIds : undefined,
      baseServiceId,
      selectedAddOns,
      techId: techId || 'any',
      date: dateStr,
      time: smartFitSuggestion.time,
      startTime: smartFitSuggestion.startTime,
      locationId: urlLocationId || null,
      originalAppointmentId,
      manageToken,
      campaignToken,
      smartFitDiscountCents: smartFitSuggestion.offer.discountAmountCents,
      smartFitTotalCents: smartFitSuggestion.offer.discountedPriceCents,
    }, {
      routeSalonSlug,
      locale,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseServiceId, campaignToken, dateStr, locale, manageToken, originalAppointmentId, routeSalonSlug, router, salonSlug, selectedAddOns, smartFitSuggestion, techId, urlLocationId, urlServiceIdsParam]);

  const handleDismissSmartFitSuggestion = useCallback(() => {
    dismissSmartFitSuggestion(smartFitSuggestionContextKey);
    setSmartFitSuggestionDismissed(true);
  }, [smartFitSuggestionContextKey]);

  const createBooking = useCallback(async () => {
    if (bookingInitiatedRef.current) {
      return;
    }
    bookingInitiatedRef.current = true;

    setIsBooking(true);
    setBookingError(null);

    try {
      const parsedCanonicalStartTime = canonicalStartTime ? new Date(canonicalStartTime) : null;
      const startTime = parsedCanonicalStartTime && !Number.isNaN(parsedCanonicalStartTime.getTime())
        ? parsedCanonicalStartTime
        : zonedTimeToUtc({ date: dateStr, time: timeStr });

      const requestBody = {
        salonSlug,
        ...(baseServiceId
          ? {
              baseServiceId,
              selectedAddOns,
            }
          : {
              serviceIds: services.map(s => s.id),
            }),
        technicianId: techId === 'any' ? null : techId,
        clientName: guestName.trim(),
        clientEmail: guestEmail.trim().toLowerCase(),
        clientPhone: guestPhone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''),
        ...(smsEnabled && { smsConsent: { granted: smsConsent, wordingVersion: 'booking-v1' } }),
        startTime: startTime.toISOString(),
        appointmentDate: dateStr,
        appointmentTime: timeStr,
        ...(location?.id && { locationId: location.id }),
        ...(originalAppointmentId && { originalAppointmentId }),
        ...(manageToken && { manageToken }),
        ...(campaignPromotionPreview && campaignToken && { campaignToken }),
        // Smart Fit expectations (P7.2 contract): only for a displayed Smart
        // Fit offer, and only these two approved fields. The server rejects a
        // stale expectation with 409 SMART_FIT_CHANGED instead of booking at
        // a different price than shown.
        ...(smartFitOffer && buildSmartFitExpectationFields(smartFitOffer)),
      };

      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        // Log response for debugging (cap body to avoid console flooding)
        const responseText = await response.text();
        console.error('Booking API error:', {
          status: response.status,
          statusText: response.statusText,
          body: responseText.slice(0, 2000),
        });

        // A failed attempt may be retried with edited details or a new time;
        // a fresh idempotency key keeps the retry from being rejected as a
        // key reuse with a different payload.
        idempotencyKeyRef.current = crypto.randomUUID();

        // Try to parse as JSON for error message
        let errorData;
        try {
          errorData = JSON.parse(responseText);
        } catch {
          // Never surface raw server output (HTML error pages, stack traces).
          throw new Error('Something went wrong on our end while confirming your appointment. Please try again in a moment.');
        }

        if (errorData.error?.code === 'EXISTING_APPOINTMENT') {
          setHasExistingAppointment(true);
          setBookingError(errorData.error?.message || 'You already have an upcoming appointment.');
          bookingInitiatedRef.current = false;
          return;
        }

        if (errorData.error?.code === 'TIME_CONFLICT' || errorData.error?.code === 'NO_AVAILABLE_TECHNICIAN') {
          setSlotTaken(true);
          bookingInitiatedRef.current = false;
          return;
        }

        if (errorData.error?.code === 'SMART_FIT_CHANGED') {
          // The expected discounted price is no longer valid. No booking was
          // created; the client re-picks from refreshed availability instead
          // of this stale expectation ever being resubmitted.
          const breakdown = parseSmartFitStaleBreakdown(errorData.error?.details);
          if (smartFitReplacedByHigherPriorityDiscount(breakdown)) {
            // The server proved this visitor's identity earns a bigger,
            // higher-priority discount. Stop promising Smart Fit savings for
            // the rest of this session so the same 409 cannot loop.
            markSmartFitOutrankedForSession(salonSlug);
            setSmartFitOutranked(true);
          }
          setSmartFitStale({
            message: typeof errorData.error?.message === 'string' && errorData.error.message
              ? errorData.error.message
              : SMART_FIT_STALE_FALLBACK_MESSAGE,
            breakdown,
          });
          bookingInitiatedRef.current = false;
          return;
        }

        throw new Error(errorData.error?.message || `We couldn't confirm this booking (code ${response.status}). Please try again.`);
      }

      const data = await response.json();
      setAppointmentId(data.data.appointmentId || data.data.appointment.id);
      setManageUrl(data.data.manageUrl || null);
      setBookingComplete(true);
      try {
        sessionStorage.removeItem(GUEST_CONTACT_STORAGE_KEY);
      } catch {
        // Storage unavailable — nothing to clear.
      }

      // Trigger confetti
      setTimeout(() => {
        triggerHaptic('success');
        triggerLuxuryConfetti();
      }, 300);
    } catch (error) {
      console.error('Booking error:', error);
      setBookingError(error instanceof Error ? error.message : 'Failed to create booking');
      bookingInitiatedRef.current = false;
    } finally {
      setIsBooking(false);
    }
  }, [baseServiceId, campaignPromotionPreview, campaignToken, canonicalStartTime, dateStr, guestEmail, guestName, guestPhone, location, manageToken, originalAppointmentId, salonSlug, selectedAddOns, services, smartFitOffer, smsConsent, smsEnabled, techId, timeStr]);

  useEffect(() => {
    if (bookingComplete && !nameCheckInitiatedRef.current) {
      nameCheckInitiatedRef.current = true;

      if (isLoggedIn && !clientName?.trim()) {
        const timer = setTimeout(() => setShowNameModal(true), 1500);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [bookingComplete, clientName, isLoggedIn]);

  const handleSaveName = async () => {
    if (!firstName.trim() || isSavingName) {
      return;
    }

    setIsSavingName(true);
    try {
      const response = await fetch('/api/client/update-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
        }),
      });

      if (response.ok) {
        await validateSession();
      }

      setShowNameModal(false);
    } catch (error) {
      console.error('Error saving name:', error);
      setShowNameModal(false);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleViewAppointment = () => {
    if (manageUrl) {
      window.location.assign(manageUrl);
      return;
    }
    if (!appointmentId) {
      return;
    }

    router.push(buildChangeAppointmentUrl({
      basePath: `/${locale}/change-appointment`,
      salonSlug,
      serviceIds: baseServiceId ? undefined : services.map(s => s.id),
      baseServiceId,
      selectedAddOns,
      techId: technician?.id || 'any',
      locationId: location?.id ?? null,
      originalAppointmentId: appointmentId,
      manageToken: manageToken || null,
      startTime: canonicalStartTime ?? zonedTimeToUtc({ date: dateStr, time: timeStr }).toISOString(),
      tenantRoute: {
        routeSalonSlug,
        locale,
      },
    }));
  };

  const handleOpenDirections = useCallback(() => {
    openGoogleMapsDirections(location);
  }, [location]);

  if (isCheckingSession) {
    return <LoadingState />;
  }

  // Loading state
  if (isBooking) {
    return <LoadingState />;
  }

  // Existing appointment error: the server (never browser state) confirmed an
  // active appointment for this phone. Offer every path forward instead of a
  // dead end.
  if (hasExistingAppointment) {
    return (
      <ExistingAppointmentOptions
        salonSlug={salonSlug}
        guestEmail={guestEmail}
        guestPhone={guestPhone}
        salonPhone={salonPhone}
        onManageBooking={() => {
          if (manageToken) {
            router.push(`/${locale}/${salonSlug}/manage/${manageToken}`);
            return;
          }
          router.push(`/${locale}/${salonSlug}/find-booking`);
        }}
        onEditContact={() => {
          setHasExistingAppointment(false);
          setBookingError('You already have a booking under that phone number. Update your contact details below, then confirm again.');
        }}
        onRetryBooking={() => {
          // The server re-verifies on every attempt; if the appointment was
          // cancelled meanwhile, this proceeds and the success path clears the
          // stored contact details.
          setHasExistingAppointment(false);
          setBookingError(null);
          void createBooking();
        }}
      />
    );
  }

  // The Smart Fit price shown is no longer valid: no booking was created and
  // no full-price fallback is selected silently. Going back refreshes
  // availability; selections and contact details are preserved.
  if (smartFitStale) {
    return (
      <SmartFitStaleState
        message={smartFitStale.message}
        breakdown={smartFitStale.breakdown}
        onChooseAnotherTime={() => {
          markSmartFitAvailabilityRefresh(salonSlug);
          router.back();
        }}
      />
    );
  }

  // Another client took the slot: selections stay in the URL and contact
  // details stay in sessionStorage, so going back is lossless.
  if (slotTaken) {
    return (
      <SlotTakenState
        onPickAnotherTime={() => router.back()}
      />
    );
  }

  // Success state
  if (bookingComplete) {
    return (
      <>
        <SuccessContent
          services={services}
          addOns={addOns}
          technician={technician}
          totalPrice={resolvedTotalPrice}
          totalDuration={resolvedTotalDuration}
          dateStr={dateStr}
          timeStr={timeStr}
          pointsEarned={pointsEarned}
          appointmentId={appointmentId}
          onViewRewards={() => router.push(appendSalonSlug(`/${locale}/rewards`, salonSlug, {
            routeSalonSlug,
            locale,
          }))}
          onManagePayment={() => router.push(appendSalonSlug(`/${locale}/payment-methods`, salonSlug, {
            routeSalonSlug,
            locale,
          }))}
          onViewAppointment={handleViewAppointment}
          onOpenDirections={handleOpenDirections}
          onGoToProfile={() => router.push(appendSalonSlug(`/${locale}/profile`, salonSlug, {
            routeSalonSlug,
            locale,
          }))}
          onGoHome={() => router.push(appendSalonSlug('/book', salonSlug, {
            routeSalonSlug,
            locale,
          }))}
          location={location}
          rewardsEnabled={rewardsEnabled}
          smsEnabled={smsEnabled}
          smsConsentGranted={smsConsent}
          showClientAccountActions={isLoggedIn}
          manageUrl={manageUrl}
          canonicalStartTime={canonicalStartTime}
          clientChangeCutoffHours={clientChangeCutoffHours}
          totalPriceDisplay={totalPriceDisplay}
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

  if (services.length === 0 || !dateStr || !timeStr) {
    return (
      <ErrorState
        message="Your booking details are incomplete. Please go back and select your service, date, and time again."
        onGoBack={() => router.back()}
      />
    );
  }

  return (
    <ConfirmContent
      services={services}
      addOns={addOns}
      technician={technician}
      totalPrice={resolvedTotalPrice}
      totalDuration={resolvedTotalDuration}
      dateStr={dateStr}
      timeStr={timeStr}
      pointsEarned={pointsEarned}
      subtotalBeforeDiscount={resolvedSubtotalBeforeDiscount}
      discountAmount={discountAmount}
      firstVisitDiscountPreview={firstVisitDiscountPreview}
      campaignPromotionPreview={campaignPromotionPreview}
      campaignMessage={campaignMessage}
      onConfirm={createBooking}
      onEditSelection={() => router.back()}
      isSubmitting={isBooking}
      location={location}
      rewardsEnabled={rewardsEnabled}
      isReschedule={Boolean(originalAppointmentId)}
      guestName={guestName}
      guestEmail={guestEmail}
      guestPhone={guestPhone}
      smsConsent={smsConsent}
      smsEnabled={smsEnabled}
      bookingError={bookingError}
      onGuestNameChange={setGuestName}
      onGuestEmailChange={setGuestEmail}
      onGuestPhoneChange={setGuestPhone}
      onSmsConsentChange={setSmsConsent}
      smartFitOffer={smartFitOffer}
      totalPriceDisplay={totalPriceDisplay}
      smartFitSuggestion={smartFitSuggestion}
      onAcceptSmartFitSuggestion={handleAcceptSmartFitSuggestion}
      onDismissSmartFitSuggestion={handleDismissSmartFitSuggestion}
      signedInAs={isLoggedIn ? (clientName?.trim() || maskPhone(sessionPhone) || null) : null}
    />
  );
}
