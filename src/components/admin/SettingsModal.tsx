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
  Check,
  ChevronRight,
  CreditCard,
  Eye,
  Facebook,
  Flag,
  Gift,
  Instagram,
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
import { useParams, useRouter } from 'next/navigation';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react';

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
import type { ResolvedLoyaltyPoints } from '@/libs/loyalty';
import { hasReviewedForfeitureTaxTreatment } from '@/libs/taxConfig';
import { getDateKeyInTimeZone } from '@/libs/timeZone';
import { useSalon } from '@/providers/SalonProvider';
import type {
  BookingExperience,
  ModuleKey,
  ResolvedModules,
  ResolvedSubscriptionFeatureEntitlement,
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
        <div className="mb-2 px-4 text-[13px] uppercase tracking-wide text-gray-500">
          {title}
        </div>
      )}
      <div className="mx-4 overflow-visible rounded-[10px] border border-gray-200/50 bg-white shadow-sm">
        {children}
      </div>
      {footer && (
        <div className="mt-2 px-8 text-[12px] leading-snug text-gray-500">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * Settings Row
 */
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
  iconColor = 'bg-gray-500',
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
      className={`flex min-h-[48px] items-center pl-4 transition-colors ${type === 'display' ? '' : 'cursor-pointer active:bg-gray-50'}`}
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
        <div
          className={`mr-3 flex size-7 items-center justify-center rounded-[6px] text-white shadow-sm ${iconColor}`}
        >
          <Icon className="size-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between py-3 pr-4 ${
          !isLast ? 'border-b border-gray-100' : ''
        }`}
      >
        <span className="text-[16px] tracking-tight text-black">{label}</span>

        <div className="flex items-center gap-2">
          {value && <span className="text-[16px] text-[#8E8E93]">{value}</span>}

          {type === 'link' && (
            <ChevronRight className="size-4 text-[#C7C7CC]" />
          )}

          {type === 'toggle' && (
            <button
              type="button"
              onClick={handleToggle}
              aria-label={`Toggle ${label}`}
              className={`
                relative h-[31px] w-[51px] rounded-full p-0.5 transition-colors duration-300
                ${isOn ? 'bg-rose-800' : 'bg-[#E9E9EA]'}
              `}
            >
              <motion.div
                animate={{ x: isOn ? 20 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="size-[27px] rounded-full bg-white shadow-md"
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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
  iconColor = 'bg-gray-500',
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
      className={`flex min-h-[48px] items-center pl-4 ${entitled ? '' : 'opacity-60'}`}
    >
      {/* Icon */}
      {Icon && (
        <div
          className={`mr-3 flex size-7 items-center justify-center rounded-[6px] text-white shadow-sm ${iconColor}`}
        >
          <Icon className="size-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between py-3 pr-4 ${
          !isLast ? 'border-b border-gray-100' : ''
        }`}
      >
        <div className="flex flex-col">
          <span className="text-[16px] tracking-tight text-black">{label}</span>
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
            className={`
              relative h-[31px] w-[51px] rounded-full p-0.5 transition-colors duration-300
              ${!entitled ? 'cursor-not-allowed' : 'cursor-pointer'}
              ${enabled && entitled ? 'bg-rose-800' : 'bg-[#E9E9EA]'}
            `}
          >
            <motion.div
              animate={{ x: enabled && entitled ? 20 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="size-[27px] rounded-full bg-white shadow-md"
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
        <div className="text-[20px] font-normal text-[#1C1C1E]">{name}</div>
        <div className="text-[13px] text-gray-500">{subtitle}</div>
      </div>
      <ChevronRight className="size-5 text-[#C7C7CC]" />
    </button>
  );
}

type DirectionsLocationFormState = {
  id: string | null;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
};

