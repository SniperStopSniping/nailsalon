'use client';

import confetti from 'canvas-confetti';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Calendar,
  Check,
  Home,
  Info,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  User,
} from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { TechnicianAvatar } from '@/components/booking/TechnicianAvatar';
import { useHoldCountdown } from '@/components/deposits/HoldCountdown';
import { SectionCard } from '@/components/ui/section-card';
import { StateCard } from '@/components/ui/state-card';
import { useBookingState } from '@/hooks/useBookingState';
import type { BookingStep } from '@/libs/bookingFlow';
import { appendSalonSlug, buildBookingUrl } from '@/libs/bookingParams';
import { computeCheckoutTotals, type ResolvedTaxConfig } from '@/libs/checkoutTotals';
import { buildDepositDisclosure, DEPOSIT_CURRENCY, DEPOSIT_FINGERPRINT_NONE } from '@/libs/depositPolicy';
import { buildGoogleMapsDirectionsUrl, openGoogleMapsDirections } from '@/libs/directions';
import { formatMoney } from '@/libs/formatMoney';
import { triggerHaptic } from '@/libs/haptics';
import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';
import { EMPTY_SALON_CONTENT } from '@/libs/salonContent';
import { resolveSectionDecisionPlan, shouldRenderSection } from '@/libs/sectionRegistry';
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
  /** Booking-time tax configuration used to disclose the invoice estimate. */
  taxConfig?: ResolvedTaxConfig;
  /** Immutable semantic identity of the tax configuration displayed here. */
  taxConfigurationIdentity?: string;
  currency?: string;
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
  /** The system's deposit statement, or null when it is publishing none. */
  depositDisclosure?: { label: string; amountCents: number } | null;
  /** True only while the system is actually collecting — suppresses the owner's chip. */
  depositNoticeSuppressed?: boolean;
  /**
   * MONEY-PATH FIELD, not a display prop. Echoed on EVERY booking POST so the
   * downstream booking PR can tell, before its transaction, whether this client
   * was shown a deposit at all — and refuse to charge an undisclosed amount.
   */
  depositFingerprint?: string;
  /**
   * Overridable for tests.
   *
   * MUST NOT be written as `window.location.href = url`: jsdom does not
   * implement navigation, `failOnConsole` turns the resulting console output
   * into a test failure, and no test in this repository stubs
   * `window.location` — so a bare href assignment makes the required
   * redirect test unwritable.
   */
  navigateToCheckout?: (url: string) => void;
};

type BookingFinancialEstimate = {
  currency: string;
  serviceSubtotalCents: number;
  taxAmountCents: number;
  totalDueCents: number;
  taxLabel: string | null;
  depositDueCents: number;
  remainingAfterDepositCents: number;
};

function defaultNavigateToCheckout(url: string): void {
  window.location.assign(url);
}

const EMPTY_ADD_ONS: AddOnSummary[] = [];
const EMPTY_SELECTED_ADD_ONS: NonNullable<BookConfirmClientProps['selectedAddOns']> = [];
const DEFAULT_BOOKING_CURRENCY = DEPOSIT_CURRENCY.toUpperCase();

/** One nearby Smart Fit alternative, carried from the time step's availability response. */
type SmartFitSuggestion = {
  time: string;
  startTime: string | null;
  timeLabel: string;
  timeDifference: string;
  offer: CustomerSmartFitOffer;
};

type ConfirmationPolicy = {
  enabled: boolean;
  title: string | null;
  text: string | null;
  showBeforeConfirmation: boolean;
  showAfterConfirmation: boolean;
  acknowledgment?: {
    required: boolean;
    text: string | null;
  };
  readonly version?: string | null;
};

type ConfirmationQuickFacts = {
  appointmentOnly: {
    enabled: boolean;
    label: string | null;
  };
  depositNotice: {
    enabled: boolean;
    label: string | null;
  };
  cancellationNotice: {
    enabled: boolean;
    label: string | null;
  };
};

const POLICY_VERSION_PATTERN = /^policy-v1:[a-f0-9]{64}$/u;

function isRequiredBookingPolicy(
  policy: ConfirmationPolicy,
  isReschedule: boolean,
): policy is ConfirmationPolicy & {
  acknowledgment: { required: true; text: string };
  version: string;
} {
  return (
    !isReschedule
    && policy.enabled
    && typeof policy.text === 'string'
    && policy.text.length > 0
    && policy.acknowledgment?.required === true
    && typeof policy.acknowledgment.text === 'string'
    && policy.acknowledgment.text.length > 0
    && typeof policy.version === 'string'
    && POLICY_VERSION_PATTERN.test(policy.version)
  );
}

function readLatestRequiredBookingPolicy(
  value: unknown,
  current: ConfirmationPolicy,
): ConfirmationPolicy | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const acknowledgment = candidate.acknowledgment;
  if (
    candidate.enabled !== true
    || typeof candidate.text !== 'string'
    || candidate.text.length === 0
    || typeof candidate.version !== 'string'
    || !POLICY_VERSION_PATTERN.test(candidate.version)
    || typeof acknowledgment !== 'object'
    || acknowledgment === null
    || Array.isArray(acknowledgment)
  ) {
    return null;
  }

  const acknowledgmentCandidate = acknowledgment as Record<string, unknown>;
  if (
    acknowledgmentCandidate.required !== true
    || typeof acknowledgmentCandidate.text !== 'string'
    || acknowledgmentCandidate.text.length === 0
  ) {
    return null;
  }

  return {
    enabled: true,
    title:
      typeof candidate.title === 'string' || candidate.title === null
        ? candidate.title
        : current.title,
    text: candidate.text,
    showBeforeConfirmation: true,
    showAfterConfirmation:
      typeof candidate.showAfterConfirmation === 'boolean'
        ? candidate.showAfterConfirmation
        : current.showAfterConfirmation,
    acknowledgment: {
      required: true,
      text: acknowledgmentCandidate.text,
    },
    version: candidate.version,
  };
}

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

