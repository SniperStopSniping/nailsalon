'use client';

import confetti from 'canvas-confetti';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Calendar,
  Check,
  ChevronLeft,
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
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { ConfirmationRebookingCard } from '@/components/booking/ConfirmationRebookingCard';
import { TechnicianAvatar } from '@/components/booking/TechnicianAvatar';
import { BookingStatusCard } from '@/components/customerAssistant/CustomerAssistantLauncher';
import { useHoldCountdown } from '@/components/deposits/HoldCountdown';
import { SectionCard } from '@/components/ui/section-card';
import { StateCard } from '@/components/ui/state-card';
import { useBookingState } from '@/hooks/useBookingState';
import type { BookingStep } from '@/libs/bookingFlow';
import type { BookingBasket } from '@/libs/bookingParams';
import { appendSalonSlug, buildBookingUrl } from '@/libs/bookingParams';
import { computeCheckoutTotals, type ResolvedTaxConfig } from '@/libs/checkoutTotals';
import type { CustomerBookingStatus } from '@/libs/customerAssistant/bookingOperationContracts';
import { canStartAnotherBooking, startAnotherBooking } from '@/libs/customerAssistant/newBooking.client';
import { captureNextBookingGuard } from '@/libs/customerAssistant/nextBookingGuard.client';
import { confirmNormalHandoffBooking, normalBookingErrorMessage, NormalBookingRecoveryError, recoverNormalBooking } from '@/libs/customerAssistant/normalBooking.client';
import { normalBookingPrepareSchema } from '@/libs/customerAssistant/normalBookingContracts';
import { useNormalBookingFlowMarker } from '@/libs/customerAssistant/normalConfirmHandoff.client';
import { customerBookingRecoveryUrl } from '@/libs/customerAssistant/recoveryUrl';
import { buildDepositDisclosure, DEPOSIT_CURRENCY, DEPOSIT_FINGERPRINT_NONE } from '@/libs/depositPolicy';
import { buildGoogleMapsDirectionsUrl, openGoogleMapsDirections } from '@/libs/directions';
import { formatMoney } from '@/libs/formatMoney';
import { triggerHaptic } from '@/libs/haptics';
import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';
import { publicBookingReceiptPresentation } from '@/libs/publicBookingReceipt';
import {
  beginPublicBookingAttempt,
  clearPublicBookingAttempt,
  isPublicBookingReceipt,
  readPublicBookingAttempt,
  recoverPublicBookingAttempt,
  resolvePublicBookingAttempt,
} from '@/libs/publicBookingRecovery.client';
import { DEFAULT_REBOOKING_PROMPT_SETTINGS, type RebookingPromptSettings } from '@/libs/rebookingPromptSettings';
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
import { DEFAULT_BOOKING_TIME_ZONE, zonedTimeToUtc } from '@/libs/timeZone';
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
  serviceId?: string;
  serviceName?: string;
  id: string;
  name: string;
  quantity: number;
  price: number;
  duration: number;
  priceMode?: 'catalog_priced' | 'manual_confirmation';
  priceDisplayText?: string | null;
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

type SmsBookingDefault = 'default_on' | 'default_off' | 'disabled';
type SmsConsentSelection = Exclude<SmsBookingDefault, 'disabled'> | 'explicit_on' | 'explicit_off';
const SMS_CONSENT_WORDING_VERSION = 'booking-sms-reminders-v1';

