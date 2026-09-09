'use client';

/**
 * SettingsModal Component
 *
 * iOS Settings-style experience: a grouped index of settings categories, each
 * opening a focused editing view. Every field, validation rule, permission
 * gate, and save action predates this structure and is preserved unchanged —
 * only the navigation around them is new.
 *
 * Save models (unchanged):
 * - Explicit save: Locations, Booking rules, Notifications, Owner profile
 * - Autosave toggles: Modules, Programs, Staff visibility, Booking flow
 * - Self-contained editors: Branding (PageThemesSettings), Booking flow editor
 */

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  BarChart3,
  Bell,
  Boxes,
  CalendarClock,
  Camera,
  Check,
  ChevronRight,
  CreditCard,
  Eye,
  Facebook,
  Flag,
  Gift,
  Instagram,
  LayoutTemplate,
  ListOrdered,
  MapPin,
  MessageSquare,
  Music2,
  Palette,
  Plug,
  RotateCcw,
  Save,
  Shield,
  User,
  Users,
  X,
} from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { useOwnerAdminFeatureFlags } from '@/app/[locale]/admin/OwnerAdminFeatureFlags';
import { DialogShell } from '@/components/ui/dialog-shell';
import { LockedFeatureRow } from '@/components/ui/locked-feature-row';
import {
  BOOKING_EXPERIENCE_DEFAULTS,
  BOOKING_EXPERIENCE_LIMITS,
  DEFAULT_BOOKING_POLICY_ACKNOWLEDGMENT_TEXT,
  getAccessibleBookingForeground,
  getBookingExperienceCssVariables,
} from '@/libs/bookingExperience';
import type { BookingStep } from '@/libs/bookingFlow';
import {
  buildDepositCardNotices,
  DEPOSIT_RECOMMENDED_MAX_CENTS,
  type DepositPolicyInactiveReason,
  formatDepositCentsForInput,
  parseDepositDollarsToCents,
} from '@/libs/depositPolicy';
import {
  INSTAGRAM_FIELD_HELPER,
  INSTAGRAM_FIELD_LABEL,
  resolveInstagramInput,
  toInstagramHandle,
} from '@/libs/instagramHandle';
import type { ResolvedLoyaltyPoints } from '@/libs/loyalty';
import { hasReviewedForfeitureTaxTreatment } from '@/libs/taxConfig';
import type { SmsOperationalHealth } from '@/libs/textingStatus';
import { getDateKeyInTimeZone } from '@/libs/timeZone';
import { useSalon } from '@/providers/SalonProvider';
import type {
  BookingExperience,
  ModuleKey,
  ResolvedModules,
  SalonVisibilityPolicy,
} from '@/types/salonPolicy';

import { BackButton, ModalHeader } from './AppModal';
import { BookingFlowEditor } from './BookingFlowEditor';
import { PageThemesSettings } from './PageThemesSettings';
import { SmartFitSettingsCard } from './SmartFitSettingsCard';
import { UsageBillingModal } from './UsageBillingModal';

/**
 * Formats a Canadian postal code readably (`m5h2m9` → `M5H 2M9`). Values that
 * do not look like a Canadian postal code are returned untouched, so US ZIPs
 * and free-form entries are never corrupted. Applied only when the user edits
 * the field — stored values are never rewritten just by opening settings.
 */
export function formatCanadianPostalCode(value: string): string {
  const compact = value.trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) {
    return `${compact.slice(0, 3)} ${compact.slice(3)}`;
  }
  return value;
}

/**
 * Section Container
 */
type SectionProps = {
  title?: string;
  footer?: string;
  children: ReactNode;
};

/**
 * IANA timezones for the salon-timezone picker, America/* first (this
 * product's audience), always including the currently stored value so a
 * legacy/nonstandard setting is never silently changed by opening settings.
 */
function getTimeZoneOptions(currentValue: string): string[] {
  let zones: string[] = [];
  try {
    zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) {
    zones = ['America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Vancouver'];
  }
  const ordered = [
    ...zones.filter(zone => zone.startsWith('America/')),
    ...zones.filter(zone => !zone.startsWith('America/')),
  ];
  if (currentValue && !ordered.includes(currentValue)) {
    ordered.unshift(currentValue);
  }
  return ordered;
}