function DirectionsLocationSection({
  salonSlug,
  onDirtyChange,
}: {
  salonSlug: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [locationCount, setLocationCount] = useState(0);
  const [isPrimaryFallback, setIsPrimaryFallback] = useState(false);
  const [form, setForm] = useState<DirectionsLocationFormState>({
    id: null,
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
  });

  const markDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirtyChange?.(value);
    },
    [onDirtyChange],
  );

  const fetchLocation = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/location?salonSlug=${encodeURIComponent(salonSlug)}`,
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          body?.error?.message || 'Failed to load location settings',
        );
      }

      const location = body?.data?.location;
      const salonName = body?.data?.salon?.name || '';

      setLocationCount(body?.data?.salon?.locationCount || 0);
      setIsPrimaryFallback(Boolean(body?.data?.isPrimaryFallback));
      setForm({
        id: location?.id ?? null,
        name: location?.name ?? salonName,
        address: location?.address ?? '',
        city: location?.city ?? '',
        state: location?.state ?? '',
        zipCode: location?.zipCode ?? '',
      });
      markDirty(false);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : 'Failed to load location settings',
      );
    } finally {
      setLoading(false);
    }
  }, [salonSlug, markDirty]);

  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  useEffect(() => {
    if (!saved) {
      return undefined;
    }

    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const handleChange = (
    field: keyof DirectionsLocationFormState,
    value: string,
  ) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setSaved(false);
    markDirty(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || saving) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/location?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name,
            address: form.address,
            city: form.city,
            state: form.state,
            zipCode: form.zipCode,
          }),
        },
      );

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body?.error?.message || 'Failed to save location settings',
        );
      }

      const location = body?.data?.location;
      setLocationCount(body?.data?.locationCount || locationCount);
      setIsPrimaryFallback(false);
      setForm(prev => ({
        ...prev,
        id: location?.id ?? prev.id,
        name: location?.name ?? prev.name,
        address: location?.address ?? '',
        city: location?.city ?? '',
        state: location?.state ?? '',
        zipCode: location?.zipCode ?? '',
      }));
      setSaved(true);
      markDirty(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save location settings',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Directions Location"
      footer={
        locationCount > 1
          ? 'This edits the primary location used as the default customer directions target. Other locations remain unchanged.'
          : 'This address is used for customer directions and the default booking location when a visit does not specify another location.'
      }
    >
      {loading
        ? (
            <div className="flex items-center justify-center py-8">
              <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
            </div>
          )
        : (
            <div className="space-y-4 p-4">
              {isPrimaryFallback && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  No primary location was set. Saving here will promote the current
                  default location for customer directions.
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Location name
                  </span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={event => handleChange('name', event.target.value)}
                    className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                    placeholder="Main salon"
                  />
                </label>

                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Street address
                  </span>
                  <input
                    type="text"
                    value={form.address}
                    onChange={event =>
                      handleChange('address', event.target.value)}
                    className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                    placeholder="123 Main St"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    City
                  </span>
                  <input
                    type="text"
                    value={form.city}
                    onChange={event => handleChange('city', event.target.value)}
                    className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                    placeholder="Toronto"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      State
                    </span>
                    <input
                      type="text"
                      value={form.state}
                      onChange={event =>
                        handleChange('state', event.target.value)}
                      className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                      placeholder="ON"
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      ZIP / postal
                    </span>
                    <input
                      type="text"
                      value={form.zipCode}
                      onChange={event =>
                        handleChange('zipCode', event.target.value)}
                      onBlur={(event) => {
                        // Readable Canadian format on edit; never rewrites an
                        // untouched stored value.
                        const formatted = formatCanadianPostalCode(
                          event.target.value,
                        );
                        if (formatted !== event.target.value) {
                          handleChange('zipCode', formatted);
                        }
                      }}
                      className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                      placeholder="M5H 2M9"
                    />
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <MapPin className="size-4 text-rose-800" />
                  <span>
                    {form.id
                      ? 'Editing current default location'
                      : 'Create the first customer-facing location'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!form.name.trim() || saving || !dirty}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="size-4" />
                  <span>{saving ? 'Saving...' : 'Save location'}</span>
                </button>
              </div>

              {saved && !error && (
                <div className="text-right text-xs font-medium text-green-600">
                  Location saved.
                </div>
              )}
            </div>
          )}
    </Section>
  );
}

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
              <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
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
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                  className="mt-2 w-full resize-y rounded-[10px] border border-gray-200 p-3 text-[15px] leading-relaxed text-black outline-none transition-colors focus:border-[#007AFF]"
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
                  className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
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

const LOCKED_BOOKING_EXPERIENCE_ENTITLEMENT:
ResolvedSubscriptionFeatureEntitlement = {
  featureKey: 'booking_experience_customization',
  entitled: false,
  source: 'plan',
  planKey: 'free',
  storedPlan: null,
  lockedReason: 'upgrade_required',
};

function readBookingExperienceEntitlement(
  responseBody: unknown,
): ResolvedSubscriptionFeatureEntitlement | null {
  if (
    typeof responseBody !== 'object'
    || responseBody === null
    || Array.isArray(responseBody)
  ) {
    return null;
  }

  const candidate = (
    responseBody as Record<string, unknown>
  ).bookingExperienceEntitlement;
  if (
    typeof candidate !== 'object'
    || candidate === null
    || Array.isArray(candidate)
  ) {
    return null;
  }

  const entitlement = candidate as Record<string, unknown>;
  if (
    entitlement.featureKey !== 'booking_experience_customization'
    || typeof entitlement.entitled !== 'boolean'
    || (
      entitlement.source !== 'plan'
      && entitlement.source !== 'override'
    )
    || (
      entitlement.planKey !== 'free'
      && entitlement.planKey !== 'tier_1'
      && entitlement.planKey !== 'tier_2'
      && entitlement.planKey !== 'enterprise'
    )
    || (
      typeof entitlement.storedPlan !== 'string'
      && entitlement.storedPlan !== null
    )
    || (
      entitlement.lockedReason !== null
      && entitlement.lockedReason !== 'upgrade_required'
    )
  ) {
    return null;
  }

  return {
    featureKey: entitlement.featureKey,
    entitled: entitlement.entitled,
    source: entitlement.source,
    planKey: entitlement.planKey,
    storedPlan: entitlement.storedPlan,
    lockedReason: entitlement.lockedReason,
  };
}

function isBookingExperienceUpgradeRequired(responseBody: unknown): boolean {
  if (
    typeof responseBody !== 'object'
    || responseBody === null
    || Array.isArray(responseBody)
  ) {
    return false;
  }

  const error = (responseBody as Record<string, unknown>).error;
  return (
    typeof error === 'object'
    && error !== null
    && !Array.isArray(error)
    && (error as Record<string, unknown>).code === 'UPGRADE_REQUIRED'
  );
}

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

type BookingExperienceEditorProps = {
  draft: BookingExperienceFormState;
  entitlement: ResolvedSubscriptionFeatureEntitlement;
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
};

function BookingExperienceEditor({
  draft,
  entitlement,
  loading,
  saving,
  saved,
  dirty,
  error,
  onChange,
  onReset,
  onSave,
}: BookingExperienceEditorProps) {
  if (loading) {
    return (
      <div
        aria-live="polite"
        className="flex items-center justify-center gap-2 py-8"
        role="status"
      >
        <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
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
  const configuredSocials = [
    {
      key: 'instagram',
      label: 'Instagram',
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
      disabled={saving || !entitlement.entitled}
    >
      {!entitlement.entitled && (
        <div
          className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          data-testid="booking-experience-locked"
          role="status"
        >
          <p className="font-semibold">
            Booking Experience Customization is locked for this plan.
          </p>
          <p className="mt-1">
            Your saved settings are preserved, but they are not currently
            applied to public booking, confirmations, or emails. They will be
            restored automatically if access returns.
          </p>
        </div>
      )}
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
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Primary brand colour
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Choose primary brand colour"
              value={hasValidPreviewColor ? previewColor : '#9F1239'}
              onChange={event =>
                onChange(current => ({
                  ...current,
                  primaryColor: event.target.value.toUpperCase(),
                }))}
              className="size-11 cursor-pointer rounded-[10px] border border-gray-200 bg-white p-1"
            />
            <input
              type="text"
              aria-label="Primary brand colour"
              value={draft.primaryColor ?? ''}
              onChange={event =>
                onChange(current => ({
                  ...current,
                  primaryColor: event.target.value
                    ? event.target.value.toUpperCase()
                    : null,
                }))}
              maxLength={7}
              pattern="#[0-9A-Fa-f]{6}"
              placeholder="Theme default"
              className="h-11 min-w-0 flex-1 rounded-[10px] border border-gray-200 px-3 font-mono text-[15px] uppercase text-black outline-none transition-colors focus:border-[#007AFF]"
            />
            <button
              type="button"
              onClick={() =>
                onChange(current => ({ ...current, primaryColor: null }))}
              className="h-11 rounded-[10px] border border-gray-200 px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Use theme
            </button>
          </div>
          <span className="text-xs text-gray-500">
            Buttons, selected states, borders, and accents only. Enter a six-digit
            hex colour.
          </span>
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
            className="w-full resize-y rounded-[10px] border border-gray-200 p-3 text-[15px] leading-relaxed text-black outline-none transition-colors focus:border-[#007AFF]"
          />
          <span className="text-right text-xs text-gray-500">
            {(draft.bookingMessage ?? '').length}
            /160
          </span>
        </label>

        <div className="space-y-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Social links
            </div>
            <p className="mt-1 text-sm text-gray-700">
              Only configured profile links appear on the booking page.
            </p>
          </div>
          {configuredSocials.map((social) => {
            const SocialIcon = social.icon;
            return (
              <label key={social.key} className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <SocialIcon className="size-4" />
                  {social.label}
                </span>
                <input
                  type="url"
                  value={social.value ?? ''}
                  onChange={event =>
                    onChange(current => ({
                      ...current,
                      socialLinks: {
                        ...current.socialLinks,
                        [social.key]: event.target.value || null,
                      },
                    }))}
                  maxLength={500}
                  placeholder={`https://${social.label.toLowerCase()}.com/your-profile`}
                  className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                />
              </label>
            );
          })}
        </div>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
            className="w-full resize-y rounded-[10px] border border-gray-200 p-3 text-[15px] leading-relaxed text-black outline-none transition-colors focus:border-[#007AFF]"
          />
          <span className="text-right text-xs text-gray-500">
            {(draft.confirmationMessage ?? '').length}
            /500
          </span>
        </label>
      </div>

      {!entitlement.entitled && (
        <div
          aria-label="Booking experience preview inactive"
          className="rounded-[14px] border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-700"
          data-testid="booking-experience-preview-inactive"
        >
          <p className="font-semibold">Public preview inactive</p>
          <p className="mt-1">
            The saved configuration above is not currently public.
          </p>
        </div>
      )}

      <div
        aria-hidden={!entitlement.entitled}
        data-testid="booking-experience-preview"
        hidden={!entitlement.entitled}
        className={`space-y-4 rounded-[14px] border border-gray-200 bg-[#FFF8F5] p-4 ${
          entitlement.entitled ? '' : 'hidden'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Live preview
            </div>
            <h3 className="mt-1 text-xl font-semibold text-gray-950">
              Choose your service
            </h3>
          </div>
        </div>

        {draft.bookingMessage && (
          <p className="whitespace-pre-line break-words text-sm text-gray-700">
            {draft.bookingMessage}
          </p>
        )}

        <div
          data-testid="booking-experience-preview-service"
          className="flex items-center justify-between rounded-[12px] border-2 bg-white p-3"
          style={{ borderColor: previewStateBorder }}
        >
          <div>
            <div className="font-semibold text-gray-950">Signature manicure</div>
            <div className="text-xs text-gray-500">45 min</div>
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
          <div className="flex items-center gap-2 border-t border-gray-200 pt-3">
            {configuredSocials.map((social) => {
              if (!social.value) {
                return null;
              }
              const SocialIcon = social.icon;
              return (
                <span
                  key={social.key}
                  aria-label={`${social.label} social icon preview`}
                  className="flex size-9 items-center justify-center rounded-full border-2 bg-white text-gray-900"
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
          <div className="border-t border-gray-200 pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Confirmation message
            </div>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-gray-700">
              {draft.confirmationMessage}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={onReset}
          disabled={!entitlement.entitled}
          className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
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
            disabled={saving || !dirty || !entitlement.entitled}
            className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="size-4" />
            <span>{saving ? 'Saving...' : 'Save booking experience'}</span>
          </button>
        </div>
      </div>
    </fieldset>
  );
}

type BookingPolicyEditorProps = BookingExperienceEditorProps;

function BookingPolicyEditor({
  draft,
  entitlement,
  loading,
  saving,
  saved,
  dirty,
  error,
  onChange,
  onReset,
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
        <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
        <span className="sr-only">Loading booking policy settings</span>
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
      disabled={saving || !entitlement.entitled}
    >
      {!entitlement.entitled && (
        <div
          className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          data-testid="booking-policy-locked"
          role="status"
        >
          <p className="font-semibold">
            Booking Experience Customization is locked for this plan.
          </p>
          <p className="mt-1">
            Your saved policy is preserved, but it is not currently shown on
            public booking pages or in confirmation emails.
          </p>
        </div>
      )}

      {error && (
        <div
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4 rounded-[12px] border border-gray-200 bg-white p-4">
        <label className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Enable booking policy
            </span>
            <p className="mt-1 text-sm text-gray-700">
              Publish one canonical policy anywhere you enable below.
            </p>
          </div>
          <input
            aria-label="Enable booking policy"
            type="checkbox"
            checked={draft.policy.enabled}
            disabled={acknowledgmentRequired}
            onChange={event =>
              onChange(current => ({
                ...current,
                policy: {
                  ...current.policy,
                  enabled: event.target.checked,
                },
              }))}
            className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
          />
        </label>
        {acknowledgmentRequired && (
          <p className="text-xs text-gray-600">
            The policy stays enabled while acknowledgment is required.
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
            className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
          />
          <span className="text-right text-xs text-gray-500">
            {(draft.policy.title ?? '').length}
            /60
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
            className="w-full resize-y rounded-[10px] border border-gray-200 p-3 text-[15px] leading-relaxed text-black outline-none transition-colors focus:border-[#007AFF]"
          />
          <span className="text-right text-xs text-gray-500">
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
              className="flex items-center gap-2 rounded-[10px] border border-gray-200 px-3 py-2.5 text-sm text-gray-700"
            >
              <input
                type="checkbox"
                aria-label={label}
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
                className="size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
              />
              {label}
            </label>
          ))}
        </div>
        {acknowledgmentRequired && (
          <p className="text-xs text-gray-600">
            The policy must appear before confirmation while acknowledgment is required.
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-[12px] border border-gray-200 bg-white p-4">
        <label className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Require acknowledgment
            </span>
            <p className="mt-1 text-sm text-gray-700">
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
            className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
            className="w-full resize-y rounded-[10px] border border-gray-200 p-3 text-[15px] leading-relaxed text-black outline-none transition-colors focus:border-[#007AFF]"
          />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p
              id="booking-policy-acknowledgment-help"
              className="max-w-xl text-xs leading-5 text-gray-600"
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
                  : 'text-gray-500'
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
          className="inline-flex items-center rounded-[10px] border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
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

      <div className="space-y-3 rounded-[12px] border border-gray-200 bg-white p-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Quick facts
          </span>
          <p className="mt-1 text-sm text-gray-700">
            Every badge is explicit. Nothing is inferred from policy wording or
            other salon settings.
          </p>
        </div>
        {quickFactFields.map((field) => {
          const fact = draft.quickFacts[field.key];
          return (
            <div
              key={field.key}
              className="grid gap-3 rounded-[10px] border border-gray-200 p-3 sm:grid-cols-[auto_1fr]"
            >
              <label className="flex items-start gap-2 text-sm font-semibold text-gray-900">
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
                  className="mt-0.5 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
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
                  className="h-10 rounded-[9px] border border-gray-200 px-3 text-sm text-black outline-none transition-colors focus:border-[#007AFF]"
                />
                <span className="text-right text-xs text-gray-500">
                  {(fact.label ?? '').length}
                  /40
                </span>
              </label>
            </div>
          );
        })}
      </div>

      {!entitlement.entitled && (
        <div
          aria-label="Booking policy preview inactive"
          className="rounded-[14px] border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-700"
          data-testid="booking-policy-preview-inactive"
        >
          <p className="font-semibold">Public preview inactive</p>
          <p className="mt-1">The saved policy remains available to edit when access returns.</p>
        </div>
      )}

      <div
        aria-hidden={!entitlement.entitled}
        data-testid="booking-policy-preview"
        hidden={!entitlement.entitled}
        className={`space-y-3 rounded-[14px] border border-gray-200 bg-[#FFF8F5] p-4 ${
          entitlement.entitled ? '' : 'hidden'
        }`}
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-gray-700"
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
          <label className="flex items-start gap-3 rounded-[10px] border border-gray-200 bg-white p-3 text-sm leading-6 text-gray-800">
            <input
              type="checkbox"
              checked={previewAcknowledged}
              onChange={event =>
                setPreviewAcknowledged(event.target.checked)}
              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={onReset}
          disabled={!entitlement.entitled}
          className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
        >
          <RotateCcw className="size-4" />
          Reset policy
        </button>
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
              || !entitlement.entitled
              || !acknowledgmentDependenciesValid
            }
            className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
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
  owner: 'your owner email',
  salon_account: 'your salon account email',
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-t-[20px] bg-white shadow-xl supports-[height:100dvh]:max-h-[90dvh] sm:rounded-[20px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Compare Plans</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close compare plans modal"
            className="flex size-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
          >
            <X className="size-4 text-gray-600" />
          </button>
        </div>

        {/* Content — the CANONICAL catalogue only (Gate C2, §12). Feature
            access is unchanged by these plans until the separately-approved
            feature matrix lands; plans differ in monthly SMS credits. */}
        <div className="max-h-[calc(90vh-120px)] touch-pan-y overflow-y-auto overscroll-contain p-5 supports-[height:100dvh]:max-h-[calc(90dvh-120px)]">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {BILLING_PLAN_CARDS.map(plan => (
              <div key={plan.family} className="rounded-xl border-2 border-gray-200 bg-white p-4">
                <div className="mb-3 text-center">
                  <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                  <div className="mt-1 text-2xl font-bold text-gray-900">{plan.monthly}</div>
                  <p className="mt-1 text-xs text-gray-500">per month</p>
                </div>
                <ul className="space-y-2 text-sm text-gray-700">
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

          <p className="mt-4 text-center text-xs text-gray-500">
            Prices in CAD, plus applicable taxes. Annual plans renew at the
            standard annual price. Your current feature access does not change
            with these plans.
          </p>

          <p className="mt-6 text-center text-xs text-gray-500">
            To change plans, contact Luster at support@islanailsalon.com
          </p>
        </div>
      </motion.div>
    </div>
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

const VIEW_TITLES: Record<SettingsView, string> = {
  'index': 'Settings',
  'account': 'Account',
  'location': 'Locations',
  'branding': 'Branding',
  'booking': 'Booking rules',
  'booking-policy': 'Booking policy',
  'booking-flow': 'Booking flow',
  'smart-fit': 'Smart Fit discounts',
  'payments': 'Payments & taxes',
  'notifications': 'Notifications',
  'communications': 'Client communications',
  'features': 'Features',
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
  const locale = String(params?.locale || 'en');

  // View navigation state (index + focused editing views)
  const [view, setView] = useState<SettingsView>('index');
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  // Per-view unsaved-edit tracking (explicit-save views only; autosave views
  // never hold unsaved state)
  const [locationDirty, setLocationDirty] = useState(false);
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
  const [bookingExperienceSaving, setBookingExperienceSaving] = useState(false);
  const [bookingExperienceSaved, setBookingExperienceSaved] = useState(false);
  const [bookingExperienceError, setBookingExperienceError]
    = useState<string | null>(null);
  const [bookingPolicySaving, setBookingPolicySaving] = useState(false);
  const [bookingPolicySaved, setBookingPolicySaved] = useState(false);
  const [bookingPolicyError, setBookingPolicyError]
    = useState<string | null>(null);
  const [bookingExperienceEntitlement, setBookingExperienceEntitlement]
    = useState<ResolvedSubscriptionFeatureEntitlement>(
      LOCKED_BOOKING_EXPERIENCE_ENTITLEMENT,
    );
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
  const [communicationsForm, setCommunicationsForm] = useState<{
    emailEnabled: boolean;
    smsEnabled: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
    rules: Array<{ id: string; offsetMinutes: number; channels: 'sms' | 'email' | 'both'; enabled: boolean }>;
    events: Record<string, { enabled: boolean; channels: 'sms' | 'email' | 'both' }>;
  }>({
    emailEnabled: true,
    smsEnabled: false,
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
  const updateBookingConfigForm = (
    updater: (prev: BookingConfigFormState) => BookingConfigFormState,
  ) => {
    setBookingConfigForm(updater);
    setBookingConfigDirty(true);
    setBookingConfigSaved(false);
  };

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
        setBookingExperienceEntitlement(
          readBookingExperienceEntitlement(data)
          ?? LOCKED_BOOKING_EXPERIENCE_ENTITLEMENT,
        );
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
        });
        setFeatureLusterManicure(
          data.merchandising?.featureLusterManicure ?? true,
        );
        setShowServiceImages(
          data.merchandising?.showServiceImages !== false,
        );
        if (data.communications) {
          setCommunicationsForm({
            emailEnabled: data.communications.email?.enabled !== false,
            smsEnabled: data.communications.sms?.enabled === true,
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
      || !bookingExperienceEntitlement.entitled
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
        if (
          response.status === 403
          && isBookingExperienceUpgradeRequired(body)
        ) {
          setBookingExperienceEntitlement(
            LOCKED_BOOKING_EXPERIENCE_ENTITLEMENT,
          );
        }
        throw new Error(getBookingExperienceSaveError(body));
      }

      const persisted = copyBookingExperience(
        body?.bookingExperience ?? bookingExperienceDraft,
      );
      const returnedEntitlement = readBookingExperienceEntitlement(body);
      if (returnedEntitlement) {
        setBookingExperienceEntitlement(returnedEntitlement);
      }
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
    bookingExperienceEntitlement.entitled,
    router,
  ]);

  const saveBookingPolicy = useCallback(async () => {
    if (
      !salonSlug
      || bookingPolicySaving
      || !bookingPolicyDirty
      || !bookingExperienceEntitlement.entitled
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
        if (
          response.status === 403
          && isBookingExperienceUpgradeRequired(body)
        ) {
          setBookingExperienceEntitlement(
            LOCKED_BOOKING_EXPERIENCE_ENTITLEMENT,
          );
        }
        throw new Error(getBookingExperienceSaveError(body));
      }

      const persisted = copyBookingExperience(
        body?.bookingExperience ?? bookingExperienceDraft,
      );
      const returnedEntitlement = readBookingExperienceEntitlement(body);
      if (returnedEntitlement) {
        setBookingExperienceEntitlement(returnedEntitlement);
      }
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
    bookingExperienceEntitlement.entitled,
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
        body: JSON.stringify({
          name: profileName.trim(),
          email: profileEmail.trim(),
        }),
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
      const response = await fetch(`/api/admin/salon/settings?salonSlug=${salonSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          communications: {
            sms: { enabled: communicationsForm.smsEnabled },
            email: { enabled: communicationsForm.emailEnabled },
            quietHours: communicationsForm.quietHours,
            reminders: { rules: communicationsForm.rules },
            ...(Object.keys(communicationsForm.events).length > 0
              ? { events: communicationsForm.events }
              : {}),
          },
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to save communication settings');
      }
      const data = await response.json();
      if (data.communications) {
        setCommunicationsForm({
          emailEnabled: data.communications.email?.enabled !== false,
          smsEnabled: data.communications.sms?.enabled === true,
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
    } catch {
      setCommunicationsError('Could not save. Please try again.');
    } finally {
      setCommunicationsSaving(false);
    }
  }, [salonSlug, communicationsSaving, communicationsForm]);

  const viewDirty: Partial<Record<SettingsView, boolean>> = {
    'location': locationDirty || parkingDirty,
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

  const goToIndex = () => {
    setConfirmingLeave(false);
    if (view === 'branding') {
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
    if (view === 'booking-policy') {
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
    setLocationDirty(false);
    setParkingDirty(false);
    setSmartFitDirty(false);
    setView('index');
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

  const openView = (next: SettingsView) => {
    setConfirmingLeave(false);
    setView(next);
  };

  return (
    <div
      className="flex min-h-full w-full flex-col bg-[#FFF8F5] font-sans text-black"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#FFF8F5]/90 backdrop-blur-md">
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
          <h1 className="text-[34px] font-bold text-[#1C1C1E]">
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
              <Row
                icon={MapPin}
                iconColor="bg-rose-800"
                label="Locations & directions"
                onClick={() => openView('location')}
              />
              <Row
                icon={Palette}
                iconColor="bg-pink-500"
                label="Branding & appearance"
                onClick={() => openView('branding')}
                isLast
              />
            </Section>

            <Section title="Booking">
              <Row
                icon={CalendarClock}
                iconColor="bg-rose-600"
                label="Booking rules"
                value={
                  bookingConfigLoading
                    ? undefined
                    : `${bookingConfigForm.slotIntervalMinutes} min · ${bookingConfigForm.currency}`
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
                    onClick={() => onOpenApp('staff')}
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
                iconColor="bg-rose-800"
                label="Client texts & reminders"
                onClick={() => openView('communications')}
                isLast
              />
            </Section>

            {hasEntitledModules && (
              <Section title="Features">
                <Row
                  icon={Boxes}
                  iconColor="bg-purple-500"
                  label="Modules & programs"
                  onClick={() => openView('features')}
                  isLast
                />
              </Section>
            )}

            {onOpenApp && (
              <Section
                title="Integrations"
                footer="Google Calendar, text messaging, and email are managed in the Integrations app."
              >
                <Row
                  icon={Plug}
                  iconColor="bg-rose-700"
                  label="Manage integrations"
                  value="Calendar, text, email"
                  onClick={() => onOpenApp('integrations')}
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
            <DirectionsLocationSection
              salonSlug={salonSlug}
              onDirtyChange={setLocationDirty}
            />
            <ParkingInstructionsCard
              salonSlug={salonSlug}
              onDirtyChange={setParkingDirty}
            />
          </>
        )}

        {view === 'branding' && (
          <>
            <Section title="Branding & appearance">
              <PageThemesSettings className="overflow-visible rounded-[10px] bg-white" />
            </Section>
            <Section
              title="Public booking experience"
              footer="These bounded controls customize booking and confirmation content without changing the site theme or email template."
            >
              <BookingExperienceEditor
                draft={bookingExperienceDraft}
                entitlement={bookingExperienceEntitlement}
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
                    primaryColor: defaults.primaryColor,
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
              entitlement={bookingExperienceEntitlement}
              loading={bookingExperienceLoading}
              saving={bookingPolicySaving}
              saved={bookingPolicySaved}
              dirty={bookingPolicyDirty}
              error={bookingPolicyError}
              onChange={updateBookingPolicyDraft}
              onReset={() => {
                const defaults = copyBookingExperience(
                  BOOKING_EXPERIENCE_DEFAULTS,
                );
                const next = {
                  ...bookingExperienceDraft,
                  policy: { ...defaults.policy },
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
                    <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                  </div>
                )
              : (
                  <div className="space-y-4 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                          className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                          className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
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
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                          className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                        >
                          {CURRENCY_OPTIONS.map(option => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                            className="h-11 w-full rounded-[10px] border border-gray-200 px-3 pr-16 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-gray-500">
                            hours
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          Clients contact you inside this window. Use 0 to allow
                          changes anytime.
                        </span>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                          className="h-11 rounded-[10px] border border-gray-200 bg-white px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                        >
                          {getTimeZoneOptions(bookingConfigForm.timezone).map(zone => (
                            <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                          className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                          placeholder="Founding Client Price"
                        />
                      </label>

                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            First-visit offer
                          </span>
                          <p className="text-sm text-gray-700">
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
                          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                        />
                      </label>

                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Feature Luster Manicure
                          </span>
                          <p className="text-sm text-gray-700">
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
                          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                        />
                      </label>

                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Show service images
                          </span>
                          <p className="text-sm text-gray-700">
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
                          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                        />
                      </label>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                      <div className="text-xs text-gray-500">
                        Applies to slot generation and intro badges when a service
                        does not define its own label.
                      </div>
                      <button
                        type="button"
                        onClick={() => void saveBookingConfig()}
                        disabled={bookingConfigSaving || !bookingConfigDirty}
                        className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="size-4" />
                        <span>
                          {bookingConfigSaving ? 'Saving...' : 'Save booking config'}
                        </span>
                      </button>
                    </div>

                    {bookingConfigSaved && (
                      <div className="text-right text-xs font-medium text-green-600">
                        Booking configuration saved.
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
                    <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
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
                      <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                    </div>
                  )
                : (
                    <div className="space-y-4 p-4">
                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Charge tax
                          </span>
                          <p className="text-sm text-gray-700">
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
                          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                        />
                      </label>

                      {paymentsForm.taxEnabled && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                              className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                            />
                          </label>

                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                                className="h-11 w-full rounded-[10px] border border-gray-200 px-3 pr-10 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-gray-500">
                                %
                              </span>
                            </div>
                          </label>

                          <div className="rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Reporting jurisdiction
                            </span>
                            <div className="mt-2 grid gap-3 sm:grid-cols-3">
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-gray-500">Jurisdiction label</span>
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
                                  className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-gray-500">Country code</span>
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
                                  className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] uppercase text-black outline-none transition-colors focus:border-[#007AFF]"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-gray-500">Province / region code</span>
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
                                  className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] uppercase text-black outline-none transition-colors focus:border-[#007AFF]"
                                />
                              </label>
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
                              Used for reporting only. The reviewed Ontario estimate requires
                              Canada (CA) and Ontario (ON); other or missing locations report
                              forfeited deposits at their gross amount without an estimated tax component.
                            </p>
                          </div>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Estimate tax included in forfeited deposits
                              </span>
                              <p className="text-sm text-gray-700">
                                Opt in to an estimated tax-inclusive component when a
                                collected deposit is retained. This is an estimate from
                                your settings, not a filing or remittance calculation.
                              </p>
                              <p className="text-xs text-gray-500">
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
                              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Prices include tax
                              </span>
                              <p className="text-sm text-gray-700">
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
                              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                            />
                          </label>

                          <div className="rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Taxable by default
                            </span>
                            <div className="mt-2 space-y-2">
                              {([
                                ['taxServicesByDefault', 'Services'],
                                ['taxAddOnsByDefault', 'Add-ons'],
                                ['taxCustomByDefault', 'Custom items'],
                              ] as const).map(([key, label]) => (
                                <label key={key} className="flex items-center justify-between gap-3">
                                  <span className="text-sm text-gray-700">{label}</span>
                                  <input
                                    type="checkbox"
                                    checked={paymentsForm[key]}
                                    onChange={event =>
                                      updatePaymentsForm(prev => ({
                                        ...prev,
                                        [key]: event.target.checked,
                                      }))}
                                    className="size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                                  />
                                </label>
                              ))}
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
                              You can still change tax on individual items at checkout.
                            </p>
                          </div>

                          <div className="rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Scheduled rate change
                            </span>
                            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-gray-500">New rate</span>
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
                                    className="h-11 w-full rounded-[10px] border border-gray-200 px-3 pr-10 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-gray-500">
                                    %
                                  </span>
                                </div>
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-gray-500">Effective from</span>
                                <input
                                  type="date"
                                  data-testid="payments-tax-scheduled-date"
                                  value={paymentsForm.scheduledEffectiveFrom}
                                  onChange={event =>
                                    updatePaymentsForm(prev => ({
                                      ...prev,
                                      scheduledEffectiveFrom: event.target.value,
                                    }))}
                                  className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                                />
                              </label>
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
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
                      <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                    </div>
                  )
                : (
                    <div className="space-y-4 p-4">
                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Accept e-Transfer
                          </span>
                          <p className="text-sm text-gray-700">
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
                          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                        />
                      </label>

                      {paymentsForm.etransferEnabled && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                              className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                            />
                          </label>

                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                              className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Autodeposit is on
                              </span>
                              <p className="text-sm text-gray-700">
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
                              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                            />
                          </label>

                          <label className="flex flex-col gap-1 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                              className="rounded-[10px] border border-gray-200 px-3 py-2 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Require reference
                              </span>
                              <p className="text-sm text-gray-700">
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
                              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Payment QR page
                              </span>
                              <p className="text-sm text-gray-700">
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
                              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                            />
                          </label>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                        <div className="text-xs text-gray-500">
                          Applies to new checkouts only — completed appointments are
                          never recalculated.
                        </div>
                        <button
                          type="button"
                          data-testid="payments-save"
                          onClick={() => void savePayments()}
                          disabled={paymentsSaving || !paymentsDirty}
                          className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Save className="size-4" />
                          <span>
                            {paymentsSaving ? 'Saving...' : 'Save payments & taxes'}
                          </span>
                        </button>
                      </div>

                      {paymentsSaved && (
                        <div className="text-right text-xs font-medium text-green-600">
                          Payments & taxes saved.
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
                      <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
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
                        className="rounded-[10px] border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700"
                      >
                        {depositPolicy === null
                          ? 'Checking your deposit setup...'
                          : depositPolicy.collectionLive === false
                            ? 'Deposit payments are not switched on yet.'
                            : !depositPolicy.entitled
                                ? 'Deposits are not enabled for your salon yet.'
                                : depositPolicy.active
                                  ? 'Deposits are being collected on new bookings.'
                                  : (depositPolicy.reason
                                    && DEPOSIT_REASON_COPY[depositPolicy.reason])
                                    || 'Deposits are not being collected yet.'}
                      </p>

                      {depositPolicy?.readinessStale && (
                        <p
                          data-testid="deposits-readiness-age"
                          className="text-xs text-gray-500"
                        >
                          {depositPolicy.readinessAgeMs === null
                            ? 'Stripe status has not been confirmed yet.'
                            : `Stripe status last confirmed ${Math.max(1, Math.round(depositPolicy.readinessAgeMs / 3_600_000))} hours ago.`}
                        </p>
                      )}

                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Require a deposit
                          </span>
                          <p className="text-sm text-gray-700">
                            Saved. Deposits will be collected once deposit payments are
                            switched on for your salon.
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
                          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                          className="rounded-[10px] border border-gray-200 px-3 py-2 text-sm"
                        />
                      </label>

                      {depositAmountInput.trim() !== '' && (
                        <p data-testid="deposits-clamp-notice" className="text-xs text-gray-500">
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

                      <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-3">
                        <button
                          type="button"
                          data-testid="deposits-save"
                          onClick={() => void saveDeposit()}
                          disabled={
                            depositSaving
                            || (!depositEnabledDirty && !depositAmountDirty)
                          }
                          className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
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
          </>
        )}

        {view === 'communications' && (
          <div className="space-y-6 px-4 pb-8 pt-2">
            {/* Channel masters. SMS stays VISIBLE but disabled when the
                platform cannot send (§6.3: disabled, never hidden). */}
            <Section title="Channels">
              <div className="space-y-3 p-4">
                <label className="flex min-h-[44px] items-center justify-between gap-3">
                  <span className="text-[15px] text-black">Email to clients</span>
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
                  <span className="text-[15px] text-black">
                    Text messages to clients
                    {!bookingNotificationCapabilities.smsChannelAvailable && (
                      <span className="ml-1 text-[13px] text-[#8E8E93]">(Unavailable)</span>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    className="size-5 accent-rose-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:opacity-40"
                    checked={communicationsForm.smsEnabled}
                    disabled={!bookingNotificationCapabilities.smsChannelAvailable}
                    onChange={(event) => {
                      setCommunicationsForm(current => ({ ...current, smsEnabled: event.target.checked }));
                      setCommunicationsDirty(true);
                    }}
                  />
                </label>
                <p className="text-[13px] leading-snug text-[#8E8E93]">
                  Email confirmations and reminders are included with every plan.
                  Text messages use your SMS credits once texting is available for
                  your salon.
                </p>
              </div>
            </Section>

            {/* Reminder rules — up to three, whole-list edited. */}
            <Section title="Appointment reminders">
              <div className="space-y-3 p-4">
                {communicationsForm.rules.length === 0 && (
                  <p className="text-[14px] text-[#8E8E93]">
                    No reminders configured. Clients only receive their booking
                    confirmation.
                  </p>
                )}
                {communicationsForm.rules.map((rule, index) => (
                  <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 p-3">
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
                      className="h-9 rounded-md border border-gray-200 bg-white px-2 text-[14px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 motion-reduce:transition-none"
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
                      className="h-9 rounded-md border border-gray-200 bg-white px-2 text-[14px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 motion-reduce:transition-none"
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
                      <option value="sms" disabled={!bookingNotificationCapabilities.smsChannelAvailable}>
                        {bookingNotificationCapabilities.smsChannelAvailable ? 'Text' : 'Text (Unavailable)'}
                      </option>
                      <option value="both" disabled={!bookingNotificationCapabilities.smsChannelAvailable}>
                        {bookingNotificationCapabilities.smsChannelAvailable ? 'Email & text' : 'Email & text (Unavailable)'}
                      </option>
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
                    className="text-[14px] font-medium text-rose-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
                    onClick={() => {
                      setCommunicationsForm(current => ({
                        ...current,
                        rules: [
                          ...current.rules,
                          {
                            id: `crule_${crypto.randomUUID()}`,
                            // 2h, NOT 24h: a new rule must not collide with
                            // the shipped default rule's enabled offset,
                            // which would fail validation on save.
                            offsetMinutes: 120,
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
                  <span className="text-[15px] text-black">Hold texts overnight</span>
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
                    <label className="flex items-center gap-2 text-[14px] text-black">
                      From
                      <input
                        type="time"
                        aria-label="Quiet hours start"
                        className="h-9 rounded-md border border-gray-200 px-2 text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
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
                    <label className="flex items-center gap-2 text-[14px] text-black">
                      to
                      <input
                        type="time"
                        aria-label="Quiet hours end"
                        className="h-9 rounded-md border border-gray-200 px-2 text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
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
                <p className="text-[13px] leading-snug text-[#8E8E93]">
                  Scheduled reminders wait until quiet hours end. Booking
                  confirmations still send right away.
                </p>
              </div>
            </Section>

            {/* Save */}
            <div className="flex items-center gap-3 px-1">
              <button
                type="button"
                onClick={saveCommunications}
                disabled={communicationsSaving || !communicationsDirty}
                className="rounded-lg bg-rose-800 px-4 py-2 text-[15px] font-medium text-white transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:opacity-40 motion-reduce:transition-none"
              >
                {communicationsSaving ? 'Saving…' : 'Save communication settings'}
              </button>
              <span role="status" aria-live="polite" className="text-[13px] text-[#8E8E93]">
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
                    <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
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
                          className="space-y-3 rounded-[14px] border border-gray-200 bg-gray-50/70 p-3"
                        >
                          <div className="space-y-1 px-1">
                            <div className="text-sm font-semibold text-[#1C1C1E]">
                              {notificationEvent.title}
                            </div>
                            <p className="text-xs text-gray-500">
                              {notificationEvent.subtitle}
                            </p>
                          </div>

                          <div className="rounded-[12px] border border-gray-200 bg-white/80 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Bell className="size-4 text-[#FF3B30]" />
                                  <span className="text-sm font-semibold text-[#1C1C1E]">
                                    Notify assigned technician
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600">
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
                                className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                                aria-label={`Notify assigned technician for ${notificationEvent.title.toLowerCase()}`}
                              />
                            </div>

                            <label className="mt-3 flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                                className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
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

                            <p className="mt-2 text-xs text-gray-500">
                              Technician email alerts require an email on each
                              technician profile.
                            </p>
                          </div>

                          <div className="rounded-[12px] border border-gray-200 bg-white/80 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <User className="size-4 text-rose-800" />
                                  <span className="text-sm font-semibold text-[#1C1C1E]">
                                    Notify salon owner
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600">
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
                                className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                                aria-label={`Notify salon owner for ${notificationEvent.title.toLowerCase()}`}
                              />
                            </div>

                            <label className="mt-3 flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                                className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
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

                            <p className="mt-2 text-xs text-gray-500">
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
                      <div className="rounded-[10px] border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                        {!bookingNotificationCapabilities.smsChannelAvailable && (
                          <div>
                            SMS alerts are unavailable until SMS reminders are enabled
                            for the salon and Twilio is configured.
                          </div>
                        )}
                        {!bookingNotificationCapabilities.emailChannelAvailable && (
                          <div>
                            Email alerts are unavailable until Resend is configured.
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                      <div className="text-xs text-gray-500">
                        Duplicate owner and technician destinations are deduplicated
                        automatically per channel.
                      </div>
                      <button
                        type="button"
                        onClick={() => void saveBookingNotifications()}
                        disabled={bookingNotificationsSaving || !notificationsDirty}
                        className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="size-4" />
                        <span>
                          {bookingNotificationsSaving ? 'Saving...' : 'Save alerts'}
                        </span>
                      </button>
                    </div>

                    <div className="space-y-3 rounded-[14px] border border-gray-200 bg-gray-50/70 p-3">
                      <div className="space-y-1 px-1">
                        <div className="text-sm font-semibold text-[#1C1C1E]">
                          Appointment notifications
                        </div>
                        <p className="text-xs text-gray-500">
                          Detailed emails to the salon when a client books,
                          reschedules, or cancels. Separate from the confirmation
                          and reminder emails your clients receive.
                        </p>
                      </div>

                      <div className="space-y-2 rounded-[12px] border border-gray-200 bg-white/80 p-3">
                        {SALON_EMAIL_NOTIFICATION_EVENT_OPTIONS.map(option => (
                          <div
                            key={option.key}
                            className="flex items-start justify-between gap-3"
                          >
                            <div className="space-y-0.5">
                              <span className="text-sm font-semibold text-[#1C1C1E]">
                                {option.label}
                              </span>
                              <p className="text-sm text-gray-600">
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
                              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                              aria-label={option.label}
                            />
                          </div>
                        ))}

                        <label className="flex flex-col gap-1 pt-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                            className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
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
                            <p className="text-xs text-gray-500">
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

                      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                        <div className="text-xs text-gray-500">
                          {salonEmailNotificationsSaved
                            ? 'Appointment notifications saved.'
                            : 'Leave the address blank to use your owner email.'}
                        </div>
                        <button
                          type="button"
                          onClick={() => void saveSalonEmailNotifications()}
                          disabled={
                            salonEmailNotificationsSaving
                            || !salonEmailNotificationsDirty
                          }
                          className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
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

        {view === 'features' && hasEntitledModules && (
          <>
            {/* Modules (Step 16.3) */}
            <Section
              title="Modules"
              footer="Enable or disable features for your salon. Disabled modules won't be available to staff."
            >
              {modulesLoading
                ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                    </div>
                  )
                : (
                    <>
                      {/* Marketing Group */}
                      <div className="border-b border-gray-100 px-4 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Marketing
                        </span>
                      </div>
                      {entitledModules.smsReminders && (
                        <ModuleRow
                          icon={MessageSquare}
                          iconColor="bg-green-500"
                          label="SMS Reminders"
                          moduleKey="smsReminders"
                          enabled={modules.smsReminders}
                          entitled={entitledModules.smsReminders}
                          onToggle={handleModuleToggle}
                        />
                      )}
                      {entitledModules.referrals && (
                        <ModuleRow
                          icon={Users}
                          iconColor="bg-blue-500"
                          label="Referrals"
                          moduleKey="referrals"
                          enabled={modules.referrals}
                          entitled={entitledModules.referrals}
                          onToggle={handleModuleToggle}
                        />
                      )}
                      {entitledModules.rewards && (
                        <ModuleRow
                          icon={Gift}
                          iconColor="bg-purple-500"
                          label="Rewards"
                          moduleKey="rewards"
                          enabled={modules.rewards}
                          entitled={entitledModules.rewards}
                          onToggle={handleModuleToggle}
                        />
                      )}

                      {/* Staff Group */}
                      <div className="border-b border-gray-100 px-4 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Staff
                        </span>
                      </div>
                      {entitledModules.scheduleOverrides && (
                        <ModuleRow
                          icon={User}
                          iconColor="bg-orange-500"
                          label="Schedule Overrides"
                          moduleKey="scheduleOverrides"
                          enabled={modules.scheduleOverrides}
                          entitled={entitledModules.scheduleOverrides}
                          onToggle={handleModuleToggle}
                        />
                      )}
                      {entitledModules.staffEarnings && (
                        <ModuleRow
                          icon={BarChart3}
                          iconColor="bg-teal-500"
                          label="Staff Earnings"
                          moduleKey="staffEarnings"
                          enabled={modules.staffEarnings}
                          entitled={entitledModules.staffEarnings}
                          onToggle={handleModuleToggle}
                        />
                      )}

                      {/* Controls Group */}
                      <div className="border-b border-gray-100 px-4 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Controls
                        </span>
                      </div>
                      {entitledModules.clientFlags && (
                        <ModuleRow
                          icon={Flag}
                          iconColor="bg-amber-500"
                          label="Client Flags"
                          moduleKey="clientFlags"
                          enabled={modules.clientFlags}
                          entitled={entitledModules.clientFlags}
                          onToggle={handleModuleToggle}
                        />
                      )}
                      {entitledModules.clientBlocking && (
                        <ModuleRow
                          icon={Shield}
                          iconColor="bg-red-500"
                          label="Client Blocking"
                          moduleKey="clientBlocking"
                          enabled={modules.clientBlocking}
                          entitled={entitledModules.clientBlocking}
                          onToggle={handleModuleToggle}
                        />
                      )}

                      {/* Analytics Group */}
                      <div className="border-b border-gray-100 px-4 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Analytics
                        </span>
                      </div>
                      {entitledModules.analyticsDashboard && (
                        <ModuleRow
                          icon={BarChart3}
                          iconColor="bg-indigo-500"
                          label="Analytics Dashboard"
                          moduleKey="analyticsDashboard"
                          enabled={modules.analyticsDashboard}
                          entitled={entitledModules.analyticsDashboard}
                          onToggle={handleModuleToggle}
                        />
                      )}
                      {entitledModules.utilization && (
                        <ModuleRow
                          icon={BarChart3}
                          iconColor="bg-cyan-500"
                          label="Utilization Reports"
                          moduleKey="utilization"
                          enabled={modules.utilization}
                          entitled={entitledModules.utilization}
                          onToggle={handleModuleToggle}
                          isLast
                        />
                      )}

                      {modulesSaving && (
                        <div className="flex items-center justify-center py-2 text-xs text-gray-500">
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
                        <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
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

                        <div className="border-t border-gray-100 px-4 py-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                            Active Offers
                          </div>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Referral reward</span>
                              <span className="font-medium text-gray-900">
                                $10 for the referrer
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Friend offer</span>
                              <span className="font-medium text-gray-900">
                                $10 off first appointment
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">
                                Google review reward
                              </span>
                              <span className="font-medium text-gray-900">
                                $10 off (manual grant)
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Visit earning</span>
                              <span className="font-medium text-gray-900">
                                20 points per $1 spent
                              </span>
                            </div>
                          </div>
                        </div>

                        {programsSaving && (
                          <div className="flex items-center justify-center py-2 text-xs text-gray-500">
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
                    <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                  </div>
                )
              : (
                  <>
                    <Row
                      icon={Eye}
                      iconColor="bg-rose-800"
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
                      <div className="flex items-center justify-center py-2 text-xs text-gray-500">
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
              footer="Your name appears in the workspace header and on decision logs. Email is used for account matching and owner alerts."
            >
              <div className="space-y-3 p-4">
                {profileError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{profileError}</span>
                  </div>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                    className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Email
                  </span>
                  <input
                    type="email"
                    value={profileEmail}
                    onChange={(event) => {
                      setProfileEmail(event.target.value);
                      setProfileDirty(true);
                      setProfileSaved(false);
                    }}
                    className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                    placeholder="you@example.com"
                  />
                  <span className="text-xs text-gray-500">
                    Both fields save together. Email must be entered to save.
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
                      || !profileEmail.includes('@')
                    }
                    className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
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
                        <span className="text-sm text-gray-900">
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
                        <span className="text-sm text-gray-600">
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
                      className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
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
export { DirectionsLocationSection, ParkingInstructionsCard, ProfileCard, Row, Section };