type BookConfirmClientProps = {
  rebookingSettings?: RebookingPromptSettings;
  catalogAcknowledgment?: { serviceId: string; resolutionFingerprint: string };
  services: ServiceSummary[];
  addOns?: AddOnSummary[];
  baseServiceId?: string | null;
  selectedAddOns?: Array<{
    addOnId: string;
    quantity?: number;
  }>;
  bookingBasket?: BookingBasket | null;
  /** Server-owned quote fingerprint for a reviewed multi-service basket. */
  basketReviewFingerprint?: string | null;
  subtotalBeforeDiscount: number;
  discountAmount: number;
  firstVisitDiscountPreview?: {
    label: string;
    percent: number;
    amountCents: number;
  } | null;
  nextVisitQuoteExpectation?: { totalCents: number; discountType: string | null; discountLabel: string | null } | null;
  campaignPromotionPreview?: {
    stage?: 'promo_6w' | 'promo_8w' | 'next_visit';
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
  /** Validated IANA timezone used for absolute salon-local deadlines. */
  salonTimeZone?: string;
  bookingFlow: BookingStep[];
  location: LocationSummary;
  /** Whether the salon's rewards program is enabled — hides points messaging when false */
  rewardsEnabled?: boolean;
  /** Per-salon default for the public booking reminder control. */
  smsBookingDefault?: SmsBookingDefault;
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
   * True when this salon reviews every booking by hand (the server writes the
   * appointment as a `pending` REQUEST rather than a confirmed booking).
   * Copy-only: it never decides the mode, it just stops the confirm step
   * promising a reservation the salon has not made yet. Defaults to `false`,
   * i.e. the instant-confirm copy that shipped before.
   */
  salonConfirmsManually?: boolean;
  /** Opaque session-storage handoff identity for the AI-to-normal booking flow. */
  salonId?: string;
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
const BOOKING_CONFIRM_FALLBACK_MESSAGE
  = 'We couldn\'t confirm this appointment just now. Please try again.';

type BookingResultStatus = 'confirmed' | 'pending';
type SmsReminderStatus = 'enabled' | 'customer_disabled' | 'opted_out' | 'salon_disabled';

class CustomerSafeBookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerSafeBookingError';
  }
}

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
  children,
}: {
  title: string;
  text: string;
  placement: 'beforeConfirmation' | 'afterConfirmation';
  children?: React.ReactNode;
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
            backgroundColor: 'color-mix(in srgb, var(--n5-accent) 12%, var(--n5-bg-card))',
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
              className="font-body mt-2 inline-flex min-h-11 items-center rounded-sm text-xs font-semibold text-[var(--n5-ink-main)] underline decoration-current underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--n5-ink-main)]"
            >
              {expanded ? 'Show less' : 'View full policy'}
            </button>
          )}
        </div>
      </div>
      {children}
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
    className="booking-detail-row flex items-start gap-3 rounded-2xl border px-4 py-3"
    style={{
      borderColor: 'var(--n5-border-muted)',
      backgroundColor: 'color-mix(in srgb, var(--n5-bg-card) 72%, var(--n5-bg-page))',
    }}
  >
    <div
      className="flex size-10 shrink-0 items-center justify-center"
      style={{
        borderRadius: n5.radiusMd,
        backgroundColor: 'color-mix(in srgb, var(--n5-accent) 12%, var(--n5-bg-card))',
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
  resultStatus = 'review',
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
  resultStatus?: 'review' | BookingResultStatus;
  /** Preformatted total (Smart Fit pricing) — falls back to the legacy `$n` render. */
  totalPriceDisplay?: string;
}) => {
  const serviceNames = [
    ...services.map(s => s.name),
    ...addOns.map((addOn) => {
      const quantity = addOn.quantity > 1 ? ` x${addOn.quantity}` : '';
      const price = addOn.priceMode === 'manual_confirmation'
        ? 'price to be confirmed'
        : addOn.priceDisplayText ?? `$${addOn.price}`;
      return `${addOn.serviceName ? `${addOn.serviceName}: ` : ''}${addOn.name}${quantity} · ${price}`;
    }),
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
    <motion.div className="booking-review-summary relative z-10 w-full">
      <SectionCard
        title="Appointment summary"
        description={resultStatus === 'confirmed'
          ? 'You’re all set — here are your appointment details.'
          : resultStatus === 'pending'
            ? 'Your request was sent — these details are awaiting salon approval.'
            : 'Review the details below before you confirm.'}
        className="border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
        headerClassName="booking-review-summary-header"
        actions={(
          <div className="text-right">
            <p className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--n5-ink-muted)]">
              {addOns.some(addOn => addOn.priceMode === 'manual_confirmation') ? 'Current booking subtotal' : 'Estimated total'}
            </p>
            <p className="font-heading mt-1 text-2xl font-bold text-[var(--n5-accent)]">
              {totalPriceDisplay ?? `$${totalPrice}`}
            </p>
          </div>
        )}
        contentClassName="space-y-3"
      >
        {addOns.some(addOn => addOn.priceMode === 'manual_confirmation') && (
          <p data-testid="booking-manual-price-note" className="rounded-xl bg-[var(--n5-bg-muted)] px-3 py-2 text-xs font-semibold text-[var(--n5-ink-main)]">
            Additional item: price to be confirmed by your nail tech. It is not included in this subtotal.
          </p>
        )}
        <div className="booking-artist-row flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--n5-border-muted)' }}>
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
                    backgroundColor: 'color-mix(in srgb, var(--n5-accent) 12%, var(--n5-bg-card))',
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
              backgroundColor: 'color-mix(in srgb, var(--n5-accent) 10%, var(--n5-bg-card))',
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
  salonTimeZone,
}: {
  expiresAt: string | null;
  resumeUrl: string | null;
  salonTimeZone: string;
}) => {
  const { label, expired, absoluteLabel, dateTime } = useHoldCountdown(expiresAt, {
    timeZone: salonTimeZone,
  });

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
      {absoluteLabel && dateTime && (
        <p className="mt-1">
          {'The hold ends at '}
          <time data-testid="hold-deadline" dateTime={dateTime}>{absoluteLabel}</time>
          {' (salon local time).'}
        </p>
      )}
      {resumeUrl && (
        <a
          className="mt-3 inline-flex min-h-11 items-center rounded-full bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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

const BookingRecoveryNotice = ({
  onCheckAgain,
  isChecking,
  findBookingUrl,
  salonPhone,
}: {
  onCheckAgain: () => void;
  isChecking: boolean;
  findBookingUrl: string;
  salonPhone: string | null;
}) => (
  <div className="mx-auto max-w-lg px-5 pt-3" role="status" data-testid="booking-recovery-notice">
    <StateCard
      tone="warning"
      icon={<RefreshCw className="mx-auto size-8 text-[var(--n5-warning)]" />}
      title="We’re checking your booking"
      description="We’re checking whether your appointment was created. We won’t submit another booking until this check is complete."
      contentClassName="py-5"
    />
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button
        type="button"
        onClick={onCheckAgain}
        disabled={isChecking}
        className="min-h-11 flex-1 rounded-xl border border-[var(--n5-border)] px-3 py-2 text-sm font-semibold disabled:opacity-60"
      >
        {isChecking ? 'Checking…' : 'Check again'}
      </button>
      <a className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-[var(--n5-border)] px-3 py-2 text-sm font-semibold" href={findBookingUrl}>
        Find my booking
      </a>
    </div>
    <p className="mt-3 text-center text-sm leading-relaxed text-[var(--n5-ink-muted)]">
      Still unable to recover your booking?
      {' '}
      {salonPhone
        ? <a className="underline" href={`tel:${salonPhone.replace(/[^+\d]/g, '')}`}>Contact the salon</a>
        : 'Contact the salon for help before booking again.'}
    </p>
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
  previousTotalCents,
  currency,
  onChooseAnotherTime,
}: {
  message: string;
  breakdown: SmartFitStaleBreakdown | null;
  previousTotalCents: number | null;
  currency: string;
  onChooseAnotherTime: () => void;
}) => {
  // Keyboard users arrive here from the now-unmounted Confirm button; land
  // them on the one action instead of stranding focus at the document root.
  const actionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    actionRef.current?.focus();
  }, []);

  const replacedByBetterDiscount = smartFitReplacedByHigherPriorityDiscount(breakdown);
  const priceChanged = previousTotalCents !== null
    && breakdown !== null
    && breakdown.finalTotalCents !== previousTotalCents;

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
                {priceChanged && breakdown && previousTotalCents !== null && (
                  <div className="mt-3">
                    <p>
                      {replacedByBetterDiscount
                        ? 'A different offer now applies to this time.'
                        : 'The service price for this time changed.'}
                    </p>
                    <dl
                      data-testid="smart-fit-price-change"
                      className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-red-200 bg-white/70 p-3 text-left"
                    >
                      <div>
                        <dt className="text-xs font-medium text-[var(--n5-ink-muted)]">Previously shown</dt>
                        <dd className="font-semibold text-[var(--n5-ink-main)]">
                          {formatMoney(previousTotalCents, currency)}
                        </dd>
                      </div>
                      <span aria-hidden="true" className="text-[var(--n5-ink-muted)]">→</span>
                      <div>
                        <dt className="text-xs font-medium text-[var(--n5-ink-muted)]">Current service price</dt>
                        <dd className="font-semibold text-[var(--n5-ink-main)]">
                          {formatMoney(breakdown.finalTotalCents, currency)}
                          {breakdown.discountLabel ? ` (${breakdown.discountLabel})` : ''}
                        </dd>
                      </div>
                    </dl>
                  </div>
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
  isRecoveringBooking,
  recoveryUnresolved = false,
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
  smsBookingDefault,
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
  salonConfirmsManually,
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
  isRecoveringBooking: boolean;
  recoveryUnresolved?: boolean;
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
  smsBookingDefault: SmsBookingDefault;
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
  /**
   * True when this salon reviews bookings by hand, so tapping the button
   * creates a REQUEST (`pending`) rather than a held booking. Drives the copy
   * only — the mode itself is decided server-side when the appointment row is
   * written.
   */
  salonConfirmsManually: boolean;
}) => {
  const t = useTranslations('BookingConfirmation');
  const { salonName } = useSalon();
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en';
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

  // What this button ACTUALLY does. A manual-confirmation salon stores a
  // `pending` request the owner still has to accept — nothing is held, and
  // promising "reserve this time" here is the promise the product then breaks.
  // A deposit is a payment requirement, not approval of the request.
  const estimatedDepositDueCents = bookingFinancialEstimate?.depositDueCents
    ?? depositDisclosure?.amountCents
    ?? 0;
  const createsRequest = salonConfirmsManually && !isReschedule;

  // Explain only what is on screen. A booking with no deposit and no tax line
  // was being told how deposit credit interacts with a taxable subtotal, which
  // reads as a charge the customer cannot see and contradicts the salon's own
  // "No deposit required" quick fact right above it.
  const showsDepositLine = (bookingFinancialEstimate?.depositDueCents ?? 0) > 0;
  const showsTaxLine = Boolean(bookingFinancialEstimate?.taxLabel);
  const estimateExplainer = [
    showsDepositLine ? 'The deposit is money already paid toward the appointment.' : null,
    showsTaxLine
      ? (showsDepositLine
          ? 'Tax is estimated on the full taxable service subtotal before that payment credit.'
          : 'Tax is estimated on the full taxable service subtotal.')
      : null,
  ].filter(Boolean).join(' ');

  return (
    <div className="booking-confirm-page min-h-screen bg-[var(--n5-bg-page)]" style={{ fontFamily: n5.fontBody }}>
      <nav
        data-public-surface="bookingProgressHeader"
        className="sticky top-0 z-40 flex items-center justify-between border-b px-5 py-0 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--n5-bg-page) 80%, transparent)',
          borderColor: 'var(--n5-border-muted)',
        }}
      >
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            triggerHaptic('select');
            onEditSelection();
          }}
          className="font-body inline-flex min-h-11 min-w-11 items-center text-sm font-medium text-[var(--n5-ink-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ChevronLeft aria-hidden="true" className="mr-1 size-4" />
          Back
        </button>
        <span className="font-heading text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]">
          Confirm
        </span>
        <div className="w-11" />
      </nav>

      <main aria-busy={isSubmitting} className="mx-auto max-w-lg space-y-5 px-5 pb-10 pt-3">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h1 className="font-heading mb-2 text-2xl font-bold text-[var(--n5-ink-main)]">
            Review your appointment
          </h1>
          <p className="font-body mx-auto max-w-sm text-sm leading-relaxed text-[var(--n5-ink-muted)]">
            {recoveryUnresolved
              ? 'Your booking result is still being checked. Please use the recovery options above.'
              : isReschedule
                ? 'Your current appointment stays booked until you confirm this new time.'
                : createsRequest
                  ? estimatedDepositDueCents > 0
                    ? 'Pay the required deposit to send your request. The salon will review it before the appointment is confirmed.'
                    : 'Nothing is booked yet. Send your request below for the salon to review.'
                  : 'Not booked yet. Confirm below to reserve your time.'}
          </p>
        </motion.div>

        {isSubmitting && !recoveryUnresolved && (
          <div
            data-testid="booking-submit-pending"
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] px-4 py-3 text-sm leading-6 text-[var(--n5-ink-main)]"
          >
            {createsRequest
              ? 'Sending your request. Your booking details remain below while we finish.'
              : 'Confirming your appointment. Your booking details remain below while we finish.'}
          </div>
        )}

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
                  disabled={isSubmitting}
                  onClick={() => {
                    triggerHaptic('confirm');
                    handleAcceptSuggestion();
                  }}
                  className="font-body min-h-11 rounded-xl bg-[var(--n5-accent)] px-4 py-2.5 text-sm font-bold text-[var(--n5-ink-inverse)] transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:transform-none"
                >
                  Choose this time
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    triggerHaptic('select');
                    handleDismissSuggestion();
                  }}
                  className="font-body min-h-11 rounded-xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-900 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:transform-none"
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
            description={t('contact_description')}
            className="border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
            contentClassName="space-y-3 pt-0"
          >
            <label className="block text-xs font-semibold text-[var(--n5-ink-muted)]">
              <span className="flex items-baseline justify-between gap-2">
                Name
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--n5-ink-muted)]">Required</span>
              </span>
              <input aria-label="Customer name" required aria-required="true" autoComplete="name" disabled={isSubmitting} value={guestName} onChange={event => onGuestNameChange(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--n5-border)] bg-[var(--n5-bg-page)] p-3 text-sm text-[var(--n5-ink-main)] outline-none focus:border-[var(--n5-accent)] disabled:cursor-not-allowed disabled:opacity-60" />
            </label>
            <label className="block text-xs font-semibold text-[var(--n5-ink-muted)]">
              <span className="flex items-baseline justify-between gap-2">
                Email
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--n5-ink-muted)]">Required</span>
              </span>
              <input aria-label="Customer email" required aria-required="true" type="email" autoComplete="email" disabled={isSubmitting} value={guestEmail} onChange={event => onGuestEmailChange(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--n5-border)] bg-[var(--n5-bg-page)] p-3 text-sm text-[var(--n5-ink-main)] outline-none focus:border-[var(--n5-accent)] disabled:cursor-not-allowed disabled:opacity-60" />
            </label>
            <label className="block text-xs font-semibold text-[var(--n5-ink-muted)]">
              <span className="flex items-baseline justify-between gap-2">
                Mobile phone
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--n5-ink-muted)]">Required</span>
              </span>
              <input aria-label="Customer phone" required aria-required="true" type="tel" inputMode="tel" autoComplete="tel" disabled={isSubmitting} value={guestPhone} onChange={event => onGuestPhoneChange(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--n5-border)] bg-[var(--n5-bg-page)] p-3 text-sm text-[var(--n5-ink-main)] outline-none focus:border-[var(--n5-accent)] disabled:cursor-not-allowed disabled:opacity-60" />
            </label>
            {smsBookingDefault !== 'disabled' && (
              <div className="space-y-1 text-xs leading-4 text-[var(--n5-ink-muted)]">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[var(--n5-ink-main)]">
                  <input aria-label="Text reminders" aria-describedby="booking-sms-details" type="checkbox" disabled={isSubmitting} checked={smsConsent} onChange={event => onSmsConsentChange(event.target.checked)} className="size-4 shrink-0 accent-[var(--n5-accent)] disabled:cursor-not-allowed" />
                  <span>{t('sms_label')}</span>
                </label>
                <p id="booking-sms-details">{t('sms_details', { salon: salonName })}</p>
                <div className="flex gap-3">
                  <a href={`/${locale}/terms`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-2">{t('terms')}</a>
                  <a href={`/${locale}/privacy`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-2">{t('privacy')}</a>
                </div>
              </div>
            )}
          </SectionCard>

          {createsRequest && <p className="text-sm text-[var(--n5-ink-muted)]">{t('request_notice')}</p>}

          {((discountAmount > 0 && (campaignPromotionPreview || firstVisitDiscountPreview)) || smartFitOffer) && (
            <SectionCard
              title={t('offers_title')}
              className="border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
              contentClassName="grid gap-2 pt-0 sm:grid-cols-2"
            >
              {campaignPromotionPreview && discountAmount > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm sm:col-span-2">
                  <span className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                    {campaignPromotionPreview.stage === 'next_visit' ? 'Next Visit Offer' : 'Welcome-back offer'}
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
            </SectionCard>
          )}

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
              {isSubmitting ? 'Your details are saved while we check the original booking.' : 'Your details below are saved — you can try again.'}
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
                <span>{discountAmount > 0 ? 'Services after discount' : 'Services'}</span>
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
              {estimateExplainer && (
                <p className="pt-1 text-xs leading-5 text-[var(--n5-ink-muted)]">
                  {estimateExplainer}
                </p>
              )}
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
            >
              {acknowledgmentRequired && (
                <div
                  data-testid="booking-policy-acknowledgment"
                  className="mt-3 border-t border-[var(--n5-border-muted)] pt-3"
                >
                  <label className="flex items-start gap-3 text-sm leading-6 text-[var(--n5-ink-main)]">
                    <input
                      aria-describedby={
                        policyAcknowledged ? undefined : acknowledgmentHelpId
                      }
                      aria-required="true"
                      required
                      type="checkbox"
                      disabled={isSubmitting}
                      checked={policyAcknowledged}
                      onChange={event =>
                        onPolicyAcknowledgmentChange(event.target.checked)}
                      className="mt-1 size-4 shrink-0 rounded border-[var(--n5-border)] text-[var(--n5-accent)] focus:ring-[var(--n5-accent)]"
                    />
                    <span className="min-w-0 whitespace-pre-line break-words">
                      {policy.acknowledgment.text}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--n5-ink-muted)]">
                      Required
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
            </PolicyCard>
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
              || isRecoveringBooking
              || contactBlocker !== null
              || (acknowledgmentRequired && !policyAcknowledged)
            }
            className="font-body flex min-h-11 w-full items-center justify-center gap-2 bg-[var(--n5-accent)] px-3 py-2.5 text-sm font-semibold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderRadius: n5.radiusMd,
              boxShadow: n5.shadowSm,
            }}
          >
            {isSubmitting
              ? (
                  <>
                    <RefreshCw className={`size-5 ${recoveryUnresolved ? '' : 'animate-spin'}`} />
                    <span>{recoveryUnresolved ? 'Waiting for booking result' : createsRequest ? 'Sending request...' : 'Confirming your appointment…'}</span>
                  </>
                )
              : (
                  <>
                    <Check className="size-5" />
                    <span>
                      {createsRequest
                        ? `Request this time · ${totalPriceDisplay}`
                        : `Confirm appointment · ${totalPriceDisplay}`}
                    </span>
                  </>
                )}
          </button>

          {isRecoveringBooking && (
            <p role="status" className="text-center text-xs text-[var(--n5-ink-muted)]">
              {t('recovering_booking')}
            </p>
          )}

          {!isSubmitting && contactBlocker && (
            <p data-testid="contact-blocker-hint" role="status" className="text-center text-xs text-[var(--n5-ink-muted)]">
              {contactBlocker}
            </p>
          )}

          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              triggerHaptic('select');
              onEditSelection();
            }}
            className="font-body flex min-h-11 w-full items-center justify-center gap-2 border px-3 py-2.5 text-sm font-semibold text-[var(--n5-accent)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
  bookingStatus,
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
  smsConsentGranted,
  smsReminderStatus,
  manageUrl,
  findBookingUrl,
  canonicalStartTime,
  clientChangeCutoffHours,
  totalPriceDisplay,
  confirmationMessage,
  policy,
  onManage,
  onStartAnother,
  rebookingSettings,
  onBookNext,
  recoveryError,
}: {
  bookingStatus: BookingResultStatus;
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
  smsConsentGranted: boolean;
  smsReminderStatus: SmsReminderStatus | null;
  manageUrl: string | null;
  findBookingUrl: string;
  canonicalStartTime: string | null;
  clientChangeCutoffHours: number;
  confirmationMessage: string | null;
  policy: ConfirmationPolicy;
  onManage?: () => void;
  onStartAnother?: () => void;
  rebookingSettings?: RebookingPromptSettings;
  onBookNext?: () => Promise<void>;
  recoveryError?: string | null;
}) => {
  const t = useTranslations('BookingConfirmation');
  const isPending = bookingStatus === 'pending';
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
      {recoveryError && <p role="alert" className="p-4">{recoveryError}</p>}
      {/* Navbar */}
      <nav
        data-public-surface="bookingProgressHeader"
        className="sticky top-0 z-40 flex items-center justify-between border-b px-5 py-3 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--n5-bg-page) 80%, transparent)',
          borderColor: 'var(--n5-border-muted)',
        }}
      >
        <div className="w-10" />
        <span className="font-heading text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]">
          {isPending ? 'Request received' : 'Confirmed'}
        </span>
        <div className="w-10" />
      </nav>

      {/* Main Content */}
      <main className="mx-auto max-w-lg space-y-5 px-5 pb-10 pt-6">
        <div data-testid="booking-result-receipt" className="space-y-5">
          <motion.header
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
            role="status"
          >
            <h1 className="font-heading mb-1 text-2xl font-bold text-[var(--n5-ink-main)]">
              {isPending ? 'Request received' : 'Appointment confirmed'}
            </h1>
            <p className="font-body text-sm text-[var(--n5-ink-muted)]">
              {isPending
                ? 'The salon will review your request before the appointment is confirmed.'
                : 'Your time is reserved.'}
            </p>
          </motion.header>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
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
              resultStatus={bookingStatus}
              totalPriceDisplay={totalPriceDisplay}
            />
          </motion.div>
        </div>

        {!isPending && rebookingSettings?.enabled && onBookNext && (
          <ConfirmationRebookingCard settings={rebookingSettings} onBook={onBookNext} />
        )}

        {!isPending && (
          <motion.div
            data-testid="booking-success-celebration"
            aria-hidden="true"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
            className="text-center"
          >
            <div
              className="mx-auto flex size-12 items-center justify-center bg-[var(--n5-success)]"
              style={{ borderRadius: n5.radiusPill }}
            >
              <Check className="size-6 text-white" strokeWidth={3} />
            </div>
          </motion.div>
        )}

        {!isPending && policy.enabled && policy.showAfterConfirmation && policy.text && (
          <PolicyCard
            title="Please remember"
            text={policy.text}
            placement="afterConfirmation"
          />
        )}

        {!isPending && confirmationMessage && (
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
                  className="font-body flex min-h-11 w-full items-center justify-center gap-2 bg-[var(--n5-accent)] px-3 py-2.5 text-sm font-semibold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98]"
                  style={{
                    borderRadius: n5.radiusMd,
                    boxShadow: n5.shadowSm,
                  }}
                >
                  <RefreshCw className="size-5" />
                  <span>{isPending ? 'Manage this request' : 'Manage this appointment'}</span>
                </a>
              )
            : onManage
              ? (
                  <button type="button" onClick={onManage} className="font-body flex min-h-11 w-full items-center justify-center gap-2 bg-[var(--n5-accent)] px-3 py-2.5 text-sm font-semibold text-[var(--n5-ink-inverse)]" style={{ borderRadius: n5.radiusMd }}>
                    <RefreshCw className="size-5" />
                    <span>{isPending ? 'Manage this request' : 'Manage this appointment'}</span>
                  </button>
                )
              : (
                  <div
                    role="status"
                    className="rounded-2xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] p-4 text-sm leading-relaxed text-[var(--n5-ink-muted)]"
                  >
                    <p>
                      {isPending
                        ? 'Your request was received, but its private management link is not available on this screen.'
                        : 'Your appointment is confirmed, but its private management link is not available on this screen.'}
                    </p>
                    <a
                      href={findBookingUrl}
                      className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--n5-accent)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Find my booking to receive a secure management link
                    </a>
                  </div>
                )}

          {!isPending && (googleCalendarUrl || manageUrl) && (
            <div className="grid grid-cols-2 gap-2">
              {googleCalendarUrl && (
                <a href={googleCalendarUrl} target="_blank" rel="noreferrer" className="font-body flex min-h-11 items-center justify-center gap-1.5 rounded-xl border p-2 text-center text-xs font-semibold text-[var(--n5-ink-main)]" style={{ borderColor: 'var(--n5-border)' }}>
                  <Calendar className="size-4" />
                  Google Calendar
                </a>
              )}
              {manageUrl && (
                <a href={`${manageUrl}/calendar.ics`} className="font-body flex min-h-11 items-center justify-center gap-1.5 rounded-xl border p-2 text-center text-xs font-semibold text-[var(--n5-ink-main)]" style={{ borderColor: 'var(--n5-border)' }}>
                  <Calendar className="size-4" />
                  Apple Calendar
                </a>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
            {directionsUrl && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('select');
                  onOpenDirections();
                }}
                className="font-body inline-flex min-h-11 items-center justify-center gap-1.5 p-2 text-xs font-semibold text-[var(--n5-ink-main)] transition-all active:scale-[0.98]"
                style={{
                  borderRadius: n5.radiusMd,
                  borderColor: 'var(--n5-border)',
                }}
              >
                <MapPin className="size-4 text-[var(--n5-accent)]" />
                <span>Directions</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('select');
                onGoHome();
              }}
              className="font-body inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl p-2 text-xs font-semibold text-[var(--n5-ink-main)] transition-all active:scale-[0.98]"
              style={{ borderColor: 'var(--n5-border)' }}
            >
              <Home className="size-4" />
              <span>Back to booking</span>
            </button>
            {onStartAnother && (
              <button type="button" onClick={onStartAnother} className="font-body inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl p-2 text-xs font-semibold text-[var(--n5-ink-main)] transition-all active:scale-[0.98]">
                <span>Start another booking</span>
              </button>
            )}
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="pt-1 text-center"
        >
          <div className="mb-2 flex items-center justify-center gap-2">
            {!isPending && <Sparkles className="size-4 text-[var(--n5-accent)]" />}
            <span className="font-body text-sm text-[var(--n5-ink-muted)]">
              {isPending ? 'The salon will review your request.' : 'We’re looking forward to your visit.'}
            </span>
            {!isPending && <Sparkles className="size-4 text-[var(--n5-accent)]" />}
          </div>
          <>
            {smsReminderStatus === 'enabled' && smsConsentGranted && (
              <p className="font-body text-xs text-[var(--n5-ink-muted)]">
                {t('sms_saved')}
              </p>
            )}
            {smsReminderStatus === 'customer_disabled' && (
              <p className="font-body text-xs text-[var(--n5-ink-muted)]">
                {t('sms_off')}
              </p>
            )}
            {smsReminderStatus === 'opted_out' && (
              <p className="font-body text-xs text-[var(--n5-ink-muted)]">
                {t('sms_opted_out')}
              </p>
            )}
          </>
          {!isPending && (
            <p className="font-body mt-0.5 text-xs text-[var(--n5-ink-muted)]">
              You can change or cancel up to
              {' '}
              {clientChangeCutoffHours}
              {' '}
              hours before
            </p>
          )}
        </motion.div>
      </main>

    </div>
  );
};