function Section({ title, footer, children }: SectionProps) {
  return (
    <div className="mb-6">
      {title && (
        <div className="mb-2 px-4 text-[13px] font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
          {title}
        </div>
      )}
      <div className="mx-4 overflow-visible rounded-[14px] border border-[var(--owner-line)] bg-[var(--owner-surface)] shadow-sm">
        {children}
      </div>
      {footer && (
        <div className="mt-2 px-8 text-[12px] leading-snug text-[var(--owner-muted)]">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * Settings Row
 */
/**
 * One icon container for every Settings row.
 *
 * The rows used to carry a per-row `iconColor` — eleven saturated squares
 * (green, blue, purple, teal, amber, red, indigo, cyan…) inside a single
 * screen. Onboarding paints one blush tile with the plum glyph, so the
 * workspace does too: the icon says "this is a settings row", the colour is
 * not carrying meaning anybody can decode. `iconColor` is still accepted so
 * every call site stays untouched, but it no longer paints.
 */
const OWNER_ROW_ICON_CLASS
  = 'mr-3 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--owner-blush)] text-[var(--owner-accent)]';

type RowProps = {
  icon?: LucideIcon;
  iconColor?: string;
  label: string;
  value?: string;
  type?: 'link' | 'toggle' | 'display';
  isLast?: boolean;
  defaultOn?: boolean;
  onToggle?: (value: boolean) => void;
  onClick?: () => void;
};

function Row({
  icon: Icon,
  label,
  value,
  type = 'link',
  isLast = false,
  defaultOn = true,
  onToggle,
  onClick,
}: RowProps) {
  const [isOn, setIsOn] = useState(defaultOn);

  const handleToggle = () => {
    const newValue = !isOn;
    setIsOn(newValue);
    onToggle?.(newValue);
  };

  return (
    <div
      className={`flex min-h-11 items-center rounded-[10px] pl-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${type === 'display' ? '' : 'cursor-pointer active:bg-[var(--owner-blush)]'}`}
      onClick={type === 'link' ? onClick : undefined}
      onKeyDown={
        type === 'link' && onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={type === 'link' && onClick ? 'button' : undefined}
      tabIndex={type === 'link' && onClick ? 0 : undefined}
    >
      {/* Icon */}
      {Icon && (
        <div className={OWNER_ROW_ICON_CLASS}>
          <Icon aria-hidden="true" className="size-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between py-3 pr-4 ${
          !isLast ? 'border-b border-[var(--owner-line)]' : ''
        }`}
      >
        <span className="text-[16px] tracking-tight text-[var(--owner-ink)]">{label}</span>

        <div className="flex items-center gap-2">
          {value && <span className="text-[16px] text-[var(--owner-muted,#706267)]">{value}</span>}

          {type === 'link' && (
            <ChevronRight className="size-4 text-[var(--owner-line-strong,#d8c1c8)]" />
          )}

          {type === 'toggle' && (
            <button
              type="button"
              onClick={handleToggle}
              aria-label={`Toggle ${label}`}
              aria-pressed={isOn}
              className={`
                relative h-[31px] w-[51px] rounded-full p-0.5 outline-none transition-colors duration-300
                after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']
                focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2
                ${isOn ? 'bg-[var(--owner-accent)]' : 'bg-[var(--owner-line)]'}
              `}
            >
              <motion.div
                animate={{ x: isOn ? 20 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="size-[27px] rounded-full bg-[var(--owner-surface)] shadow-md"
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Module catalogue for the Features view.
 *
 * Every module is listed here whether or not the salon is entitled to it: an
 * entitled module renders as a toggle, a non-entitled one as a LockedFeatureRow
 * naming the reason. Driving the view from one table is what makes an empty
 * category heading impossible (AG-more-settings-01 /
 * AG-w2-settings-integrations-05).
 */
const MODULE_GROUPS: ReadonlyArray<{
  title: string;
  modules: ReadonlyArray<{
    key: ModuleKey;
    label: string;
    icon: LucideIcon;
    iconColor: string;
  }>;
}> = [
  {
    title: 'Marketing',
    modules: [
      { key: 'smsReminders', label: 'SMS Reminders', icon: MessageSquare, iconColor: 'bg-green-500' },
      { key: 'referrals', label: 'Referrals', icon: Users, iconColor: 'bg-blue-500' },
      { key: 'rewards', label: 'Rewards', icon: Gift, iconColor: 'bg-purple-500' },
    ],
  },
  {
    title: 'Staff',
    modules: [
      { key: 'scheduleOverrides', label: 'Schedule Overrides', icon: User, iconColor: 'bg-orange-500' },
      { key: 'staffEarnings', label: 'Staff Earnings', icon: BarChart3, iconColor: 'bg-teal-500' },
    ],
  },
  {
    title: 'Controls',
    modules: [
      { key: 'clientFlags', label: 'Client Flags', icon: Flag, iconColor: 'bg-amber-500' },
      { key: 'clientBlocking', label: 'Client Blocking', icon: Shield, iconColor: 'bg-red-500' },
    ],
  },
  {
    title: 'Analytics',
    modules: [
      { key: 'analyticsDashboard', label: 'Analytics Dashboard', icon: BarChart3, iconColor: 'bg-indigo-500' },
      { key: 'utilization', label: 'Utilization Reports', icon: BarChart3, iconColor: 'bg-cyan-500' },
    ],
  },
];

/**
 * Module Row (Step 16.3)
 * Entitlement-aware toggle row for modules
 */
type ModuleRowProps = {
  icon?: LucideIcon;
  iconColor?: string;
  label: string;
  moduleKey: ModuleKey;
  enabled: boolean;
  entitled: boolean;
  isLast?: boolean;
  onToggle: (moduleKey: ModuleKey, value: boolean) => void;
};

function ModuleRow({
  icon: Icon,
  label,
  moduleKey,
  enabled,
  entitled,
  isLast = false,
  onToggle,
}: ModuleRowProps) {
  const handleToggle = () => {
    if (!entitled) {
      return;
    }
    onToggle(moduleKey, !enabled);
  };

  return (
    <div
      className={`flex min-h-11 items-center pl-4 ${entitled ? '' : 'opacity-60'}`}
    >
      {/* Icon */}
      {Icon && (
        <div className={OWNER_ROW_ICON_CLASS}>
          <Icon aria-hidden="true" className="size-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between py-3 pr-4 ${
          !isLast ? 'border-b border-[var(--owner-line)]' : ''
        }`}
      >
        <div className="flex flex-col">
          <span className="text-[16px] tracking-tight text-[var(--owner-ink)]">{label}</span>
          {!entitled && (
            <span className="text-[11px] text-amber-600">Upgrade required</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggle}
            disabled={!entitled}
            aria-label={`Toggle ${label}`}
            aria-pressed={enabled && entitled}
            className={`
              relative h-[31px] w-[51px] rounded-full p-0.5 outline-none transition-colors duration-300
              after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']
              focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2
              ${!entitled ? 'cursor-not-allowed' : 'cursor-pointer'}
              ${enabled && entitled ? 'bg-[var(--owner-accent)]' : 'bg-[var(--owner-line)]'}
            `}
          >
            <motion.div
              animate={{ x: enabled && entitled ? 20 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="size-[27px] rounded-full bg-[var(--owner-surface)] shadow-md"
            />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Profile Card
 */
type ProfileCardProps = {
  name: string;
  subtitle?: string;
  initials?: string;
  onClick?: () => void;
};

function ProfileCard({
  name,
  subtitle = 'Salon admin account',
  initials,
  onClick,
}: ProfileCardProps) {
  const displayInitials
    = initials
    || name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase();

  return (
    <button
      type="button"
      className="mb-8 flex w-full cursor-pointer items-center gap-3 px-4 text-left transition-opacity active:opacity-70"
      onClick={onClick}
      data-testid="settings-profile-card"
    >
      <div className="size-[60px] overflow-hidden rounded-full border border-white/50 shadow-sm">
        <div className="flex size-full items-center justify-center bg-gradient-to-br from-gray-200 to-gray-400 text-xl font-bold text-white">
          {displayInitials}
        </div>
      </div>
      <div className="flex-1">
        <div className="text-[20px] font-normal text-[var(--owner-ink,#30262a)]">{name}</div>
        <div className="text-[13px] text-[var(--owner-muted)]">{subtitle}</div>
      </div>
      <ChevronRight className="size-5 text-[var(--owner-line-strong,#d8c1c8)]" />
    </button>
  );
}

/*
 * `DirectionsLocationSection` lived here: a second five-field address form
 * writing the same `PATCH /api/admin/location` as Booking Page → Your
 * Information → Location (source map §C1 row 1). It was removed rather than
 * hidden so there is exactly one address editor; Settings → Locations &
 * directions now hands off to that editor and keeps only the parking &
 * entry instructions, which live nowhere else.
 */

/**
 * Parking & entry instructions — the single editing surface for the
 * directions text used in customer messages. Stored in retention settings
 * (its long-standing home); the Marketing screen no longer duplicates it.
 */
function ParkingInstructionsCard({
  salonSlug,
  onDirtyChange,
}: {
  salonSlug: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [dirty, setDirty] = useState(false);

  const markDirty = useCallback(
    (next: boolean) => {
      setDirty(next);
      onDirtyChange?.(next);
    },
    [onDirtyChange],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/admin/retention/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
          { cache: 'no-store' },
        );
        const body = await response.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          throw new Error(body?.error?.message || 'Failed to load parking instructions');
        }
        setValue(body?.data?.settings?.parkingInstructions ?? '');
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load parking instructions',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [salonSlug]);

  useEffect(() => {
    if (!saved) {
      return undefined;
    }
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const handleSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/retention/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parkingInstructions: value.trim() || null }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || 'Failed to save parking instructions');
      }
      setValue(body?.data?.settings?.parkingInstructions ?? value.trim());
      setSaved(true);
      markDirty(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save parking instructions',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Parking & entry"
      footer="Added to the editable Directions text alongside the salon address and Maps link when you text a client directions."
    >
      {loading
        ? (
            <div className="flex items-center justify-center py-8">
              <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
            </div>
          )
        : (
            <div className="space-y-3 p-4">
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <label htmlFor="settings-parking-instructions" className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                  Parking & entry instructions
                </span>
                <textarea
                  id="settings-parking-instructions"
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setSaved(false);
                    markDirty(true);
                  }}
                  rows={3}
                  maxLength={2000}
                  className="mt-2 w-full resize-y rounded-[10px] border border-[var(--owner-line)] p-3 text-[15px] leading-relaxed text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                  placeholder="Free parking behind the salon. Enter from Queen Street."
                />
              </label>
              <div className="flex items-center justify-end gap-3">
                {saved && !error && (
                  <span className="text-xs font-medium text-green-600">
                    Parking instructions saved.
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !dirty}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="size-4" />
                  <span>{saving ? 'Saving...' : 'Save parking info'}</span>
                </button>
              </div>
            </div>
          )}
    </Section>
  );
}

/**
 * Compare Plans Modal
 * Shows Starter/Pro/Elite plan comparison
 */
type ComparePlansModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

type BookingConfigFormState = {
  bufferMinutes: number;
  slotIntervalMinutes: 5 | 10 | 15 | 30;
  currency: 'CAD' | 'USD';
  timezone: string;
  introPriceDefaultLabel: string;
  firstVisitDiscountEnabled: boolean;
  clientChangeCutoffHours: number;
  /**
   * How far ahead a client must book. Enforced by
   * `GET /api/appointments/availability` and `POST /api/appointments`
   * (`TOO_SOON`) and written by onboarding — until now with no owner editor at
   * all (AG-w2-settings-integrations-01).
   */
  minimumNoticeMinutes: number;
};

type BookingExperienceFormState = BookingExperience;

function copyBookingExperience(
  value: BookingExperienceFormState,
): BookingExperienceFormState {
  return {
    primaryColor: value.primaryColor,
    bookingMessage: value.bookingMessage,
    policy: {
      enabled: value.policy.enabled,
      title: value.policy.title,
      text: value.policy.text,
      showOnServicePage: value.policy.showOnServicePage,
      showBeforeConfirmation: value.policy.showBeforeConfirmation,
      showAfterConfirmation: value.policy.showAfterConfirmation,
      showInConfirmationEmail: value.policy.showInConfirmationEmail,
      acknowledgment: {
        required: value.policy.acknowledgment?.required ?? false,
        text: value.policy.acknowledgment?.text ?? null,
      },
      version: value.policy.version ?? null,
    },
    quickFacts: {
      appointmentOnly: { ...value.quickFacts.appointmentOnly },
      depositNotice: { ...value.quickFacts.depositNotice },
      cancellationNotice: { ...value.quickFacts.cancellationNotice },
    },
    socialLinks: {
      instagram: value.socialLinks.instagram,
      facebook: value.socialLinks.facebook,
      tiktok: value.socialLinks.tiktok,
    },
    confirmationMessage: value.confirmationMessage,
  };
}

function bookingExperienceAppearancesMatch(
  left: BookingExperienceFormState,
  right: BookingExperienceFormState,
): boolean {
  return JSON.stringify({
    primaryColor: left.primaryColor,
    bookingMessage: left.bookingMessage,
    socialLinks: left.socialLinks,
    confirmationMessage: left.confirmationMessage,
  }) === JSON.stringify({
    primaryColor: right.primaryColor,
    bookingMessage: right.bookingMessage,
    socialLinks: right.socialLinks,
    confirmationMessage: right.confirmationMessage,
  });
}

function bookingPoliciesMatch(
  left: BookingExperienceFormState,
  right: BookingExperienceFormState,
): boolean {
  return JSON.stringify({
    policy: left.policy,
    quickFacts: left.quickFacts,
  }) === JSON.stringify({
    policy: right.policy,
    quickFacts: right.quickFacts,
  });
}

const BOOKING_EXPERIENCE_SAVE_ERROR
  = 'Failed to save booking experience settings.';

// S1 (Stage 1): `LOCKED_BOOKING_EXPERIENCE_ENTITLEMENT`,
// `readBookingExperienceEntitlement` and `isBookingExperienceUpgradeRequired`
// were removed here. They existed only to drive the booking-experience
// "locked for this plan" chrome, which is gone now that those fields are
// universal. The super-admin surfaces read the entitlement from their own
// routes and are unaffected.

function normalizeBookingExperienceSaveError(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized === '' || normalized.length > 240) {
    return null;
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getBookingExperienceSaveError(responseBody: unknown): string {
  if (
    typeof responseBody !== 'object'
    || responseBody === null
    || Array.isArray(responseBody)
  ) {
    return BOOKING_EXPERIENCE_SAVE_ERROR;
  }

  const response = responseBody as Record<string, unknown>;
  const details = response.details;
  if (
    typeof details === 'object'
    && details !== null
    && !Array.isArray(details)
  ) {
    const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
    if (
      typeof fieldErrors === 'object'
      && fieldErrors !== null
      && !Array.isArray(fieldErrors)
    ) {
      const entries = Object.entries(fieldErrors).sort(([left], [right]) => {
        if (left === right) {
          return 0;
        }
        return left < right ? -1 : 1;
      });

      for (const [, messages] of entries) {
        if (!Array.isArray(messages)) {
          continue;
        }

        for (const message of messages) {
          const normalized = normalizeBookingExperienceSaveError(message);
          if (normalized) {
            return normalized;
          }
        }
      }
    }
  }

  const nestedError = (
    typeof response.error === 'object'
    && response.error !== null
    && !Array.isArray(response.error)
  )
    ? normalizeBookingExperienceSaveError(
      (response.error as { message?: unknown }).message,
    )
    : null;

  return (
    normalizeBookingExperienceSaveError(response.message)
    ?? nestedError
    ?? normalizeBookingExperienceSaveError(response.error)
    ?? BOOKING_EXPERIENCE_SAVE_ERROR
  );
}

/**
 * S1 (Stage 1) — these editors are no longer entitlement-gated.
 *
 * Every field they write (primaryColor, bookingMessage, socialLinks,
 * confirmationMessage, policy, quickFacts) is UNIVERSAL owner-authored content
 * under UX-OD-02, so the `entitlement` prop and the "locked for this plan" /
 * "preview inactive" states it drove were removed rather than left as dead
 * chrome that still tells a free owner their own content is not public. The
 * server-side write gate was removed in the same change, and booking-time
 * acknowledgment enforcement was aligned in `bookingPolicyAcknowledgment.ts`.
 */
type BookingExperienceEditorProps = {
  draft: BookingExperienceFormState;
  loading: boolean;
  saving: boolean;
  saved: boolean;
  dirty: boolean;
  error: string | null;
  onChange: (
    update: (current: BookingExperienceFormState) => BookingExperienceFormState,
  ) => void;
  onReset: () => void;
  onSave: () => void;
  /** Booking Page → Style & Colours, the single colour authority. */
  appearanceHref?: string;
};

function BookingExperienceEditor({
  draft,
  loading,
  saving,
  saved,
  dirty,
  error,
  onChange,
  onReset,
  onSave,
  appearanceHref,
}: BookingExperienceEditorProps) {
  if (loading) {
    return (
      <div
        aria-live="polite"
        className="flex items-center justify-center gap-2 py-8"
        role="status"
      >
        <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
        <span className="sr-only">Loading booking experience settings</span>
      </div>
    );
  }

  const hasValidPreviewColor = draft.primaryColor !== null
    && /^#[0-9A-F]{6}$/.test(draft.primaryColor);
  const previewColor = hasValidPreviewColor
    ? draft.primaryColor as string
    : '#9F1239';
  const previewForeground = getAccessibleBookingForeground(previewColor);
  const previewStateBorder = hasValidPreviewColor
    ? getBookingExperienceCssVariables(previewColor)[
      '--booking-brand-state-border'
    ] ?? previewColor
    : previewColor;
  // One Instagram normaliser, shared with Your Information → Contact: the
  // owner types a handle, `@handle` or a link and we store the same canonical
  // profile URL either editor would store (source map §C1 row 6).
  const instagramResolution = resolveInstagramInput(draft.socialLinks.instagram);
  const instagramFieldValue = toInstagramHandle(draft.socialLinks.instagram);
  const configuredSocials = [
    {
      key: 'instagram',
      label: INSTAGRAM_FIELD_LABEL,
      value: draft.socialLinks.instagram,
      icon: Instagram,
    },
    {
      key: 'facebook',
      label: 'Facebook',
      value: draft.socialLinks.facebook,
      icon: Facebook,
    },
    {
      key: 'tiktok',
      label: 'TikTok',
      value: draft.socialLinks.tiktok,
      icon: Music2,
    },
  ] as const;

  return (
    <fieldset
      aria-label="Booking experience editor"
      className="m-0 min-w-0 space-y-5 border-0 p-4"
      disabled={saving}
    >
      {error && (
        <div
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/*
          One colour authority. The drafted palette in Booking Page → Style &
          Colours is what customers see; this screen used to edit a SECOND,
          live-immediate colour (`bookingExperience.primaryColor`) three rows
          away from it (source map §C1, AG-more-settings-06). The stored field
          is kept and still saved untouched — nothing here writes it any more.
        */}
        <div
          className="flex flex-col gap-1 rounded-[10px] border border-[var(--owner-line)] bg-[var(--owner-ground)] p-3 sm:col-span-2"
          data-testid="branding-colour-authority"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
            Website colours
          </span>
          <p className="text-sm text-[var(--owner-muted)]">
            Website colours are set in Booking Page → Style &amp; Colours, where
            they stay in your draft until you publish.
          </p>
          {appearanceHref && (
            <a
              href={appearanceHref}
              className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[var(--owner-accent)] underline"
            >
              Open Style &amp; Colours
            </a>
          )}
        </div>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
            Booking message
          </span>
          <textarea
            aria-label="Booking message"
            value={draft.bookingMessage ?? ''}
            onChange={event =>
              onChange(current => ({
                ...current,
                bookingMessage: event.target.value || null,
              }))}
            rows={2}
            maxLength={160}
            placeholder="A short welcome shown near the top of booking."
            className="w-full resize-y rounded-[10px] border border-[var(--owner-line)] p-3 text-[15px] leading-relaxed text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
          />
          <span className="text-right text-xs text-[var(--owner-muted)]">
            {(draft.bookingMessage ?? '').length}
            /160
          </span>
        </label>

        <div className="space-y-3 rounded-[10px] border border-[var(--owner-line)] p-3 sm:col-span-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
              Social links
            </div>
            <p className="mt-1 text-sm text-[var(--owner-muted)]">
              Only configured profile links appear on the booking page.
            </p>
          </div>
          {configuredSocials.map((social) => {
            const SocialIcon = social.icon;
            const isInstagram = social.key === 'instagram';
            return (
              <label key={social.key} className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                  <SocialIcon className="size-4" />
                  {social.label}
                </span>
                <input
                  type={isInstagram ? 'text' : 'url'}
                  // The helper below lives inside the <label>, so it would
                  // otherwise be concatenated into the accessible name.
                  aria-label={social.label}
                  aria-describedby={isInstagram ? 'branding-instagram-helper' : undefined}
                  data-testid={isInstagram ? 'branding-instagram' : undefined}
                  value={isInstagram ? instagramFieldValue : social.value ?? ''}
                  onChange={event =>
                    onChange((current) => {
                      const typed = event.target.value;
                      if (!isInstagram) {
                        return {
                          ...current,
                          socialLinks: { ...current.socialLinks, [social.key]: typed || null },
                        };
                      }
                      const resolution = resolveInstagramInput(typed);
                      return {
                        ...current,
                        socialLinks: {
                          ...current.socialLinks,
                          // A resolvable handle/link is stored canonically; an
                          // in-progress or invalid value is kept verbatim so the
                          // owner keeps what they typed and sees the hint below.
                          instagram: resolution.status === 'resolved' ? resolution.url : typed || null,
                        },
                      };
                    })}
                  maxLength={isInstagram ? 200 : 500}
                  placeholder={isInstagram ? 'yourstudio' : `https://${social.label.toLowerCase()}.com/your-profile`}
                  className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                />
                {isInstagram && (
                  <span
                    className={`text-xs ${instagramResolution.status === 'invalid' ? 'text-red-700' : 'text-[var(--owner-muted)]'}`}
                    data-testid="branding-instagram-helper"
                    id="branding-instagram-helper"
                  >
                    {instagramResolution.status === 'invalid'
                      ? instagramResolution.error
                      : `${INSTAGRAM_FIELD_HELPER}${instagramResolution.status === 'resolved' ? ` — clients see @${instagramResolution.username}` : ''}`}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
            Confirmation message
          </span>
          <textarea
            aria-label="Confirmation message"
            value={draft.confirmationMessage ?? ''}
            onChange={event =>
              onChange(current => ({
                ...current,
                confirmationMessage: event.target.value || null,
              }))}
            rows={3}
            maxLength={500}
            placeholder="Shown below appointment details and in the confirmation email."
            className="w-full resize-y rounded-[10px] border border-[var(--owner-line)] p-3 text-[15px] leading-relaxed text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
          />
          <span className="text-right text-xs text-[var(--owner-muted)]">
            {(draft.confirmationMessage ?? '').length}
            /500
          </span>
        </label>
      </div>

      <div
        data-testid="booking-experience-preview"
        className="space-y-4 rounded-[14px] border border-[var(--owner-line)] bg-[var(--owner-ground)] p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
              Live preview
            </div>
            <h3 className="mt-1 text-xl font-semibold text-gray-950">
              Choose your service
            </h3>
          </div>
        </div>

        {draft.bookingMessage && (
          <p className="whitespace-pre-line break-words text-sm text-[var(--owner-muted)]">
            {draft.bookingMessage}
          </p>
        )}

        <div
          data-testid="booking-experience-preview-service"
          className="flex items-center justify-between rounded-[12px] border-2 bg-[var(--owner-surface)] p-3"
          style={{ borderColor: previewStateBorder }}
        >
          <div>
            <div className="font-semibold text-gray-950">Signature manicure</div>
            <div className="text-xs text-[var(--owner-muted)]">45 min</div>
          </div>
          <span
            className="flex size-6 items-center justify-center rounded-full"
            style={{
              backgroundColor: previewColor,
              color: previewForeground,
            }}
          >
            <Check className="size-4" aria-hidden="true" />
          </span>
        </div>

        <div
          data-testid="booking-experience-preview-button"
          className="w-full rounded-[10px] px-4 py-2.5 text-sm font-semibold"
          style={{
            backgroundColor: previewColor,
            color: previewForeground,
          }}
        >
          Continue
        </div>

        {configuredSocials.some(social => Boolean(social.value)) && (
          <div className="flex items-center gap-2 border-t border-[var(--owner-line)] pt-3">
            {configuredSocials.map((social) => {
              if (!social.value) {
                return null;
              }
              const SocialIcon = social.icon;
              return (
                <span
                  key={social.key}
                  aria-label={`${social.label} social icon preview`}
                  className="flex size-9 items-center justify-center rounded-full border-2 bg-[var(--owner-surface)] text-[var(--owner-ink)]"
                  style={{ borderColor: previewStateBorder }}
                  role="img"
                >
                  <SocialIcon className="size-4" aria-hidden="true" />
                </span>
              );
            })}
          </div>
        )}

        {draft.confirmationMessage && (
          <div className="border-t border-[var(--owner-line)] pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
              Confirmation message
            </div>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-[var(--owner-muted)]">
              {draft.confirmationMessage}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--owner-line)] pt-4">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--owner-line)] px-4 py-2.5 text-sm font-semibold text-[var(--owner-muted)] transition-colors hover:bg-[var(--owner-ground)]"
        >
          <RotateCcw className="size-4" />
          Reset to Default
        </button>
        <div className="flex items-center gap-3">
          {saved && !error && (
            <span
              className="text-xs font-medium text-green-600"
              role="status"
            >
              Booking experience saved.
            </span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !dirty}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="size-4" />
            <span>{saving ? 'Saving...' : 'Save booking experience'}</span>
          </button>
        </div>
      </div>
    </fieldset>
  );
}

const BOOKING_POLICY_UNREADABLE_MESSAGE
  = 'We could not read your saved booking policy, so it is not shown here. Nothing has changed.';

type BookingPolicyEditorProps = BookingExperienceEditorProps & {
  /**
   * AG-04: false until the saved policy has actually been read back. The form
   * must never be interactive while it is showing the OFF defaults for a salon
   * whose policy is live.
   */
  hydrated: boolean;
  onRetryLoad: () => void;
};

function BookingPolicyEditor({
  draft,
  loading,
  saving,
  saved,
  dirty,
  error,
  hydrated,
  onChange,
  onReset,
  onRetryLoad,
  onSave,
}: BookingPolicyEditorProps) {
  const [previewAcknowledged, setPreviewAcknowledged] = useState(false);
  const [previewPolicyExpanded, setPreviewPolicyExpanded] = useState(false);
  const previewPolicyContentId = useId();
  const acknowledgmentRequired
    = draft.policy.acknowledgment?.required === true;
  const acknowledgmentText = draft.policy.acknowledgment?.text ?? '';
  const acknowledgmentCharacterCount = Array.from(acknowledgmentText).length;
  const normalizedPolicyText = draft.policy.text?.trim() ?? '';
  const normalizedAcknowledgmentText = acknowledgmentText.trim();
  const acknowledgmentDependenciesValid = (
    acknowledgmentCharacterCount
    <= BOOKING_EXPERIENCE_LIMITS.policyAcknowledgmentText
    && (
      !acknowledgmentRequired
      || (
        normalizedPolicyText.length > 0
        && normalizedAcknowledgmentText.length > 0
      )
    )
  );

  useEffect(() => {
    setPreviewAcknowledged(false);
    setPreviewPolicyExpanded(false);
  }, [
    acknowledgmentRequired,
    draft.policy.title,
    draft.policy.text,
    draft.policy.version,
    acknowledgmentText,
  ]);

  if (loading) {
    return (
      <div
        aria-live="polite"
        className="flex items-center justify-center gap-2 py-8"
        role="status"
      >
        <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
        <span className="sr-only">Loading booking policy settings</span>
      </div>
    );
  }

  // The load settled without giving us the saved policy. Showing the defaults
  // here would tell the owner the policy is OFF for a policy that may be live,
  // and any toggle they touched would be applied to that wrong baseline.
  if (!hydrated) {
    return (
      <div className="space-y-3 p-4" data-testid="booking-policy-unavailable">
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            {error ?? BOOKING_POLICY_UNREADABLE_MESSAGE}
          </span>
        </div>
        <button
          type="button"
          onClick={onRetryLoad}
          className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--owner-line)] px-4 py-2.5 text-sm font-semibold text-gray-800 transition-colors hover:bg-[var(--owner-ground)]"
        >
          <RotateCcw className="size-4" />
          Try again
        </button>
      </div>
    );
  }

  const quickFactFields = [
    {
      key: 'appointmentOnly',
      title: 'Appointment only',
      description: 'Example: Appointment only',
    },
    {
      key: 'depositNotice',
      title: 'Deposit notice',
      description: 'Example: $15 deposit required',
    },
    {
      key: 'cancellationNotice',
      title: 'Cancellation notice',
      description: 'Example: 24-hour cancellation policy',
    },
  ] as const;
  const visibleQuickFacts = quickFactFields
    .map(field => ({
      key: field.key,
      ...draft.quickFacts[field.key],
    }))
    .filter(fact => fact.enabled && fact.label);
  const previewPolicyCharacters = Array.from(draft.policy.text ?? '');
  const previewPolicyIsLong = previewPolicyCharacters.length > 280;
  const previewPolicyText = (
    previewPolicyIsLong && !previewPolicyExpanded
      ? `${previewPolicyCharacters.slice(0, 280).join('').trimEnd()}…`
      : draft.policy.text
  );
  const showPolicyInPreview = (
    draft.policy.enabled
    && (draft.policy.showBeforeConfirmation || acknowledgmentRequired)
    && Boolean(draft.policy.text)
  );

  return (
    <fieldset
      aria-label="Booking policy editor"
      className="m-0 min-w-0 space-y-5 border-0 p-4"
      disabled={saving}
    >

      {error && (
        <div
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4 rounded-[12px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
        <label className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
              Enable booking policy
            </span>
            <p className="mt-1 text-sm text-[var(--owner-muted)]">
              Publish one canonical policy anywhere you enable below.
            </p>
          </div>
          <input
            aria-label="Enable booking policy"
            aria-describedby={
              acknowledgmentRequired
                ? 'booking-policy-enabled-help'
                : undefined
            }
            type="checkbox"
            checked={draft.policy.enabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              onChange(current => ({
                ...current,
                policy: {
                  ...current.policy,
                  enabled,
                  // AG-03: this is the master switch. Turning the policy off
                  // withdraws the acknowledgment gate with it instead of
                  // leaving a required acknowledgment on a policy that is off
                  // (which the server would silently re-enable).
                  acknowledgment: enabled
                    ? current.policy.acknowledgment
                    : {
                        required: false,
                        text: current.policy.acknowledgment?.text ?? null,
                      },
                },
              }));
            }}
            className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
          />
        </label>
        {acknowledgmentRequired && (
          <p id="booking-policy-enabled-help" className="text-xs text-[var(--owner-muted)]">
            Acknowledgment is required, so this policy is live. Turning it off
            here also stops asking customers to acknowledge it.
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
            Policy title
          </span>
          <input
            aria-label="Policy title"
            type="text"
            value={draft.policy.title ?? ''}
            onChange={event =>
              onChange(current => ({
                ...current,
                policy: {
                  ...current.policy,
                  title: event.target.value || null,
                },
              }))}
            maxLength={60}
            placeholder="Booking policy"
            className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
          />
          <span className="text-right text-xs text-[var(--owner-muted)]">
            {(draft.policy.title ?? '').length}
            /60
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
            Full policy text
            {draft.policy.enabled ? ' (required)' : ''}
          </span>
          <textarea
            aria-label="Full policy text"
            value={draft.policy.text ?? ''}
            onChange={event =>
              onChange(current => ({
                ...current,
                policy: {
                  ...current.policy,
                  text: event.target.value || null,
                },
              }))}
            rows={6}
            maxLength={1500}
            required={draft.policy.enabled}
            placeholder="Explain cancellation, no-show, and deposit expectations."
            className="w-full resize-y rounded-[10px] border border-[var(--owner-line)] p-3 text-[15px] leading-relaxed text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
          />
          <span className="text-right text-xs text-[var(--owner-muted)]">
            {(draft.policy.text ?? '').length}
            /1,500
          </span>
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ['showOnServicePage', 'Show on service page'],
            ['showBeforeConfirmation', 'Show before confirmation'],
            ['showAfterConfirmation', 'Show after confirmation'],
            ['showInConfirmationEmail', 'Show in confirmation email'],
          ] as const).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-[10px] border border-[var(--owner-line)] px-3 py-2.5 text-sm text-[var(--owner-muted)]"
            >
              <input
                type="checkbox"
                aria-label={label}
                aria-describedby={
                  key === 'showBeforeConfirmation' && acknowledgmentRequired
                    ? 'booking-policy-preconfirm-help'
                    : undefined
                }
                checked={draft.policy[key]}
                disabled={
                  key === 'showBeforeConfirmation'
                  && acknowledgmentRequired
                }
                onChange={event =>
                  onChange(current => ({
                    ...current,
                    policy: {
                      ...current.policy,
                      [key]: event.target.checked,
                    },
                  }))}
                className="size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
              />
              {label}
            </label>
          ))}
        </div>
        {acknowledgmentRequired && (
          <p
            id="booking-policy-preconfirm-help"
            className="text-xs text-[var(--owner-muted)]"
          >
            The policy must appear before confirmation while acknowledgment is
            required. Turn off Require acknowledgment to change this.
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-[12px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
        <label className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
              Require acknowledgment
            </span>
            <p className="mt-1 text-sm text-[var(--owner-muted)]">
              Ask customers to confirm this policy before creating a new public booking.
            </p>
          </div>
          <input
            aria-label="Require acknowledgment"
            type="checkbox"
            checked={acknowledgmentRequired}
            onChange={(event) => {
              const required = event.target.checked;
              onChange(current => ({
                ...current,
                policy: {
                  ...current.policy,
                  enabled: required ? true : current.policy.enabled,
                  showBeforeConfirmation:
                    required ? true : current.policy.showBeforeConfirmation,
                  acknowledgment: {
                    required,
                    text: current.policy.acknowledgment?.text ?? null,
                  },
                },
              }));
            }}
            className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
            Acknowledgment wording
            {acknowledgmentRequired ? ' (required)' : ''}
          </span>
          <textarea
            aria-label="Acknowledgment wording"
            aria-describedby="booking-policy-acknowledgment-help booking-policy-acknowledgment-count"
            aria-invalid={
              acknowledgmentCharacterCount
              > BOOKING_EXPERIENCE_LIMITS.policyAcknowledgmentText
            }
            value={acknowledgmentText}
            onChange={event =>
              onChange(current => ({
                ...current,
                policy: {
                  ...current.policy,
                  acknowledgment: {
                    required:
                      current.policy.acknowledgment?.required ?? false,
                    text: event.target.value || null,
                  },
                },
              }))}
            rows={4}
            required={acknowledgmentRequired}
            placeholder={DEFAULT_BOOKING_POLICY_ACKNOWLEDGMENT_TEXT}
            className="w-full resize-y rounded-[10px] border border-[var(--owner-line)] p-3 text-[15px] leading-relaxed text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
          />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p
              id="booking-policy-acknowledgment-help"
              className="max-w-xl text-xs leading-5 text-[var(--owner-muted)]"
            >
              This records that the customer confirmed the policy. It does not authorize
              payments, card storage, cancellation fees, or no-show charges.
            </p>
            <span
              id="booking-policy-acknowledgment-count"
              className={`text-xs ${
                acknowledgmentCharacterCount
                > BOOKING_EXPERIENCE_LIMITS.policyAcknowledgmentText
                  ? 'font-semibold text-red-700'
                  : 'text-[var(--owner-muted)]'
              }`}
            >
              {acknowledgmentCharacterCount}
              /
              {BOOKING_EXPERIENCE_LIMITS.policyAcknowledgmentText}
            </span>
          </div>
        </label>

        <button
          type="button"
          onClick={() =>
            onChange(current => ({
              ...current,
              policy: {
                ...current.policy,
                acknowledgment: {
                  required:
                    current.policy.acknowledgment?.required ?? false,
                  text: DEFAULT_BOOKING_POLICY_ACKNOWLEDGMENT_TEXT,
                },
              },
            }))}
          className="inline-flex items-center rounded-[10px] border border-[var(--owner-line)] px-3 py-2 text-sm font-semibold text-gray-800 transition-colors hover:bg-[var(--owner-ground)]"
        >
          Use suggested wording
        </button>

        {!acknowledgmentDependenciesValid
        && (
          acknowledgmentRequired
          || acknowledgmentCharacterCount
          > BOOKING_EXPERIENCE_LIMITS.policyAcknowledgmentText
        ) && (
          <div
            className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            role="alert"
          >
            {acknowledgmentCharacterCount
            > BOOKING_EXPERIENCE_LIMITS.policyAcknowledgmentText
              ? `Acknowledgment wording must be ${BOOKING_EXPERIENCE_LIMITS.policyAcknowledgmentText} characters or fewer.`
              : !normalizedPolicyText
                  ? 'Enter full policy text before requiring acknowledgment.'
                  : !normalizedAcknowledgmentText
                      ? 'Enter acknowledgment wording before requiring acknowledgment.'
                      : null}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-[12px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
            Quick facts
          </span>
          <p className="mt-1 text-sm text-[var(--owner-muted)]">
            Every badge is explicit. Nothing is inferred from policy wording or
            other salon settings.
          </p>
        </div>
        {quickFactFields.map((field) => {
          const fact = draft.quickFacts[field.key];
          return (
            <div
              key={field.key}
              className="grid gap-3 rounded-[10px] border border-[var(--owner-line)] p-3 sm:grid-cols-[auto_1fr]"
            >
              <label className="flex items-start gap-2 text-sm font-semibold text-[var(--owner-ink)]">
                <input
                  aria-label={`Enable ${field.title.toLowerCase()} badge`}
                  type="checkbox"
                  checked={fact.enabled}
                  onChange={event =>
                    onChange(current => ({
                      ...current,
                      quickFacts: {
                        ...current.quickFacts,
                        [field.key]: {
                          ...current.quickFacts[field.key],
                          enabled: event.target.checked,
                        },
                      },
                    }))}
                  className="mt-0.5 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                />
                {field.title}
              </label>
              <label className="flex min-w-0 flex-col gap-1">
                <span className="sr-only">{`${field.title} label`}</span>
                <input
                  aria-label={`${field.title} label`}
                  type="text"
                  value={fact.label ?? ''}
                  onChange={event =>
                    onChange(current => ({
                      ...current,
                      quickFacts: {
                        ...current.quickFacts,
                        [field.key]: {
                          ...current.quickFacts[field.key],
                          label: event.target.value || null,
                        },
                      },
                    }))}
                  maxLength={40}
                  placeholder={field.description.replace('Example: ', '')}
                  className="h-10 rounded-[9px] border border-[var(--owner-line)] px-3 text-sm text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                />
                <span className="text-right text-xs text-[var(--owner-muted)]">
                  {(fact.label ?? '').length}
                  /40
                </span>
              </label>
            </div>
          );
        })}
      </div>

      <div
        data-testid="booking-policy-preview"
        className="space-y-3 rounded-[14px] border border-[var(--owner-line)] bg-[var(--owner-ground)] p-4"
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
          Confirmation preview
        </div>
        {visibleQuickFacts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {visibleQuickFacts.map(fact => (
              <span
                key={fact.key}
                className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-950"
              >
                {fact.label}
              </span>
            ))}
          </div>
        )}
        {showPolicyInPreview && (
          <div className="rounded-[12px] border border-amber-200 bg-amber-50/70 p-3">
            <div className="flex items-center gap-2 font-semibold text-gray-950">
              <Shield className="size-4 text-amber-700" aria-hidden="true" />
              {draft.policy.title || 'Booking policy'}
            </div>
            <p
              id={previewPolicyContentId}
              className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-[var(--owner-muted)]"
            >
              {previewPolicyText}
            </p>
            {previewPolicyIsLong && (
              <button
                type="button"
                aria-controls={previewPolicyContentId}
                aria-expanded={previewPolicyExpanded}
                onClick={() =>
                  setPreviewPolicyExpanded(current => !current)}
                className="mt-2 rounded-sm text-xs font-semibold text-gray-950 underline decoration-current underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
              >
                {previewPolicyExpanded ? 'Show less' : 'View full policy'}
              </button>
            )}
          </div>
        )}
        {acknowledgmentRequired && acknowledgmentText && (
          <label className="flex items-start gap-3 rounded-[10px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-3 text-sm leading-6 text-gray-800">
            <input
              type="checkbox"
              checked={previewAcknowledged}
              onChange={event =>
                setPreviewAcknowledged(event.target.checked)}
              className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
            />
            <span className="min-w-0 break-words">{acknowledgmentText}</span>
          </label>
        )}
        <button
          type="button"
          disabled={acknowledgmentRequired && !previewAcknowledged}
          className="w-full rounded-[10px] bg-amber-500 px-4 py-3 text-center text-sm font-semibold text-gray-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Confirm appointment
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--owner-line)] pt-4">
        <div className="space-y-1">
          <button
            type="button"
            data-testid="booking-policy-reset"
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--owner-line)] px-4 py-2.5 text-sm font-semibold text-[var(--owner-muted)] transition-colors hover:bg-[var(--owner-ground)]"
          >
            <RotateCcw className="size-4" />
            Reset policy
          </button>
          <p className="max-w-xs text-xs leading-5 text-[var(--owner-muted)]">
            Clears the wording and turns the policy and its acknowledgment off.
            Save to withdraw it from your booking page.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && !error && (
            <span className="text-xs font-medium text-green-600" role="status">
              Booking policy saved.
            </span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={
              saving
              || !dirty
              || !acknowledgmentDependenciesValid
            }
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="size-4" />
            <span>{saving ? 'Saving...' : 'Save booking policy'}</span>
          </button>
        </div>
      </div>
    </fieldset>
  );
}

type BookingNotificationChannel = 'sms' | 'email' | 'both';
type BookingNotificationEventKey = 'newBooking' | 'appointmentCancelled';

type BookingNotificationEventFormState = {
  technicianEnabled: boolean;
  ownerEnabled: boolean;
  technicianChannel: BookingNotificationChannel;
  ownerChannel: BookingNotificationChannel;
};

type BookingNotificationFormState = Record<
  BookingNotificationEventKey,
  BookingNotificationEventFormState
>;

type BookingNotificationCapabilitiesState = {
  ownerPhonePresent: boolean;
  ownerEmailPresent: boolean;
  smsChannelAvailable: boolean;
  emailChannelAvailable: boolean;
};

type SalonEmailNotificationFormState = {
  newBooking: boolean;
  rescheduled: boolean;
  cancelled: boolean;
  recipientEmail: string;
};

type SalonNotificationRecipientState = {
  email: string | null;
  source: 'configured' | 'owner' | 'salon_account' | null;
  missing: boolean;
};

const DEFAULT_SALON_EMAIL_NOTIFICATION_FORM_STATE: SalonEmailNotificationFormState = {
  newBooking: true,
  rescheduled: true,
  cancelled: true,
  recipientEmail: '',
};

const SALON_EMAIL_NOTIFICATION_EVENT_OPTIONS: Array<{
  key: 'newBooking' | 'rescheduled' | 'cancelled';
  label: string;
  description: string;
}> = [
  {
    key: 'newBooking',
    label: 'New booking emails',
    description: 'Email the salon when a client books an appointment.',
  },
  {
    key: 'rescheduled',
    label: 'Reschedule emails',
    description: 'Email the salon when a client moves an appointment.',
  },
  {
    key: 'cancelled',
    label: 'Cancellation emails',
    description: 'Email the salon when an appointment is cancelled.',
  },
];

const SALON_NOTIFICATION_RECIPIENT_SOURCE_LABEL: Record<
  'configured' | 'owner' | 'salon_account',
  string
> = {
  configured: 'the address above',
  // AG-13: this is a salon property, not the signed-in admin's address. On a
  // salon with more than one admin "your owner email" was simply wrong.
  owner: 'the salon’s owner email',
  salon_account: 'the salon’s account email',
};

function isValidNotificationEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(trimmed);
}

const SLOT_INTERVAL_OPTIONS: Array<
  BookingConfigFormState['slotIntervalMinutes']
> = [5, 10, 15, 30];
const CURRENCY_OPTIONS: Array<BookingConfigFormState['currency']> = [
  'CAD',
  'USD',
];
/**
 * The same choices onboarding offers for "How much notice do you need before
 * an appointment?", so an owner who set it during setup recognises it here.
 * Any other stored value (a custom one from onboarding, or a legacy value)
 * still shows and saves through the Custom row.
 */
const MINIMUM_NOTICE_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'Same day — no minimum notice' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
  { minutes: 720, label: '12 hours' },
  { minutes: 1_440, label: '1 day' },
  { minutes: 2_880, label: '2 days' },
  { minutes: 4_320, label: '3 days' },
];

/** Plain-language summary of a stored notice value, for the Settings row. */
export function formatMinimumNotice(minutes: number): string {
  const preset = MINIMUM_NOTICE_OPTIONS.find(option => option.minutes === minutes);
  if (preset) {
    return preset.minutes === 0 ? 'Same day' : preset.label;
  }
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}
const BOOKING_NOTIFICATION_CHANNEL_OPTIONS: Array<{
  value: BookingNotificationChannel;
  label: string;
}> = [
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'both', label: 'Both' },
];

// Owner alerts here are SMS-only: salon email alerts are configured in the
// Appointment notifications card so one booking can never send two emails.
const OWNER_NOTIFICATION_CHANNEL_OPTIONS: Array<{
  value: BookingNotificationChannel;
  label: string;
}> = [{ value: 'sms', label: 'SMS' }];

const DEFAULT_BOOKING_NOTIFICATION_EVENT_FORM_STATE: BookingNotificationEventFormState
  = {
    technicianEnabled: true,
    ownerEnabled: false,
    technicianChannel: 'sms',
    ownerChannel: 'both',
  };

/**
 * Canonical plan cards (Gate C2). MIRRORS src/libs/billing/billingOffers.ts
 * (a server-only module a client component cannot import); the
 * SettingsModal.billing test pins these against the catalogue so any price
 * drift fails CI. No feature matrix here — §12 forbids inventing one.
 */
export const BILLING_PLAN_CARDS = [
  { family: 'starter', name: 'Starter', monthly: '$14.99', annual: '$149.90', smsCredits: 200 },
  { family: 'pro', name: 'Pro', monthly: '$24.99', annual: '$249.90', smsCredits: 400 },
  { family: 'elite', name: 'Elite', monthly: '$44.99', annual: '$449.90', smsCredits: 800 },
] as const;

function ComparePlansModal({ isOpen, onClose }: ComparePlansModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
      maxWidthClassName="max-w-2xl"
      contentClassName="max-h-[90vh] overflow-hidden rounded-t-[20px] bg-[var(--owner-surface)] shadow-xl supports-[height:100dvh]:max-h-[90dvh] sm:rounded-[20px]"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-plans-title"
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="w-full"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--owner-line)] px-5 py-4">
          <h2 id="compare-plans-title" className="text-lg font-semibold text-[var(--owner-ink)]">Compare Plans</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close compare plans modal"
            className="flex size-11 items-center justify-center rounded-full bg-[var(--owner-ground)] transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950"
          >
            <X className="size-4 text-[var(--owner-muted)]" />
          </button>
        </div>

        {/* Content — the CANONICAL catalogue only (Gate C2, §12). Feature
            access is unchanged by these plans until the separately-approved
            feature matrix lands; plans differ in monthly SMS credits. */}
        <div className="max-h-[calc(90vh-120px)] touch-pan-y overflow-y-auto overscroll-contain p-5 supports-[height:100dvh]:max-h-[calc(90dvh-120px)]">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {BILLING_PLAN_CARDS.map(plan => (
              <div key={plan.family} className="rounded-xl border-2 border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
                <div className="mb-3 text-center">
                  <h3 className="text-lg font-semibold text-[var(--owner-ink)]">{plan.name}</h3>
                  <div className="mt-1 text-2xl font-bold text-[var(--owner-ink)]">{plan.monthly}</div>
                  <p className="mt-1 text-xs text-[var(--owner-muted)]">per month</p>
                </div>
                <ul className="space-y-2 text-sm text-[var(--owner-muted)]">
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-green-500" />
                    {plan.smsCredits}
                    {' '}
                    SMS credits / month
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-green-500" />
                    Email confirmations & reminders included
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-green-500" />
                    {plan.annual}
                    {' '}
                    / year (two months free)
                  </li>
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-4 text-center text-xs text-[var(--owner-muted)]">
            Prices in CAD, plus applicable taxes. Annual plans renew at the
            standard annual price. Your current feature access does not change
            with these plans.
          </p>

          <p className="mt-6 text-center text-xs text-[var(--owner-muted)]">
            To change plans, contact Luster at support@islanailsalon.com
          </p>
        </div>
      </motion.div>
    </DialogShell>
  );
}

type SettingsView
  = | 'index'
  | 'account'
  | 'location'
  | 'branding'
  | 'booking'
  | 'booking-policy'
  | 'booking-flow'
  | 'smart-fit'
  | 'payments'
  | 'notifications'
  | 'communications'
  | 'features'
  | 'visibility';

/**
 * AG-10: settings sub-views live in the URL as `?app=settings&view=<id>` so the
 * system Back gesture walks the same path the on-screen back control does —
 * sub-view → Settings index → More. Every id below is addressable.
 */
const SETTINGS_VIEW_IDS: readonly SettingsView[] = [
  'index',
  'account',
  'location',
  'branding',
  'booking',
  'booking-policy',
  'booking-flow',
  'smart-fit',
  'payments',
  'notifications',
  'communications',
  'features',
  'visibility',
];

function normalizeSettingsView(value: string | null | undefined): SettingsView {
  return SETTINGS_VIEW_IDS.includes(value as SettingsView)
    ? (value as SettingsView)
    : 'index';
}

const VIEW_TITLES: Record<SettingsView, string> = {
  'index': 'Settings',
  'account': 'Account',
  'location': 'Location',
  'branding': 'Branding',
  'booking': 'Booking rules',
  'booking-policy': 'Booking policy',
  'booking-flow': 'Booking flow',
  'smart-fit': 'Smart Fit discounts',
  'payments': 'Payments & taxes',
  'notifications': 'Notifications',
  'communications': 'Client communications',
  'features': 'Features & plan',
  'visibility': 'Staff visibility',
};

/** The settings GET's deposits block. Two launch gates plus a DIAGNOSTIC reason. */
type DepositPolicyStatus = {
  collectionLive: boolean;
  entitled: boolean;
  active: boolean;
  reason: DepositPolicyInactiveReason | null;
  readinessStale: boolean;
  readinessAgeMs: number | null;
};

/**
 * The diagnostic reason in plain language. `collection_not_live` and
 * `not_entitled` are deliberately absent: by construction the diagnostic reason
 * never carries either gate, and reading a gate off the reason would show the
 * owner nothing while both are off.
 */
const DEPOSIT_REASON_COPY: Record<DepositPolicyInactiveReason, string | null> = {
  collection_not_live: null,
  not_entitled: null,
  currency_unsupported: 'Deposits are only supported when this salon bills in Canadian dollars.',
  not_configured: 'Set a deposit amount to finish setting this up.',
  disabled: 'Deposits are set up but switched off.',
  readiness_never_synced: 'We have not confirmed your payment account yet.',
  account_not_connected: 'Connect a payment account before switching deposits on.',
  account_not_charge_ready: 'Your payment account cannot accept charges yet.',
  undetermined: 'We could not check your deposit setup just now. Try again shortly.',
};

type PaymentsFormState = {
  taxEnabled: boolean;
  taxName: string;
  /** Kept as the typed string; converted to basis points on save. */
  taxRatePercent: string;
  pricesIncludeTax: boolean;
  taxServicesByDefault: boolean;
  taxAddOnsByDefault: boolean;
  taxCustomByDefault: boolean;
  forfeitureTaxEstimationEnabled: boolean;
  taxJurisdiction: string;
  taxCountry: string;
  taxRegion: string;
  scheduledRatePercent: string;
  scheduledEffectiveFrom: string;
  etransferEnabled: boolean;
  etransferRecipient: string;
  etransferRecipientName: string;
  etransferAutodeposit: boolean;
  etransferInstructions: string;
  etransferRequireReference: boolean;
  etransferQrEnabled: boolean;
};

const DEFAULT_PAYMENTS_FORM: PaymentsFormState = {
  taxEnabled: false,
  taxName: '',
  taxRatePercent: '',
  pricesIncludeTax: false,
  taxServicesByDefault: true,
  taxAddOnsByDefault: true,
  taxCustomByDefault: true,
  forfeitureTaxEstimationEnabled: false,
  taxJurisdiction: '',
  taxCountry: '',
  taxRegion: '',
  scheduledRatePercent: '',
  scheduledEffectiveFrom: '',
  etransferEnabled: false,
  etransferRecipient: '',
  etransferRecipientName: '',
  etransferAutodeposit: false,
  etransferInstructions: '',
  etransferRequireReference: true,
  etransferQrEnabled: false,
};

function bpsToPercentString(bps: number | undefined): string {
  return bps === undefined || bps === null ? '' : String(bps / 100);
}

function scheduledTaxDateForForm(
  scheduled: {
    effectiveFrom?: string;
    effectiveDate?: string;
  } | null | undefined,
  timeZone: string,
): string {
  if (scheduled?.effectiveDate) {
    return scheduled.effectiveDate;
  }
  if (!scheduled?.effectiveFrom) {
    return '';
  }
  const legacyNaiveDate = scheduled.effectiveFrom.match(
    /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?)?$/,
  )?.[1];
  if (legacyNaiveDate) {
    return legacyNaiveDate;
  }
  const instant = new Date(scheduled.effectiveFrom);
  return Number.isFinite(instant.getTime())
    ? getDateKeyInTimeZone(instant, timeZone)
    : '';
}

function percentStringToBps(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(30000, Math.round(parsed * 100));
}

type SettingsModalProps = {
  initialView?: string;
  onClose: () => void;
  salonSlug?: string | null;
  salonId?: string | null;
  isFreeSolo?: boolean;
  userName?: string;
  userInitials?: string;
  /** Hop to another workspace app (e.g. Integrations, Staff). */
  onOpenApp?: (appId: string) => void;
  /** Whether the Analytics app (home of Smart Fit results) is available. */
  smartFitResultsAvailable?: boolean;
};

export function SettingsModal({
  initialView,
  onClose,
  salonSlug: explicitSalonSlug,
  salonId = null,
  isFreeSolo = false,
  userName = 'Salon owner',
  userInitials,
  onOpenApp,
  smartFitResultsAvailable = false,
}: SettingsModalProps) {
  const { salonSlug: providerSalonSlug } = useSalon();
  const salonSlug = explicitSalonSlug ?? providerSalonSlug ?? null;
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = String(params?.locale || 'en');
  const { sectionLibraryV1Enabled } = useOwnerAdminFeatureFlags();
  /**
   * The Booking Page hub owns website appearance and the business record.
   * Settings links there instead of keeping a second editor for either
   * (source map §C1; AG-more-settings-06, AG-w2-information-parity-03).
   */
  const bookingPageHubHref = salonSlug
    ? `/${locale}/admin/booking-page?salon=${encodeURIComponent(salonSlug)}`
    : null;
  const appearanceHubHref = bookingPageHubHref ? `${bookingPageHubHref}&panel=appearance` : undefined;
  const informationHubHref = bookingPageHubHref ? `${bookingPageHubHref}&panel=information` : undefined;

  // View navigation state (index + focused editing views)
  const [view, setView] = useState<SettingsView>(
    () => normalizeSettingsView(initialView),
  );
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  // Per-view unsaved-edit tracking (explicit-save views only; autosave views
  // never hold unsaved state)
  const [parkingDirty, setParkingDirty] = useState(false);
  const [bookingConfigDirty, setBookingConfigDirty] = useState(false);
  const [notificationsDirty, setNotificationsDirty] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [paymentsDirty, setPaymentsDirty] = useState(false);
  const [smartFitDirty, setSmartFitDirty] = useState(false);
  const [bookingExperienceDirty, setBookingExperienceDirty] = useState(false);
  const [bookingPolicyDirty, setBookingPolicyDirty] = useState(false);

  // Payments & taxes state (explicit-save)
  const [paymentsSaving, setPaymentsSaving] = useState(false);
  const [paymentsSaved, setPaymentsSaved] = useState(false);
  const [paymentsForm, setPaymentsForm] = useState<PaymentsFormState>(DEFAULT_PAYMENTS_FORM);

  // Deposits (D3) — its OWN save action, posting only `{ payments: { deposit } }`.
  // The card does NO arithmetic: dollars/cents conversion in both directions and
  // both money-bearing sentences come from `depositPolicy.ts`.
  const [depositEnabled, setDepositEnabled] = useState(false);
  const [depositAmountInput, setDepositAmountInput] = useState('');
  // DIRTY-FIELD SAVE: a field the owner did not touch in THIS session is omitted
  // from the body entirely rather than re-sent at its rendered value. Without it
  // a stale tab pressing Save silently reverts a deliberate correction made
  // elsewhere, both requests 200, and every later client is charged the old
  // amount clamped to their booking total.
  const [depositEnabledDirty, setDepositEnabledDirty] = useState(false);
  const [depositAmountDirty, setDepositAmountDirty] = useState(false);
  const [depositSaving, setDepositSaving] = useState(false);
  const [depositSaved, setDepositSaved] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositCopyWarning, setDepositCopyWarning] = useState<string | null>(null);
  const [depositPolicy, setDepositPolicy] = useState<DepositPolicyStatus | null>(null);

  // Booking flow state
  const [bookingFlowEnabled, setBookingFlowEnabled] = useState(false);
  const [bookingFlow, setBookingFlow] = useState<BookingStep[] | null>(null);
  const [bookingFlowLoading, setBookingFlowLoading] = useState(true);

  // Modules state (Step 16.3)
  const [modulesLoading, setModulesLoading] = useState(true);
  const [modulesSaving, setModulesSaving] = useState(false);
  const [modules, setModules] = useState<ResolvedModules>({
    smsReminders: true,
    referrals: true,
    rewards: true,
    scheduleOverrides: true,
    staffEarnings: true,
    clientFlags: true,
    clientBlocking: true,
    analyticsDashboard: true,
    utilization: true,
  });
  const [entitledModules, setEntitledModules] = useState<
    Record<ModuleKey, boolean>
  >({
    smsReminders: false,
    referrals: false,
    rewards: false,
    scheduleOverrides: false,
    staffEarnings: false,
    clientFlags: false,
    clientBlocking: false,
    analyticsDashboard: false,
    utilization: false,
  });
  // Why each module is unavailable, straight from the modules API. The Features
  // view shows this to the owner instead of discarding it.
  const [moduleReasons, setModuleReasons] = useState<
    Partial<Record<ModuleKey, string>>
  >({});

  // Visibility settings state (Step 16.1)
  const [visibilityLoading, setVisibilityLoading] = useState(true);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityEntitled, setVisibilityEntitled] = useState(false);

  // Usage & billing modal (Gate C4).
  const [showUsageBilling, setShowUsageBilling] = useState(false);

  // Compare Plans modal state (Step 19)
  const [showComparePlans, setShowComparePlans] = useState(false);

  // Owner profile state (Account view)
  const [profileName, setProfileName] = useState(userName);
  const [profileEmail, setProfileEmail] = useState('');
  // AG-08/AG-09: the address is loaded so the owner can see it, and it is
  // locked once the account has one — /api/admin/profile has no verification
  // step, so a silent rewrite would redirect owner alerts.
  const [profileEmailLocked, setProfileEmailLocked] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Billing portal state (Account view)
  const [portalOpening, setPortalOpening] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  // Programs state (Step 21E)
  const [programsLoading, setProgramsLoading] = useState(true);
  const [programsSaving, setProgramsSaving] = useState(false);
  const [reviewsEnabled, setReviewsEnabled] = useState(true);
  const [rewardsEnabledProgram, setRewardsEnabledProgram] = useState(true);
  const [_effectivePoints, setEffectivePoints]
    = useState<ResolvedLoyaltyPoints | null>(null);
  const [_defaultPoints, setDefaultPoints]
    = useState<ResolvedLoyaltyPoints | null>(null);
  const [billingMode, setBillingMode] = useState<'NONE' | 'STRIPE'>('NONE');
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(
    null,
  );
  const [bookingConfigLoading, setBookingConfigLoading] = useState(true);
  const [bookingConfigSaving, setBookingConfigSaving] = useState(false);
  const [bookingConfigSaved, setBookingConfigSaved] = useState(false);
  const [bookingExperienceLoading, setBookingExperienceLoading] = useState(true);
  // AG-04: only true once the saved booking experience has been read back.
  const [bookingExperienceHydrated, setBookingExperienceHydrated]
    = useState(false);
  const [bookingExperienceSaving, setBookingExperienceSaving] = useState(false);
  const [bookingExperienceSaved, setBookingExperienceSaved] = useState(false);
  const [bookingExperienceError, setBookingExperienceError]
    = useState<string | null>(null);
  const [bookingPolicySaving, setBookingPolicySaving] = useState(false);
  const [bookingPolicySaved, setBookingPolicySaved] = useState(false);
  const [bookingPolicyError, setBookingPolicyError]
    = useState<string | null>(null);
  const [savedBookingExperience, setSavedBookingExperience]
    = useState<BookingExperienceFormState>(() =>
      copyBookingExperience(BOOKING_EXPERIENCE_DEFAULTS));
  const [bookingExperienceDraft, setBookingExperienceDraft]
    = useState<BookingExperienceFormState>(() =>
      copyBookingExperience(BOOKING_EXPERIENCE_DEFAULTS));
  const [bookingConfigForm, setBookingConfigForm]
    = useState<BookingConfigFormState>({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: '',
      firstVisitDiscountEnabled: false,
      clientChangeCutoffHours: 24,
      minimumNoticeMinutes: 120,
    });
  const [featureLusterManicure, setFeatureLusterManicure] = useState(true);
  const [showServiceImages, setShowServiceImages] = useState(true);
  const [bookingNotificationsSaving, setBookingNotificationsSaving]
    = useState(false);
  const [bookingNotificationsSaved, setBookingNotificationsSaved]
    = useState(false);
  const [bookingNotificationsForm, setBookingNotificationsForm]
    = useState<BookingNotificationFormState>({
      newBooking: DEFAULT_BOOKING_NOTIFICATION_EVENT_FORM_STATE,
      appointmentCancelled: DEFAULT_BOOKING_NOTIFICATION_EVENT_FORM_STATE,
    });
  const [bookingNotificationCapabilities, setBookingNotificationCapabilities]
    = useState<BookingNotificationCapabilitiesState>({
      ownerPhonePresent: false,
      ownerEmailPresent: false,
      smsChannelAvailable: false,
      emailChannelAvailable: false,
    });

  // Gate C1 — transactional client communications (settings.communications).
  // Rules are edited as a whole list (replace-on-save, matching the server's
  // update schema); every control below is reduced-motion safe (CSS
  // transitions behind Tailwind's motion-reduce variant, no spring physics).
  const [smsReadiness, setSmsReadiness] = useState<SmsOperationalHealth | null>(null);
  const [communicationsForm, setCommunicationsForm] = useState<{
    emailEnabled: boolean;
    smsEnabled: boolean;
    killSwitch: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
    rules: Array<{ id: string; offsetMinutes: number; channels: 'sms' | 'email' | 'both'; enabled: boolean }>;
    events: Record<string, { enabled: boolean; channels: 'sms' | 'email' | 'both' }>;
  }>({
    emailEnabled: true,
    smsEnabled: false,
    killSwitch: false,
    quietHours: { enabled: true, start: '21:00', end: '09:00' },
    rules: [],
    events: {},
  });
  const [communicationsDirty, setCommunicationsDirty] = useState(false);
  const [communicationsSaving, setCommunicationsSaving] = useState(false);
  const [communicationsSaved, setCommunicationsSaved] = useState(false);
  const [communicationsError, setCommunicationsError] = useState<string | null>(null);
  const [salonEmailNotificationsForm, setSalonEmailNotificationsForm]
    = useState<SalonEmailNotificationFormState>(
      DEFAULT_SALON_EMAIL_NOTIFICATION_FORM_STATE,
    );
  const [salonNotificationRecipient, setSalonNotificationRecipient]
    = useState<SalonNotificationRecipientState>({
      email: null,
      source: null,
      missing: false,
    });
  const [salonEmailNotificationsDirty, setSalonEmailNotificationsDirty]
    = useState(false);
  const [salonEmailNotificationsSaving, setSalonEmailNotificationsSaving]
    = useState(false);
  const [salonEmailNotificationsSaved, setSalonEmailNotificationsSaved]
    = useState(false);
  const [salonEmailNotificationsError, setSalonEmailNotificationsError]
    = useState<string | null>(null);

  const [visibility, setVisibility] = useState<SalonVisibilityPolicy>({
    staff: {
      showClientPhone: true,
      showClientEmail: false,
      showClientFullName: true,
      showAppointmentPrice: true,
      showClientHistory: false,
      showClientNotes: true,
      showOtherTechAppointments: false,
    },
  });

  /** Field edits mark the booking view dirty so Back can warn about them. */
  /** Sticky "Custom" selection: a typed 180 must not snap back to a preset. */
  const [minimumNoticeCustom, setMinimumNoticeCustom] = useState(false);
  const updateBookingConfigForm = (
    updater: (prev: BookingConfigFormState) => BookingConfigFormState,
  ) => {
    setBookingConfigForm(updater);
    setBookingConfigDirty(true);
    setBookingConfigSaved(false);
  };
  const showCustomMinimumNotice = minimumNoticeCustom
    || !MINIMUM_NOTICE_OPTIONS.some(
      option => option.minutes === bookingConfigForm.minimumNoticeMinutes,
    );

  const updateBookingExperienceDraft = (
    updater: (
      current: BookingExperienceFormState,
    ) => BookingExperienceFormState,
  ) => {
    setBookingExperienceDraft((current) => {
      const next = updater(current);
      setBookingExperienceDirty(
        !bookingExperienceAppearancesMatch(next, savedBookingExperience),
      );
      return next;
    });
    setBookingExperienceSaved(false);
    setBookingExperienceError(null);
  };

  const updateBookingPolicyDraft = (
    updater: (
      current: BookingExperienceFormState,
    ) => BookingExperienceFormState,
  ) => {
    setBookingExperienceDraft((current) => {
      const next = updater(current);
      setBookingPolicyDirty(!bookingPoliciesMatch(next, savedBookingExperience));
      return next;
    });
    setBookingPolicySaved(false);
    setBookingPolicyError(null);
  };

  // Fetch modules settings (Step 16.3)
  const fetchModules = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setModulesLoading(true);
      const response = await fetch(
        `/api/admin/settings/modules?salonSlug=${salonSlug}`,
      );
      if (response.ok) {
        const data = await response.json();
        if (data.data.modules) {
          setModules(data.data.modules);
        }
        if (data.data.entitledModules) {
          setEntitledModules(data.data.entitledModules);
        }
        if (data.data.moduleReasons) {
          setModuleReasons(data.data.moduleReasons);
        }
      }
    } catch (error) {
      console.error('Failed to fetch module settings:', error);
    } finally {
      setModulesLoading(false);
    }
  }, [salonSlug]);

  // Save module toggle (Step 16.3)
  const saveModuleToggle = useCallback(
    async (moduleKey: ModuleKey, value: boolean) => {
      if (!salonSlug) {
        return;
      }

      try {
        setModulesSaving(true);
        const response = await fetch('/api/admin/settings/modules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            modules: { [moduleKey]: value },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.data.modules) {
            setModules(data.data.modules);
          }
          router.refresh();
        }
      } catch (error) {
        console.error('Failed to save module setting:', error);
      } finally {
        setModulesSaving(false);
      }
    },
    [salonSlug, router],
  );

  // Handle module toggle
  const handleModuleToggle = (moduleKey: ModuleKey, value: boolean) => {
    // Optimistically update UI
    setModules(prev => ({ ...prev, [moduleKey]: value }));
    // Save to server
    saveModuleToggle(moduleKey, value);
  };

  // Fetch programs settings (Step 21E)
  const fetchPrograms = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setProgramsLoading(true);
      setBookingConfigLoading(true);
      setBookingExperienceLoading(true);
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
      );
      if (response.ok) {
        const data = await response.json();
        const loadedBookingExperience = copyBookingExperience(
          data.bookingExperience ?? BOOKING_EXPERIENCE_DEFAULTS,
        );
        setSavedBookingExperience(loadedBookingExperience);
        setBookingExperienceDraft(
          copyBookingExperience(loadedBookingExperience),
        );
        setBookingExperienceHydrated(true);
        setBookingExperienceDirty(false);
        setBookingPolicyDirty(false);
        setBookingExperienceSaved(false);
        setBookingPolicySaved(false);
        setBookingExperienceError(null);
        setBookingPolicyError(null);
        setReviewsEnabled(data.reviewsEnabled ?? true);
        setRewardsEnabledProgram(data.rewardsEnabled ?? true);
        setEffectivePoints(data.effectivePoints ?? null);
        setDefaultPoints(data.defaults ?? null);
        setBillingMode(data.billingMode ?? 'NONE');
        setSubscriptionStatus(data.subscriptionStatus ?? null);
        setBookingConfigForm({
          bufferMinutes: data.bookingConfig?.bufferMinutes ?? 10,
          slotIntervalMinutes: data.bookingConfig?.slotIntervalMinutes ?? 15,
          currency: data.bookingConfig?.currency ?? 'CAD',
          timezone: data.bookingConfig?.timezone ?? 'America/Toronto',
          introPriceDefaultLabel:
            data.bookingConfig?.introPriceDefaultLabel ?? '',
          firstVisitDiscountEnabled:
            data.bookingConfig?.firstVisitDiscountEnabled ?? false,
          clientChangeCutoffHours:
            data.bookingConfig?.clientChangeCutoffHours ?? 24,
          minimumNoticeMinutes:
            data.bookingConfig?.minimumNoticeMinutes ?? 120,
        });
        setFeatureLusterManicure(
          data.merchandising?.featureLusterManicure ?? true,
        );
        setShowServiceImages(
          data.merchandising?.showServiceImages !== false,
        );
        setSmsReadiness(data.sms ?? null);
        if (data.communications) {
          setCommunicationsForm({
            emailEnabled: data.communications.email?.enabled !== false,
            smsEnabled: data.communications.sms?.enabled === true,
            killSwitch: data.communications.killSwitch === true,
            quietHours: {
              enabled: data.communications.quietHours?.enabled !== false,
              start: data.communications.quietHours?.start ?? '21:00',
              end: data.communications.quietHours?.end ?? '09:00',
            },
            rules: (data.communications.reminders?.rules ?? []).map((rule: { id: string; offsetMinutes: number; channels: 'sms' | 'email' | 'both'; enabled: boolean }) => ({ ...rule })),
            events: { ...(data.communications.events ?? {}) },
          });
          setCommunicationsDirty(false);
        }
        setBookingConfigDirty(false);
        setBookingNotificationsForm({
          newBooking: {
            technicianEnabled:
              data.bookingNotifications?.newBooking?.technicianEnabled ?? true,
            ownerEnabled:
              data.bookingNotifications?.newBooking?.ownerEnabled ?? false,
            technicianChannel:
              data.bookingNotifications?.newBooking?.technicianChannel ?? 'sms',
            ownerChannel:
              data.bookingNotifications?.newBooking?.ownerChannel ?? 'both',
          },
          appointmentCancelled: {
            technicianEnabled:
              data.bookingNotifications?.appointmentCancelled
                ?.technicianEnabled ?? true,
            ownerEnabled:
              data.bookingNotifications?.appointmentCancelled?.ownerEnabled
              ?? false,
            technicianChannel:
              data.bookingNotifications?.appointmentCancelled
                ?.technicianChannel ?? 'sms',
            ownerChannel:
              data.bookingNotifications?.appointmentCancelled?.ownerChannel
              ?? 'both',
          },
        });
        setNotificationsDirty(false);
        setBookingNotificationCapabilities({
          ownerPhonePresent: data.ownerPhonePresent ?? false,
          ownerEmailPresent: data.ownerEmailPresent ?? false,
          smsChannelAvailable: data.smsChannelAvailable ?? false,
          emailChannelAvailable: data.emailChannelAvailable ?? false,
        });
        setSalonEmailNotificationsForm({
          newBooking: data.salonEmailNotifications?.newBooking ?? true,
          rescheduled: data.salonEmailNotifications?.rescheduled ?? true,
          cancelled: data.salonEmailNotifications?.cancelled ?? true,
          recipientEmail: data.salonEmailNotifications?.recipientEmail ?? '',
        });
        setSalonNotificationRecipient({
          email: data.salonNotificationRecipient?.email ?? null,
          source: data.salonNotificationRecipient?.source ?? null,
          missing: data.salonNotificationRecipientMissing ?? false,
        });
        setSalonEmailNotificationsDirty(false);
        setSalonEmailNotificationsError(null);
        setPaymentsForm({
          taxEnabled: data.payments?.tax?.enabled ?? false,
          taxName: data.payments?.tax?.name ?? '',
          taxRatePercent: bpsToPercentString(data.payments?.tax?.rateBps),
          pricesIncludeTax: data.payments?.tax?.pricesIncludeTax ?? false,
          taxServicesByDefault: data.payments?.tax?.taxServicesByDefault ?? true,
          taxAddOnsByDefault: data.payments?.tax?.taxAddOnsByDefault ?? true,
          taxCustomByDefault: data.payments?.tax?.taxCustomByDefault ?? true,
          forfeitureTaxEstimationEnabled:
            data.payments?.tax?.forfeitureTaxEstimationEnabled ?? false,
          taxJurisdiction: data.payments?.tax?.jurisdiction ?? '',
          taxCountry: data.payments?.tax?.country ?? '',
          taxRegion: data.payments?.tax?.region ?? '',
          scheduledRatePercent: bpsToPercentString(
            data.payments?.tax?.scheduledChange?.rateBps,
          ),
          scheduledEffectiveFrom: scheduledTaxDateForForm(
            data.payments?.tax?.scheduledChange,
            data.bookingConfig?.timezone ?? 'America/Toronto',
          ),
          etransferEnabled: data.payments?.etransfer?.enabled ?? false,
          etransferRecipient: data.payments?.etransfer?.recipient ?? '',
          etransferRecipientName: data.payments?.etransfer?.recipientName ?? '',
          etransferAutodeposit: data.payments?.etransfer?.autodepositEnabled ?? false,
          etransferInstructions: data.payments?.etransfer?.instructions ?? '',
          etransferRequireReference:
            data.payments?.etransfer?.requireReference ?? true,
          etransferQrEnabled: data.payments?.etransfer?.qrPageEnabled ?? false,
        });
        setPaymentsDirty(false);
        setDepositEnabled(data.payments?.deposit?.enabled ?? false);
        setDepositAmountInput(
          typeof data.payments?.deposit?.amountCents === 'number'
            ? formatDepositCentsForInput(data.payments.deposit.amountCents)
            : '',
        );
        setDepositEnabledDirty(false);
        setDepositAmountDirty(false);
        setDepositPolicy(data.depositPolicy ?? null);
      } else {
        setBookingExperienceHydrated(false);
        const body = await response.json().catch(() => null);
        setBookingExperienceError(
          body?.message
          || body?.error?.message
          || body?.error
          || 'Failed to load booking experience settings.',
        );
        setBookingPolicyError(
          body?.message
          || body?.error?.message
          || body?.error
          || 'Failed to load booking policy settings.',
        );
      }
    } catch (error) {
      console.error('Failed to fetch programs settings:', error);
      setBookingExperienceHydrated(false);
      setBookingExperienceError(
        error instanceof Error
          ? error.message
          : 'Failed to load booking experience settings.',
      );
      setBookingPolicyError(
        error instanceof Error
          ? error.message
          : 'Failed to load booking policy settings.',
      );
    } finally {
      setProgramsLoading(false);
      setBookingConfigLoading(false);
      setBookingExperienceLoading(false);
    }
  }, [salonSlug]);

  // Save programs toggle (Step 21E)
  const saveProgramToggle = useCallback(
    async (field: 'reviewsEnabled' | 'rewardsEnabled', value: boolean) => {
      if (!salonSlug) {
        return;
      }

      try {
        setProgramsSaving(true);
        const response = await fetch(
          `/api/admin/salon/settings?salonSlug=${salonSlug}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: value }),
          },
        );

        if (response.ok) {
          router.refresh();
        }
      } catch (error) {
        console.error('Failed to save program setting:', error);
      } finally {
        setProgramsSaving(false);
      }
    },
    [salonSlug, router],
  );

  const saveBookingConfig = useCallback(async () => {
    if (!salonSlug || bookingConfigSaving) {
      return;
    }

    try {
      setBookingConfigSaving(true);
      setBookingConfigSaved(false);
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingConfig: {
              bufferMinutes: bookingConfigForm.bufferMinutes,
              slotIntervalMinutes: bookingConfigForm.slotIntervalMinutes,
              currency: bookingConfigForm.currency,
              timezone: bookingConfigForm.timezone.trim(),
              introPriceDefaultLabel:
                bookingConfigForm.introPriceDefaultLabel.trim() || null,
              firstVisitDiscountEnabled:
                bookingConfigForm.firstVisitDiscountEnabled,
              clientChangeCutoffHours:
                bookingConfigForm.clientChangeCutoffHours,
              minimumNoticeMinutes:
                bookingConfigForm.minimumNoticeMinutes,
            },
            merchandising: {
              featureLusterManicure,
              showServiceImages,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to save booking configuration');
      }

      const data = await response.json();
      setBookingConfigForm({
        bufferMinutes:
          data.bookingConfig?.bufferMinutes ?? bookingConfigForm.bufferMinutes,
        slotIntervalMinutes:
          data.bookingConfig?.slotIntervalMinutes
          ?? bookingConfigForm.slotIntervalMinutes,
        currency: data.bookingConfig?.currency ?? bookingConfigForm.currency,
        timezone: data.bookingConfig?.timezone ?? bookingConfigForm.timezone,
        introPriceDefaultLabel:
          data.bookingConfig?.introPriceDefaultLabel ?? '',
        firstVisitDiscountEnabled:
          data.bookingConfig?.firstVisitDiscountEnabled
          ?? bookingConfigForm.firstVisitDiscountEnabled,
        clientChangeCutoffHours:
          data.bookingConfig?.clientChangeCutoffHours
          ?? bookingConfigForm.clientChangeCutoffHours,
        minimumNoticeMinutes:
          data.bookingConfig?.minimumNoticeMinutes
          ?? bookingConfigForm.minimumNoticeMinutes,
      });
      setFeatureLusterManicure(
        data.merchandising?.featureLusterManicure ?? featureLusterManicure,
      );
      setShowServiceImages(
        data.merchandising?.showServiceImages !== false,
      );
      setBookingConfigSaved(true);
      setBookingConfigDirty(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to save booking config:', error);
    } finally {
      setBookingConfigSaving(false);
    }
  }, [
    bookingConfigForm,
    bookingConfigSaving,
    featureLusterManicure,
    router,
    salonSlug,
    showServiceImages,
  ]);

  /** Field edits mark the payments view dirty so Back can warn about them. */
  const updatePaymentsForm = (
    updater: (prev: PaymentsFormState) => PaymentsFormState,
  ) => {
    setPaymentsForm(updater);
    setPaymentsDirty(true);
    setPaymentsSaved(false);
  };

  const savePayments = useCallback(async () => {
    if (!salonSlug || paymentsSaving) {
      return;
    }

    try {
      setPaymentsSaving(true);
      setPaymentsSaved(false);
      const scheduledBps = percentStringToBps(paymentsForm.scheduledRatePercent);
      const hasScheduledChange
        = paymentsForm.scheduledRatePercent.trim() !== ''
        && paymentsForm.scheduledEffectiveFrom.trim() !== '';
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payments: {
              tax: {
                enabled: paymentsForm.taxEnabled,
                name: paymentsForm.taxName.trim(),
                rateBps: percentStringToBps(paymentsForm.taxRatePercent),
                pricesIncludeTax: paymentsForm.pricesIncludeTax,
                taxServicesByDefault: paymentsForm.taxServicesByDefault,
                taxAddOnsByDefault: paymentsForm.taxAddOnsByDefault,
                taxCustomByDefault: paymentsForm.taxCustomByDefault,
                forfeitureTaxEstimationEnabled:
                  paymentsForm.forfeitureTaxEstimationEnabled,
                jurisdiction: paymentsForm.taxJurisdiction.trim(),
                country: paymentsForm.taxCountry.trim(),
                region: paymentsForm.taxRegion.trim(),
                scheduledChange: hasScheduledChange
                  ? {
                      rateBps: scheduledBps,
                      // The API converts this salon-local date to a timezone-
                      // explicit midnight instant and stores both identities.
                      effectiveFrom: paymentsForm.scheduledEffectiveFrom,
                    }
                  : null,
              },
              etransfer: {
                enabled: paymentsForm.etransferEnabled,
                recipient: paymentsForm.etransferRecipient.trim(),
                recipientName: paymentsForm.etransferRecipientName.trim(),
                autodepositEnabled: paymentsForm.etransferAutodeposit,
                instructions: paymentsForm.etransferInstructions.trim(),
                requireReference: paymentsForm.etransferRequireReference,
                qrPageEnabled: paymentsForm.etransferQrEnabled,
              },
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to save payments settings');
      }

      setPaymentsSaved(true);
      setPaymentsDirty(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to save payments settings:', error);
    } finally {
      setPaymentsSaving(false);
    }
  }, [paymentsForm, paymentsSaving, router, salonSlug]);

  // BOTH money-bearing sentences come from the policy module, so this file holds
  // no money literal at all and no cents/dollars arithmetic of its own.
  const depositCardNotices = buildDepositCardNotices();
  const depositAmountCentsPreview = parseDepositDollarsToCents(depositAmountInput);
  const depositAmountExceedsRecommended
    = depositAmountCentsPreview !== null
    && depositAmountCentsPreview > DEPOSIT_RECOMMENDED_MAX_CENTS;

  /**
   * Its OWN save action: the payments handler above sends tax and e-Transfer
   * together, and a deposit save must not carry either of them.
   */
  const saveDeposit = useCallback(async () => {
    if (!salonSlug || depositSaving) {
      return;
    }

    const deposit: { enabled?: boolean; amountCents?: number } = {};
    if (depositEnabledDirty) {
      deposit.enabled = depositEnabled;
    }
    if (depositAmountDirty) {
      const cents = parseDepositDollarsToCents(depositAmountInput);
      if (cents === null) {
        setDepositError('Enter a deposit amount.');
        return;
      }
      deposit.amountCents = cents;
    }

    try {
      setDepositSaving(true);
      setDepositSaved(false);
      setDepositError(null);
      setDepositCopyWarning(null);

      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payments: { deposit } }),
        },
      );

      const body = await response.json().catch(() => null);

      // SURFACE the 400/409/429/503 bodies rather than discarding them: every
      // one of them tells the owner something they can act on.
      if (!response.ok) {
        setDepositError(
          body?.message
          || body?.error?.message
          || (typeof body?.error === 'string' ? body.error : null)
          || 'Could not save deposits. Try again.',
        );
        return;
      }

      if (typeof body?.depositCopyWarning === 'string') {
        setDepositCopyWarning(body.depositCopyWarning);
      }
      setDepositEnabled(body?.payments?.deposit?.enabled ?? depositEnabled);
      if (typeof body?.payments?.deposit?.amountCents === 'number') {
        setDepositAmountInput(formatDepositCentsForInput(body.payments.deposit.amountCents));
      }
      setDepositEnabledDirty(false);
      setDepositAmountDirty(false);
      setDepositSaved(true);
      router.refresh();
    } catch (error) {
      console.error('Failed to save deposit settings:', error);
      setDepositError('Could not save deposits. Try again.');
    } finally {
      setDepositSaving(false);
    }
  }, [
    depositAmountDirty,
    depositAmountInput,
    depositEnabled,
    depositEnabledDirty,
    depositSaving,
    router,
    salonSlug,
  ]);

  const saveBookingNotifications = useCallback(async () => {
    if (!salonSlug || bookingNotificationsSaving) {
      return;
    }

    try {
      setBookingNotificationsSaving(true);
      setBookingNotificationsSaved(false);
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingNotifications: {
              newBooking: {
                technicianEnabled:
                  bookingNotificationsForm.newBooking.technicianEnabled,
                ownerEnabled: bookingNotificationsForm.newBooking.ownerEnabled,
                technicianChannel:
                  bookingNotificationsForm.newBooking.technicianChannel,
                ownerChannel: bookingNotificationsForm.newBooking.ownerChannel,
              },
              appointmentCancelled: {
                technicianEnabled:
                  bookingNotificationsForm.appointmentCancelled
                    .technicianEnabled,
                ownerEnabled:
                  bookingNotificationsForm.appointmentCancelled.ownerEnabled,
                technicianChannel:
                  bookingNotificationsForm.appointmentCancelled
                    .technicianChannel,
                ownerChannel:
                  bookingNotificationsForm.appointmentCancelled.ownerChannel,
              },
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to save booking notification settings');
      }

      const data = await response.json();
      setBookingNotificationsForm({
        newBooking: {
          technicianEnabled:
            data.bookingNotifications?.newBooking?.technicianEnabled
            ?? bookingNotificationsForm.newBooking.technicianEnabled,
          ownerEnabled:
            data.bookingNotifications?.newBooking?.ownerEnabled
            ?? bookingNotificationsForm.newBooking.ownerEnabled,
          technicianChannel:
            data.bookingNotifications?.newBooking?.technicianChannel
            ?? bookingNotificationsForm.newBooking.technicianChannel,
          ownerChannel:
            data.bookingNotifications?.newBooking?.ownerChannel
            ?? bookingNotificationsForm.newBooking.ownerChannel,
        },
        appointmentCancelled: {
          technicianEnabled:
            data.bookingNotifications?.appointmentCancelled
              ?.technicianEnabled
              ?? bookingNotificationsForm.appointmentCancelled.technicianEnabled,
          ownerEnabled:
            data.bookingNotifications?.appointmentCancelled?.ownerEnabled
            ?? bookingNotificationsForm.appointmentCancelled.ownerEnabled,
          technicianChannel:
            data.bookingNotifications?.appointmentCancelled
              ?.technicianChannel
              ?? bookingNotificationsForm.appointmentCancelled.technicianChannel,
          ownerChannel:
            data.bookingNotifications?.appointmentCancelled?.ownerChannel
            ?? bookingNotificationsForm.appointmentCancelled.ownerChannel,
        },
      });
      setBookingNotificationCapabilities({
        ownerPhonePresent:
          data.ownerPhonePresent
          ?? bookingNotificationCapabilities.ownerPhonePresent,
        ownerEmailPresent:
          data.ownerEmailPresent
          ?? bookingNotificationCapabilities.ownerEmailPresent,
        smsChannelAvailable:
          data.smsChannelAvailable
          ?? bookingNotificationCapabilities.smsChannelAvailable,
        emailChannelAvailable:
          data.emailChannelAvailable
          ?? bookingNotificationCapabilities.emailChannelAvailable,
      });
      setBookingNotificationsSaved(true);
      setNotificationsDirty(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to save booking notifications:', error);
    } finally {
      setBookingNotificationsSaving(false);
    }
  }, [
    bookingNotificationCapabilities,
    bookingNotificationsForm,
    bookingNotificationsSaving,
    router,
    salonSlug,
  ]);

  const saveBookingExperience = useCallback(async () => {
    if (
      !salonSlug
      || bookingExperienceSaving
      || !bookingExperienceDirty
    ) {
      return;
    }

    setBookingExperienceSaving(true);
    setBookingExperienceSaved(false);
    setBookingExperienceError(null);

    try {
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingExperienceAppearance: {
              primaryColor: bookingExperienceDraft.primaryColor,
              bookingMessage: bookingExperienceDraft.bookingMessage,
              socialLinks: bookingExperienceDraft.socialLinks,
              confirmationMessage: bookingExperienceDraft.confirmationMessage,
            },
          }),
        },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        // S1 (Stage 1): the server no longer returns 403 UPGRADE_REQUIRED for
        // these fields — they are universal. The message is surfaced through
        // the normal error alert; there is no locked chrome to switch to.
        throw new Error(getBookingExperienceSaveError(body));
      }

      const persisted = copyBookingExperience(
        body?.bookingExperience ?? bookingExperienceDraft,
      );
      setSavedBookingExperience(persisted);
      setBookingExperienceDraft(copyBookingExperience(persisted));
      setBookingExperienceDirty(false);
      setBookingExperienceSaved(true);
      router.refresh();
    } catch (error) {
      setBookingExperienceError(
        error instanceof Error
          ? error.message
          : BOOKING_EXPERIENCE_SAVE_ERROR,
      );
    } finally {
      setBookingExperienceSaving(false);
    }
  }, [
    salonSlug,
    bookingExperienceSaving,
    bookingExperienceDirty,
    bookingExperienceDraft,
    router,
  ]);

  const saveBookingPolicy = useCallback(async () => {
    if (
      !salonSlug
      || bookingPolicySaving
      || !bookingPolicyDirty
    ) {
      return;
    }

    setBookingPolicySaving(true);
    setBookingPolicySaved(false);
    setBookingPolicyError(null);

    try {
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingPolicy: {
              policy: {
                enabled: bookingExperienceDraft.policy.enabled,
                title: bookingExperienceDraft.policy.title,
                text: bookingExperienceDraft.policy.text,
                showOnServicePage:
                  bookingExperienceDraft.policy.showOnServicePage,
                showBeforeConfirmation:
                  bookingExperienceDraft.policy.showBeforeConfirmation,
                showAfterConfirmation:
                  bookingExperienceDraft.policy.showAfterConfirmation,
                showInConfirmationEmail:
                  bookingExperienceDraft.policy.showInConfirmationEmail,
                acknowledgment: {
                  required:
                    bookingExperienceDraft.policy.acknowledgment?.required
                    ?? false,
                  text:
                    bookingExperienceDraft.policy.acknowledgment?.text
                    ?? null,
                },
              },
              quickFacts: bookingExperienceDraft.quickFacts,
            },
          }),
        },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        // S1 (Stage 1): the server no longer returns 403 UPGRADE_REQUIRED for
        // these fields — they are universal. The message is surfaced through
        // the normal error alert; there is no locked chrome to switch to.
        throw new Error(getBookingExperienceSaveError(body));
      }

      const persisted = copyBookingExperience(
        body?.bookingExperience ?? bookingExperienceDraft,
      );
      setSavedBookingExperience(persisted);
      setBookingExperienceDraft(copyBookingExperience(persisted));
      setBookingPolicyDirty(false);
      setBookingPolicySaved(true);
      router.refresh();
    } catch (error) {
      setBookingPolicyError(
        error instanceof Error
          ? error.message
          : BOOKING_EXPERIENCE_SAVE_ERROR,
      );
    } finally {
      setBookingPolicySaving(false);
    }
  }, [
    salonSlug,
    bookingPolicySaving,
    bookingPolicyDirty,
    bookingExperienceDraft,
    router,
  ]);

  const saveSalonEmailNotifications = useCallback(async () => {
    if (!salonSlug || salonEmailNotificationsSaving) {
      return;
    }

    const trimmedRecipient = salonEmailNotificationsForm.recipientEmail.trim();
    if (trimmedRecipient && !isValidNotificationEmail(trimmedRecipient)) {
      setSalonEmailNotificationsError('Enter a valid email address.');
      return;
    }

    try {
      setSalonEmailNotificationsSaving(true);
      setSalonEmailNotificationsSaved(false);
      setSalonEmailNotificationsError(null);
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonEmailNotifications: {
              newBooking: salonEmailNotificationsForm.newBooking,
              rescheduled: salonEmailNotificationsForm.rescheduled,
              cancelled: salonEmailNotificationsForm.cancelled,
              recipientEmail: trimmedRecipient,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to save appointment notification settings');
      }

      const data = await response.json();
      setSalonEmailNotificationsForm({
        newBooking:
          data.salonEmailNotifications?.newBooking
          ?? salonEmailNotificationsForm.newBooking,
        rescheduled:
          data.salonEmailNotifications?.rescheduled
          ?? salonEmailNotificationsForm.rescheduled,
        cancelled:
          data.salonEmailNotifications?.cancelled
          ?? salonEmailNotificationsForm.cancelled,
        recipientEmail: data.salonEmailNotifications?.recipientEmail ?? '',
      });
      setSalonNotificationRecipient({
        email: data.salonNotificationRecipient?.email ?? null,
        source: data.salonNotificationRecipient?.source ?? null,
        missing: data.salonNotificationRecipientMissing ?? false,
      });
      setSalonEmailNotificationsSaved(true);
      setSalonEmailNotificationsDirty(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to save appointment notifications:', error);
      setSalonEmailNotificationsError(
        'The settings could not be saved. Try again.',
      );
    } finally {
      setSalonEmailNotificationsSaving(false);
    }
  }, [
    router,
    salonEmailNotificationsForm,
    salonEmailNotificationsSaving,
    salonSlug,
  ]);

  const updateSalonEmailNotifications = useCallback(
    (updates: Partial<SalonEmailNotificationFormState>) => {
      setSalonEmailNotificationsForm(prev => ({ ...prev, ...updates }));
      setSalonEmailNotificationsDirty(true);
      setSalonEmailNotificationsSaved(false);
      setSalonEmailNotificationsError(null);
    },
    [],
  );

  const updateBookingNotificationEvent = useCallback(
    (
      eventKey: BookingNotificationEventKey,
      updates: Partial<BookingNotificationEventFormState>,
    ) => {
      setBookingNotificationsForm(prev => ({
        ...prev,
        [eventKey]: {
          ...prev[eventKey],
          ...updates,
        },
      }));
      setBookingNotificationsSaved(false);
      setNotificationsDirty(true);
    },
    [],
  );

  // Fetch visibility settings
  const fetchVisibility = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setVisibilityLoading(true);
      const response = await fetch(
        `/api/admin/settings/visibility?salonSlug=${salonSlug}`,
      );
      if (response.ok) {
        const data = await response.json();
        if (data.data.visibility) {
          setVisibility(data.data.visibility);
        }
        // Check entitlement
        setVisibilityEntitled(data.data.entitled ?? false);
      }
    } catch (error) {
      console.error('Failed to fetch visibility settings:', error);
    } finally {
      setVisibilityLoading(false);
    }
  }, [salonSlug]);

  // Save visibility settings
  const saveVisibility = useCallback(
    async (newVisibility: SalonVisibilityPolicy) => {
      if (!salonSlug) {
        return;
      }

      try {
        setVisibilitySaving(true);
        const response = await fetch('/api/admin/settings/visibility', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            visibility: newVisibility,
          }),
        });

        if (response.ok) {
          router.refresh();
        }
      } catch (error) {
        console.error('Failed to save visibility settings:', error);
      } finally {
        setVisibilitySaving(false);
      }
    },
    [salonSlug, router],
  );

  // Handle visibility toggle
  const handleVisibilityToggle = (
    key: keyof NonNullable<SalonVisibilityPolicy['staff']>,
    value: boolean,
  ) => {
    const newVisibility: SalonVisibilityPolicy = {
      ...visibility,
      staff: {
        ...visibility.staff,
        [key]: value,
      },
    };
    setVisibility(newVisibility);
    saveVisibility(newVisibility);
  };

  // Fetch booking flow settings
  const fetchBookingFlow = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setBookingFlowLoading(true);
      const response = await fetch(
        `/api/admin/settings/booking-flow?salonSlug=${salonSlug}`,
      );
      if (response.ok) {
        const data = await response.json();
        setBookingFlowEnabled(data.data.bookingFlowCustomizationEnabled);
        setBookingFlow(data.data.bookingFlow);
      }
    } catch (error) {
      console.error('Failed to fetch booking flow settings:', error);
    } finally {
      setBookingFlowLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    fetchBookingFlow();
    fetchVisibility();
    fetchModules();
    fetchPrograms();
  }, [fetchBookingFlow, fetchVisibility, fetchModules, fetchPrograms]);

  // AG-09: the Account view used to open with an empty email field under a
  // rule that refused to save without one, so a name-only edit meant retyping
  // an address from memory. Load the stored profile instead.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/admin/profile');
        if (!response.ok) {
          return;
        }
        const body = await response.json().catch(() => null);
        const user = body?.user;
        if (cancelled || !user) {
          return;
        }
        const storedEmail
          = typeof user.email === 'string' ? user.email : '';
        setProfileName(current =>
          current === userName && typeof user.name === 'string' && user.name
            ? user.name
            : current);
        setProfileEmail(storedEmail);
        setProfileEmailLocked(storedEmail.trim().length > 0);
      } catch {
        // Leave the fields as they are; the save path reports its own errors.
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userName]);

  useEffect(() => {
    if (!bookingConfigSaved) {
      return undefined;
    }

    const timer = window.setTimeout(() => setBookingConfigSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [bookingConfigSaved]);

  useEffect(() => {
    if (!bookingNotificationsSaved) {
      return undefined;
    }

    const timer = window.setTimeout(
      () => setBookingNotificationsSaved(false),
      2500,
    );
    return () => window.clearTimeout(timer);
  }, [bookingNotificationsSaved]);

  useEffect(() => {
    if (!profileSaved) {
      return undefined;
    }
    const timer = window.setTimeout(() => setProfileSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [profileSaved]);

  // Handle booking flow save (called by BookingFlowEditor's auto-save)
  const handleBookingFlowSave = async (flow: BookingStep[]) => {
    if (!salonSlug) {
      return;
    }

    const response = await fetch('/api/admin/settings/booking-flow', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug,
        bookingFlow: flow,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save booking flow');
    }

    const data = await response.json();
    setBookingFlow(data.data.bookingFlow);
  };

  // Save owner profile (Account view) — existing /api/admin/profile contract
  const saveProfile = async () => {
    if (profileSaving) {
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    try {
      const response = await fetch('/api/admin/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          // A locked address is never submitted: the route treats a submitted
          // address as a change request and refuses one it cannot verify.
          profileEmailLocked
            ? { name: profileName.trim() }
            : {
                name: profileName.trim(),
                ...(profileEmail.trim()
                  ? { email: profileEmail.trim() }
                  : {}),
              },
        ),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof body?.error === 'string'
            ? body.error
            : 'Failed to save profile',
        );
      }
      setProfileSaved(true);
      setProfileDirty(false);
      router.refresh();
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : 'Failed to save profile',
      );
    } finally {
      setProfileSaving(false);
    }
  };

  // Open the Stripe billing portal (Account view; STRIPE-mode salons only)
  const openBillingPortal = async () => {
    if (!salonId || portalOpening) {
      return;
    }
    setPortalOpening(true);
    setPortalError(null);
    try {
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.url) {
        throw new Error(
          body?.error?.message || 'The billing portal could not be opened.',
        );
      }
      window.location.assign(body.url);
    } catch (error) {
      setPortalError(
        error instanceof Error
          ? error.message
          : 'The billing portal could not be opened.',
      );
      setPortalOpening(false);
    }
  };

  const hasEntitledModules = Object.values(entitledModules).some(Boolean);
  const hasClientPrograms
    = entitledModules.rewards || entitledModules.referrals;
  const staffToolsAvailable
    = !isFreeSolo
    || entitledModules.scheduleOverrides
    || entitledModules.staffEarnings;

  const saveCommunications = useCallback(async () => {
    if (!salonSlug || communicationsSaving) {
      return;
    }
    try {
      setCommunicationsSaving(true);
      setCommunicationsSaved(false);
      setCommunicationsError(null);
      if (communicationsForm.quietHours.start === communicationsForm.quietHours.end) {
        throw new Error('Choose different start and end times for quiet hours.');
      }
      const enabledOffsets = communicationsForm.rules.filter(rule => rule.enabled).map(rule => rule.offsetMinutes);
      if (new Set(enabledOffsets).size !== enabledOffsets.length) {
        throw new Error('Choose a different time for each enabled reminder.');
      }
      const response = await fetch(`/api/admin/salon/settings?salonSlug=${salonSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          communications: {
            sms: { enabled: communicationsForm.smsEnabled },
            killSwitch: communicationsForm.killSwitch,
            email: { enabled: communicationsForm.emailEnabled },
            quietHours: communicationsForm.quietHours,
            reminders: { rules: communicationsForm.rules },
            ...(Object.keys(communicationsForm.events).length > 0
              ? { events: communicationsForm.events }
              : {}),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(response.status === 400
          ? 'Check your reminder times and quiet hours, then try again.'
          : 'Could not save. Please try again.');
      }
      setSmsReadiness(data.sms ?? null);
      if (data.communications) {
        setCommunicationsForm({
          emailEnabled: data.communications.email?.enabled !== false,
          smsEnabled: data.communications.sms?.enabled === true,
          killSwitch: data.communications.killSwitch === true,
          quietHours: {
            enabled: data.communications.quietHours?.enabled !== false,
            start: data.communications.quietHours?.start ?? '21:00',
            end: data.communications.quietHours?.end ?? '09:00',
          },
          rules: (data.communications.reminders?.rules ?? []).map((rule: { id: string; offsetMinutes: number; channels: 'sms' | 'email' | 'both'; enabled: boolean }) => ({ ...rule })),
          events: { ...(data.communications.events ?? {}) },
        });
      }
      setCommunicationsDirty(false);
      setCommunicationsSaved(true);
      setTimeout(() => setCommunicationsSaved(false), 2500);
    } catch (error) {
      setCommunicationsError(error instanceof Error ? error.message : 'Could not save. Please try again.');
    } finally {
      setCommunicationsSaving(false);
    }
  }, [salonSlug, communicationsSaving, communicationsForm]);

  const viewDirty: Partial<Record<SettingsView, boolean>> = {
    'location': parkingDirty,
    'branding': bookingExperienceDirty,
    'booking-policy': bookingPolicyDirty,
    'booking': bookingConfigDirty,
    'payments': paymentsDirty,
    'smart-fit': smartFitDirty,
    'notifications': notificationsDirty,
    'communications': communicationsDirty,
    'account': profileDirty,
  };
  const currentViewDirty = viewDirty[view] === true;

  /**
   * The settings URL for a view. `?salon=` is carried through so the workspace
   * keeps naming the salon it is showing, and the index drops `view` entirely
   * so it is the same URL the More grid opened.
   */
  const buildSettingsHref = useCallback(
    (next: SettingsView) => {
      const query = new URLSearchParams();
      const salonParam = searchParams?.get('salon') ?? salonSlug;
      if (salonParam) {
        query.set('salon', salonParam);
      }
      query.set('app', 'settings');
      if (next !== 'index') {
        query.set('view', next);
      }
      return `/${locale}/admin?${query.toString()}`;
    },
    [locale, salonSlug, searchParams],
  );

  const urlView = normalizeSettingsView(searchParams?.get('view'));
  // Counts the history entries this component pushed, so leaving a sub-view
  // pops the entry it added instead of adding a second one.
  const pushedViewDepthRef = useRef(0);
  const viewRef = useRef<SettingsView>(view);
  viewRef.current = view;

  /** Drop the unsaved draft a focused view was holding. */
  const revertViewDrafts = (from: SettingsView) => {
    if (from === 'branding') {
      setBookingExperienceDraft(current => ({
        ...current,
        primaryColor: savedBookingExperience.primaryColor,
        bookingMessage: savedBookingExperience.bookingMessage,
        socialLinks: { ...savedBookingExperience.socialLinks },
        confirmationMessage: savedBookingExperience.confirmationMessage,
      }));
      setBookingExperienceDirty(false);
      setBookingExperienceError(null);
      setBookingExperienceSaved(false);
    }
    if (from === 'booking-policy') {
      setBookingExperienceDraft(current => ({
        ...current,
        policy: { ...savedBookingExperience.policy },
        quickFacts: {
          appointmentOnly: {
            ...savedBookingExperience.quickFacts.appointmentOnly,
          },
          depositNotice: {
            ...savedBookingExperience.quickFacts.depositNotice,
          },
          cancellationNotice: {
            ...savedBookingExperience.quickFacts.cancellationNotice,
          },
        },
      }));
      setBookingPolicyDirty(false);
      setBookingPolicyError(null);
      setBookingPolicySaved(false);
    }
    setParkingDirty(false);
    setSmartFitDirty(false);
  };

  const goToIndex = () => {
    setConfirmingLeave(false);
    revertViewDrafts(view);
    setView('index');
    if (pushedViewDepthRef.current > 0) {
      pushedViewDepthRef.current -= 1;
      router.back();
    } else if (urlView !== 'index') {
      // Deep-linked straight into a sub-view: there is no entry of ours to
      // pop, so the URL is replaced rather than the history grown.
      router.replace(buildSettingsHref('index'), { scroll: false });
    }
  };

  /** Back from a focused view; warns when the view holds unsaved edits. */
  const handleBack = () => {
    if (view === 'index') {
      onClose();
      return;
    }
    if (currentViewDirty && !confirmingLeave) {
      setConfirmingLeave(true);
      return;
    }
    goToIndex();
  };

  /**
   * AG-10: opening a sub-view pushes `?app=settings&view=<id>` so the system
   * Back gesture returns to the Settings index instead of closing the sheet
   * and discarding the owner's place in a long list.
   */
  const openView = (next: SettingsView) => {
    setConfirmingLeave(false);
    setView(next);
    if (next !== 'index' && next !== urlView) {
      pushedViewDepthRef.current += 1;
      router.push(buildSettingsHref(next), { scroll: false });
    }
  };

  /**
   * AG-06: a Settings row that opens another workspace app leaves Settings
   * first, so the sheet is not left holding a sub-view of an app that is no
   * longer on screen and the `?app=` push is the only navigation in flight.
   */
  const openWorkspaceApp = (appId: string) => {
    if (!onOpenApp) {
      return;
    }
    setConfirmingLeave(false);
    revertViewDrafts(view);
    setView('index');
    pushedViewDepthRef.current = 0;
    onOpenApp(appId);
  };

  // The system Back/Forward gesture moves the URL without going through the
  // handlers above; follow it so the sheet shows the level the URL names.
  useEffect(() => {
    if (urlView === viewRef.current) {
      return;
    }
    setConfirmingLeave(false);
    if (urlView === 'index') {
      revertViewDrafts(viewRef.current);
      pushedViewDepthRef.current = 0;
    }
    setView(urlView);
    // `revertViewDrafts` is re-created every render; the URL is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlView]);

  return (
    <div
      className="flex min-h-full w-full flex-col bg-[var(--owner-ground)] font-sans text-[var(--owner-ink)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--owner-ground)] backdrop-blur-md">
        <ModalHeader
          title={VIEW_TITLES[view]}
          leftAction={(
            <BackButton
              onClick={handleBack}
              label={view === 'index' ? 'Dashboard' : 'Settings'}
            />
          )}
          transparent
        />

        {/* Large Title */}
        <div className="px-4 pb-2">
          <h1 className="owner-title text-[34px] font-bold text-[var(--owner-ink,#30262a)]">
            {VIEW_TITLES[view]}
          </h1>
        </div>
      </div>

      {/* Unsaved-change guard */}
      {confirmingLeave && (
        <div
          className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3"
          role="alertdialog"
          aria-label="Unsaved changes"
        >
          <span className="text-sm text-amber-900">
            You have unsaved changes. Leave without saving?
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setConfirmingLeave(false)}
              className="rounded-full border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={goToIndex}
              className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Scrollable Content */}
      <div className="overflow-y-auto pb-10">
        {view === 'index' && (
          <>
            {/* Profile Card → Account */}
            <ProfileCard
              name={userName}
              initials={userInitials}
              onClick={() => openView('account')}
            />

            <Section title="Business">
              {/*
                The two rows used to be "Website layout & colours" and
                "Branding & appearance" — near-synonyms, three rows apart, one
                of which silently leaves Settings while the other edited a
                second, live-immediate colour (AG-more-settings-06). Each now
                says what it is and where it goes.
              */}
              <Row
                icon={Palette}
                iconColor="bg-[var(--owner-accent)]"
                label="Website layout & colours"
                value="Opens Booking Page"
                onClick={() => router.push(`/${locale}/admin/website${salonSlug ? `?salon=${encodeURIComponent(salonSlug)}` : ''}`)}
              />
              <Row
                icon={MapPin}
                iconColor="bg-[var(--owner-accent)]"
                label="Location"
                value="Address, contact & hours"
                onClick={() => openView('location')}
              />
              <Row
                icon={Palette}
                iconColor="bg-pink-500"
                label="Branding"
                value="Logo, page themes & social"
                onClick={() => openView('branding')}
              />
              {/*
                AG-w2-settings-integrations-15: /admin/policies had no entry
                point anywhere in the workspace, so the only way to reach a
                live write surface was a bookmark or a support instruction.
                It is a Settings screen; it now has a Settings row.
              */}
              <Row
                icon={Camera}
                iconColor="bg-[var(--owner-accent)]"
                label="Photo & auto-post rules"
                value="Before & after photos, social posts"
                onClick={() =>
                  router.push(
                    `/${locale}/admin/policies${salonSlug ? `?salon=${encodeURIComponent(salonSlug)}` : ''}`,
                  )}
                isLast={!sectionLibraryV1Enabled}
              />
              {/*
                The Section Gallery is a dark-launched lab surface. It is only
                offered when its flag is on, and it says so, so nobody lands
                there from a stray URL expecting a finished feature.
              */}
              {sectionLibraryV1Enabled && (
                <Row
                  icon={LayoutTemplate}
                  iconColor="bg-stone-600"
                  label="Section gallery (preview)"
                  value="Early look at new page sections"
                  onClick={() => router.push(`/${locale}/admin/site-builder/section-gallery`)}
                  isLast
                />
              )}
            </Section>

            <Section title="Booking">
              <Row
                icon={CalendarClock}
                iconColor="bg-rose-600"
                label="Booking rules"
                value={
                  bookingConfigLoading
                    ? undefined
                    : `${bookingConfigForm.slotIntervalMinutes} min · ${formatMinimumNotice(bookingConfigForm.minimumNoticeMinutes)} notice`
                }
                onClick={() => openView('booking')}
              />
              <Row
                icon={Shield}
                iconColor="bg-amber-600"
                label="Booking policy"
                value={
                  bookingExperienceLoading
                    ? undefined
                    : bookingExperienceDraft.policy.enabled
                      ? 'Enabled'
                      : 'Off'
                }
                onClick={() => openView('booking-policy')}
              />
              {!isFreeSolo && (
                <Row
                  icon={ListOrdered}
                  iconColor="bg-amber-500"
                  label="Booking flow"
                  onClick={() => openView('booking-flow')}
                />
              )}
              <Row
                icon={Gift}
                iconColor="bg-teal-600"
                label="Smart Fit discounts"
                onClick={() => openView('smart-fit')}
                isLast
              />
            </Section>

            <Section title="Payments">
              <Row
                icon={CreditCard}
                iconColor="bg-emerald-600"
                label="Payments & taxes"
                value={
                  programsLoading
                    ? undefined
                    : paymentsForm.taxEnabled
                      ? `${paymentsForm.taxName.trim() || 'Tax'} ${paymentsForm.taxRatePercent || '0'}%`
                      : 'Tax off'
                }
                onClick={() => openView('payments')}
                isLast
              />
            </Section>

            {(hasEntitledModules || (onOpenApp && staffToolsAvailable)) && (
              <Section title="Team">
                {onOpenApp && staffToolsAvailable && (
                  <Row
                    icon={Users}
                    iconColor="bg-stone-600"
                    label="Staff & schedules"
                    onClick={() => openWorkspaceApp('staff')}
                    isLast={!(hasEntitledModules && visibilityEntitled)}
                  />
                )}
                {hasEntitledModules && visibilityEntitled && (
                  <Row
                    icon={Eye}
                    iconColor="bg-indigo-500"
                    label="Staff visibility"
                    onClick={() => openView('visibility')}
                    isLast
                  />
                )}
              </Section>
            )}

            <Section title="Notifications">
              <Row
                icon={Bell}
                iconColor="bg-red-500"
                label="Booking & cancellation alerts"
                onClick={() => openView('notifications')}
                isLast
              />
            </Section>

            <Section title="Communications">
              <Row
                icon={MessageSquare}
                iconColor="bg-[var(--owner-accent)]"
                label="Client texts & reminders"
                onClick={() => openView('communications')}
                isLast
              />
            </Section>

            <Section title="Features">
              <Row
                icon={Boxes}
                iconColor="bg-purple-500"
                label="Features & plan"
                onClick={() => openView('features')}
                isLast
              />
            </Section>

            {onOpenApp && (
              <Section
                title="Integrations"
                footer="Google Calendar, text messaging, and email are managed in the Integrations app."
              >
                <Row
                  icon={Plug}
                  iconColor="bg-[var(--owner-accent)]"
                  label="Manage integrations"
                  value="Calendar, text, email"
                  onClick={() => openWorkspaceApp('integrations')}
                  isLast
                />
              </Section>
            )}

            {/* Section: About */}
            <Section title="About">
              <Row label="Version" value="1.0.0" type="display" />
              <Row
                label="Terms of Service"
                onClick={() => router.push(`/${locale}/terms`)}
              />
              <Row
                label="Privacy Policy"
                onClick={() => router.push(`/${locale}/privacy`)}
                isLast
              />
            </Section>
          </>
        )}

        {view === 'location' && salonSlug && (
          <>
            {/*
              One address editor. This screen used to carry a second copy of
              the same five location fields writing the same
              `PATCH /api/admin/location` as Booking Page → Your Information →
              Location (source map §C1 row 1), with no address-privacy control
              beside it. The row stays; the editing goes to the canonical one.
            */}
            <Section
              title="Location, contact and hours"
              footer="Your address, city and how much of it clients can see are all edited in one place, together with your business name, contact details and hours."
            >
              <div className="space-y-3 p-4" data-testid="settings-location-handoff">
                <p className="text-sm text-[var(--owner-muted)]">
                  Your salon address is part of your business details in Booking
                  Page → Your Information.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (informationHubHref) {
                      router.push(informationHubHref);
                    }
                  }}
                  disabled={!informationHubHref}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--owner-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MapPin className="size-4" />
                  <span>Edit address &amp; privacy</span>
                </button>
              </div>
            </Section>
            <ParkingInstructionsCard
              salonSlug={salonSlug}
              onDirtyChange={setParkingDirty}
            />
          </>
        )}

        {view === 'branding' && (
          <>
            <Section
              title="Page themes"
              footer="Per-page themes for the client-facing pages. Your website's layout and colours live in Booking Page → Style & Colours."
            >
              <PageThemesSettings className="overflow-visible rounded-[10px] bg-[var(--owner-surface)]" />
            </Section>
            <Section
              title="Public booking experience"
              footer="These bounded controls customize booking and confirmation content without changing the site theme or email template."
            >
              <BookingExperienceEditor
                appearanceHref={appearanceHubHref}
                draft={bookingExperienceDraft}
                loading={bookingExperienceLoading}
                saving={bookingExperienceSaving}
                saved={bookingExperienceSaved}
                dirty={bookingExperienceDirty}
                error={bookingExperienceError}
                onChange={updateBookingExperienceDraft}
                onReset={() => {
                  const defaults = copyBookingExperience(
                    BOOKING_EXPERIENCE_DEFAULTS,
                  );
                  const next = {
                    ...bookingExperienceDraft,
                    // `primaryColor` is deliberately preserved: this screen no
                    // longer authors website colour, so Reset must not write it.
                    primaryColor: bookingExperienceDraft.primaryColor,
                    bookingMessage: defaults.bookingMessage,
                    socialLinks: { ...defaults.socialLinks },
                    confirmationMessage: defaults.confirmationMessage,
                  };
                  setBookingExperienceDraft(next);
                  setBookingExperienceDirty(
                    !bookingExperienceAppearancesMatch(
                      next,
                      savedBookingExperience,
                    ),
                  );
                  setBookingExperienceSaved(false);
                  setBookingExperienceError(null);
                }}
                onSave={() => void saveBookingExperience()}
              />
            </Section>
          </>
        )}

        {view === 'booking-policy' && (
          <Section
            title="Booking policy"
            footer="Acknowledgment records what a customer confirmed. It does not authorize deposits, card storage, cancellation fees, no-show charges, or automatic enforcement."
          >
            <BookingPolicyEditor
              draft={bookingExperienceDraft}
              loading={bookingExperienceLoading}
              hydrated={bookingExperienceHydrated}
              saving={bookingPolicySaving}
              saved={bookingPolicySaved}
              dirty={bookingPolicyDirty}
              error={bookingPolicyError}
              onChange={updateBookingPolicyDraft}
              onRetryLoad={() => void fetchPrograms()}
              onReset={() => {
                const defaults = copyBookingExperience(
                  BOOKING_EXPERIENCE_DEFAULTS,
                );
                const next = {
                  ...bookingExperienceDraft,
                  policy: {
                    ...defaults.policy,
                    // AG-02: Reset is a deliberate owner action, so it states
                    // the acknowledgment explicitly. Leaving it out made the
                    // server treat the save as a stale tab and merge the
                    // stored `required: true` back in, which re-enabled the
                    // very policy the owner was withdrawing.
                    acknowledgment: { required: false, text: null },
                  },
                  quickFacts: {
                    appointmentOnly: {
                      ...defaults.quickFacts.appointmentOnly,
                    },
                    depositNotice: {
                      ...defaults.quickFacts.depositNotice,
                    },
                    cancellationNotice: {
                      ...defaults.quickFacts.cancellationNotice,
                    },
                  },
                };
                setBookingExperienceDraft(next);
                setBookingPolicyDirty(
                  !bookingPoliciesMatch(next, savedBookingExperience),
                );
                setBookingPolicySaved(false);
                setBookingPolicyError(null);
              }}
              onSave={() => void saveBookingPolicy()}
            />
          </Section>
        )}

        {view === 'booking' && (
          <Section
            title="Booking Configuration"
            footer="These settings control slot spacing, internal booking buffer, and intro pricing defaults for this salon."
          >
            {bookingConfigLoading
              ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
                  </div>
                )
              : (
                  <div className="space-y-4 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                          Buffer minutes
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          step={5}
                          value={bookingConfigForm.bufferMinutes}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              bufferMinutes: Math.max(
                                0,
                                Math.min(
                                  60,
                                  Number.parseInt(event.target.value || '0', 10) || 0,
                                ),
                              ),
                            }))}
                          className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                          Slot interval
                        </span>
                        <select
                          value={bookingConfigForm.slotIntervalMinutes}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              slotIntervalMinutes: Number.parseInt(
                                event.target.value,
                                10,
                              ) as BookingConfigFormState['slotIntervalMinutes'],
                            }))}
                          className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                        >
                          {SLOT_INTERVAL_OPTIONS.map(option => (
                            <option key={option} value={option}>
                              {option}
                              {' '}
                              minutes
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                          Currency
                        </span>
                        <select
                          value={bookingConfigForm.currency}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              currency: event.target
                                .value as BookingConfigFormState['currency'],
                            }))}
                          className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                        >
                          {CURRENCY_OPTIONS.map(option => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                          Client change cutoff
                        </span>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            max={168}
                            step={1}
                            value={bookingConfigForm.clientChangeCutoffHours}
                            onChange={event =>
                              updateBookingConfigForm(prev => ({
                                ...prev,
                                clientChangeCutoffHours: Math.max(
                                  0,
                                  Math.min(
                                    168,
                                    Number.parseInt(event.target.value || '0', 10)
                                    || 0,
                                  ),
                                ),
                              }))}
                            className="h-11 w-full rounded-[10px] border border-[var(--owner-line)] px-3 pr-16 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-[var(--owner-muted)]">
                            hours
                          </span>
                        </div>
                        <span className="text-xs text-[var(--owner-muted)]">
                          Clients contact you inside this window. Use 0 to allow
                          changes anytime.
                        </span>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                          Minimum notice
                        </span>
                        <select
                          data-testid="minimum-notice-select"
                          value={showCustomMinimumNotice ? 'custom' : String(bookingConfigForm.minimumNoticeMinutes)}
                          onChange={(event) => {
                            if (event.target.value === 'custom') {
                              setMinimumNoticeCustom(true);
                              return;
                            }
                            setMinimumNoticeCustom(false);
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              minimumNoticeMinutes: Number.parseInt(event.target.value, 10),
                            }));
                          }}
                          className="h-11 rounded-[10px] border border-[var(--owner-line)] bg-[var(--owner-surface)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                        >
                          {MINIMUM_NOTICE_OPTIONS.map(option => (
                            <option key={option.minutes} value={option.minutes}>
                              {option.label}
                            </option>
                          ))}
                          <option value="custom">Custom</option>
                        </select>
                        {showCustomMinimumNotice && (
                          <div className="relative">
                            <input
                              type="number"
                              min={0}
                              max={525_600}
                              step={15}
                              aria-label="Minimum notice in minutes"
                              data-testid="minimum-notice-custom"
                              value={bookingConfigForm.minimumNoticeMinutes}
                              onChange={event =>
                                updateBookingConfigForm(prev => ({
                                  ...prev,
                                  minimumNoticeMinutes: Math.max(
                                    0,
                                    Math.min(
                                      525_600,
                                      Number.parseInt(event.target.value || '0', 10) || 0,
                                    ),
                                  ),
                                }))}
                              className="h-11 w-full rounded-[10px] border border-[var(--owner-line)] px-3 pr-20 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-[var(--owner-muted)]">
                              minutes
                            </span>
                          </div>
                        )}
                        <span className="text-xs text-[var(--owner-muted)]" data-testid="minimum-notice-current">
                          {`Now: ${formatMinimumNotice(bookingConfigForm.minimumNoticeMinutes)}. Clients cannot book a time closer than this — your public times start after it.`}
                        </span>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                          Timezone
                        </span>
                        {/* A typo here silently shifts every booking slot, so the
                            value is picked from the IANA list instead of typed. */}
                        <select
                          value={bookingConfigForm.timezone}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              timezone: event.target.value,
                            }))}
                          className="h-11 rounded-[10px] border border-[var(--owner-line)] bg-[var(--owner-surface)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                        >
                          {getTimeZoneOptions(bookingConfigForm.timezone).map(zone => (
                            <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                          Default intro label
                        </span>
                        <input
                          type="text"
                          value={bookingConfigForm.introPriceDefaultLabel}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              introPriceDefaultLabel: event.target.value,
                            }))}
                          className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                          placeholder="Founding Client Price"
                        />
                      </label>

                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3 sm:col-span-2">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                            First-visit offer
                          </span>
                          <p className="text-sm text-[var(--owner-muted)]">
                            Offer 25% off for first-time clients automatically during
                            booking.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={bookingConfigForm.firstVisitDiscountEnabled}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              firstVisitDiscountEnabled: event.target.checked,
                            }))}
                          className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                        />
                      </label>

                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3 sm:col-span-2">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                            Feature Luster Manicure
                          </span>
                          <p className="text-sm text-[var(--owner-muted)]">
                            Show your active Luster Manicure first in Featured
                            Services.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          data-testid="feature-luster-manicure-toggle"
                          checked={featureLusterManicure}
                          onChange={(event) => {
                            setFeatureLusterManicure(event.target.checked);
                            setBookingConfigDirty(true);
                            setBookingConfigSaved(false);
                          }}
                          className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                        />
                      </label>

                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3 sm:col-span-2">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                            Show service images
                          </span>
                          <p className="text-sm text-[var(--owner-muted)]">
                            Show uploaded service images on your public booking
                            page. Turning this off keeps uploads stored.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          data-testid="show-service-images-toggle"
                          checked={showServiceImages}
                          onChange={(event) => {
                            setShowServiceImages(event.target.checked);
                            setBookingConfigDirty(true);
                            setBookingConfigSaved(false);
                          }}
                          className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                        />
                      </label>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-[var(--owner-line)] pt-3">
                      <div className="text-xs text-[var(--owner-muted)]">
                        Applies to slot generation and intro badges when a service
                        does not define its own label.
                      </div>
                      <button
                        type="button"
                        onClick={() => void saveBookingConfig()}
                        disabled={bookingConfigSaving || !bookingConfigDirty}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="size-4" />
                        <span>
                          {bookingConfigSaving ? 'Saving...' : 'Save booking rules'}
                        </span>
                      </button>
                    </div>

                    {bookingConfigSaved && (
                      <div className="text-right text-xs font-medium text-green-600">
                        Booking rules saved.
                      </div>
                    )}
                  </div>
                )}
          </Section>
        )}

        {view === 'booking-flow' && !isFreeSolo && (
          <Section
            title="Booking Flow"
            footer="Customize the order of steps in your online booking flow."
          >
            {bookingFlowLoading
              ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
                  </div>
                )
              : (
                  <BookingFlowEditor
                    bookingFlowCustomizationEnabled={bookingFlowEnabled}
                    bookingFlow={bookingFlow}
                    onSave={handleBookingFlowSave}
                  />
                )}
          </Section>
        )}

        {view === 'smart-fit' && salonSlug && (
          <Section
            title="Smart Fit discounts"
            footer="Smart Fit only discounts times the server confirms improve your schedule. It never moves appointments, and existing bookings keep their original price."
          >
            <SmartFitSettingsCard
              salonSlug={salonSlug}
              onDirtyChange={setSmartFitDirty}
              onViewResults={onOpenApp && smartFitResultsAvailable
                ? () => onOpenApp('analytics')
                : undefined}
            />
          </Section>
        )}

        {view === 'payments' && (
          <>
            <Section
              title="Sales tax"
              footer="Tax calculations and estimates are based on the settings you enter. Your business is responsible for registration, rates, tax treatment, filing, and remittance. Luster does not provide tax or accounting advice and does not file taxes for you. Tax stays off until you turn it on; completed appointments keep their original tax snapshot."
            >
              {programsLoading
                ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
                    </div>
                  )
                : (
                    <div className="space-y-4 p-4">
                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                            Charge tax
                          </span>
                          <p className="text-sm text-[var(--owner-muted)]">
                            Add tax at checkout when completing appointments.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          data-testid="payments-tax-enabled"
                          checked={paymentsForm.taxEnabled}
                          onChange={event =>
                            updatePaymentsForm(prev => ({
                              ...prev,
                              taxEnabled: event.target.checked,
                            }))}
                          className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                        />
                      </label>

                      {paymentsForm.taxEnabled && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                              Tax name
                            </span>
                            <input
                              type="text"
                              data-testid="payments-tax-name"
                              value={paymentsForm.taxName}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  taxName: event.target.value,
                                }))}
                              placeholder="HST"
                              maxLength={40}
                              className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                            />
                          </label>

                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                              Tax rate
                            </span>
                            <div className="relative">
                              <input
                                type="text"
                                inputMode="decimal"
                                data-testid="payments-tax-rate"
                                value={paymentsForm.taxRatePercent}
                                onChange={event =>
                                  updatePaymentsForm(prev => ({
                                    ...prev,
                                    taxRatePercent: event.target.value.replace(/[^0-9.]/g, ''),
                                  }))}
                                placeholder="13"
                                className="h-11 w-full rounded-[10px] border border-[var(--owner-line)] px-3 pr-10 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-[var(--owner-muted)]">
                                %
                              </span>
                            </div>
                          </label>

                          <div className="rounded-[10px] border border-[var(--owner-line)] p-3 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                              Reporting jurisdiction
                            </span>
                            <div className="mt-2 grid gap-3 sm:grid-cols-3">
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-[var(--owner-muted)]">Jurisdiction label</span>
                                <input
                                  type="text"
                                  data-testid="payments-tax-jurisdiction"
                                  value={paymentsForm.taxJurisdiction}
                                  onChange={event =>
                                    updatePaymentsForm(prev => ({
                                      ...prev,
                                      taxJurisdiction: event.target.value,
                                    }))}
                                  placeholder="Ontario HST"
                                  maxLength={120}
                                  className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-[var(--owner-muted)]">Country code</span>
                                <input
                                  type="text"
                                  data-testid="payments-tax-country"
                                  value={paymentsForm.taxCountry}
                                  onChange={event =>
                                    updatePaymentsForm(prev => ({
                                      ...prev,
                                      taxCountry: event.target.value,
                                    }))}
                                  placeholder="CA"
                                  maxLength={120}
                                  className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] uppercase text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-[var(--owner-muted)]">Province / region code</span>
                                <input
                                  type="text"
                                  data-testid="payments-tax-region"
                                  value={paymentsForm.taxRegion}
                                  onChange={event =>
                                    updatePaymentsForm(prev => ({
                                      ...prev,
                                      taxRegion: event.target.value,
                                    }))}
                                  placeholder="ON"
                                  maxLength={120}
                                  className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] uppercase text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                                />
                              </label>
                            </div>
                            <p className="mt-2 text-xs text-[var(--owner-muted)]">
                              Used for reporting only. The reviewed Ontario estimate requires
                              Canada (CA) and Ontario (ON); other or missing locations report
                              forfeited deposits at their gross amount without an estimated tax component.
                            </p>
                          </div>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3 sm:col-span-2">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                                Estimate tax included in forfeited deposits
                              </span>
                              <p className="text-sm text-[var(--owner-muted)]">
                                Opt in to an estimated tax-inclusive component when a
                                collected deposit is retained. This is an estimate from
                                your settings, not a filing or remittance calculation.
                              </p>
                              <p className="text-xs text-[var(--owner-muted)]">
                                {hasReviewedForfeitureTaxTreatment({
                                  country: paymentsForm.taxCountry,
                                  region: paymentsForm.taxRegion,
                                })
                                  ? 'The entered Canada / Ontario jurisdiction is reviewed for this estimate.'
                                  : 'This jurisdiction is not reviewed; forfeitures remain gross-only even when opted in.'}
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              data-testid="payments-tax-forfeiture-estimate"
                              checked={paymentsForm.forfeitureTaxEstimationEnabled}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  forfeitureTaxEstimationEnabled: event.target.checked,
                                }))}
                              className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3 sm:col-span-2">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                                Prices include tax
                              </span>
                              <p className="text-sm text-[var(--owner-muted)]">
                                On: your listed prices already include tax. Off: tax is
                                added at checkout.
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              data-testid="payments-tax-inclusive"
                              checked={paymentsForm.pricesIncludeTax}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  pricesIncludeTax: event.target.checked,
                                }))}
                              className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                            />
                          </label>

                          <div className="rounded-[10px] border border-[var(--owner-line)] p-3 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                              Taxable by default
                            </span>
                            <div className="mt-2 space-y-2">
                              {([
                                ['taxServicesByDefault', 'Services'],
                                ['taxAddOnsByDefault', 'Add-ons'],
                                ['taxCustomByDefault', 'Custom items'],
                              ] as const).map(([key, label]) => (
                                <label key={key} className="flex items-center justify-between gap-3">
                                  <span className="text-sm text-[var(--owner-muted)]">{label}</span>
                                  <input
                                    type="checkbox"
                                    checked={paymentsForm[key]}
                                    onChange={event =>
                                      updatePaymentsForm(prev => ({
                                        ...prev,
                                        [key]: event.target.checked,
                                      }))}
                                    className="size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                                  />
                                </label>
                              ))}
                            </div>
                            <p className="mt-2 text-xs text-[var(--owner-muted)]">
                              You can still change tax on individual items at checkout.
                            </p>
                          </div>

                          <div className="rounded-[10px] border border-[var(--owner-line)] p-3 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                              Scheduled rate change
                            </span>
                            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-[var(--owner-muted)]">New rate</span>
                                <div className="relative">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    data-testid="payments-tax-scheduled-rate"
                                    value={paymentsForm.scheduledRatePercent}
                                    onChange={event =>
                                      updatePaymentsForm(prev => ({
                                        ...prev,
                                        scheduledRatePercent: event.target.value.replace(/[^0-9.]/g, ''),
                                      }))}
                                    placeholder="15"
                                    className="h-11 w-full rounded-[10px] border border-[var(--owner-line)] px-3 pr-10 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-[var(--owner-muted)]">
                                    %
                                  </span>
                                </div>
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-[var(--owner-muted)]">Effective from</span>
                                <input
                                  type="date"
                                  data-testid="payments-tax-scheduled-date"
                                  value={paymentsForm.scheduledEffectiveFrom}
                                  onChange={event =>
                                    updatePaymentsForm(prev => ({
                                      ...prev,
                                      scheduledEffectiveFrom: event.target.value,
                                    }))}
                                  className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                                />
                              </label>
                            </div>
                            <p className="mt-2 text-xs text-[var(--owner-muted)]">
                              Checkouts on or after this date use the new rate.
                              Appointments completed earlier keep the old rate. Leave
                              blank to cancel a scheduled change.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
            </Section>

            <Section
              title="Interac e-Transfer"
              footer="Manual instructions only — payments are confirmed by you when the transfer arrives. Luster never asks for or stores banking passwords, and cannot verify bank deposits."
            >
              {programsLoading
                ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
                    </div>
                  )
                : (
                    <div className="space-y-4 p-4">
                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                            Accept e-Transfer
                          </span>
                          <p className="text-sm text-[var(--owner-muted)]">
                            Show e-Transfer instructions at checkout.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          data-testid="payments-etransfer-enabled"
                          checked={paymentsForm.etransferEnabled}
                          onChange={event =>
                            updatePaymentsForm(prev => ({
                              ...prev,
                              etransferEnabled: event.target.checked,
                            }))}
                          className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                        />
                      </label>

                      {paymentsForm.etransferEnabled && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                              Recipient email or mobile
                            </span>
                            <input
                              type="text"
                              data-testid="payments-etransfer-recipient"
                              value={paymentsForm.etransferRecipient}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferRecipient: event.target.value,
                                }))}
                              placeholder="pay@yoursalon.ca"
                              maxLength={200}
                              className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                            />
                          </label>

                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                              Display name
                            </span>
                            <input
                              type="text"
                              value={paymentsForm.etransferRecipientName}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferRecipientName: event.target.value,
                                }))}
                              placeholder="Your salon name"
                              maxLength={120}
                              className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3 sm:col-span-2">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                                Autodeposit is on
                              </span>
                              <p className="text-sm text-[var(--owner-muted)]">
                                Informational only — shown to clients so they know no
                                security question is needed.
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              checked={paymentsForm.etransferAutodeposit}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferAutodeposit: event.target.checked,
                                }))}
                              className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                            />
                          </label>

                          <label className="flex flex-col gap-1 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                              Instructions
                            </span>
                            <textarea
                              value={paymentsForm.etransferInstructions}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferInstructions: event.target.value,
                                }))}
                              rows={3}
                              maxLength={1000}
                              placeholder="Please include the appointment reference in the message field."
                              className="rounded-[10px] border border-[var(--owner-line)] px-3 py-2 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                                Require reference
                              </span>
                              <p className="text-sm text-[var(--owner-muted)]">
                                Ask clients to include the appointment reference.
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              checked={paymentsForm.etransferRequireReference}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferRequireReference: event.target.checked,
                                }))}
                              className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                                Payment QR page
                              </span>
                              <p className="text-sm text-[var(--owner-muted)]">
                                Let clients scan a QR code that opens payment
                                instructions.
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              data-testid="payments-etransfer-qr"
                              checked={paymentsForm.etransferQrEnabled}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferQrEnabled: event.target.checked,
                                }))}
                              className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                            />
                          </label>
                        </div>
                      )}

                    </div>
                  )}
            </Section>

            <Section
              title="Deposits"
              footer="Deposits are salon-wide and a fixed amount. They are collected in Canadian dollars only."
            >
              {programsLoading
                ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
                    </div>
                  )
                : (
                    <div className="space-y-4 p-4">
                      {/*
                        TWO LAYERS. The launch gates are read off their OWN
                        booleans; the diagnostic reason is read off `reason`,
                        which by construction never carries either gate.
                      */}
                      <p
                        data-testid="deposits-status"
                        className="rounded-[10px] border border-[var(--owner-line)] bg-[var(--owner-ground)] p-3 text-sm text-[var(--owner-muted)]"
                      >
                        {depositPolicy === null
                          ? 'Checking your deposit setup...'
                          : depositPolicy.collectionLive === false
                            ? 'Deposits are not collected on Luster yet. Nothing here charges a client.'
                            : !depositPolicy.entitled
                                ? 'Deposits are not part of your plan yet, so nothing here charges a client.'
                                : depositPolicy.active
                                  ? 'Deposits are being collected on new bookings.'
                                  : (depositPolicy.reason
                                    && DEPOSIT_REASON_COPY[depositPolicy.reason])
                                    || 'Deposits are not being collected yet.'}
                      </p>

                      {/*
                        AG-more-settings-02: the card used to describe the
                        prerequisite only as "switched on for your salon", and
                        the API's reason was never surfaced. Name both gates,
                        say who acts on each, and say plainly that a saved
                        choice is not a collected deposit.
                      */}
                      {depositPolicy !== null && !depositPolicy.active && (
                        <div
                          data-testid="deposits-prerequisites"
                          className="space-y-2 rounded-[10px] border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-blush,#f6e7ec)] p-3 text-sm leading-6 text-[var(--owner-ink,#30262a)]"
                        >
                          <p className="font-semibold">
                            Two things have to be in place first
                          </p>
                          <ol className="list-decimal space-y-1 pl-5">
                            <li>
                              Deposits have to be enabled for your salon. Only
                              Luster can do that &mdash; ask support to turn
                              deposits on for your salon.
                            </li>
                            <li>
                              Your own payment account has to be connected, so
                              the deposit can be charged and paid out to you.
                              When deposits are enabled, that appears as
                              &ldquo;Payments&rdquo; in the Integrations app.
                            </li>
                          </ol>
                          <p>
                            Until both are done, what you set here is stored
                            and waits. No client is asked for a deposit and no
                            card is charged.
                          </p>
                        </div>
                      )}

                      {depositPolicy?.readinessStale && (
                        <p
                          data-testid="deposits-readiness-age"
                          className="text-xs text-[var(--owner-muted)]"
                        >
                          {depositPolicy.readinessAgeMs === null
                            ? 'Stripe status has not been confirmed yet.'
                            : `Stripe status last confirmed ${Math.max(1, Math.round(depositPolicy.readinessAgeMs / 3_600_000))} hours ago.`}
                        </p>
                      )}

                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--owner-line)] p-3">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                            Require a deposit
                          </span>
                          <p className="text-sm text-[var(--owner-muted)]">
                            {depositPolicy?.active
                              ? 'Clients are asked for this deposit as they book.'
                              : 'Records that you want a deposit. Clients are only asked for one once the steps above are done.'}
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          data-testid="deposits-enabled"
                          checked={depositEnabled}
                          onChange={(event) => {
                            setDepositEnabled(event.target.checked);
                            setDepositEnabledDirty(true);
                            setDepositSaved(false);
                          }}
                          className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                          Deposit amount
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          data-testid="deposits-amount"
                          value={depositAmountInput}
                          onChange={(event) => {
                            setDepositAmountInput(event.target.value);
                            setDepositAmountDirty(true);
                            setDepositSaved(false);
                          }}
                          className="rounded-[10px] border border-[var(--owner-line)] px-3 py-2 text-sm"
                        />
                      </label>

                      {depositAmountInput.trim() !== '' && (
                        <p data-testid="deposits-clamp-notice" className="text-xs text-[var(--owner-muted)]">
                          {depositCardNotices.clampNotice}
                        </p>
                      )}

                      {depositAmountExceedsRecommended && (
                        <p data-testid="deposits-recommended-max" className="text-xs text-amber-700">
                          {depositCardNotices.recommendedMaxNotice}
                        </p>
                      )}

                      {depositCopyWarning && (
                        <p data-testid="deposits-copy-warning" className="text-xs text-amber-700">
                          {depositCopyWarning}
                        </p>
                      )}

                      {depositError && (
                        <p data-testid="deposits-error" role="alert" className="text-xs text-red-600">
                          {depositError}
                        </p>
                      )}

                      <div className="flex items-center justify-end gap-3 border-t border-[var(--owner-line)] pt-3">
                        <button
                          type="button"
                          data-testid="deposits-save"
                          onClick={() => void saveDeposit()}
                          disabled={
                            depositSaving
                            || (!depositEnabledDirty && !depositAmountDirty)
                          }
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Save className="size-4" />
                          <span>{depositSaving ? 'Saving...' : 'Save deposits'}</span>
                        </button>
                      </div>

                      {depositSaved && (
                        <div className="text-right text-xs font-medium text-green-600">
                          Deposits saved.
                        </div>
                      )}
                    </div>
                  )}
            </Section>

            {/*
              AG-more-settings-03: this save commits the Sales tax and Interac
              e-Transfer cards together, so it belongs to the view, not to
              either card. It used to sit inside the e-Transfer card, where it
              read as the e-Transfer save and its label wrapped to three lines
              at 390 px. Deposits keep their own save, and the copy says so.
            */}
            {!programsLoading && (
              <div className="space-y-2 px-4 pb-8 pt-2">
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {paymentsSaved && (
                    <span
                      className="text-xs font-medium text-green-600"
                      role="status"
                    >
                      Tax and e-Transfer saved.
                    </span>
                  )}
                  <button
                    type="button"
                    data-testid="payments-save"
                    onClick={() => void savePayments()}
                    disabled={paymentsSaving || !paymentsDirty}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save className="size-4" />
                    <span className="whitespace-nowrap">
                      {paymentsSaving ? 'Saving…' : 'Save tax & e-Transfer'}
                    </span>
                  </button>
                </div>
                <p className="text-xs leading-5 text-[var(--owner-muted)]">
                  Saves the Sales tax and Interac e-Transfer cards. Deposits
                  save on their own button. Applies to new checkouts only —
                  completed appointments are never recalculated.
                </p>
              </div>
            )}
          </>
        )}

        {view === 'communications' && (
          <div className="space-y-6 px-4 pb-8 pt-2">
            {smsReadiness && (
              <div className="rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 text-sm" role="status">
                <p className="font-medium text-[var(--owner-ink)]">{smsReadiness.senderLabel}</p>
                <p className="mt-1 text-[var(--owner-muted)]">{smsReadiness.detail}</p>
                <p className="mt-1 text-[var(--owner-muted)]">{smsReadiness.availableCredits === null ? 'Luster SMS credit balance is unavailable. Contact support.' : `${smsReadiness.availableCredits} SMS credits available. See Usage for details.`}</p>
              </div>
            )}
            {/* Preferences stay editable while a provider is unavailable. */}
            <Section title="Channels">
              <div className="space-y-3 p-4">
                <label className="flex min-h-[44px] items-center justify-between gap-3">
                  <span className="text-[15px] text-[var(--owner-ink)]">Pause all communications</span>
                  <input
                    type="checkbox"
                    className="size-5 accent-rose-800"
                    checked={communicationsForm.killSwitch}
                    onChange={(event) => {
                      setCommunicationsForm(current => ({ ...current, killSwitch: event.target.checked }));
                      setCommunicationsDirty(true);
                    }}
                  />
                </label>
                <label className="flex min-h-[44px] items-center justify-between gap-3">
                  <span className="text-[15px] text-[var(--owner-ink)]">Email to clients</span>
                  <input
                    type="checkbox"
                    className="size-5 accent-rose-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
                    checked={communicationsForm.emailEnabled}
                    onChange={(event) => {
                      setCommunicationsForm(current => ({ ...current, emailEnabled: event.target.checked }));
                      setCommunicationsDirty(true);
                    }}
                  />
                </label>
                <label className="flex min-h-[44px] items-center justify-between gap-3">
                  <span className="text-[15px] text-[var(--owner-ink)]">
                    Text messages to clients
                  </span>
                  <input
                    type="checkbox"
                    className="size-5 accent-rose-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:opacity-40"
                    checked={communicationsForm.smsEnabled}
                    onChange={(event) => {
                      setCommunicationsForm(current => ({ ...current, smsEnabled: event.target.checked }));
                      setCommunicationsDirty(true);
                    }}
                  />
                </label>
                <p className="text-[13px] leading-snug text-[var(--owner-muted,#706267)]">
                  Email confirmations and reminders are included with every plan.
                  SMS access is included with every plan and uses Luster SMS credits.
                  New businesses receive 100 starter credits once.
                  You can save preferences while texting is paused or setup is incomplete.
                </p>
              </div>
            </Section>

            {/* Reminder rules — up to three, whole-list edited. */}
            <Section title="Appointment reminders">
              <div className="space-y-3 p-4">
                {communicationsForm.rules.length === 0 && (
                  <p className="text-[14px] text-[var(--owner-muted,#706267)]">
                    No scheduled reminders configured. Booking updates follow your channel preferences.
                  </p>
                )}
                {communicationsForm.rules.map((rule, index) => (
                  <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--owner-line)] p-3">
                    <input
                      type="checkbox"
                      aria-label={`Reminder ${index + 1} enabled`}
                      className="size-5 accent-rose-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
                      checked={rule.enabled}
                      onChange={(event) => {
                        setCommunicationsForm((current) => {
                          const rules = current.rules.map(entry =>
                            entry.id === rule.id ? { ...entry, enabled: event.target.checked } : entry);
                          return { ...current, rules };
                        });
                        setCommunicationsDirty(true);
                      }}
                    />
                    <select
                      aria-label={`Reminder ${index + 1} timing`}
                      className="h-9 rounded-md border border-[var(--owner-line)] bg-[var(--owner-surface)] px-2 text-[14px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 motion-reduce:transition-none"
                      value={String(rule.offsetMinutes)}
                      onChange={(event) => {
                        const offsetMinutes = Number(event.target.value);
                        setCommunicationsForm((current) => {
                          const rules = current.rules.map(entry =>
                            entry.id === rule.id ? { ...entry, offsetMinutes } : entry);
                          return { ...current, rules };
                        });
                        setCommunicationsDirty(true);
                      }}
                    >
                      <option value="120">2 hours before</option>
                      <option value="240">4 hours before</option>
                      <option value="1440">24 hours before</option>
                      <option value="2880">2 days before</option>
                      <option value="4320">3 days before</option>
                    </select>
                    <select
                      aria-label={`Reminder ${index + 1} channel`}
                      className="h-9 rounded-md border border-[var(--owner-line)] bg-[var(--owner-surface)] px-2 text-[14px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 motion-reduce:transition-none"
                      value={rule.channels}
                      onChange={(event) => {
                        const channels = event.target.value as 'sms' | 'email' | 'both';
                        setCommunicationsForm((current) => {
                          const rules = current.rules.map(entry =>
                            entry.id === rule.id ? { ...entry, channels } : entry);
                          return { ...current, rules };
                        });
                        setCommunicationsDirty(true);
                      }}
                    >
                      <option value="email">Email</option>
                      <option value="sms">Text</option>
                      <option value="both">Email &amp; text</option>
                    </select>
                    <button
                      type="button"
                      className="ml-auto text-[14px] text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
                      onClick={() => {
                        setCommunicationsForm(current => ({
                          ...current,
                          rules: current.rules.filter(entry => entry.id !== rule.id),
                        }));
                        setCommunicationsDirty(true);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {communicationsForm.rules.length < 3 && (
                  <button
                    type="button"
                    className="text-[14px] font-medium text-[var(--owner-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
                    onClick={() => {
                      setCommunicationsForm(current => ({
                        ...current,
                        rules: [
                          ...current.rules,
                          {
                            id: `crule_${crypto.randomUUID()}`,
                            offsetMinutes: [120, 240, 1440, 2880, 4320].find(offset => !current.rules.some(rule => rule.enabled && rule.offsetMinutes === offset)) ?? 4320,
                            channels: 'email' as const,
                            enabled: true,
                          },
                        ],
                      }));
                      setCommunicationsDirty(true);
                    }}
                  >
                    + Add reminder
                  </button>
                )}
              </div>
            </Section>

            {/* Quiet hours */}
            <Section title="Quiet hours">
              <div className="space-y-3 p-4">
                <label className="flex min-h-[44px] items-center justify-between gap-3">
                  <span className="text-[15px] text-[var(--owner-ink)]">Hold texts overnight</span>
                  <input
                    type="checkbox"
                    className="size-5 accent-rose-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
                    checked={communicationsForm.quietHours.enabled}
                    onChange={(event) => {
                      setCommunicationsForm(current => ({
                        ...current,
                        quietHours: { ...current.quietHours, enabled: event.target.checked },
                      }));
                      setCommunicationsDirty(true);
                    }}
                  />
                </label>
                {communicationsForm.quietHours.enabled && (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-[14px] text-[var(--owner-ink)]">
                      From
                      <input
                        type="time"
                        aria-label="Quiet hours start"
                        className="h-9 rounded-md border border-[var(--owner-line)] px-2 text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
                        value={communicationsForm.quietHours.start}
                        onChange={(event) => {
                          setCommunicationsForm(current => ({
                            ...current,
                            quietHours: { ...current.quietHours, start: event.target.value },
                          }));
                          setCommunicationsDirty(true);
                        }}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[14px] text-[var(--owner-ink)]">
                      to
                      <input
                        type="time"
                        aria-label="Quiet hours end"
                        className="h-9 rounded-md border border-[var(--owner-line)] px-2 text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
                        value={communicationsForm.quietHours.end}
                        onChange={(event) => {
                          setCommunicationsForm(current => ({
                            ...current,
                            quietHours: { ...current.quietHours, end: event.target.value },
                          }));
                          setCommunicationsDirty(true);
                        }}
                      />
                    </label>
                  </div>
                )}
                <p className="text-[13px] leading-snug text-[var(--owner-muted,#706267)]">
                  Scheduled reminders and manual texts wait until quiet hours end, using your salon’s timezone.
                  Initial booking confirmations and request receipts still send right away.
                </p>
              </div>
            </Section>

            {/* Save */}
            <div className="flex items-center gap-3 px-1">
              <button
                type="button"
                onClick={saveCommunications}
                disabled={communicationsSaving || !communicationsDirty}
                className="rounded-lg bg-[var(--owner-accent)] px-4 py-2 text-[15px] font-medium text-white transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:opacity-40 motion-reduce:transition-none"
              >
                {communicationsSaving ? 'Saving…' : 'Save communication settings'}
              </button>
              <span role="status" aria-live="polite" className="text-[13px] text-[var(--owner-muted,#706267)]">
                {communicationsSaved ? 'Saved' : ''}
                {communicationsError ?? ''}
              </span>
            </div>
          </div>
        )}

        {view === 'notifications' && (
          <Section
            title="Notifications"
            footer="Control who gets notified when bookings are created or cancelled. Client confirmations still send separately."
          >
            {programsLoading
              ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
                  </div>
                )
              : (
                  <div className="space-y-4 p-4">
                    {(
                      [
                        {
                          key: 'newBooking',
                          title: 'New booking alerts',
                          subtitle:
                        'Notify your team when a client books successfully.',
                          technicianDescription:
                        'Send a new-booking alert to the artist assigned to the appointment.',
                        },
                        {
                          key: 'appointmentCancelled',
                          title: 'Cancellation alerts',
                          subtitle:
                        'Notify your team when an appointment is cancelled or marked as no-show.',
                          technicianDescription:
                        'Send a cancellation alert to the artist assigned to the appointment.',
                        },
                      ] as const
                    ).map((notificationEvent) => {
                      const eventForm
                    = bookingNotificationsForm[notificationEvent.key];

                      return (
                        <div
                          key={notificationEvent.key}
                          className="space-y-3 rounded-[14px] border border-[var(--owner-line)] bg-[var(--owner-ground)] p-3"
                        >
                          <div className="space-y-1 px-1">
                            <div className="text-sm font-semibold text-[var(--owner-ink,#30262a)]">
                              {notificationEvent.title}
                            </div>
                            <p className="text-xs text-[var(--owner-muted)]">
                              {notificationEvent.subtitle}
                            </p>
                          </div>

                          <div className="rounded-[12px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Bell className="size-4 text-red-600" />
                                  <span className="text-sm font-semibold text-[var(--owner-ink,#30262a)]">
                                    Notify assigned technician
                                  </span>
                                </div>
                                <p className="text-sm text-[var(--owner-muted)]">
                                  {notificationEvent.technicianDescription}
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                checked={eventForm.technicianEnabled}
                                onChange={event =>
                                  updateBookingNotificationEvent(
                                    notificationEvent.key,
                                    {
                                      technicianEnabled: event.target.checked,
                                    },
                                  )}
                                className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                                aria-label={`Notify assigned technician for ${notificationEvent.title.toLowerCase()}`}
                              />
                            </div>

                            <label className="mt-3 flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                                Channel
                              </span>
                              <select
                                value={eventForm.technicianChannel}
                                onChange={event =>
                                  updateBookingNotificationEvent(
                                    notificationEvent.key,
                                    {
                                      technicianChannel: event.target
                                        .value as BookingNotificationChannel,
                                    },
                                  )}
                                disabled={!eventForm.technicianEnabled}
                                className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)] disabled:cursor-not-allowed disabled:bg-[var(--owner-ground)] disabled:text-[var(--owner-muted)]"
                                aria-label={`Technician notification channel for ${notificationEvent.title.toLowerCase()}`}
                              >
                                {BOOKING_NOTIFICATION_CHANNEL_OPTIONS.map(
                                  (option) => {
                                    const smsUnavailable
                                  = option.value === 'sms'
                                  || option.value === 'both'
                                    ? !bookingNotificationCapabilities.smsChannelAvailable
                                    : false;
                                    const emailUnavailable
                                  = option.value === 'email'
                                  || option.value === 'both'
                                    ? !bookingNotificationCapabilities.emailChannelAvailable
                                    : false;
                                    const disabled
                                  = smsUnavailable || emailUnavailable;

                                    return (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                        disabled={disabled}
                                      >
                                        {option.label}
                                        {disabled ? ' (Unavailable)' : ''}
                                      </option>
                                    );
                                  },
                                )}
                              </select>
                            </label>

                            <p className="mt-2 text-xs text-[var(--owner-muted)]">
                              Technician email alerts require an email on each
                              technician profile.
                            </p>
                          </div>

                          <div className="rounded-[12px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <User className="size-4 text-[var(--owner-accent)]" />
                                  <span className="text-sm font-semibold text-[var(--owner-ink,#30262a)]">
                                    Notify salon owner
                                  </span>
                                </div>
                                <p className="text-sm text-[var(--owner-muted)]">
                                  Text the owner phone saved on the salon record.
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                checked={eventForm.ownerEnabled}
                                onChange={event =>
                                  updateBookingNotificationEvent(
                                    notificationEvent.key,
                                    {
                                      ownerEnabled: event.target.checked,
                                    },
                                  )}
                                className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                                aria-label={`Notify salon owner for ${notificationEvent.title.toLowerCase()}`}
                              />
                            </div>

                            <label className="mt-3 flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                                Channel
                              </span>
                              <select
                                value="sms"
                                onChange={event =>
                                  updateBookingNotificationEvent(
                                    notificationEvent.key,
                                    {
                                      ownerChannel: event.target
                                        .value as BookingNotificationChannel,
                                    },
                                  )}
                                disabled={!eventForm.ownerEnabled}
                                className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)] disabled:cursor-not-allowed disabled:bg-[var(--owner-ground)] disabled:text-[var(--owner-muted)]"
                                aria-label={`Owner notification channel for ${notificationEvent.title.toLowerCase()}`}
                              >
                                {OWNER_NOTIFICATION_CHANNEL_OPTIONS.map((option) => {
                                  const disabled
                                    = !bookingNotificationCapabilities.smsChannelAvailable
                                    || !bookingNotificationCapabilities.ownerPhonePresent;

                                  return (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                      disabled={disabled}
                                    >
                                      {option.label}
                                      {disabled ? ' (Unavailable)' : ''}
                                    </option>
                                  );
                                })}
                              </select>
                            </label>

                            <p className="mt-2 text-xs text-[var(--owner-muted)]">
                              Owner emails now live in Appointment notifications
                              below.
                            </p>
                          </div>
                        </div>
                      );
                    })}

                    {!bookingNotificationCapabilities.ownerPhonePresent && (
                      <div className="flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" />
                        <div>
                          Owner text alerts use the owner phone on the salon
                          record, and it is missing.
                        </div>
                      </div>
                    )}

                    {(!bookingNotificationCapabilities.smsChannelAvailable
                      || !bookingNotificationCapabilities.emailChannelAvailable) && (
                      <div className="rounded-[10px] border border-dashed border-[var(--owner-line)] bg-[var(--owner-ground)] px-3 py-2 text-xs text-[var(--owner-muted)]">
                        {!bookingNotificationCapabilities.smsChannelAvailable && (
                          <div>
                            SMS alerts need a configured texting identity and message worker.
                            Enable Text messages to clients in Client texts & reminders to send them.
                          </div>
                        )}
                        {!bookingNotificationCapabilities.emailChannelAvailable && (
                          <div>
                            Email alerts are unavailable until Resend is configured.
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3 border-t border-[var(--owner-line)] pt-3">
                      <div className="text-xs text-[var(--owner-muted)]">
                        Duplicate owner and technician destinations are deduplicated
                        automatically per channel.
                      </div>
                      <button
                        type="button"
                        onClick={() => void saveBookingNotifications()}
                        disabled={bookingNotificationsSaving || !notificationsDirty}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="size-4" />
                        <span>
                          {bookingNotificationsSaving ? 'Saving...' : 'Save alerts'}
                        </span>
                      </button>
                    </div>

                    <div className="space-y-3 rounded-[14px] border border-[var(--owner-line)] bg-[var(--owner-ground)] p-3">
                      <div className="space-y-1 px-1">
                        <div className="text-sm font-semibold text-[var(--owner-ink,#30262a)]">
                          Appointment notifications
                        </div>
                        <p className="text-xs text-[var(--owner-muted)]">
                          Detailed emails to the salon when a client books,
                          reschedules, or cancels. Separate from the confirmation
                          and reminder emails your clients receive.
                        </p>
                      </div>

                      <div className="space-y-2 rounded-[12px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-3">
                        {SALON_EMAIL_NOTIFICATION_EVENT_OPTIONS.map(option => (
                          <div
                            key={option.key}
                            className="flex items-start justify-between gap-3"
                          >
                            <div className="space-y-0.5">
                              <span className="text-sm font-semibold text-[var(--owner-ink,#30262a)]">
                                {option.label}
                              </span>
                              <p className="text-sm text-[var(--owner-muted)]">
                                {option.description}
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              checked={salonEmailNotificationsForm[option.key]}
                              onChange={event =>
                                updateSalonEmailNotifications({
                                  [option.key]: event.target.checked,
                                })}
                              className="mt-1 size-4 rounded border-gray-300 text-[var(--owner-accent)] focus:ring-[var(--owner-focus)]"
                              aria-label={option.label}
                            />
                          </div>
                        ))}

                        <label className="flex flex-col gap-1 pt-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                            Send notifications to
                          </span>
                          <input
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            placeholder="salon@example.com"
                            value={salonEmailNotificationsForm.recipientEmail}
                            onChange={event =>
                              updateSalonEmailNotifications({
                                recipientEmail: event.target.value,
                              })}
                            className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                            aria-label="Salon notification email address"
                          />
                        </label>

                        {salonNotificationRecipient.missing
                          ? (
                              <div className="flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                                <div>
                                  No valid notification email is configured, so these
                                  alerts cannot be delivered. Bookings still work
                                  normally.
                                </div>
                              </div>
                            )
                          : salonNotificationRecipient.email && (
                            <p className="text-xs text-[var(--owner-muted)]">
                              {`Sending to ${salonNotificationRecipient.email}`}
                              {salonNotificationRecipient.source
                              && ` (${SALON_NOTIFICATION_RECIPIENT_SOURCE_LABEL[salonNotificationRecipient.source]})`}
                              .
                            </p>
                          )}

                        {salonEmailNotificationsError && (
                          <p className="text-xs text-red-600">
                            {salonEmailNotificationsError}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-3 border-t border-[var(--owner-line)] pt-3">
                        <div className="text-xs text-[var(--owner-muted)]">
                          {salonEmailNotificationsSaved
                            ? 'Appointment notifications saved.'
                            : 'Leave the address blank to use the salon’s owner email.'}
                        </div>
                        <button
                          type="button"
                          onClick={() => void saveSalonEmailNotifications()}
                          disabled={
                            salonEmailNotificationsSaving
                            || !salonEmailNotificationsDirty
                          }
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Save className="size-4" />
                          <span>
                            {salonEmailNotificationsSaving
                              ? 'Saving...'
                              : 'Save notifications'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {bookingNotificationsSaved && (
                      <div className="text-right text-xs font-medium text-green-600">
                        Notification settings saved.
                      </div>
                    )}
                  </div>
                )}
          </Section>
        )}

        {view === 'features' && (
          <>
            {/* Modules (Step 16.3) */}
            <Section
              title="Modules"
              footer="Enable or disable features for your salon. Disabled modules won't be available to staff. Locked features are not included in your current plan yet."
            >
              {modulesLoading
                ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
                    </div>
                  )
                : (
                    <>
                      {MODULE_GROUPS.map((group, groupIndex) => {
                        const isLastGroup
                          = groupIndex === MODULE_GROUPS.length - 1;
                        return (
                          <div key={group.title}>
                            <div className="border-b border-[var(--owner-line)] px-4 py-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                                {group.title}
                              </span>
                            </div>
                            {group.modules.map((module, moduleIndex) => {
                              const isLastRow = isLastGroup
                                && moduleIndex === group.modules.length - 1;
                              const Icon = module.icon;

                              if (module.key === 'smsReminders') {
                                return (
                                  <button
                                    key={module.key}
                                    type="button"
                                    data-testid="settings-sms-communications"
                                    onClick={() => openView('communications')}
                                    className="flex min-h-11 w-full items-center gap-3 border-b border-[var(--owner-line)] px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus)]"
                                  >
                                    <MessageSquare aria-hidden="true" className="size-4 shrink-0 text-[var(--owner-accent)]" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-[16px] text-[var(--owner-ink)]">SMS texts &amp; reminders</span>
                                      <span className="block text-[12px] text-[var(--owner-muted)]">Included on every plan · Uses SMS credits</span>
                                      <span className="block text-[12px] text-[var(--owner-muted)]">Manage preferences in Client communications</span>
                                    </span>
                                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[var(--owner-muted)]" />
                                  </button>
                                );
                              }

                              // Entitled -> a live toggle. Not entitled -> a
                              // locked row naming the reason, so the category
                              // never renders with nothing under it and the
                              // owner can see what a higher plan unlocks.
                              return entitledModules[module.key]
                                ? (
                                    <ModuleRow
                                      key={module.key}
                                      icon={Icon}
                                      iconColor={module.iconColor}
                                      label={module.label}
                                      moduleKey={module.key}
                                      enabled={modules[module.key]}
                                      entitled
                                      onToggle={handleModuleToggle}
                                      isLast={isLastRow}
                                    />
                                  )
                                : (
                                    <LockedFeatureRow
                                      key={module.key}
                                      name={module.label}
                                      reasonCode={moduleReasons[module.key]}
                                      isLast={isLastRow}
                                    />
                                  );
                            })}
                          </div>
                        );
                      })}

                      {modulesSaving && (
                        <div className="flex items-center justify-center py-2 text-xs text-[var(--owner-muted)]">
                          Saving...
                        </div>
                      )}
                    </>
                  )}
            </Section>

            {/* Programs (Step 21E) */}
            {hasClientPrograms && (
              <Section
                title="Programs"
                footer="Control reviews and rewards programs. Referral and review rewards are fixed platform offers; visit-earned points stay active."
              >
                {programsLoading
                  ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
                      </div>
                    )
                  : (
                      <>
                        {/* Program Toggles */}
                        <Row
                          icon={MessageSquare}
                          iconColor="bg-purple-500"
                          label="Reviews"
                          type="toggle"
                          defaultOn={reviewsEnabled}
                          onToggle={(value) => {
                            setReviewsEnabled(value);
                            saveProgramToggle('reviewsEnabled', value);
                          }}
                        />
                        <Row
                          icon={Gift}
                          iconColor="bg-green-500"
                          label="Rewards Program"
                          type="toggle"
                          defaultOn={rewardsEnabledProgram}
                          onToggle={(value) => {
                            setRewardsEnabledProgram(value);
                            saveProgramToggle('rewardsEnabled', value);
                          }}
                          isLast
                        />

                        <div className="border-t border-[var(--owner-line)] px-4 py-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                            Active Offers
                          </div>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-[var(--owner-muted)]">Referral reward</span>
                              <span className="font-medium text-[var(--owner-ink)]">
                                $10 for the referrer
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--owner-muted)]">Friend offer</span>
                              <span className="font-medium text-[var(--owner-ink)]">
                                $10 off first appointment
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--owner-muted)]">
                                Google review reward
                              </span>
                              <span className="font-medium text-[var(--owner-ink)]">
                                $10 off (manual grant)
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--owner-muted)]">Visit earning</span>
                              <span className="font-medium text-[var(--owner-ink)]">
                                20 points per $1 spent
                              </span>
                            </div>
                          </div>
                        </div>

                        {programsSaving && (
                          <div className="flex items-center justify-center py-2 text-xs text-[var(--owner-muted)]">
                            Saving...
                          </div>
                        )}
                      </>
                    )}
              </Section>
            )}
          </>
        )}

        {view === 'visibility' && hasEntitledModules && visibilityEntitled && (
          <Section
            title="Staff Visibility"
            footer="Control what information staff can see in their dashboard. Changes take effect immediately."
          >
            {visibilityLoading
              ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
                  </div>
                )
              : (
                  <>
                    <Row
                      icon={Eye}
                      iconColor="bg-[var(--owner-accent)]"
                      label="Client Phone"
                      type="toggle"
                      defaultOn={visibility.staff?.showClientPhone ?? true}
                      onToggle={value =>
                        handleVisibilityToggle('showClientPhone', value)}
                    />
                    <Row
                      label="Client Full Name"
                      type="toggle"
                      defaultOn={visibility.staff?.showClientFullName ?? true}
                      onToggle={value =>
                        handleVisibilityToggle('showClientFullName', value)}
                    />
                    <Row
                      label="Client Email"
                      type="toggle"
                      defaultOn={visibility.staff?.showClientEmail ?? false}
                      onToggle={value =>
                        handleVisibilityToggle('showClientEmail', value)}
                    />
                    <Row
                      label="Appointment Price"
                      type="toggle"
                      defaultOn={visibility.staff?.showAppointmentPrice ?? true}
                      onToggle={value =>
                        handleVisibilityToggle('showAppointmentPrice', value)}
                    />
                    <Row
                      label="Client History"
                      type="toggle"
                      defaultOn={visibility.staff?.showClientHistory ?? false}
                      onToggle={value =>
                        handleVisibilityToggle('showClientHistory', value)}
                    />
                    <Row
                      label="Client Notes"
                      type="toggle"
                      defaultOn={visibility.staff?.showClientNotes ?? true}
                      onToggle={value =>
                        handleVisibilityToggle('showClientNotes', value)}
                    />
                    <Row
                      label="Other Tech Appointments"
                      type="toggle"
                      defaultOn={
                        visibility.staff?.showOtherTechAppointments ?? false
                      }
                      onToggle={value =>
                        handleVisibilityToggle(
                          'showOtherTechAppointments',
                          value,
                        )}
                      isLast
                    />
                    {visibilitySaving && (
                      <div className="flex items-center justify-center py-2 text-xs text-[var(--owner-muted)]">
                        Saving...
                      </div>
                    )}
                  </>
                )}
          </Section>
        )}

        {view === 'account' && (
          <>
            <Section
              title="Owner profile"
              footer="Your name appears in the workspace header and on decision logs. Your email signs you in and receives owner alerts, so it is changed by support rather than here."
            >
              <div className="space-y-3 p-4">
                {profileError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{profileError}</span>
                  </div>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                    Name
                  </span>
                  <input
                    type="text"
                    value={profileName}
                    maxLength={100}
                    onChange={(event) => {
                      setProfileName(event.target.value);
                      setProfileDirty(true);
                      setProfileSaved(false);
                    }}
                    className="h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                    Email
                  </span>
                  <input
                    type="email"
                    value={profileEmail}
                    readOnly={profileEmailLocked}
                    aria-readonly={profileEmailLocked}
                    aria-describedby="owner-profile-email-help"
                    onChange={(event) => {
                      if (profileEmailLocked) {
                        return;
                      }
                      setProfileEmail(event.target.value);
                      setProfileDirty(true);
                      setProfileSaved(false);
                    }}
                    className={`h-11 rounded-[10px] border border-[var(--owner-line)] px-3 text-[15px] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)] ${
                      profileEmailLocked
                        ? 'bg-[var(--owner-ground)] text-[var(--owner-muted)]'
                        : 'text-[var(--owner-ink)]'
                    }`}
                    placeholder={
                      profileLoading ? 'Loading…' : 'you@example.com'
                    }
                  />
                  <span
                    id="owner-profile-email-help"
                    className="text-xs text-[var(--owner-muted)]"
                  >
                    {profileEmailLocked
                      ? 'Your sign-in email is managed by your account — contact support to change it. Your name saves on its own.'
                      : 'This address signs you in and receives owner alerts. Once saved it can only be changed by contacting support.'}
                  </span>
                </label>
                <div className="flex items-center justify-end gap-3">
                  {profileSaved && !profileError && (
                    <span className="text-xs font-medium text-green-600">
                      Profile saved.
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveProfile()}
                    disabled={
                      profileSaving
                      || !profileDirty
                      || !profileName.trim()
                      || (!profileEmailLocked && !profileEmail.includes('@'))
                    }
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save className="size-4" />
                    <span>{profileSaving ? 'Saving...' : 'Save profile'}</span>
                  </button>
                </div>
              </div>
            </Section>

            <Section
              title="Plan & billing"
              footer={
                billingMode === 'STRIPE'
                  ? 'Manage billing opens the secure Stripe portal to update payment details, view invoices, or cancel.'
                  : 'This salon is billed offline. Contact Luster to change plans.'
              }
            >
              <div className="space-y-3 p-4">
                {/* Billing status (read-only, moved from Programs) */}
                {billingMode === 'STRIPE'
                  ? (
                      <div className="flex items-center gap-2">
                        <div
                          className={`size-2 rounded-full ${subscriptionStatus === 'active' ? 'bg-green-500' : 'bg-amber-500'}`}
                        />
                        <span className="text-sm text-[var(--owner-ink)]">
                          Stripe Billing
                          {subscriptionStatus
                            ? ` (${subscriptionStatus})`
                            : ''}
                        </span>
                      </div>
                    )
                  : (
                      <div className="flex items-center gap-2">
                        <div className="size-2 rounded-full bg-gray-400" />
                        <span className="text-sm text-[var(--owner-muted)]">
                          Cash / Offline billing enabled
                        </span>
                      </div>
                    )}

                {portalError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{portalError}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {billingMode === 'STRIPE' && salonId && (
                    <button
                      type="button"
                      onClick={() => void openBillingPortal()}
                      disabled={portalOpening}
                      data-testid="manage-billing-button"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CreditCard className="size-4" />
                      <span>{portalOpening ? 'Opening…' : 'Manage billing'}</span>
                    </button>
                  )}
                  {!isFreeSolo && (
                    <button
                      type="button"
                      onClick={() => setShowComparePlans(true)}
                      className="rounded-[10px] bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
                    >
                      Compare Plans
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowUsageBilling(true)}
                    className="rounded-[10px] border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 motion-reduce:transition-none"
                  >
                    Usage & billing
                  </button>
                </div>
              </div>
            </Section>
          </>
        )}
      </div>

      {/* Usage & billing (Gate C4) */}
      {showUsageBilling && salonSlug && (
        <UsageBillingModal
          salonSlug={salonSlug}
          onClose={() => setShowUsageBilling(false)}
        />
      )}

      {/* Compare Plans Modal (Step 19) */}
      <ComparePlansModal
        isOpen={showComparePlans}
        onClose={() => setShowComparePlans(false)}
      />
    </div>
  );
}

// Export sub-components for reuse
export { ParkingInstructionsCard, ProfileCard, Row, Section };