const POLICY_COLLAPSE_THRESHOLDS = {
  beforeConfirmation: 280,
  afterConfirmation: 160,
} as const;

const truncatePolicyText = (text: string, maxCharacters: number) => {
  const characters = Array.from(text);
  if (characters.length <= maxCharacters) {
    return text;
  }
  return `${characters.slice(0, maxCharacters).join('').trimEnd()}…`;
};

const PolicyCard = ({
  title,
  text,
  placement,
}: {
  title: string;
  text: string;
  placement: 'beforeConfirmation' | 'afterConfirmation';
}) => {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const threshold = POLICY_COLLAPSE_THRESHOLDS[placement];
  const isLong = Array.from(text).length > threshold;
  const displayedText = isLong && !expanded
    ? truncatePolicyText(text, threshold)
    : text;
  const isCompact = placement === 'afterConfirmation';

  return (
    <section
      data-public-surface="confirmationPolicyDisclosure"
      data-testid={isCompact
        ? 'booking-policy-after-confirmation'
        : 'booking-policy-before-confirmation'}
      aria-labelledby={`${contentId}-title`}
      className={`border ${isCompact ? 'rounded-xl px-4 py-3' : 'rounded-2xl p-4'}`}
      style={{
        borderColor: 'color-mix(in srgb, var(--n5-accent) 24%, var(--n5-border-muted))',
        backgroundColor: 'color-mix(in srgb, var(--n5-accent) 7%, var(--n5-bg-card))',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex shrink-0 items-center justify-center rounded-full text-[var(--n5-accent)] ${isCompact ? 'size-8' : 'size-9'}`}
          style={{
            backgroundColor: 'color-mix(in srgb, var(--n5-accent) 12%, white)',
          }}
        >
          <ShieldCheck aria-hidden="true" className={isCompact ? 'size-4' : 'size-[18px]'} />
        </div>
        <div className="min-w-0 flex-1">
          <h3
            id={`${contentId}-title`}
            className={`font-body min-w-0 break-words font-semibold text-[var(--n5-ink-main)] ${isCompact ? 'text-sm' : 'text-[15px]'}`}
          >
            {title}
          </h3>
          <p
            id={contentId}
            className={`font-body mt-1 whitespace-pre-line break-words text-[var(--n5-ink-muted)] ${isCompact ? 'text-xs leading-5' : 'text-sm leading-6'}`}
          >
            {displayedText}
          </p>
          {isLong && (
            <button
              type="button"
              aria-controls={contentId}
              aria-expanded={expanded}
              onClick={() => setExpanded(current => !current)}
              className="font-body mt-2 rounded-sm text-xs font-semibold text-[var(--n5-ink-main)] underline decoration-current underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--n5-ink-main)]"
            >
              {expanded ? 'Show less' : 'View full policy'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

const QuickFactBadges = ({
  quickFacts,
  suppressDepositNotice = false,
}: {
  quickFacts: ConfirmationQuickFacts;
  /**
   * Suppressed ONLY while the system is actually collecting — never when the
   * account is broken, the currency is wrong, or the policy could not be
   * determined. In those states the system publishes nothing, and deleting the
   * owner's own chip would leave the client with no deposit information at all.
   */
  suppressDepositNotice?: boolean;
}) => {
  const effectiveQuickFacts: ConfirmationQuickFacts = suppressDepositNotice
    ? {
        ...quickFacts,
        depositNotice: { ...quickFacts.depositNotice, enabled: false },
      }
    : quickFacts;
  const bookingFactsPlan = resolveSectionDecisionPlan({
    order: [],
    hiddenSections: [],
    content: {
      ...EMPTY_SALON_CONTENT,
      policies: { ...EMPTY_SALON_CONTENT.policies, quickFacts: effectiveQuickFacts },
    },
  });
  const enabledFacts = [
    { key: 'appointmentOnly', ...effectiveQuickFacts.appointmentOnly },
    { key: 'depositNotice', ...effectiveQuickFacts.depositNotice },
    { key: 'cancellationNotice', ...effectiveQuickFacts.cancellationNotice },
  ].filter(
    (fact): fact is { key: string; enabled: true; label: string } =>
      fact.enabled && typeof fact.label === 'string' && fact.label.trim().length > 0,
  ).map(fact => ({ ...fact, label: fact.label.trim() }));

  if (!shouldRenderSection(bookingFactsPlan, 'bookingFacts')) {
    return null;
  }

  return (
    <ul
      data-public-surface="bookingFacts"
      data-testid="booking-quick-facts"
      aria-label="Booking quick facts"
      className="flex flex-wrap gap-2"
    >
      {enabledFacts.map(fact => (
        <li
          key={fact.key}
          className="font-body inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold text-[var(--n5-ink-main)]"
          style={{
            borderColor: 'color-mix(in srgb, var(--n5-accent) 22%, var(--n5-border-muted))',
            backgroundColor: 'color-mix(in srgb, var(--n5-accent) 6%, var(--n5-bg-card))',
          }}
        >
          <Info aria-hidden="true" className="size-3.5 shrink-0 text-[var(--n5-accent)]" />
          <span className="min-w-0 break-words">{fact.label}</span>
        </li>
      ))}
    </ul>
  );
};

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
              Estimated total
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
 * Per-tab record of the checkout THIS browser was handed on its own 201.
 *
 * SECURITY CONTRACT: the DEPOSIT_HOLD_ACTIVE 409 deliberately carries no
 * checkout URL (the API authenticates by phone possession alone), so the ONLY
 * source of a resume link is this tab's own earlier redirect. A different
 * browser or device never receives the URL — it merely sees the countdown from
 * the 409's server-provided expiry. sessionStorage dies with the tab.
 */
const DEPOSIT_RESUME_STORAGE_KEY = 'luster_deposit_resume';

type StoredDepositResume = {
  checkoutUrl: string;
  holdExpiresAt: string | null;
  salonSlug: string;
};

/**
 * sessionStorage is same-origin WRITABLE, so its contents are untrusted input
 * even though only this tab should have written them. A stored value becomes an
 * `href`, and an unvalidated one would make `javascript:`/`data:` a
 * click-to-execute sink and any `https://` host an open redirect for a client
 * mid-payment. Only a Stripe-hosted HTTPS Checkout URL may ever be resumed;
 * anything else is discarded and the client simply sees the countdown with no
 * resume link (the safe degradation).
 */
export function isResumableStripeCheckoutUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return host === 'checkout.stripe.com' || host.endsWith('.checkout.stripe.com');
}

function readStoredDepositResume(): StoredDepositResume | null {
  try {
    const raw = sessionStorage.getItem(DEPOSIT_RESUME_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredDepositResume>;
    return typeof parsed.checkoutUrl === 'string'
      && isResumableStripeCheckoutUrl(parsed.checkoutUrl)
      && typeof parsed.salonSlug === 'string'
      ? {
          checkoutUrl: parsed.checkoutUrl,
          holdExpiresAt: typeof parsed.holdExpiresAt === 'string' ? parsed.holdExpiresAt : null,
          salonSlug: parsed.salonSlug,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * The live-hold banner: server-authoritative countdown, plus "Continue
 * payment" only in the tab that owns the checkout. At zero it flips to the
 * released copy — the actual release stays reaper-owned; this is display.
 */
const DepositHoldNotice = ({
  expiresAt,
  resumeUrl,
}: {
  expiresAt: string | null;
  resumeUrl: string | null;
}) => {
  const { label, expired } = useHoldCountdown(expiresAt);

  if (expired) {
    return (
      <div className="mx-auto mb-4 max-w-md rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700" role="status">
        This booking hold has ended and the time is being released. You are
        welcome to book again below.
      </div>
    );
  }

  return (
    <div className="mx-auto mb-4 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="status">
      <p>
        Your deposit payment is still pending
        {label
          ? (
              <>
                {' — the slot is held for another '}
                <span data-testid="hold-countdown" className="font-semibold tabular-nums">{label}</span>
                .
              </>
            )
          : '.'}
      </p>
      {resumeUrl && (
        <a
          className="mt-3 inline-flex rounded-full bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white"
          href={resumeUrl}
        >
          Continue payment
        </a>
      )}
    </div>
  );
};

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
  policy,
  quickFacts,
  depositDisclosure,
  bookingFinancialEstimate,
  depositNoticeSuppressed,
  policyAcknowledged,
  onPolicyAcknowledgmentChange,
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
  policy: ConfirmationPolicy;
  quickFacts: ConfirmationQuickFacts;
  depositDisclosure: { label: string; amountCents: number } | null;
  bookingFinancialEstimate: BookingFinancialEstimate | null;
  depositNoticeSuppressed: boolean;
  policyAcknowledged: boolean;
  onPolicyAcknowledgmentChange: (value: boolean) => void;
}) => {
  // Focus and announcement management for the one nearby suggestion: both
  // actions unmount the banner (and the focused button with it), so focus
  // moves to the confirm button and a polite live region states the outcome.
  const confirmActionRef = useRef<HTMLButtonElement>(null);
  const acknowledgmentHelpId = useId();
  const [smartFitOutcomeAnnouncement, setSmartFitOutcomeAnnouncement] = useState<string | null>(null);

  const contactBlocker = getContactDetailsBlocker({
    name: guestName,
    email: guestEmail,
    phone: guestPhone,
  });
  const acknowledgmentRequired = isRequiredBookingPolicy(
    policy,
    isReschedule,
  );

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
        data-public-surface="bookingProgressHeader"
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
            description="This will reserve the time above and block duplicate bookings using the same contact details."
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

          <QuickFactBadges
            quickFacts={quickFacts}
            suppressDepositNotice={depositNoticeSuppressed}
          />

          {/*
            The system's own deposit statement, rendered from its OWN element
            rather than through `quickFacts` / `bookingExperience`: that path is
            plan-entitlement-gated and returns null for free-plan salons.
          */}
          {depositDisclosure && (
            <p
              data-public-surface="depositDisclosure"
              data-testid="booking-deposit-disclosure"
              className="font-body rounded-2xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] px-4 py-3 text-sm text-[var(--n5-ink-main)]"
            >
              {depositDisclosure.label}
            </p>
          )}

          {bookingFinancialEstimate && (
            <div
              data-testid="booking-financial-estimate"
              className="font-body space-y-1.5 rounded-2xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] px-4 py-3 text-sm text-[var(--n5-ink-main)]"
            >
              <div className="flex justify-between gap-3">
                <span>Services after discount</span>
                <span>{formatMoney(bookingFinancialEstimate.serviceSubtotalCents, bookingFinancialEstimate.currency)}</span>
              </div>
              {bookingFinancialEstimate.taxLabel && (
                <div className="flex justify-between gap-3">
                  <span>{bookingFinancialEstimate.taxLabel}</span>
                  <span>{formatMoney(bookingFinancialEstimate.taxAmountCents, bookingFinancialEstimate.currency)}</span>
                </div>
              )}
              <div className="flex justify-between gap-3 border-t border-[var(--n5-border-muted)] pt-1.5 font-semibold">
                <span>Estimated appointment total</span>
                <span data-testid="booking-estimated-total">
                  {formatMoney(bookingFinancialEstimate.totalDueCents, bookingFinancialEstimate.currency)}
                </span>
              </div>
              {bookingFinancialEstimate.depositDueCents > 0 && (
                <>
                  <div className="flex justify-between gap-3">
                    <span>Deposit due now</span>
                    <span data-testid="booking-deposit-due">
                      {formatMoney(bookingFinancialEstimate.depositDueCents, bookingFinancialEstimate.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 font-semibold">
                    <span>Estimated balance after deposit</span>
                    <span data-testid="booking-balance-after-deposit">
                      {formatMoney(bookingFinancialEstimate.remainingAfterDepositCents, bookingFinancialEstimate.currency)}
                    </span>
                  </div>
                </>
              )}
              <p className="pt-1 text-xs leading-5 text-[var(--n5-ink-muted)]">
                The deposit is money already paid toward the appointment. Tax is estimated on the full taxable service subtotal before that payment credit.
              </p>
            </div>
          )}

          {policy.enabled
          && (policy.showBeforeConfirmation || acknowledgmentRequired)
          && policy.text && (
            <PolicyCard
              key={policy.version ?? `${policy.title}:${policy.text}`}
              title={policy.title ?? 'Booking policy'}
              text={policy.text}
              placement="beforeConfirmation"
            />
          )}

          {acknowledgmentRequired && (
            <div
              data-testid="booking-policy-acknowledgment"
              className="rounded-2xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] p-4"
            >
              <label className="flex items-start gap-3 text-sm leading-6 text-[var(--n5-ink-main)]">
                <input
                  aria-describedby={
                    policyAcknowledged ? undefined : acknowledgmentHelpId
                  }
                  aria-required="true"
                  required
                  type="checkbox"
                  checked={policyAcknowledged}
                  onChange={event =>
                    onPolicyAcknowledgmentChange(event.target.checked)}
                  className="mt-1 size-4 shrink-0 rounded border-[var(--n5-border)] text-[var(--n5-accent)] focus:ring-[var(--n5-accent)]"
                />
                <span className="min-w-0 whitespace-pre-line break-words">
                  {policy.acknowledgment.text}
                </span>
              </label>
              {!policyAcknowledged && (
                <p
                  id={acknowledgmentHelpId}
                  role="status"
                  className="font-body mt-2 text-xs font-semibold text-[var(--n5-ink-muted)]"
                >
                  Check the box to confirm your appointment.
                </p>
              )}
            </div>
          )}

          <button
            ref={confirmActionRef}
            type="button"
            onClick={() => {
              triggerHaptic('confirm');
              onConfirm();
            }}
            disabled={
              isSubmitting
              || contactBlocker !== null
              || (acknowledgmentRequired && !policyAcknowledged)
            }
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
  onOpenDirections,
  onGoHome,
  location,
  rewardsEnabled,
  smsEnabled,
  smsConsentGranted,
  manageUrl,
  findBookingUrl,
  canonicalStartTime,
  clientChangeCutoffHours,
  totalPriceDisplay,
  confirmationMessage,
  policy,
}: {
  services: ServiceSummary[];
  addOns: AddOnSummary[];
  technician: TechnicianSummary;
  totalPrice: number;
  totalDuration: number;
  dateStr: string;
  timeStr: string;
  pointsEarned: number;
  totalPriceDisplay: string;
  onOpenDirections: () => void;
  onGoHome: () => void;
  location: LocationSummary;
  rewardsEnabled: boolean;
  smsEnabled: boolean;
  smsConsentGranted: boolean;
  manageUrl: string | null;
  findBookingUrl: string;
  canonicalStartTime: string | null;
  clientChangeCutoffHours: number;
  confirmationMessage: string | null;
  policy: ConfirmationPolicy;
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
        data-public-surface="bookingProgressHeader"
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

        {policy.enabled && policy.showAfterConfirmation && policy.text && (
          <PolicyCard
            title="Please remember"
            text={policy.text}
            placement="afterConfirmation"
          />
        )}

        {confirmationMessage && (
          <motion.div
            data-testid="booking-confirmation-message"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="whitespace-pre-line break-words rounded-2xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] px-4 py-3 text-sm leading-relaxed text-[var(--n5-ink-main)]"
          >
            {confirmationMessage}
          </motion.div>
        )}

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-3"
        >
          {manageUrl
            ? (
                <a
                  href={manageUrl}
                  className="font-body flex w-full items-center justify-center gap-2 bg-[var(--n5-accent)] py-4 font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98]"
                  style={{
                    borderRadius: n5.radiusMd,
                    boxShadow: n5.shadowSm,
                  }}
                >
                  <RefreshCw className="size-5" />
                  <span>Manage this appointment</span>
                </a>
              )
            : (
                <div
                  role="status"
                  className="rounded-2xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] p-4 text-sm leading-relaxed text-[var(--n5-ink-muted)]"
                >
                  <p>
                    Your appointment is confirmed, but its private management link is not
                    available on this screen.
                  </p>
                  <a
                    href={findBookingUrl}
                    className="mt-3 inline-flex font-semibold text-[var(--n5-accent)] underline underline-offset-2"
                  >
                    Find my booking to receive a secure management link
                  </a>
                </div>
              )}

          {(googleCalendarUrl || manageUrl) && (
            <div className="grid grid-cols-2 gap-3">
              {googleCalendarUrl && (
                <a href={googleCalendarUrl} target="_blank" rel="noreferrer" className="font-body flex items-center justify-center gap-2 rounded-xl border py-3 text-center text-sm font-semibold text-[var(--n5-ink-main)]" style={{ borderColor: 'var(--n5-border)' }}>
                  <Calendar className="size-4" />
                  Google Calendar
                </a>
              )}
              {manageUrl && (
                <a href={`${manageUrl}/calendar.ics`} className="font-body flex items-center justify-center gap-2 rounded-xl border py-3 text-center text-sm font-semibold text-[var(--n5-ink-main)]" style={{ borderColor: 'var(--n5-border)' }}>
                  <Calendar className="size-4" />
                  Apple Calendar
                </a>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
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
          </div>

          <div className="grid grid-cols-1 gap-3 pt-1">
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
        </motion.div>
      </main>

    </div>
  );
};

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
  taxConfig,
  taxConfigurationIdentity,
  currency = DEFAULT_BOOKING_CURRENCY,
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
  depositDisclosure = null,
  depositNoticeSuppressed = false,
  depositFingerprint = DEPOSIT_FINGERPRINT_NONE,
  navigateToCheckout = defaultNavigateToCheckout,
}: BookConfirmClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { bookingExperience } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;
  const techId = searchParams.get('techId') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const manageToken = searchParams.get('manageToken') || '';
  const campaignToken = searchParams.get('campaign') || '';
  const urlLocationId = searchParams.get('locationId') || '';
  const urlServiceIdsParam = searchParams.get('serviceIds') || '';
  const urlServiceIds = urlServiceIdsParam ? urlServiceIdsParam.split(',').filter(Boolean) : [];
  const upstreamPolicy = bookingExperience.policy as ConfirmationPolicy;
  const upstreamPolicyIdentity = JSON.stringify({
    enabled: upstreamPolicy.enabled,
    title: upstreamPolicy.title,
    text: upstreamPolicy.text,
    showBeforeConfirmation: upstreamPolicy.showBeforeConfirmation,
    showAfterConfirmation: upstreamPolicy.showAfterConfirmation,
    acknowledgment: upstreamPolicy.acknowledgment ?? null,
    version: upstreamPolicy.version ?? null,
  });
  const [displayedPolicy, setDisplayedPolicy]
    = useState<ConfirmationPolicy>(() => upstreamPolicy);
  const [policyAcknowledged, setPolicyAcknowledged] = useState(false);
  const upstreamPolicyIdentityRef = useRef(upstreamPolicyIdentity);
  // Adopted from a 409 DEPOSIT_CHANGED so the next POST carries the amount the
  // client has now actually been shown. Dead until that PR ships the 409.
  const [displayedDeposit, setDisplayedDeposit]
    = useState<BookConfirmClientProps['depositDisclosure']>(() => depositDisclosure);
  const [submittedDepositFingerprint, setSubmittedDepositFingerprint]
    = useState<string>(() => depositFingerprint);

  useEffect(() => {
    if (upstreamPolicyIdentityRef.current === upstreamPolicyIdentity) {
      return;
    }
    upstreamPolicyIdentityRef.current = upstreamPolicyIdentity;
    setDisplayedPolicy(upstreamPolicy);
    setPolicyAcknowledged(false);
  }, [upstreamPolicy, upstreamPolicyIdentity]);

  // Smart Fit (P7.3): server-derived preview values relayed from the time
  // step's availability response. Display hints only — the booking API stays
  // authoritative and rejects a stale expectation with 409 SMART_FIT_CHANGED.
  const smartFitDiscountCentsParam = parseSmartFitCentsParam(searchParams.get('smartFitDiscountCents'));
  const smartFitTotalCentsParam = parseSmartFitCentsParam(searchParams.get('smartFitTotalCents'));
  const smartFitSuggestTimeParam = searchParams.get('smartFitSuggestTime') || '';
  const smartFitSuggestStartTimeParam = searchParams.get('smartFitSuggestStartTime') || '';
  const smartFitSuggestDiscountCentsParam = parseSmartFitCentsParam(searchParams.get('smartFitSuggestDiscountCents'));
  const smartFitSuggestTotalCentsParam = parseSmartFitCentsParam(searchParams.get('smartFitSuggestTotalCents'));

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
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const [hasExistingAppointment, setHasExistingAppointment] = useState(false);
  // Set only by the DEPOSIT_HOLD_ACTIVE branch: the server's authoritative hold
  // expiry, plus a resume URL when (and only when) THIS tab owns the checkout.
  const [depositHold, setDepositHold] = useState<{
    expiresAt: string | null;
    resumeUrl: string | null;
  } | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);

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
  // Separate from the Redis-backed response key: this UUID is persisted with
  // a required policy acknowledgment and bound by the server to the exact
  // canonical booking request.
  const acknowledgmentAttemptIdRef = useRef<string>(crypto.randomUUID());

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
  const resolvedTotalPriceCents = Math.round(resolvedTotalPrice * 100);
  const addOnSubtotalCents = addOns.reduce(
    (sum, addOn) => sum + Math.max(0, Math.round(addOn.price * 100)),
    0,
  );
  const serviceSubtotalCents = Math.max(0, subtotalCents - addOnSubtotalCents);
  const bookingTotals = taxConfig
    ? computeCheckoutTotals({
      items: [
        {
          lineTotalCents: serviceSubtotalCents,
          taxable: taxConfig.taxServicesByDefault,
        },
        {
          lineTotalCents: addOnSubtotalCents,
          taxable: taxConfig.taxAddOnsByDefault,
        },
      ].filter(item => item.lineTotalCents > 0),
      discountCents: Math.max(0, subtotalCents - resolvedTotalPriceCents),
      taxConfig,
      tipCents: 0,
    })
    : null;
  const totalPriceDisplay = bookingTotals
    ? formatMoney(bookingTotals.totalDueCents, currency)
    : smartFitOffer
      ? formatMoney(smartFitOffer.discountedPriceCents, currency)
      : `$${totalPrice}`;
  const depositDueCents = displayedDeposit?.amountCents ?? 0;
  const bookingFinancialEstimate: BookingFinancialEstimate | null = bookingTotals
    ? {
        currency,
        serviceSubtotalCents: bookingTotals.finalPriceCents,
        taxAmountCents: bookingTotals.taxAmountCents,
        totalDueCents: bookingTotals.totalDueCents,
        taxLabel: bookingTotals.taxApplied
          ? `${taxConfig?.name ?? 'Tax'} (${(taxConfig?.rateBps ?? 0) / 100}%)${taxConfig?.pricesIncludeTax ? ' included' : ''}`
          : null,
        depositDueCents,
        remainingAfterDepositCents: Math.max(
          0,
          bookingTotals.totalDueCents
          - Math.min(
            depositDueCents,
            bookingTotals.finalPriceCents + bookingTotals.taxAmountCents,
          ),
        ),
      }
    : null;
  const resolvedTotalDuration = totalDuration;
  const resolvedSubtotalBeforeDiscount = subtotalBeforeDiscount;
  // totalPrice is in dollars, convert to cents for points calculation
  const pointsEarned = computeEarnedPointsFromCents(Math.round(resolvedTotalPrice * 100));
  const acknowledgmentRequired = isRequiredBookingPolicy(
    displayedPolicy,
    Boolean(originalAppointmentId),
  );
  const bookingAttemptMaterialKey = JSON.stringify({
    salonSlug,
    baseServiceId,
    selectedAddOns,
    serviceIds: services.map(service => service.id),
    technicianId: techId === 'any' ? null : techId,
    publicActor: 'guest',
    clientName: guestName.trim(),
    bookingSubject: 'guest',
    clientEmail: guestEmail.trim().toLowerCase(),
    clientPhone: guestPhone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''),
    smsConsent: smsEnabled
      ? { granted: smsConsent, wordingVersion: 'booking-v1' }
      : null,
    canonicalStartTime,
    appointmentDate: dateStr,
    appointmentTime: timeStr,
    locationId: location?.id ?? null,
    originalAppointmentId: originalAppointmentId || null,
    manageToken: manageToken || null,
    campaignToken:
      campaignPromotionPreview && campaignToken ? campaignToken : null,
    smartFit: smartFitOffer
      ? {
          discountAmountCents: smartFitOffer.discountAmountCents,
          discountedPriceCents: smartFitOffer.discountedPriceCents,
        }
      : null,
    bookingPolicyAcknowledgment: acknowledgmentRequired
      ? {
          accepted: policyAcknowledged,
          version: displayedPolicy.version,
        }
      : null,
    bookingFinancialQuote: bookingTotals && taxConfigurationIdentity
      ? {
          currency: currency.toUpperCase(),
          totalDueCents: bookingTotals.totalDueCents,
          taxConfigurationIdentity,
        }
      : null,
  });
  const bookingAttemptMaterialKeyRef = useRef(bookingAttemptMaterialKey);

  useEffect(() => {
    if (bookingAttemptMaterialKeyRef.current === bookingAttemptMaterialKey) {
      return;
    }

    bookingAttemptMaterialKeyRef.current = bookingAttemptMaterialKey;
    acknowledgmentAttemptIdRef.current = crypto.randomUUID();
    idempotencyKeyRef.current = crypto.randomUUID();
  }, [bookingAttemptMaterialKey]);

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
    if (acknowledgmentRequired && !policyAcknowledged) {
      setBookingError('Check the box to confirm your appointment.');
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
        bookingSubject: 'guest' as const,
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
        ...(acknowledgmentRequired && policyAcknowledged && {
          bookingPolicyAcknowledgment: {
            accepted: true as const,
            version: displayedPolicy.version,
            attemptId: acknowledgmentAttemptIdRef.current,
          },
        }),
        // Smart Fit expectations (P7.2 contract): only for a displayed Smart
        // Fit offer, and only these two approved fields. The server rejects a
        // stale expectation with 409 SMART_FIT_CHANGED instead of booking at
        // a different price than shown.
        ...(smartFitOffer && buildSmartFitExpectationFields(smartFitOffer)),
        ...(bookingTotals && taxConfigurationIdentity
          ? {
              expectedBookingFinancialQuote: {
                currency: currency.toUpperCase(),
                totalDueCents: bookingTotals.totalDueCents,
                taxConfigurationIdentity,
              },
            }
          : {}),
        // ALWAYS sent, never conditional. This is a MONEY-PATH field: the
        // downstream booking PR reads it BEFORE its transaction to decide
        // whether a booking on a salon with no chargeable connected account is
        // refused or committed free. Sending it only when a disclosure was
        // rendered would silently route every such booking onto the free leg.
        expectedDepositFingerprint: submittedDepositFingerprint,
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

        const errorCode = typeof errorData?.error === 'string'
          ? errorData.error
          : errorData?.error?.code;
        const errorMessage = typeof errorData?.message === 'string'
          ? errorData.message
          : errorData?.error?.message;

        if (
          errorCode === 'BOOKING_POLICY_CHANGED'
          || errorCode === 'BOOKING_POLICY_ACKNOWLEDGMENT_REQUIRED'
        ) {
          const latestPolicy = readLatestRequiredBookingPolicy(
            errorData.bookingPolicy,
            displayedPolicy,
          );
          if (!latestPolicy) {
            throw new Error(
              errorCode === 'BOOKING_POLICY_CHANGED'
                ? 'The salon updated its booking policy. Refresh the page to review it before confirming.'
                : 'The salon now requires booking-policy acknowledgment. Refresh the page to review it before confirming.',
            );
          }

          setDisplayedPolicy(latestPolicy);
          setPolicyAcknowledged(false);
          acknowledgmentAttemptIdRef.current = crypto.randomUUID();
          idempotencyKeyRef.current = crypto.randomUUID();
          setBookingError(
            errorCode === 'BOOKING_POLICY_CHANGED'
              ? 'The salon updated its booking policy. Please review it and confirm again.'
              : (
                  errorMessage
                  || 'Review and acknowledge the booking policy before confirming.'
                ),
          );
          bookingInitiatedRef.current = false;
          return;
        }

        // `details.deposit` is the ERROR envelope and is the correct container
        // here; on any 2xx the corrected object is `data.deposit`.
        // DELIBERATELY NO AUTO-RESUBMIT: the next POST must require a further
        // user click, and it carries the fingerprint adopted below.
        if (errorCode === 'DEPOSIT_CHANGED') {
          // `details` lives on the ERROR envelope — `error.details.deposit` —
          // exactly as the SMART_FIT_CHANGED branch below reads it. Reading
          // `errorData.details` finds nothing, so the authoritative amount never
          // reaches the client, the disclosure keeps showing the OLD figure, and
          // the resubmit carries the same stale fingerprint: the forever-409
          // loop the magnitude rule exists to prevent. The bare path is kept as
          // a fallback so a flatter envelope would still be honoured.
          const changed = errorData?.error?.details?.deposit ?? errorData?.details?.deposit;
          if (
            changed
            && changed.required === true
            && typeof changed.amountCents === 'number'
            && typeof changed.fingerprint === 'string'
          ) {
            // The RENDERED label has to be rebuilt from the adopted amount.
            // Keeping the previous label would leave the client looking at the
            // old figure while owing the new one — the disclosure is the only
            // place that amount is ever shown, so adopting `amountCents` into
            // state alone corrects nothing the client can see.
            setDisplayedDeposit(
              buildDepositDisclosure({
                required: true,
                amountCents: changed.amountCents,
                currency: DEPOSIT_CURRENCY,
              }) ?? {
                label: changed.label ?? displayedDeposit?.label ?? '',
                amountCents: changed.amountCents,
              },
            );
            setSubmittedDepositFingerprint(changed.fingerprint);
          }
          if (acknowledgmentRequired) {
            setPolicyAcknowledged(false);
            acknowledgmentAttemptIdRef.current = crypto.randomUUID();
          }
          idempotencyKeyRef.current = crypto.randomUUID();
          setBookingError(
            'The deposit required for this booking changed. Please review it and confirm again.',
          );
          bookingInitiatedRef.current = false;
          return;
        }

        if (errorCode === 'ACKNOWLEDGMENT_ATTEMPT_REUSED') {
          setPolicyAcknowledged(false);
          acknowledgmentAttemptIdRef.current = crypto.randomUUID();
          idempotencyKeyRef.current = crypto.randomUUID();
          setBookingError(
            errorMessage
            || 'This booking attempt changed. Please confirm the appointment again.',
          );
          bookingInitiatedRef.current = false;
          return;
        }

        if (errorCode === 'EXISTING_APPOINTMENT') {
          setHasExistingAppointment(true);
          setBookingError(errorMessage || 'You already have an upcoming appointment.');
          bookingInitiatedRef.current = false;
          return;
        }

        // The client's own live deposit hold is what is blocking them. Routed
        // through the SAME presentation as EXISTING_APPOINTMENT — that
        // component needs no new props and already offers every path forward —
        // rather than the generic error banner. The server deliberately sends
        // no checkout URL and no manage URL here: this API authenticates by
        // phone possession alone.
        if (errorCode === 'DEPOSIT_HOLD_ACTIVE') {
          const holdExpiresAt = typeof errorData.error?.details?.holdExpiresAt === 'string'
            ? errorData.error.details.holdExpiresAt
            : null;
          // Resume ONLY from this tab's own stored 201 redirect, and only when
          // the stored record provably describes the SAME hold: same salon and
          // the same server-issued expiry instant. A different browser has no
          // record; a stale record for an older hold fails the identity check.
          const stored = readStoredDepositResume();
          const resumeUrl = stored
            && stored.salonSlug === salonSlug
            && holdExpiresAt !== null
            && stored.holdExpiresAt === holdExpiresAt
            ? stored.checkoutUrl
            : null;
          setDepositHold({ expiresAt: holdExpiresAt, resumeUrl });
          setHasExistingAppointment(true);
          setBookingError(
            errorMessage
            || 'You already have a booking waiting for its deposit. Finish that payment, or wait for the hold to expire.',
          );
          bookingInitiatedRef.current = false;
          return;
        }

        // Without these three, every deposit-path failure falls into the
        // generic throw at the bottom of this block and reads as a mystery.
        if (
          errorCode === 'DEPOSITS_TEMPORARILY_UNAVAILABLE'
          || errorCode === 'DEPOSIT_CHECKOUT_UNAVAILABLE'
          || errorCode === 'DEPOSIT_CHECKOUT_FAILED'
        ) {
          setBookingError(
            errorCode === 'DEPOSIT_CHECKOUT_FAILED'
              ? 'We could not start the deposit payment, so your slot was released. Please try booking again.'
              : 'We could not reach the payment provider just now. Please try confirming again in a moment.',
          );
          bookingInitiatedRef.current = false;
          return;
        }

        if (errorCode === 'TIME_CONFLICT' || errorCode === 'NO_AVAILABLE_TECHNICIAN') {
          setSlotTaken(true);
          bookingInitiatedRef.current = false;
          return;
        }

        if (errorCode === 'SMART_FIT_CHANGED') {
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
            message: typeof errorMessage === 'string' && errorMessage
              ? errorMessage
              : SMART_FIT_STALE_FALLBACK_MESSAGE,
            breakdown,
          });
          bookingInitiatedRef.current = false;
          return;
        }

        throw new Error(errorMessage || `We couldn't confirm this booking (code ${response.status}). Please try again.`);
      }

      const data = await response.json();

      // A deposit hold is NOT a completed booking. Redirect BEFORE
      // setBookingComplete / confetti / clearing the stored contact details:
      // showing a success screen for an unpaid hold would be a lie, and
      // clearing guest storage would cost the client their details if they came
      // back from Checkout unpaid.
      const depositCheckoutUrl = data?.data?.deposit?.required === true
        ? data.data.deposit.checkoutUrl
        : null;
      if (typeof depositCheckoutUrl === 'string' && depositCheckoutUrl) {
        // Remember OUR OWN checkout before leaving, so an abandoned session can
        // be resumed from this tab (and only this tab — see the storage-key
        // contract above) with a live countdown instead of a dead end.
        try {
          sessionStorage.setItem(DEPOSIT_RESUME_STORAGE_KEY, JSON.stringify({
            checkoutUrl: depositCheckoutUrl,
            holdExpiresAt: typeof data.data.deposit.holdExpiresAt === 'string'
              ? data.data.deposit.holdExpiresAt
              : null,
            salonSlug,
          } satisfies StoredDepositResume));
        } catch {
          // Storage unavailable — resume simply won't be offered.
        }
        navigateToCheckout(depositCheckoutUrl);
        return;
      }

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
  }, [acknowledgmentRequired, baseServiceId, bookingTotals, campaignPromotionPreview, campaignToken, canonicalStartTime, currency, dateStr, displayedDeposit?.label, displayedPolicy, guestEmail, guestName, guestPhone, location, manageToken, originalAppointmentId, policyAcknowledged, salonSlug, selectedAddOns, services, navigateToCheckout, smartFitOffer, smsConsent, smsEnabled, submittedDepositFingerprint, taxConfigurationIdentity, techId, timeStr]);

  const handleOpenDirections = useCallback(() => {
    openGoogleMapsDirections(location);
  }, [location]);

  // Loading state
  if (isBooking) {
    return <LoadingState />;
  }

  // Existing appointment error: the server (never browser state) confirmed an
  // active appointment for this phone. Offer every path forward instead of a
  // dead end. When the blocker is a live deposit hold, a countdown (and, in
  // the tab that owns the checkout, a resume link) renders above the options.
  if (hasExistingAppointment) {
    return (
      <div>
        {depositHold && (
          <DepositHoldNotice
            expiresAt={depositHold.expiresAt}
            resumeUrl={depositHold.resumeUrl}
          />
        )}
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
            setDepositHold(null);
            setBookingError(null);
            void createBooking();
          }}
        />
      </div>
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
      <SuccessContent
        services={services}
        addOns={addOns}
        technician={technician}
        totalPrice={resolvedTotalPrice}
        totalDuration={resolvedTotalDuration}
        dateStr={dateStr}
        timeStr={timeStr}
        pointsEarned={pointsEarned}
        onOpenDirections={handleOpenDirections}
        onGoHome={() => router.push(appendSalonSlug('/book', salonSlug, {
          routeSalonSlug,
          locale,
        }))}
        location={location}
        rewardsEnabled={rewardsEnabled}
        smsEnabled={smsEnabled}
        smsConsentGranted={smsConsent}
        manageUrl={manageUrl}
        findBookingUrl={appendSalonSlug('/find-booking', salonSlug, {
          routeSalonSlug,
          locale,
        })}
        canonicalStartTime={canonicalStartTime}
        clientChangeCutoffHours={clientChangeCutoffHours}
        totalPriceDisplay={totalPriceDisplay}
        confirmationMessage={bookingExperience.confirmationMessage}
        policy={displayedPolicy}
      />
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
      policy={displayedPolicy}
      quickFacts={bookingExperience.quickFacts}
      depositDisclosure={displayedDeposit ?? null}
      bookingFinancialEstimate={bookingFinancialEstimate}
      depositNoticeSuppressed={depositNoticeSuppressed}
      policyAcknowledged={policyAcknowledged}
      onPolicyAcknowledgmentChange={setPolicyAcknowledged}
    />
  );
}