// --- Main Component ---

export function BookConfirmClient({
  rebookingSettings = DEFAULT_REBOOKING_PROMPT_SETTINGS,
  catalogAcknowledgment,
  services,
  addOns = EMPTY_ADD_ONS,
  baseServiceId = null,
  selectedAddOns = EMPTY_SELECTED_ADD_ONS,
  bookingBasket = null,
  basketReviewFingerprint = null,
  subtotalBeforeDiscount,
  discountAmount = 0,
  firstVisitDiscountPreview = null,
  campaignPromotionPreview = null,
  nextVisitQuoteExpectation = null,
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
  salonTimeZone = DEFAULT_BOOKING_TIME_ZONE,
  // bookingFlow is passed for consistency but not used in confirm step
  bookingFlow: _bookingFlow,
  location,
  rewardsEnabled = true,
  smsBookingDefault = 'default_on',
  clientChangeCutoffHours = 24,
  salonPhone = null,
  depositDisclosure = null,
  depositNoticeSuppressed = false,
  depositFingerprint = DEPOSIT_FINGERPRINT_NONE,
  salonConfirmsManually = false,
  salonId,
  navigateToCheckout = defaultNavigateToCheckout,
}: BookConfirmClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { bookingExperience, salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;
  const techId = searchParams.get('techId') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const manageToken = searchParams.get('manageToken') || '';
  const campaignToken = searchParams.get('campaign') || '';
  const bookingFlowMarker = useNormalBookingFlowMarker(salonId, searchParams.get('bookingFlow'));
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
  const [displayedConfirmationMode, setDisplayedConfirmationMode] = useState<'instant' | 'request_approval'>(() => salonConfirmsManually ? 'request_approval' : 'instant');
  const upstreamConfirmationModeRef = useRef(salonConfirmsManually);
  useEffect(() => {
    if (upstreamConfirmationModeRef.current !== salonConfirmsManually) {
      upstreamConfirmationModeRef.current = salonConfirmsManually;
      setDisplayedConfirmationMode(salonConfirmsManually ? 'request_approval' : 'instant');
    }
  }, [salonConfirmsManually]);
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
  const { syncFromUrl, clearBookingState } = useBookingState(salonSlug);
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

  const isAssistantHandoff = bookingFlowMarker === 'assistant';
  const [durableStatus, setDurableStatus] = useState<CustomerBookingStatus | null>(null);
  const [recoveringHandoff, setRecoveringHandoff] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  const [receiptConfirmed, setReceiptConfirmed] = useState(false);
  const [recoveredReceipt, setRecoveredReceipt] = useState<any>(null);
  const [bookingResultStatus, setBookingResultStatus]
    = useState<BookingResultStatus>('confirmed');
  const [smsReminderStatus, setSmsReminderStatus] = useState<SmsReminderStatus | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [slotTaken, setSlotTaken] = useState(false);
  const [publicRecoveryPending, setPublicRecoveryPending] = useState(false);
  const [checkingPublicRecovery, setCheckingPublicRecovery] = useState(false);
  useEffect(() => {
    if (!isAssistantHandoff) {
      return;
    }
    if (!salonId) {
      setBookingError(normalBookingErrorMessage('handoff_missing'));
      return;
    }
    let active = true;
    setRecoveringHandoff(true);
    void recoverNormalBooking(salonId).then((status) => {
      if (active && status && status.status !== 'not_created') {
        setDurableStatus(status);
      }
    }).catch(() => {
      if (active) {
        setBookingError(normalBookingErrorMessage('recovery_unavailable'));
      }
    }).finally(() => {
      if (active) {
        setRecoveringHandoff(false);
      }
    });
    return () => {
      active = false;
    };
  }, [isAssistantHandoff, salonId]);

  const [smartFitStale, setSmartFitStale] = useState<{
    message: string;
    breakdown: SmartFitStaleBreakdown | null;
    previousTotalCents: number | null;
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
  // The default describes the salon's pre-selected choice, not a customer
  // action. Keep its provenance separate so a checked, untouched control is
  // never recorded as an explicit opt-in.
  const [smsConsent, setSmsConsent] = useState(() => smsBookingDefault === 'default_on');
  const [smsConsentSelection, setSmsConsentSelection] = useState<SmsConsentSelection>(() => (
    smsBookingDefault === 'default_off' ? 'default_off' : 'default_on'
  ));

  const handleSmsConsentChange = useCallback((granted: boolean) => {
    setSmsConsent(granted);
    setSmsConsentSelection(granted ? 'explicit_on' : 'explicit_off');
  }, []);

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

  const completeManualBooking = useCallback((data: any, fromRecovery = false) => {
    if (fromRecovery) {
      setRecoveredReceipt(data);
    }
    const recoveredStatus = data?.data?.appointment?.status;
    setReceiptConfirmed(recoveredStatus === 'confirmed');
    if (fromRecovery && recoveredStatus === 'awaiting_payment' && !data?.data?.deposit?.checkoutUrl) {
      setDepositHold({ expiresAt: null, resumeUrl: null });
      setHasExistingAppointment(true);
      setPublicRecoveryPending(false);
      return;
    }
    if (fromRecovery && !['confirmed', 'pending', 'awaiting_payment'].includes(recoveredStatus)) {
      // A durable link proves creation, but current terminal states must never
      // be presented as a new confirmation or silently retried.
      setPublicRecoveryPending(false);
      return;
    }
    // A deposit hold is NOT a completed booking. This callback is also used for
    // a recovered 201 receipt, so recovery preserves the original checkout
    // handoff exactly rather than turning an unpaid hold into a success state.
    const depositCheckoutUrl = data?.data?.deposit?.required === true
      ? data.data.deposit.checkoutUrl
      : null;
    if (typeof depositCheckoutUrl === 'string' && depositCheckoutUrl) {
      const holdExpiresAt = typeof data.data.deposit.holdExpiresAt === 'string'
        ? data.data.deposit.holdExpiresAt
        : null;
      // A recovered receipt proves the original 201, not that an old Checkout
      // session is still payable. Never send a returning customer to a known
      // expired hold; the existing recovery options provide current lookup.
      if (fromRecovery && (!holdExpiresAt || !Number.isFinite(Date.parse(holdExpiresAt))
        || Date.parse(holdExpiresAt) <= Date.now()
        || !customerBookingRecoveryUrl(depositCheckoutUrl, 'resume'))) {
        setDepositHold({ expiresAt: holdExpiresAt, resumeUrl: null });
        setHasExistingAppointment(true);
        setPublicRecoveryPending(false);
        return;
      }
      try {
        sessionStorage.setItem(DEPOSIT_RESUME_STORAGE_KEY, JSON.stringify({
          checkoutUrl: depositCheckoutUrl,
          holdExpiresAt,
          salonSlug,
        } satisfies StoredDepositResume));
      } catch {
        // Storage unavailable — resume simply won't be offered.
      }
      navigateToCheckout(depositCheckoutUrl);
      return;
    }

    const resultStatus: BookingResultStatus
      = data?.data?.appointment?.status === 'pending' ? 'pending' : 'confirmed';
    const returnedSmsReminderStatus = data?.data?.smsReminderStatus;
    setSmsReminderStatus(
      returnedSmsReminderStatus === 'enabled'
      || returnedSmsReminderStatus === 'customer_disabled'
      || returnedSmsReminderStatus === 'opted_out'
      || returnedSmsReminderStatus === 'salon_disabled'
        ? returnedSmsReminderStatus
        : null,
    );
    const receiptManageUrl = typeof data?.data?.manageUrl === 'string' ? data.data.manageUrl : null;
    setManageUrl(fromRecovery && receiptManageUrl ? customerBookingRecoveryUrl(receiptManageUrl, 'manage') : receiptManageUrl);
    setBookingResultStatus(resultStatus);
    setBookingComplete(true);
    setPublicRecoveryPending(false);
    try {
      sessionStorage.removeItem(GUEST_CONTACT_STORAGE_KEY);
    } catch {
      // Storage unavailable — nothing to clear.
    }

    if (resultStatus === 'confirmed') {
      setTimeout(() => {
        triggerHaptic('success');
        triggerLuxuryConfetti();
      }, 300);
    }
  }, [navigateToCheckout, salonSlug]);

  const checkPublicRecovery = useCallback(async () => {
    if (!salonId) {
      return;
    }
    setCheckingPublicRecovery(true);
    try {
      const recovered = await recoverPublicBookingAttempt(salonId);
      if (recovered?.kind === 'resolved_failure') {
        setPublicRecoveryPending(false);
        setBookingError('That booking attempt did not complete. Review your details and confirm again.');
        bookingInitiatedRef.current = false;
        idempotencyKeyRef.current = crypto.randomUUID();
      } else if (isPublicBookingReceipt(recovered)) {
        completeManualBooking(recovered, true);
      }
    } catch {
      // A receipt lookup is intentionally best-effort. Its failure leaves the
      // persisted attempt pending and never authorizes another create.
    } finally {
      setCheckingPublicRecovery(false);
    }
  }, [completeManualBooking, salonId]);

  const startAnotherManualBooking = useCallback(() => {
    try {
      const attempt = salonId ? readPublicBookingAttempt(salonId) : null;
      if (attempt?.state === 'pending') {
        setBookingComplete(false);
        setPublicRecoveryPending(true);
        void checkPublicRecovery();
        return;
      }
      if (salonId && attempt?.state === 'resolved') {
        clearPublicBookingAttempt(salonId);
      }
      clearBookingState();
      router.push(buildBookingUrl(`/${locale}/book/service`, { salonSlug }, { routeSalonSlug, locale }));
    } catch {
      setBookingComplete(false);
      setPublicRecoveryPending(true);
    }
  }, [checkPublicRecovery, clearBookingState, locale, routeSalonSlug, router, salonId, salonSlug]);

  useEffect(() => {
    if (!salonId) {
      return;
    }
    try {
      const attempt = readPublicBookingAttempt(salonId);
      if (!attempt) {
        return;
      }
      const currentConfirmationPath = `${window.location.pathname}${window.location.search}`;
      if (attempt.confirmationPath !== currentConfirmationPath) {
        // A completed earlier booking must not hijack a deliberate new flow.
        // An unresolved attempt remains unsafe, so return to its exact review
        // URL before allowing any further confirmation.
        if (attempt.state === 'pending') {
          setPublicRecoveryPending(true);
          router.replace(attempt.confirmationPath);
        }
        return;
      }
      setPublicRecoveryPending(attempt.state === 'pending');
      if (attempt.state === 'resolved' && isPublicBookingReceipt(attempt.response)) {
        completeManualBooking(attempt.response, true);
        return;
      }
      void checkPublicRecovery();
    } catch {
      // A malformed browser record is never a reason to create another booking.
      setPublicRecoveryPending(true);
    }
  }, [checkPublicRecovery, completeManualBooking, isAssistantHandoff, router, salonId]);

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
    bookingBasket,
    basketReviewFingerprint,
    serviceIds: services.map(service => service.id),
    technicianId: techId === 'any' ? null : techId,
    publicActor: 'guest',
    clientName: guestName.trim(),
    bookingSubject: 'guest',
    clientEmail: guestEmail.trim().toLowerCase(),
    clientPhone: guestPhone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''),
    smsConsent: smsBookingDefault !== 'disabled'
      ? { granted: smsConsent, wordingVersion: SMS_CONSENT_WORDING_VERSION, selection: smsConsentSelection }
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
      bookingBasket,
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
      bookingFlow: bookingFlowMarker,
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
    if (bookingInitiatedRef.current || recoveringHandoff || publicRecoveryPending) {
      return;
    }
    if (isAssistantHandoff && bookingBasket) {
      setBookingError('This assistant booking supports one service. Return to Services and remove the extra service before confirming.');
      return;
    }
    if (salonId) {
      try {
        if (readPublicBookingAttempt(salonId)?.state === 'pending') {
          setPublicRecoveryPending(true);
          void checkPublicRecovery();
          return;
        }
      } catch {
        setPublicRecoveryPending(true);
        return;
      }
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
        ...(bookingBasket
          ? {
              bookingBasket,
              ...(basketReviewFingerprint ? { expectedBasketReviewFingerprint: basketReviewFingerprint } : {}),
            }
          : baseServiceId
            ? {
                baseServiceId,
                selectedAddOns,
                catalogAcknowledgment,
              }
            : {
                serviceIds: services.map(s => s.id),
              }),
        technicianId: techId === 'any' ? null : techId,
        clientName: guestName.trim(),
        bookingSubject: 'guest' as const,
        clientEmail: guestEmail.trim().toLowerCase(),
        clientPhone: guestPhone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''),
        ...(smsBookingDefault !== 'disabled' && {
          smsConsent: {
            granted: smsConsent,
            wordingVersion: SMS_CONSENT_WORDING_VERSION,
            selection: smsConsentSelection,
          },
        }),
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
        ...(nextVisitQuoteExpectation && { expectedTotalCents: nextVisitQuoteExpectation.totalCents, expectedDiscountType: nextVisitQuoteExpectation.discountType }),
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

      if (isAssistantHandoff) {
        if (!salonId) {
          throw new NormalBookingRecoveryError('handoff_missing');
        }
        const parsed = normalBookingPrepareSchema.shape.booking.safeParse({ ...requestBody, appointmentTime: timeStr.padStart(5, '0') });
        if (!parsed.success) {
          throw new NormalBookingRecoveryError('invalid_details');
        }
        const status = await confirmNormalHandoffBooking({ salonId, booking: parsed.data, displayed: {
          totalCents: bookingTotals?.totalDueCents ?? resolvedTotalPriceCents,
          durationMinutes: totalDuration,
          currency: currency.toUpperCase(),
          salonName,
          timeZone: salonTimeZone,
          technician: techId !== 'any' && technician ? { id: technician.id, name: technician.name } : null,
          location: location ? { name: location.name, address: location.address, city: location.city, state: location.state, zipCode: location.zipCode } : null,
          services: services.map(item => ({ id: item.id, name: item.name, priceCents: Math.round(item.price * 100) })),
          addOns: addOns.filter(item => item.priceMode !== 'manual_confirmation').map(item => ({ id: item.id, name: item.name, quantity: item.quantity, priceCents: Math.round(item.price * 100) })),
          manualConfirmationItems: addOns.filter(item => item.priceMode === 'manual_confirmation').map(item => ({ id: item.id, name: item.name, quantity: item.quantity, durationMinutes: item.duration, priceStatus: 'to_be_confirmed' as const })),
          confirmationMode: displayedConfirmationMode,
          reminderMode: smsBookingDefault,
          policyVersion: acknowledgmentRequired ? displayedPolicy.version ?? null : null,
        } });
        if (status.status === 'not_created') {
          if (status.lastFailure === 'slot_unavailable') {
            setSlotTaken(true);
          } else {
            setBookingError(normalBookingErrorMessage(status.lastFailure ?? 'recovery_unavailable'));
            if (status.lastFailure === 'review_changed') {
              router.refresh();
            }
          }
          bookingInitiatedRef.current = false;
        } else {
          setDurableStatus(status);
        }
        return;
      }

      let publicAttempt: ReturnType<typeof beginPublicBookingAttempt> | null = null;
      if (salonId) {
        try {
          publicAttempt = beginPublicBookingAttempt({
            salonId,
            attemptId: idempotencyKeyRef.current,
            protocolVersion: originalAppointmentId ? 1 : 2,
            confirmationPath: `${window.location.pathname}${window.location.search}`,
          });
        } catch {
          setPublicRecoveryPending(true);
          throw new CustomerSafeBookingError(
            'We’re checking your earlier booking before we can submit another one.',
          );
        }
      }

      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKeyRef.current,
          ...(publicAttempt
            ? {
                'X-Booking-Recovery-Key': publicAttempt.recoveryKey,
                ...(publicAttempt.version === 2 ? { 'X-Booking-Attempt-Version': '2' } : {}),
              }
            : {}),
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

        // Try to parse as JSON for error message
        let errorData;
        try {
          errorData = JSON.parse(responseText);
        } catch {
          // Never surface raw server output (HTML error pages, stack traces).
          throw new CustomerSafeBookingError(BOOKING_CONFIRM_FALLBACK_MESSAGE);
        }

        const errorCode = typeof errorData?.error === 'string'
          ? errorData.error
          : errorData?.error?.code;
        if (publicAttempt?.version === 2 && errorData?.bookingAttemptOutcome !== 'resolved_failure') {
          // A generic 4xx may be a replay of an already linked or concurrent
          // attempt. Only the durable authority can release a v2 identity.
          throw new CustomerSafeBookingError(BOOKING_CONFIRM_FALLBACK_MESSAGE);
        }
        // These server codes prove creation stopped before a booking receipt
        // could exist, except the checkout failure code whose server contract
        // proves its hold was released. Unknown failures, 5xx, and in-progress
        // responses retain identity and are reconciled read-only.
        const releasePublicAttempt = () => {
          if (salonId) {
            clearPublicBookingAttempt(salonId);
          }
          setPublicRecoveryPending(false);
          idempotencyKeyRef.current = crypto.randomUUID();
        };
        if (errorData?.bookingAttemptOutcome === 'resolved_failure') {
          releasePublicAttempt();
        }
        const definitiveValidationMessages: Record<string, string> = {
          VALIDATION_ERROR: 'Check your booking and contact details before confirming again.',
          INVALID_PHONE: 'Check your phone number before confirming again.',
          GUEST_CONTACT_REQUIRED: 'Enter your name, phone number and email before confirming.',
          SMS_CONSENT_INVALID: 'Review your reminder preference before confirming again.',
          INVALID_START_TIME: 'Choose a valid appointment time before confirming again.',
          INVALID_SELECTION: 'Review your selected services before confirming again.',
          RATE_LIMIT_EXCEEDED: 'Please wait a few minutes before trying to confirm again.',
          CONTACT_IDENTITY_CONFLICT: 'Check that the phone number and email belong together for this booking. If both details are correct, contact the salon for help.',
        };
        if (response.status < 500 && typeof errorCode === 'string' && definitiveValidationMessages[errorCode]) {
          releasePublicAttempt();
          setBookingError(definitiveValidationMessages[errorCode]!);
          bookingInitiatedRef.current = false;
          return;
        }
        if (errorCode === 'CATALOG_SELECTION_CHANGED' || errorCode === 'BASKET_REVIEW_CHANGED') {
          releasePublicAttempt();
          const serviceUrl = bookingBasket
            ? buildBookingUrl('/book/service', {
              salonSlug,
              bookingBasket,
              originalAppointmentId,
              manageToken,
              campaignToken,
              locationId: location?.id ?? null,
              bookingFlow: bookingFlowMarker,
            }, { routeSalonSlug, locale })
            : appendSalonSlug('/book/service', salonSlug, { routeSalonSlug, locale });
          router.push(`${serviceUrl}${serviceUrl.includes('?') ? '&' : '?'}catalogChanged=1`);
          bookingInitiatedRef.current = false;
          return;
        }
        if (
          errorCode === 'BOOKING_POLICY_CHANGED'
          || errorCode === 'BOOKING_POLICY_ACKNOWLEDGMENT_REQUIRED'
        ) {
          releasePublicAttempt();
          const latestPolicy = readLatestRequiredBookingPolicy(
            errorData.bookingPolicy,
            displayedPolicy,
          );
          if (!latestPolicy) {
            throw new CustomerSafeBookingError(
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
              : 'Review and acknowledge the booking policy before confirming.',
          );
          bookingInitiatedRef.current = false;
          return;
        }

        // `details.deposit` is the ERROR envelope and is the correct container
        // here; on any 2xx the corrected object is `data.deposit`.
        // DELIBERATELY NO AUTO-RESUBMIT: the next POST must require a further
        // user click, and it carries the fingerprint adopted below.
        if (errorCode === 'DEPOSIT_CHANGED') {
          releasePublicAttempt();
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
          releasePublicAttempt();
          setPolicyAcknowledged(false);
          acknowledgmentAttemptIdRef.current = crypto.randomUUID();
          idempotencyKeyRef.current = crypto.randomUUID();
          setBookingError('This booking attempt changed. Please confirm the appointment again.');
          bookingInitiatedRef.current = false;
          return;
        }

        if (errorCode === 'EXISTING_APPOINTMENT') {
          releasePublicAttempt();
          setBookingError('We could not verify these contact details. Check your phone number and email, or contact the salon for help.');
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
          releasePublicAttempt();
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
          setBookingError('You already have a booking waiting for its deposit. Finish that payment, or wait for the hold to expire.');
          bookingInitiatedRef.current = false;
          return;
        }

        // Without these three, every deposit-path failure falls into the
        // generic throw at the bottom of this block and reads as a mystery.
        if (
          errorCode === 'DEPOSIT_CHECKOUT_FAILED'
        ) {
          releasePublicAttempt();
          setBookingError(
            errorCode === 'DEPOSIT_CHECKOUT_FAILED'
              ? 'We could not start the deposit payment, so your slot was released. Please try booking again.'
              : 'We could not reach the payment provider just now. Please try confirming again in a moment.',
          );
          bookingInitiatedRef.current = false;
          return;
        }

        if (
          errorCode === 'DEPOSITS_TEMPORARILY_UNAVAILABLE'
          || errorCode === 'DEPOSIT_CHECKOUT_UNAVAILABLE'
        ) {
          throw new CustomerSafeBookingError(
            'We could not reach the payment provider just now. We’re checking your booking before another attempt.',
          );
        }

        if (errorCode === 'TIME_CONFLICT' || errorCode === 'NO_AVAILABLE_TECHNICIAN') {
          releasePublicAttempt();
          setSlotTaken(true);
          bookingInitiatedRef.current = false;
          return;
        }

        if (errorCode === 'SMART_FIT_CHANGED') {
          releasePublicAttempt();
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
            message: SMART_FIT_STALE_FALLBACK_MESSAGE,
            breakdown,
            // Capture the exact total this visitor reviewed and echoed to the
            // server. The higher-priority response branch changes Smart Fit
            // session state immediately, so deriving this later would lose the
            // only honest "old" side of the comparison.
            previousTotalCents: smartFitOffer?.discountedPriceCents ?? null,
          });
          bookingInitiatedRef.current = false;
          return;
        }

        throw new CustomerSafeBookingError(BOOKING_CONFIRM_FALLBACK_MESSAGE);
      }

      const data = await response.json();
      if (!isPublicBookingReceipt(data)) {
        throw new CustomerSafeBookingError(BOOKING_CONFIRM_FALLBACK_MESSAGE);
      }
      try {
        if (salonId) {
          resolvePublicBookingAttempt(salonId, data);
        }
      } catch {
        // The original 201 is still authoritative; a later page load simply
        // cannot restore it from browser storage.
      }
      completeManualBooking(data);
    } catch (error) {
      if (error instanceof NormalBookingRecoveryError) {
        if (error.reason === 'deposit_changed' && error.depositUpdate) {
          const { deposit, confirmationMode } = error.depositUpdate;
          setDisplayedDeposit(deposit.required
            ? buildDepositDisclosure({ required: true, amountCents: deposit.amountCents, currency: DEPOSIT_CURRENCY })
            : null);
          setSubmittedDepositFingerprint(deposit.fingerprint);
          setDisplayedConfirmationMode(confirmationMode);
          setPolicyAcknowledged(false);
          acknowledgmentAttemptIdRef.current = crypto.randomUUID();
          setBookingError('The deposit required for this booking changed. Please review it and confirm again.');
          bookingInitiatedRef.current = false;
          return;
        }
        setBookingError(normalBookingErrorMessage(error.reason));
        if (error.reason === 'slot_unavailable') {
          setSlotTaken(true);
        }
        if (error.reason === 'review_changed') {
          router.refresh();
        }
        bookingInitiatedRef.current = false;
        return;
      }
      if (!isAssistantHandoff && salonId) {
        // Only an actual pending attempt is ambiguous. A recognized rejection
        // may already have released it before asking the customer to refresh.
        try {
          if (readPublicBookingAttempt(salonId)?.state === 'pending') {
            setPublicRecoveryPending(true);
            void checkPublicRecovery();
          }
        } catch {
          setPublicRecoveryPending(true);
        }
      }
      console.error('Booking error:', error);
      setBookingError(
        error instanceof CustomerSafeBookingError
          ? error.message
          : BOOKING_CONFIRM_FALLBACK_MESSAGE,
      );
      bookingInitiatedRef.current = false;
    } finally {
      setIsBooking(false);
    }
  }, [addOns, salonName, salonTimeZone, technician, displayedConfirmationMode, isAssistantHandoff, salonId, recoveringHandoff, publicRecoveryPending, resolvedTotalPriceCents, totalDuration, locale, routeSalonSlug, router, catalogAcknowledgment, acknowledgmentRequired, baseServiceId, bookingBasket, basketReviewFingerprint, bookingTotals, campaignPromotionPreview, campaignToken, nextVisitQuoteExpectation, canonicalStartTime, checkPublicRecovery, completeManualBooking, currency, dateStr, displayedDeposit?.label, displayedPolicy, guestEmail, guestName, guestPhone, location, manageToken, originalAppointmentId, policyAcknowledged, salonSlug, selectedAddOns, services, smartFitOffer, smsConsent, smsConsentSelection, smsBookingDefault, submittedDepositFingerprint, taxConfigurationIdentity, techId, timeStr]);

  const handleOpenDirections = useCallback(() => {
    openGoogleMapsDirections(location);
  }, [location]);

  const recoverBookingAction = async (action: 'resume' | 'manage') => {
    if (!salonId || !durableStatus) {
      return;
    }
    try {
      const response = await fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: durableStatus.operation.capability }) });
      const data = await response.json() as { url?: string };
      const url = data.url ? customerBookingRecoveryUrl(data.url, action) : null;
      if (!response.ok || !url) {
        throw new Error('unavailable');
      }
      window.location.assign(url);
    } catch {
      setBookingError(normalBookingErrorMessage('recovery_unavailable'));
    }
  };
  const nextBookingLifetime = useRef(0);
  useEffect(() => {
    nextBookingLifetime.current += 1;
    return () => {
      nextBookingLifetime.current += 1;
    };
  }, [salonId]);

  const bookNextAppointment = async () => {
    const lifetime = nextBookingLifetime.current;
    if (!salonId || publicRecoveryPending) {
      throw new Error('BOOKING_STILL_UNRESOLVED');
    }
    const before = readPublicBookingAttempt(salonId);
    if (before?.state === 'pending') {
      throw new Error('BOOKING_STILL_UNRESOLVED');
    }
    const assertUnchanged = captureNextBookingGuard(salonId, salonSlug, isAssistantHandoff ? durableStatus?.operation.capability : undefined);
    let sourceManageUrl = manageUrl;
    if (isAssistantHandoff && durableStatus) {
      if (durableStatus.status !== 'confirmed') {
        throw new Error('BOOKING_STILL_UNRESOLVED');
      }
      const response = await fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/manage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capability: durableStatus.operation.capability }),
      });
      const body = await response.json();
      sourceManageUrl = response.ok && typeof body?.url === 'string' ? customerBookingRecoveryUrl(body.url, 'manage') : null;
    }
    const token = sourceManageUrl ? new URL(sourceManageUrl, window.location.origin).pathname.match(/\/manage\/([\w-]+)$/)?.[1] : null;
    if (!token) {
      throw new Error('BOOKING_LINK_UNAVAILABLE');
    }
    const response = await fetch(`/api/public/appointments/manage/${encodeURIComponent(token)}/next-booking?locale=${encodeURIComponent(locale)}`, { cache: 'no-store' });
    const body = await response.json();
    const destination = body?.data?.bookingUrl;
    if (!response.ok || typeof destination !== 'string' || !destination.startsWith('/') || destination.startsWith('//') || destination.includes('\\')) {
      throw new Error('NEXT_BOOKING_UNAVAILABLE');
    }
    if (nextBookingLifetime.current !== lifetime) {
      throw new Error('BOOKING_VIEW_CHANGED');
    }
    assertUnchanged();
    // An intervening attempt must never be cleared by this earlier receipt.
    const current = readPublicBookingAttempt(salonId);
    if (current?.state === 'pending' || current?.attemptId !== before?.attemptId) {
      throw new Error('BOOKING_RECOVERY_CHANGED');
    }
    if (isAssistantHandoff && durableStatus) {
      startAnotherBooking(salonId, salonSlug, durableStatus.status);
    }
    if (current?.state === 'resolved') {
      clearPublicBookingAttempt(salonId);
    }
    clearBookingState();
    router.push(destination);
  };
  if (isAssistantHandoff && durableStatus && !publicRecoveryPending && !bookingComplete) {
    if (
      (durableStatus.status === 'confirmed' || durableStatus.status === 'awaiting_approval')
      && Array.isArray(durableStatus.review.services)
      && Array.isArray(durableStatus.review.addOns)
      && durableStatus.review.financial
    ) {
      const review = durableStatus.review;
      const reminderState = durableStatus.appointment?.reminderState;
      return (
        <SuccessContent
          bookingStatus={durableStatus.status === 'awaiting_approval' ? 'pending' : 'confirmed'}
          services={review.services.map(service => ({
            id: service.id,
            name: service.name,
            price: service.priceCents / 100,
            duration: 0,
          }))}
          addOns={[...review.addOns.map(addOn => ({
            id: addOn.id,
            name: addOn.name,
            quantity: addOn.quantity,
            price: addOn.priceCents / 100,
            duration: 0,
          })), ...(review.manualConfirmationItems ?? []).map(item => ({ id: item.id, name: item.name, quantity: item.quantity, price: 0, duration: item.durationMinutes, priceMode: 'manual_confirmation' as const }))]}
          technician={review.technician.kind === 'specific'
            ? { id: review.technician.id, name: review.technician.name, imageUrl: null }
            : durableStatus.appointment?.technicianName
              ? { id: 'assigned-technician', name: durableStatus.appointment.technicianName, imageUrl: null }
              : null}
          totalPrice={review.financial.totalDueCents / 100}
          totalDuration={durableStatus.appointment?.durationMinutes ?? review.durationMinutes}
          dateStr={review.date}
          timeStr={review.time}
          pointsEarned={0}
          onOpenDirections={() => openGoogleMapsDirections(review.location)}
          onGoHome={() => router.push(appendSalonSlug('/book', salonSlug, { routeSalonSlug, locale }))}
          location={review.location ? { id: 'booked-location', ...review.location } : null}
          rewardsEnabled={false}
          smsConsentGranted={reminderState === 'enabled'}
          smsReminderStatus={reminderState && reminderState !== 'unrecorded' ? reminderState : null}
          manageUrl={null}
          findBookingUrl={appendSalonSlug('/find-booking', salonSlug, { routeSalonSlug, locale })}
          canonicalStartTime={durableStatus.appointment?.startTime ?? null}
          clientChangeCutoffHours={clientChangeCutoffHours}
          totalPriceDisplay={formatMoney(review.financial.totalDueCents, review.financial.currency)}
          confirmationMessage={null}
          policy={review.bookingPolicy.required ? { enabled: true, title: review.bookingPolicy.title, text: review.bookingPolicy.text, showBeforeConfirmation: true, showAfterConfirmation: true } : { ...displayedPolicy, enabled: false }}
          recoveryError={bookingError}
          rebookingSettings={rebookingSettings}
          onBookNext={bookNextAppointment}
          onManage={() => void recoverBookingAction('manage')}
          onStartAnother={() => {
            try {
              startAnotherBooking(salonId!, salonSlug, durableStatus.status);
              clearBookingState();
              router.push(buildBookingUrl(`/${locale}/book/service`, { salonSlug }, { routeSalonSlug, locale }));
            } catch {
              setBookingError(normalBookingErrorMessage('recovery_unavailable'));
            }
          }}
        />
      );
    }
    return (
      <div className="mx-auto max-w-xl p-4">
        <BookingStatusCard status={durableStatus} locale={locale === 'fr' ? 'fr' : 'en'} onManage={() => void recoverBookingAction('manage')} onResume={() => void recoverBookingAction('resume')} />
        {canStartAnotherBooking(durableStatus.status) && (
          <button
            type="button"
            className="mt-4 min-h-11 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold"
            onClick={() => {
              try {
                startAnotherBooking(salonId!, salonSlug, durableStatus.status);
                clearBookingState();
                router.push(buildBookingUrl(`/${locale}/book/service`, { salonSlug }, { routeSalonSlug, locale }));
              } catch {
                setBookingError(normalBookingErrorMessage('recovery_unavailable'));
              }
            }}
          >
            {locale === 'fr' ? 'Commencer une autre réservation' : 'Start another booking'}
          </button>
        )}
        {bookingError && <p role="alert">{bookingError}</p>}
      </div>
    );
  }

  // Compatibility for older rejection responses, plus the distinct live-hold
  // gate. Ordinary upcoming appointments no longer block creation.
  if (hasExistingAppointment) {
    return (
      <div>
        {depositHold && (
          <DepositHoldNotice
            expiresAt={depositHold.expiresAt}
            resumeUrl={depositHold.resumeUrl}
            salonTimeZone={salonTimeZone}
          />
        )}
        <ExistingAppointmentOptions
          salonSlug={salonSlug}
          guestEmail={guestEmail}
          guestPhone={guestPhone}
          salonPhone={salonPhone}
          hasDepositHold={depositHold !== null}
          onManageBooking={() => {
            if (manageToken) {
              router.push(`/${locale}/${salonSlug}/manage/${manageToken}`);
              return;
            }
            router.push(`/${locale}/${salonSlug}/find-booking`);
          }}
          onRetryBooking={() => {
            setHasExistingAppointment(false);
            setDepositHold(null);
            setBookingError(null);
            if (depositHold) {
              // Live-hold retries still pass the unchanged server hold gate.
              void createBooking();
            }
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
        previousTotalCents={smartFitStale.previousTotalCents}
        currency={currency}
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
    const recovered = recoveredReceipt ? publicBookingReceiptPresentation(recoveredReceipt, salonTimeZone) : null;
    if (recoveredReceipt && !recovered) {
      return (
        <div className="mx-auto max-w-lg p-5">
          <h1 className="text-xl font-semibold">Booking received</h1>
          <p className="mt-3">Your booking was received. Open its details for the current appointment and payment status.</p>
          <a className="mt-4 flex min-h-11 items-center underline" href={manageUrl || appendSalonSlug('/find-booking', salonSlug, { routeSalonSlug, locale })}>View booking details</a>
          <button type="button" className="mt-3 min-h-11 underline" onClick={startAnotherManualBooking}>Book another appointment</button>
        </div>
      );
    }
    return (
      <SuccessContent
        bookingStatus={bookingResultStatus}
        services={recovered?.services ?? services}
        addOns={recovered?.addOns ?? addOns}
        technician={recovered ? recovered.technician : technician}
        totalPrice={recovered?.totalPrice ?? resolvedTotalPrice}
        totalDuration={recovered?.totalDuration ?? resolvedTotalDuration}
        dateStr={recovered?.dateStr ?? dateStr}
        timeStr={recovered?.timeStr ?? timeStr}
        pointsEarned={recovered ? 0 : pointsEarned}
        onOpenDirections={handleOpenDirections}
        onGoHome={() => router.push(appendSalonSlug('/book', salonSlug, {
          routeSalonSlug,
          locale,
        }))}
        location={recovered ? null : location}
        rewardsEnabled={!recovered && rewardsEnabled}
        smsConsentGranted={smsConsent}
        smsReminderStatus={smsReminderStatus}
        manageUrl={manageUrl}
        findBookingUrl={appendSalonSlug('/find-booking', salonSlug, {
          routeSalonSlug,
          locale,
        })}
        canonicalStartTime={recovered?.canonicalStartTime ?? canonicalStartTime}
        clientChangeCutoffHours={clientChangeCutoffHours}
        totalPriceDisplay={recovered ? formatMoney(recovered.totalCents, recovered.currency) : totalPriceDisplay}
        confirmationMessage={recovered ? null : bookingExperience.confirmationMessage}
        policy={recovered ? { ...displayedPolicy, enabled: false } : displayedPolicy}
        onStartAnother={startAnotherManualBooking}
        rebookingSettings={rebookingSettings}
        onBookNext={receiptConfirmed && manageUrl ? bookNextAppointment : undefined}
      />
    );
  }

  const recoveredStatus = recoveredReceipt?.data?.appointment?.status;
  if (recoveredStatus && !['confirmed', 'pending', 'awaiting_payment'].includes(recoveredStatus)) {
    const statusLabels: Record<string, string> = {
      cancelled: 'This appointment was cancelled',
      completed: 'This appointment is complete',
      no_show: 'This appointment is no longer active',
      expired: 'This booking has expired',
      in_progress: 'Your appointment is in progress',
    };
    return (
      <main className="mx-auto max-w-lg space-y-4 px-5 py-8">
        <StateCard
          tone="neutral"
          title={statusLabels[recoveredStatus] ?? 'Your booking was found'}
          description="The original booking was found. Use secure booking recovery or contact the salon for help with its current status."
        />
        <a className="block min-h-11 rounded-xl border border-[var(--n5-border)] p-3 text-center font-semibold" href={appendSalonSlug('/find-booking', salonSlug, { routeSalonSlug, locale })}>
          Find my booking
        </a>
        {salonPhone && <a className="block min-h-11 p-3 text-center underline" href={`tel:${salonPhone.replace(/[^+\d]/g, '')}`}>Contact the salon</a>}
        <button type="button" className="block min-h-11 w-full p-3 text-center underline" onClick={startAnotherManualBooking}>
          Start a new booking
        </button>
      </main>
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
    <>
      {publicRecoveryPending && (
        <BookingRecoveryNotice
          onCheckAgain={() => void checkPublicRecovery()}
          isChecking={checkingPublicRecovery}
          salonPhone={salonPhone}
          findBookingUrl={appendSalonSlug('/find-booking', salonSlug, { routeSalonSlug, locale })}
        />
      )}
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
        isSubmitting={isBooking || publicRecoveryPending}
        isRecoveringBooking={recoveringHandoff || checkingPublicRecovery}
        recoveryUnresolved={publicRecoveryPending}
        location={location}
        rewardsEnabled={rewardsEnabled}
        isReschedule={Boolean(originalAppointmentId)}
        guestName={guestName}
        guestEmail={guestEmail}
        guestPhone={guestPhone}
        smsConsent={smsConsent}
        smsBookingDefault={smsBookingDefault}
        bookingError={checkingPublicRecovery ? null : bookingError}
        onGuestNameChange={setGuestName}
        onGuestEmailChange={setGuestEmail}
        onGuestPhoneChange={setGuestPhone}
        onSmsConsentChange={handleSmsConsentChange}
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
        salonConfirmsManually={displayedConfirmationMode === 'request_approval'}
      />
    </>
  );
}
